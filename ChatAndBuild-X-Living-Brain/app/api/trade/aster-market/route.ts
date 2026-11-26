import { json } from '@/lib/server/auth';
import { netParam } from '@/lib/server/http';
import { asterDepth, asterKlines, asterMarkets, asterRecentTrades } from '@/lib/server/aster';

export const runtime = 'nodejs';

/**
 * Public perps market data (no sign-in):
 * GET ?network=&kind=markets | kind=klines&ticker=&interval= | kind=depth&ticker= | kind=trades&ticker=
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const n = netParam(q.get('network'));
  if (!n) return json({ error: 'network required' }, 400);
  const kind = q.get('kind');
  const ticker = (q.get('ticker') ?? '').toUpperCase();
  try {
    if (kind === 'markets') return json({ markets: await asterMarkets(n) });
    if (!/^[A-Z0-9]{1,15}$/.test(ticker)) return json({ error: 'ticker required' }, 400);
    if (kind === 'klines') return json({ candles: await asterKlines(n, ticker, q.get('interval') ?? '1h') });
    if (kind === 'depth') return json(await asterDepth(n, ticker));
    if (kind === 'trades') return json({ trades: await asterRecentTrades(n, ticker) });
    return json({ error: 'kind must be markets|klines|depth|trades' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[aster-market]', msg);
    return json({ error: msg }, 502);
  }
}
