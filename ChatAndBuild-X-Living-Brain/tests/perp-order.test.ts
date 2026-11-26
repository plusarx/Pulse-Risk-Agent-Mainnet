import { describe, expect, it } from 'vitest';
import { checkPerpOrder, describeOutcome } from '@/lib/perp-order';

// Testnet BTC (market 4096), 2026-11-24: min 0.0002 BTC and $10, 5% initial margin, 5 size decimals.
const btc = { px: 59_482.2, imf: 0.05, minBase: 0.0002, minQuote: 10, sizeDecimals: 5, symbol: 'BTC', reduceOnly: false };

describe('checkPerpOrder', () => {
  it('blocks the 100 BTC order that Lighter canceled for margin, and says the max', () => {
    const c = checkPerpOrder({ ...btc, size: 100, available: 9_465.79 });
    expect(c.notional).toBeCloseTo(5_948_220, 0);
    expect(c.margin).toBeCloseTo(297_411, 0);
    expect(c.problem).toMatch(/Not enough margin: this order needs \$297,411 \(5% of \$5,948,220\), you have \$9,466 free\. You can open at most about 3\.18273 BTC/);
  });
  it('lets a 0.1 BTC order through', () => {
    expect(checkPerpOrder({ ...btc, size: 0.1, available: 9_465.79 }).problem).toBeNull();
  });
  it('max size uses all free margin, floored to the size step', () => {
    const c = checkPerpOrder({ ...btc, size: 0, available: 9_465.79 });
    expect(c.maxSize).toBeCloseTo(3.18273, 5);
    expect(c.maxSize! * btc.px * btc.imf).toBeLessThanOrEqual(9_465.79);
  });
  it('refuses below the venue minimums', () => {
    expect(checkPerpOrder({ ...btc, size: 0.0001, available: 1000 }).problem).toMatch(/Minimum size is 0.0002 BTC/);
    expect(checkPerpOrder({ ...btc, size: 0.0001, minBase: 0.00001, available: 1000 }).problem).toMatch(/minimum order is \$10\.00/);
  });
  it('reduce-only orders skip the margin and $ minimum checks (closing frees margin)', () => {
    expect(checkPerpOrder({ ...btc, size: 100, available: 0, reduceOnly: true }).problem).toBeNull();
  });
  it('unknown balance never blocks', () => {
    expect(checkPerpOrder({ ...btc, size: 100, available: null }).problem).toBeNull();
  });
});

describe('describeOutcome', () => {
  it('explains the margin cancel in plain words', () => {
    const r = describeOutcome({ state: 'canceled', status: 'canceled-margin-not-allowed', size: '100', filled: '0', avgPrice: null }, 'BTC');
    expect(r).toEqual({ ok: false, text: 'Not filled. The venue canceled the order: not enough margin.' });
  });
  it('reports fills and partial fills with the average price', () => {
    expect(describeOutcome({ state: 'filled', status: 'filled', size: '0.1', filled: '0.1', avgPrice: '59500.5' }, 'BTC').text).toBe('Filled 0.1 BTC at 59,500.5.');
    expect(describeOutcome({ state: 'partial', status: 'canceled-margin-not-allowed', size: '12', filled: '3.23708', avgPrice: '61646.7' }, 'BTC').text)
      .toBe('Partly filled: 3.23708 of 12 BTC at 61,646.7. The rest was canceled: not enough margin.');
  });
  it('unknown cancel statuses are still readable', () => {
    expect(describeOutcome({ state: 'canceled', status: 'canceled-something-new', size: '1', filled: '0', avgPrice: null }, 'BTC').text).toBe('Not filled. The venue canceled the order: something new.');
  });
});
