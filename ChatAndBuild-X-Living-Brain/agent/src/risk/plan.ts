import { createHash } from 'node:crypto';
import type { HedgePlanView } from '../../../lib/agent-action';
import type { AgentConfig, HedgeLeg, MarketEvent } from '../../../lib/agent-config';
import { BSTOCKS_BSC } from '../../../lib/bstocks';
import type { Candidate, RejectedCandidate, Snapshot } from '../types';
import { effectiveMode, parkedOffBnb } from '../policy';
import { tickerOf } from './market';
import { pickPut } from './options';
import { DEFAULT_EVENT_GAP, PERP_FEE_ROUNDTRIP, Z99, loss99, maxSafeLeverage, portfolioLossUsd, putCostFraction, solveHedge, type Holding, type Solution } from './model';

// Turns the user's loss limit into a hedge plan: exposure per ticker, the VaR99 for the day or the next event, the
// smallest hedge that respects the limit, and for each trade the cost, margin plan, validity and worst case.
// Every instrument is considered for every name (Derive put, perp, proxy perp) and the cheapest per unit of
// risk removed comes first. When the sized hedge breaks a cap, budget, allowance or margin limit it is SHRUNK to the
// largest size that fits, never dropped, and the one constraint that bound is named with its numbers.
// Pure given a Snapshot: no network, no LLM. Every number on the proposal card comes from here.

const PLAN_VALID_MS = 30 * 60_000;
const MAINTENANCE_MARGIN = 0.02;                // spec: "2% maintenance margin assumed"
const DEFAULT_SIGMA_UNHEDGEABLE = 0.03;         // only for tickers with no hedge market at all: they cannot be hedged, but they still add risk
const INDEX_ETFS = new Set(['SPY', 'QQQ']);
const SECTOR: Record<string, string> = { NVDA: 'tech', AAPL: 'tech', MSFT: 'tech', AMZN: 'tech', META: 'tech', TSLA: 'tech', GOOGL: 'tech', AMD: 'tech', COIN: 'crypto', MSTR: 'crypto', JPM: 'finance', GS: 'finance', XOM: 'energy', SPY: 'index', QQQ: 'index' };
const r2 = (x: number) => Math.round(x * 100) / 100;
const m = (x: number, d = 0) => `$${x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 })}`;
const pctOf = (x: number, tot: number) => (tot > 0 ? r2((x / tot) * 100) : 0);
/** VaR as text: two decimals when it is within 0.05 points of the limit, so "5%" never hides 5.01%. */
const vp = (varPct: number, limitPct: number) => (Math.abs(varPct - limitPct) < 0.05 + 1e-9 ? varPct.toFixed(2) : String(r2(varPct)));

export type Instrument = 'perp' | 'put' | 'proxy';
export interface TickerView extends Holding {
  excluded: boolean; fullyHedge: boolean; hedgedUsd: number; hedgedPct: number; bucket: 'direct' | 'proxy' | 'none';
  /** Perps market (ticker, e.g. NVDA = NVDAUSDT) for THIS name (null when it has no perp). */
  perpMarket: string | null; price: number; qty: number; sigmaAssumed: boolean;
  /** Which instrument the plan uses for this name, and what is available. null = nothing can hedge it. */
  instrument: Instrument | null; perpOk: boolean; putOk: boolean; proxyVia: { ticker: string; beta: number; price: number; sigmaDay: number } | null;
  putCostFraction: number | null; costFrac: number; heldPutUsd: number;
  /** Raw short on the perp (USD) and the part of it above the holding (a net short). */
  shortUsd: number; netShortUsd: number;
  /** Set when the price or volatility feed for this name is missing: it is not planned until it is back. */
  unassessed: string | null;
  /** Why a put was not chosen even though one is listed (it cannot be paid for in time). */
  putSkipped: string | null;
}
export interface RiskView {
  portfolioUsd: number;
  tickers: TickerView[];
  solution: Solution;
  window: 'day' | 'event';
  limitPct: number;
  hedgedPct: number;
  /** How much of the portfolio COULD be hedged: directly (perp or put), through a proxy, or not at all. */
  coverage: { directPct: number; proxyPct: number; nonePct: number };
  nextEvent: { ticker: string; kind: string; at: string; inHours: number } | null;
  /** Events inside the hedge lead window, by ticker. */
  activeEvents: Record<string, MarketEvent>;
  /** Hedge notional per name that would meet the limit with NO cap or budget (what Option A needs). */
  freeTargetUsd: Record<string, number>;
  /** Plain statement when one name is above 30% of the value or one sector above 50%; null otherwise. */
  concentration: string | null;
  /** Names that are not planned because their price feed is missing. */
  unassessed: { ticker: string; usd: number; why: string }[];
}
export interface HedgePlanResult { candidates: Candidate[]; rejected: RejectedCandidate[]; risk: RiskView | null }

/** Hedge legs the loss-limit solver can handle: perps (Aster) legs, keyed by ticker. */
export const perpLegs = (h: Pick<AgentConfig['hedge'], 'legs'>): HedgeLeg[] => h.legs.filter((l) => l.venue === 'aster' && l.kind === 'perp');
const putLegs = (h: Pick<AgentConfig['hedge'], 'legs'>): HedgeLeg[] => h.legs.filter((l) => l.venue === 'derive' && l.kind === 'put');
const key = (...p: (string | number)[]) => createHash('sha256').update(p.join('|')).digest('hex').slice(0, 24);

/** Exposure, VaR and the solved hedge for the whole portfolio. null when hedging is off or there is nothing held. */
export function assessRisk(s: Snapshot, now = new Date()): RiskView | null {
  const cfg = s.config;
  if (!cfg.hedge.enabled) return null;
  const held = s.bsc.bstocks.filter((b) => b.qty > 0 && b.value > 0);
  if (!held.length || !s.market) return null;
  const perpLeg = new Map(perpLegs(cfg.hedge).map((l) => [tickerOf(l.bstock), l]));
  const putLeg = new Map(putLegs(cfg.hedge).map((l) => [tickerOf(l.bstock), l]));
  const proxyMap = cfg.risk.proxyMap ?? {};
  const exclude = new Set(cfg.risk.excludeTickers); const fully = new Set(cfg.risk.fullyHedgeTickers);

  const lead = cfg.risk.eventLeadHours * 3_600_000;
  const upcoming = cfg.events.filter((e) => Date.parse(e.at) > now.getTime()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const heldTickers = new Set(held.map((b) => tickerOf(b.symbol)));
  const activeEvents: Record<string, MarketEvent> = {};
  for (const e of upcoming) if (heldTickers.has(e.ticker) && Date.parse(e.at) - now.getTime() <= lead && !activeEvents[e.ticker]) activeEvents[e.ticker] = e;
  const window = Object.keys(activeEvents).length ? 'event' : 'day';
  const nxt = upcoming.find((e) => heldTickers.has(e.ticker));

  const tickers: TickerView[] = held.map((b) => {
    const ticker = tickerOf(b.symbol); const leg = perpLeg.get(ticker);
    const known = s.market!.sigmaDay[ticker];
    const sigmaDay = known ?? DEFAULT_SIGMA_UNHEDGEABLE;
    const ev = activeEvents[ticker];
    const price = b.value / b.qty;
    const chain = s.options?.[ticker];
    const perpOk = !!leg; const putOk = !!chain && !!(leg || putLeg.get(ticker));
    const pm = proxyMap[ticker]; const vleg = pm ? perpLeg.get(pm.via) : undefined;
    const sigVia = pm ? s.market!.sigmaDay[pm.via] : undefined; const pxVia = pm ? s.proxyPrices?.[pm.via] : undefined;
    // Offered for every name that has one (shown as an alternative); traded only when no perp or put exists (instrument below).
    const proxyVia = pm && vleg && sigVia && pxVia ? { ticker: pm.via, beta: pm.beta, price: pxVia, sigmaDay: sigVia } : null;
    const unassessed = known === undefined && (perpOk || putOk || !!pm) ? (s.unassessed?.[ticker] ?? 'no volatility or price from the venue feed') : null;
    const heldPutUsd = (s.heldPuts ?? []).filter((p) => p.ticker === ticker && Date.parse(p.expiry) > now.getTime()).reduce((a, p) => a + p.notionalUsd, 0);
    const pos = leg ? (s.perpPositions[leg.market] ?? 0) : 0;
    const shortUsd = Math.max(0, -pos) * price;
    const hedgedUsd = leg ? Math.min(b.value, shortUsd + heldPutUsd) : Math.min(b.value, heldPutUsd);
    const gap = ev ? (ev.gapPct !== undefined ? ev.gapPct / 100 : Math.max(DEFAULT_EVENT_GAP[ev.kind], Z99 * sigmaDay)) : undefined;
    const bucket: TickerView['bucket'] = perpOk || putOk ? 'direct' : proxyVia ? 'proxy' : 'none';
    // Instrument: a put needs no monitoring and caps the loss, so it leads ahead of a scheduled gap; otherwise a perp; a name with only a put or only a proxy uses that.
    let instrument: Instrument | null = null;
    if (ev && putOk) instrument = 'put'; else if (perpOk) instrument = 'perp'; else if (putOk) instrument = 'put'; else if (proxyVia) instrument = 'proxy';
    let putCostFraction: number | null = null; let putSkipped: string | null = null;
    if (putOk && chain) {
      const probe = pickPut(chain, b.value, new Date(ev ? Date.parse(ev.at) + 2 * 3_600_000 : now.getTime() + 86_400_000), now);
      if (probe) {
        putCostFraction = (probe.premiumUsd + probe.feesUsd) / probe.notionalUsd;
        // The premium must be on Derive before the event: free collateral there, or a bridge that lands in time.
        const toEvent = ev ? Date.parse(ev.at) - now.getTime() : Infinity;
        const inTime = (s.deriveEtaSec ?? 1800) * 1000 < toEvent;
        if (instrument === 'put' && perpOk && !inTime) {
          // Neither the bridge to Derive nor a premium already there is guaranteed: compare what each route can cover before the event.
          const bnbAvail = Math.max(0, Math.min(s.bsc.usdcUsd - Number(BigInt(cfg.rebalance.keepBscReserveBaseUnit)) / 1e6, Number(BigInt(s.bsc.allowanceUsdcBase)) / 1e6));
          const lev = maxSafeLeverage(loss99({ sigmaDay, gap }, !!ev), cfg.limits.maxLeverage);
          const perpCover = ((s.perpMain?.freeUsd ?? 0) + ((s.perpEtaSec ?? 60) * 1000 < toEvent ? bnbAvail : 0)) * lev;
          const putCover = ((s.deriveFree?.freeUsd ?? 0) * 0.97) / Math.max(1e-6, putCostFraction);
          if (perpCover > putCover) { instrument = 'perp'; putSkipped = `a put cannot be paid for in time (the Derive bridge takes ${Math.round((s.deriveEtaSec ?? 1800) / 60)} min and the event is in ${Math.max(0, Math.round(toEvent / 60_000))} min, with only ${m((s.deriveFree?.freeUsd ?? 0))} already on Derive)`; }
        }
      } else if (instrument === 'put') instrument = perpOk ? 'perp' : null;
    }
    const costFrac = instrument === 'put' ? (putCostFraction ?? 0.03) : PERP_FEE_ROUNDTRIP;
    return { instrument, perpOk, putOk, proxyVia, putCostFraction, costFrac, heldPutUsd, ticker, bstock: b.symbol, usd: b.value, sigmaDay, gap, excluded: exclude.has(ticker), fullyHedge: fully.has(ticker), hedgedUsd, hedgedPct: pctOf(hedgedUsd, b.value), bucket, perpMarket: leg?.market ?? null, price, qty: b.qty, sigmaAssumed: known === undefined, shortUsd, netShortUsd: Math.max(0, shortUsd - b.value), unassessed, putSkipped };
  });

  const hedgeable = new Set(tickers.filter((t) => t.instrument !== null && !t.sigmaAssumed && !t.unassessed).map((t) => t.ticker));
  const residual: Record<string, number> = {};
  for (const t of tickers) {
    if (t.instrument === 'put' && t.putCostFraction !== null) residual[t.ticker] = Math.min(1, t.putCostFraction / Math.max(1e-9, loss99(t, window === 'event' && !!activeEvents[t.ticker])));
    if (t.instrument === 'proxy' && t.proxyVia) residual[t.ticker] = Math.sqrt(Math.max(0, 1 - t.proxyVia.beta ** 2));   // share of the name's risk that stays
  }
  const lim = cfg.limits; const Pv = tickers.reduce((a, t) => a + t.usd, 0);
  // Capital a hedge ties up per dollar of notional: a put's premium, or a perp's margin (1 / safe leverage). Puts are far cheaper in capital.
  const capFrac: Record<string, number> = {}; const premFrac: Record<string, number> = {};
  for (const t of tickers) {
    const gap = loss99(t, window === 'event' && !!activeEvents[t.ticker]);
    if (t.instrument === 'put') { capFrac[t.ticker] = t.costFrac; premFrac[t.ticker] = t.costFrac; }
    else if (t.instrument) capFrac[t.ticker] = 1 / maxSafeLeverage(t.instrument === 'proxy' && t.proxyVia ? loss99({ sigmaDay: t.proxyVia.sigmaDay }, false) : gap, lim.maxLeverage);
  }
  const base = {
    holdings: tickers, existingHedgeUsd: Object.fromEntries(tickers.map((t) => [t.ticker, t.hedgedUsd])), limitPct: cfg.risk.lossTolerancePct, rho: cfg.risk.correlation,
    residual, costFrac: Object.fromEntries(tickers.map((t) => [t.ticker, t.costFrac])), capFrac, premFrac,
    capitalRoom: Math.max(0, lim.maxCapitalOffBnbUsd - parkedOffBnb(s)) + (s.perpMain?.freeUsd ?? 0) + (s.deriveFree?.freeUsd ?? 0),
    budgetUsd: (cfg.risk.premiumBudgetWeeklyPct / 100) * Pv,
    event: window === 'event', hedgeable, excluded: exclude, fullyHedge: fully,
    priority: new Set(tickers.filter((t) => !!activeEvents[t.ticker] && hedgeable.has(t.ticker)).map((t) => t.ticker)),
  };
  // Two rankings: cheapest in fees per unit of risk removed, and least capital tied up per unit of risk removed. Capital (the
  // off-BNB cap) is often the scarce resource, so the plan that removes more risk inside the constraints wins.
  const unconstrained = solveHedge({ ...base, capitalRoom: Infinity, budgetUsd: Infinity, rank: 'cost' });
  const byCost = solveHedge({ ...base, rank: 'cost' }); const byCapital = solveHedge({ ...base, rank: 'capital' });
  const solution = byCapital.varAfter < byCost.varAfter - 1e-6 ? byCapital : byCost;
  const P = solution.portfolioUsd;
  const sum = (b: TickerView['bucket']) => tickers.filter((t) => t.bucket === b).reduce((a, t) => a + t.usd, 0);
  const totalHedged = tickers.reduce((a, t) => a + t.hedgedUsd, 0);

  // Concentration: one name above 30% of the value, or one sector above 50%.
  const parts: string[] = []; const top = [...tickers].sort((a, b) => b.usd - a.usd)[0];
  if (top && P > 0 && top.usd / P > 0.3) parts.push(`${top.ticker} alone is ${Math.round((top.usd / P) * 100)}% of the portfolio`);
  const bySector = new Map<string, TickerView[]>(); for (const t of tickers) { const k = SECTOR[t.ticker] ?? t.ticker; bySector.set(k, [...(bySector.get(k) ?? []), t]); }
  for (const [sec, ts] of bySector) { const v = ts.reduce((a, t) => a + t.usd, 0); if (ts.length > 1 && P > 0 && v / P > 0.5) parts.push(`${ts.length} ${sec}-type names (${ts.map((t) => t.ticker).join(', ')}) hold ${Math.round((v / P) * 100)}% of the value and tend to fall together`); }
  return {
    portfolioUsd: P, tickers, solution, window, limitPct: cfg.risk.lossTolerancePct, hedgedPct: pctOf(totalHedged, P),
    coverage: { directPct: pctOf(sum('direct'), P), proxyPct: pctOf(sum('proxy'), P), nonePct: pctOf(sum('none'), P) },
    nextEvent: nxt ? { ticker: nxt.ticker, kind: nxt.kind, at: nxt.at, inHours: r2((Date.parse(nxt.at) - now.getTime()) / 3_600_000) } : null,
    activeEvents, freeTargetUsd: unconstrained.targetUsd, concentration: parts.length ? `${parts.join('. ')}.` : null,
    unassessed: tickers.filter((t) => t.unassessed).map((t) => ({ ticker: t.ticker, usd: r2(t.usd), why: t.unassessed! })),
  };
}

interface Shared { budgetLeft: number; dayLeft: number; offBnbRoom: number; bnbLeft: number; freeMargin: number; deriveFree: number; /** Effective covered USD per ticker once every proposed hedge has run. */ cover: Record<string, number>; /** Largest total one decision may trade without asking: the per-trade cap in autonomous mode, no limit in 'ask me first' mode (the user approves the plan). */ decisionCap: number }

/** The plan view fields every card carries: who is hedged now and after this trade, the binding constraint, the options. */
function viewCommon(risk: RiskView, t: TickerView, afterUsd: number, binding: string[], orders: number[] | undefined): Pick<HedgePlanView, 'coverage' | 'tickers' | 'portfolioHedgedPct' | 'portfolioHedgedAfterPct' | 'bindingConstraint' | 'orders' | 'concentration'> {
  const P = risk.portfolioUsd;
  const others = risk.tickers.reduce((a, x) => a + (x.ticker === t.ticker ? 0 : x.hedgedUsd), 0);
  return {
    coverage: risk.coverage,
    tickers: risk.tickers.map((x) => ({ ticker: x.ticker, usd: r2(x.usd), hedgedPct: x.hedgedPct, bucket: x.bucket, hedgedAfterPct: x.ticker === t.ticker ? pctOf(Math.min(x.usd, afterUsd), x.usd) : x.hedgedPct, shortUsd: r2(x.shortUsd), netShortUsd: r2(x.netShortUsd) })),
    portfolioHedgedPct: risk.hedgedPct, portfolioHedgedAfterPct: pctOf(others + Math.min(t.usd, afterUsd), P),
    ...(binding.length ? { bindingConstraint: binding.join('; ') } : {}), ...(orders && orders.length > 1 ? { orders } : {}), ...(risk.concentration ? { concentration: risk.concentration } : {}),
  };
}
const optionsFor = (limitPct: number, binding: string[]): string[] => [
  ...(binding.some((b) => /cap|limit/i.test(b)) ? ['Raise the cap that bound (it is yours to change; the agent never raises it)'] : []),
  ...(binding.some((b) => /budget/i.test(b)) ? ['Raise your weekly protection budget'] : []),
  ...(binding.some((b) => /allowance/i.test(b)) ? ['Raise your BNB USDC allowance to the agent'] : []),
  `Accept a higher loss than ${limitPct}%`,
];
/** Split a total into orders no larger than the per-trade cap. */
const splitOrders = (totalUsd: number, perTradeUsd: number): number[] => {
  if (!(perTradeUsd > 0) || totalUsd <= perTradeUsd) return [r2(totalUsd)];
  const n = Math.floor(totalUsd / perTradeUsd); const out = Array.from({ length: n }, () => r2(perTradeUsd)); const rest = r2(totalUsd - n * perTradeUsd);
  return rest > 0.5 ? [...out, rest] : out;
};

/** Hedge trades that move the hedges to the solved target, each with a full proposal. */
export function planHedges(s: Snapshot, risk: RiskView, now = new Date()): HedgePlanResult {
  const cfg = s.config; const lim = cfg.limits; const out: Candidate[] = []; const rejected: RejectedCandidate[] = [];
  const sol = risk.solution; const P = risk.portfolioUsd;
  const budgetWeekly = (cfg.risk.premiumBudgetWeeklyPct / 100) * P;
  const eta = s.perpEtaSec ?? 60;
  const sh: Shared = {
    budgetLeft: budgetWeekly, dayLeft: Math.max(0, lim.maxNotionalPerDayUsd - (s.today?.notionalUsd ?? 0)),
    offBnbRoom: Math.max(0, lim.maxCapitalOffBnbUsd - parkedOffBnb(s)),
    bnbLeft: Math.max(0, Math.min(s.bsc.usdcUsd - Number(BigInt(cfg.rebalance.keepBscReserveBaseUnit)) / 1e6, Number(BigInt(s.bsc.allowanceUsdcBase)) / 1e6)),
    freeMargin: s.perpMain?.freeUsd ?? 0, deriveFree: s.deriveFree?.freeUsd ?? 0, cover: {},
    decisionCap: effectiveMode(s, now).mode === 'autonomous' ? lim.maxNotionalPerTradeUsd : Infinity,
  };
  const perpLegOf = (tk: string) => perpLegs(cfg.hedge).find((l) => tickerOf(l.bstock) === tk);
  const putLegOf = (tk: string) => putLegs(cfg.hedge).find((l) => tickerOf(l.bstock) === tk);

  for (const u of risk.unassessed) rejected.push({ kind: 'hedge', reason: `${u.ticker} is unassessed: ${u.why}. ${m(u.usd)} of it is not planned until a fresh price arrives; the other names are not affected`, severity: 'error' });
  for (const t of risk.tickers.filter((x) => x.bucket === 'none' && !x.unassessed && !x.excluded)) rejected.push({ kind: 'hedge', reason: `${t.ticker}: no perp, put or proxy is available, so ${m(t.usd)} stays unhedged`, severity: 'info' });

  for (const t of risk.tickers) {
    const free = risk.freeTargetUsd[t.ticker] ?? 0; const got = sol.targetUsd[t.ticker] ?? 0;
    if (t.instrument === 'put' && free > 100 && got < 0.05 * free && sh.budgetLeft < 0.1 * free * t.costFrac) {
      const cost = r2(free * t.costFrac);
      rejected.push({ kind: 'hedge', severity: 'error', reason: `${t.ticker}: cannot reach your ${risk.limitPct}% limit within your budget: it needs about ${m(free)} of puts (about ${m(cost)}) and your weekly budget is ${m(budgetWeekly)}, which does not buy a meaningful hedge. Options: raise the budget to about ${m(Math.ceil(cost))}, accept a higher loss than ${risk.limitPct}%, or hedge less` });
    }
  }
  const order = [...risk.tickers].sort((a, b) => Number(!!risk.activeEvents[b.ticker]) - Number(!!risk.activeEvents[a.ticker]) || (sol.targetUsd[b.ticker] ?? 0) - (sol.targetUsd[a.ticker] ?? 0));
  for (const t of order) {
    if (t.instrument === null || t.sigmaAssumed || t.excluded || t.unassessed) continue;
    const pl = perpLegOf(t.ticker); const ql = putLegOf(t.ticker);
    const ratio = (t.instrument === 'proxy' ? 1 : (pl ?? ql)?.hedgeRatio ?? 1);
    const wantRaw = sol.targetUsd[t.ticker] ?? 0;
    let target = Math.min(wantRaw, t.usd * ratio);                      // the leg ratio is the per-leg maximum
    const current = t.hedgedUsd;
    // Net short on the hedge market: a LONG counts as negative, so opening the hedge also closes it. Raw, not capped at the holding.
    const px = t.proxyVia;
    const net = t.instrument === 'proxy' && px ? (-(s.perpPositions[px.ticker] ?? 0) * px.price) / ((px.beta * t.sigmaDay) / px.sigmaDay) : (t.perpMarket !== null ? -(s.perpPositions[t.perpMarket] ?? 0) * t.price : 0) + t.heldPutUsd;
    const drift = target > 0 ? Math.abs(target - net) / target * 100 : net > 0 ? 100 : 0;
    if (drift <= cfg.hedge.driftThresholdPct) { if (target > 0 || net > 0) rejected.push({ kind: 'hedge', reason: `${t.ticker}: hedge is in band (${drift.toFixed(1)}% off, threshold ${cfg.hedge.driftThresholdPct}%), no trade`, severity: 'info' }); continue; }

    let putFailed = false;
    if (t.instrument === 'put') {
      const leg = { market: t.ticker, bstock: t.bstock, key: pl ? `aster:${pl.market}` : `derive-put:${t.ticker}` };
      const r = planPut(s, risk, t, leg, target, current, now, sh);
      if (r.candidate) { out.push(r.candidate); continue; }
      // No put can be bought (too slow to fund, over budget, thin book): say why, then fall back to a perp when the perps venue can carry it.
      if (r.rejected) rejected.push({ ...r.rejected, ...(pl ? { reason: `${r.rejected.reason}. Trying a perp instead` } : {}), severity: 'error' });
      if (!pl || t.heldPutUsd > 0) continue;
      putFailed = true;
      // The target was solved for a put (part of the cover is the premium lost); a perp covers the full amount, so it needs less.
      target *= 1 - Math.min(1, (t.putCostFraction ?? 0) / Math.max(1e-9, loss99(t, !!risk.activeEvents[t.ticker])));
    }
    const mk = t.instrument === 'proxy' && px ? { market: px.ticker, price: px.price, ratio: (px.beta * t.sigmaDay) / px.sigmaDay, proxy: true as const }
      : { market: t.perpMarket ?? t.ticker, price: t.price, ratio: 1, proxy: false as const };
    if (!mk.proxy && t.perpMarket === null) continue;
    const bstockForLeg = t.bstock;

    let deltaUsd = target - net;                                        // covered USD: > 0 sell more short (or close a long first), < 0 buy back
    const event = !!risk.activeEvents[t.ticker];
    const gapNow = loss99(t, event);
    const levGap = mk.proxy && px ? loss99({ sigmaDay: px.sigmaDay }, false) : gapNow;   // the margin sits on the market that is traded
    const lev = maxSafeLeverage(levGap, lim.maxLeverage);
    const binding: string[] = [];
    const assumptions: string[] = [
      `Volatility ${(t.sigmaDay * 100).toFixed(2)}% a day from perps hourly prices; 99% loss = ${Z99} x daily volatility${event ? `, replaced by the ${(gapNow * 100).toFixed(1)}% event gap for ${t.ticker}` : ''}.`,
      `Stocks are assumed to be ${Math.round(cfg.risk.correlation * 100)}% correlated for the portfolio loss.`,
      `Perp cost is about ${PERP_FEE_ROUNDTRIP * 10_000} bps round trip in taker fees; funding is not included and can be paid or received.`,
      `A ${(maxSafeLeverage(gapNow, 99) < lim.maxLeverage ? 'safety' : 'your')} leverage cap of ${lev}x keeps a ${(gapNow * 100).toFixed(1)}% gap under about 30% of posted margin.`,
    ];
    if (mk.proxy && px) assumptions.unshift(`PROXY hedge: ${t.ticker} has no market of its own, so ${px.ticker} is shorted instead (correlation ${px.beta}, sized by ${px.beta} x the volatility ratio). About ${Math.round(Math.sqrt(1 - px.beta ** 2) * 100)}% of ${t.ticker}'s risk stays.`);
    const putPct = putCostFraction(t.sigmaDay) * 100;
    assumptions.push(`A 1-week ATM put would cost about ${putPct.toFixed(1)}% of notional (about ${m(Math.abs(deltaUsd) * putPct / 100)}) and needs no monitoring, ${putFailed ? 'but none could be bought in time or within your limits' : t.putSkipped ? `but ${t.putSkipped}` : t.putOk ? 'but a perp was chosen' : 'but no listed put covers this name'}, so this plan uses a perp that needs monitoring and margin.`);

    // ---- fit the hedge to every constraint: daily cap, then margin (perps free margin, then BNB through the allowance, the off-BNB cap and the deposit time)
    const hedgeUsdOf = (covered: number) => covered * mk.ratio;
    if (deltaUsd > 0) {
      if (hedgeUsdOf(deltaUsd) > sh.dayLeft) { binding.push(`daily notional cap: ${m(lim.maxNotionalPerDayUsd)} per day, ${m(sh.dayLeft)} left`); deltaUsd = sh.dayLeft / mk.ratio; }
      if (sh.dayLeft < 1) { rejected.push({ kind: 'hedge', reason: `${t.ticker}: the daily notional cap of ${m(lim.maxNotionalPerDayUsd)} is used up, so no more can be hedged today`, severity: 'error' }); continue; }
    }
    let marginMove: HedgePlanView['marginPlan'] = null; let idleMargin = 0;
    if (deltaUsd > 0) {
      const need = hedgeUsdOf(deltaUsd) / lev;
      if (need <= sh.freeMargin) { idleMargin = r2(need); sh.freeMargin -= need; }
      else {
        const timeToEvent = risk.activeEvents[t.ticker] ? Date.parse(risk.activeEvents[t.ticker].at) - now.getTime() : Infinity;
        const etaOk = eta * 1000 < timeToEvent;
        const byAllowance = sh.bnbLeft / 1.05; const byRoom = sh.offBnbRoom / 1.05;
        const bridgeable = etaOk ? Math.min(byAllowance, byRoom) : 0;
        const available = sh.freeMargin + bridgeable;
        if (available < need) {
          const why = !etaOk && byAllowance > 0 && byRoom > 0 ? `deposit time: the ${Math.round(eta / 60)} min margin deposit to perps is slower than the ${Math.round(timeToEvent / 60_000)} min to the ${risk.activeEvents[t.ticker]?.kind ?? 'event'}`
            : byRoom <= byAllowance ? `off-BNB cap: ${m(lim.maxCapitalOffBnbUsd)} allowed, ${m(sh.offBnbRoom)} left, so at most ${m(sh.freeMargin + byRoom)} of margin can sit on perps`
            : `allowance: only ${m(sh.bnbLeft)} of your BNB USDC can be used (allowance ${m(Number(BigInt(s.bsc.allowanceUsdcBase)) / 1e6)}, reserve kept)`;
          binding.push(why);
          if (available * lev / mk.ratio < 1) { rejected.push({ kind: 'hedge', reason: `${t.ticker}: needs ${m(need, 0)} of margin on perps; ${why}. Options: raise that limit, or accept a higher loss than ${risk.limitPct}%`, severity: 'error' }); continue; }
          deltaUsd = (available * lev) / mk.ratio;
          assumptions.push(`This is the largest hedge that fits: ${why}.`);
        }
        const needNow = hedgeUsdOf(deltaUsd) / lev;
        const move = bridgeable > 0 && needNow > sh.freeMargin ? r2((needNow - sh.freeMargin) * 1.05) : 0;
        if (move > 0) { marginMove = { moveUsd: move, from: 'BNB wallet (USDC)', to: 'perps account', etaSec: Math.round(eta) }; sh.bnbLeft -= move; sh.offBnbRoom -= move; }
        idleMargin = r2(needNow); sh.freeMargin = Math.max(0, sh.freeMargin - needNow);
      }
    }
    // ---- lots: round UP to the venue's size step when the margin and caps allow, so the order reaches the target instead of stopping just short
    const mm = s.marketMins?.[mk.market];
    const stepOf = (qty: number) => (mm ? mm.step : qty >= 10 ? 1 : 0.01);
    let hedgeNotional = hedgeUsdOf(Math.abs(deltaUsd));
    if (hedgeNotional > 0) {
      const step = stepOf(hedgeNotional / mk.price);
      const up = Math.ceil((hedgeNotional / mk.price) / step - 1e-9) * step; const down = Math.floor((hedgeNotional / mk.price) / step + 1e-9) * step;
      const limitNotional = deltaUsd > 0 ? Math.min(sh.dayLeft, hedgeUsdOf((sh.freeMargin + idleMargin + (marginMove ? marginMove.moveUsd / 1.05 : 0)) * lev / mk.ratio)) : Infinity;
      const q = up * mk.price <= limitNotional + 1e-6 || binding.length === 0 ? up : down;
      hedgeNotional = Math.round(q * mk.price * 100) / 100;
      if (mm && (q < mm.minBase - 1e-12 || q * mk.price < mm.minNotionalUsd)) { rejected.push({ kind: 'hedge', reason: `${t.ticker}: an order of ${q} (${m(q * mk.price)}) is below the venue minimum (${mm.minBase} and ${m(mm.minNotionalUsd)}), so it is not sent`, severity: 'info' }); continue; }
      deltaUsd = Math.sign(deltaUsd) * (hedgeNotional / mk.ratio);
    }
    const notional = hedgeNotional;
    if (notional < 1) continue;
    if (idleMargin > 0) idleMargin = r2(notional / lev);   // margin for the rounded order
    if (deltaUsd > 0) sh.dayLeft -= notional;
    const fees = r2(notional * PERP_FEE_ROUNDTRIP);
    const qtyDelta = Math.sign(deltaUsd) * Math.round((notional / mk.price) * 1e8) / 1e8;
    const liqMove = r2((1 / lev - MAINTENANCE_MARGIN) * 100);
    const gapUpCost = r2(notional * gapNow);
    // Loss AFTER THIS TRADE ONLY (other tickers as they are now): a trimmed first slice must not claim the final target's effect.
    const afterThis = Math.max(0, Math.min(t.usd, net + deltaUsd));
    const resid = t.instrument === 'proxy' && px ? Math.sqrt(Math.max(0, 1 - px.beta ** 2)) : 0;
    const varThis = P > 0 ? portfolioLossUsd(risk.tickers.map((x) => Math.max(0, x.usd - (x.ticker === t.ticker ? afterThis * (1 - resid) : x.hedgedUsd * (1 - (x.instrument === 'proxy' ? Math.sqrt(Math.max(0, 1 - (x.proxyVia?.beta ?? 0) ** 2)) : 0))))), risk.tickers.map((x) => loss99(x, risk.window === 'event' && !!risk.activeEvents[x.ticker])), cfg.risk.correlation) / P : 0;
    sh.cover[t.ticker] = afterThis * (1 - resid);
    const removesNetShort = deltaUsd < 0 && t.netShortUsd > 0;
    if (deltaUsd < 0 && !removesNetShort && varThis * 100 > risk.limitPct + 0.05) { rejected.push({ kind: 'hedge', reason: `${t.ticker}: trimming the hedge would push the modelled loss to ${vp(varThis * 100, risk.limitPct)}%, above your ${risk.limitPct}% limit, so it is left as it is` }); continue; }
    const met = varThis * 100 <= risk.limitPct + 0.05;
    const orders = deltaUsd > 0 ? splitOrders(notional, lim.maxNotionalPerTradeUsd) : undefined;
    const orderQtys = orders && orders.length > 1 ? orders.map((o, i) => (i === orders.length - 1 ? Math.round((Math.abs(qtyDelta) - orders.slice(0, -1).reduce((a, x) => a + Math.round((x / mk.price) / stepOf(x / mk.price)) * stepOf(x / mk.price), 0)) * 1e8) / 1e8 : Math.round((o / mk.price) / stepOf(o / mk.price)) * stepOf(o / mk.price))) : undefined;
    if (orders && orders.length > 1) assumptions.push(`Placed as ${orders.length} orders (${orders.map((o) => m(o)).join(', ')}) to stay under your ${m(lim.maxNotionalPerTradeUsd)} per-trade cap.`);
    const staged = Number.isFinite(sh.decisionCap) && deltaUsd > 0 && !!orders && orders.length > 1 && !!orderQtys;
    const runNotional = staged ? orders![0] : notional; const runQty = staged ? Math.sign(qtyDelta) * orderQtys![0] : qtyDelta;
    if (staged) assumptions.push(`Step 1 of ${orders!.length} runs now (${m(runNotional)}, your per-trade cap is ${m(lim.maxNotionalPerTradeUsd)}). The other ${orders!.length - 1} follow automatically on the next checks, each under the cap, so the full ${m(notional)} is in place within minutes.`);
    const need2 = Math.max(0, target - (net + deltaUsd));
    const options = !met ? optionsFor(risk.limitPct, binding) : undefined;
    const heldUnits = t.qty; const shortUnits = t.shortUsd / t.price;
    const view: HedgePlanView = {
      ...viewCommon(risk, t, mk.proxy ? afterThis : afterThis, binding, orders),
      portfolioUsd: r2(P), instrument: (mk.proxy ? `Short ${mk.market} perp (PROXY for ${t.ticker})` : `Short ${t.ticker} perp`).slice(0, 80), venue: 'aster', ticker: t.ticker, sizeUsd: r2(runNotional), leverage: lev,
      limitPct: risk.limitPct, varBeforePct: r2(sol.varNow * 100), varAfterPct: r2(varThis * 100), requiredHedgePct: r2(sol.requiredHedgeRatio * 100), window: risk.window,
      cost: { feesUsd: r2(runNotional * PERP_FEE_ROUNDTRIP), premiumUsd: 0, fundingEstUsd: 0, idleMarginUsd: idleMargin, weeklyBudgetUsd: r2(budgetWeekly) },
      marginPlan: marginMove, gapUpCostUsd: gapUpCost, marginUsedUsd: idleMargin, ...(options ? { options } : {}),
      validUntil: new Date(Math.min(now.getTime() + PLAN_VALID_MS, risk.activeEvents[t.ticker] ? Date.parse(risk.activeEvents[t.ticker].at) : Infinity)).toISOString(),
      assumptions: assumptions.map((x) => x.slice(0, 300)).slice(0, 10),
      invalidatedBy: [`${t.ticker} price moves more than about ${r2(Math.max(2, gapNow * 100 / 3))}% before you approve`, 'Your loss limit, leverage cap or notional limits change', 'The perps margin balance changes or the margin deposit slows down'],
      worstCase: deltaUsd > 0
        ? `A ${(gapNow * 100).toFixed(0)}% gap against the short costs about ${m(gapUpCost)} on ${m(notional)} (${m(idleMargin)} of margin at ${lev}x, ${Math.round((gapUpCost / Math.max(1, idleMargin)) * 100)}% of it). The short is liquidated if ${mk.market} rises about ${liqMove}% (${MAINTENANCE_MARGIN * 100}% maintenance margin assumed).`
        : removesNetShort ? `After the buyback the position is no longer net short: the risk of ${m(t.netShortUsd * loss99(t, false))} from the extra short goes away.` : `Buying back part of the short removes protection: the modelled worst case becomes ${vp(varThis * 100, risk.limitPct)}% of the portfolio.`,
      residual: `After this trade the modelled 99% loss is ${vp(varThis * 100, risk.limitPct)}% of the portfolio (your limit is ${risk.limitPct}%).${!met ? ` THE LIMIT IS NOT MET${binding.length ? ` because of ${binding.join(' and ')}` : ''}; about ${m(need2)} more of ${t.ticker} cover is needed.` : ''} Still unhedged for ${t.ticker}: ${m(Math.max(0, t.usd - afterThis))}.${mk.proxy ? ` Proxy risk left: ${Math.round(resid * 100)}% of ${t.ticker}.` : ''}`,
    };
    const dir = deltaUsd > 0 ? 'sell (add to the short)' : 'buy back (reduce the short)';
    const heldText = t.shortUsd > 0 ? `You hold ${m(t.usd)} (${Math.round(heldUnits * 100) / 100} units) and are short ${m(t.shortUsd)} (${Math.round(shortUnits * 100) / 100} units)${t.netShortUsd > 0 ? `, so you are net short ${m(t.netShortUsd)}` : ''}.` : '';
    out.push({
      id: `hedge:${mk.market}:${Math.round(deltaUsd)}${staged ? ':s1' : ''}`, kind: 'hedge', venue: 'aster', amountBaseUnit: '0', notionalUsd: r2(runNotional),
      explain: `Place a perps market order to ${dir} ${Math.abs(runQty)} ${mk.market} (${m(runNotional)}${staged ? `, step 1 of ${orders!.length}` : ''}${mk.proxy ? `, a proxy for ${t.ticker}` : ''}). ${heldText} Solved so the modelled worst case ${risk.window === 'event' ? 'around the event' : 'over a day'} stays within your ${risk.limitPct}% limit. Cost about ${m(fees, 2)}.${marginMove ? ` First moves ${m(marginMove.moveUsd, 2)} of margin from BNB to perps (about ${Math.round(marginMove.etaSec / 60)} min).` : ''}`.replace(/\s+/g, ' '),
      reason: deltaUsd > 0
        ? `${t.ticker}: modelled 99% loss is ${vp(sol.varNow * 100, risk.limitPct)}% now (${r2(sol.varUnhedged * 100)}% with no hedge) against your ${risk.limitPct}% limit${event ? ` (${risk.activeEvents[t.ticker].kind} in ${r2((Date.parse(risk.activeEvents[t.ticker].at) - now.getTime()) / 3_600_000)}h)` : ''}; ${mk.proxy ? `short ${mk.market} as a proxy` : `raise the ${t.ticker} hedge from ${m(current)}`} toward ${m(target)}`
        : removesNetShort ? `${t.ticker}: you hold ${m(t.usd)} but are short ${m(t.shortUsd)}, so you are net short ${m(t.netShortUsd)} (about ${m(t.netShortUsd * loss99(t, false))} of 99% risk the other way). Buying back removes it`
        : `${t.ticker}: your ${t.ticker} hedge (${m(Math.max(0, net))}) is larger than the ${m(target)} needed to stay inside your ${risk.limitPct}% limit (modelled loss ${vp(sol.varNow * 100, risk.limitPct)}% now); trimming frees margin and cuts cost but reduces protection`,
      hedge: { bstock: bstockForLeg, market: mk.market, venue: 'aster', kind: 'perp', deltaToShort: runQty, driftPct: drift, ticker: t.ticker, targetUsd: r2(target), currentUsd: r2(Math.max(0, net)), key: `aster:${mk.market}`, ...(mk.proxy ? { proxyFor: t.ticker } : {}), ...(removesNetShort ? { removesNetShort: true } : {}), ...(orderQtys && !staged ? { orderQtys } : {}) },
      binding, plan: view, urgency: 1000 + (risk.window === 'event' ? 500 : 0) + Math.min(400, (sol.varNow - sol.varAfter) * 1000),
      idempotencyKey: `ag-${key(s.wallet, s.network, 'hedge', mk.market, Math.round(deltaUsd), Math.floor(now.getTime() / 300_000))}`,
    });
  }
  out.sort((a, b) => b.urgency - a.urgency);
  // The loss if EVERY proposed hedge runs (each card shows its own effect; this is the effect of the whole plan).
  if (out.length && P > 0) {
    const all = portfolioLossUsd(risk.tickers.map((x) => Math.max(0, x.usd - (sh.cover[x.ticker] ?? x.hedgedUsd))), risk.tickers.map((x) => loss99(x, risk.window === 'event' && !!risk.activeEvents[x.ticker])), cfg.risk.correlation) / P;
    for (const c of out) if (c.plan) c.plan.varAfterAllPct = r2(all * 100);
    // When the whole plan still leaves the loss above the limit, name the ONE constraint that ran out (the same text on every card).
    if (all * 100 > risk.limitPct + 0.05) {
      const bound = sh.offBnbRoom < 0.1 * lim.maxCapitalOffBnbUsd ? `off-BNB cap: ${m(lim.maxCapitalOffBnbUsd)} allowed, ${m(Math.max(0, sh.offBnbRoom))} left after this plan`
        : sh.budgetLeft < 0.1 * budgetWeekly + 1 ? `weekly budget: ${m(budgetWeekly)} in total, ${m(Math.max(0, sh.budgetLeft))} left after this plan`
        : sh.dayLeft < 1 ? `daily notional cap: ${m(lim.maxNotionalPerDayUsd)} per day, used up by this plan` : null;
      if (bound) for (const c of out) if (c.plan && (!c.plan.bindingConstraint || /cannot remove enough risk/.test(c.plan.bindingConstraint))) { c.plan.bindingConstraint = bound; c.binding = [bound]; }
    }
  }
  return { candidates: out, rejected, risk };
}

export const knownTickers = new Set(BSTOCKS_BSC.map((b) => b.underlying));

/** A protective put on Derive for one ticker: no monitoring needed, loss capped at the premium. Premium is paid on Derive. */
function planPut(s: Snapshot, risk: RiskView, t: TickerView, leg: { market: string; bstock: string; key: string }, target: number, current: number, now: Date, sh: Shared): { candidate?: Candidate; rejected?: RejectedCandidate } {
  const lim = s.config.limits; const sol = risk.solution; const P = risk.portfolioUsd;
  const chain = s.options?.[t.ticker]; const ev = risk.activeEvents[t.ticker];
  const budgetWeekly = (s.config.risk.premiumBudgetWeeklyPct / 100) * P;
  const rej = (reason: string) => ({ rejected: { kind: 'hedge' as const, reason: `${t.ticker}: ${reason}` } });
  if (!chain) return {};
  const need = target - current;
  if (need < Math.max(1, 0.05 * target)) return {};   // a leftover under 5% of the target is not worth a new order
  if (sh.dayLeft < 1) return rej(`the daily notional cap of ${m(lim.maxNotionalPerDayUsd)} is used up, so no more can be hedged today`);
  const coverUntil = new Date(ev ? Date.parse(ev.at) + 2 * 3_600_000 : now.getTime() + 86_400_000);
  const what = ev ? `the ${ev.kind}` : 'the next day';
  const assumptions: string[] = [];
  const reasons: string[] = [];
  // Size: the whole need, limited by the DAILY cap (the per-trade cap only splits it into orders), then shrunk to the budget.
  const wanted = Math.min(need, sh.dayLeft);
  if (need > sh.dayLeft) reasons.push(`daily notional cap: ${m(lim.maxNotionalPerDayUsd)} per day, ${m(sh.dayLeft)} left`);
  let pick = pickPut(chain, wanted, coverUntil, now, 1);
  if (!pick) return rej(`no listed put covers ${what} (or the quote is stale or too thin)`);
  const heldUsd = (s.heldPuts ?? []).filter((x) => x.ticker === t.ticker && Date.parse(x.expiry) > now.getTime()).reduce((a, x) => a + x.notionalUsd, 0);
  const perUsd = (p: { premiumUsd: number; feesUsd: number; notionalUsd: number }) => (p.premiumUsd + p.feesUsd) / Math.max(1, p.notionalUsd);
  const budgetLeft = Math.max(0, sh.budgetLeft - heldUsd * perUsd(pick));
  if (pick.premiumUsd + pick.feesUsd > budgetLeft) {
    const scaled = budgetLeft > 0 ? pickPut(chain, pick.notionalUsd * (budgetLeft / (pick.premiumUsd + pick.feesUsd)) * 0.995, coverUntil, now, 1) : null;
    const needCost = r2(need * perUsd(pick));
    if (!scaled || scaled.premiumUsd + scaled.feesUsd > budgetLeft || scaled.notionalUsd < Math.max(50, 0.05 * need)) return { rejected: { kind: 'hedge', severity: 'error', reason: `${t.ticker}: cannot reach your ${risk.limitPct}% limit within your budget: it needs about ${m(need)} of puts (about ${m(needCost)}) and your weekly budget left is ${m(budgetLeft)} of ${m(budgetWeekly)}, which does not buy a meaningful hedge. Options: raise the budget to about ${m(Math.ceil(needCost))}, accept a higher loss than ${risk.limitPct}%, or hedge less` } };
    pick = scaled; reasons.push(`weekly budget: ${m(budgetLeft)} left of ${m(budgetWeekly)}`);
  }

  const eta = s.deriveEtaSec ?? 1800; const free = sh.deriveFree;
  let cost = pick.premiumUsd + pick.feesUsd; let marginPlan: HedgePlanView['marginPlan'] = null;
  if (cost > free * 0.97) {
    const timeToEvent = ev ? Date.parse(ev.at) - now.getTime() : Infinity; const etaOk = eta * 1000 < timeToEvent;
    const byAllowance = sh.bnbLeft / 1.05; const byRoom = sh.offBnbRoom / 1.05;
    const avail = free * 0.97 + (etaOk ? Math.min(byAllowance, byRoom) : 0);   // keeps 3% of Derive collateral free for closing fees
    const why = !etaOk ? `bridge time: the ${Math.round(eta / 60)} min bridge to Derive is slower than the ${Math.round(timeToEvent / 60_000)} min to the ${ev?.kind ?? 'event'}`
      : byRoom < byAllowance ? `off-BNB cap: ${m(lim.maxCapitalOffBnbUsd)} allowed, ${m(sh.offBnbRoom)} left` : `allowance: only ${m(sh.bnbLeft)} of your BNB USDC can be used`;
    if (avail <= 0) return { rejected: { kind: 'hedge', severity: 'error', reason: `${t.ticker}: the put premium of ${m(cost, 2)} must be on Derive, there is ${m(free, 2)} there, and ${why}. Options: raise that limit, or accept a higher loss than ${risk.limitPct}%` } };
    if (avail < cost) {
      const scaled = pickPut(chain, pick.notionalUsd * (avail / cost) * 0.995, coverUntil, now, 1);
      if (!scaled) return { rejected: { kind: 'hedge', severity: 'error', reason: `${t.ticker}: the premium that can be gathered in time buys less than one contract (${why})` } };
      pick = scaled; cost = pick.premiumUsd + pick.feesUsd;
      reasons.push(etaOk ? why : `Derive collateral: only ${m(avail)} can be used (${why}; a 3% buffer is kept for closing fees)`);
      assumptions.push(`Only ${m(avail)} can reach Derive in time, so a partial hedge of ${m(pick.notionalUsd)} is proposed.`);
    }
    if (cost > free * 0.97 + 0.5) { const mv = r2((cost - free * 0.97) * 1.05); marginPlan = { moveUsd: mv, from: 'BNB wallet (USDC)', to: 'Derive subaccount (via Ethereum USDC)', etaSec: Math.round(eta) }; }
  }
  const evGap = (x: { ticker: string; sigmaDay: number; gap?: number }) => loss99(x, risk.window === 'event' && !!risk.activeEvents[x.ticker]);
  const resid = (p: { costFraction: number }) => Math.min(1, p.costFraction / Math.max(1e-9, evGap(t)));
  const varFor = (p: { notionalUsd: number; costFraction: number }) => (P > 0 ? portfolioLossUsd(risk.tickers.map((x) => Math.max(0, x.usd - (x.ticker === t.ticker ? Math.min(t.usd, current + p.notionalUsd) * (1 - resid(p)) : x.hedgedUsd))), risk.tickers.map(evGap), s.config.risk.correlation) / P : 0);
  // Within 0.05 points of the limit: add one lot if the budget, caps and Derive funds allow, so "5%" is not really 5.01%.
  let varThis = varFor(pick);
  if (varThis * 100 > risk.limitPct && varThis * 100 <= risk.limitPct + 0.05 && pick.contracts + 1 <= pick.quotedSize) {
    const p2 = pickPut(chain, pick.notionalUsd + chain.spot * chain.contractSize, coverUntil, now, 1);
    if (p2 && p2.contracts === pick.contracts + 1 && p2.premiumUsd + p2.feesUsd <= budgetLeft && p2.notionalUsd <= sh.dayLeft && (cost <= free * 0.97 ? p2.premiumUsd + p2.feesUsd <= free * 0.97 : true)) { pick = p2; cost = p2.premiumUsd + p2.feesUsd; if (marginPlan) marginPlan = { ...marginPlan, moveUsd: r2((cost - free * 0.97) * 1.05) }; varThis = varFor(pick); }
  }
  if (pick.contracts + 1e-9 >= pick.quotedSize) reasons.unshift(`chain depth: only ${pick.quotedSize} contracts are quoted`);
  if (marginPlan) { sh.bnbLeft -= marginPlan.moveUsd; sh.offBnbRoom -= marginPlan.moveUsd; sh.deriveFree = Math.max(0, free + marginPlan.moveUsd / 1.05 - cost); } else sh.deriveFree = Math.max(0, free - cost);
  sh.budgetLeft -= cost; sh.dayLeft -= pick.notionalUsd;
  sh.cover[t.ticker] = Math.min(t.usd, current + pick.notionalUsd) * (1 - resid(pick));

  const met = varThis * 100 <= risk.limitPct + 0.05;
  const orders = splitOrders(pick.notionalUsd, lim.maxNotionalPerTradeUsd);
  // Autonomous: the plan above is the whole plan; THIS decision runs only its first step so it never goes over the per-trade cap.
  const stagedPut = Number.isFinite(sh.decisionCap) && pick.notionalUsd > sh.decisionCap + 1e-6;
  const run = stagedPut ? (pickPut(chain, sh.decisionCap, coverUntil, now, 1) ?? pick) : pick;
  const varRun = stagedPut ? varFor(run) : varThis;
  if (stagedPut) assumptions.push(`Step 1 of ${orders.length} runs now (${run.contracts} puts, ${m(run.notionalUsd)}; your per-trade cap is ${m(lim.maxNotionalPerTradeUsd)}). The other ${orders.length - 1} follow automatically on the next checks, each under the cap, until the plan of ${pick.contracts} puts is in place.`);
  const total = r2(cost); const stillNeed = Math.max(0, need - pick.notionalUsd);
  const unitCost = perUsd(pick);
  const needCostFull = r2(need * unitCost);
  if (orders.length > 1) assumptions.push(`Placed as ${orders.length} orders (${orders.map((o) => m(o)).join(', ')}) to stay under your ${m(lim.maxNotionalPerTradeUsd)} per-trade cap.`);
  if (!met && !reasons.length) {
    if (sh.budgetLeft < 0.1 * budgetWeekly + 1) reasons.push(`weekly budget: ${m(budgetWeekly)} in total, ${m(Math.max(0, sh.budgetLeft))} left`);
    else if (sh.offBnbRoom < 0.1 * lim.maxCapitalOffBnbUsd) reasons.push(`off-BNB cap: ${m(lim.maxCapitalOffBnbUsd)} allowed, ${m(Math.max(0, sh.offBnbRoom))} left`);
    else reasons.push('the hedges available cannot remove enough risk');
  }
  if (!met) assumptions.push(`Your ${risk.limitPct}% limit cannot be reached this cycle because ${reasons.length ? reasons.join(' and ') : 'of the limits above'}. This order is as large as they allow.`);
  // Why this instrument beat the other one (one line).
  const perpNotional = pick.notionalUsd; const perpMargin = perpNotional / Math.max(1, maxSafeLeverage(evGap(t), lim.maxLeverage));
  const perpLine = t.perpOk
    ? (perpMargin > sh.offBnbRoom + 1e-6 && perpMargin > sh.freeMargin ? `A perp of about ${m(perpNotional)} would need ${m(perpMargin)} of margin against ${m(sh.offBnbRoom)} of room under your ${m(lim.maxCapitalOffBnbUsd)} off-BNB cap, so it cannot reach the limit inside it.` : `A perp of about ${m(perpNotional)} would cost about ${m(perpNotional * PERP_FEE_ROUNDTRIP)} in fees but needs monitoring and margin; a put needs neither and keeps your upside.`)
    : `${t.ticker} has no perp, so a put is the direct hedge.`;
  assumptions.unshift(
    `Derive option orders are not connected yet: approving this runs a dry run only until they are.`,
    `Put quoted at $${pick.ask} (spread ${pick.spreadPct}%), implied volatility ${(pick.iv * 100).toFixed(0)}%, delta ${pick.delta}; fees ${(chain.feeFraction * 10_000).toFixed(0)} bps of notional; ${chain.settlement}-settled; quotes ${chain.quotesOffHours ? 'stay live' : 'pause'} while the market is closed.`,
    perpLine,
    `The buy is a limit order at the ask quoted now, so it will not fill above it if the price moves during the bridge. The agent does not yet re-check the budget and caps after the bridge.`);
  const needFull = Math.max(need, (risk.freeTargetUsd[t.ticker] ?? target) - current); const stillFull = Math.max(0, needFull - pick.notionalUsd); const needCostFullA = r2(needFull * unitCost);
  const optA = !met && stillFull > 1 ? `Option A, meet your limit: about ${m(needFull)} of puts for about ${m(needCostFullA)}${needCostFullA > budgetWeekly ? `, which is ${m(needCostFullA - budgetWeekly)} over your weekly budget of ${m(budgetWeekly)}` : ', inside your budget'}. Option B, this order: ${m(pick.notionalUsd)} for ${m(total, 2)}, leaving the loss at ${vp(varThis * 100, risk.limitPct)}%. ` : '';
  const options = !met ? optionsFor(risk.limitPct, reasons) : undefined;
  if (options && t.perpOk) {
    const levP = maxSafeLeverage(evGap(t), lim.maxLeverage); const needP = Math.max(needFull, 1); const marginP = r2(needP / levP); const feesP = r2(needP * PERP_FEE_ROUNDTRIP);
    const roomNow = sh.freeMargin + Math.min(sh.bnbLeft, sh.offBnbRoom) / 1.05;
    const reserve = Number(BigInt(s.config.rebalance.keepBscReserveBaseUnit)) / 1e6;
    options.splice(0, 0, marginP > roomNow
      ? `Hedge the rest with a ${t.ticker} perp instead: about ${m(feesP)} in fees but ${m(marginP)} of margin on perps, so raise your BNB allowance to about ${m(Math.ceil(marginP * 1.05 + reserve))}${marginP > sh.freeMargin + sh.offBnbRoom / 1.05 ? ` and your off-BNB cap above ${m(lim.maxCapitalOffBnbUsd)}` : ''}`
      : `Hedge the rest with a ${t.ticker} perp instead: about ${m(feesP)} in fees and ${m(marginP)} of margin on perps, which fits your current allowance`);
  }
  if (options && reasons.some((x) => /allowance/i.test(x))) options.push('Raise your BNB USDC allowance to the agent');
  const view: HedgePlanView = {
    ...viewCommon(risk, t, Math.min(t.usd, current + pick.notionalUsd), reasons, orders),
    portfolioUsd: r2(P), instrument: `${pick.daysToExpiry}-day ATM put on ${t.ticker} (strike ${pick.strike}) on Derive`.slice(0, 80), venue: 'derive', ticker: t.ticker, sizeUsd: r2(run.notionalUsd), leverage: null,
    limitPct: risk.limitPct, varBeforePct: r2(sol.varNow * 100), varAfterPct: r2(varRun * 100), requiredHedgePct: r2(sol.requiredHedgeRatio * 100), window: risk.window,
    cost: { feesUsd: run.feesUsd, premiumUsd: run.premiumUsd, fundingEstUsd: 0, idleMarginUsd: 0, weeklyBudgetUsd: r2(budgetWeekly) },
    marginPlan, ...(options ? { options } : {}),
    validUntil: new Date(Math.min(now.getTime() + PLAN_VALID_MS, ev ? Date.parse(ev.at) : Infinity)).toISOString(),
    assumptions: assumptions.map((x) => x.slice(0, 300)).slice(0, 10),
    invalidatedBy: [`${t.ticker} price moves more than about 2% before you approve (the quote changes)`, 'The quoted size or spread changes', 'Your loss limit or premium budget changes'],
    worstCase: `You lose at most the premium and fees (${m(total, 2)}) if ${t.ticker} stays above ${pick.strike}. Below ${pick.strike} the put pays out, so the loss on the covered ${m(pick.notionalUsd)} is capped near ${m(total, 2)}.`,
    residual: `After this put the modelled 99% loss around ${what} is ${vp(varThis * 100, risk.limitPct)}% of the portfolio (your limit is ${risk.limitPct}%).${!met ? ` THE LIMIT IS NOT MET. ${reasons.length ? 'Why: ' + reasons.join(' and ') + '.' : 'More protection is needed than this order gives.'} ${optA}` : ''} Still unhedged for ${t.ticker}: ${m(Math.max(0, t.usd - Math.min(t.usd, current + pick.notionalUsd)))}.`,
  };
  const eh = ev ? r2((Date.parse(ev.at) - now.getTime()) / 3_600_000) : null;
  const contractsText = (c: number) => `${c} ${leg.market} put${c === 1 ? '' : 's'}`;
  return { candidate: {
    id: `hedge:${leg.market}:put:${pick.strike}:${run.contracts}`, kind: 'hedge', venue: 'derive', amountBaseUnit: '0', notionalUsd: r2(run.notionalUsd),
    explain: `Buy ${contractsText(run.contracts)} (strike ${run.strike}, expires in ${run.daysToExpiry} days) on Derive${stagedPut ? `, step 1 of ${orders.length} (the plan is ${pick.contracts} puts, ${m(pick.notionalUsd)})` : orders.length > 1 ? ` in ${orders.length} orders` : ''} to cap the loss on ${m(run.notionalUsd)} of ${t.bstock} through ${what}. Cost about ${m(run.premiumUsd + run.feesUsd, 2)} (premium ${m(run.premiumUsd, 2)} plus fees ${m(run.feesUsd, 2)}).${marginPlan ? ` First moves ${m(marginPlan.moveUsd, 2)} from BNB to Derive (about ${Math.round(marginPlan.etaSec / 60)} min).` : ''}`,
    reason: `${t.ticker}: ${ev ? `${ev.kind} in ${eh}h, ` : ''}modelled 99% loss ${ev ? 'around it ' : ''}is ${vp(sol.varNow * 100, risk.limitPct)}% against your ${risk.limitPct}% limit; a put needs no monitoring and caps the loss`,
    hedge: { bstock: t.bstock, market: leg.market, deltaToShort: 0, driftPct: 100, ticker: t.ticker, targetUsd: r2(target), currentUsd: r2(current), instrument: 'put', key: leg.key, option: { expiry: run.expiry, strike: run.strike, contracts: run.contracts, ask: run.ask, premiumUsd: run.premiumUsd, feesUsd: run.feesUsd, notionalUsd: run.notionalUsd } },
    binding: reasons, plan: view, urgency: 1600 + Math.min(400, (sol.varNow - varThis) * 1000),
    idempotencyKey: `ag-${key(s.wallet, s.network, 'put', leg.market, pick.strike, run.contracts, Math.floor(now.getTime() / 300_000))}`,
  } };
}
