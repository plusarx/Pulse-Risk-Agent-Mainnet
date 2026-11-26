import { config } from './config';
import { fixtureSnapshot } from './fixtures';
import { buildGraph } from './graph';
import { installSampleFeeds } from './sample';
import { sampleChain } from './risk/options';
import { buildStatus } from './status';
import * as app from './tools/appApi';
import { openStore } from './tools/store';

// Posts ONE confirmation-mode approval card to the running app for a real wallet, so the card can be checked in the UI
// (Why / What it does for you / the steps / the hedge plan with cost, VaR before and after, margin move and validity).
// Usage: npm run demo:card -- 0xYourWalletAddress
// The wallet is a $50k portfolio (NVDA $20k, TSLA $15k, AAPL $15k) with NVDA earnings in 18 hours, in "ask me first" mode.
// Dry run: nothing moves anywhere. Approve or decline the card on the Risk page; approving only simulates.
const wallet = process.argv[2];
if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) { console.error('Usage: npm run demo:card -- 0xYourWalletAddress'); process.exit(1); }
process.env.DRY_RUN = 'true'; process.env.POST_EVENTS = 'true';
openStore(':memory:');
const c = config();
installSampleFeeds();
const iso = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

const s = fixtureSnapshot({ wallet, network: c.AGENT_NETWORK, health: {} });
s.config.mode = 'confirm'; s.config.rebalance.enabled = false;
s.config.hedge = { enabled: true, driftThresholdPct: 5, sizing: 'loss_limit', news: { enabled: true }, legs: [
  { bstock: 'NVDAB', venue: 'aster', kind: 'perp', market: 'NVDA', hedgeRatio: 1 },
  { bstock: 'TSLAB', venue: 'aster', kind: 'perp', market: 'TSLA', hedgeRatio: 1 },
  { bstock: 'AAPLB', venue: 'aster', kind: 'perp', market: 'AAPL', hedgeRatio: 1 }] };
s.config.risk = { ...s.config.risk, lossTolerancePct: 5, premiumBudgetWeeklyPct: 1 };
s.config.limits.maxNotionalPerTradeUsd = 50_000; s.config.limits.maxNotionalPerDayUsd = 100_000;
s.config.events = [{ ticker: 'NVDA', at: iso(18), kind: 'earnings', gapPct: 12 }];
s.bsc = { usdcUsd: 3000, usdtUsd: 0, allowanceUsdcBase: '2500000000', bstocks: [
  { symbol: 'NVDAB', qty: 100, value: 20_000, allowanceQty: 100 }, { symbol: 'TSLAB', qty: 75, value: 15_000, allowanceQty: 75 }, { symbol: 'AAPLB', qty: 75, value: 15_000, allowanceQty: 75 }] };
s.perpPositions = {}; s.perpMain = { equityUsd: 0, freeUsd: 0 }; s.deriveFree = { ref: '42', freeUsd: 0 }; s.perpEtaSec = 1200; s.deriveEtaSec = 1800; s.hedgeProblems = [];
s.market = { sigmaDay: { NVDA: 0.032, TSLA: 0.042, AAPL: 0.016 }, at: new Date().toISOString() };
s.today = { notionalUsd: 0, lossUsd: 0, capitalOffBnbUsd: 0, pausedReason: null };
s.options = { NVDA: sampleChain('NVDA', 200, 0.4) };

console.log(`demo:card · wallet=${wallet} · network=${c.AGENT_NETWORK} · llm=${c.LLM_MODE} · app=${c.APP_API_URL}`);
const out = await buildGraph().invoke({ snapshot: s });
// Status is posted too, so the status panel is not "has not reported yet" while the activity feed shows a run.
await app.postStatus(buildStatus(s, { news: out.news, newsAt: out.newsAt })).catch((e) => console.warn(`status post failed: ${e instanceof Error ? e.message : String(e)}`));
if (out.outcome === 'awaiting') console.log(`outcome=awaiting\n${out.message}\nOpen the Risk page: the approval card is waiting there.`);
else { console.error(`The approval card was NOT posted. outcome=${out.outcome}\n${out.message}${out.detail ? `\nTechnical detail: ${out.detail}` : ''}`); process.exit(1); }
