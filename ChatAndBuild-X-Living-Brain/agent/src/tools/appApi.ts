import { venueWords, venueWordsDeep } from '../../../lib/venue-words';
import { AgentConfig } from '../../../lib/agent-config';
import type { RuleState } from '../../../lib/risk-rules';
import { config } from '../config';
import type { Network } from '../types';

// Client for the Pulse Risk app's agent API (docs/AGENT.md). The bearer token is the ONLY secret it needs.

export interface WalletEntry {
  wallet: string;
  keys: { venue: 'aster' | 'derive'; accountRef: string; keyRef: string; status: string; expiresAt: number | null }[];
  config: AgentConfig;
}
/** Aster agent credentials: `user` is the account owner, `agentAddress` signs (canWithdraw=false, so it can never move funds out). */
export interface AsterCreds { venue: 'aster'; network: Network; wallet: string; user: string; agentAddress: string; agentPrivateKey: string; expiresAt: number | null }
export interface DeriveCreds { subaccountId: number; sessionKeyAddress: string; sessionPrivateKey: string; expiresAt: number | null }

async function call<T>(method: 'GET' | 'POST', path: string, params?: Record<string, string>, body?: unknown): Promise<T> {
  const c = config();
  const u = new URL(c.APP_API_URL + path);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  const res = await fetch(u, {
    method, signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${c.AGENT_API_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown; try { json = JSON.parse(text); } catch { throw new Error(`app ${path} returned non-JSON (HTTP ${res.status})`); }
  if (!res.ok) throw new Error(`app ${path} HTTP ${res.status}: ${(json as { error?: string }).error ?? text.slice(0, 120)}`);
  return json as T;
}

export const listWallets = (network: Network) => call<{ wallets: WalletEntry[] }>('GET', '/api/agent/v1/wallets', { network }).then((r) => r.wallets);

export const getConfig = (wallet: string, network: Network) =>
  call<unknown>('GET', '/api/agent/v1/config', { wallet, network }).then((j) => AgentConfig.parse((j as { config?: unknown }).config ?? j));

export const getAsterCreds = (wallet: string, network: Network) => call<AsterCreds>('GET', '/api/agent/v1/credentials', { wallet, venue: 'aster', network });
export const getDeriveCreds = (wallet: string, network: Network) => call<DeriveCreds>('GET', '/api/agent/v1/credentials', { wallet, venue: 'derive', network });

export const getRuleStates = (wallet: string, network: Network) =>
  call<{ states: Record<string, RuleState> }>('GET', '/api/agent/v1/rule-state', { wallet, network }).then((r) => r.states ?? {});

export interface EventIn {
  wallet: string; network: Network; kind: 'hedge' | 'rebalance' | 'bridge' | 'info' | 'error' | 'news' | 'warning';
  venue?: 'aster' | 'derive' | 'bsc' | 'relay'; status?: 'pending' | 'done' | 'failed';
  message: string; payload?: Record<string, unknown>; idempotencyKey: string;
}
let eventSink: ((e: EventIn) => void) | null = null;
/** Tests and the scenario harness collect posted events here instead of calling the app. */
export const setEventSink = (f: ((e: EventIn) => void) | null) => { eventSink = f; };
export const postEvent = (e: EventIn) => eventSink ? (eventSink(e), Promise.resolve({ ok: true })) : config().POST_EVENTS ? call<{ ok?: boolean }>('POST', '/api/agent/v1/events', undefined, { ...e, message: venueWords(e.message) }) : Promise.resolve({ ok: true });

export interface RuleStatePost { wallet: string; network: Network; ruleKey: string; topUpDoneAt?: string | null; releaseDoneAt?: string | null; releaseBelowSince?: string | null; lastMoveAt?: string | null; lastOutcome?: string | null; lastOutcomeMsg?: string | null }
export const postRuleState = (s: RuleStatePost) => config().POST_EVENTS ? call<{ ok?: boolean }>('POST', '/api/agent/v1/rule-state', undefined, s) : Promise.resolve({ ok: true });

export interface ProposalPost {
  wallet: string; network: Network; venue: 'aster' | 'derive' | 'lighter'; accountRef: string;
  structural_risk: string; reasoning: string; metrics?: Record<string, number | string | null>;
  proposed_rule: { top_up_trigger: number; restore_target: number; release_trigger: number; primary_source: 'bstocks_bnb' | 'exchange_wallet' };
  idempotencyKey: string;
}
/** Submit a proposal. It stays pending in the app until the user approves it in the UI. */
export const postProposal = (p: ProposalPost) => call<{ ok: boolean; id: number | null; duplicate: boolean }>('POST', '/api/agent/v1/proposals', undefined, p);

// ── Confirmation-mode requests ─────────────────────────────────────────────────
// The agent asks, the user decides in the app, the agent runs it and acknowledges. The backend is swappable so
// tests and demos can run without the app (see memoryActions).
import type { ActionIn, ActionRow, ActionStatus } from '../../../lib/agent-action';

export type ActionPost = Omit<ActionIn, 'wallet' | 'network'> & { wallet: string; network: Network };
export interface ActionsBackend {
  create(a: ActionPost): Promise<{ id: number | null; duplicate: boolean; status: ActionStatus }>;
  list(wallet: string, network: Network, status: 'pending' | 'approved'): Promise<ActionRow[]>;
  result(id: number, wallet: string, network: Network, status: 'executed' | 'failed' | 'expired', message: string): Promise<void>;
}

/** What the user reads never names a venue (Aster = perps, Derive = options); `detail` is the agent's spec and stays as is. */
const shownAction = (a: ActionPost): ActionPost => ({ ...venueWordsDeep({ ...a, detail: {} }), detail: a.detail, wallet: a.wallet, network: a.network, venue: a.venue, kind: a.kind, origin: a.origin, slot: a.slot, idempotencyKey: a.idempotencyKey });

const httpActions: ActionsBackend = {
  create: (a) => call<{ id: number | null; duplicate: boolean; status: ActionStatus }>('POST', '/api/agent/v1/actions', undefined, shownAction(a)),
  list: (wallet, network, status) => call<{ actions: ActionRow[] }>('GET', '/api/agent/v1/actions', { wallet, network, status }).then((r) => r.actions),
  result: (id, wallet, network, status, message) => call<unknown>('POST', `/api/agent/v1/actions/${id}/result`, { network }, { wallet, status, message: venueWords(message) }).then(() => undefined),
};

/** In-memory stand-in for the app's approval inbox. `approve(id)` plays the user clicking Approve. */
export function memoryActions() {
  const rows: (ActionRow & { wallet: string; key: string })[] = []; let next = 1;
  const backend: ActionsBackend = {
    async create(a) {
      const dup = rows.find((r) => r.wallet === a.wallet && r.key === a.idempotencyKey);
      if (dup) return { id: dup.id, duplicate: true, status: dup.status };
      for (const r of rows) if (r.wallet === a.wallet && r.slot === a.slot && r.status === 'pending') r.status = 'superseded';
      const row = { id: next++, wallet: a.wallet, key: a.idempotencyKey, network: a.network, slot: a.slot, status: 'pending' as ActionStatus, kind: a.kind, venue: a.venue, origin: a.origin,
        title: a.title, why: a.why, helps: a.helps, willDo: a.willDo, detail: a.detail, plan: a.plan ?? null, payoff: a.payoff ?? null, alternatives: a.alternatives ?? [], result_message: null, created_at: Date.now(), decided_at: null, completed_at: null };
      rows.push(row); return { id: row.id, duplicate: false, status: 'pending' };
    },
    async list(wallet, _n, status) { return rows.filter((r) => r.wallet === wallet && r.status === status); },
    async result(id, _w, _n, status, message) { const r = rows.find((x) => x.id === id); if (r) { r.status = status; r.result_message = message; r.completed_at = Date.now(); } },
  };
  return { backend, rows, approve: (id: number) => { const r = rows.find((x) => x.id === id); if (r && r.status === 'pending') { r.status = 'approved'; r.decided_at = Date.now(); } }, reject: (id: number) => { const r = rows.find((x) => x.id === id); if (r && r.status === 'pending') r.status = 'rejected'; } };
}

let actions: ActionsBackend = httpActions;
/** Always the real app API, even while a what-if run has swapped in the in-memory inbox (chat trade requests). */
export const postActionToApp = (a: ActionPost) => httpActions.create(a);
export const setActionsBackend = (b?: ActionsBackend) => { actions = b ?? httpActions; };
export const postAction = (a: ActionPost) => actions.create(a);
export const listActions = (wallet: string, network: Network, status: 'pending' | 'approved') => actions.list(wallet, network, status);
export const postActionResult = (id: number, wallet: string, network: Network, status: 'executed' | 'failed' | 'expired', message: string) => actions.result(id, wallet, network, status, message);

// ── Status the app shows at the top of the page ────────────────────────────────
import type { StatusIn } from '../../../lib/agent-status';
export const postStatus = (st: StatusIn) => config().POST_EVENTS ? call<{ ok?: boolean }>('POST', '/api/agent/v1/status', undefined, venueWordsDeep(st)) : Promise.resolve({ ok: true });
