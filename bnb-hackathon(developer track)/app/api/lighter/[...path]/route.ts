import { LIGHTER } from '@/lib/venues';
import { netParam } from '@/lib/server/http';
import { cached } from '@/lib/server/cache';

// Public, read-only Lighter proxy (allowlisted paths). Private calls go through /api/trade/*.
const ALLOW: Record<string, number> = {
  orderBooks: 30_000, orderBookDetails: 3_000, orderBookOrders: 1_000, candles: 5_000, recentTrades: 1_500,
  accountsByL1Address: 3_000, account: 2_000, faucet: 60_000, fundings: 30_000, 'funding-rates': 30_000, exchangeStats: 10_000,
};

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const p = path.join('/');
  const ttl = ALLOW[p];
  if (ttl === undefined) return Response.json({ error: 'not allowed' }, { status: 404 });
  const u = new URL(req.url);
  const n = netParam(u.searchParams.get('network')) ?? 'mainnet';
  u.searchParams.delete('network');
  const target = `${LIGHTER[n].rest}/api/v1/${p}?${u.searchParams.toString()}`;
  try {
    const data = await cached(target, ttl, async () => {
      const r = await fetch(target, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
      const text = await r.text();
      try { return { status: r.status, body: JSON.parse(text) as unknown }; } catch {
        // Not JSON ("404 page not found", gateway HTML): the venue API itself is down. Don't cache it.
        throw new Error(`venue_unavailable:${r.status}`);
      }
    });
    return Response.json(data.body, { status: data.status });
  } catch (e) {
    const m = (e as Error).message;
    if (m.startsWith('venue_unavailable:')) {
      return Response.json({ error: `The perps venue's ${n} API is unavailable right now (HTTP ${m.split(':')[1]})`, unavailable: true }, { status: 503 });
    }
    return Response.json({ error: m }, { status: 502 });
  }
}
