import type { AgentConfig } from '../../../lib/agent-config';
import { bstockBySymbol } from '../../../lib/bstocks';
import type { MarketData, Network } from '../types';
import { fetchHourlyCloses, sigmaDayFromHourly } from '../tools/metrics';

// Reads what the risk engine needs from the market: daily volatility per held ticker (from the perps venue's hourly
// klines). A ticker with no usable volatility is reported as a problem and left out: the agent never guesses.

export const tickerOf = (bstock: string): string => bstockBySymbol(bstock)?.underlying ?? bstock.replace(/B$/, '');

/** Daily volatility of a perps market by ticker (fraction), or null when there is not enough history. */
export type SigmaFn = (n: Network, ticker: string) => Promise<number | null>;
export const realSigma: SigmaFn = async (n, ticker) => sigmaDayFromHourly(await fetchHourlyCloses(n, ticker));

const cache = new Map<string, { at: number; sigma: number }>();
const TTL_MS = 10 * 60_000;
export const clearMarketCache = () => cache.clear();

export async function collectMarket(n: Network, hedge: AgentConfig['hedge'], held: Set<string>, sigma: SigmaFn = realSigma, now = Date.now()): Promise<{ market: MarketData; problems: string[]; unassessed: Record<string, string> }> {
  const sigmaDay: Record<string, number> = {}; const problems: string[] = []; const unassessed: Record<string, string> = {};
  await Promise.all(hedge.legs.filter((l) => held.has(l.bstock) && l.venue === 'aster' && l.kind === 'perp').map(async (leg) => {
    const ticker = tickerOf(leg.bstock); const k = `${n}:${leg.market}`; const hit = cache.get(k);
    if (hit && now - hit.at < TTL_MS) { sigmaDay[ticker] = hit.sigma; return; }
    try {
      const s = await sigma(n, leg.market);
      if (s === null) { unassessed[ticker] = 'not enough price history to measure its volatility'; return; }
      cache.set(k, { at: now, sigma: s }); sigmaDay[ticker] = s;
    } catch (e) { unassessed[ticker] = `its volatility is unavailable (${e instanceof Error ? e.message : String(e)})`; }
  }));
  return { market: { sigmaDay, at: new Date(now).toISOString() }, problems, unassessed };
}
