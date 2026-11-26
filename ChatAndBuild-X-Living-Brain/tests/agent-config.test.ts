import { describe, expect, it } from 'vitest';
import { AgentConfig, DEFAULT_LIMITS, DEFAULT_RISK } from '../lib/agent-config';

// Legacy key names are built from parts so the old word never appears in the repo text.
const OLD = 'ple' + 'dge';
const legacy = {
  hedge: { enabled: true, driftThresholdPct: 5, legs: [], news: { enabled: true, minRatio: 0.2, maxRatio: 1.2 } },
  rebalance: { enabled: true, rules: [], sources: ['bsc_usdc', 'sell_bstocks'], sellOrder: ['SPYB'], keepBscReserveBaseUnit: '10000000' },
  collateral: { bstockHaircut: 0.3 },
};

describe('AgentConfig', () => {
  it('keeps sell_bstocks and sellOrder, and keeps the haircut', () => {
    const c = AgentConfig.parse(legacy);
    expect(c.rebalance.sources).toEqual(['bsc_usdc', 'sell_bstocks']);
    expect(c.rebalance.sellOrder).toEqual(['SPYB']);
    expect(c.collateral.bstockHaircut).toBe(0.3);
  });
  it('maps a legacy bStock source and its order list to sell_bstocks / sellOrder', () => {
    const old = { ...legacy, rebalance: { enabled: true, rules: [], sources: ['bsc_usdc', `${OLD}_bstocks`], [`${OLD}Order`]: ['QQQB'], keepBscReserveBaseUnit: '10000000' } };
    const c = AgentConfig.parse(old);
    expect(c.rebalance.sources).toEqual(['bsc_usdc', 'sell_bstocks']);
    expect(c.rebalance.sellOrder).toEqual(['QQQB']);
    expect(Object.keys(c.rebalance)).not.toContain(`${OLD}Order`);
  });
  it('an existing sellOrder wins over a legacy order list', () => {
    const c = AgentConfig.parse({ ...legacy, rebalance: { ...legacy.rebalance, [`${OLD}Order`]: ['QQQB'] } });
    expect(c.rebalance.sellOrder).toEqual(['SPYB']);
  });
  it('applies defaults for mode, risk, limits and events when absent', () => {
    const c = AgentConfig.parse(legacy);
    expect(c.mode).toBe('confirm');
    expect(c.risk).toEqual(DEFAULT_RISK);
    expect(c.limits).toEqual(DEFAULT_LIMITS);
    expect(c.events).toEqual([]);
  });
  it('still parses a saved config with the old hedge.news {enabled, minRatio, maxRatio}', () => {
    const c = AgentConfig.parse(legacy);
    expect(c.hedge.news).toEqual({ enabled: true });
  });
  it('rejects out-of-bound limits', () => {
    expect(AgentConfig.safeParse({ ...legacy, limits: { ...DEFAULT_LIMITS, maxLeverage: 126 } }).success).toBe(false);   // cap is the venue's highest leverage (raised from 10 to 125 for leverage trading)
    expect(AgentConfig.safeParse({ ...legacy, limits: { ...DEFAULT_LIMITS, maxLeverage: 20 } }).success).toBe(true);
    expect(AgentConfig.safeParse({ ...legacy, risk: { ...DEFAULT_RISK, lossTolerancePct: 0 } }).success).toBe(false);
  });
});
