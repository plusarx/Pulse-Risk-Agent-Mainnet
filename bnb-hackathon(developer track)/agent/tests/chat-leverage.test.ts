import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/tools/appApi', async () => {
  const real = await vi.importActual<typeof import('../src/tools/appApi')>('../src/tools/appApi');
  return { ...real, getAsterCreds: async () => TEST_CREDS };
});
// Well-known public test key (hardhat #0): only produces a signature shape, never funded.
const TEST_CREDS = { venue: 'aster', network: 'mainnet', wallet: '0x1111111111111111111111111111111111111111', user: '0x1111111111111111111111111111111111111111',
  agentAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', agentPrivateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', expiresAt: null } as const;
import { loadConfig, resetConfigForTests } from '../src/config';
import * as aster from '../src/tools/aster';
import { execute } from '../src/tools/executor';
import { checkCandidate } from '../src/tools/guard';
import { candidateFromSpec, type ChatTradeSpec } from '../src/chat/trade';
import { fixtureSnapshot } from '../src/fixtures';
import { closeStore, openStore } from '../src/tools/store';

// "Long NVDA with $1 at 20x": the chat carries the leverage the user asked for; on approval the agent sets it on the
// market, then places the order. A chat buy opens a long (only a requested close is reduce-only). Live 2026-11-26:
// NVDA's max leverage is 20x and the venue refuses 500x (-4028).
const spec = (o: Partial<ChatTradeSpec> = {}): ChatTradeSpec => ({ venue: 'aster', instrument: 'NVDAUSDT', kind: 'perp', side: 'buy', amount: 0.13, quotedPrice: 150, ticker: 'NVDA', leverage: 20, ...o });
const quote = { price: 150, index: 150, notionalUsd: 19.5, costUsd: 0 };

describe('chat trades with leverage', () => {
  it('the order carries the asked leverage; a buy is a long, not reduce-only, unless it is a close', () => {
    expect(candidateFromSpec(spec(), quote, 'k').hedge).toMatchObject({ leverage: 20, reduceOnly: false, deltaToShort: -0.13 });
    expect(candidateFromSpec(spec({ reduceOnly: true, leverage: undefined }), quote, 'k').hedge).toMatchObject({ reduceOnly: true });
  });
  it('leverage above the user\'s own cap is refused; within it, allowed', () => {
    const s = fixtureSnapshot(); s.config.limits.maxLeverage = 3;
    expect(checkCandidate(candidateFromSpec(spec(), quote, 'k'), s)).toMatch(/20x is above your max leverage of 3x \(raise it under Limits/);
    s.config.limits.maxLeverage = 20;
    expect(checkCandidate(candidateFromSpec(spec(), quote, 'k'), s)).toBeNull();
  });
});

describe('on approval: leverage first, then the order', () => {
  beforeEach(() => { openStore(':memory:'); aster.clearAsterMarketCache(); resetConfigForTests(loadConfig({ DRY_RUN: 'false', ALLOW_LIVE: 'yes-i-understand', POST_EVENTS: 'false', LLM_MODE: 'off' })); });
  afterEach(() => { vi.useRealTimers(); closeStore(); aster.setAsterTransportForTests(); resetConfigForTests(); });
  it('sets 20x on NVDA, then a market BUY that opens a long (not reduce-only); once on a rerun', async () => {
    const calls: { path: string; method: string; q: URLSearchParams }[] = []; let pos = 0;
    aster.setAsterTransportForTests((async (u: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(u)); const method = init?.method ?? 'GET'; calls.push({ path: url.pathname, method, q: url.searchParams });
      const body = url.pathname === '/fapi/v1/exchangeInfo' ? { symbols: [{ symbol: 'NVDAUSDT', status: 'TRADING', baseAsset: 'NVDA', quoteAsset: 'USDT', pricePrecision: 2, quantityPrecision: 2, filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }, { filterType: 'LOT_SIZE', stepSize: '0.01', minQty: '0.01' }, { filterType: 'MIN_NOTIONAL', notional: '5' }] }] }
        : url.pathname === '/fapi/v1/premiumIndex' ? { markPrice: '150' }
        : url.pathname === '/fapi/v3/leverage' ? { symbol: 'NVDAUSDT', leverage: Number(url.searchParams.get('leverage')) }
        : url.pathname === '/fapi/v3/positionRisk' ? [{ symbol: 'NVDAUSDT', positionAmt: String(pos), entryPrice: '150', markPrice: '150', unRealizedProfit: '0', liquidationPrice: '0', leverage: '20', notional: '0' }]
        : url.pathname === '/fapi/v3/order' && method === 'POST' ? (() => { const q = Number(url.searchParams.get('quantity')); pos += url.searchParams.get('side') === 'SELL' ? -q : q; return { orderId: 9, symbol: 'NVDAUSDT', side: url.searchParams.get('side'), status: 'FILLED', executedQty: String(q), avgPrice: '150', origQty: String(q), type: 'MARKET', price: '0', time: 1 }; })()
        : { msg: `unexpected ${url.pathname}` };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch, async () => undefined);
    const s = fixtureSnapshot(); s.config.limits.maxLeverage = 20;
    const c = candidateFromSpec(spec(), quote, 'chat-42');
    // The position check waits 2 s + 3 s retries: fake the clock so the test does not.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const run = async () => { const p = execute(s, c); await vi.advanceTimersByTimeAsync(20_000); return p; };
    const steps = await run();
    expect(steps.map((x) => x.status)).toEqual(['done', 'done', 'done']);
    const writes = calls.filter((x) => x.method === 'POST');
    expect(writes.map((x) => x.path)).toEqual(['/fapi/v3/leverage', '/fapi/v3/order']);                  // leverage BEFORE the order
    expect(writes[0].q.get('leverage')).toBe('20');
    expect(writes[1].q.get('side')).toBe('BUY'); expect(writes[1].q.get('reduceOnly')).toBeNull();           // opens a long
    expect(pos).toBeCloseTo(0.13, 9);
    calls.length = 0; await run();                                                                            // rerun of the same request
    expect(calls.filter((x) => x.method === 'POST')).toHaveLength(0);
  }, 20_000);
});
