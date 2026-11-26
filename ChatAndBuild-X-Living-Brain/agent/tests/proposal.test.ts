import { describe, expect, it } from 'vitest';
import { realizedVol1h } from '../src/tools/metrics';
import { fitRule, type FitInputs, type FitParams } from '../src/proposal/compute';

const P: FitParams = { maxUtil: 0.9, kSigma: 3, volStress: 2, minTrigger: 0.4, maxTrigger: 0.8, tickSec: 30 };
const base: FitInputs = { vol1h: 0.041, latencySec: 18, leverage: 12, utilNow: 0.55, equityUsd: 10_000, usedUsd: 5_500, bnbStablesUsd: 0, bstocksAfterHaircutUsd: 7_000 };

describe('fitRule', () => {
  it('higher volatility lowers the trigger', () => {
    const calm = fitRule({ ...base, vol1h: 0.004 }, P).rule.top_up_trigger;
    const wild = fitRule({ ...base, vol1h: 0.041 }, P).rule.top_up_trigger;
    expect(wild).toBeLessThan(calm);
  });
  it('slower transfers and higher leverage lower the trigger', () => {
    const fast = fitRule({ ...base, latencySec: 5 }, P).rule.top_up_trigger;
    const slow = fitRule({ ...base, latencySec: 900 }, P).rule.top_up_trigger;
    expect(slow).toBeLessThan(fast);
    expect(fitRule({ ...base, leverage: 30 }, P).rule.top_up_trigger).toBeLessThan(fitRule({ ...base, leverage: 3 }, P).rule.top_up_trigger);
  });
  it('keeps release < restore < trigger and stays inside the allowed range', () => {
    for (const vol1h of [0.0005, 0.01, 0.2]) for (const leverage of [1, 10, 60]) {
      const r = fitRule({ ...base, vol1h, leverage }, P).rule;
      expect(r.release_trigger).toBeLessThan(r.restore_target);
      expect(r.restore_target).toBeLessThan(r.top_up_trigger);
      expect(r.top_up_trigger).toBeGreaterThanOrEqual(0.4); expect(r.top_up_trigger).toBeLessThanOrEqual(0.8);
    }
  });
  it('catches the empty BNB wallet and picks bStocks when they can cover it', () => {
    const f = fitRule(base, P);
    expect(f.rule.primary_source).toBe('bstocks_bnb');
    expect(f.facts.join(' ')).toMatch(/no USDC or USDT/);
  });
  it('prefers BNB stables when they can cover a top-up', () => {
    expect(fitRule({ ...base, bnbStablesUsd: 50_000 }, P).rule.primary_source).toBe('exchange_wallet');
  });
  it('says so when no source has capacity', () => {
    expect(fitRule({ ...base, bstocksAfterHaircutUsd: 10 }, P).facts.join(' ')).toMatch(/no source has capacity/);
  });
});

describe('realizedVol1h', () => {
  it('is null with too little data and zero for a flat market', () => {
    expect(realizedVol1h([1, 2, 3])).toBeNull();
    expect(realizedVol1h(Array(61).fill(100))).toBe(0);
  });
  it('scales per-minute noise by sqrt(60)', () => {
    const closes = [100]; for (let i = 1; i < 61; i++) closes.push(closes[i - 1] * (i % 2 ? 1.001 : 0.999));
    const v = realizedVol1h(closes)!;
    expect(v).toBeGreaterThan(0.007); expect(v).toBeLessThan(0.0095);
  });
});
