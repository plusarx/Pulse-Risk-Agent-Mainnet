import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../lib/agent-config';
import { ProposalIn, applyProposal } from '../lib/agent-proposal';

const base = { wallet: '0x1111111111111111111111111111111111111111', network: 'testnet', venue: 'aster', accountRef: '', structural_risk: 'x', reasoning: 'y', idempotencyKey: 'prop-12345678',
  proposed_rule: { top_up_trigger: 0.62, restore_target: 0.45, release_trigger: 0.25, primary_source: 'bstocks_bnb' } } as const;

describe('proposal schema', () => {
  it('accepts the spec example', () => expect(ProposalIn.safeParse(base).success).toBe(true));
  it('rejects restore >= trigger and release >= restore', () => {
    expect(ProposalIn.safeParse({ ...base, proposed_rule: { ...base.proposed_rule, restore_target: 0.7 } }).success).toBe(false);
    expect(ProposalIn.safeParse({ ...base, proposed_rule: { ...base.proposed_rule, release_trigger: 0.5 } }).success).toBe(false);
  });
});

describe('applyProposal', () => {
  it('creates the rule, orders funding by primary source and arms automation', () => {
    const c = applyProposal(DEFAULT_CONFIG, base);
    const r = c.rebalance.rules[0];
    expect([r.triggerBps, r.targetBps, r.releaseLevelBps, r.releaseOn, r.enabled]).toEqual([6200, 4500, 2500, true, true]);
    expect(c.rebalance.sources[0]).toBe('sell_bstocks');
    expect(c.rebalance.enabled).toBe(true);
  });
  it('keeps an existing rule\'s caps and does not duplicate it', () => {
    const once = applyProposal(DEFAULT_CONFIG, base);
    once.rebalance.rules[0].maxPerMoveBaseUnit = '123000000';
    const twice = applyProposal(once, { ...base, proposed_rule: { ...base.proposed_rule, top_up_trigger: 0.6, primary_source: 'exchange_wallet' } });
    expect(twice.rebalance.rules).toHaveLength(1);
    expect(twice.rebalance.rules[0].maxPerMoveBaseUnit).toBe('123000000');
    expect(twice.rebalance.rules[0].triggerBps).toBe(6000);
    expect(twice.rebalance.sources[0]).toBe('bsc_usdc');
  });
  it('refuses a proposal for the dormant Lighter venue (no longer a rule venue)', () => {
    expect(() => applyProposal(DEFAULT_CONFIG, { ...base, venue: 'lighter' })).toThrow();
  });
});
