import { config } from './config';
import type { Candidate, Snapshot } from './types';
import * as store from './tools/store';
import { legInConfig } from './tools/hedgeLeg';

// The policy engine (spec "Policy engine and guardrails"). Deterministic code between the LLM and every venue.
// It rejects anything outside the limits the user signed off on. The agent can never change a limit.
//   block   = the action must not run at all
//   confirm = the action may run only after the user approves it (autonomy is not enough)
// Risk-reducing actions stay allowed when other limits have tripped (adding margin, adding a hedge).

/** Repeated instructions hidden in news text suspend autonomy (the agent asks first) instead of pausing everything. */
export const INJECTION_PAUSE = 3;
/** Capital already sitting on the venues: what the store counted, or the equity the venues report, whichever is larger. */
export const parkedOffBnb = (s: Snapshot): number => Math.max(s.today?.capitalOffBnbUsd ?? 0, (s.perpMain?.equityUsd ?? 0) + (s.deriveFree?.freeUsd ?? 0));

export interface PolicyVerdict { block: string | null; confirm: string | null }
export const OK: PolicyVerdict = { block: null, confirm: null };
const usd = (x: number) => `$${Math.round(x * 100) / 100}`;

/** True when the action makes the user safer (so it stays allowed when the daily loss cap or a pause is active). */
export const reducesRisk = (c: Candidate): boolean => c.kind === 'top_up' || (c.kind === 'hedge' && ((c.hedge?.deltaToShort ?? 0) > 0 || !!c.hedge?.option || !!c.hedge?.removesNetShort));

/** What mode the agent really runs in right now. Autonomy lapses at its expiry and when the daily loss cap is hit. */
export function effectiveMode(s: Snapshot, now = new Date()): { mode: 'confirm' | 'autonomous'; note: string | null } {
  if (s.config.mode !== 'autonomous') return { mode: 'confirm', note: null };
  const exp = s.config.limits.autonomyExpiresAt;
  if (exp && Date.parse(exp) <= now.getTime()) return { mode: 'confirm', note: 'Autonomy expired, so the agent asks first. Switch autonomous mode on again to renew it.' };
  const t = s.today;
  if (t && s.config.limits.dailyLossCapUsd > 0 && t.lossUsd >= s.config.limits.dailyLossCapUsd) return { mode: 'confirm', note: `Daily loss cap hit, autonomy suspended: lost ${usd(t.lossUsd)} today against your ${usd(s.config.limits.dailyLossCapUsd)} cap. The agent asks first, and only risk-reducing actions are allowed.` };
  try {
    const win = config().ANOMALY_WINDOW_SEC * 1000;
    if (store.anomalyCount(s.wallet, s.network, 'injection', win, now.getTime()) >= INJECTION_PAUSE) return { mode: 'confirm', note: `Autonomy suspended: ${INJECTION_PAUSE} or more instructions hidden in news text were seen in the last ${Math.round(config().ANOMALY_WINDOW_SEC / 60)} minutes. Review your news sources; the agent asks first until then.` };
  } catch { /* no store open (a unit test): nothing to count */ }
  return { mode: 'autonomous', note: null };
}

export function policyCheck(c: Candidate, s: Snapshot, now = new Date()): PolicyVerdict {
  const lim = s.config.limits; const t = s.today;
  if (lim.killSwitch) return { block: 'kill switch is on: no new orders or transfers', confirm: null };
  if (t?.pausedReason) return { block: `agent is paused: ${t.pausedReason}`, confirm: null };
  let confirm: string | null = null;
  const lossHit = !!t && lim.dailyLossCapUsd > 0 && t.lossUsd >= lim.dailyLossCapUsd;
  if (lossHit && !reducesRisk(c)) return { block: `daily loss cap of ${usd(lim.dailyLossCapUsd)} reached: only risk-reducing actions are allowed`, confirm: null };

  if (c.kind === 'hedge') {
    const h = c.hedge!; const cfg = s.config;
    if (h.ticker && cfg.risk.excludeTickers.includes(h.ticker)) return { block: `${h.ticker} is on your do-not-hedge list`, confirm: null };
    // A trade you asked for in the chat and approved is its own allowlist entry; the caps below still apply.
    if (!c.chat && !legInConfig(cfg.hedge.legs, h)) return { block: `market ${h.market} is not on your allowlist`, confirm: null };
    const n = c.notionalUsd ?? 0; const biggest = c.plan?.orders?.length ? Math.max(...c.plan.orders) : n;   // a hedge split into orders is checked order by order
    // Over the cap, an agent decision in Auto mode asks first; a chat trade the user already approved is refused outright (next line).
    if (n > lim.maxNotionalPerTradeUsd + 1e-6 && !h.removesNetShort && !c.chat && effectiveMode(s, now).mode === 'autonomous') return { block: null, confirm: `this decision trades ${usd(n)} in total, above your per-trade cap of ${usd(lim.maxNotionalPerTradeUsd)}, and the agent never goes over that cap on its own` };
    if (biggest > lim.maxNotionalPerTradeUsd + 1e-6) return { block: `trade of ${usd(n)} is above your max notional per trade (${usd(lim.maxNotionalPerTradeUsd)})`, confirm: null };
    const day = t?.notionalUsd ?? 0;
    if (day + n > lim.maxNotionalPerDayUsd) return { block: `would take today's hedge notional to ${usd(day + n)}, above your daily max (${usd(lim.maxNotionalPerDayUsd)})`, confirm: null };
    if (c.plan?.leverage && c.plan.leverage > lim.maxLeverage + 1e-9) return { block: `leverage ${c.plan.leverage}x is above your cap of ${lim.maxLeverage}x`, confirm: null };
    if (c.chat && h.leverage && h.leverage > lim.maxLeverage + 1e-9) return { block: `leverage ${h.leverage}x is above your max leverage of ${lim.maxLeverage}x (raise it under Limits on the Risk page)`, confirm: null };
    const mp = c.plan?.marginPlan;
    if (mp && parkedOffBnb(s) + mp.moveUsd > lim.maxCapitalOffBnbUsd) return { block: `moving ${usd(mp.moveUsd)} would put ${usd(parkedOffBnb(s) + mp.moveUsd)} off BNB, above your cap (${usd(lim.maxCapitalOffBnbUsd)})`, confirm: null };
    const conflict = h.ticker ? s.eventConflicts?.[h.ticker] : undefined;
    if (conflict) confirm = `the event calendar and the news disagree (${conflict})`;
    if (h.deltaToShort < 0 && !h.removesNetShort) confirm = 'it reduces your protection (the agent never trims a hedge without asking)';
    if (c.plan && c.plan.cost.feesUsd + c.plan.cost.premiumUsd + c.plan.cost.fundingEstUsd > c.plan.cost.weeklyBudgetUsd) confirm = `cost ${usd(c.plan.cost.feesUsd + c.plan.cost.premiumUsd + c.plan.cost.fundingEstUsd)} is over your weekly protection budget (${usd(c.plan.cost.weeklyBudgetUsd)})`;
  } else if (c.kind === 'top_up') {
    const amt = Number(BigInt(c.amountBaseUnit)) / 1e6;
    if (parkedOffBnb(s) + amt > lim.maxCapitalOffBnbUsd) return { block: `adding ${usd(amt)} would put ${usd(parkedOffBnb(s) + amt)} off BNB, above your cap (${usd(lim.maxCapitalOffBnbUsd)})`, confirm: null };
  }
  return { block: null, confirm };
}

/** Count an intent or a refusal. Too many inside the window pauses the agent (anomaly stop). Returns the pause reason when it trips. */
export function noteAnomaly(wallet: string, network: string, kind: 'intent' | 'refused' | 'injection', now = Date.now()): string | null {
  const c = config(); store.recordAnomaly(wallet, network, kind, now);
  const win = c.ANOMALY_WINDOW_SEC * 1000;
  const n = store.anomalyCount(wallet, network, kind, win, now);
  const max = kind === 'intent' ? c.ANOMALY_MAX_INTENTS : kind === 'injection' ? 3 : c.ANOMALY_MAX_REFUSALS;
  if (n < max) return null;
  if (kind === 'injection') return n >= max ? `${n} suspected prompt-injection attempts in ${Math.round(c.ANOMALY_WINDOW_SEC / 60)} minutes: autonomy suspended, review the news sources` : null;
  const reason = kind === 'intent' ? `${n} intents in ${Math.round(c.ANOMALY_WINDOW_SEC / 60)} minutes looks unusual` : `${n} refusals in ${Math.round(c.ANOMALY_WINDOW_SEC / 60)} minutes looks like limit probing`;
  store.pauseAgent(wallet, network, reason, now + c.PAUSE_MIN * 60_000);
  return reason;
}
