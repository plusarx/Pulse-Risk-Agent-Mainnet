import { createHash } from 'node:crypto';
import { LivingBrainClient } from '@living-brain/sdk';
import type { MemoryBackend, MemoryConnection, MemoryItem, MemoryKind, TurnResult } from './types';

// Living Brain as the memory backend. The API key is tied to one Living Brain subject (the account that issued it) and cannot act for other subjects,
// so every user's memory lives in that one subject, in a brain of its own: one brain per wallet, named from a hash of the wallet (the wallet address
// itself is never sent). Calls are the SDK's own: captures.capture, workspace.searchPages / index / listPages / pin / deletePermanently.

const BRAIN_PREFIX = 'Pulse chat memory';

/** Standing profile for every memory brain: what it is for, and the directives that make it connect related memories and keep both sides of a contradiction. */
export const BRAIN_PROFILE = {
  whoTheyAre: 'A trader who holds tokenised stocks (bStocks) and uses Pulse Risk, an AI agent that hedges the portfolio with perps and options.',
  whatTheyDo: 'Asks the agent for hedges, approves or declines its requests, and sets risk preferences and limits.',
  focus: 'Hedging preferences (puts versus perps, sizes, leverage), risk limits they state, decisions they made and why, and reminders for events such as earnings.',
  goals: 'Keep losses inside their own limit; have the agent remember how they like to hedge so they do not repeat themselves.',
  vaultOrganization: 'One short page per preference, decision or reminder. Group by ticker or instrument where it helps.',
  directives: {
    surfaceConnections: true, flagContradictions: true, challengeAssumptions: false, preferVaultContext: true,
    custom: 'Keep only what the user stated or decided: preferences, decisions with their reasons, reminders. Never record balances, prices, positions, amounts of their money, keys or addresses. When a newer preference contradicts an older one, keep both and mark the page contested instead of silently overwriting.',
  },
};

/** The name of a wallet's memory brain. Stable, and reveals nothing about the wallet. */
export function brainNameOf(wallet: string): string {
  return `${BRAIN_PREFIX} ${createHash('sha256').update(`pulse-risk-memory|${wallet.toLowerCase()}`).digest('hex').slice(0, 12)}`;
}

type PageLike = { slug: string; title: string; summary?: string; body?: string; pinned?: boolean; updatedAt?: string; createdAt?: string; status?: string; version?: number };
const live = (s?: string) => !s || s === 'active' || s === 'contested';
const toItem = (p: PageLike): MemoryItem => ({ id: p.slug, title: p.title, text: (p.summary || p.body || p.title || '').slice(0, 500), pinned: !!p.pinned, at: p.updatedAt ?? p.createdAt ?? null, ...(p.status ? { status: p.status } : {}), ...(typeof p.version === 'number' ? { version: p.version } : {}) });

export class LivingBrainBackend implements MemoryBackend {
  readonly name = 'living-brain';
  private client: Promise<LivingBrainClient> | null = null;
  private brains = new Map<string, Promise<string>>();
  /** subjectId: the key's own subject. Leave empty to look it up (a key with no subject header acts for its own). */
  constructor(private apiKey: string, private baseUrl = '', private subjectId = '') {}

  private sdk(): Promise<LivingBrainClient> {
    if (!this.client) {
      this.client = (async () => {
        let subject = this.subjectId;
        if (!subject) {
          const r = await fetch(`${this.baseUrl || 'https://api.livingbrain.com'}/v1/brains`, { headers: { 'x-api-key': this.apiKey }, signal: AbortSignal.timeout(8_000) });
          if (!r.ok) throw new Error(`Living Brain said ${r.status}`);
          const rows = (await r.json()) as { subjectId?: string }[];
          subject = rows.find((b) => b.subjectId)?.subjectId ?? '';
          if (!subject) throw new Error('Living Brain: could not find the subject this key acts for; set LIVING_BRAIN_SUBJECT_ID');
        }
        return new LivingBrainClient({ apiKey: this.apiKey, subjectId: subject, timeoutInSeconds: 8, maxRetries: 1, ...(this.baseUrl ? { baseUrl: this.baseUrl } : {}) });
      })();
      this.client.catch(() => { this.client = null; });
    }
    return this.client;
  }

  /** The wallet's memory brain, created on first use. A failed lookup is not cached. */
  private brainId(wallet: string): Promise<string> {
    const k = wallet.toLowerCase(); let p = this.brains.get(k);
    if (!p) {
      const name = brainNameOf(wallet);
      p = (async () => {
        const c = await this.sdk();
        const hit = (await c.brains.list()).find((b) => b.name === name);
        const id = (hit ?? (await c.brains.create({ name, description: 'What the Pulse Risk chat agent remembers about one user: preferences, decisions and reminders. Never balances or keys.' }))).id;
        // Standing instructions for how this brain organises what it is given (they apply to later captures). Set once per process; a failure never blocks memory.
        await c.workspace.updateProfile({ brainId: id, ...BRAIN_PROFILE }).catch(() => undefined);
        return id;
      })();
      p.catch(() => this.brains.delete(k));
      this.brains.set(k, p);
    }
    return p;
  }

  async capture(wallet: string, note: { text: string; kind: MemoryKind; originRef: string }): Promise<void> {
    const brainId = await this.brainId(wallet);
    await (await this.sdk()).captures.capture({ brainId, body: { kind: 'note', content: note.text, label: `${note.kind}: ${note.text.slice(0, 60)}`, originRef: note.originRef, bucket: 'notes' } });
  }

  async search(wallet: string, query: string, topK: number): Promise<MemoryItem[]> {
    const brainId = await this.brainId(wallet);
    const hits = await (await this.sdk()).workspace.searchPages({ brainId, query: query.slice(0, 500), topK, minSimilarity: 0.25 });
    return hits.filter((h) => live(h.status)).map((h) => toItem({ slug: h.slug, title: h.title, summary: h.summary }));
  }

  async index(wallet: string, limit: number): Promise<MemoryItem[]> {
    const brainId = await this.brainId(wallet);
    const rows = await (await this.sdk()).workspace.index({ brainId, limit });
    return rows.filter((r) => live(r.status)).map((r) => toItem(r));
  }

  async list(wallet: string, limit: number): Promise<MemoryItem[]> {
    const brainId = await this.brainId(wallet);
    const out: MemoryItem[] = [];
    for await (const p of await (await this.sdk()).workspace.listPages({ brainId, limit: Math.min(limit, 100) })) {
      if (live(p.status)) out.push(toItem(p));
      if (out.length >= limit) break;
    }
    return out;
  }

  async remove(wallet: string, id: string): Promise<void> {
    const brainId = await this.brainId(wallet);
    await (await this.sdk()).workspace.deletePermanently({ brainId, slug: id, permanent: 'true' });
  }

  async connections(wallet: string, limit: number): Promise<MemoryConnection[]> {
    const brainId = await this.brainId(wallet);
    const rows = await (await this.sdk()).workspace.listConnections({ brainId, limit });
    const out: MemoryConnection[] = [];
    for await (const c of rows) {
      if (c.strength === 'weak') continue;
      out.push({ aId: c.pageASlug, aTitle: c.pageATitle, bId: c.pageBSlug, bTitle: c.pageBTitle, strength: c.strength, reason: c.reasoning });
      if (out.length >= limit) break;
    }
    return out;
  }

  async captureTurn(wallet: string, turn: { text: string; originRef: string }): Promise<TurnResult> {
    const brainId = await this.brainId(wallet);
    const r = await (await this.sdk()).captures.captureChatTurn({ brainId, text: turn.text, sender: 'user', agentName: 'Pulse', originRef: turn.originRef });
    return { worthy: r.worthy, reason: r.reason };
  }

  async pin(wallet: string, id: string, pinned: boolean): Promise<void> {
    const brainId = await this.brainId(wallet);
    await (await this.sdk()).workspace.pin({ brainId, slug: id, pinned });
  }
}
