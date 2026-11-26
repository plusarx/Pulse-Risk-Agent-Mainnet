import { json } from '@/lib/server/auth';
import { netParam, withWallet } from '@/lib/server/http';
import { listEvents } from '@/lib/server/agent-store';

export async function GET(req: Request) {
  return withWallet(async (wallet) => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    return json({ events: listEvents(wallet, n) });
  });
}
