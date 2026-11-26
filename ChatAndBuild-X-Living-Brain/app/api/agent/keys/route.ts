import { json } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { withWallet } from '@/lib/server/http';
import { reconcileLighterPending } from '@/lib/server/lighter';

export const runtime = 'nodejs';

/**
 * The signed-in wallet's agent keys — public parts only, never secrets. Active keys come from agent_keys;
 * a registration in progress is reported as `rotating: true` on the active row (or as a 'pending' row when
 * there is no active key yet), so an unfinished rotation never hides the working key.
 */
export async function GET() {
  return withWallet(async (wallet) => {
    const db = getDb();
    for (const n of ['mainnet', 'testnet'] as const) await reconcileLighterPending(n, wallet).catch(() => undefined);
    const active = db.prepare(`SELECT venue, network, account_ref, key_ref, public_key, scope, expires_at, status, created_at
      FROM agent_keys WHERE wallet = ? AND status = 'active' ORDER BY venue, network`).all(wallet.toLowerCase()) as { venue: string; network: string }[];
    const pending = db.prepare(`SELECT venue, network, account_ref, key_ref, public_key, scope, expires_at, created_at
      FROM pending_agent_keys WHERE wallet = ?`).all(wallet.toLowerCase()) as { venue: string; network: string }[];
    const keys = [
      ...active.map((a) => ({ ...a, rotating: pending.some((p) => p.venue === a.venue && p.network === a.network) })),
      ...pending.filter((p) => !active.some((a) => a.venue === p.venue && a.network === p.network)).map((p) => ({ ...p, status: 'pending' })),
    ];
    return json({ keys });
  });
}

export async function DELETE(req: Request) {
  return withWallet(async (wallet) => {
    const u = new URL(req.url);
    const args = [wallet.toLowerCase(), u.searchParams.get('venue') ?? '', u.searchParams.get('network') ?? ''];
    getDb().prepare('DELETE FROM agent_keys WHERE wallet = ? AND venue = ? AND network = ?').run(...args);
    getDb().prepare('DELETE FROM pending_agent_keys WHERE wallet = ? AND venue = ? AND network = ?').run(...args);
    // NOTE: this only forgets the key locally. To revoke at the venue, rotate (re-register) the
    // Lighter key index, or re-register the Derive key with a short expiry — see docs/AGENT.md.
    return json({ ok: true });
  });
}
