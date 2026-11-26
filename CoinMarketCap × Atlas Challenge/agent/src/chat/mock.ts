import { z } from 'zod';
import { fixtureSnapshot } from '../fixtures';
import { sampleChain } from '../risk/options';
import type { Snapshot } from '../types';

// A mock portfolio the chat can describe in words ("I hold $70k NVDA and $30k AAPL, NVDA reports tomorrow, budget $1,000") and hand to the
// hedging agent as a test. It covers every setting in the ten test cases: holdings, balances, perps positions, events, news, caps, kill
// switch, a realised loss, a missing price, proxies, venue minimums, put chain depth. Anything not given uses the defaults from the test
// inputs document. The mock never touches the user's real data and nothing in it is ever sent anywhere.
interface Mk { spot: number; sigma: number; perp: boolean; put: number | null }
/** The market table every test case uses: spot, daily volatility, whether a perp is listed, Derive put implied volatility (null = none). */
export const MARKETS: Record<string, Mk> = {
  NVDA: { spot: 200, sigma: 0.032, perp: true, put: 0.4 }, TSLA: { spot: 250, sigma: 0.042, perp: true, put: 0.6 }, AAPL: { spot: 200, sigma: 0.016, perp: true, put: 0.25 },
  MSFT: { spot: 400, sigma: 0.015, perp: true, put: null }, AMZN: { spot: 180, sigma: 0.02, perp: true, put: 0.32 }, META: { spot: 500, sigma: 0.024, perp: false, put: 0.38 },
  COIN: { spot: 250, sigma: 0.05, perp: true, put: null }, MSTR: { spot: 300, sigma: 0.06, perp: false, put: null }, SPY: { spot: 600, sigma: 0.01, perp: true, put: 0.16 },
  QQQ: { spot: 500, sigma: 0.013, perp: true, put: null }, XOM: { spot: 110, sigma: 0.016, perp: false, put: null }, JPM: { spot: 220, sigma: 0.014, perp: false, put: null },
  XAU: { spot: 4000, sigma: 0.011, perp: true, put: 0.18 },
};

const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const tk = z.string().regex(/^[A-Z]{1,8}$/);
export const MockPortfolio = z.object({
  holdings: z.array(z.object({ ticker: tk, valueUsd: num(0, 1e9) })).min(1).max(12).describe('bStocks held on BNB: ticker without the trailing B, and its dollar value'),
  mode: z.enum(['confirm', 'autonomous']).default('confirm'),
  lossLimitPct: num(0.1, 50).default(5),
  weeklyBudgetUsd: num(0, 10_000_000).optional().describe('weekly protection budget in dollars; default 1% of the portfolio'),
  maxPerTradeUsd: num(0, 10_000_000).default(50_000), maxPerDayUsd: num(0, 100_000_000).default(100_000),
  maxLeverage: num(1, 10).default(3), maxCapitalOffBnbUsd: num(0, 100_000_000).default(10_000), dailyLossCapUsd: num(0, 100_000_000).default(1_000),
  killSwitch: z.boolean().default(false), realizedLossTodayUsd: num(0, 1e9).default(0),
  bnb: z.object({ usdc: num(0, 1e9).default(3_000), usdt: num(0, 1e9).default(0), allowanceUsdc: num(0, 1e9).default(2_500) }).default({}),
  perps: z.object({ equityUsd: num(0, 1e9).default(0), freeUsd: num(0, 1e9).optional(), shorts: z.record(tk, num(0, 1e9)).default({}).describe('open perps short per ticker, in units') }).default({}),
  deriveFreeUsd: num(0, 1e9).default(0),
  events: z.array(z.object({ ticker: tk, hoursAhead: num(0.01, 720), gapPct: num(0.1, 80).optional() })).max(12).default([]),
  news: z.array(z.object({ ticker: tk, title: z.string().min(3).max(240), source: z.string().max(60).default('Reuters'), hoursAgo: num(0, 72).default(3) })).max(12).default([]),
  alwaysHedge: z.array(tk).max(12).default([]), neverHedge: z.array(tk).max(12).default([]),
  proxies: z.record(tk, z.object({ via: tk, beta: num(0, 1) })).default({}).describe('hedge a name with no market through another name, e.g. MSTR via COIN beta 0.7'),
  putChainDepth: z.record(tk, z.number().int().min(1).max(100_000)).default({}).describe('contracts available per underlying; default 500'),
  venueMinimum: z.boolean().default(false).describe('true applies the 0.025 unit and $5 minimum order'),
  missingPriceFor: tk.optional().describe('simulate the venue feed having no price for this ticker'),
  market: z.record(tk, z.object({ spot: num(0.01, 1e7), sigmaDay: num(0.001, 0.5), hasPerp: z.boolean().optional(), putIv: num(0.01, 5).nullable().optional() })).default({}).describe('market data override for a ticker that is not in the table'),
});
export type MockPortfolio = z.infer<typeof MockPortfolio>;

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
export const NEWS_PRESENT = (m: MockPortfolio) => m.news.length > 0;

export function mockMarkets(m: MockPortfolio): { mk: Record<string, Mk>; missing: string[] } {
  const mk: Record<string, Mk> = {}; const missing: string[] = [];
  const tickers = new Set([...m.holdings.map((h) => h.ticker), ...Object.keys(m.perps.shorts), ...Object.values(m.proxies).map((p) => p.via)]);
  for (const t of tickers) {
    const o = m.market[t]; const base = MARKETS[t];
    if (o) mk[t] = { spot: o.spot, sigma: o.sigmaDay, perp: o.hasPerp !== undefined ? o.hasPerp : base?.perp ?? false, put: o.putIv !== undefined ? o.putIv : base?.put ?? null };
    else if (base) mk[t] = base; else missing.push(t);
  }
  return { mk, missing };
}

/** A snapshot of the mock portfolio, shaped exactly like the one the live collector builds, so the real hedging graph runs on it unchanged. */
export function buildMockSnapshot(m: MockPortfolio, wallet = '0x1111111111111111111111111111111111111111', network: 'mainnet' | 'testnet' = 'mainnet'): Snapshot {
  const { mk, missing } = mockMarkets(m);
  if (missing.length) throw new Error(`No market data for ${missing.join(', ')}. Known tickers: ${Object.keys(MARKETS).join(', ')}. For another ticker give spot, sigmaDay and hasPerp in "market".`);
  const total = m.holdings.reduce((a, h) => a + h.valueUsd, 0) || 1;
  const s = fixtureSnapshot({ health: {} }); s.wallet = wallet as never; s.network = network;
  s.config.rebalance.enabled = false; s.config.rebalance.sources = ['bsc_usdc']; s.config.rebalance.sellOrder = [];
  s.config.mode = m.mode; if (m.mode === 'autonomous') s.config.limits.autonomyExpiresAt = hours(24);
  const perpLegs = Object.entries(mk).filter(([, v]) => v.perp).map(([t]) => ({ bstock: `${t}B`, venue: 'aster', kind: 'perp', market: t, hedgeRatio: 1 }));
  const putOnly = m.holdings.filter((h) => !mk[h.ticker].perp && mk[h.ticker].put !== null).map((h) => ({ bstock: `${h.ticker}B`, venue: 'derive', kind: 'put', market: h.ticker, hedgeRatio: 1, put: { strikePct: 100, minDaysToExpiry: 2, targetDaysToExpiry: 7 } }));
  s.config.hedge = { enabled: true, driftThresholdPct: 5, sizing: 'loss_limit', news: { enabled: m.news.length > 0 }, legs: [...perpLegs, ...putOnly] as never };
  s.config.risk = { ...s.config.risk, lossTolerancePct: m.lossLimitPct, premiumBudgetWeeklyPct: ((m.weeklyBudgetUsd ?? total * 0.01) / total) * 100, fullyHedgeTickers: m.alwaysHedge, excludeTickers: m.neverHedge, eventLeadHours: 24, proxyMap: m.proxies };
  Object.assign(s.config.limits, { maxNotionalPerTradeUsd: m.maxPerTradeUsd, maxNotionalPerDayUsd: m.maxPerDayUsd, maxLeverage: m.maxLeverage, dailyLossCapUsd: m.dailyLossCapUsd, maxCapitalOffBnbUsd: m.maxCapitalOffBnbUsd, killSwitch: m.killSwitch });
  s.config.events = m.events.map((e) => ({ ticker: e.ticker, at: hours(e.hoursAhead), kind: 'earnings' as const, ...(e.gapPct !== undefined ? { gapPct: e.gapPct } : {}) }));
  s.bsc = { usdcUsd: m.bnb.usdc, usdtUsd: m.bnb.usdt, allowanceUsdcBase: String(Math.round(m.bnb.allowanceUsdc * 1e6)),
    bstocks: m.holdings.map((h) => ({ symbol: `${h.ticker}B`, qty: h.valueUsd / mk[h.ticker].spot, value: h.valueUsd, allowanceQty: h.valueUsd / mk[h.ticker].spot })) };
  s.perpPositions = Object.fromEntries(Object.entries(m.perps.shorts).filter(([t]) => mk[t]?.perp).map(([t, u]) => [t, -u]));
  s.perpMain = { equityUsd: m.perps.equityUsd, freeUsd: m.perps.freeUsd ?? m.perps.equityUsd }; s.deriveFree = { ref: '42', freeUsd: m.deriveFreeUsd };
  s.perpEtaSec = 1200; s.deriveEtaSec = 1800; s.hedgeProblems = [];
  const viaTickers = Object.values(m.proxies).map((p) => p.via);
  s.market = { sigmaDay: Object.fromEntries([...m.holdings.map((h) => h.ticker), ...viaTickers].filter((t) => t !== m.missingPriceFor).map((t) => [t, mk[t].sigma])), at: new Date().toISOString() };
  s.proxyPrices = Object.fromEntries(viaTickers.map((t) => [t, mk[t].spot]));
  if (m.missingPriceFor) s.unassessed = { [m.missingPriceFor]: 'no price from the venue feed' };
  s.options = Object.fromEntries(m.holdings.map((h) => h.ticker).filter((t) => mk[t].put !== null && t !== m.missingPriceFor).map((t) => [t, sampleChain(t, mk[t].spot, mk[t].put!, new Date(), m.putChainDepth[t] ?? 500)]));
  if (m.venueMinimum) s.marketMins = Object.fromEntries(perpLegs.map((l) => [l.market, { minBase: 0.025, step: 0.001, minNotionalUsd: 5 }]));
  s.today = { notionalUsd: 0, lossUsd: m.realizedLossTodayUsd, capitalOffBnbUsd: 0, pausedReason: null };
  return s;
}

/** The mock as plain sentences, for the answer to show what was tested. */
export function describeMock(m: MockPortfolio): string[] {
  const total = m.holdings.reduce((a, h) => a + h.valueUsd, 0); const d = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  return [
    `${d(total)} portfolio: ${m.holdings.map((h) => `${h.ticker} ${d(h.valueUsd)}`).join(', ')}`,
    `${m.mode === 'autonomous' ? 'Autonomous' : 'Ask me first'}; loss limit ${m.lossLimitPct}%; weekly budget ${d(m.weeklyBudgetUsd ?? total * 0.01)}; max ${d(m.maxPerTradeUsd)} per trade, ${d(m.maxPerDayUsd)} per day`,
    `BNB USDC ${d(m.bnb.usdc)} (allowance ${d(m.bnb.allowanceUsdc)}); perps equity ${d(m.perps.equityUsd)}; Derive free ${d(m.deriveFreeUsd)}`,
    ...(Object.keys(m.perps.shorts).length ? [`Open perps shorts: ${Object.entries(m.perps.shorts).map(([t, u]) => `${t} ${u}`).join(', ')}`] : []),
    ...(m.events.length ? [`Events: ${m.events.map((e) => `${e.ticker} in ${e.hoursAhead}h${e.gapPct ? ` (${e.gapPct}% gap)` : ''}`).join(', ')}`] : []),
    ...(m.killSwitch ? ['Kill switch ON'] : []), ...(m.realizedLossTodayUsd ? [`Realised loss today ${d(m.realizedLossTodayUsd)}`] : []), ...(m.missingPriceFor ? [`No price feed for ${m.missingPriceFor}`] : []),
  ];
}
