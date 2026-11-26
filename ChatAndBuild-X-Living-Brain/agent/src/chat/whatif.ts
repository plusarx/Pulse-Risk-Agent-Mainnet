import { alternativesFor } from '../risk/alternatives';
import type { VenueAlternative } from '../../../lib/agent-action';
import { payoffForChoice, type Payoff } from '../risk/payoff';
import { buildGraph } from '../graph';
import { clearQuarantine, setTextFetcher } from '../news';
import { installSampleFeeds } from '../sample';
import { memoryActions, setActionsBackend, setEventSink, type ActionPost } from '../tools/appApi';
import { closeStore, openStore } from '../tools/store';
import type { Snapshot } from '../types';

// Run the real hedging agent (the LangGraph in src/graph) on a snapshot in complete isolation: its own in-memory store, its own action inbox,
// its own event sink, its own news feed. Nothing reaches the app, a venue or a chain. The chat server pins DRY_RUN and POST_EVENTS in its own
// process, so even a code path that forgot to check cannot send anything. The graph keeps its store and inbox in module state, so runs go one
// at a time.
export interface WhatIfResult {
  decision: string; outcome: string; reasons: string[]; events: string[];
  card: { title: string; why: string; helps: string; willDo: string[]; plan: Record<string, unknown> | null } | null;
  /** Profit and loss on the hedged name before and after the chosen hedge (null when nothing is hedged). */
  payoff?: Payoff | null;
  /** Every venue considered for the hedge, with why it was or was not used. */
  alternatives?: VenueAlternative[];
  /** The exact request the live agent would post for this run (same slot and idempotency key), so the chat can raise it for Approve. Null when nothing is proposed. */
  request?: ActionPost | null;
}
export interface NewsItem { ticker: string; title: string; source: string; hoursAgo: number }

let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const p = chain.then(fn, fn); chain = p.catch(() => undefined); return p; };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const feedXml = (items: NewsItem[]) => `<rss><channel>${items.map((i, n) => `<item><title>${esc(i.title)}</title><link>http://x/${n}</link><pubDate>${new Date(Date.now() - i.hoursAgo * 3_600_000).toUTCString()}</pubDate><source>${esc(i.source)}</source></item>`).join('')}</channel></rss>`;
const ALIAS: Record<string, string> = { NVDA: 'NVIDIA', TSLA: 'Tesla' };

/** Run a read that needs the agent store (moves in the last 24 h) on a scratch in-memory store, one at a time with the what-if runs that use the same store. */
export function withScratchStore<T>(fn: () => Promise<T>): Promise<T> {
  return serial(async () => { openStore(':memory:'); try { return await fn(); } finally { closeStore(); } });
}

export function runWhatIf(snapshot: Snapshot, opts: { news?: NewsItem[] } = {}): Promise<WhatIfResult> {
  return serial(async () => {
    const s = structuredClone(snapshot); s.config.rebalance.enabled = false;
    const news = opts.news ?? []; s.config.hedge.news.enabled = news.length > 0;
    openStore(':memory:'); const inbox = memoryActions(); setActionsBackend(inbox.backend);
    const events: string[] = []; setEventSink((e) => { events.push(`${e.kind}${e.status ? `/${e.status}` : ''}: ${e.message}`); });
    if (news.length) {
      clearQuarantine(); installSampleFeeds();
      setTextFetcher(async (u) => { if (u.includes('yahoo')) return '<rss/>'; const t = [...new Set(news.map((n) => n.ticker))].find((x) => u.includes(x) || (ALIAS[x] && u.includes(ALIAS[x]))); return t ? feedXml(news.filter((n) => n.ticker === t)) : '<rss/>'; });
    }
    try {
      const out = await buildGraph().invoke({ snapshot: s });
      const c = out.chosen; let decision: string;
      if (c) {
        if (c.kind === 'hedge' && c.hedge!.option) { const o = c.hedge!.option; decision = `Buy ${o.contracts} ${c.hedge!.market} puts (strike ${o.strike}) on Derive for about $${(o.premiumUsd + o.feesUsd).toFixed(2)}`; }
        else if (c.kind === 'hedge') { const h = c.hedge!; decision = h.deltaToShort > 0 ? `Sell (short) ${Math.abs(h.deltaToShort)} ${h.market}` : `Buy back ${Math.abs(h.deltaToShort)} ${h.market}`; }
        else decision = c.kind === 'top_up' ? `Top up ${c.ruleKey}` : `Release from ${c.ruleKey}`;
        if (out.outcome === 'awaiting') decision += ' [would ask you first]';
      } else decision = out.outcome === 'error' ? `Paused: ${out.note}` : 'No action';
      const row = inbox.rows[0];
      const reasons = [...out.rejected.map((r) => r.reason), ...(out.note ? [out.note] : [])].filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 8);
      return { decision, outcome: out.outcome, reasons, events: events.slice(0, 8), card: row ? { title: row.title, why: row.why, helps: row.helps, willDo: row.willDo, plan: (row.plan as Record<string, unknown> | null) ?? null } : null, payoff: payoffForChoice(s, c), alternatives: alternativesFor(s, c),
        request: row ? { wallet: row.wallet, network: row.network, kind: row.kind, venue: row.venue, origin: row.origin, slot: row.slot, title: row.title, why: row.why, helps: row.helps, willDo: row.willDo, detail: row.detail, plan: row.plan ?? undefined, payoff: row.payoff ?? undefined, alternatives: row.alternatives ?? undefined, idempotencyKey: row.key } as ActionPost : null };
    } finally { closeStore(); setEventSink(null); if (news.length) { setTextFetcher(); clearQuarantine(); } }
  });
}
