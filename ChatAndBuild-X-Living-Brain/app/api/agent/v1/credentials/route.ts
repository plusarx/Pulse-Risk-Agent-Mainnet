import { json } from '@/lib/server/auth';
import { withAgent } from '@/lib/server/agent-auth';
import { getDb } from '@/lib/server/db';
import { decryptSecret } from '@/lib/server/crypto';
import { netParam } from '@/lib/server/http';

/**
 * Agent service: decrypted agent key for one wallet/venue/network.
 * Aster → { user, agentAddress, agentPrivateKey, expiresAt } (row: account_ref = user wallet, key_ref = agent address, secret = agent key);
 * Lighter (dormant) → { accountIndex, apiKeyIndex, apiPrivateKey } ; Derive → { subaccountId, sessionKeyAddress, sessionPrivateKey }.
 */
export async function GET(req: Request) {
  return withAgent(async () => {
    const u = new URL(req.url);
    const n = netParam(u.searchParams.get('network'));
    const venue = u.searchParams.get('venue');
    const wallet = (u.searchParams.get('wallet') ?? '').toLowerCase();
    if (!n || (venue !== 'aster' && venue !== 'lighter' && venue !== 'derive') || !/^0x[0-9a-f]{40}$/.test(wallet)) return json({ error: 'wallet, venue, network required' }, 400);
    const row = getDb().prepare("SELECT account_ref, key_ref, public_key, enc_secret, scope, expires_at FROM agent_keys WHERE wallet = ? AND venue = ? AND network = ? AND status = 'active'")
      .get(wallet, venue, n) as { account_ref: string; key_ref: string; public_key: string; enc_secret: string; scope: string; expires_at: number | null } | undefined;
    if (!row) return json({ error: 'no active key' }, 404);
    const secret = decryptSecret(row.enc_secret, `${venue}|${n}|${wallet}`);
    if (venue === 'aster') return json({ venue, network: n, wallet, user: row.account_ref, agentAddress: row.key_ref, agentPrivateKey: secret, scope: row.scope, expiresAt: row.expires_at });
    return json(venue === 'lighter'
      ? { venue, network: n, wallet, accountIndex: Number(row.account_ref), apiKeyIndex: Number(row.key_ref), publicKey: row.public_key, apiPrivateKey: secret, scope: row.scope }
      : { venue, network: n, wallet, subaccountId: Number(row.account_ref), sessionKeyAddress: row.key_ref, sessionPrivateKey: secret, scope: row.scope, expiresAt: row.expires_at });
  });
}
