// Long-term memory for the chat, kept in Living Brain. The chat never depends on it: with no key, no budget left or any error, the chat answers exactly as
// before. Memory only supplies the user's own words and past decisions as wording and preferences. It is never a source for balances, prices or limits.

export type MemoryKind = 'preference' | 'decision' | 'reminder' | 'note';

export interface MemoryItem {
  /** The backend's id for the page (its slug); what delete and pin use. */
  id: string;
  title: string;
  text: string;
  pinned: boolean;
  at: string | null;
  /** 'contested' = a newer statement contradicts this page; Living Brain keeps both claims. */
  status?: string;
  /** Page version (bumped each time Living Brain recompiles it); shown as a citation. */
  version?: number;
}

/** Two memories Living Brain found to be related, with its one-line reason. */
export interface MemoryConnection { aId: string; aTitle: string; bId: string; bTitle: string; strength: 'weak' | 'medium' | 'strong'; reason: string }

/** What the worthiness classifier decided about one chat turn. */
export interface TurnResult { worthy: boolean; reason: string }

/** What the service needs from Living Brain, so tests and a future backend can stand in for it. Every method is per wallet (one brain per user). */
export interface MemoryBackend {
  readonly name: string;
  capture(wallet: string, note: { text: string; kind: MemoryKind; originRef: string }): Promise<void>;
  search(wallet: string, query: string, topK: number): Promise<MemoryItem[]>;
  index(wallet: string, limit: number): Promise<MemoryItem[]>;
  list(wallet: string, limit: number): Promise<MemoryItem[]>;
  remove(wallet: string, id: string): Promise<void>;
  pin(wallet: string, id: string, pinned: boolean): Promise<void>;
  /** Related memories (optional: a backend without a graph simply has none). */
  connections?(wallet: string, limit: number): Promise<MemoryConnection[]>;
  /** Send one user turn to Living Brain's classifier, which keeps durable knowledge and drops filler. */
  captureTurn?(wallet: string, turn: { text: string; originRef: string }): Promise<TurnResult>;
}

export interface MemoryUsage {
  enabled: boolean;
  backend: string | null;
  /** Calls this wallet has made, counted by us (Living Brain has no credit-balance API). */
  captures: number;
  recalls: number;
  /** Our own estimate of spend so far across all wallets, against the cap. */
  estSpentUsd: number;
  budgetUsd: number;
  /** True once the estimate reaches the cap: saving and recalling stop, the chat works as before. */
  budgetReached: boolean;
}
