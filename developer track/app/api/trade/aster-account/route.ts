import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { asterAccountView, asterMaxLeverage } from '@/lib/server/aster';

export const runtime = 'nodejs';

/** GET ?network= → the signed-in wallet's perps account (balances, positions, open orders). state: ok | no_deposit | needs_agent. */
export async function GET(req: Request) {
  return withWallet(async (wallet) => {
    const u = new URL(req.url); const n = netParam(u.searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    // ?ticker=NVDA → { ticker, max } : the highest leverage allowed on that market.
    const ticker = (u.searchParams.get('ticker') ?? '').toUpperCase();
    if (ticker) { if (!/^[A-Z0-9]{1,15}$/.test(ticker)) return json({ error: 'bad ticker' }, 400); return json({ ticker, max: await asterMaxLeverage(n, wallet, ticker) }); }
    return json(await asterAccountView(n, wallet));
  });
}
