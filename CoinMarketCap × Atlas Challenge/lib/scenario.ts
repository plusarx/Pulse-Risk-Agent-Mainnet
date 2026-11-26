// Scenario forecast math: full Black-Scholes repricing of options + linear legs (perps, bStocks).
// Pure and unit-tested (tests/scenario.test.ts). Display floats only — nothing here sizes a transaction.
//
// Model: Black-Scholes with r = q = 0 (Derive marks with a forward and a discount factor ≈ 1 for these tenors;
// the leg table shows model vs Derive mark so any gap is visible). Vol = Derive's live mark IV per option.

const SQRT2PI = Math.sqrt(2 * Math.PI);
const YEAR_MS = 365 * 86_400_000;

export function normPdf(x: number): number { return Math.exp(-0.5 * x * x) / SQRT2PI; }

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf; |error| < 1.5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export type OptType = 'C' | 'P';

export interface Greeks { price: number; delta: number; gamma: number; /** per 1 vol point (0.01) */ vega: number; /** per calendar day */ theta: number }

/** Black-Scholes price and greeks (r = 0). T in years, sigma as a decimal (0.65 = 65%). */
export function bs(type: OptType, S: number, K: number, T: number, sigma: number): Greeks {
  if (T <= 0 || sigma <= 0 || S <= 0) {
    const intrinsic = type === 'C' ? Math.max(0, S - K) : Math.max(0, K - S);
    const delta = type === 'C' ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
    return { price: intrinsic, delta, gamma: 0, vega: 0, theta: 0 };
  }
  const sq = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / sq;
  const d2 = d1 - sq;
  const price = type === 'C' ? S * normCdf(d1) - K * normCdf(d2) : K * normCdf(-d2) - S * normCdf(-d1);
  const delta = type === 'C' ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = normPdf(d1) / (S * sq);
  const vega = (S * normPdf(d1) * Math.sqrt(T)) / 100;
  const theta = -(S * normPdf(d1) * sigma) / (2 * Math.sqrt(T)) / 365;
  return { price, delta, gamma, vega, theta };
}

/** "ETH-20261127-1400-C" / "ADA-20261127-0_1-P" → option spec (Derive expires at 08:00 UTC). */
export function parseDeriveOption(name: string): { underlying: string; expiryMs: number; strike: number; type: OptType } | null {
  const m = /^([A-Z0-9]+)-(\d{4})(\d{2})(\d{2})-([0-9_]+)-([CP])$/.exec(name);
  if (!m) return null;
  return { underlying: m[1], expiryMs: Date.UTC(+m[2], +m[3] - 1, +m[4], 8), strike: Number(m[5].replace('_', '.')), type: m[6] as OptType };
}

/** Underlying symbol for any leg name: "ETH-PERP" → ETH, "NVDAB" (bStock) handled by caller, option names parsed. */
export function underlyingOf(market: string): string {
  return parseDeriveOption(market)?.underlying ?? market.replace(/-PERP$/, '').toUpperCase();
}

export type Leg =
  | { kind: 'option'; id: string; account: string; label: string; type: OptType; strike: number; expiryMs: number; amount: number; iv: number; spot0: number; mark?: number; live?: Partial<Greeks>; underlying?: string }
  | { kind: 'linear'; id: string; account: string; label: string; amount: number; price0: number; underlying?: string };

export interface Shock { move: number; days: number; ivShift: number /* decimal, 0.05 = +5 vol pts */ }

/** Value of one leg in USD under a shock, relative to nothing (absolute model value). */
export function legValue(leg: Leg, s: Shock, nowMs: number): number {
  if (leg.kind === 'linear') return leg.amount * leg.price0 * (1 + s.move);
  const S = leg.spot0 * (1 + s.move);
  const T = Math.max(0, (leg.expiryMs - nowMs) / YEAR_MS - s.days / 365);
  return leg.amount * bs(leg.type, S, leg.strike, T, Math.max(0.01, leg.iv + s.ivShift)).price;
}

/** PnL of a set of legs under a shock, measured against the same legs' model value now (so PnL(0,0,0) = 0). */
export function pnl(legs: Leg[], s: Shock, nowMs: number): number {
  const base = { move: 0, days: 0, ivShift: 0 };
  return legs.reduce((a, l) => a + legValue(l, s, nowMs) - legValue(l, base, nowMs), 0);
}

/** Position greeks (amount-weighted) at a shocked state. Delta in underlying units and in $ (per 1% move). */
export function legGreeks(leg: Leg, s: Shock, nowMs: number): { delta: number; deltaUsd1pct: number; gamma: number; vega: number; theta: number } {
  if (leg.kind === 'linear') {
    const px = leg.price0 * (1 + s.move);
    return { delta: leg.amount, deltaUsd1pct: leg.amount * px * 0.01, gamma: 0, vega: 0, theta: 0 };
  }
  const S = leg.spot0 * (1 + s.move);
  const T = Math.max(0, (leg.expiryMs - nowMs) / YEAR_MS - s.days / 365);
  const g = bs(leg.type, S, leg.strike, T, Math.max(0.01, leg.iv + s.ivShift));
  return { delta: leg.amount * g.delta, deltaUsd1pct: leg.amount * g.delta * S * 0.01, gamma: leg.amount * g.gamma, vega: leg.amount * g.vega, theta: leg.amount * g.theta };
}

export function totalGreeks(legs: Leg[], s: Shock, nowMs: number) {
  return legs.map((l) => legGreeks(l, s, nowMs)).reduce(
    (a, g) => ({ delta: a.delta + g.delta, deltaUsd1pct: a.deltaUsd1pct + g.deltaUsd1pct, gamma: a.gamma + g.gamma, vega: a.vega + g.vega, theta: a.theta + g.theta }),
    { delta: 0, deltaUsd1pct: 0, gamma: 0, vega: 0, theta: 0 },
  );
}

/** Curve of PnL over a grid of moves. */
export function curve(legs: Leg[], range: number, steps: number, days: number, ivShift: number, nowMs: number): { move: number; pnl: number }[] {
  const out: { move: number; pnl: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const move = -range + (2 * range * i) / steps;
    out.push({ move, pnl: pnl(legs, { move, days, ivShift }, nowMs) });
  }
  return out;
}

/** First move (searching outward from 0, each direction) where `bad(move)` turns true; null if none within range. */
export function firstCrossing(bad: (move: number) => boolean, range: number, step = 0.0025): { down: number | null; up: number | null } {
  let down: number | null = null; let up: number | null = null;
  for (let m = 0; m <= range + 1e-9; m += step) {
    if (up === null && bad(m)) up = m;
    if (down === null && bad(-m)) down = -m;
    if (up !== null && down !== null) break;
  }
  return { down, up };
}

/** Days until the latest option expiry among the legs (for the time slider). */
export function maxDaysToExpiry(legs: Leg[], nowMs: number): number {
  const exp = legs.filter((l): l is Extract<Leg, { kind: 'option' }> => l.kind === 'option').map((l) => (l.expiryMs - nowMs) / 86_400_000);
  return exp.length ? Math.max(0, Math.ceil(Math.max(...exp))) : 0;
}
