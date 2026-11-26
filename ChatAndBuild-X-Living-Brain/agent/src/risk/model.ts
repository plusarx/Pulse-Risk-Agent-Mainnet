// Deterministic risk maths from the spec. Nothing here touches an LLM, a venue or the network.
//   VaR99 per ticker  = z99 x daily sigma (or the event gap when an event is scheduled)
//   portfolio VaR99   = sqrt( sum_i sum_j e_i e_j L_i L_j rho_ij ),  e = unhedged exposure, L = 99% loss fraction
//   required hedge    = h >= 1 - L / VaR99      (L = the user's loss tolerance)
//   perp leverage cap = 0.30 / p99 gap          (a p99 gap must cost under ~30% of posted margin)
//   1-week put cost   = 0.4 x sigma_annual x sqrt(7/365)

export const Z99 = 2.326;
export const PERP_FEE_ROUNDTRIP = 0.0008;       // ~8 bps taker fees round trip
export const MARGIN_GAP_FRACTION = 0.30;        // p99 gap x leverage must stay under this share of margin
export const TRADING_DAYS = 252;

/** Default 99% gap sizes for scheduled events when the user gives none (fraction of price). */
export const DEFAULT_EVENT_GAP = { earnings: 0.08, corporate_action: 0.05, halt: 0.1 } as const;

export interface Holding {
  /** Underlying ticker, e.g. NVDA. */
  ticker: string;
  bstock: string;
  usd: number;
  /** Daily volatility as a fraction (0.03 = 3%). */
  sigmaDay: number;
  /** 99% event gap (fraction of price) when an event is scheduled for this ticker. */
  gap?: number;
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** 99% loss as a fraction of price: the event gap when set and the event window is on, else z99 x daily sigma. */
export const loss99 = (h: Pick<Holding, 'sigmaDay' | 'gap'>, event: boolean): number => (event && h.gap !== undefined ? Math.max(h.gap, 0) : Z99 * h.sigmaDay);

/** Portfolio 99% loss in USD for the given unhedged exposures (same order as `loss`). */
export function portfolioLossUsd(exposureUsd: number[], loss: number[], rho: number): number {
  let s = 0;
  for (let i = 0; i < exposureUsd.length; i++) for (let j = 0; j < exposureUsd.length; j++) s += exposureUsd[i] * exposureUsd[j] * loss[i] * loss[j] * (i === j ? 1 : rho);
  return Math.sqrt(Math.max(0, s));
}

/** Smallest hedge ratio that keeps the worst case inside the user's limit: h = max(0, 1 - L / VaR99). Both in the same unit. */
export const requiredHedgeRatio = (limitPct: number, varPct: number): number => (varPct <= 0 || varPct <= limitPct ? 0 : 1 - limitPct / varPct);

/** Highest perp leverage that keeps a p99 gap under ~30% of margin, bounded by the user's cap. */
export const maxSafeLeverage = (gapFraction: number, userMax: number): number => (gapFraction <= 0 ? userMax : Math.max(1, Math.min(userMax, Math.floor((MARGIN_GAP_FRACTION / gapFraction) * 100) / 100)));

/** Approximate 1-week ATM put cost as a fraction of notional: 0.4 x sigma_annual x sqrt(T). */
export const putCostFraction = (sigmaDay: number, days = 7): number => 0.4 * (sigmaDay * Math.sqrt(TRADING_DAYS)) * Math.sqrt(days / 365);

export interface SolveInput {
  holdings: Holding[];
  /** Notional already hedged per ticker (USD, positive). */
  existingHedgeUsd: Record<string, number>;
  limitPct: number;
  rho: number;
  event: boolean;
  /** Tickers that have a direct hedge instrument available. */
  hedgeable: Set<string>;
  excluded: Set<string>;
  fullyHedge: Set<string>;
  /** Share of a hedged amount that is STILL at risk, per ticker: 0 for a perp, premium / 99% loss for a put (the premium is lost). */
  residual?: Record<string, number>;
  /** Cost of hedging one dollar of each ticker (fraction): the solver picks the best risk cut per dollar of cost. */
  costFrac?: Record<string, number>;
  /** Names with a scheduled event: they are hedged FIRST (a binary gap cannot be managed once it happens), the rest by cost per unit of risk removed. */
  priority?: Set<string>;
  /** Capital each hedge ties up per dollar of notional (premium for a put, margin for a perp) and the premium paid per dollar of put. */
  capFrac?: Record<string, number>; premFrac?: Record<string, number>;
  /** Capital that may still be tied up (room under the off-BNB cap plus funds already on the venues) and the premium budget. */
  capitalRoom?: number; budgetUsd?: number;
  /** What to rank names by: cost per unit of risk removed, or capital tied up per unit of risk removed (when capital is the scarce resource). */
  rank?: 'cost' | 'capital';
}
export interface Solution {
  portfolioUsd: number;
  /** 99% loss with no hedge at all, with the hedges already open, and after the proposed hedge (fractions of the portfolio). */
  varUnhedged: number; varNow: number; varAfter: number;
  /** Doc formula on the unhedged VaR. */
  requiredHedgeRatio: number;
  /** Hedge notional wanted per ticker (USD), counting what is already open. */
  targetUsd: Record<string, number>;
  /** False when even hedging every hedgeable ticker cannot reach the limit. */
  feasible: boolean;
}

/**
 * Smallest hedge that respects the loss limit. Forced tickers are hedged in full; then the ticker whose full hedge
 * cuts the most VaR is added, round by round, and the last one is hedged only as far as needed (bisection).
 */
export function solveHedge(inp: SolveInput): Solution {
  const hs = inp.holdings; const P = hs.reduce((a, h) => a + h.usd, 0);
  const L = hs.map((h) => loss99(h, inp.event));
  const res = hs.map((h) => Math.min(1, Math.max(0, inp.residual?.[h.ticker] ?? 0)));
  const varPct = (hedge: number[]) => (P > 0 ? portfolioLossUsd(hs.map((h, i) => Math.max(0, h.usd - hedge[i] * (1 - res[i]))), L, inp.rho) / P : 0);
  const eligible = (h: Holding) => inp.hedgeable.has(h.ticker) && !inp.excluded.has(h.ticker);
  const existing = hs.map((h) => Math.min(h.usd, Math.max(0, inp.existingHedgeUsd[h.ticker] ?? 0)));
  const limit = inp.limitPct / 100;

  const varUnhedged = varPct(hs.map(() => 0));
  const varNow = varPct(existing);
  const required = requiredHedgeRatio(inp.limitPct, varUnhedged * 100);

  // Start from the hedges already open: they count, so the solver only adds what is still missing.
  const hedge = existing.slice();
  hs.forEach((h, i) => { if (eligible(h) && inp.fullyHedge.has(h.ticker)) hedge[i] = h.usd; });

  // Add tickers one at a time until the limit is met, then trim the last one with bisection. Every hedge ties up capital
  // (a perp's margin, a put's premium) and puts spend the premium budget: when either runs out a name can take no more and
  // the next name is tried, so the result is the best MIX that fits, not one instrument pushed past what is available.
  let capLeft = inp.capitalRoom ?? Infinity; let budLeft = inp.budgetUsd ?? Infinity;
  const capF = (i: number) => inp.capFrac?.[hs[i].ticker] ?? 0; const premF = (i: number) => inp.premFrac?.[hs[i].ticker] ?? 0;
  const spend = (i: number, add: number) => { capLeft -= capF(i) * add; budLeft -= premF(i) * add; };
  const maxAdd = (i: number) => Math.min(hs[i].usd - hedge[i], capF(i) > 0 ? capLeft / capF(i) : Infinity, premF(i) > 0 ? budLeft / premF(i) : Infinity);
  hs.forEach((h, i) => { if (eligible(h) && inp.fullyHedge.has(h.ticker)) spend(i, h.usd - existing[i]); });
  const open = () => hs.map((h, i) => i).filter((i) => eligible(hs[i]) && maxAdd(i) > 1);
  while (varPct(hedge) > limit) {
    const base = varPct(hedge); let best = -1; let bestScore = 0;
    const pool = open(); if (!pool.length) break;
    const pri = pool.filter((i) => inp.priority?.has(hs[i].ticker));
    for (const i of pri.length ? pri : pool) {
      const add = maxAdd(i); const t = [...hedge]; t[i] = hedge[i] + add; const cut = base - varPct(t);
      const cf = inp.rank === 'capital' ? (capF(i) || undefined) : inp.costFrac?.[hs[i].ticker];
      const score = cf && !pri.length ? cut / Math.max(1e-9, cf * add) : cut;
      if (score > bestScore + 1e-12) { bestScore = score; best = i; }
    }
    if (best < 0) break;
    const add = maxAdd(best); const full = [...hedge]; full[best] = hedge[best] + add;
    if (varPct(full) > limit) { spend(best, add); hedge[best] += add; continue; }
    let lo = hedge[best]; let hi = hedge[best] + add;                  // smallest hedge on `best` that meets the limit
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; const t = [...hedge]; t[best] = mid; if (varPct(t) <= limit) hi = mid; else lo = mid; }
    const to = Math.min(hs[best].usd, Math.ceil(hi * 100) / 100); spend(best, to - hedge[best]); hedge[best] = to;
  }
  // The target is never below what is already open, so the solver itself never proposes to remove protection.
  const targetUsd: Record<string, number> = {};
  hs.forEach((h, i) => { if (hedge[i] > 0 || existing[i] > 0) targetUsd[h.ticker] = Math.round(hedge[i] * 100) / 100; });
  const after = varPct(hs.map((h) => Math.min(h.usd, targetUsd[h.ticker] ?? 0)));
  return { portfolioUsd: P, varUnhedged: r4(varUnhedged), varNow: r4(varNow), varAfter: r4(after), requiredHedgeRatio: r4(required), targetUsd, feasible: after <= limit + 1e-9 };
}
