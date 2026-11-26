import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Local agent memory: move log (for the 24h cap), in-flight locks, and idempotency keys for external steps.
// Node's built-in SQLite, same as the app. Pass ':memory:' in tests.

let db: DatabaseSync | null = null;

export function openStore(file: string): DatabaseSync {
  if (db) return db;
  if (file !== ':memory:') mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS moves (id INTEGER PRIMARY KEY, wallet TEXT, network TEXT, rule_key TEXT, direction TEXT, amount_base TEXT, at INTEGER);
    CREATE TABLE IF NOT EXISTS locks (key TEXT PRIMARY KEY, at INTEGER);
    CREATE TABLE IF NOT EXISTS steps (key TEXT PRIMARY KEY, status TEXT, ref TEXT, at INTEGER);
    CREATE TABLE IF NOT EXISTS latency (id INTEGER PRIMARY KEY, venue TEXT, sec REAL, at INTEGER);
    CREATE INDEX IF NOT EXISTS moves_idx ON moves (wallet, network, rule_key, at);
  `);
  return db;
}

export function closeStore() { db?.close(); db = null; policyReady = false; putsReady = false; }
const d = () => { if (!db) throw new Error('store not opened'); return db; };

export function logMove(wallet: string, network: string, ruleKey: string, direction: 'in' | 'out', amountBase: string, at = Date.now()) {
  d().prepare('INSERT INTO moves (wallet, network, rule_key, direction, amount_base, at) VALUES (?,?,?,?,?,?)').run(wallet.toLowerCase(), network, ruleKey, direction, amountBase, at);
}

/** Sum of base units moved by the agent for this rule (both directions) in the last 24 h. */
export function moved24h(wallet: string, network: string, ruleKey: string, now = Date.now()): bigint {
  const rows = d().prepare('SELECT amount_base FROM moves WHERE wallet = ? AND network = ? AND rule_key = ? AND at > ?').all(wallet.toLowerCase(), network, ruleKey, now - 86_400_000) as { amount_base: string }[];
  return rows.reduce((a, r) => a + BigInt(r.amount_base), 0n);
}

const LOCK_TTL_MS = 30 * 60_000;

/** One move in flight per key. Returns false if one is already running (stale locks expire after 30 min). */
export function acquireLock(key: string, now = Date.now()): boolean {
  const row = d().prepare('SELECT at FROM locks WHERE key = ?').get(key) as { at: number } | undefined;
  if (row && now - row.at < LOCK_TTL_MS) return false;
  d().prepare('INSERT OR REPLACE INTO locks (key, at) VALUES (?, ?)').run(key, now);
  return true;
}
export function isLocked(key: string, now = Date.now()): boolean {
  const row = d().prepare('SELECT at FROM locks WHERE key = ?').get(key) as { at: number } | undefined;
  return !!row && now - row.at < LOCK_TTL_MS;
}
export function releaseLock(key: string) { d().prepare('DELETE FROM locks WHERE key = ?').run(key); }

export interface StepRow { status: string; ref: string | null }
export function getStep(key: string): StepRow | undefined {
  return d().prepare('SELECT status, ref FROM steps WHERE key = ?').get(key) as StepRow | undefined;
}
export function saveStep(key: string, status: string, ref?: string) {
  d().prepare('INSERT OR REPLACE INTO steps (key, status, ref, at) VALUES (?,?,?,?)').run(key, status, ref ?? null, Date.now());
}

/** Record how long a top-up took to land (seconds), so proposals use measured latency, not a guess. */
export function recordLatency(venue: string, sec: number, at = Date.now()) {
  d().prepare('INSERT INTO latency (venue, sec, at) VALUES (?,?,?)').run(venue, sec, at);
}
/** Median of the last 10 measured latencies for a venue, or null if none yet. */
export function medianLatency(venue: string): number | null {
  const rows = d().prepare('SELECT sec FROM latency WHERE venue = ? ORDER BY id DESC LIMIT 10').all(venue) as { sec: number }[];
  if (!rows.length) return null;
  const xs = rows.map((r) => r.sec).sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];
}

// ── Policy-engine memory: today's hedge notional, the day's equity baseline (for the daily loss cap), and the
// anomaly counters (many intents or repeated refusals in a short window pause the agent). ──────────────────

let policyReady = false;
function policyTables() {
  if (policyReady) return;
  d().exec(`
    CREATE TABLE IF NOT EXISTS notional (id INTEGER PRIMARY KEY, wallet TEXT, network TEXT, usd REAL, at INTEGER);
    CREATE TABLE IF NOT EXISTS equity_base (wallet TEXT, network TEXT, day TEXT, usd REAL, PRIMARY KEY (wallet, network, day));
    CREATE TABLE IF NOT EXISTS anomalies (id INTEGER PRIMARY KEY, wallet TEXT, network TEXT, kind TEXT, at INTEGER);
    CREATE TABLE IF NOT EXISTS pauses (wallet TEXT, network TEXT, until INTEGER, reason TEXT, PRIMARY KEY (wallet, network));
  `);
  policyReady = true;
}
export const resetPolicyTablesFlag = () => { policyReady = false; };

export function logNotional(wallet: string, network: string, usd: number, at = Date.now()) {
  policyTables(); d().prepare('INSERT INTO notional (wallet, network, usd, at) VALUES (?,?,?,?)').run(wallet.toLowerCase(), network, usd, at);
}
/** Hedge notional placed in the last 24 h. */
export function notional24h(wallet: string, network: string, now = Date.now()): number {
  policyTables();
  const r = d().prepare('SELECT COALESCE(SUM(usd), 0) AS s FROM notional WHERE wallet = ? AND network = ? AND at > ?').get(wallet.toLowerCase(), network, now - 86_400_000) as { s: number };
  return r.s;
}

/** Equity at the first reading of the UTC day, and the loss since then (0 when up). */
export function dailyLoss(wallet: string, network: string, equityUsd: number, now = Date.now()): { baselineUsd: number; lossUsd: number } {
  policyTables();
  const day = new Date(now).toISOString().slice(0, 10); const w = wallet.toLowerCase();
  const row = d().prepare('SELECT usd FROM equity_base WHERE wallet = ? AND network = ? AND day = ?').get(w, network, day) as { usd: number } | undefined;
  if (!row) { d().prepare('INSERT INTO equity_base (wallet, network, day, usd) VALUES (?,?,?,?)').run(w, network, day, equityUsd); return { baselineUsd: equityUsd, lossUsd: 0 }; }
  return { baselineUsd: row.usd, lossUsd: Math.max(0, row.usd - equityUsd) };
}

export type AnomalyKind = 'intent' | 'refused' | 'injection';
export function recordAnomaly(wallet: string, network: string, kind: AnomalyKind, at = Date.now()) {
  policyTables(); d().prepare('INSERT INTO anomalies (wallet, network, kind, at) VALUES (?,?,?,?)').run(wallet.toLowerCase(), network, kind, at);
}
export function anomalyCount(wallet: string, network: string, kind: AnomalyKind, windowMs: number, now = Date.now()): number {
  policyTables();
  const r = d().prepare('SELECT COUNT(*) AS n FROM anomalies WHERE wallet = ? AND network = ? AND kind = ? AND at > ?').get(wallet.toLowerCase(), network, kind, now - windowMs) as { n: number };
  return r.n;
}
export function pauseAgent(wallet: string, network: string, reason: string, untilMs: number) {
  policyTables(); d().prepare('INSERT OR REPLACE INTO pauses (wallet, network, until, reason) VALUES (?,?,?,?)').run(wallet.toLowerCase(), network, untilMs, reason);
}
export function pausedReason(wallet: string, network: string, now = Date.now()): string | null {
  policyTables();
  const r = d().prepare('SELECT until, reason FROM pauses WHERE wallet = ? AND network = ?').get(wallet.toLowerCase(), network) as { until: number; reason: string } | undefined;
  return r && r.until > now ? r.reason : null;
}
export function clearPause(wallet: string, network: string) { policyTables(); d().prepare('DELETE FROM pauses WHERE wallet = ? AND network = ?').run(wallet.toLowerCase(), network); }

/** Puts the agent bought, so they count as hedges until they expire (Derive positions are not read yet). */
let putsReady = false;
function putsTable() { if (putsReady) return; d().exec('CREATE TABLE IF NOT EXISTS puts (id INTEGER PRIMARY KEY, wallet TEXT, network TEXT, ticker TEXT, notional REAL, expiry TEXT, at INTEGER)'); putsReady = true; }
export function logPut(wallet: string, network: string, ticker: string, notionalUsd: number, expiry: string) { putsTable(); d().prepare('INSERT INTO puts (wallet, network, ticker, notional, expiry, at) VALUES (?,?,?,?,?,?)').run(wallet.toLowerCase(), network, ticker, notionalUsd, expiry, Date.now()); }
export function openPuts(wallet: string, network: string, now = Date.now()): { ticker: string; notionalUsd: number; expiry: string }[] {
  putsTable();
  return (d().prepare('SELECT ticker, notional, expiry FROM puts WHERE wallet = ? AND network = ?').all(wallet.toLowerCase(), network) as { ticker: string; notional: number; expiry: string }[])
    .filter((p) => Date.parse(p.expiry) > now).map((p) => ({ ticker: p.ticker, notionalUsd: p.notional, expiry: p.expiry }));
}
