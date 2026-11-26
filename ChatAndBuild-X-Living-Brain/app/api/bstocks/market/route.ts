import { BSTOCKS_BSC, bstockBySymbol } from '@/lib/bstocks';
import { cached } from '@/lib/server/cache';

// Binance public market data for bStocks (reference prices, book, candles, trades).
// Execution happens on PancakeSwap V3 on BSC; this is the deepest public price signal.
const BINANCE = 'https://api.binance.com/api/v3';
const INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d', '1w']);

async function bget<T>(path: string): Promise<T> {
  const r = await fetch(`${BINANCE}${path}`, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
  if (!r.ok) throw new Error(`binance ${r.status}`);
  return (await r.json()) as T;
}

interface Ticker24h { symbol: string; lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string; priceChange: string }

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') ?? 'tickers';
  try {
    if (kind === 'tickers') {
      const symbols = JSON.stringify(BSTOCKS_BSC.map((t) => `${t.symbol}USDT`));
      const data = await cached('tickers', 3_000, () => bget<Ticker24h[]>(`/ticker/24hr?symbols=${encodeURIComponent(symbols)}`));
      const bySym = new Map(data.map((d) => [d.symbol, d]));
      return Response.json(BSTOCKS_BSC.map((t) => {
        const d = bySym.get(`${t.symbol}USDT`);
        return {
          symbol: t.symbol, name: t.displayName, address: t.address, liquidityUsd: t.observedLiquidityUsd,
          price: d ? Number(d.lastPrice) : null, change: d ? Number(d.priceChange) : null,
          changePct: d ? Number(d.priceChangePercent) : null, high: d ? Number(d.highPrice) : null,
          low: d ? Number(d.lowPrice) : null, volumeUsd: d ? Number(d.quoteVolume) : null,
        };
      }));
    }
    const symbol = url.searchParams.get('symbol') ?? '';
    const tok = bstockBySymbol(symbol);
    if (!tok) return Response.json({ error: 'unknown bStock' }, { status: 400 });
    const pair = `${tok.symbol}USDT`;
    if (kind === 'depth') {
      const d = await cached(`depth:${pair}`, 1_000, () => bget<{ bids: [string, string][]; asks: [string, string][] }>(`/depth?symbol=${pair}&limit=20`));
      return Response.json({ bids: d.bids.map(([p, q]) => [Number(p), Number(q)]), asks: d.asks.map(([p, q]) => [Number(p), Number(q)]) });
    }
    if (kind === 'trades') {
      const d = await cached(`trades:${pair}`, 1_500, () => bget<{ id: number; price: string; qty: string; time: number; isBuyerMaker: boolean }[]>(`/trades?symbol=${pair}&limit=40`));
      return Response.json(d.reverse().map((t) => ({ id: t.id, price: Number(t.price), size: Number(t.qty), time: t.time, side: t.isBuyerMaker ? 'sell' : 'buy' })));
    }
    if (kind === 'klines') {
      const interval = url.searchParams.get('interval') ?? '1h';
      if (!INTERVALS.has(interval)) return Response.json({ error: 'bad interval' }, { status: 400 });
      const d = await cached(`k:${pair}:${interval}`, 5_000, () => bget<[number, string, string, string, string, string][]>(`/klines?symbol=${pair}&interval=${interval}&limit=500`));
      return Response.json(d.map((k) => ({ time: Math.floor(k[0] / 1000), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) })));
    }
    return Response.json({ error: 'unknown kind' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
