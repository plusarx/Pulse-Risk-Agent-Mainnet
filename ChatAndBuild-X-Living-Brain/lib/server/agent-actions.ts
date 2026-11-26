import 'server-only';
import type { VenueNetwork } from '@/lib/network';
import { ACTION_TTL_MIN, type ActionIn, type ActionRow, type ActionStatus } from '@/lib/agent-action';
import { getDb } from './db';

// Confirmation-mode requests: the agent asks, the user decides in the UI, the agent runs it and acknowledges.

interface ActionDb { id: number; network: string; slot: string; payload: string; status: ActionStatus; result_message: string | null; created_at: number; decided_at: number | null; completed_at: number | null }
const COLS = 'id, network, slot, payload, status, result_message, created_at, decided_at, completed_at';
const toAction = (r: ActionDb): ActionRow => {
  const p = JSON.parse(r.payload) as Pick<ActionIn, 'kind' | 'venue' | 'origin' | 'title' | 'why' | 'helps' | 'willDo' | 'detail' | 'plan' | 'payoff' | 'alternatives'>;
  return { id: r.id, network: r.network, slot: r.slot, status: r.status, kind: p.kind, venue: p.venue, origin: p.origin, title: p.title, why: p.why, helps: p.helps, willDo: p.willDo, detail: p.detail, plan: p.plan ?? null, payoff: p.payoff ?? null, alternatives: p.alternatives ?? [],
    result_message: r.result_message, created_at: r.created_at, decided_at: r.decided_at, completed_at: r.completed_at };
};
const logEvent = (w: string, n: string, kind: string, venue: string, message: string, payload: unknown, key: string) =>
  getDb().prepare('INSERT OR IGNORE INTO agent_events (wallet, network, kind, venue, status, message, payload, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(w, n, kind, venue, null, message, JSON.stringify(payload), key, Date.now());

/** Stale requests (older than the TTL) can no longer be approved: the market moved, the agent asks again. */
function expireStale(w: string, n: string) {
  getDb().prepare("UPDATE agent_actions SET status = 'expired', decided_at = ? WHERE wallet = ? AND network = ? AND status IN ('pending','approved') AND created_at < ?")
    .run(Date.now(), w, n, Date.now() - ACTION_TTL_MIN * 60_000);
}

/** Agent: ask for permission. Idempotent on the key; a newer request for the same slot supersedes an open one. */
export function createAction(a: ActionIn): { id: number | null; duplicate: boolean; status: ActionStatus } {
  const db = getDb(); const w = a.wallet.toLowerCase();
  const dup = db.prepare('SELECT id, status FROM agent_actions WHERE wallet = ? AND idempotency_key = ?').get(w, a.idempotencyKey) as { id: number; status: ActionStatus } | undefined;
  if (dup) return { id: dup.id, duplicate: true, status: dup.status };
  db.prepare("UPDATE agent_actions SET status = 'superseded', decided_at = ? WHERE wallet = ? AND network = ? AND slot = ? AND status = 'pending'").run(Date.now(), w, a.network, a.slot);
  const { kind, venue, origin, title, why, helps, willDo, detail, plan, payoff, alternatives } = a;
  const r = db.prepare('INSERT INTO agent_actions (wallet, network, slot, payload, status, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(w, a.network, a.slot, JSON.stringify({ kind, venue, origin, title, why, helps, willDo, detail, plan, payoff, alternatives }), 'pending', a.idempotencyKey, Date.now());
  logEvent(w, a.network, 'info', venue, `Waiting for your approval: ${title}`, { actionId: Number(r.lastInsertRowid) }, `action-${w}-${a.idempotencyKey}-ask`);
  return { id: Number(r.lastInsertRowid), duplicate: false, status: 'pending' };
}

export function listActions(wallet: string, n: VenueNetwork, limit = 30): ActionRow[] {
  const w = wallet.toLowerCase(); expireStale(w, n);
  return (getDb().prepare(`SELECT ${COLS} FROM agent_actions WHERE wallet = ? AND network = ? ORDER BY id DESC LIMIT ?`).all(w, n, limit) as unknown as ActionDb[]).map(toAction);
}

/** Agent: open requests in one state: 'approved' (run them) or 'pending' (do not ask twice). */
export function listApprovedActions(wallet: string, n: VenueNetwork, status: 'approved' | 'pending' = 'approved'): ActionRow[] {
  const w = wallet.toLowerCase(); expireStale(w, n);
  return (getDb().prepare(`SELECT ${COLS} FROM agent_actions WHERE wallet = ? AND network = ? AND status = ? ORDER BY id`).all(w, n, status) as unknown as ActionDb[]).map(toAction);
}

/** User: approve or reject one pending request. */
export function decideAction(wallet: string, n: VenueNetwork, id: number, decision: 'approve' | 'reject'): ActionRow {
  const db = getDb(); const w = wallet.toLowerCase(); expireStale(w, n);
  const row = db.prepare(`SELECT ${COLS} FROM agent_actions WHERE id = ? AND wallet = ? AND network = ?`).get(id, w, n) as ActionDb | undefined;
  if (!row) throw new Error('request not found');
  if (row.status !== 'pending') throw new Error(`request is already ${row.status}`);
  const status: ActionStatus = decision === 'approve' ? 'approved' : 'rejected';
  db.prepare('UPDATE agent_actions SET status = ?, decided_at = ? WHERE id = ?').run(status, Date.now(), id);
  const a = toAction({ ...row, status });
  logEvent(w, n, 'info', a.venue, decision === 'approve' ? `You approved: ${a.title}. The agent will run it on its next check.` : `You rejected: ${a.title}. Nothing was done.`, { actionId: id }, `action-${id}-${decision}`);
  return { ...a, decided_at: Date.now() };
}

/** Agent: report the result of an approved request. This is the acknowledgement the user sees. */
export function completeAction(wallet: string, n: VenueNetwork, id: number, status: 'executed' | 'failed' | 'expired', message: string): ActionRow {
  const db = getDb(); const w = wallet.toLowerCase();
  const row = db.prepare(`SELECT ${COLS} FROM agent_actions WHERE id = ? AND wallet = ? AND network = ?`).get(id, w, n) as ActionDb | undefined;
  if (!row) throw new Error('request not found');
  if (row.status !== 'approved') throw new Error(`request is ${row.status}, only approved requests can be completed`);
  db.prepare('UPDATE agent_actions SET status = ?, result_message = ?, completed_at = ? WHERE id = ?').run(status, message.slice(0, 500), Date.now(), id);
  const a = toAction({ ...row, status, result_message: message });
  logEvent(w, n, status === 'failed' ? 'error' : 'info', a.venue, `${status === 'executed' ? 'Done' : status === 'expired' ? 'Not run' : 'Failed'}: ${a.title}. ${message}`.slice(0, 500), { actionId: id }, `action-${id}-${status}`);
  return { ...a, status, result_message: message, completed_at: Date.now() };
}

export function clearActionHistory(wallet: string, n: VenueNetwork): number {
  return Number(getDb().prepare("DELETE FROM agent_actions WHERE wallet = ? AND network = ? AND status IN ('rejected','superseded','expired')").run(wallet.toLowerCase(), n).changes);
}
