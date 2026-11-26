import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type AgentConfig } from '../../lib/agent-config';
import { ActionIn } from '../../lib/agent-action';
import { fixtureSnapshot } from '../src/fixtures';
import { alternativesFor, venueAlternatives } from '../src/risk/alternatives';
import { buildActionRequest } from '../src/tools/approvals';
import { collectSnapshot, type CollectDeps } from '../src/tools/collect';
import { closeStore, openStore } from '../src/tools/store';
import type { Candidate, Snapshot } from '../src/types';
import type { OptionChain } from '../src/risk/options';

const chain = (spot: number): OptionChain => ({ ticker: 'NVDA', spot, contractSize: 1, feeFraction: 0.0003, settlement: 'cash', quotesOffHours: true,
  expiries: [{ expiry: new Date(Date.now() + 7 * 86_400_000).toISOString(), puts: [{ strike: 150, bid: 6.9, ask: 7.23, iv: 0.78, delta: -0.52, size: 33 }] }] });

function snap(nvdaUsd: number, mstrUsd: number): Snapshot {
  const s = fixtureSnapshot(); s.config.hedge.enabled = true;
  s.config.hedge.legs = [
    { bstock: 'NVDAB', venue: 'aster', kind: 'perp', market: 'NVDA', hedgeRatio: 1 },
    { bstock: 'MSTRB', venue: 'aster', kind: 'perp', market: 'MSTR', hedgeRatio: 1 },
    { bstock: 'BTCB', venue: 'aster', kind: 'perp', market: 'BTC', hedgeRatio: 1 },
  ] as Snapshot['config']['hedge']['legs'];
  s.config.risk.proxyMap = { MSTR: { via: 'BTC', beta: 0.9 } };
  s.bsc.bstocks = [{ symbol: 'NVDAB', qty: nvdaUsd / 150, value: nvdaUsd }, { symbol: 'MSTRB', qty: mstrUsd / 76, value: mstrUsd }];
  s.options = { NVDA: chain(150) }; s.proxyPrices = { BTC: 58_800 };
  s.market = { sigmaDay: { NVDA: 0.08, MSTR: 0.063, BTC: 0.03 }, at: new Date().toISOString() };
  s.venueAccounts = [
    { venue: 'aster', id: 0, label: 'Perps account', equityUsd: 7.95, freeUsd: 7.95, main: true },
    { venue: 'derive', id: 122955, label: 'Derive #122955 (PRIME)', equityUsd: 7.96, freeUsd: 1, main: true },
    { venue: 'derive', id: 130000, label: 'Derive #130000 (RWA)', equityUsd: 2, freeUsd: 2, main: false },
  ];
  return s;
}
const by = (a: ReturnType<typeof venueAlternatives>, v: string) => a.find((x) => x.venue === v)!;

describe('why this venue and not the others', () => {
  it('$10.35 of MSTR, perp chosen: Derive blocked (no MSTR options); BTC proxy possible but only without a direct hedge', () => {
    const a = venueAlternatives(snap(5, 10.35), 'MSTR', 'perp');
    expect(by(a, 'aster')).toMatchObject({ status: 'chosen' });
    expect(by(a, 'derive')).toMatchObject({ status: 'blocked', why: 'Derive lists no MSTR options right now.' });
    expect(by(a, 'proxy').status).toBe('possible');
    expect(by(a, 'proxy').why).toMatch(/correlation 0.9.*only when there is no direct hedge/);
  });
  it('$4 of NVDA: perps blocked by the $5 minimum; Derive blocked by 1-contract minimum, budget and free funds across subaccounts', () => {
    const a = venueAlternatives(snap(4, 10.35), 'NVDA', null);
    expect(by(a, 'aster').status).toBe('blocked'); expect(by(a, 'aster').why).toMatch(/under the perps venue's \$5.00 minimum/);
    expect(by(venueAlternatives(snap(5, 10.35), 'NVDA', null), 'aster').status).not.toBe('blocked');   // $5 clears the perps minimum (it was $10)
    const d = by(a, 'derive');
    expect(d.status).toBe('blocked');
    expect(d.why).toMatch(/minimum is 1 contract \(\$150.00 of cover\) against your \$4.00/);
    expect(d.why).toMatch(/best subaccount has \$2.00 free \(\$3.00 across 2 subaccounts\)/);
    expect(by(a, 'proxy').status).toBe('blocked');
  });
  it('when perps margin is short it says a BNB top-up is a deposit on BNB Chain, no bridge', () => {
    const s = snap(40, 0); s.venueAccounts![0].freeUsd = 1;
    expect(by(venueAlternatives(s, 'NVDA', null), 'aster').why).toMatch(/perps account has \$1.00 free, otherwise a top-up from BNB \(a BNB Chain deposit, no bridge\)/);
  });
});

describe('every hedge request carries payoff and alternatives', () => {
  it('a perps hedge request validates against the app schema with both attached', () => {
    const s = snap(5, 10.35);
    const c = { id: 'hedge:aster:MSTR:sell:0.1368', kind: 'hedge', venue: 'aster', amountBaseUnit: '0', reason: 'hedge MSTR', hedge: { bstock: 'MSTRB', market: 'MSTR', key: 'aster:MSTR', venue: 'aster', kind: 'perp', deltaToShort: 0.1368, driftPct: 100, ticker: 'MSTR', hedgePrice: 75.7 } } as unknown as Candidate;
    const req = buildActionRequest(s, c, undefined);
    expect(req.payoff?.hedgeLabel).toBe('Short $10.36 MSTR perp');
    expect(req.alternatives?.map((x) => `${x.venue}:${x.status}`)).toEqual(['aster:chosen', 'derive:blocked', 'proxy:possible']);
    expect((req.detail as { hedgeKey?: string }).hedgeKey).toBe('aster:MSTR');
    expect(ActionIn.safeParse(req).success).toBe(true);
    expect(alternativesFor(s, { kind: 'top_up' } as unknown as Candidate)).toEqual([]);
  });
});

describe('collectSnapshot reads every account', () => {
  beforeEach(() => { closeStore(); openStore(':memory:'); });
  afterEach(() => closeStore());
  it('the perps account and all Derive subaccounts land in venueAccounts; Derive free = best subaccount', async () => {
    const cfg: AgentConfig = structuredClone({ ...DEFAULT_CONFIG, hedge: { ...DEFAULT_CONFIG.hedge, enabled: true, legs: [] } });
    const deps: CollectDeps = {
      getRuleStates: async () => ({}), getAsterCreds: async () => ({ venue: 'aster' as const, network: 'mainnet' as const, wallet: '0x1111111111111111111111111111111111111111', user: '0x1111111111111111111111111111111111111111', agentAddress: '0x2222222222222222222222222222222222222222', agentPrivateKey: 'x', expiresAt: null }),
      getDeriveCreds: async () => ({ subaccountId: 122955, sessionKeyAddress: '0x0', sessionPrivateKey: 'x', expiresAt: null }),
      asterAccount: async () => ({ account: { totalMarginBalance: '7.95', availableBalance: '7.95' }, positions: [], funded: true }), deriveSubaccount: async () => { throw new Error('unused'); },
      funds: async () => ({ funds: { usdcUsd: 0, usdtUsd: 0, allowanceUsdcBase: '0', bstocks: [] }, problems: [] }), moved24h: () => 0n, perpMarkets: async () => [],
      allDeriveSubaccounts: async () => [{ venue: 'derive', id: 122955, label: 'Derive #122955', equityUsd: 7.96, freeUsd: 1, main: true }, { venue: 'derive', id: 130000, label: 'Derive #130000', equityUsd: 6, freeUsd: 6, main: false }],
    };
    const s = await collectSnapshot('0x1111111111111111111111111111111111111111', 'mainnet', cfg, deps, true);
    expect(s.venueAccounts?.map((a) => `${a.venue}#${a.id}`)).toEqual(['aster#0', 'derive#122955', 'derive#130000']);
    expect(s.perpMain).toEqual({ equityUsd: 7.95, freeUsd: 7.95 });
    expect(s.deriveFree).toEqual({ ref: '130000', freeUsd: 6 });
  });
});
