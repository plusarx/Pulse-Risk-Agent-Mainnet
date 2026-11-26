import { fixtureSnapshot } from '../fixtures';
import { sampleChain } from '../risk/options';
import type { Snapshot } from '../types';

// The spec's example portfolio, used only when the live data cannot be read (no wallet keys yet, venue down, agent API unreachable).
// The chat labels it clearly as sample data so nobody mistakes it for their accounts.
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const HOLD: [string, number, number][] = [['NVDAB', 100, 20_000], ['TSLAB', 60, 15_000], ['AAPLB', 75, 15_000]];
const MK: Record<string, { spot: number; sigma: number; put: number }> = { NVDA: { spot: 200, sigma: 0.032, put: 0.4 }, TSLA: { spot: 250, sigma: 0.042, put: 0.6 }, AAPL: { spot: 200, sigma: 0.016, put: 0.25 } };

export function sampleSnapshot(wallet: string, network: 'mainnet' | 'testnet'): Snapshot {
  const s = fixtureSnapshot({ health: {} }); s.wallet = wallet as never; s.network = network;
  s.config.rebalance.enabled = false; s.config.rebalance.sources = ['bsc_usdc']; s.config.rebalance.sellOrder = [];
  s.config.mode = 'confirm';
  s.config.hedge = { enabled: true, driftThresholdPct: 5, sizing: 'loss_limit', news: { enabled: false },
    legs: Object.entries(MK).map(([t, v]) => ({ bstock: `${t}B`, venue: 'aster', kind: 'perp', market: t, hedgeRatio: 1 })) as never };
  s.config.risk = { ...s.config.risk, lossTolerancePct: 5, premiumBudgetWeeklyPct: 1, fullyHedgeTickers: [], eventLeadHours: 24, proxyMap: {} };
  Object.assign(s.config.limits, { maxNotionalPerTradeUsd: 50_000, maxNotionalPerDayUsd: 100_000, maxLeverage: 3, dailyLossCapUsd: 1000, maxCapitalOffBnbUsd: 10_000, killSwitch: false });
  s.config.events = [{ ticker: 'NVDA', at: hours(18), kind: 'earnings', gapPct: 12 }];
  s.bsc = { usdcUsd: 3000, usdtUsd: 0, allowanceUsdcBase: '2500000000', bstocks: HOLD.map(([symbol, qty, value]) => ({ symbol, qty, value, allowanceQty: qty })) };
  s.perpPositions = {}; s.perpMain = { equityUsd: 0, freeUsd: 0 }; s.deriveFree = { ref: '42', freeUsd: 0 };
  s.perpEtaSec = 1200; s.deriveEtaSec = 1800; s.hedgeProblems = [];
  s.market = { sigmaDay: Object.fromEntries(Object.entries(MK).map(([t, v]) => [t, v.sigma])), at: new Date().toISOString() };
  s.proxyPrices = {};
  s.options = Object.fromEntries(Object.entries(MK).map(([t, v]) => [t, sampleChain(t, v.spot, v.put, new Date(), 500)]));
  s.today = { notionalUsd: 0, lossUsd: 0, capitalOffBnbUsd: 0, pausedReason: null };
  return s;
}
