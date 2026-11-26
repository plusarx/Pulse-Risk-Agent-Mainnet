import { isHex } from 'viem';
import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { lighterOrderHistory } from '@/lib/server/lighter';
import { deriveOrderHistory } from '@/lib/server/derive';
import { asterOrderHistory } from '@/lib/server/aster';
import { recordSpotTrade, spotHistory } from '@/lib/server/spot-history';

export const runtime = 'nodejs';

/**
 * GET ?venue=aster|lighter|derive&network=  → past orders from the venue (filled, canceled with the reason, …), newest first.
 * GET ?venue=bstocks                  → bStock swaps made through the app (BNB Chain mainnet).
 * POST { txHash }                     → record a bStock swap; it is read back from the chain and must be your own.
 */
export async function GET(req: Request) {
  return withWallet(async (wallet) => {
    const q = new URL(req.url).searchParams;
    const venue = q.get('venue');
    if (venue === 'bstocks') return json({ rows: spotHistory(wallet) });
    const n = netParam(q.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    if (venue === 'aster') return json({ rows: await asterOrderHistory(n, wallet) });
    if (venue === 'lighter') return json({ rows: await lighterOrderHistory(n, wallet) });
    if (venue === 'derive') return json({ rows: await deriveOrderHistory(n, wallet) });
    return json({ error: 'venue must be aster|lighter|derive|bstocks' }, 400);
  });
}

export async function POST(req: Request) {
  return withWallet(async (wallet) => {
    const b = (await req.json().catch(() => ({}))) as { txHash?: string };
    if (!b.txHash || !isHex(b.txHash) || b.txHash.length !== 66) return json({ error: 'txHash required' }, 400);
    return json({ row: await recordSpotTrade(wallet, b.txHash) });
  });
}
