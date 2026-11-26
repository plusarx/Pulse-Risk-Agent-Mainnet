import { createHash } from 'node:crypto';
import { config } from '../config';
import { log } from '../log';
import { sharedLedger, type Ledger } from './ledger';
import { LivingBrainBackend } from './livingBrain';
import { blockItems, looksDurable, noteText, rankLocal, renderBlock, shouldSearch } from './policy';
import type { MemoryBackend, MemoryConnection, MemoryItem, MemoryKind, MemoryUsage, TurnResult } from './types';

// The one place the chat touches memory. Every call here is optional and cheap by design: it needs a key, stops at the estimated spend cap,
// never waits long, never throws, and never sends anything but the short text the user stated or a decision they made. If anything is wrong
// the chat simply answers without memory.

const RECALL_TIMEOUT_MS = 1_500;
const WRITE_TIMEOUT_MS = 8_000;
const INDEX_TTL_MS = 30 * 60_000;
const INDEX_LIMIT = 12;
const SEARCH_TOPK = 3;

const within = <T>(p: Promise<T>, ms: number): Promise<T> => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`memory took longer than ${ms} ms`)), ms))]);
const refOf = (text: string) => `m-${createHash('sha256').update(text.toLowerCase()).digest('hex').slice(0, 24)}`;

export interface Recalled { items: MemoryItem[]; block: string; /** the items the block actually carries */ used: MemoryItem[]; connections: MemoryConnection[] }
export type Saved = { ok: true; text: string } | { ok: false; reason: string };

export class MemoryService {
  private idx = new Map<string, { at: number; items: MemoryItem[]; connections: MemoryConnection[] }>();
  constructor(private backend: MemoryBackend | null, private ledger: () => Ledger = sharedLedger, private now: () => number = Date.now) {}

  enabled(): boolean { return this.backend !== null; }
  backendName(): string | null { return this.backend?.name ?? null; }
  private budgetLeft(): boolean { return this.ledger().spentUsd() < config().MEMORY_BUDGET_USD; }

  usage(wallet: string): MemoryUsage {
    const l = this.ledger(); const spent = l.spentUsd();
    return { enabled: this.enabled(), backend: this.backendName(), captures: l.count(wallet, 'capture'), recalls: l.count(wallet, 'recall'), estSpentUsd: Math.round(spent * 1e4) / 1e4, budgetUsd: config().MEMORY_BUDGET_USD, budgetReached: spent >= config().MEMORY_BUDGET_USD };
  }

  /** The memories worth putting in front of the model for this message: the pinned and recent ones (cached) plus a search when the message could lean on the past. */
  async recall(wallet: string, message: string): Promise<Recalled> {
    const none: Recalled = { items: [], block: '', used: [], connections: [] };
    if (!this.backend || !this.budgetLeft()) return none;
    try {
      const k = wallet.toLowerCase(); const c = config(); const l = this.ledger();
      let base = this.idx.get(k);
      if (!base || this.now() - base.at > INDEX_TTL_MS) {
        const items = await within(this.backend.index(wallet, INDEX_LIMIT), RECALL_TIMEOUT_MS);
        // The connections Living Brain found between memories come with the index, one extra read per refresh, and only when there is something to connect.
        const connections = items.length > 1 && this.backend.connections ? await within(this.backend.connections(wallet, 10), RECALL_TIMEOUT_MS).catch(() => [] as MemoryConnection[]) : [];
        base = { at: this.now(), items, connections };
        this.idx.set(k, base); l.record(wallet, 'recall', 'index', c.MEMORY_EST_RECALL_USD * (connections.length ? 2 : 1));
      }
      // With fewer memories than the index holds, every one is already loaded: rank them here for free. Only a bigger brain needs a search request.
      let found: MemoryItem[] = [];
      if (base.items.length >= INDEX_LIMIT && shouldSearch(message) && this.budgetLeft()) {
        found = await within(this.backend.search(wallet, message, SEARCH_TOPK), RECALL_TIMEOUT_MS);
        l.record(wallet, 'recall', 'search', c.MEMORY_EST_RECALL_USD);
      }
      const seen = new Set<string>(); const items = rankLocal([...found, ...base.items].filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true))), message);
      return { items, block: renderBlock(items, 6, base.connections), used: blockItems(items), connections: base.connections };
    } catch (e) { log.warn(`memory recall skipped: ${e instanceof Error ? e.message : String(e)}`); return none; }
  }

  /** Save one short note. Refused (never thrown) when memory is off, the cap is reached, or the same note was already saved. */
  async remember(wallet: string, text: string, kind: MemoryKind, opts: { pin?: boolean } = {}): Promise<Saved> {
    if (!this.backend) return { ok: false, reason: 'memory is not switched on' };
    const t = noteText(text); if (!t) return { ok: false, reason: 'that is too short or not something worth remembering' };
    if (!this.budgetLeft()) return { ok: false, reason: 'the memory budget for this demo is used up' };
    const l = this.ledger(); const ref = refOf(`${t}|${l.count(wallet, 'forget')}`);   // the forget count is part of the ref so Living Brain does not treat a re-saved sentence as a duplicate
    if (l.seen(wallet, ref)) return { ok: true, text: t };
    try {
      await within(this.backend.capture(wallet, { text: t, kind, originRef: ref }), WRITE_TIMEOUT_MS);
      l.record(wallet, 'capture', ref, config().MEMORY_EST_CAPTURE_USD); this.idx.delete(wallet.toLowerCase());
      return { ok: true, text: t };
    } catch (e) { log.warn(`memory save failed: ${e instanceof Error ? e.message : String(e)}`); return { ok: false, reason: 'the memory service did not accept it just now' }; }
  }

  /**
   * Hand one user message to Living Brain's classifier, which keeps durable knowledge (a preference, a decision, a reminder) and drops filler. Only a message
   * that sounds durable is sent (a free local check), once per sentence. Returns the classifier's verdict and reason, or null when nothing was sent.
   */
  async considerTurn(wallet: string, message: string): Promise<TurnResult | null> {
    if (!this.backend?.captureTurn || !looksDurable(message) || !this.budgetLeft()) return null;
    const t = noteText(message); if (!t) return null;
    const l = this.ledger(); const c = config(); const ref = refOf(`turn|${t}|${l.count(wallet, 'forget')}`);
    if (l.seen(wallet, ref)) return null;
    try {
      const r = await within(this.backend.captureTurn(wallet, { text: t, originRef: ref }), 6_000);
      if (r.worthy) { l.record(wallet, 'capture', ref, c.MEMORY_EST_CLASSIFY_USD + c.MEMORY_EST_CAPTURE_USD); this.idx.delete(wallet.toLowerCase()); }
      else l.record(wallet, 'recall', `turn:${ref}`, c.MEMORY_EST_CLASSIFY_USD);
      return r;
    } catch (e) { log.warn(`memory classify skipped: ${e instanceof Error ? e.message : String(e)}`); return null; }
  }

  /** The connections between this wallet's memories, for the Memory tab. */
  async connections(wallet: string, limit = 12): Promise<MemoryConnection[]> {
    if (!this.backend?.connections) return [];
    return within(this.backend.connections(wallet, limit), WRITE_TIMEOUT_MS);
  }

  async list(wallet: string, limit = 50): Promise<MemoryItem[]> {
    if (!this.backend) return [];
    return within(this.backend.list(wallet, limit), WRITE_TIMEOUT_MS);
  }

  async forget(wallet: string, id: string): Promise<void> {
    if (!this.backend) return;
    await within(this.backend.remove(wallet, id), WRITE_TIMEOUT_MS); this.ledger().record(wallet, 'forget', id, 0); this.idx.delete(wallet.toLowerCase());
  }

  /** Delete the single best match for a phrase ("forget that I prefer puts"). Returns what was removed, or null when nothing matched. */
  async forgetMatching(wallet: string, query: string): Promise<MemoryItem | null> {
    if (!this.backend || !this.budgetLeft()) return null;
    try {
      const hit = (await within(this.backend.search(wallet, query, 1), WRITE_TIMEOUT_MS))[0];
      this.ledger().record(wallet, 'recall', 'search', config().MEMORY_EST_RECALL_USD);
      if (!hit) return null;
      await this.forget(wallet, hit.id); return hit;
    } catch (e) { log.warn(`memory forget failed: ${e instanceof Error ? e.message : String(e)}`); return null; }
  }

  async pin(wallet: string, id: string, pinned: boolean): Promise<void> {
    if (!this.backend) return;
    await within(this.backend.pin(wallet, id, pinned), WRITE_TIMEOUT_MS); this.idx.delete(wallet.toLowerCase());
  }

  /** Delete every memory of this wallet, one by one (Living Brain documents no bulk delete). Returns how many were removed. */
  async clearAll(wallet: string): Promise<number> {
    if (!this.backend) return 0;
    let n = 0;
    for (let round = 0; round < 5; round++) {
      const rows = await within(this.backend.list(wallet, 100), WRITE_TIMEOUT_MS);
      if (!rows.length) break;
      for (const r of rows) { await within(this.backend.remove(wallet, r.id), WRITE_TIMEOUT_MS); n++; }
    }
    if (n) this.ledger().record(wallet, 'forget', 'all', 0);
    this.idx.delete(wallet.toLowerCase()); return n;
  }
}

let svc: MemoryService | null = null;
/** The shared service. Built from the config on first use; off when there is no key. */
export function memoryService(): MemoryService {
  if (!svc) { const c = config(); svc = new MemoryService(c.LIVING_BRAIN_API_KEY ? new LivingBrainBackend(c.LIVING_BRAIN_API_KEY, c.LIVING_BRAIN_BASE_URL, c.LIVING_BRAIN_SUBJECT_ID) : null); }
  return svc;
}
export function setMemoryServiceForTests(s?: MemoryService) { svc = s ?? null; }
