import { json } from '@/lib/server/auth';
import { withAgent } from '@/lib/server/agent-auth';
import { netParam } from '@/lib/server/http';
import { readConfig } from '@/lib/server/agent-store';

export async function GET(req: Request) {
  return withAgent(async () => {
    const u = new URL(req.url);
    const n = netParam(u.searchParams.get('network'));
    const wallet = u.searchParams.get('wallet') ?? '';
    if (!n || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: 'wallet, network required' }, 400);
    return json({ config: readConfig(wallet, n) });
  });
}
