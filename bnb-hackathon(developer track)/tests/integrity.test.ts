import { afterEach, describe, expect, it } from 'vitest';
import { assess, effectiveHaircut, liquidityAdd, mayRely, type IntegrityInput } from '../lib/integrity';
import { assessBStocks, clearIntegrityCache, fetchAtlas, fetchDex, parseAtlas } from '../lib/integrity-sources';
import { ATLAS_FEEDS } from '../lib/atlas-feeds';
import { AgentConfig, DEFAULT_CONFIG } from '../lib/agent-config';

// Numbers below are what Atlas, CoinMarketCap and Aster returned on 2026-11-26.
const base: IntegrityInput = {
  symbol: 'NVDAB', baseHaircut: 0.3, perp: 150.27, reference: 150.2,
  atlas: { price: 150.4, ageSec: 1, score: 0.89, status: 'HEALTHY' },
  dex: { price: 149.75, liquidityUsd: 5_621_683 },
};

describe('assess: one token, four views of its price', () => {
  it('everything agrees (NVDAB): ok, the user\'s own haircut', () => {
    const a = assess(base);
    expect(a.verdict).toBe('ok'); expect(a.haircut).toBe(0.3); expect(a.reasons).toEqual([]);
    expect(a.gaps.atlas).toBeCloseTo(0.00087, 4);
  });
  it('MSTRB: Atlas degraded and a thin pool raise the haircut but it stays usable', () => {
    const a = assess({ ...base, symbol: 'MSTRB', perp: 82.54, reference: 82.5, atlas: { price: 82.3, ageSec: 1, score: 0.88, status: 'DEGRADED' }, dex: { price: 82.48, liquidityUsd: 234_209 } });
    expect(a.verdict).toBe('watch');
    expect(a.haircut).toBeCloseTo(0.3 + 0.03 + 0.06, 6);                       // degraded +3pp, pool under $250k +6pp
    expect(a.reasons.join('|')).toMatch(/Atlas marks this feed degraded \(consensus 0\.88\)/);
    expect(a.reasons.join('|')).toMatch(/DEX liquidity \$234,209 is limited/);
  });
  it('a stale oracle blocks, whatever the price says', () => {
    const a = assess({ ...base, atlas: { price: 150.4, ageSec: 400, score: 0.9, status: 'HEALTHY' } });
    expect(a.verdict).toBe('block'); expect(a.haircut).toBe(0.9); expect(a.reasons[0]).toMatch(/400 s old.*stale/);
  });
  it('a very low consensus score blocks', () => {
    expect(assess({ ...base, atlas: { price: 150.4, ageSec: 2, score: 0.6, status: 'DEGRADED' } }).verdict).toBe('block');
  });
  it('a price 5% away from the stock\'s perp blocks; 2% only raises the haircut', () => {
    const far = assess({ ...base, atlas: { price: 158, ageSec: 2, score: 0.9, status: 'HEALTHY' } });
    expect(far.verdict).toBe('block'); expect(far.reasons[0]).toMatch(/Atlas price is 5\.14% away from the stock's perp/);
    const mid = assess({ ...base, atlas: { price: 153.3, ageSec: 2, score: 0.9, status: 'HEALTHY' } });
    expect(mid.verdict).toBe('watch'); expect(mid.haircut).toBeGreaterThan(0.3);
  });
  it('a pool under $100k blocks (it cannot be sold at size): the fake TSLAB lookalike case', () => {
    const a = assess({ ...base, symbol: 'TSLAB', dex: { price: 370, liquidityUsd: 7_083 } });
    expect(a.verdict).toBe('block'); expect(a.reasons.join('|')).toMatch(/DEX liquidity is only \$7,083/);
  });
  it('fewer than two sources: unavailable, and NOT blocked (never block on our own outage)', () => {
    const a = assess({ ...base, atlas: null, dex: null, reference: null });
    expect(a.verdict).toBe('unavailable'); expect(a.haircut).toBe(0.3);
    expect(mayRely(a, true)).toEqual({ ok: true });
  });
  it('without the perp the middle of the on-chain views is the anchor', () => {
    const a = assess({ ...base, perp: null, atlas: { price: 190, ageSec: 1, score: 0.9, status: 'HEALTHY' } });
    expect(a.verdict).toBe('block'); expect(a.reasons[0]).toMatch(/Atlas price is .* away from the other sources/);
  });
  it('the dynamic haircut never goes below the user\'s own, and never above 90%', () => {
    for (const base0 of [0.1, 0.3, 0.6]) {
      const a = assess({ ...base, baseHaircut: base0, atlas: { price: 153.5, ageSec: 1, score: 0.8, status: 'DEGRADED' }, dex: { price: 150, liquidityUsd: 150_000 } });
      expect(a.haircut).toBeGreaterThanOrEqual(base0); expect(a.haircut).toBeLessThanOrEqual(0.9);
    }
  });
  it('liquidity tiers', () => {
    expect([5e6, 1.5e6, 7e5, 3e5, 1.2e5].map(liquidityAdd)).toEqual([0, 0, 0.02, 0.04, 0.06]);
    expect(liquidityAdd(99_999)).toBeNull();
  });
});

describe('the on/off switch: off is exactly the old behaviour', () => {
  const blocked = assess({ ...base, atlas: { price: 150.4, ageSec: 900, score: 0.9, status: 'HEALTHY' } });
  const watching = assess({ ...base, atlas: { price: 150.4, ageSec: 1, score: 0.8, status: 'DEGRADED' } });
  it('OFF: the flat haircut and nothing is ever blocked', () => {
    expect(effectiveHaircut(blocked, 0.3, false)).toBe(0.3); expect(effectiveHaircut(watching, 0.3, false)).toBe(0.3);
    expect(mayRely(blocked, false)).toEqual({ ok: true });
  });
  it('ON: the assessed haircut and a blocked token is refused with its reason', () => {
    expect(effectiveHaircut(watching, 0.3, true)).toBeGreaterThan(0.3); expect(effectiveHaircut(blocked, 0.3, true)).toBe(0.9);
    const r = mayRely(blocked, true); expect(r.ok).toBe(false); if (!r.ok) expect(r.reason).toMatch(/NVDAB price is not trusted: Atlas price is 900 s old/);
  });
  it('a saved config with no integrity key means ON; the switch round-trips', () => {
    const { integrity, ...old } = DEFAULT_CONFIG; void integrity;
    expect(AgentConfig.parse(old).integrity).toEqual({ enabled: true });
    expect(AgentConfig.parse({ ...old, integrity: { enabled: false } }).integrity.enabled).toBe(false);
  });
});

describe('sources: parsing and fail-soft', () => {
  const NOW = 1_795_687_410_000;
  const atlasBody = { data: { parsedPayload: JSON.stringify([{ feedId: '1005', price: 150398765432100000000, timestampSeconds: '1795687409' }]), consensusScores: [{ feedId: '1005', consensusScore: 0.89, consensusStatus: 'HEALTHY' }] } };
  it('parseAtlas reads the 18-decimal price, age and consensus', () => {
    const q = parseAtlas(atlasBody, 1005, NOW)!;
    expect(q.price).toBeCloseTo(150.3988, 3); expect(q.ageSec).toBe(1); expect(q).toMatchObject({ score: 0.89, status: 'HEALTHY' });
    expect(parseAtlas({ status: { error_message: 'feedId 1 not authorized' } }, 1005, NOW)).toBeNull();
  });
  it('fetchAtlas asks one feed per call and skips a feed that fails', async () => {
    const calls: string[] = [];
    const f = (async (_u: string, init?: RequestInit) => { const id = JSON.parse(String(init?.body)).feedIds[0]; calls.push(id); return id === '1005' ? new Response(JSON.stringify(atlasBody)) : new Response('{}', { status: 500 }); }) as unknown as typeof fetch;
    const out = await fetchAtlas([1005, 939], 'k', f, NOW);
    expect(Object.keys(out)).toEqual(['1005']); expect(calls.sort()).toEqual(['1005', '939']);
  });
  it('fetchDex matches the BSC token by ADDRESS, ignoring a same-ticker impostor', async () => {
    const real = '0x5b1910eAaD6450E50f816082Aa078C41F10C292f';
    const f = (async () => new Response(JSON.stringify({ data: { tks: [
      { plt: 'BSC', addr: '0x3b7370d0d66f106522d51625bd9a715cea777777', pu: '370', liq: '7083' },
      { plt: 'BSC', addr: real.toLowerCase(), pu: '382.39', liq: '1857200', v24h: '1990690' }] } }))) as unknown as typeof fetch;
    expect(await fetchDex(real, f)).toEqual({ price: 382.39, liquidityUsd: 1857200, volume24hUsd: 1990690 });
  });
  afterEach(() => clearIntegrityCache());
  it('assessBStocks: when every service is down the result is "unavailable", never an exception', async () => {
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const r = await assessBStocks({ atlasKey: 'k', reference: () => null, baseHaircut: 0.3, fetch: down }, ['NVDAB', 'MSTRB']);
    expect(r.items.map((x) => x.verdict)).toEqual(['unavailable', 'unavailable']);
    expect(r.problems.join('|')).toMatch(/Atlas returned no prices.*perp prices could not be read.*CoinMarketCap DEX data could not be read/);
  });
  it('the five confirmed feeds are the ones the project owner gave', () => {
    expect(ATLAS_FEEDS).toEqual({ NVDAB: 1005, MSTRB: 939, SPYB: 956, QQQB: 1010, TSLAB: 1206 });
  });
});
