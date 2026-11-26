import { createHash } from 'node:crypto';
import { config } from '../config';
import { log } from '../log';
import { AnalystOut, DeciderOut, ReporterOut, ReviewerOut } from '../llm/schemas';
import { runLlm } from '../llm/run';
import * as app from '../tools/appApi';
import { execute } from '../tools/executor';
import { checkCandidate, filterCandidates, lockKey } from '../tools/guard';
import { buildCandidates } from '../tools/planner';
import { buildActionRequest, slotOf } from '../tools/approvals';
import { calendarNewsConflicts, computeNews, quarantinedSources } from '../news';
import { effectiveMode, noteAnomaly, policyCheck } from '../policy';
import * as store from '../tools/store';
import type { Candidate, CandidateFacts, Snapshot } from '../types';
import type { RiskView } from '../risk/plan';
import type { AgentStateT, Outcome } from './state';

// One function per graph node. Code nodes are deterministic; LLM nodes (analyst, decider, reviewer, reporter)
// can only narrow what code produced. Any LLM failure fails closed (nothing runs).

const llmOn = () => config().LLM_MODE === 'on';
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const usd = (b: string) => `$${(Number(BigInt(b)) / 1e6).toFixed(2)}`;
// Hedge candidates have no money amount, so it is left out: a '0' there made the LLM think the action does nothing.
const slim = (c: Candidate) => ({ id: c.id, kind: c.kind, venue: c.venue, ruleKey: c.ruleKey, ...(c.kind === 'hedge' ? {} : { amountBaseUnit: c.amountBaseUnit }), whatItDoes: c.explain, reason: c.reason, funding: c.funding, after: c.after, hedge: c.hedge, facts: c.facts, urgency: c.urgency, ...(c.plan ? { plan: { sizeUsd: c.plan.sizeUsd, window: c.plan.window, varBeforePct: c.plan.varBeforePct, varAfterPct: c.plan.varAfterPct, limitPct: c.plan.limitPct, requiredHedgePct: c.plan.requiredHedgePct, leverage: c.plan.leverage, cost: c.plan.cost, marginPlan: c.plan.marginPlan } } : {}) });
const newsView = (s: AgentStateT) => s.news.filter((n) => n.flagged).map((n) => ({ ticker: n.ticker, sentiment: n.sentiment, score: n.score, confidence: n.confidence, reason: n.reason, advisoryOnly: true, headlines: n.headlines.slice(0, 5).map((h) => h.title) }));
/** Hard checks in code. These are passed to the LLM nodes as facts and used to catch any claim they contradict. */
export function factsFor(c: Candidate, sn: Snapshot): CandidateFacts {
  const p = c.plan; const lim = sn.config.limits; const missing = [...sn.dataQuality, ...(sn.hedgeProblems ?? [])];
  const costUsd = p ? p.cost.feesUsd + p.cost.premiumUsd + p.cost.fundingEstUsd : 0;
  const n = c.notionalUsd ?? 0; const dayLeft = Math.max(0, lim.maxNotionalPerDayUsd - (sn.today?.notionalUsd ?? 0));
  return {
    budget: p ? { costUsd: Math.round(costUsd * 100) / 100, weeklyBudgetUsd: p.cost.weeklyBudgetUsd, within: costUsd <= p.cost.weeklyBudgetUsd + 1e-9 } : null,
    caps: c.kind === 'hedge' ? { notionalUsd: n, perTradeCapUsd: lim.maxNotionalPerTradeUsd, dayLeftUsd: dayLeft, withinPerTrade: n <= lim.maxNotionalPerTradeUsd + 1e-9, withinDay: n <= dayLeft + 1e-9 } : null,
    margin: p?.marginPlan ? { moveUsd: p.marginPlan.moveUsd, from: p.marginPlan.from, sufficient: sn.bsc.usdcUsd >= p.marginPlan.moveUsd } : p ? { moveUsd: 0, from: null, sufficient: true } : null,
    limit: p ? { limitPct: p.limitPct, varBeforePct: p.varBeforePct, varAfterPct: p.varAfterPct, met: p.varAfterPct <= p.limitPct + 0.05 } : null,
    data: { complete: missing.length === 0, missing },
    calendarNewsConflict: c.hedge?.ticker ? sn.eventConflicts?.[c.hedge.ticker] ?? null : null,
    bindingConstraints: c.binding ?? [],
  };
}

/** Replace any sentence that contradicts the code-computed facts. Returns the text and whether it was changed. */
export function checkClaims(text: string, f: CandidateFacts): { text: string; fixed: boolean } {
  const bad: string[] = [];
  if (f.budget && !f.budget.within && /(within|under|inside|below|fits?)\b[^.]{0,30}\b(weekly )?(protection |premium )?budget/i.test(text)) bad.push(`The cost of $${f.budget.costUsd} is over your weekly budget of $${f.budget.weeklyBudgetUsd}.`);
  if (f.limit && !f.limit.met && /(below|within|inside|under|meets?|reach(es|ed)?|satisf\w+|respects?)\b[^.]{0,30}\b(your )?[\d.]*%?\s*(loss )?(limit|tolerance)/i.test(text)) bad.push(`The modelled worst case after this action is ${f.limit.varAfterPct}%, still above your ${f.limit.limitPct}% limit.`);
  if (f.caps && !(f.caps.withinPerTrade && f.caps.withinDay) && /within your (notional|trade|daily)/i.test(text)) bad.push('The size is over one of your notional limits.');
  // Blaming the budget (or a cap) for the size when the computed binding constraint is something else.
  const bind = f.bindingConstraints ?? [];
  const blamed = text.split(/(?<=[.!?])\s+/).filter((sent) => /(because|due to|limited by|sized to|fit(s|ting)?|trimmed)\b/i.test(sent) && /budget/i.test(sent) && f.budget?.within && bind.length && !bind.some((b) => /budget/i.test(b)));
  if (blamed.length) { const kept2 = text.split(/(?<=[.!?])\s+/).filter((sent) => !blamed.includes(sent)); return { text: [...kept2, `The size is limited by ${bind.join(' and ')}, not by your budget.`].join(' '), fixed: true }; }
  if (!bad.length) return { text, fixed: false };
  const kept = text.split(/(?<=[.!?])\s+/).filter((sent) => !/(within|under|inside|below|fits?|meets?|reach|satisf|respects?)/i.test(sent) || !/(budget|limit|tolerance|notional)/i.test(sent));
  return { text: [...kept, ...bad].join(' '), fixed: true };
}
const snapView = (s: AgentStateT['snapshot']) => ({ ...s, config: { ...s.config } });

// ── validate (code) ─────────────────────────────────────────────────────────
export function validate(s: AgentStateT): Partial<AgentStateT> {
  if (s.snapshot.dataQuality.length) return { outcome: 'error', note: `data problem: ${s.snapshot.dataQuality.join('; ')}` };
  return {};
}

// ── plan (code) ─────────────────────────────────────────────────────────────
const refusalSeen = new Set<string>();
const money = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;

/**
 * When the user's loss limit is not met (or a hedge is blocked) the user gets a WARNING with four things: the modelled loss
 * now, the limit, the one constraint that bound, and what they can do. The kill switch and a pause also say what is
 * unhedged and which plan was blocked.
 */
export function limitWarning(sn: Snapshot, risk: RiskView | null, ok: Candidate[], all: Candidate[], blocked: { reason: string }[], rejected: { reason: string; severity?: string }[]): string | null {
  if (!risk) return null;
  const unhedged = risk.portfolioUsd * (1 - risk.hedgedPct / 100);
  const stop = blocked.find((b) => /^kill switch|^agent is paused/.test(b.reason));
  if (stop) {
    const plan = all[0]?.explain ?? `a hedge sized to your ${risk.limitPct}% limit`;
    return `${stop.reason.charAt(0).toUpperCase()}${stop.reason.slice(1)}. Nothing was done. Unhedged exposure: ${money(unhedged)} of ${money(risk.portfolioUsd)} (${Math.round(100 - risk.hedgedPct)}%); modelled loss ${risk.solution.varNow * 100 >= 10 ? Math.round(risk.solution.varNow * 100) : Math.round(risk.solution.varNow * 10_000) / 100}% against your ${risk.limitPct}% limit. Blocked plan: ${plan}`;
  }
  const now = risk.solution.varNow * 100; if (now <= risk.limitPct + 0.05) return null;
  const best = ok[0] ?? all[0]; const after = best?.plan?.varAfterAllPct ?? best?.plan?.varAfterPct;
  if (best && after !== undefined && after <= risk.limitPct + 0.05) return null;       // the proposed hedge meets the limit
  const gapToLimit = after !== undefined ? after - risk.limitPct : 0;
  const bound = best?.plan?.bindingConstraint || (best && gapToLimit > 0 && gapToLimit < 0.25 ? `rounding to whole lots: the plan lands ${gapToLimit.toFixed(2)} points above the limit` : '') || blocked[0]?.reason || rejected.find((r) => r.severity === 'error')?.reason || 'no hedge is available that fits your limits';
  const lead = best ? `The best plan that fits leaves the modelled loss at ${after}%.` : 'No hedge could be proposed.';
  return `Your ${risk.limitPct}% loss limit is not met. Modelled loss now: ${Math.round(now * 100) / 100}%. ${lead} What bound: ${bound}. You can raise the cap or budget that bound, or accept a higher loss${after !== undefined ? ` (about ${after}%)` : ''}.${risk.concentration ? ` Note: ${risk.concentration}` : ''}`;
}
export async function plan(s: AgentStateT): Promise<Partial<AgentStateT>> {
  const now = new Date(); const sn = s.snapshot;
  const p = buildCandidates(sn, now);
  const f = filterCandidates(p.candidates, sn, now);
  // Keep each rule's release-dwell clock current in the app (best effort; never blocks the tick).
  for (const patch of p.statePatches) {
    app.postRuleState({ wallet: sn.wallet, network: sn.network, ruleKey: patch.ruleKey, releaseBelowSince: patch.releaseBelowSince }).catch((e) => log.warn(`rule-state patch failed: ${errText(e)}`));
  }
  // Audit: every refusal by the guard or the user's limits is logged once per hour. Repeated NEW refusals count toward the anomaly stop.
  for (const r of [...p.rejected.filter((x) => x.severity === 'error'), ...f.rejected]) {
    const k = createHash('sha256').update(`${sn.wallet}|${r.kind}|${r.ruleKey ?? ''}|${r.reason}|${Math.floor(now.getTime() / 3_600_000)}`).digest('hex').slice(0, 20);
    if (refusalSeen.has(k)) continue; refusalSeen.add(k);
    app.postEvent({ wallet: sn.wallet, network: sn.network, kind: r.severity === 'error' ? 'error' : 'info', ...(r.severity === 'error' ? { status: 'failed' as const } : {}), message: `${r.severity === 'error' ? 'Not done' : 'Blocked'}: ${r.kind.replace('_', ' ')}. ${r.reason}`.slice(0, 500), payload: { audit: 'refused', kind: r.kind, ruleKey: r.ruleKey ?? null }, idempotencyKey: `deny-${k}` }).catch((e) => log.warn(`audit post failed: ${errText(e)}`));
    if (!/^kill switch|^agent is paused/.test(r.reason)) noteAnomaly(sn.wallet, sn.network, 'refused', now.getTime());
  }
  // Something already waiting for the user's answer is not planned again: no LLM calls are spent re-asking every tick.
  let ok = f.ok;
  if (ok.length) {
    try {
      const pending = await app.listActions(sn.wallet, sn.network, 'pending');
      if (pending.length) { const slots = new Set(pending.map((a) => a.slot)); ok = ok.filter((c) => !slots.has(slotOf(c))); }
    } catch { /* the inbox is checked again at the confirm step; planning goes on */ }
  }
  for (const c of ok) c.facts = factsFor(c, sn);
  {
    const text = limitWarning(sn, p.risk, ok, p.candidates, f.rejected, p.rejected);
    if (text) {
      const wk = createHash('sha256').update(`${sn.wallet}|limitwarn|${text.slice(0, 120)}|${Math.floor(now.getTime() / 3_600_000)}`).digest('hex').slice(0, 20);
      app.postEvent({ wallet: sn.wallet, network: sn.network, kind: 'warning', message: text.slice(0, 500), payload: { audit: 'limit_not_met', severity: 'warning', details: { technical: text } }, idempotencyKey: `warn-${wk}` }).catch((e) => log.warn(`warning post failed: ${errText(e)}`));
    }
  }
  log.debug('plan', { candidates: ok.map((c) => c.id), rejected: [...p.rejected, ...f.rejected] });
  return { candidates: ok, rejected: [...p.rejected, ...f.rejected], statePatches: p.statePatches, risk: p.risk };
}

// ── news (code + LLM) ───────────────────────────────────────────────────────
// ADVISORY ONLY. Reads headlines for the stocks the user holds and raises a flag when the signal is strong. A flag is
// shown in the app and given to the LLM nodes as context. It never changes a position, a hedge size or a limit.
const newsLast = new Map<string, string>();
export async function news(s: AgentStateT): Promise<Partial<AgentStateT>> {
  const sn = s.snapshot;
  try {
    const views = await computeNews(sn);
    // Suspected prompt injection: the item was removed before scoring and its source is ignored from now on.
    // The warning never repeats the attacker's text (it could carry an address a user might copy).
    for (const v of views) for (const sus of v.suspects) {
      const k = createHash('sha256').update(`${sn.wallet}|inj|${sus.source}|${Math.floor(Date.now() / 3_600_000)}`).digest('hex').slice(0, 20);
      app.postEvent({ wallet: sn.wallet, network: sn.network, kind: 'warning', message: `Warning: suspected prompt injection in a ${v.ticker} news item from "${sus.source}"${sus.count > 1 ? ` (it arrived ${sus.count} times)` : ''}. The item was removed and that source is now ignored. Nothing was acted on.`.slice(0, 500), payload: { audit: 'injection', severity: 'warning', ticker: v.ticker, source: sus.source, count: sus.count, quarantined: quarantinedSources() }, idempotencyKey: `inj-${k}` }).catch((e) => log.warn(`injection event post failed: ${errText(e)}`));
      for (let i = 0; i < sus.count; i++) { const p = noteAnomaly(sn.wallet, sn.network, 'injection'); if (p && i === sus.count - 1) log.warn(`autonomy suspended: ${p}`); }
    }
    for (const v of views) for (const r of v.rumours) {
      const k = createHash('sha256').update(`${sn.wallet}|rum|${r.source}|${r.title}|${Math.floor(Date.now() / 3_600_000)}`).digest('hex').slice(0, 20);
      app.postEvent({ wallet: sn.wallet, network: sn.network, kind: 'news', message: `Unverified rumour about ${v.ticker} from "${r.source}": "${r.title}". Advisory only: it is not confirmed by a known outlet and nothing was done. Check a trusted source before acting.`.slice(0, 500), payload: { audit: 'rumour', ticker: v.ticker, source: r.source, verified: false }, idempotencyKey: `rum-${k}` }).catch((e) => log.warn(`rumour event post failed: ${errText(e)}`));
    }
    // Calendar vs news: a conflict downgrades the affected hedge to an alert plus a question (never autonomous).
    const conflicts = calendarNewsConflicts(sn.config.events, views);
    sn.eventConflicts = conflicts;
    for (const [tk, why] of Object.entries(conflicts)) {
      const k = createHash('sha256').update(`${sn.wallet}|cal|${tk}|${Math.floor(Date.now() / 3_600_000)}`).digest('hex').slice(0, 20);
      app.postEvent({ wallet: sn.wallet, network: sn.network, kind: 'warning', message: `Alert ${tk}: ${why}.`.slice(0, 500), payload: { audit: 'calendar_news_conflict', ticker: tk }, idempotencyKey: `cal-${k}` }).catch((e) => log.warn(`conflict event post failed: ${errText(e)}`));
    }
    for (const n of views) {
      if (!n.flagged) continue;
      // One flag per stock, hour and verdict (not every 30 s).
      const sig = n.sentiment; const k = `${sn.wallet}:${n.ticker}`;
      if (newsLast.get(k) === sig) continue; newsLast.set(k, sig);
      const head = n.keyHeadlines[0] ?? n.headlines[0]?.title;
      await app.postEvent({
        wallet: sn.wallet, network: sn.network, kind: 'news',
        message: `News flag ${n.ticker}: ${n.sentiment} (score ${n.score}, confidence ${n.confidence}). ${n.reason}${head ? ` Headline: "${head}"` : ''} Advisory only: no position was changed. Review your ${n.ticker} hedge if you wish.`.slice(0, 500),
        payload: { audit: 'news_flag', ticker: n.ticker, sentiment: n.sentiment, score: n.score, confidence: n.confidence, headlines: n.headlines.slice(0, 5), by: n.by },
        idempotencyKey: `news-${createHash('sha256').update(`${sn.wallet}|${n.ticker}|${sig}|${Math.floor(Date.now() / 3_600_000)}`).digest('hex').slice(0, 20)}`,
      }).catch((e) => log.warn(`news event post failed: ${errText(e)}`));
    }
    return { news: views, newsAt: views.length ? new Date().toISOString() : null };
  } catch (e) { log.warn(`news step failed, no flags this tick: ${errText(e)}`); return { news: [], newsAt: null }; }
}

// ── confirm (code) ──────────────────────────────────────────────────────────
// The mode gate. Autonomous only when the user's authority is current and no limit forces a human decision;
// otherwise ask the user. Autonomous mode passes straight through to the guard.
export async function confirm(s: AgentStateT): Promise<Partial<AgentStateT>> {
  const sn = s.snapshot; const c = s.chosen!;
  const pol = policyCheck(c, sn); const em = effectiveMode(sn);
  if (em.mode === 'autonomous' && !pol.confirm) return {};
  const why = checkCandidate(c, sn);
  if (why) return { outcome: 'skipped', note: `guard refused: ${why}` };
  try {
    const extra = [pol.confirm ? `Asking first because ${pol.confirm}.` : null, em.note, s.review?.verdict === 'veto' ? `A second reviewer flagged: ${s.review.reason}` : null].filter(Boolean).join(' ');
    const req = buildActionRequest(sn, c, [s.decision?.reason, extra].filter(Boolean).join(' '));
    const open = await app.listActions(sn.wallet, sn.network, 'pending');
    if (open.some((a) => a.slot === req.slot)) return { outcome: 'awaiting', note: 'already waiting for your approval' };
    const r = await app.postAction(req);
    if (r.status === 'pending') { if (!r.duplicate) { const p = noteAnomaly(sn.wallet, sn.network, 'intent'); if (p) log.warn(`anomaly stop: ${p}`); } return { outcome: 'awaiting', note: `asked for your approval: ${req.title}` }; }
    if (r.status === 'approved') return { outcome: 'awaiting', note: 'approved, will run on the next check' };
    return { outcome: 'skipped', note: `you already answered this request (${r.status}); will ask again later if still needed` };
  } catch (e) { log.warn(`approval request refused: ${errText(e)}`); return { outcome: 'error', note: 'the approval request could not be shown to you, so nothing was done. The agent will try again on the next check', detail: errText(e) }; }
}

// ── analyst, decider, reviewer (LLM, ADVISORY ONLY) ─────────────────────────
// The trade to place comes from the rule engine (planRule / planFunding / planHedge) and the hard checks in code.
// The model explains it. It never picks, resizes, skips or vetoes: two runs on the same inputs give the same action,
// and a model outage or an over-cautious answer cannot block a correct move.
export async function analyst(s: AgentStateT): Promise<Partial<AgentStateT>> {
  if (!llmOn()) return { analysis: { dataLooksSane: true, concerns: [], summary: 'LLM off: rule engine only.' } };
  try {
    const a = await runLlm('analyst', AnalystOut, { snapshot: snapView(s.snapshot), candidates: s.candidates.map(slim), rejected: s.rejected, news: newsView(s) });
    return { analysis: { ...a, dataLooksSane: true } };   // data validity is checked by code (validate), not by the model
  } catch (e) { return { analysis: { dataLooksSane: true, concerns: [], summary: `Analyst note unavailable (${errText(e)}). The action does not depend on it.` } }; }
}

export async function decider(s: AgentStateT): Promise<Partial<AgentStateT>> {
  const top = s.candidates[0];   // already sorted by urgency by the planner
  const fallback = `Highest-priority action: ${top.reason}.`;
  if (!llmOn()) return { decision: { action: 'execute', candidateId: top.id, reason: fallback }, chosen: top };
  try {
    const d = await runLlm('decider', DeciderOut, { chosen: slim(top), otherCandidates: s.candidates.slice(1).map(slim), analysis: s.analysis, snapshot: snapView(s.snapshot), news: newsView(s) });
    const chk = top.facts ? checkClaims(d.reason, top.facts) : { text: d.reason, fixed: false };
    return { decision: { action: 'execute', candidateId: top.id, reason: chk.text }, chosen: top };
  } catch (e) { return { decision: { action: 'execute', candidateId: top.id, reason: `${fallback} (explanation unavailable: ${errText(e)})` }, chosen: top }; }
}

export async function reviewer(s: AgentStateT): Promise<Partial<AgentStateT>> {
  if (!llmOn()) return { review: { verdict: 'approve', reason: 'LLM off.' } };
  try {
    const r = await runLlm('reviewer', ReviewerOut, { chosen: slim(s.chosen!), deciderReason: s.decision?.reason, snapshot: snapView(s.snapshot), analysis: s.analysis, news: newsView(s) });
    const chk = s.chosen!.facts ? checkClaims(r.reason, s.chosen!.facts) : { text: r.reason, fixed: false };
    return { review: { ...r, reason: chk.text } };   // a second opinion for the user to read; it never blocks the action
  } catch (e) { return { review: { verdict: 'approve', reason: `Second opinion unavailable (${errText(e)}). The action does not depend on it.` } }; }
}

// ── guard (code) ────────────────────────────────────────────────────────────
export function guard(s: AgentStateT): Partial<AgentStateT> {
  const c = s.chosen!;
  const why = checkCandidate(c, s.snapshot);
  if (why) return { outcome: 'skipped', note: `guard refused: ${why}` };
  const paused = noteAnomaly(s.snapshot.wallet, s.snapshot.network, 'intent');
  if (paused) return { outcome: 'skipped', note: `agent paused itself: ${paused}` };
  if (!store.acquireLock(lockKey(s.snapshot, c))) return { outcome: 'skipped', note: 'guard refused: a move for this rule is already in flight' };
  return {};
}

// ── execute (code) ──────────────────────────────────────────────────────────
export async function executeNode(s: AgentStateT): Promise<Partial<AgentStateT>> {
  const c = s.chosen!; const sn = s.snapshot;
  const ev = (status: 'pending' | 'done' | 'failed', message: string, key: string) => app.postEvent({
    wallet: sn.wallet, network: sn.network, kind: c.kind === 'hedge' ? 'hedge' : 'rebalance', venue: c.venue, status, message,
    payload: { direction: c.kind === 'release' ? 'out' : 'in', amountUsd: Number(BigInt(c.amountBaseUnit)) / 1e6, ruleKey: c.ruleKey, dryRun: !config().live }, idempotencyKey: key,
  }).catch((e) => log.warn(`event post failed: ${errText(e)}`));
  try {
    if (config().live) await ev('pending', `Starting: ${c.reason}`, `${c.idempotencyKey}:p`);
    const steps = await execute(sn, c);
    const failed = steps.some((x) => x.status === 'failed');
    const outcome: Outcome = failed ? 'failed' : config().live ? 'done' : 'simulated';
    if (outcome === 'done' && c.ruleKey) store.logMove(sn.wallet, sn.network, c.ruleKey, c.kind === 'release' ? 'out' : 'in', c.amountBaseUnit);
    return { steps, outcome };
  } catch (e) {
    return { steps: [{ step: 'execute', status: 'failed', detail: errText(e) }], outcome: 'failed' };
  } finally {
    store.releaseLock(lockKey(sn, c));
  }
}

// ── report (code + reporter LLM) ────────────────────────────────────────────
function template(s: AgentStateT): string {
  const c = s.chosen; const amt = c && c.kind !== 'hedge' ? usd(c.amountBaseUnit) : '';
  const what = !c ? '' : c.kind === 'hedge' ? `hedge on ${c.hedge!.market}` : `${c.kind === 'top_up' ? 'top-up' : 'release'} of ${amt} on ${c.venue}`;
  switch (s.outcome) {
    case 'done': return `Done: ${what}. ${c?.reason ?? ''}`.slice(0, 300);
    case 'simulated': return `Dry run: would do ${what}. Nothing was moved. ${c?.reason ?? ''}`.slice(0, 300);
    case 'failed': return `Could not finish ${what}: ${s.steps.find((x) => x.status === 'failed')?.detail ?? 'unknown error'}. Nothing further was moved.`.slice(0, 300);
    case 'awaiting': return `Waiting for your approval: ${what}. ${s.note}`.slice(0, 300);
    case 'vetoed': return `Stopped ${what} after a safety review: ${s.note}`.slice(0, 300);
    case 'error': return `Agent paused this check: ${s.note}`.slice(0, 300);
    default: return `Skipped: ${s.note}`.slice(0, 300);
  }
}

export async function report(s: AgentStateT): Promise<Partial<AgentStateT>> {
  let message = template(s);
  if (llmOn() && ['done', 'failed', 'simulated', 'vetoed'].includes(s.outcome)) {
    try {
      const amountUsd = s.chosen ? Number(BigInt(s.chosen.amountBaseUnit)) / 1e6 : undefined;
      const rep = (await runLlm('reporter', ReporterOut, { outcome: s.outcome, candidate: s.chosen ? { ...slim(s.chosen), amountUsd } : null, steps: s.steps, deciderReason: s.decision?.reason, reviewerReason: s.review?.reason, note: s.note }));
      message = s.chosen?.facts ? checkClaims(rep.message, s.chosen.facts).text : rep.message;
    } catch (e) { log.warn(`reporter unavailable, using template: ${errText(e)}`); }
  }
  const sn = s.snapshot; const c = s.chosen;
  log.info(`[${sn.wallet.slice(0, 8)}] ${s.outcome}: ${message}`);

  // The Activity feed shows ONE plain message per outcome. The AI's reasoning (what the decider wrote, the safety
  // review, the analyst's notes) travels in the same event's payload.details and sits behind "Details" in the UI.
  const details = llmOn() && s.decision?.action === 'execute' && s.chosen ? {
    reasoning: s.decision.reason,
    ...(s.review ? { safetyReview: `${s.review.verdict === 'approve' ? 'Approved' : 'Flagged'}: ${s.review.reason}` } : {}),
    ...(s.analysis?.summary ? { analysis: s.analysis.summary } : {}), ...(s.analysis?.concerns?.length ? { concerns: s.analysis.concerns } : {}),
  } : undefined;

  const allDetails = details || s.detail ? { ...(details ?? {}), ...(s.detail ? { technical: s.detail } : {}) } : undefined;

  // Post what the user should see. Quiet outcomes (a plain skip) stay in the log to avoid a 30 s spam.
  if (s.outcome === 'error' || s.outcome === 'vetoed' || s.outcome === 'failed' || s.outcome === 'done' || s.outcome === 'simulated') {
    const base = c?.idempotencyKey ?? `err-${createHash('sha256').update(`${sn.wallet}|${s.note}`).digest('hex').slice(0, 16)}-${Math.floor(Date.now() / 3_600_000)}`;
    const failed = s.outcome === 'failed' || s.outcome === 'error';
    await app.postEvent({
      wallet: sn.wallet, network: sn.network, // A dry run is shown as 'info' and carries no direction/amount, so the UI never counts it as money moved.
      kind: failed ? 'error' : s.outcome === 'vetoed' || s.outcome === 'simulated' ? 'info' : c?.kind === 'hedge' ? 'hedge' : 'rebalance',
      venue: c?.venue, status: s.outcome === 'done' ? 'done' : failed ? 'failed' : undefined, message,
      payload: c ? { ...(s.outcome === 'simulated' ? { ruleKey: c.ruleKey, dryRun: true, wouldMoveUsd: Number(BigInt(c.amountBaseUnit)) / 1e6 } : { direction: c.kind === 'release' ? 'out' : 'in', amountUsd: Number(BigInt(c.amountBaseUnit)) / 1e6, ruleKey: c.ruleKey, dryRun: false }), ...(allDetails ? { details: allDetails } : {}) } : (allDetails ? { details: allDetails } : undefined),
      idempotencyKey: `${base}:r`,
    }).catch((e) => log.warn(`event post failed: ${errText(e)}`));
    if (c?.ruleKey) {
      const done = s.outcome === 'done';
      await app.postRuleState({
        wallet: sn.wallet, network: sn.network, ruleKey: c.ruleKey, lastOutcome: s.outcome, lastOutcomeMsg: message.slice(0, 300),
        ...(done ? { lastMoveAt: new Date().toISOString() } : {}),
        ...(done && c.kind === 'top_up' && c.rule?.topUpOnce ? { topUpDoneAt: new Date().toISOString() } : {}),
        ...(done && c.kind === 'release' && c.rule?.releaseOnce ? { releaseDoneAt: new Date().toISOString(), releaseBelowSince: null } : {}),
      }).catch((e) => log.warn(`rule-state post failed: ${errText(e)}`));
    }
  }
  return { message };
}
