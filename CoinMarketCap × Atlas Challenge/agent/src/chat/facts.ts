import { assessRisk } from '../risk/plan';
import { buildStatus } from '../status';
import type { Snapshot } from '../types';
import { integrityFacts } from '../tools/integrity';
import type { WhatIfResult } from './whatif';

// The facts the chat may use, and the whole portfolio picture it always gets. Code builds every one from the snapshot, the app's recorded
// actions and events, or a what-if run. The model gets them with ids and may only cite ids; the reply shows each cited fact's label and value,
// so the user sees what the answer rested on. Every message gets ALL of them, whatever the question names.
export interface Fact { id: string; label: string; value: string }
export interface Recorded {
  actions: { id: number; status: string; title: string; why: string; created_at: number; result_message: string | null }[];
  events: { kind: string; status?: string | null; message: string; created_at?: number | null }[];
}

const usd = (n: number | null | undefined, dp = 0) => (n === null || n === undefined ? 'unknown' : `$${n.toLocaleString('en-US', { maximumFractionDigits: dp })}`);
const num = (n: number) => Math.round(n * 1e4) / 1e4;
const when = (t?: number | null) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown time');
const base$ = (b: string | null | undefined) => (b ? usd(Number(BigInt(b)) / 1e6) : 'unknown');

export function buildFacts(s: Snapshot, rec: Recorded, whatIf: { applied: string[]; result: WhatIfResult } | null, source: 'live' | 'sample', now = new Date()): Fact[] {
  const st = buildStatus(s, {}, now); const f: Fact[] = []; const add = (label: string, value: string) => f.push({ id: `F${f.length + 1}`, label, value });
  const cfg = s.config; const lim = cfg.limits; const risk = assessRisk(s, now);
  add('Data source', source === 'live' ? 'live accounts' : 'sample portfolio (live accounts could not be read)');
  add('Mode', `${st.mode === 'autonomous' ? 'Autonomous' : 'Ask me first'}${st.killSwitch ? ', kill switch ON' : ''}${st.modeNote ? `. ${st.modeNote}` : ''}`);
  add('Your risk profile', `loss limit ${cfg.risk.lossTolerancePct}% of the portfolio; weekly protection budget ${cfg.risk.premiumBudgetWeeklyPct}% of the portfolio (about ${usd((cfg.risk.premiumBudgetWeeklyPct / 100) * st.portfolioUsd)}); stocks assumed ${Math.round(cfg.risk.correlation * 100)}% correlated; events count ${cfg.risk.eventLeadHours}h ahead; never hedge: ${cfg.risk.excludeTickers.join(', ') || 'none'}; always hedge in full: ${cfg.risk.fullyHedgeTickers.join(', ') || 'none'}`);
  add('Portfolio', `${usd(st.portfolioUsd)}, hedged ${st.hedgedPct}% (your loss limit needs ${st.requiredHedgePct}%)`);
  for (const b of s.bsc.bstocks.filter((x) => x.qty > 0)) {
    const t = risk?.tickers.find((x) => x.bstock === b.symbol); const tk = b.symbol.replace(/B$/, '');
    const how = !t ? 'no risk model for it' : [t.perpOk ? `perp${t.perpMarket !== null ? ` (${t.perpMarket}USDT)` : ''}` : null, t.putOk ? 'Derive put (live chain)' : null, t.proxyVia ? `proxy: short ${t.proxyVia.ticker} perp (measured correlation ${t.proxyVia.beta}, leaves about ${Math.round(Math.sqrt(Math.max(0, 1 - t.proxyVia.beta ** 2)) * 100)}% of the risk${t.instrument === 'proxy' ? ', used because there is no direct hedge' : ', an alternative to the direct hedge'})` : null].filter(Boolean).join(', ') || 'no hedge market';
    add(`${tk} exposure`, `${usd(b.value)}, ${Math.round((b.value / (st.portfolioUsd || 1)) * 1000) / 10}% of the portfolio (${num(b.qty)} units${t ? ` at ${usd(t.price, 2)}, daily volatility ${(t.sigmaDay * 100).toFixed(2)}%` : ''}); hedged ${t?.hedgedPct ?? 0}%; short on perps ${usd(t?.shortUsd ?? 0)}${t && t.netShortUsd > 0 ? ` (net short ${usd(t.netShortUsd)})` : ''}; puts held ${usd(t?.heldPutUsd ?? 0)}; hedge options: ${how}${t?.instrument ? `; plan uses a ${t.instrument}` : ''}${t?.putSkipped ? `; put skipped: ${t.putSkipped}` : ''}${t?.excluded ? '; excluded from hedging' : ''}`);
  }
  add('Modelled 99% loss', `${st.varPct}% of the portfolio over ${st.window === 'event' ? 'the next event' : 'a day'}, against your ${st.limitPct}% limit${risk ? `; with no hedge it would be ${num(risk.solution.varUnhedged * 100)}%` : ''}${risk && !risk.solution.feasible ? '; the limit cannot be reached with the hedges available' : ''}`);
  if (risk?.concentration) add('Concentration', risk.concentration);
  add('Coverage', `${st.coverage.directPct}% of the portfolio can be hedged directly, ${st.coverage.proxyPct}% through a proxy, ${st.coverage.nonePct}% not at all`);
  if (cfg.events.length) add('Scheduled events', cfg.events.map((e) => `${e.ticker} ${e.kind} in ${Math.round(((Date.parse(e.at) - now.getTime()) / 3_600_000) * 10) / 10}h${e.gapPct ? ` (assumed ${e.gapPct}% gap)` : ''}`).join('; '));
  add('Next event', st.nextEvent ? `${st.nextEvent.ticker} ${st.nextEvent.kind} in ${Math.round(st.nextEvent.inHours)}h` : 'none scheduled');
  add('Hedge settings', `hedging ${cfg.hedge.enabled ? 'on' : 'OFF'}; re-hedge when the gap exceeds ${cfg.hedge.driftThresholdPct}%; sizing ${cfg.hedge.sizing}; news flags ${cfg.hedge.news.enabled ? 'on' : 'off'}; markets: ${cfg.hedge.legs.map((l) => `${l.bstock}→${l.venue === 'derive' ? `Derive ${l.kind}` : 'perp'} ${l.market}`).join(', ') || 'none'}`);
  const pos = Object.entries(s.perpPositions).filter(([, v]) => v);
  add('Open perps positions', pos.length ? pos.map(([t, v]) => `${t} ${v < 0 ? 'short' : 'long'} ${Math.abs(v)}`).join('; ') : 'none');
  if (s.putPositions?.length) add('Open Derive puts', s.putPositions.map((p) => `${p.instrument} x${p.amount}, strike ${p.strike}, ${num(p.daysToExpiry)} days left`).join('; '));
  add('Balances', `BNB USDC ${usd(s.bsc.usdcUsd)}, USDT ${usd(s.bsc.usdtUsd)}, USDC allowance to the agent ${base$(s.bsc.allowanceUsdcBase)}, reserve never touched ${base$(cfg.rebalance.keepBscReserveBaseUnit)}; perps equity ${usd(s.perpMain?.equityUsd)} (free ${usd(s.perpMain?.freeUsd)}); Derive free ${usd(s.deriveFree?.freeUsd)}`);
  for (const v of ['aster', 'derive'] as const) {
    const a = (s.venueAccounts ?? []).filter((x) => x.venue === v);
    if (a.length) add(`${v === 'aster' ? 'Perps' : 'Derive'} accounts (all ${a.length})`, `${a.map((x) => `${x.label}: equity ${usd(x.equityUsd, 2)}, free ${usd(x.freeUsd, 2)}`).join('; ')}. Total equity ${usd(a.reduce((t, x) => t + x.equityUsd, 0), 2)}, total free ${usd(a.reduce((t, x) => t + x.freeUsd, 0), 2)}`);
  }
  add('Margin funding', `order: ${cfg.rebalance.sources.join(', ') || 'none'}; bStocks the agent may sell: ${cfg.rebalance.sellOrder.join(', ') || 'none'}; bStock haircut ${Math.round(cfg.collateral.bstockHaircut * 100)}%; margin automation ${cfg.rebalance.enabled ? 'on' : 'off'}`);
  add('Your limits', `max ${usd(lim.maxNotionalPerTradeUsd)} per trade and ${usd(lim.maxNotionalPerDayUsd)} per day; max leverage ${lim.maxLeverage}x; daily loss cap ${usd(lim.dailyLossCapUsd)}; max capital off BNB ${usd(lim.maxCapitalOffBnbUsd)}; autonomy ${lim.autonomyExpiresAt ? `until ${lim.autonomyExpiresAt.slice(0, 16).replace('T', ' ')} UTC` : 'not granted'}`);
  add('Used today', `traded ${usd(st.limitsUsed.notionalTodayUsd)} of ${usd(st.limitsUsed.maxNotionalPerDayUsd)}; loss ${usd(st.limitsUsed.lossTodayUsd)} of ${usd(st.limitsUsed.dailyLossCapUsd)} cap; off BNB ${usd(st.limitsUsed.capitalOffBnbUsd)} of ${usd(st.limitsUsed.maxCapitalOffBnbUsd)}`);
  for (const x of integrityFacts(s)) add(x.label, x.value);
  for (const a of st.alerts.slice(0, 5)) add('Alert', a);
  for (const n of st.newsFlags.slice(0, 4)) add(`News flag ${n.ticker}`, `${n.sentiment} (score ${n.score}, confidence ${n.confidence}), advisory only: ${n.reason}`);
  for (const a of rec.actions.slice(0, 6)) add(`Recorded request #${a.id}`, `${a.status} on ${when(a.created_at)}: ${a.title}. Why: ${a.why.slice(0, 320)}${a.result_message ? ` Result: ${a.result_message.slice(0, 180)}` : ''}`);
  for (const e of rec.events.slice(0, 8)) add('Recorded event', `${when(e.created_at)} ${e.kind}${e.status ? `/${e.status}` : ''}: ${e.message.slice(0, 240)}`);
  if (whatIf) {
    const r = whatIf.result; const p = r.card?.plan as { varBeforePct?: number; varAfterPct?: number; limitPct?: number; cost?: { premiumUsd: number; feesUsd: number }; sizeUsd?: number; instrument?: string } | null | undefined;
    add('What-if values changed', `${whatIf.applied.join('; ') || 'nothing'} (a test: nothing was sent or saved)`);
    add('What-if decision', `${r.decision} [${r.outcome}]`);
    if (p) add('What-if plan', `${p.instrument ?? ''} ${usd(p.sizeUsd)}; modelled loss ${p.varBeforePct}% to ${p.varAfterPct}% against ${p.limitPct}%; cost ${usd((p.cost?.premiumUsd ?? 0) + (p.cost?.feesUsd ?? 0), 2)}. Limit ${(p.varAfterPct ?? 99) <= (p.limitPct ?? 0) + 1e-9 ? 'MET' : 'NOT met'}: ${p.varAfterPct}% after against ${p.limitPct}%`);
    if (r.card) add('What-if why', r.card.why.slice(0, 500));
    for (const x of r.reasons.slice(0, 3)) add('What-if note', x);
  }
  return f;
}
