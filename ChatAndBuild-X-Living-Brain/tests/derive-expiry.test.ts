import { describe, expect, it } from 'vitest';
import { deriveOrderExpiry } from '../lib/derive-expiry';

// Live 2026-11-25, Derive error 14038: "signature expires at 1798194737s but the signing session key expires at
// 1798178914s". A resting order asked for 30 days; the session key had about 29.8 days left.
const KEY = 1798178914;
const NOW_MS = (1798194737 - 30 * 86_400) * 1000;

describe('deriveOrderExpiry: never outlives the session key', () => {
  it('the failing case: a 30-day resting order is capped just before the key expires', () => {
    const e = deriveOrderExpiry(false, KEY, NOW_MS);
    expect(e).toBeLessThan(KEY);
    expect(e).toBe(KEY - 300);
  });
  it('market orders keep their 40 minutes', () => {
    expect(deriveOrderExpiry(true, KEY, NOW_MS)).toBe(NOW_MS / 1000 + 2_400);
  });
  it('key expiry in ms is read correctly', () => {
    expect(deriveOrderExpiry(false, KEY * 1000, NOW_MS)).toBe(KEY - 300);
  });
  it('no known key expiry: 30 days', () => {
    expect(deriveOrderExpiry(false, null, NOW_MS)).toBe(NOW_MS / 1000 + 30 * 86_400);
  });
  it('a key expiring within 32 minutes refuses with a clear message', () => {
    expect(() => deriveOrderExpiry(true, NOW_MS / 1000 + 1_000, NOW_MS)).toThrow(/too soon to place an order\. Register a new Derive key/);
  });
});
