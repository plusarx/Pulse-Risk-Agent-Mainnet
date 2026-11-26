import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigForTests } from '../src/config';
import { fixtureSnapshot } from '../src/fixtures';
import { buildGraph } from '../src/graph';
import { setLlmRunner } from '../src/llm/run';
import { computeNews, parseRss, sentimentOf, setTextFetcher } from '../src/news';
import { effectiveMode, noteAnomaly, policyCheck } from '../src/policy';
import { memoryActions, setActionsBackend } from '../src/tools/appApi';
import { runApproved } from '../src/tools/approved';
import { checkCandidate } from '../src/tools/guard';
import { splitFunding } from '../src/tools/funding';
import { buildCandidates } from '../src/tools/planner';
import { closeStore, openStore, pausedReason } from '../src/tools/store';
import { buildStatus } from '../src/status';
import type { Snapshot } from '../src/types';

const env = (o: Record<string, string> = {}) => resetConfigForTests(loadConfig({ DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off', ...o }));
beforeEach(() => { openStore(':memory:'); env(); });
afterEach(() => { closeStore(); setLlmRunner(); setTextFetcher(); setActionsBackend(); resetConfigForTests(); });

const rss = (items: { t: string; src?: string; ago?: number }[]) => `<?xml version="1.0"?><rss><channel>${items.map((i) => `<item><title>${i.t}</title><link>http://x/${encodeURIComponent(i.t)}</link><pubDate>${new Date(Date.now() - (i.ago ?? 2) * 3_600_000).toUTCString()}</pubDate><source>${i.src ?? 'Reuters'}</source></item>`).join('')}</channel></rss>`;
const NEG = rss([{ t: 'Tesla recalls 400,000 cars after safety probe - Reuters' }, { t: 'Tesla stock plunges as sales miss estimates' }, { t: 'Regulators open investigation into Tesla' }]);
const feed = (m: Record<string, string>) => setTextFetcher(async (u) => (u.includes('TSLA') || u.includes('Tesla') ? m.TSLA : m.NVDA) ?? '<rss/>');

/** $2,000 NVDAB. NVDA moves 3.5% a day: 99% loss 8.1% against a 5% limit, so about 38% must be hedged. */
function hedgeSnap(over: Partial<Snapshot> = {}): Snapshot {
  const s = fixtureSnapshot({ health: { 'aster:': { connected: true, utilBps: 5000, accountUsd: 100, usedUsd: 50 } } });
  s.config.hedge = { enabled: true, driftThresholdPct: 5, sizing: 'loss_limit', news: { enabled: false }, legs: [{ bstock: 'NVDAB', venue: 'aster', kind: 'perp', market: 'NVDA', hedgeRatio: 1 }] };
  s.bsc = { ...s.bsc, bstocks: [{ symbol: 'NVDAB', qty: 10, value: 2000, allowanceQty: 10 }] };
  s.perpPositions = {}; s.market = { sigmaDay: { NVDA: 0.035 }, at: new Date().toISOString() };
  s.perpMain = { equityUsd: 1000, freeUsd: 800 }; s.hedgeProblems = []; s.perpEtaSec = 600;
  s.today = { notionalUsd: 0, lossUsd: 0, capitalOffBnbUsd: 1000, pausedReason: null };
  return Object.assign(s, over);
}

describe('news is advisory only', () => {
  it('labels small scores neutral and parses RSS', () => {
    expect(sentimentOf(0.05)).toBe('neutral'); expect(sentimentOf(-0.4)).toBe('negative'); expect(sentimentOf(0.4)).toBe('positive');
    const h = parseRss(rss([{ t: 'Tesla &amp; SpaceX talk - Reuters' }]), 'x');
    expect(h[0].title).toBe('Tesla & SpaceX talk'); expect(h[0].source).toBe('Reuters');
  });
  it('strong bad news raises a flag with no hedge ratio attached', async () => {
    feed({ TSLA: NEG, NVDA: '' });
    const s = hedgeSnap(); s.config.hedge.news.enabled = true; s.config.hedge.legs = [{ bstock: 'TSLAB', venue: 'aster', kind: 'perp', market: 'TSLA', hedgeRatio: 1 }]; s.bsc.bstocks = [{ symbol: 'TSLAB', qty: 10, value: 2500, allowanceQty: 10 }];
    const [n] = await computeNews(s);
    expect(n.sentiment).toBe('negative'); expect(n.flagged).toBe(true);
    expect(n).not.toHaveProperty('ratio'); expect(n).not.toHaveProperty('baseRatio');
  });
  it('news never changes a position: the plan is identical with and without news flags', async () => {
    feed({ TSLA: '', NVDA: rss([{ t: 'Nvidia stock plunges after regulator probe and recall' }, { t: 'Nvidia misses estimates, warns on weak demand' }, { t: 'Nvidia faces lawsuit and investigation' }]) });
    const off = hedgeSnap(); const on = hedgeSnap(); on.config.hedge.news.enabled = true;
    const [flag] = await computeNews(on);
    expect(flag.flagged).toBe(true);
    const a = buildCandidates(off).candidates.map((c) => [c.id, c.hedge?.deltaToShort]);
    const b = buildCandidates(on).candidates.map((c) => [c.id, c.hedge?.deltaToShort]);
    expect(b).toEqual(a);
    expect(a.length).toBe(1);
  });
  it('the graph reads news, keeps the trade the same and still posts the flag as context only', async () => {
    feed({ TSLA: '', NVDA: rss([{ t: 'Nvidia stock plunges after regulator probe and recall' }, { t: 'Nvidia misses estimates, warns on weak demand' }, { t: 'Nvidia faces lawsuit and investigation' }]) });
    const off = await buildGraph().invoke({ snapshot: hedgeSnap() });
    const on = hedgeSnap(); on.config.hedge.news.enabled = true;
    const withNews = await buildGraph().invoke({ snapshot: on });
    expect(withNews.news[0]?.flagged).toBe(true);
    expect(withNews.chosen?.id).toBe(off.chosen?.id);
    expect(withNews.chosen?.hedge?.deltaToShort).toBe(off.chosen?.hedge?.deltaToShort);
  });
  it('no headlines, a feed outage, or news switched off give no flag', async () => {
    const s = hedgeSnap(); s.config.hedge.news.enabled = true;
    feed({ TSLA: '<rss/>', NVDA: '<rss/>' }); expect((await computeNews(s))[0].flagged).toBe(false);
    setTextFetcher(async () => { throw new Error('HTTP 503'); }); expect((await computeNews(s))[0].flagged).toBe(false);
    s.config.hedge.news.enabled = false; expect(await computeNews(s)).toEqual([]);
  });
  it('the LLM scores the news but code clamps the numbers', async () => {
    feed({ TSLA: '', NVDA: NEG });
    setLlmRunner((async () => ({ items: [{ ticker: 'NVDA', score: -5, confidence: 9, reason: 'bad', keyHeadlines: [] }] })) as never);
    env({ LLM_MODE: 'on', OPENROUTER_API_KEY: 'x' });
    const s = hedgeSnap(); s.config.hedge.news.enabled = true;
    const [n] = await computeNews(s);
    expect(n.score).toBe(-1); expect(n.confidence).toBe(1);
  });
});

describe('selling bStocks for margin (after USDC and USDT)', () => {
  const sellSnap = () => {
    const s = fixtureSnapshot({ bsc: { usdcUsd: 0, usdtUsd: 0, bstocks: [{ symbol: 'SPYB', qty: 1, value: 500, allowanceQty: 1 }], allowanceUsdcBase: '0' } });
    s.config.rebalance.sources = ['sell_bstocks']; s.config.rebalance.sellOrder = ['SPYB'];
    return s;
  };
  it('plans a sale worth (1 - haircut) of the value and the guard accepts it with an allowance', () => {
    const s = sellSnap(); const c = buildCandidates(s).candidates[0];
    expect(c.funding![0].source).toBe('sell SPYB');
    expect(checkCandidate(c, s)).toBeNull();
    const sp = splitFunding(c); expect(sp.usdcBase).toBe(0n); expect(sp.sales[0].base).toBe(BigInt(c.amountBaseUnit));
  });
  it('refuses without an allowance to the agent', () => {
    const s = sellSnap(); s.bsc.bstocks[0].allowanceQty = 0;
    expect(checkCandidate(buildCandidates(sellSnap()).candidates[0], s)).toMatch(/allowance to the agent/);
  });
  it('the step list pulls the bStock, sells it on PancakeSwap, and says a sale is final', async () => {
    const out = await buildGraph().invoke({ snapshot: sellSnap() });
    const text = out.steps.map((x) => x.step).join(' | ');
    expect(text).toMatch(/sell it for USDC on PancakeSwap/); expect(text).toMatch(/sale is final/);
  });
});

describe('policy engine', () => {
  const top = () => buildCandidates(fixtureSnapshot()).candidates[0];
  it('kill switch blocks every action kind', () => {
    const s = fixtureSnapshot(); s.config.limits.killSwitch = true;
    expect(policyCheck(top(), s).block).toMatch(/kill switch/);
    const h = hedgeSnap(); h.config.limits.killSwitch = true;
    expect(checkCandidate(buildCandidates(hedgeSnap()).candidates[0], h)).toMatch(/kill switch/);
  });
  it('autonomy lapses at its expiry and when the daily loss cap is hit', () => {
    const s = fixtureSnapshot(); expect(effectiveMode(s).mode).toBe('autonomous');
    s.config.limits.autonomyExpiresAt = new Date(Date.now() - 1000).toISOString(); expect(effectiveMode(s).mode).toBe('confirm');
    const t = fixtureSnapshot({ today: { notionalUsd: 0, lossUsd: 2000, capitalOffBnbUsd: 0, pausedReason: null } }); expect(effectiveMode(t).mode).toBe('confirm');
  });
  it('after the daily loss cap only risk-reducing actions are allowed (adding margin yes, releasing no)', () => {
    const s = fixtureSnapshot({ today: { notionalUsd: 0, lossUsd: 2000, capitalOffBnbUsd: 0, pausedReason: null } });
    expect(policyCheck(top(), s).block).toBeNull();
    const rel = { ...top(), kind: 'release' as const };
    expect(policyCheck(rel, s).block).toMatch(/daily loss cap/);
  });
  it('over the weekly protection budget it asks the user instead of acting', () => {
    const s = hedgeSnap(); s.config.risk.premiumBudgetWeeklyPct = 0;
    const c = buildCandidates(s).candidates[0];
    expect(policyCheck(c, s).confirm).toMatch(/weekly protection budget/);
  });
  it('the anomaly stop pauses the agent after repeated refusals and the pause blocks everything', () => {
    env({ ANOMALY_MAX_REFUSALS: '3' });
    const now = Date.now();
    expect(noteAnomaly('0xabc', 'testnet', 'refused', now)).toBeNull();
    expect(noteAnomaly('0xabc', 'testnet', 'refused', now + 1)).toBeNull();
    expect(noteAnomaly('0xabc', 'testnet', 'refused', now + 2)).toMatch(/limit probing/);
    expect(pausedReason('0xabc', 'testnet', now + 3)).toMatch(/limit probing/);
    const s = fixtureSnapshot({ today: { notionalUsd: 0, lossUsd: 0, capitalOffBnbUsd: 0, pausedReason: 'limit probing' } });
    expect(policyCheck(top(), s).block).toMatch(/paused/);
  });
});

describe('hedge plan from the loss limit', () => {
  it('shows what is hedged, the cost, the VaR before and after, and when it stops being valid', () => {
    const c = buildCandidates(hedgeSnap()).candidates[0];
    const p = c.plan!;
    expect(p.varBeforePct).toBeGreaterThan(p.limitPct); expect(p.varAfterPct).toBeLessThanOrEqual(p.limitPct + 0.01);
    expect(p.requiredHedgePct).toBeGreaterThan(30); expect(p.requiredHedgePct).toBeLessThan(45);
    expect(p.cost.feesUsd).toBeGreaterThan(0); expect(p.coverage.directPct).toBe(100);
    expect(p.leverage).toBeLessThanOrEqual(3); expect(Date.parse(p.validUntil)).toBeGreaterThan(Date.now());
    expect(p.assumptions.join(' ')).toMatch(/put would cost/); expect(p.worstCase).toMatch(/rises about/);
  });
  it('spec scenario 3: a slow margin deposit before the event gives a partial hedge from the margin already on perps', () => {
    const s = hedgeSnap({ perpMain: { equityUsd: 100, freeUsd: 100 }, perpEtaSec: 1500 });
    s.config.events = [{ ticker: 'NVDA', at: new Date(Date.now() + 20 * 60_000).toISOString(), kind: 'earnings', gapPct: 12 }];
    const c = buildCandidates(s).candidates[0];
    expect(c.plan!.marginPlan).toBeNull();
    expect(c.plan!.sizeUsd).toBeLessThan(2000 * 0.4);
    expect(c.plan!.assumptions.join(' ')).toMatch(/deposit time/);
  });
});

describe('status for the app', () => {
  it('reports mode, coverage, VaR against the limit, the next event and the blind spots', () => {
    const s = hedgeSnap();
    s.config.events = [{ ticker: 'NVDA', at: new Date(Date.now() + 18 * 3_600_000).toISOString(), kind: 'earnings' }];
    const st = buildStatus(s, { newsAt: new Date().toISOString() });
    expect(st.mode).toBe('autonomous'); expect(st.portfolioUsd).toBe(2000); expect(st.window).toBe('event');
    expect(st.nextEvent?.ticker).toBe('NVDA'); expect(st.nextEvent?.inHours).toBeCloseTo(18, 0);
    expect(st.varPct).toBeGreaterThan(st.limitPct); expect(st.hedgedPct).toBe(0);
    expect(st.notMonitored.join(' ')).toMatch(/Breaking news/); expect(st.coverage.directPct).toBe(100);
  });
  it('shows the kill switch, a pause and an expired autonomy as alerts', () => {
    const s = hedgeSnap(); s.config.limits.killSwitch = true; s.config.limits.autonomyExpiresAt = new Date(Date.now() - 1000).toISOString();
    s.today = { notionalUsd: 0, lossUsd: 0, capitalOffBnbUsd: 0, pausedReason: 'limit probing' };
    const st = buildStatus(s);
    expect(st.killSwitch).toBe(true); expect(st.mode).toBe('confirm'); expect(st.paused?.reason).toBe('limit probing');
    expect(st.alerts.join(' ')).toMatch(/Kill switch/); expect(st.alerts.join(' ')).toMatch(/Autonomy expired/);
  });
});

describe('confirmation mode', () => {
  const confirmSnap = (): Snapshot => { const s = fixtureSnapshot(); s.config.mode = 'confirm'; return s; };

  it('asks once, explains itself, and moves nothing until approved', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    const out = await buildGraph().invoke({ snapshot: confirmSnap() });
    expect(out.outcome).toBe('awaiting'); expect(out.steps).toHaveLength(0);
    expect(m.rows).toHaveLength(1);
    const r = m.rows[0];
    expect(r.status).toBe('pending'); expect(r.why).toMatch(/utilization/i); expect(r.helps).toMatch(/liquidation/); expect(r.willDo.join(' ')).toMatch(/bridge/);
    await buildGraph().invoke({ snapshot: confirmSnap() });
    expect(m.rows).toHaveLength(1);
  });

  it('runs the approved request, re-guarded, and acknowledges the result', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    await buildGraph().invoke({ snapshot: confirmSnap() });
    m.approve(m.rows[0].id);
    expect(await runApproved(confirmSnap())).toBe(1);
    expect(m.rows[0].status).toBe('executed'); expect(m.rows[0].result_message).toMatch(/Dry run/);
  });

  it('does not run an approval when conditions changed (account is safe again)', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    await buildGraph().invoke({ snapshot: confirmSnap() });
    m.approve(m.rows[0].id);
    const safe = confirmSnap(); safe.health = { 'aster:': { connected: true, utilBps: 4000, accountUsd: 200, usedUsd: 80 } };
    await runApproved(safe);
    expect(m.rows[0].status).toBe('expired'); expect(m.rows[0].result_message).toMatch(/Nothing was moved/);
  });

  it('does not run an approval whose size moved more than 25%', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    await buildGraph().invoke({ snapshot: confirmSnap() });
    m.approve(m.rows[0].id);
    const worse = confirmSnap(); worse.health = { 'aster:': { connected: true, utilBps: 9500, accountUsd: 100, usedUsd: 95 } };
    await runApproved(worse);
    expect(m.rows[0].status).toBe('expired'); expect(m.rows[0].result_message).toMatch(/25%/);
  });

  it('the kill switch stops an approved request from running', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    await buildGraph().invoke({ snapshot: confirmSnap() });
    m.approve(m.rows[0].id);
    const killed = confirmSnap(); killed.config.limits.killSwitch = true;
    await runApproved(killed);
    expect(m.rows[0].status).toBe('expired'); expect(m.rows[0].result_message).toMatch(/kill switch/);
  });

  it('a rejected request is not asked again in the same window', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    await buildGraph().invoke({ snapshot: confirmSnap() });
    m.reject(m.rows[0].id);
    const out = await buildGraph().invoke({ snapshot: confirmSnap() });
    expect(m.rows).toHaveLength(1); expect(out.outcome).toBe('skipped');
  });

  it('fails closed when the approval inbox is unreachable', async () => {
    setActionsBackend({ create: async () => { throw new Error('app down'); }, list: async () => { throw new Error('app down'); }, result: async () => undefined });
    const out = await buildGraph().invoke({ snapshot: confirmSnap() });
    expect(out.outcome).toBe('error'); expect(out.steps).toHaveLength(0);
  });

  it('autonomous mode acts without asking', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    const out = await buildGraph().invoke({ snapshot: fixtureSnapshot() });
    expect(out.outcome).toBe('simulated'); expect(m.rows).toHaveLength(0);
  });

  it('autonomy that has expired asks first even in autonomous mode', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    const s = fixtureSnapshot(); s.config.limits.autonomyExpiresAt = new Date(Date.now() - 1000).toISOString();
    const out = await buildGraph().invoke({ snapshot: s });
    expect(out.outcome).toBe('awaiting'); expect(m.rows[0].why).toMatch(/Autonomy expired/);
  });

  it('asks before a hedge and shows the plan: cost, VaR before and after, validity', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    const s = hedgeSnap(); s.config.mode = 'confirm';
    const out = await buildGraph().invoke({ snapshot: s });
    expect(out.outcome).toBe('awaiting');
    const r = m.rows[0];
    expect(r.kind).toBe('hedge'); expect(r.title).toMatch(/Sell .* NVDA short/);
    expect(r.plan?.varAfterPct).toBeLessThan(r.plan?.varBeforePct ?? 0); expect(r.plan?.cost.feesUsd).toBeGreaterThan(0);
    expect(r.helps).toMatch(/Modelled worst case/);
  });
});
