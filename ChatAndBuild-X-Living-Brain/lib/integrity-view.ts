import { effectiveHaircut, type Assessment } from './integrity';

// Pure helpers shared by the /api/integrity route, the hook and the portfolio numbers (no network, no React).

export const SIGNED_OUT_BASE_HAIRCUT = 0.3;

export interface IntegrityView { enabled: boolean; bySymbol: Record<string, Assessment> }

/** The route's reference prices: bStock symbol -> Binance last price (null when unknown). */
export function referenceFromTickers(tickers: { symbol: string; lastPrice: string }[] | null | undefined): (symbol: string) => number | null {
  const m = new Map<string, number>();
  for (const t of tickers ?? []) { const p = Number(t.lastPrice); if (p > 0) m.set(t.symbol, p); }
  return (s) => m.get(`${s}USDT`) ?? null;
}

export const mapBySymbol = (items: Assessment[] | undefined): Record<string, Assessment> => Object.fromEntries((items ?? []).map((a) => [a.symbol, a]));

/**
 * The haircut one token is counted at. With the switch OFF, or with no assessment yet, this returns `base` itself
 * (same number, same type), so the caller's arithmetic is exactly the flat-haircut arithmetic.
 */
export function haircutFor(symbol: string, base: number, view: IntegrityView | undefined): number {
  if (!view || !view.enabled) return base;
  return effectiveHaircut(view.bySymbol[symbol], base, true);
}

/** Raised-haircut note for a collateral card ("39% (+9 pts): reason"), or null when the token carries the flat haircut. */
export function raisedNote(symbol: string, base: number, view: IntegrityView | undefined): string | null {
  const h = haircutFor(symbol, base, view);
  if (!(h > base)) return null;
  const a = view?.bySymbol[symbol];
  return `Haircut ${Math.round(h * 100)}% (+${Math.round((h - base) * 100)} pts)${a?.reasons[0] ? `: ${a.reasons[0]}` : ''}`;
}
