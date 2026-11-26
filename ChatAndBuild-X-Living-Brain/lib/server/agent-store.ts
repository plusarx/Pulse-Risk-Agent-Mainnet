import 'server-only';
import type { VenueNetwork } from '@/lib/network';
import { AgentConfig, DEFAULT_CONFIG } from '@/lib/agent-config';
import { applyProposal, withoutProposalRule, type ProposalIn, type ProposalRow } from '@/lib/agent-proposal';
import { getDb } from './db';

export function readConfig(wallet: string, n: VenueNetwork): AgentConfig {
  const row = getDb().prepare('SELECT config FROM agent_config WHERE wallet = ? AND network = ?').get(wallet.toLowerCase(), n) as { config: string } | undefined;
  if (!row) return DEFAULT_CONFIG;
  const parsed = AgentConfig.safeParse(JSON.parse(row.config));
  return parsed.success ? parsed.data : DEFAULT_CONFIG;
}

export function writeConfig(wallet: string, n: VenueNetwork, c: AgentConfig) {
  getDb().prepare('INSERT OR REPLACE INTO agent_config (wallet, network, config, updated_at) VALUES (?, ?, ?, ?)')
    .run(wallet.toLowerCase(), n, JSON.stringify(c), Date.now());
}

export type RuleStateMap = Record<string, Record<string, string | null>>;

export function readRuleStates(wallet: string, n: VenueNetwork): RuleStateMap {
  const rows = getDb().prepare('SELECT rule_key, state FROM rule_state WHERE wallet = ? AND network = ?').all(wallet.toLowerCase(), n) as { rule_key: string; state: string }[];
  return Object.fromEntries(rows.map((r) => [r.rule_key, JSON.parse(r.state) as Record<string, string | null>]));
}

/** Merge fields into a rule's state (undefined = keep, null = clear). */
export function mergeRuleState(wallet: string, n: VenueNetwork, key: string, patch: Record<string, string | null | undefined>) {
  const cur = readRuleStates(wallet, n)[key] ?? {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) cur[k] = v;
  getDb().prepare('INSERT OR REPLACE INTO rule_state (wallet, network, rule_key, state, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(wallet.toLowerCase(), n, key, JSON.stringify(cur), Date.now());
  return cur;
}

export function listEvents(wallet: string, n: VenueNetwork, limit = 100) {
  return getDb().prepare('SELECT id, kind, venue, status, message, payload, created_at FROM agent_events WHERE wallet = ? AND network = ? ORDER BY id DESC LIMIT ?')
    .all(wallet.toLowerCase(), n, limit);
}

// -- Risk-analyst proposals ----------------------------------------------------
interface ProposalDb { id: number; network: string; venue: 'aster' | 'lighter' | 'derive'; account_ref: string; payload: string; status: ProposalRow['status']; created_at: number; decided_at: number | null }
const toRow = (r: ProposalDb): ProposalRow => {
  const p = JSON.parse(r.payload) as Pick<ProposalIn, 'structural_risk' | 'proposed_rule' | 'reasoning' | 'metrics'>;
  return { id: r.id, network: r.network, venue: r.venue, accountRef: r.account_ref, status: r.status, structural_risk: p.structural_risk, proposed_rule: p.proposed_rule,
    reasoning: p.reasoning, metrics: p.metrics ?? null, created_at: r.created_at, decided_at: r.decided_at };
};

/** Store a proposal as pending. An older pending one for the same account is superseded. Idempotent on the key. */
export function createProposal(p: ProposalIn): { id: number | null; duplicate: boolean } {
  const db = getDb(); const w = p.wallet.toLowerCase();
  const dup = db.prepare('SELECT id FROM agent_proposals WHERE wallet = ? AND idempotency_key = ?').get(w, p.idempotencyKey) as { id: number } | undefined;
  if (dup) return { id: dup.id, duplicate: true };
  db.prepare("UPDATE agent_proposals SET status = 'superseded', decided_at = ? WHERE wallet = ? AND network = ? AND venue = ? AND account_ref = ? AND status = 'pending'")
    .run(Date.now(), w, p.network, p.venue, p.accountRef);
  const { structural_risk, proposed_rule, reasoning, metrics } = p;
  const r = db.prepare('INSERT INTO agent_proposals (wallet, network, venue, account_ref, payload, status, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(w, p.network, p.venue, p.accountRef, JSON.stringify({ structural_risk, proposed_rule, reasoning, metrics }), 'pending', p.idempotencyKey, Date.now());
  return { id: Number(r.lastInsertRowid), duplicate: false };
}

export function listProposals(wallet: string, n: VenueNetwork, limit = 20): ProposalRow[] {
  return (getDb().prepare('SELECT id, network, venue, account_ref, payload, status, created_at, decided_at FROM agent_proposals WHERE wallet = ? AND network = ? ORDER BY id DESC LIMIT ?')
    .all(wallet.toLowerCase(), n, limit) as unknown as ProposalDb[]).map(toRow);
}

/**
 * Human decision. Approve saves the config as it was (so it can be undone), applies the rule and arms automation.
 * Reject changes nothing. Revert (only for an approved proposal) restores the saved config.
 */
export function decideProposal(wallet: string, n: VenueNetwork, id: number, decision: 'approve' | 'reject' | 'revert'): ProposalRow {
  const db = getDb(); const w = wallet.toLowerCase();
  const row = db.prepare('SELECT id, network, venue, account_ref, payload, status, created_at, decided_at FROM agent_proposals WHERE id = ? AND wallet = ? AND network = ?').get(id, w, n) as ProposalDb | undefined;
  if (!row) throw new Error('proposal not found');
  if (decision === 'revert' ? row.status !== 'approved' : row.status !== 'pending') throw new Error(`proposal is already ${row.status}`);
  const cur = toRow(row);
  const payload = JSON.parse(row.payload) as Record<string, unknown>;
  const pct = (x: number) => `${Math.round(x * 100)}%`; const r = cur.proposed_rule;
  let message: string; let status: ProposalRow['status'];
  if (decision === 'approve') {
    const before = readConfig(w, n);
    writeConfig(w, n, applyProposal(before, { venue: cur.venue, accountRef: cur.accountRef, proposed_rule: r }));
    db.prepare('UPDATE agent_proposals SET payload = ? WHERE id = ?').run(JSON.stringify({ ...payload, prev_config: before }), id);
    status = 'approved';
    message = `You approved the AI proposal: top up above ${pct(r.top_up_trigger)}, restore to ${pct(r.restore_target)}, release below ${pct(r.release_trigger)}. Rule armed.`;
  } else if (decision === 'revert') {
    const prev = AgentConfig.safeParse(payload.prev_config);
    writeConfig(w, n, prev.success ? prev.data : withoutProposalRule(readConfig(w, n), { venue: cur.venue, accountRef: cur.accountRef }));
    status = 'reverted';
    message = 'You undid the AI proposal. Your rules are back to how they were before.';
  } else { status = 'rejected'; message = 'You rejected the AI proposal. Nothing changed.'; }
  db.prepare('UPDATE agent_proposals SET status = ?, decided_at = ? WHERE id = ?').run(status, Date.now(), id);
  db.prepare('INSERT INTO agent_events (wallet, network, kind, venue, status, message, payload, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(w, n, 'info', cur.venue, null, message, JSON.stringify({ proposalId: id }), `proposal-${id}-${decision}`, Date.now());
  return { ...cur, status, decided_at: Date.now() };
}

/** Remove finished proposals that no longer matter (rejected, superseded, undone). Approved ones stay so they can be undone. */
export function clearProposalHistory(wallet: string, n: VenueNetwork): number {
  return Number(getDb().prepare("DELETE FROM agent_proposals WHERE wallet = ? AND network = ? AND status IN ('rejected','superseded','reverted')").run(wallet.toLowerCase(), n).changes);
}
