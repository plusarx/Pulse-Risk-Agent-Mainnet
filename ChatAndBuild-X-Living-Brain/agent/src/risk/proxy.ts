import type { Network } from '../types';
import { fetchHourlyCloses } from '../tools/metrics';

// Proxy hedges: a holding is also hedgeable through a related perps market (MSTR through BTC, a tech stock through
// QQQ, anything else through SPY). The hedge strength is MEASURED, never assumed: the correlation of hourly returns
// over the last 7 days between the holding's own perps market and the proxy (public Aster klines). The planner sizes
// a proxy short as correlation x (holding volatility / proxy volatility) and reports the share of risk a proxy leaves
// (sqrt(1 - rho^2)). SPY and QQQ have their own perps on Aster, so they are hedged directly.

/** Candidate proxies per underlying, best first. Any ticker not listed is tried against SPY then QQQ. */
export const PROXY_CANDIDATES: Record<string, string[]> = {
  MSTR: ['BTC'], COIN: ['BTC'], HOOD: ['BTC', 'QQQ'], CRCL: ['BTC', 'QQQ'],
  SPY: ['QQQ'], QQQ: ['SPY'],
  NVDA: ['QQQ'], AAPL: ['QQQ'], GOOGL: ['QQQ'], META: ['QQQ'], AMZN: ['QQQ'], TSLA: ['QQQ'], NFLX: ['QQQ'],
  MU: ['QQQ'], AMD: ['QQQ'], INTC: ['QQQ'], TSM: ['QQQ'], SKHY: ['QQQ'], SNDK: ['QQQ'], ORCL: ['QQQ'], SOXL: ['QQQ'], DRAM: ['QQQ'],
};
const FALLBACK = ['SPY', 'QQQ'];
/** Below this correlation a proxy removes too little risk to be worth the fees and margin. */
export const MIN_PROXY_CORRELATION = 0.3;
/** Never trust a measured correlation above this: 7 days of hourly data overstates how tight a relation stays. */
export const MAX_PROXY_CORRELATION = 0.95;

export const candidatesFor = (ticker: string): string[] => (PROXY_CANDIDATES[ticker] ?? FALLBACK).filter((v) => v !== ticker);

/** Pearson correlation of hourly log returns, aligned from the most recent close backwards. null below 48 pairs. */
export function returnCorrelation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length); if (n < 49) return null;
  const ra: number[] = []; const rb: number[] = [];
  const A = a.slice(-n); const B = b.slice(-n);
  for (let i = 1; i < n; i++) if (A[i - 1] > 0 && A[i] > 0 && B[i - 1] > 0 && B[i] > 0) { ra.push(Math.log(A[i] / A[i - 1])); rb.push(Math.log(B[i] / B[i - 1])); }
  if (ra.length < 48) return null;
  const ma = ra.reduce((x, y) => x + y, 0) / ra.length; const mb = rb.reduce((x, y) => x + y, 0) / rb.length;
  let sab = 0; let saa = 0; let sbb = 0;
  for (let i = 0; i < ra.length; i++) { const da = ra[i] - ma; const db = rb[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  if (saa <= 0 || sbb <= 0) return null;
  const r = sab / Math.sqrt(saa * sbb);
  return Number.isFinite(r) ? r : null;
}

export interface ProxyPick { via: string; beta: number; price: number }
export type ClosesFn = (n: Network, ticker: string) => Promise<number[]>;

const cache = new Map<string, { at: number; pick: ProxyPick | null }>();
const TTL_MS = 10 * 60_000;
export const clearProxyCache = () => cache.clear();

/**
 * The best measured proxy for `ticker` among its candidates that the perps venue lists (`listed` = its tickers).
 * Returns null when the holding has no perps market to measure against, or no candidate correlates at least
 * MIN_PROXY_CORRELATION.
 */
export async function pickProxy(n: Network, ticker: string, listed: string[], closes: ClosesFn = fetchHourlyCloses, now = Date.now()): Promise<ProxyPick | null> {
  const have = new Set(listed); if (!have.has(ticker)) return null;
  const k = `${n}:${ticker}`; const hit = cache.get(k); if (hit && now - hit.at < TTL_MS) return hit.pick;
  const ownCloses = await closes(n, ticker);
  let best: ProxyPick | null = null;
  for (const via of candidatesFor(ticker)) {
    if (!have.has(via)) continue;
    const vc = await closes(n, via).catch(() => [] as number[]);
    const rho = returnCorrelation(ownCloses, vc);
    if (rho === null || rho < MIN_PROXY_CORRELATION) continue;
    const beta = Math.round(Math.min(rho, MAX_PROXY_CORRELATION) * 100) / 100;
    if (!best || beta > best.beta) best = { via, beta, price: vc[vc.length - 1] };
  }
  cache.set(k, { at: now, pick: best });
  return best;
}
