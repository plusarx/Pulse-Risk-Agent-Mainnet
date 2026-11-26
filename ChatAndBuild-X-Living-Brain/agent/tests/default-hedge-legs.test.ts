import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type AgentConfig } from '../../lib/agent-config';
import { collectSnapshot, defaultHedgeLegs, type CollectDeps } from '../src/tools/collect';
import { closeStore, openStore } from '../src/tools/store';
import { clearMarketCache } from '../src/risk/market';
import { assessRisk } from '../src/risk/plan';

beforeEach(() => { closeStore(); openStore(':memory:'); }); // the tick loop opens its store before collecting
afterEach(() => closeStore());

// Live 2026-11-25: a wallet with hedging ON but no hedge legs held NVDAB + MSTRB, and the agent said "no hedge market
// exists for NVDA or MSTR" although the perps venue lists both. A held bStock now gets its perp (Aster NVDAUSDT, MSTRUSDT).
const PERPS = ['NVDA', 'MSTR', 'SPY'];

describe('defaultHedgeLegs', () => {
  it('gives each held bStock with no leg its matching perp at ratio 1 (keyed by ticker, no market id)', () => {
    expect(defaultHedgeLegs([], ['NVDAB', 'MSTRB'], PERPS)).toEqual([
      { bstock: 'NVDAB', venue: 'aster', kind: 'perp', market: 'NVDA', hedgeRatio: 1 },
      { bstock: 'MSTRB', venue: 'aster', kind: 'perp', market: 'MSTR', hedgeRatio: 1 },
    ]);
  });
  it('never overrides a leg the user set (any venue)', () => {
    const userLeg = { bstock: 'NVDAB', venue: 'derive' as const, kind: 'put' as const, market: 'NVDA', hedgeRatio: 0.5, put: { strikePct: 90, minDaysToExpiry: 7, targetDaysToExpiry: 30 } };
    expect(defaultHedgeLegs([userLeg], ['NVDAB'], PERPS)).toEqual([]);
  });
  it('skips a stock the perps venue does not list', () => {
    expect(defaultHedgeLegs([], ['ZZZB'], PERPS)).toEqual([]);
  });
});

describe('collectSnapshot with hedging on and no legs', () => {
  const cfg = (over: Partial<AgentConfig['hedge']> = {}): AgentConfig => structuredClone({ ...DEFAULT_CONFIG, hedge: { ...DEFAULT_CONFIG.hedge, enabled: true, legs: [], ...over } });
  const funds: CollectDeps['funds'] = async (_w, symbols) => ({ funds: { usdcUsd: 0, usdtUsd: 0, allowanceUsdcBase: '0',
    bstocks: symbols.map((s) => ({ symbol: s, qty: s === 'NVDAB' || s === 'MSTRB' ? 1 : 0, value: s === 'NVDAB' ? 150 : s === 'MSTRB' ? 300 : 0, allowanceQty: 0 })) }, problems: [] });
  const deps = (seen: string[][]): CollectDeps => ({
    getRuleStates: async () => ({}), getAsterCreds: async () => ({ venue: 'aster' as const, network: 'mainnet' as const, wallet: '0x1111111111111111111111111111111111111111', user: '0x1111111111111111111111111111111111111111', agentAddress: '0x2222222222222222222222222222222222222222', agentPrivateKey: 'x', expiresAt: null }), getDeriveCreds: async () => { throw new Error('no key in test'); },
    asterAccount: async () => ({ account: null, positions: [], funded: false }), deriveSubaccount: async () => { throw new Error('unused'); },
    funds: async (w, s) => { seen.push(s); return funds(w, s); }, moved24h: () => 0n,
    perpMarkets: async () => PERPS,
  });

  it('reads every listed bStock and hedges NVDAB and MSTRB on their perps', async () => {
    const seen: string[][] = [];
    const s = await collectSnapshot('0x1111111111111111111111111111111111111111', 'mainnet', cfg(), deps(seen));
    expect(seen[0]).toEqual(expect.arrayContaining(['NVDAB', 'MSTRB'])); // holdings are read even with no leg
    expect(s.config.hedge.legs.map((l) => `${l.bstock}->${l.venue}:${l.market}`)).toEqual(['NVDAB->aster:NVDA', 'MSTRB->aster:MSTR']);
    expect(s.perpMain).toEqual({ equityUsd: 0, freeUsd: 0 });   // never funded (-5050): connected with $0, not a data error
    expect(s.dataQuality).toEqual([]);
  });

  it('hedging off: no default legs and no extra reads', async () => {
    const seen: string[][] = [];
    const s = await collectSnapshot('0x1111111111111111111111111111111111111111', 'mainnet', cfg({ enabled: false }), deps(seen));
    expect(s.config.hedge.legs).toEqual([]);
    expect(seen[0]).not.toContain('MSTRB');
  });

  it("the user's saved config object is never modified", async () => {
    const c = cfg();
    await collectSnapshot('0x1111111111111111111111111111111111111111', 'mainnet', c, deps([]));
    expect(c.hedge.legs).toEqual([]);
  });

  // Live 2026-11-25: in "By ratio" sizing the agent never read volatility, so chat said NVDA and MSTR had "no risk model".
  it('reads live volatility for every holding in ratio sizing too, so the risk view is complete', async () => {
    clearMarketCache();
    const ids: string[] = [];
    const d = { ...deps([]), sigma: async (_n: string, t: string) => { ids.push(t); return t === 'NVDA' ? 0.08 : 0.063; },
      hedge: { derivePuts: async () => [] } } as unknown as CollectDeps;
    const s = await collectSnapshot('0x1111111111111111111111111111111111111111', 'mainnet', cfg({ sizing: 'ratio' }), d);
    expect(ids.sort()).toEqual(['MSTR', 'NVDA']);
    expect(s.market?.sigmaDay).toEqual({ NVDA: 0.08, MSTR: 0.063 });
    expect(assessRisk(s)?.tickers.map((t) => t.ticker).sort()).toEqual(['MSTR', 'NVDA']);
  });
});
