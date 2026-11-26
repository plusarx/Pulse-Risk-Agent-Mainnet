import { json, sessionWallet } from '@/lib/server/auth';
import { netParam } from '@/lib/server/http';
import { readConfig } from '@/lib/server/agent-store';
import { cached } from '@/lib/server/cache';
import { BSTOCKS_BSC } from '@/lib/bstocks';
import { assessBStocksCached } from '@/lib/integrity-sources';
import { referenceFromTickers, SIGNED_OUT_BASE_HAIRCUT } from '@/lib/integrity-view';

export const dynamic = 'force-dynamic';

// Same Binance call and cache key as /api/bstocks/market?kind=tickers, so the two share one upstream fetch.
async function binanceTickers(): Promise<{ symbol: string; lastPrice: string }[]> {
  const symbols = JSON.stringify(BSTOCKS_BSC.map((t) => `${t.symbol}USDT`));
  return cached('tickers', 3_000, async () => {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbols)}`, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    if (!r.ok) throw new Error(`binance ${r.status}`);
    return (await r.json()) as { symbol: string; lastPrice: string }[];
  });
}

/** Price integrity per bStock. Never fails on a source problem: missing sources come back in `problems`. */
export async function GET(req: Request) {
  let enabled = true; let base = SIGNED_OUT_BASE_HAIRCUT;
  try {
    const wallet = await sessionWallet();
    const n = netParam(new URL(req.url).searchParams.get('network')) ?? 'mainnet';
    if (wallet) { const c = readConfig(wallet, n); enabled = c.integrity.enabled; base = c.collateral.bstockHaircut; }
  } catch { /* keep the defaults */ }
  if (!enabled) return json({ enabled: false, at: Date.now(), items: [], problems: [] });   // off: no upstream traffic
  try {
    const reference = referenceFromTickers(await binanceTickers().catch(() => null));
    const snap = await assessBStocksCached({ atlasKey: process.env.ATLAS_API_KEY ?? null, reference, baseHaircut: base });
    return json({ enabled, at: snap.at, items: snap.items, problems: snap.problems });
  } catch (e) {
    console.error('[integrity]', e instanceof Error ? e.message : String(e));
    return json({ enabled, at: Date.now(), items: [], problems: ['price integrity could not be computed'] });
  }
}
