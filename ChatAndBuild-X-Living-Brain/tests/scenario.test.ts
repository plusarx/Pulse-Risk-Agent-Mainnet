import { describe, expect, it } from 'vitest';
import { bs, curve, firstCrossing, legGreeks, normCdf, parseDeriveOption, pnl, totalGreeks, type Leg } from '@/lib/scenario';

const NOW = Date.UTC(2026, 10, 23, 8);
const DAY = 86_400_000;

describe('Black-Scholes (r = 0)', () => {
  it('normCdf matches known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.96)).toBeCloseTo(0.9750021, 6);
    expect(normCdf(-1)).toBeCloseTo(0.1586553, 6);
  });
  it('matches the textbook ATM example (S=K=100, T=1, σ=20%)', () => {
    const c = bs('C', 100, 100, 1, 0.2);
    expect(c.price).toBeCloseTo(7.9656, 3);
    expect(c.delta).toBeCloseTo(0.5398, 4);
    expect(c.gamma).toBeCloseTo(0.019848, 5);        // φ(d1)/(Sσ√T), d1 = 0.1 → 0.396953 / 20 (r = 0)
    expect(c.vega).toBeCloseTo(0.39695, 4);          // per 1 vol point
    expect(c.theta).toBeCloseTo(-3.9695 / 365, 5);   // per day
  });
  it('put-call parity holds (r = 0: C − P = S − K)', () => {
    for (const [S, K, T, v] of [[1700, 1550, 3 / 365, 1.09], [63.6, 62, 1 / 365, 0.81], [140, 170, 0.5, 0.45]]) {
      expect(bs('C', S, K, T, v).price - bs('P', S, K, T, v).price).toBeCloseTo(S - K, 6);
    }
  });
  it('reproduces a live Derive mainnet quote (priced off the forward)', () => {
    // public/get_ticker ETH-20261204-1700-C captured 2026-11-23 (t = 1795457290297 ms):
    // f 1742.8, i 0.64673, mark 98.8, delta 0.61076, gamma 0.00199839, vega 1.13773, theta −3.47815
    const T = (Date.UTC(2026, 11, 4, 8) - 1795457290297) / (365 * 86_400_000);
    const g = bs('C', 1742.8, 1700, T, 0.64673);
    expect(g.price).toBeCloseTo(98.8, 0);          // within 0.5 of Derive's mark
    expect(g.delta).toBeCloseTo(0.61076, 3);
    expect(g.gamma).toBeCloseTo(0.00199839, 5);
    expect(g.vega).toBeCloseTo(1.13773, 2);        // Derive vega = per vol point
    expect(g.theta).toBeCloseTo(-3.47815, 2);      // Derive theta = per day
  });
  it('at expiry returns intrinsic value', () => {
    expect(bs('C', 110, 100, 0, 0.5).price).toBe(10);
    expect(bs('P', 110, 100, 0, 0.5).price).toBe(0);
  });
});

describe('legs, PnL and greeks', () => {
  const call: Leg = { kind: 'option', id: 'c', account: 'd', label: 'ETH-C', type: 'C', strike: 1700, expiryMs: NOW + 30 * DAY, amount: 2, iv: 0.6, spot0: 1700 };
  const shortPerp: Leg = { kind: 'linear', id: 'p', account: 'l', label: 'ETH-PERP', amount: -1, price0: 1700 };
  it('PnL is zero at no shock and linear for perps', () => {
    expect(pnl([call, shortPerp], { move: 0, days: 0, ivShift: 0 }, NOW)).toBeCloseTo(0, 9);
    expect(pnl([shortPerp], { move: 0.1, days: 0, ivShift: 0 }, NOW)).toBeCloseTo(-170, 6);
  });
  it('a long call loses to time and gains from vol', () => {
    expect(pnl([call], { move: 0, days: 10, ivShift: 0 }, NOW)).toBeLessThan(0);
    expect(pnl([call], { move: 0, days: 0, ivShift: 0.05 }, NOW)).toBeGreaterThan(0);
  });
  it('at expiry the curve is the hockey stick', () => {
    const c = curve([call], 0.2, 8, 30, 0, NOW);
    const atExpiry = (m: number) => 2 * Math.max(0, 1700 * (1 + m) - 1700);
    const base = 2 * bs('C', 1700, 1700, 30 / 365, 0.6).price;
    for (const p of c) expect(p.pnl).toBeCloseTo(atExpiry(p.move) - base, 6);
  });
  it('position greeks scale with amount; delta-hedged book has ~0 delta', () => {
    const g = legGreeks(call, { move: 0, days: 0, ivShift: 0 }, NOW);
    expect(g.delta).toBeCloseTo(2 * bs('C', 1700, 1700, 30 / 365, 0.6).delta, 9);
    const hedge: Leg = { ...shortPerp, amount: -g.delta };
    expect(totalGreeks([call, hedge], { move: 0, days: 0, ivShift: 0 }, NOW).delta).toBeCloseTo(0, 9);
  });
  it('parses Derive option names', () => {
    expect(parseDeriveOption('HYPE-20261124-62-C')).toEqual({ underlying: 'HYPE', expiryMs: Date.UTC(2026, 10, 24, 8), strike: 62, type: 'C' });
    expect(parseDeriveOption('ADA-20261127-0_1-P')?.strike).toBe(0.1);
    expect(parseDeriveOption('ETH-PERP')).toBeNull();
  });
  it('finds where a condition first turns true in each direction', () => {
    const r = firstCrossing((m) => m <= -0.12 || m >= 0.3, 0.5);
    expect(r.down).toBeCloseTo(-0.12, 2); expect(r.up).toBeCloseTo(0.3, 2);
    expect(firstCrossing(() => false, 0.5)).toEqual({ down: null, up: null });
  });
});
