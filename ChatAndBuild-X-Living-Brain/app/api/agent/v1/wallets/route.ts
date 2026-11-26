import { json } from '@/lib/server/auth';
import { withAgent } from '@/lib/server/agent-auth';
import { getDb } from '@/lib/server/db';
import { netParam } from '@/lib/server/http';
import { readConfig } from '@/lib/server/agent-store';

/** Agent service: every wallet with an active key or a saved config on this network. */
export async function GET(req: Request) {
  return withAgent(async () => {
    const n = netParam(new URL(req.url).searchParams.get('network'));
    if (!n) return json({ error: 'network required' }, 400);
    const db = getDb();
    const wallets = db.prepare(`SELECT wallet FROM agent_keys WHERE network = ? AND status = 'active' UNION SELECT wallet FROM agent_config WHERE network = ?`).all(n, n) as { wallet: string }[];
    return json({ wallets: wallets.map(({ wallet }) => ({
      wallet,
      keys: db.prepare("SELECT venue, account_ref AS accountRef, key_ref AS keyRef, status, expires_at AS expiresAt FROM agent_keys WHERE wallet = ? AND network = ?").all(wallet, n),
      config: readConfig(wallet, n),
    })) });
  });
}
