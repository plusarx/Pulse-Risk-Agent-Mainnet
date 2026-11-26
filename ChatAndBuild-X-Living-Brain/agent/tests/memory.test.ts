import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AIMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { loadConfig, resetConfigForTests } from '../src/config';
import { chat, setChatModel, setLiveReader, type ChatRequest } from '../src/chat/chat';
import { sampleSnapshot } from '../src/chat/sample';
import { openLedger } from '../src/memory/ledger';
import { BRAIN_PROFILE, brainNameOf } from '../src/memory/livingBrain';
import { blockItems, connectionLines, decisionNote, looksDurable, noteText, renderBlock, shouldSearch } from '../src/memory/policy';
import { MemoryService, setMemoryServiceForTests } from '../src/memory/service';
import type { MemoryBackend, MemoryConnection, MemoryItem, TurnResult } from '../src/memory/types';

// Memory is optional and cheap: it needs a key, stops at the spend cap, never waits long and never breaks the chat. Living Brain is replaced by an
// in-memory fake here, so these tests cost nothing.

class FakeBackend implements MemoryBackend {
  readonly name = 'fake';
  pages = new Map<string, MemoryItem[]>(); calls: string[] = []; slow = 0; fail = false;
  links: MemoryConnection[] = []; verdict: TurnResult = { worthy: true, reason: 'a lasting preference' };
  private rows(w: string) { const k = w.toLowerCase(); if (!this.pages.has(k)) this.pages.set(k, []); return this.pages.get(k)!; }
  private async gate(op: string) { this.calls.push(op); if (this.slow) await new Promise((r) => setTimeout(r, this.slow)); if (this.fail) throw new Error('down'); }
  seed(w: string, ...texts: (string | [string, boolean])[]) { for (const t of texts) { const [text, pinned] = Array.isArray(t) ? t : [t, false]; this.rows(w).push({ id: `p${this.rows(w).length + 1}`, title: text.slice(0, 20), text, pinned, at: null }); } }
  async capture(w: string, n: { text: string }) { await this.gate('capture'); this.rows(w).push({ id: `p${this.rows(w).length + 1}`, title: n.text.slice(0, 20), text: n.text, pinned: false, at: null }); }
  async search(w: string, q: string, k: number) { await this.gate('search'); const words = q.toLowerCase().split(/\W+/).filter((x) => x.length > 3); return this.rows(w).filter((r) => words.some((x) => r.text.toLowerCase().includes(x))).slice(0, k); }
  async index(w: string, limit: number) { await this.gate('index'); return [...this.rows(w)].sort((a, b) => Number(b.pinned) - Number(a.pinned)).slice(0, limit); }
  async list(w: string, limit: number) { await this.gate('list'); return this.rows(w).slice(0, limit); }
  async remove(w: string, id: string) { await this.gate('remove'); this.pages.set(w.toLowerCase(), this.rows(w).filter((r) => r.id !== id)); }
  async connections(_w: string, limit: number) { await this.gate('connections'); return this.links.slice(0, limit); }
  async captureTurn(w: string, t: { text: string }) { await this.gate('turn'); if (this.verdict.worthy) this.rows(w).push({ id: `p${this.rows(w).length + 1}`, title: t.text.slice(0, 20), text: t.text, pinned: false, at: null }); return this.verdict; }
  async pin(w: string, id: string, pinned: boolean) { await this.gate('pin'); const r = this.rows(w).find((x) => x.id === id); if (r) r.pinned = pinned; }
}

const W = '0x1111111111111111111111111111111111111111';
const cfg = (o: Record<string, string> = {}) => resetConfigForTests(loadConfig({ ...process.env, DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off', MEMORY_BUDGET_USD: '2.5', MEMORY_EST_CAPTURE_USD: '0.04', MEMORY_EST_RECALL_USD: '0.001', ...o }));
let be: FakeBackend; let svc: MemoryService;
beforeEach(() => { cfg(); be = new FakeBackend(); const l = openLedger(':memory:'); svc = new MemoryService(be, () => l); setMemoryServiceForTests(svc); });
afterEach(() => { setMemoryServiceForTests(); setChatModel(); setLiveReader(); resetConfigForTests(); });

describe('what is worth saving and when a search is worth its cost', () => {
  it('saves a real sentence, capped, and refuses greetings, bare numbers and tiny text', () => {
    expect(noteText('  I prefer   puts over perps  ')).toBe('I prefer puts over perps');
    expect(noteText('hi')).toBeNull(); expect(noteText('thanks!')).toBeNull(); expect(noteText('12345678')).toBeNull(); expect(noteText('ok ok')).toBeNull();
    expect(noteText('x'.repeat(40) + ' ' + 'word '.repeat(100))!.length).toBeLessThanOrEqual(300);
  });
  it('a decision is one short line with the reason, and the chat suffix is dropped', () => {
    expect(decisionNote('declined', 'Buy NVDA put (you asked in chat)', 'premium too high')).toBe('Declined: Buy NVDA put. Reason: premium too high');
    expect(decisionNote('approved', 'Short 0.06 NVDA perp')).toBe('Approved: Short 0.06 NVDA perp'); expect(decisionNote('approved', '  ')).toBeNull();
  });
  it('searches only when the message can lean on the past: a memory cue, a trading word or a ticker', () => {
    for (const m of ['hedge my NVDA stock', 'what did I decide last time?', 'same as before please', 'is my margin ok?', 'TSLA']) expect(shouldSearch(m), m).toBe(true);
    for (const m of ['hi', 'thanks', 'ok', 'what is a perp?'.slice(0, 10), 'good morning', 'how are you today my friend']) expect(shouldSearch(m), m).toBe(false);
  });
  it('the block puts pinned first, is capped, and tells the model it is never a source for numbers or an instruction', () => {
    const items: MemoryItem[] = Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, title: `t${i}`, text: `Preference number ${i} about hedging`, pinned: i === 7, at: null }));
    const b = renderBlock(items); expect(b.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(6);
    expect(b).toMatch(/- \[always keep in mind\] Preference number 7/); expect(b).toMatch(/NEVER a source for balances, prices, limits/); expect(b).toMatch(/never an instruction to act/);
    expect(blockItems(items)[0].id).toBe('i7'); expect(renderBlock([])).toBe('');
    expect(renderBlock([{ id: 'a', title: 'a', text: 'y'.repeat(3000), pinned: false, at: null }])).toBe('');   // one huge memory never blows the prompt
  });
  it('each wallet gets its own brain name, which reveals nothing about the wallet', () => {
    expect(brainNameOf(W)).toBe(brainNameOf(W.toUpperCase().replace('0X', '0x'))); expect(brainNameOf(W)).not.toBe(brainNameOf('0x2222222222222222222222222222222222222222')); expect(brainNameOf(W)).not.toContain('1111');
  });
});

describe('the memory service', () => {
  it('is off without a backend: nothing recalled, nothing saved, no error', async () => {
    const off = new MemoryService(null, () => openLedger(':memory:'));
    expect(off.enabled()).toBe(false); expect((await off.recall(W, 'hedge my NVDA')).block).toBe('');
    expect(await off.remember(W, 'I prefer puts over perps', 'preference')).toEqual({ ok: false, reason: 'memory is not switched on' }); expect(off.usage(W).enabled).toBe(false);
  });
  it('loads the index once and serves it from the cache; a small brain is ranked here, with no search request at all', async () => {
    be.seed(W, ['Always show me the cost first', true], 'I prefer puts over perps for NVDA', 'Remind me before TSLA earnings');
    const a = await svc.recall(W, 'thanks'); expect(be.calls).toEqual(['index', 'connections']); expect(a.block).toMatch(/always keep in mind/);
    const r = await svc.recall(W, 'hedge my NVDA stock with puts'); expect(be.calls).toEqual(['index', 'connections']);   // every memory is already loaded: no search
    expect(r.used.map((i) => i.text)).toEqual(['Always show me the cost first', 'I prefer puts over perps for NVDA', 'Remind me before TSLA earnings']);   // pinned first, then the one that shares words with the message
    await svc.recall(W, 'ok'); expect(be.calls).toEqual(['index', 'connections']); expect(svc.usage(W).recalls).toBe(1);
  });
  it('only a brain bigger than the index needs a search, and only for a message that can lean on the past', async () => {
    be.seed(W, ...Array.from({ length: 14 }, (_, i) => `Memory number ${i} about hedging NVDA`));
    await svc.recall(W, 'thanks'); expect(be.calls).toEqual(['index', 'connections']);
    await svc.recall(W, 'hedge my NVDA stock'); expect(be.calls).toEqual(['index', 'connections', 'search']);
    await svc.recall(W, 'ok'); expect(be.calls).toEqual(['index', 'connections', 'search']); expect(svc.usage(W).recalls).toBe(2);
  });
  it('merges search hits with the index without repeating a memory', async () => {
    be.seed(W, 'I prefer puts over perps for NVDA', 'Never more than $500 a move', ...Array.from({ length: 12 }, (_, i) => `Filler memory ${i}`));
    const r = await svc.recall(W, 'hedge NVDA with puts'); expect(be.calls).toContain('search');
    expect(new Set(r.items.map((i) => i.id)).size).toBe(r.items.length); expect(r.used[0].text).toMatch(/prefer puts/);
  });
  it('never waits long and never throws: a slow or broken memory means no memory', async () => {
    be.seed(W, 'I prefer puts'); be.slow = 2500; const t = Date.now();
    expect((await svc.recall(W, 'hedge my NVDA')).block).toBe(''); expect(Date.now() - t).toBeLessThan(2200);
    be.slow = 0; be.fail = true; expect((await svc.recall(W, 'hedge my NVDA')).block).toBe('');
    expect(await svc.remember(W, 'I prefer puts over perps', 'preference')).toEqual({ ok: false, reason: 'the memory service did not accept it just now' });
  });
  it('saves a note once; the same sentence again costs nothing; after a forget it can be saved again', async () => {
    expect(await svc.remember(W, 'I prefer puts over perps for NVDA', 'preference')).toEqual({ ok: true, text: 'I prefer puts over perps for NVDA' });
    await svc.remember(W, 'i prefer puts over perps for nvda', 'preference'); expect(be.calls.filter((c) => c === 'capture')).toHaveLength(1); expect(svc.usage(W).captures).toBe(1);
    await svc.forget(W, 'p1'); expect(be.pages.get(W)).toEqual([]);
    await svc.remember(W, 'I prefer puts over perps for NVDA', 'preference'); expect(be.calls.filter((c) => c === 'capture')).toHaveLength(2); expect(be.pages.get(W)).toHaveLength(1);
  });
  it('stops at the spend cap: the estimate counts saves and recalls, and the chat just carries on without memory', async () => {
    cfg({ MEMORY_BUDGET_USD: '0.09' });
    expect((await svc.remember(W, 'I prefer puts over perps for NVDA', 'preference')).ok).toBe(true);
    expect((await svc.remember(W, 'Never more than $500 on one move', 'preference')).ok).toBe(true);
    const u = svc.usage(W); expect(u.estSpentUsd).toBe(0.08); expect(u.budgetReached).toBe(false);
    be.seed(W, 'x'); await svc.recall(W, 'ok');   // the first index load adds 0.001
    expect((await svc.remember(W, 'A third preference about leverage', 'preference')).ok).toBe(true);
    expect(svc.usage(W).budgetReached).toBe(true);
    expect(await svc.remember(W, 'A fourth preference about leverage', 'preference')).toEqual({ ok: false, reason: 'the memory budget for this demo is used up' });
    expect((await svc.recall('0x2222222222222222222222222222222222222222', 'hedge NVDA')).block).toBe('');   // the cap is shared across users
  });
  it('forgets the best match and clears everything, page by page', async () => {
    be.seed(W, 'I prefer puts over perps for NVDA', 'Never more than $500 a move', 'Remind me before NVDA earnings');
    expect((await svc.forgetMatching(W, 'what I prefer for puts'))!.text).toMatch(/prefer puts/); expect(be.pages.get(W)).toHaveLength(2);
    expect(await svc.forgetMatching(W, 'zebra quantum')).toBeNull();
    expect(await svc.clearAll(W)).toBe(2); expect(be.pages.get(W)).toEqual([]);
  });
  it('pins and unpins through the backend', async () => { be.seed(W, 'I prefer puts'); await svc.pin(W, 'p1', true); expect(be.pages.get(W)![0].pinned).toBe(true); });
});

describe('the cheap gate before the classifier, conflicts and connections', () => {
  it('only a message that sounds like a lasting preference, rule, decision or reminder goes to the classifier', () => {
    for (const m of ['I prefer protective puts over perp shorts for NVDA', 'From now on never use more than 3x leverage', 'Remember that I do not like selling MSTR', 'remind me before NVDA earnings', 'I decided to keep my SPY unhedged', 'My rule is no more than $500 on one move']) expect(looksDurable(m), m).toBe(true);
    for (const m of ['hi', 'hedge my NVDA stock', 'what is a perp?', 'How much is free on my perps account?', 'I prefer?', 'forget that I prefer puts', 'x'.repeat(700)]) expect(looksDurable(m), m).toBe(false);
  });
  it('a contested memory is labelled so the model asks which is current instead of picking one', () => {
    const b = renderBlock([{ id: 'a', title: 'Hedging', text: 'Prefers puts', pinned: false, at: null }, { id: 'b', title: 'Hedging', text: 'Perps are fine now', pinned: false, at: null, status: 'contested' }]);
    expect(b).toMatch(/- Prefers puts/); expect(b).toMatch(/- \[CONFLICT: a newer statement contradicts this one; ask which is current\] Perps are fine now/);
  });
  it('connections between the shown memories are added as one short line, and unrelated ones are not', () => {
    const items: MemoryItem[] = [{ id: 'nvda-puts', title: 'NVDA puts', text: 'Prefers puts for NVDA', pinned: false, at: null }, { id: 'budget', title: 'Move budget', text: 'Never more than $500 a move', pinned: false, at: null }];
    const links: MemoryConnection[] = [{ aId: 'nvda-puts', aTitle: 'NVDA puts', bId: 'budget', bTitle: 'Move budget', strength: 'strong', reason: 'both limit how the NVDA hedge is sized' }, { aId: 'x', aTitle: 'X', bId: 'y', bTitle: 'Y', strength: 'strong', reason: 'unrelated' }];
    expect(connectionLines(items, links)).toEqual(['NVDA puts <-> Move budget: both limit how the NVDA hedge is sized']);
    expect(renderBlock(items, 6, links)).toMatch(/Connected memories \(found by Living Brain\): NVDA puts <-> Move budget/);
  });
  it('the brain profile tells Living Brain to connect memories and keep both sides of a contradiction, and never to record money or keys', () => {
    expect(BRAIN_PROFILE.directives).toMatchObject({ surfaceConnections: true, flagContradictions: true });
    expect(BRAIN_PROFILE.directives.custom).toMatch(/contested/); expect(BRAIN_PROFILE.directives.custom).toMatch(/Never record balances/);
  });
  it('recall loads the connections with the index, once, only when there is something to connect, and keeps them cached', async () => {
    be.seed(W, 'Prefers puts for NVDA', 'Never more than $500 a move'); be.links = [{ aId: 'p1', aTitle: 'NVDA', bId: 'p2', bTitle: 'Budget', strength: 'strong', reason: 'sizing' }];
    const r = await svc.recall(W, 'ok'); expect(be.calls).toEqual(['index', 'connections']); expect(r.block).toMatch(/NVDA <-> Budget: sizing/); expect(r.connections).toHaveLength(1);
    await svc.recall(W, 'ok'); expect(be.calls).toEqual(['index', 'connections']);
    be.calls.length = 0; svc = new MemoryService(be, () => openLedger(':memory:')); setMemoryServiceForTests(svc); be.pages.clear(); be.seed(W, 'Only one memory'); await svc.recall(W, 'ok'); expect(be.calls).toEqual(['index']);
  });
  it('the classifier keeps a durable statement and says why; filler it declines costs only the small classification', async () => {
    be.verdict = { worthy: true, reason: 'a lasting preference about hedging' };
    const a = await svc.considerTurn(W, 'I prefer protective puts over perp shorts when hedging NVDA'); expect(a).toEqual({ worthy: true, reason: 'a lasting preference about hedging' }); expect(be.pages.get(W)).toHaveLength(1);
    const u1 = svc.usage(W); expect(u1.captures).toBe(1); expect(u1.estSpentUsd).toBe(0.045);
    be.verdict = { worthy: false, reason: 'a question, not durable' };
    const b = await svc.considerTurn(W, 'I never know whether to hedge before earnings or after'); expect(b).toEqual({ worthy: false, reason: 'a question, not durable' }); expect(be.pages.get(W)).toHaveLength(1);
    expect(svc.usage(W).estSpentUsd).toBe(0.05);
  });
  it('the same sentence is classified once; a message that is not durable never reaches the classifier', async () => {
    await svc.considerTurn(W, 'I prefer protective puts over perp shorts when hedging NVDA'); const n = be.calls.filter((c) => c === 'turn').length;
    expect(await svc.considerTurn(W, 'I prefer protective puts over perp shorts when hedging NVDA')).toBeNull(); expect(await svc.considerTurn(W, 'hedge my NVDA stock')).toBeNull();
    expect(be.calls.filter((c) => c === 'turn')).toHaveLength(n);
  });
  it('a broken classifier or a used-up budget means no classification, never an error', async () => {
    be.fail = true; expect(await svc.considerTurn(W, 'I prefer protective puts over perp shorts when hedging NVDA')).toBeNull();
    be.fail = false; cfg({ MEMORY_BUDGET_USD: '0' }); expect(await svc.considerTurn(W, 'I prefer calls over puts when hedging TSLA')).toBeNull();
  });
});

// ── the chat ────────────────────────────────────────────────────────────────
const req = (message: string, o: Partial<ChatRequest> = {}): ChatRequest => ({ wallet: W, signedIn: true, network: 'mainnet', message, history: [], recorded: { actions: [], events: [] }, ...o });
const ai = (content: string, calls: { name: string; args: Record<string, unknown> }[] = []) => new AIMessage({ content, tool_calls: calls.map((c, i) => ({ id: `c${i}`, name: c.name, args: c.args, type: 'tool_call' as const })) });
function script(replies: ((msgs: BaseMessage[]) => AIMessage)[]) {
  const seen: BaseMessage[][] = []; let i = 0;
  setChatModel(async (msgs) => { seen.push([...msgs]); return replies[Math.min(i++, replies.length - 1)](msgs); });
  return { seen };
}
const system = (msgs: BaseMessage[]) => String((msgs.find((m) => m instanceof SystemMessage) as SystemMessage).content);
const toolOut = (msgs: BaseMessage[]) => msgs.filter((m): m is ToolMessage => m instanceof ToolMessage).map((m) => JSON.parse(String(m.content)));

describe('memory in the chat', () => {
  beforeEach(() => { setLiveReader(async (w, n) => ({ snapshot: sampleSnapshot(w, n), note: null })); });

  it('puts what it remembers in front of the model and tells the UI which memories it used', async () => {
    be.seed(W, ['I prefer protective puts over perp shorts', true], 'Declined: Buy NVDA put. Reason: premium too high');
    const m = script([() => ai('Since you prefer puts, I would start there.')]);
    const r = await chat(req('hedge my NVDA stock'));
    expect(system(m.seen[0])).toMatch(/What I remember about this user[\s\S]*\[always keep in mind\] I prefer protective puts/);
    expect(r.memory!.backend).toBe('fake'); expect(r.memory!.used.map((u) => u.text)).toContain('I prefer protective puts over perp shorts'); expect(r.memory!.used[0].pinned).toBe(true);
  }, 30_000);

  it('a figure the user told us earlier (a $500 cap) may be repeated; one that nobody gave is still flagged', async () => {
    be.seed(W, 'Never more than $500 on one move');
    script([() => ai('You told me never more than $500 on one move, so I will keep it under that.')]);
    expect((await chat(req('hedge my NVDA stock'))).unsure).toBe(false);
  }, 30_000);

  it('the remember tool saves one short sentence and the reply says what was saved', async () => {
    const m = script([() => ai('', [{ name: 'remember', args: { text: 'I prefer protective puts over perp shorts when hedging NVDA', kind: 'preference' } }]), () => ai('Got it, I will remember that.')]);
    const r = await chat(req('please remember that I prefer protective puts over perp shorts when hedging NVDA'));
    expect(toolOut(m.seen[1])[0].saved).toMatch(/prefer protective puts/); expect(r.memory!.saved).toHaveLength(1); expect(be.pages.get(W)).toHaveLength(1);
    expect(r.steps).toEqual([]);   // remembering is not a data read, so it does not make the answer "unsure"
    expect(r.unsure).toBe(false);
  }, 30_000);

  it('the forget tool deletes the best match and the reply says which one', async () => {
    be.seed(W, 'I prefer protective puts over perp shorts');
    const m = script([() => ai('', [{ name: 'forget_memory', args: { what: 'that I prefer puts' } }]), () => ai('Done, I forgot that.')]);
    const r = await chat(req('forget that I prefer puts'));
    expect(toolOut(m.seen[1])[0].forgot).toMatch(/prefer protective puts/); expect(r.memory!.forgot).toHaveLength(1); expect(be.pages.get(W)).toEqual([]);
  }, 30_000);

  it('signed out: nothing is recalled, no memory tool exists, and the reply carries no memory field', async () => {
    be.seed(W, 'I prefer protective puts');
    const m = script([() => ai('', [{ name: 'remember', args: { text: 'I prefer calls over puts for everything' } }]), () => ai('ok')]);
    const r = await chat(req('hedge my NVDA stock', { signedIn: false }));
    expect(system(m.seen[0])).not.toMatch(/\(from past chats/); expect(r.memory).toBeUndefined(); expect(toolOut(m.seen[1])[0].error).toMatch(/unknown tool remember/); expect(be.calls).toEqual([]);
  }, 30_000);

  it('with no backend the chat answers exactly as before', async () => {
    setMemoryServiceForTests(new MemoryService(null, () => openLedger(':memory:')));
    const m = script([() => ai('Hello.')]); const r = await chat(req('hi'));
    expect(system(m.seen[0])).not.toMatch(/\(from past chats/); expect(r.memory).toBeUndefined(); expect(r.answer).toBe('Hello.');
  }, 30_000);

  it('a memory service that is down does not break the answer', async () => {
    be.fail = true; script([() => ai('Here is my answer.')]);
    const r = await chat(req('hedge my NVDA stock')); expect(r.answer).toBe('Here is my answer.'); expect(r.memory!.used).toEqual([]);
  }, 30_000);

  it('a stated preference is handed to the classifier after the answer, and its verdict and the connections come back with the reply', async () => {
    be.seed(W, 'Prefers puts for NVDA', 'Never more than $500 a move'); be.links = [{ aId: 'p1', aTitle: 'NVDA puts', bId: 'p2', bTitle: 'Move budget', strength: 'strong', reason: 'sizing' }];
    be.verdict = { worthy: true, reason: 'a lasting preference about leverage' };
    const m = script([() => ai('Noted, I will keep leverage low.')]); const r = await chat(req('From now on never use more than 3x leverage when hedging'));
    expect(r.memory!.turn).toEqual({ worthy: true, reason: 'a lasting preference about leverage' }); expect(r.memory!.connections).toEqual(['NVDA puts <-> Move budget: sizing']); expect(be.calls).toContain('turn');
    expect(system(m.seen[0])).toMatch(/Connected memories/);
  }, 30_000);

  it('when the model already saved it with remember, the classifier is not asked again (no double cost)', async () => {
    script([() => ai('', [{ name: 'remember', args: { text: 'Never use more than 3x leverage when hedging' } }]), () => ai('Saved.')]);
    const r = await chat(req('Remember that I never use more than 3x leverage when hedging')); expect(r.memory!.saved).toHaveLength(1); expect(r.memory!.turn).toBeNull(); expect(be.calls).not.toContain('turn');
  }, 30_000);

  it('a question or small talk never reaches the classifier', async () => {
    script([() => ai('Fine.')]); const r = await chat(req('How is my NVDA hedge doing?')); expect(r.memory!.turn).toBeNull(); expect(be.calls).not.toContain('turn');
  }, 30_000);
});
