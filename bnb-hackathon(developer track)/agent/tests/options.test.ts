import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigForTests } from '../src/config';
import { fixtureSnapshot } from '../src/fixtures';
import { buildGraph } from '../src/graph';
import { memoryActions, setActionsBackend } from '../src/tools/appApi';
import { execute } from '../src/tools/executor';
import { buildCandidates } from '../src/tools/planner';
import { closeStore, logPut, openPuts, openStore } from '../src/tools/store';
import { pickPut, sampleChain } from '../src/risk/options';
import type { Snapshot } from '../src/types';

const env = (o: Record<string, string> = {}) => resetConfigForTests(loadConfig({ DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off', ...o }));
beforeEach(() => { openStore(':memory:'); env(); });
afterEach(() => { closeStore(); setActionsBackend(); resetConfigForTests(); });

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** $12,000 NVDAB (60 x $200). NVDA reports in 20h. Derive has $400 free collateral for a premium. */
function snap(over: Partial<Snapshot> = {}): Snapshot {
  const s = fixtureSnapshot({ health: { 'aster:': { connected: true, utilBps: 3000, accountUsd: 500, usedUsd: 150 } } });
  s.config.hedge = { enabled: true, driftThresholdPct: 5, sizing: 'loss_limit', news: { enabled: false }, legs: [{ bstock: 'NVDAB', venue: 'aster', kind: 'perp', market: 'NVDA', hedgeRatio: 1 }] };
  s.config.risk = { ...s.config.risk, lossTolerancePct: 5 };
  s.config.events = [{ ticker: 'NVDA', at: hours(20), kind: 'earnings', gapPct: 12 }];
  s.bsc = { usdcUsd: 3000, usdtUsd: 0, allowanceUsdcBase: '2500000000', bstocks: [{ symbol: 'NVDAB', qty: 60, value: 12_000, allowanceQty: 60 }] };
  s.perpPositions = {}; s.perpMain = { equityUsd: 500, freeUsd: 350 }; s.perpEtaSec = 600; s.deriveEtaSec = 1800; s.hedgeProblems = [];
  s.market = { sigmaDay: { NVDA: 0.032 }, at: new Date().toISOString() };
  s.today = { notionalUsd: 0, lossUsd: 0, capitalOffBnbUsd: 500, pausedReason: null };
  s.options = { NVDA: sampleChain('NVDA', 200, 0.5) };
  s.deriveFree = { ref: '42', freeUsd: 400 };
  return Object.assign(s, over);
}

describe('pickPut', () => {
  const chain = sampleChain('NVDA', 200, 0.5);
  it('takes the first expiry that covers the event and the strike at the money', () => {
    const p = pickPut(chain, 5_000, new Date(Date.now() + 20 * 3_600_000))!;
    expect(p.daysToExpiry).toBeCloseTo(7, 0); expect(p.strike).toBe(200);
    expect(p.contracts).toBeCloseTo(25, 1); expect(p.notionalUsd).toBeCloseTo(5_000, -1);
    expect(p.costFraction).toBeGreaterThan(0.01); expect(p.costFraction).toBeLessThan(0.05);
  });
  it('moves to the next expiry when the event is after the first one', () => {
    expect(pickPut(chain, 5_000, new Date(Date.now() + 10 * 86_400_000))!.daysToExpiry).toBeCloseTo(14, 0);
  });
  it('returns nothing when no expiry covers the event, the book is empty, or the size is zero', () => {
    expect(pickPut(chain, 5_000, new Date(Date.now() + 40 * 86_400_000))).toBeNull();
    expect(pickPut({ ...chain, expiries: chain.expiries.map((e) => ({ ...e, puts: [] })) }, 5_000, new Date())).toBeNull();
    expect(pickPut(chain, 0, new Date())).toBeNull();
  });
  it('is limited by the quoted size', () => {
    const thin = { ...chain, expiries: chain.expiries.map((e) => ({ ...e, puts: e.puts.map((q) => ({ ...q, size: 3 })) })) };
    expect(pickPut(thin, 50_000, new Date())!.contracts).toBe(3);
  });
});

describe('put hedges on Derive', () => {
  it('prefers a put ahead of a scheduled earnings gap and shows what it costs and what it caps', () => {
    const c = buildCandidates(snap()).candidates.find((x) => x.kind === 'hedge')!;
    expect(c.venue).toBe('derive'); expect(c.hedge!.instrument).toBe('put'); expect(c.hedge!.option!.contracts).toBeGreaterThan(0);
    const p = c.plan!;
    expect(p.venue).toBe('derive'); expect(p.leverage).toBeNull(); expect(p.cost.premiumUsd).toBeGreaterThan(0);
    expect(p.varAfterPct).toBeLessThan(p.varBeforePct); expect(p.worstCase).toMatch(/lose at most the premium/);
    expect(p.assumptions.join(' ')).toMatch(/not connected yet/); expect(c.explain).not.toMatch(/not connected/);
  });
  it('uses a perp when no event is near, or when Derive has no put to offer', () => {
    const none = snap(); none.config.events = [];
    expect(buildCandidates(none).candidates.find((x) => x.kind === 'hedge')?.hedge?.instrument).not.toBe('put');
    const noChain = snap(); noChain.options = undefined;
    const c = buildCandidates(noChain).candidates.find((x) => x.kind === 'hedge')!;
    expect(c.venue).toBe('aster'); expect(c.hedge!.instrument).toBeUndefined();
  });
  it('never buys the same protection twice: a put already held counts as a hedge', () => {
    const big = () => { const s = snap(); s.config.limits.maxNotionalPerTradeUsd = 1_000_000; s.config.limits.maxNotionalPerDayUsd = 1_000_000; return s; };
    const first = buildCandidates(big()).candidates.find((x) => x.kind === 'hedge')!;
    const held = big(); held.heldPuts = [{ ticker: 'NVDA', notionalUsd: first.hedge!.option!.notionalUsd, expiry: hours(24 * 7) }];
    expect(buildCandidates(held).candidates.filter((x) => x.kind === 'hedge')).toHaveLength(0);
  });
  it('the agent log remembers puts it bought until they expire', () => {
    logPut('0xabc', 'testnet', 'NVDA', 5000, hours(48)); logPut('0xabc', 'testnet', 'TSLA', 100, hours(-1));
    const open = openPuts('0xabc', 'testnet');
    expect(open).toHaveLength(1); expect(open[0].ticker).toBe('NVDA');
  });
  it('moves the premium from BNB to Derive when Derive does not have it', () => {
    const c = buildCandidates(snap({ deriveFree: { ref: '42', freeUsd: 0 } })).candidates.find((x) => x.kind === 'hedge')!;
    expect(c.plan!.marginPlan?.to).toMatch(/Derive/); expect(c.plan!.marginPlan!.moveUsd).toBeGreaterThan(0);
  });
  it('spec scenario 3: a bridge slower than the event gives a partial put from the collateral already on Derive', () => {
    const s = snap({ deriveFree: { ref: '42', freeUsd: 60 }, deriveEtaSec: 1500, perpEtaSec: 1500, perpMain: { equityUsd: 0, freeUsd: 0 } });   // neither bridge lands in time and perps has no margin
    s.config.events = [{ ticker: 'NVDA', at: hours(0.33), kind: 'earnings', gapPct: 12 }];
    const c = buildCandidates(s).candidates.find((x) => x.kind === 'hedge')!;
    expect(c.plan!.marginPlan).toBeNull(); expect(c.plan!.cost.premiumUsd + c.plan!.cost.feesUsd).toBeLessThanOrEqual(60 + 0.01);
    expect(c.plan!.assumptions.join(' ')).toMatch(/Only \$/);
  });
  it('says why no put can be bought in time, then falls back to a perp the perps account can carry', () => {
    const s = snap({ deriveFree: { ref: '42', freeUsd: 0 }, deriveEtaSec: 1500 });
    s.config.events = [{ ticker: 'NVDA', at: hours(0.33), kind: 'earnings', gapPct: 12 }];
    const r = buildCandidates(s);
    const hedges = r.candidates.filter((x) => x.kind === 'hedge'); expect(hedges.length).toBeGreaterThan(0); expect(hedges.every((h) => h.hedge!.option === undefined)).toBe(true);
    expect(hedges[0].plan!.assumptions.join(' ')).toMatch(/a put cannot be paid for in time/);
  });
  it('asks first in confirmation mode and the card carries the put plan', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    const s = snap(); s.config.mode = 'confirm';
    const out = await buildGraph().invoke({ snapshot: s });
    expect(out.outcome).toBe('awaiting');
    const r = m.rows[0];
    expect(r.title).toMatch(/Buy .* NVDA puts? \(strike 200\) on Derive/); expect(r.why).toMatch(/Derive order placement is not connected yet/); expect(r.plan?.venue).toBe('derive'); expect(r.helps).toMatch(/lose at most/);
    expect(r.willDo.join(' ')).toMatch(/put/);
  });
  it('a live run fails closed: loss-limit puts have no instrument names', async () => {
    env({ DRY_RUN: 'false', ALLOW_LIVE: 'yes-i-understand' });
    const s = snap(); const c = buildCandidates(s).candidates.find((x) => x.kind === 'hedge')!;
    const steps = await execute(s, c);
    expect(steps[0].status).toBe('failed'); expect(steps[0].detail).toMatch(/Loss-limit puts/);
  });
});
