import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, type AgentConfig } from '../../lib/agent-config';
import { assess, type Assessment } from '../../lib/integrity';
import { clearIntegrityCache } from '../../lib/integrity-sources';
import { planFunding } from '../../lib/plan';
import { buildFacts } from '../src/chat/facts';
import { fixtureSnapshot } from '../src/fixtures';
import { buildStatus } from '../src/status';
import { collectSnapshot, type CollectDeps } from '../src/tools/collect';
import { checkCandidate } from '../src/tools/guard';
import { clearLastGoodIntegrity, haircutFor, integrityAlerts, integrityDetail, refreshIntegrity, relevantSymbols } from '../src/tools/integrity';
import { buildCandidates } from '../src/tools/planner';
import { closeStore, openStore } from '../src/tools/store';
import type { Candidate, Snapshot } from '../src/types';

// Price integrity in the agent. The hard rule: with the switch OFF everything is exactly what it was before the feature.

beforeEach(() => { openStore(':memory:'); clearLastGoodIntegrity(); clearIntegrityCache(); });
afterEach(() => { closeStore(); vi.unstubAllGlobals(); });

const view = (symbol: string, over: Partial<Parameters<typeof assess>[0]> = {}): Assessment => assess({
  symbol, baseHaircut: 0.3, perp: 100, reference: 100, atlas: { price: 100, ageSec: 1, score: 0.9, status: 'HEALTHY' }, dex: { price: 100, liquidityUsd: 5_000_000 }, ...over,
});
const OK = (s = 'SPYB') => view(s);
const WATCH = (s = 'SPYB') => view(s, { atlas: { price: 100, ageSec: 1, score: 0.8, status: 'DEGRADED' } });
const BLOCK = (s = 'SPYB') => view(s, { atlas: { price: 100, ageSec: 900, score: 0.9, status: 'HEALTHY' } });
const UNAVAIL = (s = 'SPYB') => view(s, { atlas: null, dex: null, perp: null });

/** A wallet whose only margin source is selling SPYB ($500 held, all of it sellable), with an optional integrity reading. */
function snap(enabled: boolean, items?: Assessment[], value = 500): Snapshot {
  const s = fixtureSnapshot({ bsc: { usdcUsd: 0, usdtUsd: 0, bstocks: [{ symbol: 'SPYB', qty: 5, value, allowanceQty: 5 }], allowanceUsdcBase: '0' } });
  s.config.rebalance.sources = ['sell_bstocks']; s.config.rebalance.sellOrder = ['SPYB'];
  s.config.integrity = { enabled };
  s.integrityEnabled = enabled;
  if (items) s.integrity = { at: Date.now(), items };
  return s;
}
const topUp = (s: Snapshot): Candidate => buildCandidates(s).candidates.find((c) => c.kind === 'top_up')!;

/** A hedge the user asked for in the chat on a held NVDAB (the chat path: no saved leg needed). */
function chatHedge(s: Snapshot): Candidate {
  return { id: 'chat-trade:1', kind: 'hedge', venue: 'aster', amountBaseUnit: '0', reason: 'chat', explain: 'x', idempotencyKey: 'k', urgency: 0, chat: true, notionalUsd: 20,
    hedge: { bstock: 'NVDAB', market: 'NVDA', deltaToShort: 0.1, driftPct: 100, ticker: 'NVDA', venue: 'aster', kind: 'perp', key: 'aster:NVDA' } } as Candidate;
}
const hedgeSnap = (enabled: boolean, items?: Assessment[]): Snapshot => {
  const s = snap(enabled, items); s.config.hedge.enabled = true;
  s.bsc.bstocks.push({ symbol: 'NVDAB', qty: 1, value: 150, allowanceQty: 0 });
  return s;
};

describe('guard: a blocked token is not relied on (switch ON)', () => {
  it('refuses a top-up that sells a blocked bStock, with the integrity reason', () => {
    const s = snap(true, [BLOCK()]); const c = topUp(s);
    expect(c).toBeTruthy();
    const why = checkCandidate(c, s)!;
    expect(why).toMatch(/SPYB price is not trusted: Atlas price is 900 s old \(limit 180 s\)/);
  });
  it.each([['ok', OK], ['watch', WATCH], ['unavailable', UNAVAIL]] as const)('allows a top-up selling an %s bStock', (_n, f) => {
    const s = snap(true, [f()]); expect(checkCandidate(topUp(s), s)).toBeNull();
  });
  it('refuses a hedge on a blocked bStock, allows it when ok / watch / unavailable', () => {
    const blocked = hedgeSnap(true, [BLOCK('NVDAB')]);
    expect(checkCandidate(chatHedge(blocked), blocked)).toMatch(/NVDAB price is not trusted: Atlas price is 900 s old/);
    for (const f of [OK, WATCH, UNAVAIL]) { const s = hedgeSnap(true, [f('NVDAB')]); expect(checkCandidate(chatHedge(s), s)).toBe(checkCandidate(chatHedge(s), hedgeSnap(false))); }
  });
  it('lets a reduce-only close through even when blocked (closing never relies on the price)', () => {
    const s = hedgeSnap(true, [BLOCK('NVDAB')]); const c = chatHedge(s); c.hedge!.reduceOnly = true;
    expect(checkCandidate(c, s) ?? '').not.toMatch(/not trusted/);
  });
  it('a block on another token does not stop this one', () => {
    const s = snap(true, [BLOCK('NVDAB'), OK('SPYB')]); expect(checkCandidate(topUp(s), s)).toBeNull();
  });
});

describe('haircut in planning (switch ON)', () => {
  it('a watched token counts at its raised haircut; ok / unavailable at the user\'s own', () => {
    expect(haircutFor(snap(true, [WATCH()]), 'SPYB')).toBeGreaterThan(0.3);
    expect(haircutFor(snap(true, [OK()]), 'SPYB')).toBe(0.3);
    expect(haircutFor(snap(true, [UNAVAIL()]), 'SPYB')).toBe(0.3);
    expect(haircutFor(snap(true, [BLOCK()]), 'SPYB')).toBe(0.9);
    expect(haircutFor(snap(true, []), 'SPYB')).toBe(0.3);
  });
  it('never goes below the user\'s own haircut', () => {
    const s = snap(true, [WATCH()]); s.config.collateral.bstockHaircut = 0.5;
    expect(haircutFor(s, 'SPYB')).toBeGreaterThanOrEqual(0.5);
  });
  it('planFunding with a per-symbol function sizes the sale smaller; a plain number behaves as before', () => {
    const cfg = { ...DEFAULT_CONFIG.rebalance, sources: ['sell_bstocks' as const], sellOrder: ['SPYB'], keepBscReserveBaseUnit: '0' };
    const f = { bscUsdc: 0, bscUsdt: 0, bstocks: [{ symbol: 'SPYB', value: 100 }] };
    const old = planFunding('90000000', f, cfg, 0.3);
    expect(old).toEqual({ sources: [{ source: 'sell SPYB', amountUsd: 70 }], shortfallUsd: 20 });
    expect(planFunding('90000000', f, cfg, () => 0.3)).toEqual(old);
    expect(planFunding('90000000', f, cfg, (sym) => (sym === 'SPYB' ? 0.39 : 0.3))).toEqual({ sources: [{ source: 'sell SPYB', amountUsd: 61 }], shortfallUsd: 29 });
  });
  it('the planner funds less from a watched token than from an ok one (the shortfall grows)', () => {
    const tight = (a: Assessment) => buildCandidates(snap(true, [a], 100));
    const okR = tight(OK()); const watchR = tight(WATCH());
    const okAmt = okR.candidates.find((c) => c.kind === 'top_up'); const wAmt = watchR.candidates.find((c) => c.kind === 'top_up');
    expect(okAmt && wAmt).toBeTruthy();
    expect(BigInt(wAmt!.amountBaseUnit)).toBeLessThan(BigInt(okAmt!.amountBaseUnit));
  });
});

describe('switch OFF is exactly the old behaviour', () => {
  // The same wallet three ways: pre-feature shape (no integrity fields at all), switch off, and switch off with stale integrity data lying around.
  const plain = () => { const s = snap(false); delete s.integrityEnabled; return s; };
  const off = () => snap(false);
  const offStale = () => snap(false, [BLOCK(), WATCH()]);

  it.each([['switch off', off], ['switch off with stale integrity data', offStale]] as const)('same candidates, sizes and funding (%s)', (_n, mk) => {
    const a = buildCandidates(plain()); const b = buildCandidates(mk());
    expect(b.candidates).toEqual(a.candidates); expect(b.rejected).toEqual(a.rejected);
    expect(b.candidates.length).toBeGreaterThan(0);
  });
  it.each([['switch off', off], ['switch off with stale integrity data', offStale]] as const)('same guard verdicts (%s)', (_n, mk) => {
    const a = plain(); const b = mk();
    expect(checkCandidate(topUp(b), b)).toBe(checkCandidate(topUp(a), a));
    const ha = hedgeSnap(false); const hb = hedgeSnap(false, [BLOCK('NVDAB')]);
    expect(checkCandidate(chatHedge(hb), hb)).toBe(checkCandidate(chatHedge(ha), ha));
    expect(haircutFor(b, 'SPYB')).toBe(0.3);
  });
  it('same alerts and chat facts (no integrity lines at all)', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    const a = plain(); const b = offStale();
    expect(buildStatus(b, {}, now).alerts).toEqual(buildStatus(a, {}, now).alerts);
    const fa = buildFacts(a, { actions: [], events: [] }, null, 'live', now); const fb = buildFacts(b, { actions: [], events: [] }, null, 'live', now);
    expect(fb.map((f) => f.label + f.value)).toEqual(fa.map((f) => f.label + f.value));
    expect(integrityAlerts(b)).toEqual([]);
    expect(fb.some((f) => /integrity/i.test(f.label + f.value))).toBe(false);
  });
  it('collectSnapshot with the switch off never calls the integrity sources and leaves the field absent', async () => {
    const calls = vi.fn(); const fetchSpy = vi.fn(async () => { throw new Error('network must not be touched'); });
    vi.stubGlobal('fetch', fetchSpy);
    const cfg: AgentConfig = structuredClone({ ...DEFAULT_CONFIG, integrity: { enabled: false } });
    const s = await collectSnapshot(W, 'mainnet', cfg, deps({ integrity: async (f, c) => { calls(); return refreshIntegrity({ funds: f, cfg: c }, { fetch: fetchSpy as never, atlasKey: 'k' }); } }));
    expect(calls).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
    expect(s.integrity).toBeUndefined(); expect(s.integrityEnabled).toBe(false);
  });
});

const W = '0x1111111111111111111111111111111111111111';
const funds: CollectDeps['funds'] = async (_w, symbols) => ({ funds: { usdcUsd: 0, usdtUsd: 0, allowanceUsdcBase: '0',
  bstocks: symbols.map((x) => ({ symbol: x, qty: x === 'SPYB' ? 4 : 0, value: x === 'SPYB' ? 400 : 0, allowanceQty: 0 })) }, problems: [] });
const deps = (over: Partial<CollectDeps> = {}): CollectDeps => ({
  getRuleStates: async () => ({}), getAsterCreds: async () => { throw new Error('unused'); }, getDeriveCreds: async () => { throw new Error('unused'); },
  asterAccount: async () => ({ account: null, positions: [], funded: false }), deriveSubaccount: async () => { throw new Error('unused'); },
  funds, moved24h: () => 0n, ...over,
});

describe('collectSnapshot with the switch ON', () => {
  it('reads integrity once for the held tokens and puts it on the snapshot', async () => {
    const seen: string[][] = [];
    const cfg: AgentConfig = structuredClone({ ...DEFAULT_CONFIG, integrity: { enabled: true } });
    const s = await collectSnapshot(W, 'mainnet', cfg, deps({ integrity: async (f) => { seen.push(f.bstocks.filter((b) => b.qty > 0).map((b) => b.symbol)); return { at: 1, items: [WATCH()], problems: [] }; } }));
    expect(seen).toEqual([['SPYB']]); expect(s.integrityEnabled).toBe(true);
    expect(s.integrity).toEqual({ at: 1, items: [WATCH()] });
  });
  it('a throwing source or a null result leaves no integrity (behaves as before), never an error', async () => {
    const cfg: AgentConfig = structuredClone({ ...DEFAULT_CONFIG, integrity: { enabled: true } });
    const a = await collectSnapshot(W, 'mainnet', cfg, deps({ integrity: async () => { throw new Error('boom'); } }));
    const b = await collectSnapshot(W, 'mainnet', cfg, deps({ integrity: async () => null }));
    for (const s of [a, b]) { expect(s.integrity).toBeUndefined(); expect(s.dataQuality).toEqual([]); }
  });
  it('through the real chain, an injected fetch is used (Atlas key, CMC, perp) and nothing else', async () => {
    const urls: string[] = []; const f = vi.fn(async (u: unknown) => { urls.push(String(u)); return new Response('{}', { status: 500 }); });
    const cfg: AgentConfig = structuredClone({ ...DEFAULT_CONFIG, integrity: { enabled: true } });
    const s = await collectSnapshot(W, 'mainnet', cfg, deps({ integrity: (fd, c) => refreshIntegrity({ funds: fd, cfg: c }, { fetch: f as never, atlasKey: 'k' }) }));
    expect(f).toHaveBeenCalled(); expect(urls.every((u) => /atlasoracle|coinmarketcap|asterdex/.test(u))).toBe(true);
    expect(s.integrity?.items[0].verdict).toBe('unavailable');   // 500s everywhere: only our own reference price, so never a block
  });
});

describe('refreshIntegrity: timeout and failure never throw', () => {
  const input = () => ({ funds: { usdcUsd: 0, usdtUsd: 0, allowanceUsdcBase: '0', bstocks: [{ symbol: 'SPYB', qty: 4, value: 400 }, { symbol: 'NVDAB', qty: 0, value: 0 }] }, cfg: structuredClone(DEFAULT_CONFIG) as AgentConfig });
  it('relevant symbols: held, sell order and legs, known tokens only', () => {
    const i = input(); i.cfg.rebalance.sellOrder = ['MSTRB', 'ZZZB']; i.cfg.hedge.legs = [{ bstock: 'TSLAB', venue: 'aster', kind: 'perp', market: 'TSLA', hedgeRatio: 1 }] as never;
    expect(relevantSymbols(i)).toEqual(['MSTRB', 'SPYB', 'TSLAB']);
  });
  it('passes the reference price (value/qty), the base haircut and the Atlas key to the assessor', async () => {
    let got: { ref: number | null; base: number; key: string | null } | null = null;
    await refreshIntegrity(input(), { atlasKey: 'abc', assess: async (d) => { got = { ref: d.reference('SPYB'), base: d.baseHaircut, key: d.atlasKey }; return { at: 1, items: [], problems: [] }; } });
    expect(got).toEqual({ ref: 100, base: 0.3, key: 'abc' });
  });
  it('a hung source times out to null (unavailable) without throwing', async () => {
    expect(await refreshIntegrity(input(), { timeoutMs: 20, assess: () => new Promise(() => undefined) })).toBeNull();
  });
  it('a throwing source gives null', async () => {
    expect(await refreshIntegrity(input(), { assess: async () => { throw new Error('boom'); } })).toBeNull();
  });
  it('on timeout the last good reading is used, if recent', async () => {
    const good = { at: 1000, items: [OK()], problems: [] };
    expect(await refreshIntegrity(input(), { now: () => 1000, assess: async () => good })).toBe(good);
    expect(await refreshIntegrity(input(), { now: () => 2000, timeoutMs: 20, assess: () => new Promise(() => undefined) })).toBe(good);
    expect(await refreshIntegrity(input(), { now: () => 1000 + 10 * 60_000, timeoutMs: 20, assess: () => new Promise(() => undefined) })).toBeNull();
  });
  it('nothing relevant to assess: no call', async () => {
    const i = input(); i.funds.bstocks = []; i.cfg.rebalance.sellOrder = []; i.cfg.hedge.legs = [];
    const f = vi.fn(); expect(await refreshIntegrity(i, { assess: f as never })).toBeNull(); expect(f).not.toHaveBeenCalled();
  });
});

describe('visibility (switch ON)', () => {
  const now = new Date('2026-11-26T12:00:00Z');
  it('status alerts: one line per non-ok token', () => {
    const s = snap(true, [WATCH('SPYB'), BLOCK('NVDAB'), OK('MSTRB')]);
    const lines = buildStatus(s, {}, now).alerts.filter((a) => a.startsWith('Price integrity'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Price integrity: SPYB is on watch: Atlas marks this feed degraded \(consensus 0\.80\); haircut 33% instead of 30%$/);
    expect(lines[1]).toBe('Price integrity: NVDAB is BLOCKED: Atlas price is 900 s old (limit 180 s): the oracle is stale, the agent will not hedge or top up against it');
  });
  it('unavailable and ok produce no alert line', () => { expect(integrityAlerts(snap(true, [OK(), UNAVAIL('NVDAB')]))).toEqual([]); });
  it('chat facts: a Price integrity fact per assessed token', () => {
    const f = buildFacts(snap(true, [WATCH(), OK('NVDAB')]), { actions: [], events: [] }, null, 'live', now).filter((x) => x.label.startsWith('Price integrity'));
    expect(f.map((x) => x.label)).toEqual(['Price integrity SPYB', 'Price integrity NVDAB']);
    expect(f[0].value).toMatch(/^watch; collateral haircut 33% \(your own 30%\); 4 price sources read; Atlas marks this feed degraded/);
  });
  it('get_price_integrity detail: prices, gaps, verdict; says so when off or unavailable', () => {
    const d = integrityDetail(snap(true, [WATCH()]))[0].value;
    expect(d).toMatch(/Atlas \$100\.00 \(1 s old, consensus 0\.80, DEGRADED\); CoinMarketCap DEX \$100\.00 \(pool liquidity \$5,000,000\); stock perp \$100\.00/);
    expect(integrityDetail(snap(false))[0].value).toMatch(/the layer is off/);
    expect(integrityDetail(snap(true))[0].value).toMatch(/unavailable/);
  });
  it('shown text never names the perps venue', () => {
    const all = [...integrityAlerts(snap(true, [WATCH(), BLOCK('NVDAB')])), ...integrityDetail(snap(true, [WATCH()])).map((x) => x.value)].join(' ');
    expect(all).not.toMatch(/Aster|Lighter|Derive/);
  });
});
