import { afterEach, describe, expect, it, vi } from 'vitest';

// Live 2026-11-25: an approved Derive put failed with "no live ask" because the market maker had pulled its quote
// for a moment (before the US open). The quote is now re-read for a few seconds before giving up.
const tickers: { ask: number; bid: number }[] = [];
vi.mock('../src/tools/derive', async (orig) => ({
  ...(await orig<typeof import('../src/tools/derive')>()),
  getInstrument: async () => ({ name: 'NVDA-20261204-150-P', isActive: true, minimumAmount: 1, amountStep: 1, tickSize: 0.01, universeId: 1 }),
  getTicker: async () => { const t = tickers.shift() ?? { ask: 0, bid: 0 }; return { mark: 9, index: 148, bid: t.bid, ask: t.ask, minPrice: 1, maxPrice: 20 }; },
}));
const { quoteSpec } = await import('../src/chat/trade');
const spec = { venue: 'derive' as const, instrument: 'NVDA-20261204-150-P', kind: 'put' as const, side: 'buy' as const, amount: 1, quotedPrice: 9.43, ticker: 'NVDA' };

afterEach(() => { vi.useRealTimers(); tickers.length = 0; });

describe('quoteSpec waits out a briefly empty Derive book', () => {
  it('empty twice, then a seller quotes: the order is priced', async () => {
    vi.useFakeTimers();
    tickers.push({ ask: 0, bid: 0 }, { ask: 0, bid: 0 }, { ask: 9.22, bid: 8.73 });
    const p = quoteSpec('mainnet', spec);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).resolves.toMatchObject({ price: 9.22, costUsd: 9.22 });
  });
  it('no seller for 6 seconds: refused with a clear reason', async () => {
    vi.useFakeTimers();
    const p = quoteSpec('mainnet', spec);
    const done = expect(p).rejects.toThrow(/no seller quoting NVDA-20261204-150-P for 6 seconds/);
    await vi.advanceTimersByTimeAsync(7_000);
    await done;
  });
});
