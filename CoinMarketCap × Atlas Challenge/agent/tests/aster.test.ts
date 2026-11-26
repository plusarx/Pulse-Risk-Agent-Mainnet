import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/tools/appApi', async () => {
  const real = await vi.importActual<typeof import('../src/tools/appApi')>('../src/tools/appApi');
  return { ...real, getAsterCreds: async () => TEST_CREDS };
});
const TEST_CREDS = { venue: 'aster', network: 'mainnet', wallet: '0x1111111111111111111111111111111111111111', user: '0x1111111111111111111111111111111111111111',
  agentAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', agentPrivateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', expiresAt: null } as const;
import { loadConfig, resetConfigForTests } from '../src/config';
import * as aster from '../src/tools/aster';
import type { AsterCreds } from '../src/tools/appApi';
import { execute } from '../src/tools/executor';
import { fixtureSnapshot } from '../src/fixtures';
import { closeStore, openStore } from '../src/tools/store';
import type { Candidate } from '../src/types';

// The agent's Aster client, with the transport faked: no network. Covers the live-verified behaviours (-5050 on a
// never-funded account, V3 order shape, step rounding, $5 minimum) and the 418/429 backoff.

// Well-known public test key (hardhat #0): only used to produce a signature shape, never funded.
const creds: AsterCreds = { venue: 'aster', network: 'mainnet', wallet: '0x1111111111111111111111111111111111111111', user: '0x1111111111111111111111111111111111111111',
  agentAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', agentPrivateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', expiresAt: null };

type Handler = (url: URL, method: string) => { status?: number; body: unknown; headers?: Record<string, string> };
const seen: { url: URL; method: string }[] = [];
const install = (h: Handler) => {
  aster.setAsterTransportForTests((async (u: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(u)); const method = init?.method ?? 'GET'; seen.push({ url, method });
    const r = h(url, method);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch, async () => undefined);
};
const sym = (symbol: string, step = '0.001', minQty = '0.001') => ({ symbol, status: 'TRADING', baseAsset: symbol.replace('USDT', ''), quoteAsset: 'USDT', pricePrecision: 2, quantityPrecision: 3,
  filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }, { filterType: 'LOT_SIZE', stepSize: step, minQty }, { filterType: 'MIN_NOTIONAL', notional: '5' }] });

beforeEach(() => { seen.length = 0; aster.clearAsterMarketCache(); });
afterEach(() => { aster.setAsterTransportForTests(); resetConfigForTests(); });

describe('reads', () => {
  it('a never-funded account (-5050) is connected with $0 and no positions, not an error', async () => {
    install(() => ({ status: 400, body: { code: -5050, msg: 'This function can only be used after deposit' } }));
    const v = await aster.getAccount('mainnet', creds);
    expect(v).toEqual({ account: null, positions: [], funded: false });
    expect(aster.healthOf(v)).toEqual({ connected: true, utilBps: 0, accountUsd: 0, usedUsd: 0 });
    expect(aster.healthOf(null).connected).toBe(false);
    expect(await aster.futuresUsdt('mainnet', creds)).toBe(0);
    expect(await aster.getPositions('mainnet', creds)).toEqual({});
  });
  it('other API errors throw (the collector turns them into a data-quality stop)', async () => {
    install(() => ({ status: 400, body: { code: -1022, msg: 'Signature for this request is not valid.' } }));
    await expect(aster.getAccount('mainnet', creds)).rejects.toThrow(/Signature/);
  });
  it('signed V3 reads carry user, signer, nonce and a signature, unsorted', async () => {
    install((u) => (u.pathname === '/fapi/v3/account' ? { body: { totalMarginBalance: '100', availableBalance: '40' } } : { body: [{ symbol: 'NVDAUSDT', positionAmt: '-0.5', entryPrice: '150', markPrice: '151', unRealizedProfit: '0', liquidationPrice: '0', leverage: '3', notional: '-75.5' }, { symbol: 'ETHUSDT', positionAmt: '0', entryPrice: '0', markPrice: '0', unRealizedProfit: '0', liquidationPrice: '0', leverage: '3', notional: '0' }] }));
    const v = await aster.getAccount('mainnet', creds);
    expect(aster.healthOf(v)).toEqual({ connected: true, utilBps: 6000, accountUsd: 100, usedUsd: 60 });
    expect(aster.positionsOf(v.positions)).toEqual({ NVDA: -0.5 });
    expect(aster.equityOf(v)).toEqual({ equityUsd: 100, freeUsd: 40 });
    const q = seen[0].url.search;
    expect(q).toMatch(/^\?asterChain=Mainnet&user=0x1111111111111111111111111111111111111111&signer=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266&nonce=\d+&signature=0x[0-9a-f]{130}$/);
  });
  it('backs off on 429 / 418 and then succeeds', async () => {
    let n = 0;
    install(() => (++n <= 2 ? { status: n === 1 ? 429 : 418, body: { code: -1003, msg: 'Too many requests' }, headers: { 'retry-after': '1' } } : { body: { markPrice: '150.5' } }));
    expect(await aster.markPrice('mainnet', 'NVDA')).toBe(150.5);
    expect(n).toBe(3);
  });
  it('markets come from exchangeInfo (TRADING USDT perps only), cached', async () => {
    install(() => ({ body: { symbols: [sym('NVDAUSDT'), { ...sym('OLDUSDT'), status: 'SETTLING' }, { ...sym('BTCUSDC'), quoteAsset: 'USDC' }] } }));
    expect((await aster.markets('mainnet')).map((m) => m.ticker)).toEqual(['NVDA']);
    await aster.markets('mainnet'); expect(seen).toHaveLength(1);
    expect(await aster.market('mainnet', 'NVDA')).toMatchObject({ symbol: 'NVDAUSDT', stepSize: 0.001, minQty: 0.001, minNotionalUsd: 5 });
  });
});

describe('orders', () => {
  const m = { ticker: 'NVDA', symbol: 'NVDAUSDT', minQty: 0.001, stepSize: 0.001, tickSize: 0.01, minNotionalUsd: 5 };
  it('rounds DOWN to the step and refuses under $5 or the minimum size', () => {
    expect(aster.orderQty(m, 0.0709, 150)).toEqual({ qty: '0.070' });
    expect(aster.orderQty(m, 0.03, 150)).toEqual({ error: '$4.50 is under the $5 minimum order' });
    expect(aster.orderQty(m, 0.0004, 150)).toMatchObject({ error: expect.stringMatching(/rounds to zero/) });
  });
  it('never sends while not live', async () => {
    resetConfigForTests(loadConfig({ DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off' }));
    install(() => ({ body: {} }));
    await expect(aster.placeMarketOrder('mainnet', creds, { ticker: 'NVDA', side: 'sell', qty: 1, reduceOnly: false })).rejects.toThrow(/not live/);
    await expect(aster.spotToFutures('mainnet', creds, '10', 'x')).rejects.toThrow(/not live/);
    expect(seen).toHaveLength(0);
  });
});

describe('hedge execution on perps (live path, transport faked)', () => {
  beforeEach(() => { openStore(':memory:'); resetConfigForTests(loadConfig({ DRY_RUN: 'false', ALLOW_LIVE: 'yes-i-understand', POST_EVENTS: 'false', LLM_MODE: 'off' })); });
  afterEach(() => closeStore());
  const run = async (delta: number, before: number) => {
    let pos = before; const orders: URLSearchParams[] = [];
    install((u, method) => {
      if (u.pathname === '/fapi/v1/exchangeInfo') return { body: { symbols: [sym('NVDAUSDT')] } };
      if (u.pathname === '/fapi/v1/premiumIndex') return { body: { markPrice: '150' } };
      if (u.pathname === '/fapi/v3/positionRisk') return { body: [{ symbol: 'NVDAUSDT', positionAmt: String(pos), entryPrice: '150', markPrice: '150', unRealizedProfit: '0', liquidationPrice: '0', leverage: '3', notional: '0' }] };
      if (u.pathname === '/fapi/v3/order' && method === 'POST') { orders.push(u.searchParams); const q = Number(u.searchParams.get('quantity')); pos += u.searchParams.get('side') === 'SELL' ? -q : q; return { body: { orderId: 7, symbol: 'NVDAUSDT', side: u.searchParams.get('side'), type: 'MARKET', status: 'FILLED', price: '0', avgPrice: '150', origQty: String(q), executedQty: String(q), time: 0 } }; }
      if (u.pathname === '/fapi/v1/order') return { status: 404, body: { msg: 'gone' } };
      return { status: 500, body: { msg: `unexpected ${u.pathname}` } };
    });
    const c = { id: 'h', kind: 'hedge', venue: 'aster', amountBaseUnit: '0', reason: 'r', explain: 'e', idempotencyKey: `k${delta}`, urgency: 1, notionalUsd: Math.abs(delta) * 150,
      hedge: { bstock: 'NVDAB', market: 'NVDA', key: 'aster:NVDA', venue: 'aster', kind: 'perp', deltaToShort: delta, driftPct: 100 } } as Candidate;
    const steps = await execute(fixtureSnapshot(), c);
    return { steps, orders, pos };
  };
  it('a short is a V3 MARKET SELL of the stepped quantity, then the position is checked', async () => {
    const { steps, orders, pos } = await run(0.07, 0);
    expect(steps.map((x) => x.status)).toEqual(['done', 'done']);
    expect(orders).toHaveLength(1);
    expect(Object.fromEntries([...orders[0].entries()].filter(([k]) => ['symbol', 'side', 'type', 'quantity', 'reduceOnly'].includes(k)))).toEqual({ symbol: 'NVDAUSDT', side: 'SELL', type: 'MARKET', quantity: '0.070' });
    expect(pos).toBeCloseTo(-0.07, 9);
  }, 20_000);
  it('buying back a short is reduce-only', async () => {
    const { orders } = await run(-0.05, -0.1);
    expect(orders[0].get('side')).toBe('BUY'); expect(orders[0].get('reduceOnly')).toBe('true');
  }, 20_000);
});
