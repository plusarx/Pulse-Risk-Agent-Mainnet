import 'server-only';
import type { VenueNetwork } from '@/lib/network';
import { getDb } from './db';

// Pending (in-progress) agent-key registrations. Never touches agent_keys until promote(), so a started,
// cancelled or failed rotation leaves the working key in place.

export type Venue = 'aster' | 'lighter' | 'derive';
export interface PendingRow { account_ref: string; key_ref: string; public_key: string; enc_secret: string; scope: string | null; expires_at: number | null; meta: string | null }

export function writePending(wallet: string, venue: Venue, n: VenueNetwork, r: PendingRow): void {
  getDb().prepare(`INSERT OR REPLACE INTO pending_agent_keys (wallet, venue, network, account_ref, key_ref, public_key, enc_secret, scope, expires_at, meta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(wallet.toLowerCase(), venue, n, r.account_ref, r.key_ref, r.public_key, r.enc_secret, r.scope, r.expires_at, r.meta, Date.now());
}

export function readPending(wallet: string, venue: Venue, n: VenueNetwork): PendingRow | undefined {
  return getDb().prepare('SELECT account_ref, key_ref, public_key, enc_secret, scope, expires_at, meta FROM pending_agent_keys WHERE wallet = ? AND venue = ? AND network = ?')
    .get(wallet.toLowerCase(), venue, n) as PendingRow | undefined;
}

/** The venue confirmed the new key: it becomes THE active key (replacing any previous one) atomically. */
export function promotePending(wallet: string, venue: Venue, n: VenueNetwork, override: { account_ref?: string; meta: string }): void {
  const db = getDb();
  const p = readPending(wallet, venue, n);
  if (!p) throw new Error('No pending registration — start again');
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT OR REPLACE INTO agent_keys (wallet, venue, network, account_ref, key_ref, public_key, enc_secret, scope, expires_at, meta, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
      .run(wallet.toLowerCase(), venue, n, override.account_ref ?? p.account_ref, p.key_ref, p.public_key, p.enc_secret, p.scope, p.expires_at, override.meta, Date.now());
    db.prepare('DELETE FROM pending_agent_keys WHERE wallet = ? AND venue = ? AND network = ?').run(wallet.toLowerCase(), venue, n);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function hasPending(wallet: string, venue: Venue, n: VenueNetwork): boolean {
  return !!readPending(wallet, venue, n);
}
