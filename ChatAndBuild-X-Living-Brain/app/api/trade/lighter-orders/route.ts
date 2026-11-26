import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { getDb } from '@/lib/server/db';
import { getLighterActiveOrders } from '@/lib/server/lighter';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  return withWallet(async (wallet) => {
    const u = new URL(req.url);
    const n = netParam(u.searchParams.get('network'));
    const m = Number(u.searchParams.get('market_id'));
    const a = u.searchParams.get('account');
    if (!n) return json({ error: 'network required' }, 400);
    const row = getDb().prepare("SELECT status FROM agent_keys WHERE wallet = ? AND venue = 'lighter' AND network = ?").get(wallet.toLowerCase(), n) as { status: string } | undefined;
    if (row?.status !== 'active') return json({ orders: [], needsAgent: true });
    return json({ orders: await getLighterActiveOrders(n, wallet, u.searchParams.has('market_id') && Number.isInteger(m) && m >= 0 ? [m] : [], a !== null && /^\d+$/.test(a) ? Number(a) : undefined) });
  });
}
