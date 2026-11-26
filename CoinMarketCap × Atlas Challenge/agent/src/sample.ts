import { defaultRule } from '../../lib/risk-rules';
import { fixtureSnapshot } from './fixtures';
import { setTextFetcher } from './news';
import { sampleChain, setOptionsProvider } from './risk/options';
import type { Candidate, Snapshot } from './types';

// The test portfolio used by the demos and the live sample mode: perps (Aster), Derive, bStocks, BNB wallet, rules,
// limits, scheduled events, Derive put chains and news. Nothing here is connected to a real account.

const rss = (items: { t: string; src: string; ago: number }[]) => `<rss><channel>${items.map((i) => `<item><title>${i.t}</title><link>http://x/${encodeURIComponent(i.t)}</link><pubDate>${new Date(Date.now() - i.ago * 3_600_000).toUTCString()}</pubDate><source>${i.src}</source></item>`).join('')}</channel></rss>`;
export const SAMPLE_NEWS = {
  TSLA: rss([{ t: 'Tesla recalls 400,000 vehicles after federal safety probe', src: 'Reuters', ago: 2 }, { t: 'Tesla shares plunge as quarterly deliveries miss estimates', src: 'Bloomberg', ago: 4 }, { t: 'Regulators open new investigation into Tesla driver-assist software', src: 'WSJ', ago: 6 }]),
  NVDA: rss([{ t: 'Nvidia beats earnings estimates and raises guidance on record AI demand', src: 'Reuters', ago: 1 }, { t: 'Analysts upgrade Nvidia after strong data center growth', src: 'CNBC', ago: 3 }]),
};
const SPOT: Record<string, { spot: number; vol: number }> = { NVDA: { spot: 200, vol: 0.5 }, TSLA: { spot: 250, vol: 0.65 }, AAPL: { spot: 200, vol: 0.3 } };

/** Canned headlines and a sample Derive put chain, so the agent can be tested without any live data. */
export function installSampleFeeds() {
  setTextFetcher(async (u) => (u.includes('TSLA') || u.includes('Tesla') ? SAMPLE_NEWS.TSLA : u.includes('NVDA') || u.includes('NVIDIA') ? SAMPLE_NEWS.NVDA : '<rss/>'));
  setOptionsProvider(async (_n, ticker) => (SPOT[ticker] ? sampleChain(ticker, SPOT[ticker].spot, SPOT[ticker].vol) : null));
}

const iso = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
export const util = (used: number, equity: number) => Math.round((used / equity) * 10_000);
export const money = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;

export function samplePortfolio(mode: 'confirm' | 'autonomous'): Snapshot {
  const s = fixtureSnapshot();
  s.config.mode = mode;
  const rule = (ref: string, venue: 'aster' | 'derive') => ({ ...defaultRule(venue, ref), triggerBps: 7000, targetBps: 4500, maxPerMoveBaseUnit: '500000000', dailyCapBaseUnit: '2000000000', minMoveBaseUnit: venue === 'derive' ? '7000000' : '6000000', cooldownSec: 600 });
  s.config.rebalance = { ...s.config.rebalance, enabled: true, rules: [rule('', 'aster'), rule('42', 'derive')], sources: ['bsc_usdc', 'sell_bstocks'], sellOrder: ['SPYB', 'AAPLB'], keepBscReserveBaseUnit: '10000000' };
  s.config.hedge = { enabled: true, driftThresholdPct: 5, sizing: 'loss_limit', news: { enabled: true }, legs: [
    { bstock: 'NVDAB', venue: 'aster', kind: 'perp', market: 'NVDA', hedgeRatio: 1 },
    { bstock: 'TSLAB', venue: 'aster', kind: 'perp', market: 'TSLA', hedgeRatio: 1 },
    { bstock: 'AAPLB', venue: 'aster', kind: 'perp', market: 'AAPL', hedgeRatio: 1 }] };
  s.config.risk = { ...s.config.risk, lossTolerancePct: 5, premiumBudgetWeeklyPct: 1 };
  s.config.events = [{ ticker: 'NVDA', at: iso(20), kind: 'earnings', gapPct: 12 }, { ticker: 'TSLA', at: iso(72), kind: 'earnings' }];
  s.health = {
    'aster:': { connected: true, utilBps: util(1400, 4000), accountUsd: 4000, usedUsd: 1400 },
    'derive:42': { connected: true, utilBps: util(860, 1000), accountUsd: 1000, usedUsd: 860 },
  };
  s.moved24hBase = { 'aster:': '0', 'derive:42': '0' };
  s.perpPositions = { ETH: 10, TSLA: -20 };                       // ETH long 10, TSLA short 20 (an existing hedge)
  s.perpMain = { equityUsd: 4000, freeUsd: 2600 };
  s.bsc = { usdcUsd: 400, usdtUsd: 250, allowanceUsdcBase: '350000000', bstocks: [
    { symbol: 'NVDAB', qty: 60, value: 12_000, allowanceQty: 0 }, { symbol: 'TSLAB', qty: 40, value: 10_000, allowanceQty: 0 },
    { symbol: 'AAPLB', qty: 50, value: 10_000, allowanceQty: 50 }, { symbol: 'SPYB', qty: 10, value: 5_000, allowanceQty: 10 }] };
  s.market = { sigmaDay: { NVDA: 0.032, TSLA: 0.042, AAPL: 0.016 }, at: new Date().toISOString() };
  s.hedgeProblems = []; s.perpEtaSec = 600; s.deriveEtaSec = 1800;
  s.heldPuts = [];
  s.deriveFree = { ref: '42', freeUsd: 140 };
  s.options = Object.fromEntries(Object.entries(SPOT).map(([t, v]) => [t, sampleChain(t, v.spot, v.vol)]));
  s.today = { notionalUsd: 0, lossUsd: 0, capitalOffBnbUsd: 4000 + 1000, pausedReason: null };
  return s;
}

/** Apply what the chosen action would have done to the portfolio, so the next tick sees the result. */
export function applyEffect(s: Snapshot, ch: Candidate): string {
  if (ch.kind === 'top_up') {
    const rk = ch.ruleKey!; const amt = Number(BigInt(ch.amountBaseUnit)) / 1e6; const h = s.health[rk];
    h.accountUsd = (h.accountUsd ?? 0) + amt; h.utilBps = util(h.usedUsd ?? 0, h.accountUsd);
    let note = '';
    for (const f of ch.funding ?? []) {
      if (f.source === 'bsc_usdc') { s.bsc.usdcUsd -= f.amountUsd; s.bsc.allowanceUsdcBase = String(Math.max(0, Number(s.bsc.allowanceUsdcBase) - Math.round(f.amountUsd * 1e6))); }
      else { const sym = f.source.replace('sell ', ''); const b = s.bsc.bstocks.find((x) => x.symbol === sym)!; const sold = Math.min(b.qty, (f.amountUsd / (1 - s.config.collateral.bstockHaircut)) / (b.value / b.qty)); const px = b.value / b.qty; b.qty -= sold; b.value -= sold * px; b.allowanceQty = Math.max(0, (b.allowanceQty ?? 0) - sold); note += ` ${sold.toFixed(3)} ${sym} sold.`; }
    }
    s.moved24hBase[rk] = String(BigInt(s.moved24hBase[rk] ?? '0') + BigInt(ch.amountBaseUnit));
    s.ruleState[rk] = { ...(s.ruleState[rk] ?? {}), lastMoveAt: new Date().toISOString() };
    s.today!.capitalOffBnbUsd += amt;
    if (rk.startsWith('derive:') && s.deriveFree) s.deriveFree = { ref: s.deriveFree.ref, freeUsd: Math.max(0, (h.accountUsd ?? 0) - (h.usedUsd ?? 0)) };
    return `${rk} utilization now ${(h.utilBps / 100).toFixed(0)}%.${note}`;
  }
  if (ch.kind === 'hedge') {
    const h = ch.hedge!; const mp = ch.plan?.marginPlan;
    if (mp) { s.bsc.usdcUsd -= mp.moveUsd; if (h.option) s.deriveFree = { ref: s.deriveFree?.ref ?? '42', freeUsd: (s.deriveFree?.freeUsd ?? 0) + mp.moveUsd }; else s.perpMain!.freeUsd += mp.moveUsd; }
    s.today!.notionalUsd += ch.notionalUsd ?? 0;
    if (h.option) {
      (s.heldPuts ??= []).push({ ticker: h.ticker ?? h.market, notionalUsd: h.option.notionalUsd, expiry: h.option.expiry });
      if (s.deriveFree) s.deriveFree = { ref: s.deriveFree.ref, freeUsd: Math.max(0, s.deriveFree.freeUsd - h.option.premiumUsd - h.option.feesUsd) };
      return `${h.option.contracts} ${h.market} puts held (strike ${h.option.strike}); premium paid on Derive.`;
    }
    s.perpPositions[h.market] = (s.perpPositions[h.market] ?? 0) - h.deltaToShort;
    if (h.deltaToShort > 0) s.perpMain!.freeUsd -= ch.plan?.cost.idleMarginUsd ?? 0;
    return `${h.market} short is now ${Math.abs(s.perpPositions[h.market]).toFixed(3)}.`;
  }
  return '';
}
