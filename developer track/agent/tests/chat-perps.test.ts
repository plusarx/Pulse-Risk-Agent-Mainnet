import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/tools/appApi', async () => {
  const real = await vi.importActual<typeof import('../src/tools/appApi')>('../src/tools/appApi');
  return { ...real, getAsterCreds: async () => TEST_CREDS };
});
// Well-known public test key (hardhat #0): only produces a signature shape, never funded.
const TEST_CREDS = { venue: 'aster', network: 'mainnet', wallet: '0x1111111111111111111111111111111111111111', user: '0x1111111111111111111111111111111111111111',
  agentAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', agentPrivateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', expiresAt: null } as const;
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { loadConfig, resetConfigForTests } from '../src/config';
import { chat, setChatModel, setLiveReader, type ChatRequest } from '../src/chat/chat';
import { perpMarketItems, perpsAccountItems } from '../src/chat/perps';
import { sampleSnapshot } from '../src/chat/sample';
import * as aster from '../src/tools/aster';

// The chat reads the perps account and one perp market live: equity and free margin, every position with its liquidation price, open orders,
// and a market's mark price, funding and leverage cap. Reads only; nothing here can send an order.
const WALLET = '0x1111111111111111111111111111111111111111';
const req = (message: string): ChatRequest => ({ wallet: WALLET, network: 'mainnet', message, history: [], recorded: { actions: [], events: [] } });
const ai = (content: string, calls: { name: string; args: Record<string, unknown> }[] = []) => new AIMessage({ content, tool_calls: calls.map((c, i) => ({ id: `c${i}`, name: c.name, args: c.args, type: 'tool_call' as const })) });
function script(replies: ((msgs: BaseMessage[]) => AIMessage)[]) {
  const seen: BaseMessage[][] = []; let i = 0;
  setChatModel(async (msgs) => { seen.push([...msgs]); return replies[Math.min(i++, replies.length - 1)](msgs); });
  return { seen };
}
const toolFacts = (msgs: BaseMessage[]) => msgs.filter((m): m is ToolMessage => m instanceof ToolMessage).flatMap((m) => (JSON.parse(String(m.content)).facts ?? []) as { id: string; label: string; value: string }[]);

const symbol = { symbol: 'NVDAUSDT', status: 'TRADING', baseAsset: 'NVDA', quoteAsset: 'USDT', pricePrecision: 2, quantityPrecision: 3,
  filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01' }, { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001' }, { filterType: 'MIN_NOTIONAL', notional: '5' }] };
const account = { totalWalletBalance: '120.00', totalMarginBalance: '125.50', availableBalance: '90.00', totalUnrealizedProfit: '5.50' };
const position = { symbol: 'NVDAUSDT', positionAmt: '-0.4', entryPrice: '150', markPrice: '140', unRealizedProfit: '4', liquidationPrice: '168', leverage: '5', notional: '-56' };
const order = { orderId: 77, symbol: 'NVDAUSDT', side: 'BUY', type: 'LIMIT', status: 'NEW', price: '130', origQty: '0.2', executedQty: '0', reduceOnly: true, time: 1 };

function venue(o: { funded?: boolean } = {}) {
  aster.setAsterTransportForTests((async (u: string | URL | Request) => {
    const url = new URL(String(u)); const p = url.pathname;
    const notFunded = o.funded === false && p.startsWith('/fapi/v3/');
    const body = notFunded ? { code: -5050, msg: 'account not found' }
      : p === '/fapi/v3/account' ? account : p === '/fapi/v3/positionRisk' ? [position] : p === '/fapi/v3/openOrders' ? [order]
      : p === '/fapi/v3/leverageBracket' ? [{ symbol: 'NVDAUSDT', brackets: [{ initialLeverage: 20 }, { initialLeverage: 10 }] }]
      : p === '/fapi/v1/exchangeInfo' ? { symbols: [symbol] }
      : p === '/fapi/v1/premiumIndex' ? { markPrice: '140.5', indexPrice: '140.4', lastFundingRate: '0.0001', nextFundingTime: Date.UTC(2026, 10, 26, 16, 0) }
      : p === '/fapi/v1/ticker/24hr' ? { priceChangePercent: '-2.5', quoteVolume: '1234567' } : {};
    return new Response(JSON.stringify(body), { status: notFunded ? 400 : 200 });
  }) as typeof fetch);
}

beforeEach(() => { aster.clearAsterMarketCache(); setLiveReader(async (w, n) => ({ snapshot: sampleSnapshot(w, n), note: null })); resetConfigForTests(loadConfig({ ...process.env, DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off' })); });
afterEach(() => { setChatModel(); setLiveReader(); aster.setAsterTransportForTests(); resetConfigForTests(); });

describe('the facts about a perps account', () => {
  it('states equity, free margin, a short with its liquidation distance, and open orders', () => {
    const items = perpsAccountItems({ account, positions: [position], funded: true } as never, [order] as never);
    expect(items[0].value).toMatch(/equity \$125\.50, free margin \$90\.00, margin in use \$35\.50 \(28% of equity\), unrealised profit and loss \+\$5\.50/);
    expect(items[1].label).toBe('Perps NVDA position');
    expect(items[1].value).toMatch(/short 0\.4 NVDA at entry 150, mark 140, notional \$56\.00, leverage 5x, unrealised \+\$4\.00, liquidation price 168 \(20% away\)/);
    expect(items[2].value).toMatch(/buy 0\.2 NVDA \(limit, reduce only\), new at 130, filled 0/);
  });
  it('a never-funded account reads as $0 with nothing open, not as an error', () => {
    expect(perpsAccountItems({ account: null, positions: [], funded: false }, [])).toEqual([{ label: 'Perps account', value: expect.stringMatching(/nothing has been deposited yet: equity \$0\.00, no positions/) }]);
  });
  it('an account with no positions or orders says so', () => {
    const v = perpsAccountItems({ account, positions: [], funded: true } as never, []).map((i) => i.value).join(' | ');
    expect(v).toMatch(/none open/); expect(v).toMatch(/none$/);
  });
});

describe('the facts about one perp market', () => {
  const m = { ticker: 'NVDA', symbol: 'NVDAUSDT', minQty: 0.001, stepSize: 0.001, tickSize: 0.01, minNotionalUsd: 5 };
  it('minimum order, leverage cap, price, funding direction for a short', () => {
    const [a, b, c] = perpMarketItems('NVDA', m, { markPrice: 140.5, indexPrice: 140.4, fundingRatePct: 0.01, nextFundingAt: Date.UTC(2026, 10, 26, 16, 0), change24hPct: -2.5, volume24hUsd: 1234567 }, 20);
    expect(a.value).toMatch(/NVDAUSDT: minimum order \$5.*maximum leverage 20x/); expect(b.value).toMatch(/mark 140\.5, index 140\.4, 24 h move -2\.50%, 24 h volume \$1,234,567/);
    expect(c.value).toMatch(/\+0\.0100% this interval: longs pay shorts, so a short earns it\. The next payment is 2026-11-26 16:00 UTC/);
    expect(perpMarketItems('NVDA', m, { markPrice: 1, indexPrice: null, fundingRatePct: -0.02, nextFundingAt: null, change24hPct: null, volume24hUsd: null }, null)[2].value).toMatch(/shorts pay longs, so a short pays it/);
    expect(perpMarketItems('NVDA', m, null, null)).toHaveLength(1);
  });
  it('marketStats reads the public mark, funding and 24 h numbers', async () => {
    venue();
    expect(await aster.marketStats('mainnet', 'NVDA')).toEqual({ markPrice: 140.5, indexPrice: 140.4, fundingRatePct: 0.01, nextFundingAt: Date.UTC(2026, 10, 26, 16, 0), change24hPct: -2.5, volume24hUsd: 1234567 });
  });
});

describe('the chat tools', () => {
  it('get_perps_account reads the live account and the model can cite it', async () => {
    venue();
    const m = script([() => ai('', [{ name: 'get_perps_account', args: {} }]), (msgs) => ai(`Your perps equity is $125.50.\nSOURCES: ${toolFacts(msgs).find((f) => f.label === 'Perps account')!.id}`)]);
    const r = await chat(req('how much is in my perps account?'));
    expect(r.steps.map((s) => s.tool)).toEqual(['get_perps_account']);
    const facts = toolFacts(m.seen[1]); expect(facts.find((f) => f.label === 'Perps NVDA position')!.value).toMatch(/short 0\.4 NVDA/);
    expect(r.unsure).toBe(false); expect(r.cites[0].value).toMatch(/equity \$125\.50/);
  }, 30_000);
  it('get_perps_account on a never-funded account says $0, and a read failure changes nothing', async () => {
    venue({ funded: false });
    let m = script([() => ai('', [{ name: 'get_perps_account', args: {} }]), () => ai('Nothing deposited yet.')]);
    await chat(req('my perps?')); expect(toolFacts(m.seen[1])[0].value).toMatch(/nothing has been deposited yet/);
    aster.setAsterTransportForTests((async () => { throw new Error('network down'); }) as typeof fetch, async () => {});
    m = script([() => ai('', [{ name: 'get_perps_account', args: {} }]), () => ai('Could not read it.')]);
    await chat(req('my perps?')); expect(toolFacts(m.seen[1])[0].value).toMatch(/could not be read just now.*Nothing was changed/);
  }, 30_000);
  it('get_perp_market returns the market, price, funding and the leverage cap', async () => {
    venue();
    const m = script([() => ai('', [{ name: 'get_perp_market', args: { ticker: 'nvdab' } }]), () => ai('ok')]);
    const r = await chat(req('what is NVDA trading at on perps and what leverage can I use?'));
    expect(r.steps.map((s) => s.tool)).toEqual(['get_perp_market']);
    const facts = toolFacts(m.seen[1]);
    expect(facts.find((f) => f.label === 'Perps NVDA market')!.value).toMatch(/minimum order \$5.*maximum leverage 20x/);
    expect(facts.find((f) => f.label === 'Perps NVDA funding')!.value).toMatch(/longs pay shorts/);
  }, 30_000);
  it('get_perp_market names a ticker the venue does not list instead of inventing one', async () => {
    venue();
    const m = script([() => ai('', [{ name: 'get_perp_market', args: { ticker: 'ZZZZ' } }]), () => ai('not listed')]);
    await chat(req('ZZZZ perp?')); expect(toolFacts(m.seen[1])[0].value).toMatch(/could not be read just now \(the perps venue lists no ZZZZ perp\)/);
  }, 30_000);
});
