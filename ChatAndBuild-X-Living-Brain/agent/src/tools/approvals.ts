import { createHash } from 'node:crypto';
import { config } from '../config';
import type { Candidate, Snapshot } from '../types';
import type { ActionPost } from './appApi';
import { describeSteps } from './executor';
import { legKeyOf } from './hedgeLeg';
import { payoffForChoice } from '../risk/payoff';
import { alternativesFor } from '../risk/alternatives';

// Builds the confirmation-mode request: WHAT the agent wants to do, WHY, what it HELPS, and the exact steps it
// will run if the user approves. Plain code (no LLM): the LLM's own reasoning is appended to "why".

const usd = (b: string) => `$${(Number(BigInt(b)) / 1e6).toFixed(2)}`;
const pct = (bps: number | null | undefined) => (bps === null || bps === undefined ? '?' : `${Math.round(bps / 100)}%`);

/** One open request per slot, so a newer ask replaces an older one for the same thing. */
export const slotOf = (c: Candidate) => (c.kind === 'hedge' ? `hedge:${c.hedge!.key ?? c.hedge!.market}` : `${c.kind}:${c.ruleKey}`);

export function titleOf(c: Candidate): string {
  if (c.kind === 'top_up') return `Add ${usd(c.amountBaseUnit)} to your ${c.venue === 'derive' ? 'options' : 'perps'} margin`;
  if (c.kind === 'release') return `Withdraw ${usd(c.amountBaseUnit)} of idle margin from ${c.venue === 'derive' ? 'options' : 'perps'}`;
  const o = c.hedge!.option; const roll = c.hedge!.derive?.roll;
  if (o) return `${roll ? 'Roll' : 'Buy'} ${o.contracts} ${c.hedge!.market} put${o.contracts === 1 ? '' : 's'} (strike ${o.strike}) on Derive to protect ${c.hedge!.bstock}`.slice(0, 160);
  const d = c.hedge!.deltaToShort;
  const w = c.plan ? ` ($${c.plan.sizeUsd})` : '';
  const where = c.hedge!.venue === 'derive' ? 'Derive' : 'perps';
  return d > 0 ? `Sell ${Math.abs(d)} ${c.hedge!.market} short on ${where}${w} to hedge ${c.hedge!.bstock}` : `Buy back ${Math.abs(d)} ${c.hedge!.market} short on ${where}${w} (reduce hedge)`;
}

export function helpsOf(c: Candidate, s: Snapshot): string {
  if (c.kind === 'top_up') {
    const h = c.ruleKey ? s.health[c.ruleKey] : undefined;
    return `Moves your account away from liquidation: utilization falls from ${pct(h?.utilBps)} to about ${pct(c.after?.utilBps)}. Your open positions stay as they are.`;
  }
  if (c.kind === 'release') return `Frees margin that is sitting idle. Utilization rises to about ${pct(c.after?.utilBps)}, still below your top-up trigger, and the money returns to your own Ethereum address.`;
  const h = c.hedge!;
  const p = c.plan;
  if (h.option && p) return `Caps your loss on ${h.bstock} through the event: you lose at most about $${(p.cost.premiumUsd + p.cost.feesUsd).toFixed(2)} (the premium) and keep the upside. Modelled worst case (99% loss) goes from ${p.varBeforePct}% to ${p.varAfterPct}% of your portfolio against your ${p.limitPct}% limit.`;
  if (h.removesNetShort) return `Removes the part of your short that is bigger than your holding: you are net short, which loses money if the stock rises.${p ? ` Modelled worst case goes from ${p.varBeforePct}% to ${p.varAfterPct}%.` : ''}`;
  if (h.proxyFor) return `${h.proxyFor} has no hedge market of its own, so this short on ${h.market} offsets part of its moves. It is a proxy: some of the risk stays (see Residual risk).${p ? ` Modelled worst case goes from ${p.varBeforePct}% to ${p.varAfterPct}% against your ${p.limitPct}% limit.` : ''}`;
  const effect = p ? ` Modelled worst case (99% loss) goes from ${p.varBeforePct}% to ${p.varAfterPct}% of your portfolio against your ${p.limitPct}% limit.` : '';
  return `Keeps your ${h.bstock} holding protected from price drops: a loss on the stock is offset by a gain on the short.${effect}`;
}

const cut = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}\u2026`);
/** Fit every text field of a hedge plan to the app's limits, so a long note shortens instead of the whole card being refused. */
export function clampPlan(p: NonNullable<Candidate['plan']>): NonNullable<Candidate['plan']> {
  return { ...p, instrument: cut(p.instrument, 80), ticker: cut(p.ticker, 12), worstCase: cut(p.worstCase, 600), residual: cut(p.residual, 600),
    assumptions: p.assumptions.slice(0, 10).map((x) => cut(x, 300)), invalidatedBy: p.invalidatedBy.slice(0, 10).map((x) => cut(x, 300)),
    ...(p.bindingConstraint ? { bindingConstraint: cut(p.bindingConstraint, 300) } : {}), ...(p.options ? { options: p.options.slice(0, 6).map((x) => cut(x, 300)) } : {}),
    ...(p.concentration ? { concentration: cut(p.concentration, 300) } : {}), tickers: p.tickers.slice(0, 30), ...(p.orders ? { orders: p.orders.slice(0, 12) } : {}) };
}

export function buildActionRequest(s: Snapshot, c: Candidate, deciderReason: string | undefined, now = Date.now()): ActionPost {
  const slot = slotOf(c);
  const bucket = Math.floor(now / (config().ACTION_BUCKET_SEC * 1000));
  const key = `act-${createHash('sha256').update(`${s.wallet.toLowerCase()}|${s.network}|${slot}|${c.kind}|${bucket}`).digest('hex').slice(0, 24)}`;
  const note = c.hedge?.option ? ' Note: Derive order placement is not connected yet, so approving runs a dry run only.' : '';
  const why = ([c.reason, deciderReason].filter(Boolean).join('. ') + note).slice(0, 800);
  return {
    wallet: s.wallet, network: s.network, kind: c.kind, venue: c.venue, origin: 'rule', slot,
    title: titleOf(c).slice(0, 160), why, helps: helpsOf(c, s).slice(0, 500),
    willDo: describeSteps(s, c).map((x) => x.slice(0, 300)).slice(0, 8),
    detail: { candidateId: c.id, kind: c.kind, ruleKey: c.ruleKey ?? null, amountBaseUnit: c.amountBaseUnit, hedgeMarket: c.hedge?.market ?? null, hedgeKey: c.hedge ? legKeyOf(c.hedge) : null, hedgeDelta: c.hedge?.deltaToShort ?? null, optionContracts: c.hedge?.option?.contracts ?? null },
    ...(c.plan ? { plan: clampPlan(c.plan) } : {}),
    // Every hedge request carries its payoff (before/after) and the venues considered with why each was or was not used.
    ...(c.kind === 'hedge' ? (() => { const po = payoffForChoice(s, c); const alts = alternativesFor(s, c); return { ...(po ? { payoff: po } : {}), ...(alts.length ? { alternatives: alts } : {}) }; })() : {}),
    idempotencyKey: key,
  };
}
