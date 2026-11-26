import 'server-only';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Single-file SQLite store for the hackathon backend: agent keys (encrypted), agent config,
// and the agent's activity log. node:sqlite is built into Node >= 22.5, so no native build.

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const file = process.env.DB_PATH || path.join(process.cwd(), 'data', 'pulse-risk.db');
  mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS auth_nonces (
      address TEXT PRIMARY KEY, nonce TEXT NOT NULL, issued_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_keys (
      wallet TEXT NOT NULL,             -- lowercased MetaMask (owner) address
      venue TEXT NOT NULL,              -- 'lighter' | 'derive'
      network TEXT NOT NULL,            -- 'mainnet' | 'testnet'
      account_ref TEXT NOT NULL,        -- lighter account index | derive subaccount id
      key_ref TEXT NOT NULL,            -- lighter api key index | derive session key address
      public_key TEXT NOT NULL,
      enc_secret TEXT NOT NULL,         -- AES-256-GCM, see crypto.ts
      scope TEXT,
      expires_at INTEGER,
      meta TEXT,                        -- JSON, venue specific
      status TEXT NOT NULL DEFAULT 'active', -- 'pending' (awaiting owner signature) | 'active'
      created_at INTEGER NOT NULL,
      PRIMARY KEY (wallet, venue, network)
    );
    -- A registration in progress. Kept apart from agent_keys so starting (or abandoning) a rotation can
    -- never wipe the working key; it is promoted into agent_keys only once the venue confirms the new key.
    CREATE TABLE IF NOT EXISTS pending_agent_keys (
      wallet TEXT NOT NULL, venue TEXT NOT NULL, network TEXT NOT NULL,
      account_ref TEXT NOT NULL, key_ref TEXT NOT NULL, public_key TEXT NOT NULL, enc_secret TEXT NOT NULL,
      scope TEXT, expires_at INTEGER, meta TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY (wallet, venue, network)
    );
    -- One-time migration: older builds kept in-progress registrations in agent_keys with status 'pending'.
    INSERT OR IGNORE INTO pending_agent_keys (wallet, venue, network, account_ref, key_ref, public_key, enc_secret, scope, expires_at, meta, created_at)
      SELECT wallet, venue, network, account_ref, key_ref, public_key, enc_secret, scope, expires_at, meta, created_at FROM agent_keys WHERE status = 'pending';
    DELETE FROM agent_keys WHERE status = 'pending';
    CREATE TABLE IF NOT EXISTS agent_config (
      wallet TEXT NOT NULL, network TEXT NOT NULL, config TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (wallet, network)
    );
    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL, network TEXT NOT NULL, kind TEXT NOT NULL, venue TEXT,
      status TEXT, message TEXT NOT NULL, payload TEXT, idempotency_key TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (wallet, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS ix_events_wallet ON agent_events (wallet, network, id DESC);
    -- Agent-written runtime state per rebalance rule (dwell timers, run-once markers, last outcome).
    -- Kept apart from agent_config so a user saving rules never clobbers what the agent recorded.
    CREATE TABLE IF NOT EXISTS rule_state (
      wallet TEXT NOT NULL, network TEXT NOT NULL, rule_key TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (wallet, network, rule_key)
    );
    -- Risk-analyst proposals awaiting (or past) human approval. payload = the proposal JSON.
    CREATE TABLE IF NOT EXISTS agent_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL, network TEXT NOT NULL, venue TEXT NOT NULL, account_ref TEXT NOT NULL,
      payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', idempotency_key TEXT,
      created_at INTEGER NOT NULL, decided_at INTEGER,
      UNIQUE (wallet, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS ix_proposals_wallet ON agent_proposals (wallet, network, id DESC);
    -- Confirmation mode: moves the agent wants to make, waiting for (or past) the user's decision, with the result ack.
    CREATE TABLE IF NOT EXISTS agent_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet TEXT NOT NULL, network TEXT NOT NULL, slot TEXT NOT NULL,
      payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', idempotency_key TEXT NOT NULL,
      result_message TEXT, created_at INTEGER NOT NULL, decided_at INTEGER, completed_at INTEGER,
      UNIQUE (wallet, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS ix_actions_wallet ON agent_actions (wallet, network, id DESC);
    -- bStock swaps made through the app, read back from the chain (amounts come from the receipt, not the browser).
    CREATE TABLE IF NOT EXISTS spot_trades (
      tx_hash TEXT PRIMARY KEY, wallet TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
      bstock_qty TEXT NOT NULL, stable_amount TEXT NOT NULL, stable_symbol TEXT NOT NULL, block_time INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_spot_trades_wallet ON spot_trades (wallet, block_time DESC);
    -- The agent's always-visible status: one latest snapshot per wallet and network.
    CREATE TABLE IF NOT EXISTS agent_status (
      wallet TEXT NOT NULL, network TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY (wallet, network)
    );
  `);
  return db;
}
