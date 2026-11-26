import { describe, expect, it, vi } from 'vitest';
import { statusLabel } from '@/lib/order-history';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/db', () => ({ getDb: () => { throw new Error('not used'); } }));
const { classifySwap } = await import('@/lib/server/spot-history');

const ME = '0x1111111111111111111111111111111111111111' as const;
const POOL = '0x2222222222222222222222222222222222222222' as const;
const USDC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' as const;
const USDT = '0x55d398326f99059fF775485246999027B3197955' as const;

describe('statusLabel', () => {
  it('Lighter: your canceled 100 BTC order reads as not enough margin', () => {
    expect(statusLabel({ venue: 'lighter', status: 'canceled-margin-not-allowed', filled: '0', size: '100' })).toEqual({ text: 'Canceled: not enough margin', tone: 'down' });
  });
  it('Lighter: partial fills say so', () => {
    expect(statusLabel({ venue: 'lighter', status: 'canceled-margin-not-allowed', filled: '3.23708', size: '12' }).text).toBe('Partly filled · Canceled: not enough margin');
  });
  it('Derive: status plus cancel reason', () => {
    expect(statusLabel({ venue: 'derive', status: 'cancelled:insufficient_margin', filled: '0', size: '1' })).toEqual({ text: 'Canceled: not enough margin', tone: 'down' });
    expect(statusLabel({ venue: 'derive', status: 'filled', filled: '1', size: '1' }).text).toBe('Filled');
    expect(statusLabel({ venue: 'derive', status: 'expired', filled: '0', size: '1' }).text).toBe('Expired');
  });
  it('unknown statuses stay readable', () => {
    expect(statusLabel({ venue: 'lighter', status: 'canceled-something-new', filled: '0', size: '1' }).text).toBe('Canceled: something new');
  });
});

describe('classifySwap (bStock swaps read from a receipt)', async () => {
  const { BSTOCKS_BSC } = await import('@/lib/bstocks');
  const B = BSTOCKS_BSC[0].address; // a real listed bStock
  it('buy: USDC out of the wallet, bStock in', () => {
    const s = classifySwap(ME, [
      { token: USDC, from: ME, to: POOL, value: 20n * 10n ** 18n },
      { token: USDT, from: POOL, to: POOL, value: 19n * 10n ** 18n }, // internal hop, not the wallet's
      { token: B, from: POOL, to: ME, value: 10n ** 17n },
    ]);
    expect(s).toMatchObject({ side: 'buy', stable: 'USDC', stableRaw: 20n * 10n ** 18n, bstockRaw: 10n ** 17n });
  });
  it('sell: bStock out, USDT in', () => {
    expect(classifySwap(ME, [{ token: B, from: ME, to: POOL, value: 5n }, { token: USDT, from: POOL, to: ME, value: 7n }])).toMatchObject({ side: 'sell', stable: 'USDT', bstockRaw: 5n, stableRaw: 7n });
  });
  it('anything that is not a single bStock-for-stable swap by this wallet is rejected', () => {
    expect(classifySwap(ME, [{ token: USDC, from: ME, to: POOL, value: 5n }])).toBeNull(); // no bStock leg
    expect(classifySwap(ME, [{ token: B, from: POOL, to: '0x3333333333333333333333333333333333333333', value: 5n }, { token: USDC, from: '0x3333333333333333333333333333333333333333', to: POOL, value: 5n }])).toBeNull(); // someone else's
    expect(classifySwap(ME, [{ token: B, from: ME, to: POOL, value: 5n }, { token: B, from: POOL, to: ME, value: 5n }, { token: USDC, from: POOL, to: ME, value: 5n }])).toBeNull(); // both directions
  });
});
