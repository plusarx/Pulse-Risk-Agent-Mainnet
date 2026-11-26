import { describe, expect, it } from 'vitest';
import { assess, type Assessment } from '../lib/integrity';
import { haircutFor, mapBySymbol, raisedNote, referenceFromTickers } from '../lib/integrity-view';

const mk = (symbol: string, over: Partial<Parameters<typeof assess>[0]> = {}): Assessment => assess({
  symbol, baseHaircut: 0.3, perp: 100, reference: 100, atlas: { price: 100, ageSec: 1, score: 0.9, status: 'HEALTHY' }, dex: { price: 100, liquidityUsd: 5_000_000 }, ...over,
});
const watch = mk('MSTRB', { dex: { price: 100, liquidityUsd: 234_000 } });      // thin pool: raised
const blocked = mk('BADB', { atlas: { price: 100, ageSec: 999, score: 0.9, status: 'HEALTHY' } });
const view = (enabled: boolean) => ({ enabled, bySymbol: mapBySymbol([mk('NVDAB'), watch, blocked]) });

describe('haircutFor: OFF is the flat haircut, bit for bit', () => {
  it('returns the base itself when off, whatever the data says', () => {
    for (const s of ['NVDAB', 'MSTRB', 'BADB', 'UNKNOWN']) expect(haircutFor(s, 0.3, view(false))).toBe(0.3);
  });
  it('old arithmetic equals new arithmetic when off or not loaded (same floats)', () => {
    const qty = 12.345678901234567; const p = 187.3300000000001;
    const old = qty * p * (1 - 0.3);
    expect(qty * p * (1 - haircutFor('MSTRB', 0.3, view(false)))).toBe(old);
    expect(qty * p * (1 - haircutFor('MSTRB', 0.3, undefined))).toBe(old);
    expect(qty * p * (1 - haircutFor('MSTRB', 0.3, { enabled: true, bySymbol: {} }))).toBe(old);
  });
  it('when on: ok keeps the base, watch/block raise it, never below base', () => {
    const v = view(true);
    expect(haircutFor('NVDAB', 0.3, v)).toBe(0.3);
    expect(haircutFor('MSTRB', 0.3, v)).toBeCloseTo(0.36, 6);
    expect(haircutFor('BADB', 0.3, v)).toBe(0.9);
    expect(haircutFor('MSTRB', 0.5, v)).toBeGreaterThanOrEqual(0.5);
    expect(haircutFor('NOPE', 0.3, v)).toBe(0.3);
  });
  it('unavailable behaves like today even when on', () => {
    const u = assess({ symbol: 'XB', baseHaircut: 0.3, atlas: null, dex: null, perp: 10, reference: null });
    expect(haircutFor('XB', 0.3, { enabled: true, bySymbol: mapBySymbol([u]) })).toBe(0.3);
  });
});

describe('raisedNote', () => {
  it('is null when off or flat, and explains a raised token', () => {
    expect(raisedNote('MSTRB', 0.3, view(false))).toBeNull();
    expect(raisedNote('NVDAB', 0.3, view(true))).toBeNull();
    expect(raisedNote('MSTRB', 0.3, view(true))).toMatch(/^Haircut 36% \(\+6 pts\): DEX liquidity/);
  });
});

describe('mapBySymbol / referenceFromTickers', () => {
  it('maps by symbol and tolerates undefined', () => {
    expect(Object.keys(mapBySymbol([watch, blocked]))).toEqual(['MSTRB', 'BADB']);
    expect(mapBySymbol(undefined)).toEqual({});
  });
  it('reference prices come from USDT tickers; bad or missing rows are null', () => {
    const r = referenceFromTickers([{ symbol: 'NVDABUSDT', lastPrice: '150.2' }, { symbol: 'BADBUSDT', lastPrice: '0' }]);
    expect(r('NVDAB')).toBe(150.2); expect(r('BADB')).toBeNull(); expect(r('X')).toBeNull();
    expect(referenceFromTickers(null)('NVDAB')).toBeNull();
  });
});
