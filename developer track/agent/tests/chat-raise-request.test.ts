import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ posted: [] as Record<string, unknown>[], fail: false }));
vi.mock('../src/tools/appApi', async (orig) => ({
  ...(await orig<typeof import('../src/tools/appApi')>()),
  postActionToApp: async (a: Record<string, unknown>) => { if (h.fail) throw new Error('the app is down'); const dup = h.posted.some((p) => p.idempotencyKey === a.idempotencyKey); if (!dup) h.posted.push(a); return { id: 7, duplicate: dup, status: 'pending' as const }; },
}));
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { loadConfig, resetConfigForTests } from '../src/config';
import { chat, setChatModel, setLiveReader, type ChatRequest } from '../src/chat/chat';
import { sampleSnapshot } from '../src/chat/sample';

// "Hedge my portfolio": when the agent would ask first, the chat raises that very request so Approve is there at once, instead of after the live
// agent's next 30 s check. Same slot and idempotency key as the live agent, so the two never double up.
const WALLET = '0x1111111111111111111111111111111111111111';
const req = (message: string, o: Partial<ChatRequest> = {}): ChatRequest => ({ wallet: WALLET, signedIn: true, network: 'mainnet', message, history: [], recorded: { actions: [], events: [] }, ...o });
const ai = (content: string, calls: { name: string; args: Record<string, unknown> }[] = []) => new AIMessage({ content, tool_calls: calls.map((c, i) => ({ id: `c${i}`, name: c.name, args: c.args, type: 'tool_call' as const })) });
function script(replies: ((msgs: BaseMessage[]) => AIMessage)[]) {
  const seen: BaseMessage[][] = []; let i = 0;
  setChatModel(async (msgs) => { seen.push([...msgs]); return replies[Math.min(i++, replies.length - 1)](msgs); });
  return { seen, calls: () => i };
}
const facts = (msgs: BaseMessage[]) => msgs.filter((m): m is ToolMessage => m instanceof ToolMessage).flatMap((m) => (JSON.parse(String(m.content)).facts ?? []) as { id: string; label: string; value: string }[]);
const run = (args: Record<string, unknown> = { base: 'current' }) => [() => ai('', [{ name: 'run_hedging_agent', args }]), () => ai('The request is waiting below for your Approve. Nothing is placed until you press Approve.')];

beforeEach(() => {
  h.posted.length = 0; h.fail = false;
  setLiveReader(async (w, n) => { const s = sampleSnapshot(w, n); s.config.mode = 'confirm'; return { snapshot: s, note: null }; });
  resetConfigForTests(loadConfig({ ...process.env, DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off' }));
});
afterEach(() => { setChatModel(); setLiveReader(); resetConfigForTests(); });

describe('the chat raises the hedge request for Approve', () => {
  it('signed in, own numbers unchanged, agent would ask first: the request is posted once and the reply shows the Approve block', async () => {
    const m = script(run());
    const r = await chat(req('Hedge my portfolio'));
    expect(h.posted).toHaveLength(1);
    const p = h.posted[0] as { wallet: string; slot: string; kind: string; origin: string; idempotencyKey: string; detail: { candidateId: string } };
    expect(p.wallet).toBe(WALLET); expect(p.kind).toBe('hedge'); expect(p.origin).toBe('rule'); expect(p.slot).toMatch(/^hedge:/); expect(p.idempotencyKey).toMatch(/^act-/); expect(p.detail.candidateId).toMatch(/^hedge:/);
    expect(r.ui.showPending).toBe(true);
    expect(facts(m.seen[1]).find((f) => f.label === 'Hedge request')!.value).toMatch(/created for Approve \(status pending\).*NOT placed yet.*presses Approve/);
    expect(r.answer).toMatch(/The request is waiting below for your Approve/);   // the claim is true, so it is not rewritten to "I did not create that request"
    expect(m.calls()).toBe(2);
  }, 90_000);

  it('asking again does not double it: the same request is already waiting', async () => {
    const m1 = script(run()); await chat(req('Hedge my portfolio')); expect(m1.calls()).toBe(2);
    const m2 = script(run()); await chat(req('Hedge my portfolio again'));
    expect(h.posted).toHaveLength(1); expect(facts(m2.seen[1]).find((f) => f.label === 'Hedge request')!.value).toMatch(/already waiting/);
  }, 90_000);

  it('signed out: nothing is posted (Approve needs a session)', async () => {
    script(run()); await chat(req('Hedge my portfolio', { signedIn: false }));
    expect(h.posted).toHaveLength(0);
  }, 90_000);

  it('a test with changed numbers is a test, not a request', async () => {
    const m = script(run({ base: 'current', overrides: { lossLimitPct: 1 } })); const r = await chat(req('What if my loss limit were 1%?'));
    expect(h.posted).toHaveLength(0); expect(facts(m.seen[1]).some((f) => f.label === 'Hedge request')).toBe(false);
    expect(r.answer).toMatch(/did not create that request/);   // the model claimed one anyway, and the guard corrects it
  }, 90_000);

  it('if the app cannot take the request, it says so and the live agent posts it later', async () => {
    h.fail = true; const m = script(run());
    const r = await chat(req('Hedge my portfolio'));
    expect(h.posted).toHaveLength(0); expect(facts(m.seen[1]).find((f) => f.label === 'Hedge request')!.value).toMatch(/could not be raised for Approve just now \(the app is down\).*within about 30 seconds/);
    expect(r.answer).toMatch(/did not create that request/);
  }, 90_000);
});
