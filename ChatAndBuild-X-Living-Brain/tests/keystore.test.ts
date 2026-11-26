import { describe, expect, it, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Regression: starting a key rotation used to OVERWRITE the working key with an unconfirmed pending one,
// so an abandoned rotation left the user with no agent key. Pending must live apart until promoted.
beforeAll(() => { process.env.DB_PATH = path.join(mkdtempSync(path.join(tmpdir(), 'pxks-')), 't.db'); });

const W = '0x00000000000000000000000000000000000000a1';
const row = (k: string) => ({ account_ref: '88346', key_ref: k, public_key: k, enc_secret: 'blob', scope: 'trade:all', expires_at: 1, meta: '{}' });

describe('keystore', () => {
  it('a started rotation never touches the active key; promote swaps atomically', async () => {
    const { getDb } = await import('@/lib/server/db');
    const ks = await import('@/lib/server/keystore');
    const db = getDb();
    db.prepare(`INSERT INTO agent_keys (wallet, venue, network, account_ref, key_ref, public_key, enc_secret, scope, expires_at, meta, status, created_at)
      VALUES (?, 'derive', 'testnet', '88346', '0xOLD', '0xOLD', 'blob', 'trade:all', 1, '{}', 'active', 1)`).run(W);
    const active = () => db.prepare("SELECT key_ref, status FROM agent_keys WHERE wallet = ? AND venue = 'derive'").get(W) as { key_ref: string; status: string };

    ks.writePending(W, 'derive', 'testnet', row('0xNEW'));       // user clicks Rotate…
    expect(active()).toEqual({ key_ref: '0xOLD', status: 'active' }); // …and abandons: old key still works
    expect(ks.hasPending(W, 'derive', 'testnet')).toBe(true);

    ks.promotePending(W, 'derive', 'testnet', { meta: '{"ok":true}' }); // venue confirmed the new key
    expect(active()).toEqual({ key_ref: '0xNEW', status: 'active' });
    expect(ks.hasPending(W, 'derive', 'testnet')).toBe(false);
    expect(() => ks.promotePending(W, 'derive', 'testnet', { meta: '{}' })).toThrow(/No pending/);
  });
});
