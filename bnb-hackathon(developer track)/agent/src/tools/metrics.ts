import { asterSymbol } from '../../../lib/aster';
import { config } from '../config';
import type { Network } from '../types';
import { publicGet } from './aster';
import { medianLatency } from './store';

/**
 * Realised 1h volatility of a perps market: standard deviation of 1-minute log returns over the last hour,
 * scaled by sqrt(60). Returned as a fraction (0.041 = 4.1%). null if there is not enough data (fail closed).
 */
export function realizedVol1h(closes: number[]): number | null {
  if (closes.length < 20) return null;
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0 && closes[i] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 19) return null;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance) * Math.sqrt(60);
}

/** 1-minute closes of a perps (Aster) market for the last `minutes` minutes, oldest first. */
export async function fetchCloses(n: Network, ticker: string, minutes = 61): Promise<number[]> {
  const rows = await publicGet<unknown[][]>(n, '/fapi/v1/klines', { symbol: asterSymbol(ticker), interval: '1m', limit: minutes });
  if (!Array.isArray(rows)) throw new Error('perps klines unavailable');
  return rows.map((r) => ({ t: Number(r[0]), c: Number(r[4]) })).sort((a, b) => a.t - b.t).map((x) => x.c);
}

export const vol1h = async (n: Network, ticker: string): Promise<number | null> => realizedVol1h(await fetchCloses(n, ticker));

/** Seconds a top-up takes to land: the agent's own measured median, else the configured default. */
export function topUpLatencySec(venue: string): { sec: number; measured: boolean } {
  const m = medianLatency(venue);
  return m === null ? { sec: config().DEFAULT_LATENCY_SEC, measured: false } : { sec: m, measured: true };
}

/** Hourly closes for the last `hours` hours of a perps (Aster) market, oldest first (public klines). */
export async function fetchHourlyCloses(n: Network, ticker: string, hours = 168): Promise<number[]> {
  const rows = await publicGet<unknown[][]>(n, '/fapi/v1/klines', { symbol: asterSymbol(ticker), interval: '1h', limit: Math.min(1500, hours) });
  if (!Array.isArray(rows)) throw new Error('perps klines unavailable');
  return rows.map((r) => ({ t: Number(r[0]), c: Number(r[4]) })).sort((a, b) => a.t - b.t).map((x) => x.c);
}

/**
 * Daily volatility from hourly closes: standard deviation of hourly log returns x sqrt(24).
 * Needs at least 48 hourly closes (two days) or it returns null so the agent fails closed.
 */
export function sigmaDayFromHourly(closes: number[]): number | null {
  if (closes.length < 48) return null;
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0 && closes[i] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  if (r.length < 47) return null;
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  const s = Math.sqrt(variance) * Math.sqrt(24);
  return Number.isFinite(s) && s > 0 ? s : null;
}
