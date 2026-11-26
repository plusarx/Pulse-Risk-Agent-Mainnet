import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config';

// Our own record of every Living Brain call (Living Brain has no credit-balance API): what was sent, what it is estimated to cost, and which notes
// were already saved (so a retry or a repeated sentence is never paid for twice). Never holds a key. Notes hold only the short text the user stated.

export type Op = 'capture' | 'recall' | 'forget';

export interface Ledger {
  seen(wallet: string, ref: string): boolean;
  record(wallet: string, op: Op, ref: string, costUsd: number): void;
  spentUsd(): number;
  count(wallet: string, op: Op): number;
  close(): void;
}

export function openLedger(path: string): Ledger {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS memory_ops (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, wallet TEXT NOT NULL, op TEXT NOT NULL, ref TEXT NOT NULL, cost_usd REAL NOT NULL)');
  db.exec('CREATE INDEX IF NOT EXISTS ix_memory_ops_wallet ON memory_ops (wallet, op)');
  const w = (x: string) => x.toLowerCase();
  return {
    // Saved before, and not forgotten since: after a forget the same sentence must be saveable again.
    seen: (wallet, ref) => !!db.prepare("SELECT 1 FROM memory_ops WHERE wallet = ? AND op = 'capture' AND ref = ? AND id > COALESCE((SELECT MAX(id) FROM memory_ops WHERE wallet = ? AND op = 'forget'), 0)").get(w(wallet), ref, w(wallet)),
    record: (wallet, op, ref, cost) => { db.prepare('INSERT INTO memory_ops (at, wallet, op, ref, cost_usd) VALUES (?, ?, ?, ?, ?)').run(Date.now(), w(wallet), op, ref, cost); },
    spentUsd: () => Number((db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM memory_ops').get() as { s: number }).s),
    count: (wallet, op) => Number((db.prepare('SELECT COUNT(*) AS n FROM memory_ops WHERE wallet = ? AND op = ?').get(w(wallet), op) as { n: number }).n),
    close: () => db.close(),
  };
}

let shared: Ledger | null = null;
export const sharedLedger = (): Ledger => (shared ??= openLedger(config().MEMORY_DB_PATH));
export function setLedgerForTests(l?: Ledger) { if (shared && shared !== l) shared.close(); shared = l ?? null; }
