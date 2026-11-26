import { describe, expect, it } from 'vitest';
import { bpsToPercent, defaultRule, describeRule, formatUsd, healthScore, meterFor, percentToBps, planRule, ruleProblem, usdToBaseUnits, type RiskRule } from '@/lib/risk-rules';
import { AgentConfig, DEFAULT_CONFIG, HedgeLeg } from '@/lib/agent-config';
import { planFunding, planHedge } from '@/lib/plan';

const util = (over: Partial<RiskRule> = {}): RiskRule => ({ ...defaultRule('aster'), ...over });
const usdRule = (over: Partial<RiskRule> = {}): RiskRule => ({
  ...defaultRule('derive', '88346', 'PRIME'), mode: 'account_value', triggerBps: null, targetBps: null, releaseLevelBps: null,
  triggerBaseUnit: '100000000', targetBaseUnit: '200000000', ...over,
});

describe('unit conversion', () => {
  it('percent ↔ bps', () => { expect(percentToBps('70')).toBe(7000); expect(percentToBps('70.5%')).toBe(7050); expect(percentToBps('101')).toBeNull(); expect(bpsToPercent(7050)).toBe('70.5%'); });
  it('usd ↔ base units without floats', () => { expect(usdToBaseUnits('$2,000.50')).toBe('2000500000'); expect(usdToBaseUnits('0')).toBeNull(); expect(formatUsd('2000500000')).toBe('$2,000.50'); });
});

describe('ruleProblem (mirrors the original terminal)', () => {
  it('accepts defaults', () => { expect(ruleProblem(util())).toBeNull(); expect(ruleProblem(usdRule())).toBeNull(); });
  it('target must be below trigger', () => { expect(ruleProblem(util({ targetBps: 8000 }))).toMatch(/target must be below/); });
  it('release level below target', () => { expect(ruleProblem(util({ releaseOn: true, releaseLevelBps: 5000 }))).toMatch(/Release level must be below/); });
  it('USD: trigger below target, release above', () => {
    expect(ruleProblem(usdRule({ triggerBaseUnit: '300000000' }))).toMatch(/below the target/);
    expect(ruleProblem(usdRule({ releaseOn: true, releaseLevelBaseUnit: '150000000' }))).toMatch(/above the target/);
  });
  it('venue minimum move and limit ordering', () => {
    expect(ruleProblem(util({ minMoveBaseUnit: '1000000' }))).toMatch(/minimum move/);
    expect(ruleProblem(util({ maxPerMoveBaseUnit: '9000000000' }))).toMatch(/daily cap/);
  });
  it('config schema runs the same checks', () => {
    expect(AgentConfig.safeParse(DEFAULT_CONFIG).success).toBe(true);
    const c = structuredClone(DEFAULT_CONFIG); c.rebalance.rules = [util(), util()];
    expect(AgentConfig.safeParse(c).success).toBe(false); // duplicate account
    c.rebalance.rules = [util({ targetBps: 9000 })];
    expect(AgentConfig.safeParse(c).success).toBe(false);
  });
});

describe('planRule', () => {
  const h = (utilPct: number, equity = 1000) => ({ connected: true, utilBps: utilPct * 100, accountUsd: equity, usedUsd: equity * utilPct / 100 });
  it('in band → none', () => { expect(planRule(util(), h(50)).kind).toBe('none'); });
  it('tops up to target, capped by max per move', () => {
    // used 800, target 45% → equity 1777.78 → need 777.78, capped at $500
    const a = planRule(util(), h(80));
    expect(a).toMatchObject({ kind: 'top_up', amountBaseUnit: '500000000' });
  });
  it('rounds a small top-up UP to the minimum move', () => {
    const a = planRule(util(), h(71, 10)); // need ≈ 5.78 → min $6
    expect(a).toMatchObject({ kind: 'top_up', amountBaseUnit: '6000000' });
  });
  it('respects run-once', () => { expect(planRule(util({ topUpOnce: true }), h(80), { topUpDoneAt: new Date().toISOString() }).kind).toBe('none'); });
  it('release waits for the dwell, then releases down to target', () => {
    const r = util({ releaseOn: true, releaseLevelBps: 2500, releaseForSec: 600 });
    expect(planRule(r, h(10)).kind).toBe('none'); // no dwell start yet
    const since = new Date(Date.now() - 700_000).toISOString();
    const a = planRule(r, h(10), { releaseBelowSince: since }); // used 100 → equity at 45% = 222.22 → excess 777.78 → cap 500
    expect(a).toMatchObject({ kind: 'release', amountBaseUnit: '500000000' });
  });
  it('USD mode: below trigger tops up to target', () => {
    expect(planRule(usdRule(), { connected: true, utilBps: 0, accountUsd: 50, usedUsd: 0 })).toMatchObject({ kind: 'top_up', amountBaseUnit: '150000000' });
  });
  it('paused rule never moves', () => { expect(planRule(util({ enabled: false }), h(99)).kind).toBe('none'); });
});

describe('meter + describe', () => {
  it('utilization meter zones', () => {
    const m = meterFor(util({ releaseOn: true }), { connected: true, utilBps: 8000, accountUsd: 1, usedUsd: 1 }, 'percent');
    expect(m.state).toBe('topup'); expect(m.topUpZone).toEqual([7000, 10_000]); expect(m.releaseZone).toEqual([0, 2500]);
  });
  it('account-value meter puts top-up on the left', () => {
    const m = meterFor(usdRule(), { connected: true, utilBps: null, accountUsd: 50, usedUsd: null }, 'usdc');
    expect(m.state).toBe('topup'); expect(m.topUpZone?.[0]).toBe(0);
  });
  it('describes the rule', () => { expect(describeRule(util())).toMatch(/rises above 70% → top up to 45%/); });
  it('health score', () => { expect(healthScore(0, null)).toBe(100); expect(healthScore(100, 0)).toBe(0); expect(healthScore(50, 40)).toBe(65); });
});

describe('planFunding', () => {
  const cfg = { ...DEFAULT_CONFIG.rebalance };
  it('uses BSC USDC above the reserve, then sells bStocks after the haircut', () => {
    const f = planFunding('500000000', { bscUsdc: 100, bscUsdt: 0, bstocks: [{ symbol: 'SPYB', value: 1000 }] }, cfg, 0.3);
    expect(f.sources).toEqual([{ source: 'bsc_usdc', amountUsd: 90 }, { source: 'sell SPYB', amountUsd: 410 }]);
    expect(f.shortfallUsd).toBe(0);
  });
  it('reports a shortfall', () => { expect(planFunding('500000000', { bscUsdc: 0, bscUsdt: 0, bstocks: [] }, cfg, 0.3).shortfallUsd).toBe(500); });
});

describe('planHedge', () => {
  const lighterLeg = { bstock: 'NVDAB', venue: 'lighter' as const, kind: 'perp' as const, market: 'NVDA', marketId: 110, hedgeRatio: 1 };
  const hc = { enabled: true, driftThresholdPct: 5, legs: [lighterLeg] };
  const held = { NVDAB: { qty: 2, price: 135 } };
  const px = { 'lighter:110': 135 };
  it('shorts the full holding when unhedged (same price = share count)', () => {
    const [a] = planHedge(hc, held, {}, px); expect(a.deltaUnits).toBeCloseTo(2, 9); expect(a.act).toBe(true); expect(a.key).toBe('lighter:110');
  });
  it('quiet within threshold', () => { expect(planHedge(hc, held, { 'lighter:110': -1.95 }, px)[0].act).toBe(false); });
  it('buys back when over-hedged and closes a wrong-way long', () => {
    expect(planHedge(hc, { NVDAB: { qty: 1, price: 135 } }, { 'lighter:110': -2 }, px)[0].deltaUnits).toBeCloseTo(-1, 9);
    const [b] = planHedge(hc, held, { 'lighter:110': 0.5 }, px); expect(b.deltaUnits).toBeCloseTo(2.5, 9); expect(b.act).toBe(true);
  });
  it('sizes a Derive index proxy by notional (SPYB → US500)', () => {
    const leg = { bstock: 'SPYB', venue: 'derive' as const, kind: 'perp' as const, market: 'US500', hedgeRatio: 1 };
    const [a] = planHedge({ ...hc, legs: [leg] }, { SPYB: { qty: 10, price: 600 } }, {}, { 'derive-perp:US500': 6000 });
    expect(a.key).toBe('derive-perp:US500'); expect(a.targetUnits).toBeCloseTo(1, 9); // $6,000 of SPYB ÷ 6,000
  });
  it('sizes a Lighter index proxy by notional (SPYB → Lighter US500, market 180)', () => {
    const leg = { bstock: 'SPYB', venue: 'lighter' as const, kind: 'perp' as const, market: 'US500', marketId: 180, hedgeRatio: 1 };
    const [a] = planHedge({ ...hc, legs: [leg] }, { SPYB: { qty: 10, price: 726.19 } }, { 'lighter:180': -0.5 }, { 'lighter:180': 7261.9 });
    expect(a.key).toBe('lighter:180'); expect(a.targetUnits).toBeCloseTo(1, 9); expect(a.deltaUnits).toBeCloseTo(0.5, 9); // $7,261.9 of SPYB
  });
  it('protective puts count long contracts, not shorts', () => {
    const leg = { bstock: 'NVDAB', venue: 'derive' as const, kind: 'put' as const, market: 'NVDA', hedgeRatio: 1, put: { strikePct: 90, minDaysToExpiry: 7, targetDaysToExpiry: 30 } };
    const [a] = planHedge({ ...hc, legs: [leg] }, held, { 'derive-put:NVDA': 0.5 }, { 'derive-put:NVDA': 135 });
    expect(a.currentUnits).toBe(0.5); expect(a.deltaUnits).toBeCloseTo(1.5, 9); expect(a.reason).toMatch(/buy puts/);
  });
  it('waits for prices instead of guessing', () => { expect(planHedge(hc, { NVDAB: { qty: 2, price: null } }, {}, px)[0].act).toBe(false); });
  it('schema enforces venue/kind rules', () => {
    expect(HedgeLeg.safeParse({ ...lighterLeg, kind: 'put' }).success).toBe(false);
    expect(HedgeLeg.safeParse({ bstock: 'NVDAB', venue: 'lighter', market: 'NVDA', hedgeRatio: 1 }).success).toBe(false); // no marketId
    expect(HedgeLeg.safeParse({ bstock: 'NVDAB', venue: 'derive', kind: 'put', market: 'NVDA', hedgeRatio: 1 }).success).toBe(false); // no put settings
    expect(HedgeLeg.parse({ bstock: 'NVDAB', venue: 'lighter', market: 'NVDA', marketId: 110, hedgeRatio: 1 }).kind).toBe('perp'); // old saved legs default to perp
  });
});
