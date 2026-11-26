import { beforeAll, describe, expect, it } from 'vitest';

const W = '0xFfa4Bcc5576995865B083224aD49da28B6a02c7A';
const P = { wallet: W, network: 'testnet', venue: 'aster', accountRef: '', structural_risk: 'risk', reasoning: 'why',
  proposed_rule: { top_up_trigger: 0.62, restore_target: 0.45, release_trigger: 0.25, primary_source: 'bstocks_bnb' }, idempotencyKey: 'prop-aaaaaaaa' } as const;

let store: typeof import('../lib/server/agent-store');
beforeAll(async () => { process.env.DB_PATH = ':memory:'; store = await import('../lib/server/agent-store'); });

describe('proposals store', () => {
  it('creates a pending proposal and is idempotent on the key', () => {
    const a = store.createProposal(P as never); const b = store.createProposal(P as never);
    expect(a.duplicate).toBe(false); expect(b).toEqual({ id: a.id, duplicate: true });
    expect(store.listProposals(W, 'testnet').filter((p) => p.status === 'pending')).toHaveLength(1);
  });
  it('a newer proposal for the same account supersedes the pending one', () => {
    store.createProposal({ ...P, idempotencyKey: 'prop-bbbbbbbb', proposed_rule: { ...P.proposed_rule, top_up_trigger: 0.7 } } as never);
    const rows = store.listProposals(W, 'testnet');
    expect(rows.filter((p) => p.status === 'pending')).toHaveLength(1);
    expect(rows.filter((p) => p.status === 'superseded')).toHaveLength(1);
  });
  it('approve applies the rule, arms automation, logs an event and cannot be repeated', () => {
    const pending = store.listProposals(W, 'testnet').find((p) => p.status === 'pending')!;
    store.decideProposal(W, 'testnet', pending.id, 'approve');
    const cfg = store.readConfig(W, 'testnet');
    expect(cfg.rebalance.enabled).toBe(true);
    expect(cfg.rebalance.rules[0].triggerBps).toBe(7000);
    expect(cfg.rebalance.sources[0]).toBe('sell_bstocks');
    expect(store.listEvents(W, 'testnet').some((e) => (e as { message: string }).message.includes('approved'))).toBe(true);
    expect(() => store.decideProposal(W, 'testnet', pending.id, 'approve')).toThrow(/already approved/);
  });
  it('reject leaves the config alone', () => {
    store.createProposal({ ...P, wallet: '0x2222222222222222222222222222222222222222', idempotencyKey: 'prop-cccccccc' } as never);
    const id = store.listProposals('0x2222222222222222222222222222222222222222', 'testnet')[0].id;
    store.decideProposal('0x2222222222222222222222222222222222222222', 'testnet', id, 'reject');
    expect(store.readConfig('0x2222222222222222222222222222222222222222', 'testnet').rebalance.rules).toHaveLength(0);
  });
});

describe('undo an approval', () => {
  const W3 = '0x3333333333333333333333333333333333333333';
  it('restores the config from before the approval and cannot be repeated', () => {
    store.createProposal({ ...P, wallet: W3, idempotencyKey: 'prop-dddddddd' } as never);
    const id = store.listProposals(W3, 'testnet')[0].id;
    expect(store.readConfig(W3, 'testnet').rebalance.enabled).toBe(false);
    store.decideProposal(W3, 'testnet', id, 'approve');
    expect(store.readConfig(W3, 'testnet').rebalance.enabled).toBe(true);
    store.decideProposal(W3, 'testnet', id, 'revert');
    const c = store.readConfig(W3, 'testnet');
    expect(c.rebalance.enabled).toBe(false); expect(c.rebalance.rules).toHaveLength(0);
    expect(store.listProposals(W3, 'testnet')[0].status).toBe('reverted');
    expect(() => store.decideProposal(W3, 'testnet', id, 'revert')).toThrow(/already reverted/);
  });
  it('cannot undo a proposal that was never approved', () => {
    store.createProposal({ ...P, wallet: W3, idempotencyKey: 'prop-eeeeeeee' } as never);
    const id = store.listProposals(W3, 'testnet')[0].id;
    expect(() => store.decideProposal(W3, 'testnet', id, 'revert')).toThrow(/already pending/);
  });
});

describe('clear history', () => {
  it('removes rejected, superseded and undone proposals but keeps approved and pending ones', () => {
    const W4 = '0x4444444444444444444444444444444444444444';
    const mk = (key: string, trig = 0.62) => store.createProposal({ ...P, wallet: W4, idempotencyKey: key, proposed_rule: { ...P.proposed_rule, top_up_trigger: trig } } as never);
    mk('prop-hhhhhhh1', 0.6);                       // superseded by the next one
    mk('prop-hhhhhhh2', 0.61);
    const id2 = store.listProposals(W4, 'testnet')[0].id;
    store.decideProposal(W4, 'testnet', id2, 'approve');
    mk('prop-hhhhhhh3', 0.63);                      // pending
    expect(store.clearProposalHistory(W4, 'testnet')).toBe(1);
    const left = store.listProposals(W4, 'testnet').map((p) => p.status).sort();
    expect(left).toEqual(['approved', 'pending']);
  });
});
