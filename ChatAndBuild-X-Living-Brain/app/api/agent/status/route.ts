import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { readStatus } from '@/lib/server/agent-status';

export async function GET(req: Request) {
  return withWallet(async (wallet) => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    return json(readStatus(wallet, n) ?? { status: null, updated_at: null });
  });
}
