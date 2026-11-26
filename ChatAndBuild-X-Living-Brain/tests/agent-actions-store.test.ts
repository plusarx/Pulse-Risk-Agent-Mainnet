import { beforeAll, describe, expect, it } from 'vitest';

const W = '0xFfa4Bcc5576995865B083224aD49da28B6a02c7A';
const A = { wallet: W, network: 'testnet', kind: 'top_up', venue: 'lighter', origin: 'rule', slot: 'top_up:lighter:', title: 'Add $82.22 to your Lighter margin',
  why: 'utilization 82% above 70%', helps: 'lowers utilization to 45%', willDo: ['pull USDC', 'bridge', 'wait'], detail: { amountBaseUnit: '82220000' }, idempotencyKey: 'act-aaaaaaaa' } as const;

let store: typeof import('../lib/server/agent-actions');
let cfgStore: typeof import('../lib/server/agent-store');
beforeAll(async () => { process.env.DB_PATH = ':memory:'; store = await import('../lib/server/agent-actions'); cfgStore = await import('../lib/server/agent-store'); });

describe('confirmation-mode actions', () => {
  it('config defaults to confirm mode and old saved configs still load', () => {
    expect(cfgStore.readConfig('0x1111111111111111111111111111111111111111', 'testnet').mode).toBe('confirm');
  });
  it('creates a pending request, idempotent on the key, and logs that it is waiting', () => {
    const a = store.createAction(A as never); const b = store.createAction(A as never);
    expect(a.duplicate).toBe(false); expect(b).toMatchObject({ id: a.id, duplicate: true, status: 'pending' });
    expect(cfgStore.listEvents(W, 'testnet').some((e) => (e as { message: string }).message.startsWith('Waiting for your approval'))).toBe(true);
  });
  it('a newer request in the same slot supersedes the open one', () => {
    store.createAction({ ...A, idempotencyKey: 'act-bbbbbbbb', title: 'Add $90 to your Lighter margin' } as never);
    const rows = store.listActions(W, 'testnet');
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'superseded')).toHaveLength(1);
  });
  it('approve makes it visible to the agent; the agent acknowledges; it cannot be completed twice', () => {
    const pending = store.listActions(W, 'testnet').find((r) => r.status === 'pending')!;
    expect(store.listApprovedActions(W, 'testnet', 'pending')).toHaveLength(1);
    expect(store.listApprovedActions(W, 'testnet')).toHaveLength(0);
    store.decideAction(W, 'testnet', pending.id, 'approve');
    expect(store.listApprovedActions(W, 'testnet')).toHaveLength(1);
    expect(() => store.decideAction(W, 'testnet', pending.id, 'reject')).toThrow(/already approved/);
    const done = store.completeAction(W, 'testnet', pending.id, 'executed', 'Done. Added $90.');
    expect(done.status).toBe('executed'); expect(done.result_message).toMatch(/Done/);
    expect(store.listApprovedActions(W, 'testnet')).toHaveLength(0);
    expect(() => store.completeAction(W, 'testnet', pending.id, 'executed', 'again')).toThrow(/only approved/);
    expect(cfgStore.listEvents(W, 'testnet').some((e) => (e as { message: string }).message.startsWith('Done:'))).toBe(true);
  });
  it('reject changes nothing and the agent cannot complete a rejected request', () => {
    const r = store.createAction({ ...A, slot: 'hedge:NVDA', kind: 'hedge', idempotencyKey: 'act-cccccccc', title: 'Buy back 4.3 NVDA short' } as never);
    store.decideAction(W, 'testnet', r.id!, 'reject');
    expect(() => store.completeAction(W, 'testnet', r.id!, 'executed', 'x')).toThrow(/only approved/);
  });
  it('clearing history removes only requests that never ran', () => {
    expect(store.clearActionHistory(W, 'testnet')).toBeGreaterThan(0);
    expect(store.listActions(W, 'testnet').every((r) => r.status === 'executed')).toBe(true);
  });
});
