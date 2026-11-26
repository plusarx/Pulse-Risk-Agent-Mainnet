import { describe, expect, it } from 'vitest';
import { Z99, loss99, maxSafeLeverage, portfolioLossUsd, putCostFraction, requiredHedgeRatio, solveHedge, type Holding } from '../src/risk/model';

// The numbers below are the build spec's own worked examples.
describe('risk model, spec examples', () => {
  it('h >= 1 - L/VaR99: 5% tolerance and 8% VaR needs 37.5%, so $18.75k of a $50k portfolio', () => {
    const h = requiredHedgeRatio(5, 8);
    expect(h).toBeCloseTo(0.375, 6);
    expect(50_000 * h).toBeCloseTo(18_750, 4);
  });
  it('no hedge needed when VaR is already inside the limit', () => { expect(requiredHedgeRatio(5, 4)).toBe(0); expect(requiredHedgeRatio(5, 5)).toBe(0); });
  it('1-week ATM put on a 40% vol name costs about 2.2% of notional', () => {
    const sigmaDay = 0.4 / Math.sqrt(252);
    expect(putCostFraction(sigmaDay)).toBeCloseTo(0.4 * 0.4 * Math.sqrt(7 / 365), 6);
    expect(putCostFraction(sigmaDay)).toBeCloseTo(0.0222, 3);
    expect(putCostFraction(0.6 / Math.sqrt(252))).toBeCloseTo(0.0332, 3);   // the 60% vol TSLA case
  });
  it('perp leverage is capped near 2.5x for a 12% p99 gap and never above the user cap', () => {
    expect(maxSafeLeverage(0.12, 5)).toBeCloseTo(2.5, 2);
    expect(maxSafeLeverage(0.12, 2)).toBe(2);
    expect(maxSafeLeverage(0.02, 3)).toBe(3);
  });
  it('uses the event gap inside the event window and z99 x sigma otherwise', () => {
    const h = { sigmaDay: 0.03, gap: 0.12 };
    expect(loss99(h, true)).toBe(0.12);
    expect(loss99(h, false)).toBeCloseTo(Z99 * 0.03, 8);
  });
});

describe('solveHedge', () => {
  const one: Holding[] = [{ ticker: 'NVDA', bstock: 'NVDAB', usd: 50_000, sigmaDay: 0.08 / Z99 }];   // single name with VaR99 = 8%
  const base = { existingHedgeUsd: {}, rho: 0.5, event: false, hedgeable: new Set(['NVDA']), excluded: new Set<string>(), fullyHedge: new Set<string>() };

  it('a single name reproduces the spec: 5% limit, 8% VaR gives a 37.5% hedge', () => {
    const s = solveHedge({ ...base, holdings: one, limitPct: 5 });
    expect(s.varUnhedged).toBeCloseTo(0.08, 4);
    expect(s.requiredHedgeRatio).toBeCloseTo(0.375, 3);
    expect(s.targetUsd.NVDA).toBeCloseTo(18_750, -1);
    expect(s.varAfter).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(s.feasible).toBe(true);
  });
  it('hedges nothing when the limit is already respected', () => {
    const s = solveHedge({ ...base, holdings: one, limitPct: 9 });
    expect(s.targetUsd).toEqual({});
  });
  it('a mixed portfolio hedges the biggest risk first and stops when the limit is met', () => {
    const hs: Holding[] = [
      { ticker: 'NVDA', bstock: 'NVDAB', usd: 20_000, sigmaDay: 0.035 },
      { ticker: 'TSLA', bstock: 'TSLAB', usd: 15_000, sigmaDay: 0.045 },
      { ticker: 'AAPL', bstock: 'AAPLB', usd: 15_000, sigmaDay: 0.015 },
    ];
    const s = solveHedge({ ...base, holdings: hs, limitPct: 5, hedgeable: new Set(['NVDA', 'TSLA', 'AAPL']) });
    expect(s.varUnhedged).toBeGreaterThan(0.05);
    expect(s.varAfter).toBeLessThanOrEqual(0.05 + 1e-6);
    // NVDA ($20k x 8.1% loss) is the biggest dollar risk, then TSLA ($15k x 10.5%); AAPL adds least and is left alone
    expect(s.targetUsd.NVDA ?? 0).toBeGreaterThan(0);
    expect(s.targetUsd.AAPL ?? 0).toBe(0);
    const used = Object.values(s.targetUsd).reduce((a, b) => a + b, 0);
    expect(used).toBeLessThan(50_000);                                              // smallest hedge, not a full hedge
  });
  it('excluded tickers are never hedged and fully-hedge tickers always are', () => {
    const hs: Holding[] = [
      { ticker: 'NVDA', bstock: 'NVDAB', usd: 20_000, sigmaDay: 0.035 },
      { ticker: 'TSLA', bstock: 'TSLAB', usd: 15_000, sigmaDay: 0.045 },
    ];
    const ex = solveHedge({ ...base, holdings: hs, limitPct: 3, hedgeable: new Set(['NVDA', 'TSLA']), excluded: new Set(['TSLA']) });
    expect(ex.targetUsd.TSLA).toBeUndefined();
    const full = solveHedge({ ...base, holdings: hs, limitPct: 50, hedgeable: new Set(['NVDA', 'TSLA']), fullyHedge: new Set(['NVDA']) });
    expect(full.targetUsd.NVDA).toBe(20_000);
  });
  it('says infeasible when the hedgeable tickers cannot reach the limit', () => {
    const hs: Holding[] = [{ ticker: 'NVDA', bstock: 'NVDAB', usd: 20_000, sigmaDay: 0.035 }, { ticker: 'GME', bstock: 'GMEB', usd: 20_000, sigmaDay: 0.06 }];
    const s = solveHedge({ ...base, holdings: hs, limitPct: 2, hedgeable: new Set(['NVDA']) });
    expect(s.feasible).toBe(false);
    expect(s.targetUsd.NVDA).toBe(20_000);
    expect(s.targetUsd.GME).toBeUndefined();
  });
  it('the event window uses the gap and needs a bigger hedge than a normal day', () => {
    const hs: Holding[] = [{ ticker: 'NVDA', bstock: 'NVDAB', usd: 20_000, sigmaDay: 0.02, gap: 0.12 }];
    const day = solveHedge({ ...base, holdings: hs, limitPct: 4 });
    const ev = solveHedge({ ...base, holdings: hs, limitPct: 4, event: true });
    expect((ev.targetUsd.NVDA ?? 0)).toBeGreaterThan(day.targetUsd.NVDA ?? 0);
  });
  it('counts hedges that are already open', () => {
    const s = solveHedge({ ...base, holdings: one, limitPct: 5, existingHedgeUsd: { NVDA: 25_000 } });
    expect(s.varNow).toBeLessThanOrEqual(0.05);
    expect(s.varUnhedged).toBeCloseTo(0.08, 4);
  });
  it('starts from open hedges: an existing hedge on one ticker reduces what is added on another and is never removed', () => {
    const hs: Holding[] = [
      { ticker: 'NVDA', bstock: 'NVDAB', usd: 12_000, sigmaDay: 0.032 },
      { ticker: 'TSLA', bstock: 'TSLAB', usd: 10_000, sigmaDay: 0.042 },
    ];
    const withTsla = solveHedge({ ...base, holdings: hs, limitPct: 5, hedgeable: new Set(['NVDA', 'TSLA']), existingHedgeUsd: { TSLA: 5_000 } });
    const none = solveHedge({ ...base, holdings: hs, limitPct: 5, hedgeable: new Set(['NVDA', 'TSLA']) });
    expect(withTsla.targetUsd.TSLA).toBeGreaterThanOrEqual(5_000);
    const added = (s: typeof none, ex: number) => Object.values(s.targetUsd).reduce((a, b) => a + b, 0) - ex;
    expect(added(withTsla, 5_000)).toBeLessThan(added(none, 0));
    expect(withTsla.varAfter).toBeLessThanOrEqual(0.05 + 1e-6);
  });
  it('portfolio loss of two identical independent names is below the sum', () => {
    expect(portfolioLossUsd([100, 100], [0.1, 0.1], 0)).toBeCloseTo(Math.sqrt(2) * 10, 6);
    expect(portfolioLossUsd([100, 100], [0.1, 0.1], 1)).toBeCloseTo(20, 6);
  });
});
