import 'server-only';
import type { VenueNetwork } from '@/lib/network';
import type { StatusIn } from '@/lib/agent-status';
import { getDb } from './db';

// The agent's latest status snapshot (mode, limits used, coverage, news flags). One row per wallet and network.

/** Agent: store the newest snapshot, replacing the previous one. */
export function writeStatus(s: StatusIn): void {
  getDb().prepare('INSERT OR REPLACE INTO agent_status (wallet, network, payload, updated_at) VALUES (?,?,?,?)')
    .run(s.wallet.toLowerCase(), s.network, JSON.stringify(s), Date.now());
}

/** UI: the latest snapshot, or null if the agent has not reported yet. */
export function readStatus(wallet: string, n: VenueNetwork): { status: StatusIn; updated_at: number } | null {
  const r = getDb().prepare('SELECT payload, updated_at FROM agent_status WHERE wallet = ? AND network = ?').get(wallet.toLowerCase(), n) as { payload: string; updated_at: number } | undefined;
  return r ? { status: JSON.parse(r.payload) as StatusIn, updated_at: r.updated_at } : null;
}
