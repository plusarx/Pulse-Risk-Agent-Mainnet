import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { once } from '@/lib/server/idempotency';
import { asterSpotToFutures } from '@/lib/server/aster';

export const runtime = 'nodejs';

/**
 * POST { network, amount } + Idempotency-Key → move USDT from the wallet's own perps SPOT balance to FUTURES.
 * UNVERIFIED on BNB Chain: the funding page calls this only if a deposit has not shown up as margin after ~90 s.
 */
export async function POST(req: Request) {
  return withWallet(async (wallet) => {
    const idem = req.headers.get('idempotency-key');
    if (!idem || idem.length < 8 || idem.length > 80) return json({ error: 'Idempotency-Key header required' }, 400);
    const b = (await req.json().catch(() => ({}))) as { network?: string; amount?: string };
    const n = netParam(b.network);
    if (!n) return json({ error: 'network must be mainnet|testnet' }, 400);
    const amount = String(b.amount ?? '');
    return json(await once(`${wallet}:aster-transfer:${n}:${idem}`, () => asterSpotToFutures(n, wallet, amount)));
  });
}
