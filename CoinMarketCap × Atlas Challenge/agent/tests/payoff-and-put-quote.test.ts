import { describe, expect, it } from 'vitest';
import { payoff, payoffForChoice } from '../src/risk/payoff';
import { quotePut } from '../src/risk/putQuote';
import { fixtureSnapshot } from '../src/fixtures';
import type { Candidate } from '../src/types';
import type { OptionChain } from '../src/risk/options';

const at = (p: ReturnType<typeof payoff>, m: number) => p.points.find((x) => x.movePct === m)!;

describe('payoff before and after', () => {
  it('perp short of the full holding flattens P&L (minus fees)', () => {
    const p = payoff('NVDA', 100, { kind: 'perp', shortUsd: 100, feesUsd: 0.1 });
    expect(at(p, -20)).toEqual({ movePct: -20, beforeUsd: -20, afterUsd: -0.1 });
    expect(at(p, 20)).toEqual({ movePct: 20, beforeUsd: 20, afterUsd: -0.1 });
  });
  it('put: floor below the strike, upside kept minus the cost (live NVDA numbers, 2026-11-25)', () => {
    const p = payoff('NVDA', 10, { kind: 'put', contracts: 1, strike: 150, spot: 149.77, premiumUsd: 7.23, feesUsd: 0.54 });
    expect(at(p, 0).afterUsd).toBe(-7.54);           // 150 - 149.77 = 0.23 intrinsic, minus 7.77 cost
    expect(at(p, -20).afterUsd).toBe(20.41);          // oversized put: 1 contract covers ~$150 against a $10 holding
    expect(at(p, 20).afterUsd).toBe(-5.77);
  });
  it('proxy: expected offset = short x correlation x vol ratio', () => {
    const p = payoff('MSTR', 100, { kind: 'proxy', shortUsd: 100, feesUsd: 0, via: 'BTC', beta: 0.9, sigmaHolding: 0.06, sigmaVia: 0.03 });
    expect(at(p, -10).afterUsd).toBeCloseTo(-10 + 100 * 0.1 * 0.45, 6);
    expect(p.note).toMatch(/about 44% of MSTR's risk stays/);
  });
  it('payoffForChoice reads the chosen perp hedge from a run', () => {
    const s = fixtureSnapshot(); s.bsc.bstocks = [{ symbol: 'NVDAB', qty: 1, value: 150 }];
    const c = { kind: 'hedge', hedge: { bstock: 'NVDAB', market: 'NVDA', deltaToShort: 0.5, driftPct: 100, ticker: 'NVDA', hedgePrice: 150 } } as unknown as Candidate;
    const p = payoffForChoice(s, c)!;
    expect(p.hedgeLabel).toBe('Short $75 NVDA perp');
    expect(at(p, -20)).toEqual({ movePct: -20, beforeUsd: -30, afterUsd: -15 });
    expect(payoffForChoice(s, { kind: 'top_up' } as unknown as Candidate)).toBeNull();
  });
});

describe('quotePut: Derive size rules and fees', () => {
  const chain: OptionChain = { ticker: 'NVDA', spot: 149.77, contractSize: 1, feeFraction: 0.0003, settlement: 'cash', quotesOffHours: true,
    expiries: [{ expiry: new Date(Date.now() + 7.2 * 86_400_000).toISOString(), puts: [{ strike: 140, bid: 3, ask: 3.4, iv: 0.7, delta: -0.3, size: 20 }, { strike: 150, bid: 6.9, ask: 7.23, iv: 0.78, delta: -0.52, size: 33 }] }] };
  const rpc = async () => ({ minimum_amount: '1', amount_step: '1', taker_fee_rate: '0.0003', base_fee: '0.5' });
  it('$10 of NVDA: minimum 1 contract, oversized, fee = base + 0.0003 x index', async () => {
    const q = (await quotePut('mainnet', 'NVDA', { notionalUsd: 10, strikePct: 100, minDays: 7 }, rpc as never, async () => chain))!;
    expect(q).toMatchObject({ strike: 150, contracts: 1, minContracts: 1, oversized: true, premiumUsd: 7.23, feesUsd: 0.54, coverUsd: 149.77 });
    expect(q.instrument).toMatch(/^NVDA-\d{8}-150-P$/);
  });
  it('$1,500 of NVDA: 10 contracts, not oversized', async () => {
    const q = (await quotePut('mainnet', 'NVDA', { notionalUsd: 1500, strikePct: 100, minDays: 7 }, rpc as never, async () => chain))!;
    expect(q).toMatchObject({ contracts: 10, oversized: false, premiumUsd: 72.3 });
  });
});
