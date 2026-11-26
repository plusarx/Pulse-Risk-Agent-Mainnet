import { fixtureSnapshot } from './fixtures';
import { config } from './config';
import { buildGraph } from './graph';
import { setTextFetcher } from './news';
import { buildStatus } from './status';
import { memoryActions, setActionsBackend } from './tools/appApi';
import { runApproved } from './tools/approved';
import { closeStore, openStore } from './tools/store';
import type { Snapshot } from './types';

// Runs the agent on the build spec's scenarios and prints each input table and what the agent did.
//   npm run demo:modes                 real LLM on every node, canned news
//   npm run demo:modes -- --live-news  real headlines from Google News / Yahoo Finance
// Dry run: nothing is signed or sent. Confirmation requests go to an in-memory inbox here.
process.env.DRY_RUN = 'true'; process.env.POST_EVENTS = 'false';
const liveNews = process.argv.includes('--live-news');
const c = config();
console.log(`models: decider=${c.LLM_MODEL_DECIDER} news=${c.LLM_MODEL_NEWS_ANALYST} · llm=${c.LLM_MODE} · news=${liveNews ? 'LIVE web' : 'canned test headlines'}\n`);

const rss = (items: { t: string; src: string; ago: number }[]) => `<rss><channel>${items.map((i) => `<item><title>${i.t}</title><link>http://x/${encodeURIComponent(i.t)}</link><pubDate>${new Date(Date.now() - i.ago * 3_600_000).toUTCString()}</pubDate><source>${i.src}</source></item>`).join('')}</channel></rss>`;
const TSLA_BAD = rss([
  { t: 'Tesla recalls 400,000 vehicles after federal safety probe', src: 'Reuters', ago: 2 },
  { t: 'Tesla shares plunge as quarterly deliveries miss estimates', src: 'Bloomberg', ago: 4 },
  { t: 'Regulators open new investigation into Tesla driver-assist software', src: 'WSJ', ago: 6 },
]);
if (!liveNews) setTextFetcher(async (u) => (u.includes('TSLA') || u.includes('Tesla') ? TSLA_BAD : '<rss/>'));

const iso = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
/** The spec's $50k portfolio: $20k NVDA, $15k TSLA, $15k AAPL as bStocks; 5% loss tolerance; NVDA reports in 18 hours. */
function book(mode: 'confirm' | 'autonomous'): Snapshot {
  const s = fixtureSnapshot({ health: { 'aster:': { connected: true, utilBps: 3000, accountUsd: 500, usedUsd: 150 } } });
  s.config.mode = mode; s.config.rebalance.sellOrder = ['NVDAB', 'TSLAB', 'AAPLB'];
  s.config.hedge = { enabled: true, driftThresholdPct: 5, sizing: 'loss_limit', news: { enabled: true }, legs: [
    { bstock: 'NVDAB', venue: 'aster', kind: 'perp', market: 'NVDA', hedgeRatio: 1 },
    { bstock: 'TSLAB', venue: 'aster', kind: 'perp', market: 'TSLA', hedgeRatio: 1 },
    { bstock: 'AAPLB', venue: 'aster', kind: 'perp', market: 'AAPL', hedgeRatio: 1 }] };
  s.config.risk = { ...s.config.risk, lossTolerancePct: 5, premiumBudgetWeeklyPct: 1 };
  s.config.events = [{ ticker: 'NVDA', at: iso(18), kind: 'earnings', gapPct: 12 }];
  s.bsc = { usdcUsd: 3000, usdtUsd: 0, allowanceUsdcBase: '2500000000', bstocks: [
    { symbol: 'NVDAB', qty: 100, value: 20_000, allowanceQty: 100 }, { symbol: 'TSLAB', qty: 60, value: 15_000, allowanceQty: 60 }, { symbol: 'AAPLB', qty: 75, value: 15_000, allowanceQty: 75 }] };
  s.perpPositions = {}; s.perpMain = { equityUsd: 500, freeUsd: 350 }; s.perpEtaSec = 600; s.hedgeProblems = [];
  s.market = { sigmaDay: { NVDA: 0.032, TSLA: 0.042, AAPL: 0.016 }, at: new Date().toISOString() };
  s.today = { notionalUsd: 0, lossUsd: 0, capitalOffBnbUsd: 500, pausedReason: null };
  return s;
}

const show = (title: string, input: Record<string, string>) => { console.log(`\n══ ${title} ══\nINPUT`); console.table(input); };
const box = (label: string, text: string | undefined) => console.log(`${label}:\n  ${text ?? '-'}\n`);

async function run(snap: Snapshot, memo?: ReturnType<typeof memoryActions>) {
  openStore(':memory:');
  const r = await buildGraph().invoke({ snapshot: snap });
  const risk = r.risk;
  if (risk) {
    console.log('PORTFOLIO RISK (computed by code)');
    console.table(Object.fromEntries(risk.tickers.map((t) => [t.ticker, { 'value $': Math.round(t.usd), 'daily vol %': +(t.sigmaDay * 100).toFixed(1), 'hedged %': t.hedgedPct, bucket: t.bucket, 'event gap %': t.gap ? Math.round(t.gap * 100) : '-' }])));
    console.table({ Window: risk.window, 'Your loss limit': `${risk.limitPct}%`, '99% loss, no hedge': `${(risk.solution.varUnhedged * 100).toFixed(1)}%`, 'Hedge needed (1 - L/VaR)': `${(risk.solution.requiredHedgeRatio * 100).toFixed(1)}%`, '99% loss after hedging': `${(risk.solution.varAfter * 100).toFixed(1)}%`, 'Limit reachable': String(risk.solution.feasible) });
  }
  console.table({
    'Candidates this tick': r.candidates.map((x) => x.id).join(', ') || 'none',
    'Chosen': r.chosen ? r.chosen.explain.slice(0, 120) : 'none', Decider: r.decision?.action ?? '-', Reviewer: r.review?.verdict ?? '-', Outcome: r.outcome,
  });
  const flags = r.news.filter((n) => n.flagged);
  for (const n of flags) box(`NEWS FLAG (advisory only, ${n.by})`, `${n.ticker}: ${n.sentiment}, score ${n.score}, confidence ${n.confidence}. ${n.reason}\n  Headline: ${n.keyHeadlines[0] ?? n.headlines[0]?.title}`);
  box('Decider reason', r.decision?.reason); box('Reviewer reason', r.review?.reason);
  box('Message to the user', r.message || r.note);
  if (memo?.rows.length) {
    const a = memo.rows[memo.rows.length - 1];
    console.log('APPROVAL CARD IN THE APP'); console.table({ Title: a.title, Why: a.why.slice(0, 220), 'What it helps': a.helps.slice(0, 220), 'On approve': a.willDo.join(' → ') });
    if (a.plan) {
      const p = a.plan;
      console.table({ Instrument: `${p.instrument}, $${p.sizeUsd} at ${p.leverage}x`, 'Hedged now': `direct ${p.coverage.directPct}%, proxy ${p.coverage.proxyPct}%, none ${p.coverage.nonePct}%`, Cost: `fees $${p.cost.feesUsd}, margin tied up $${p.cost.idleMarginUsd}, weekly budget $${p.cost.weeklyBudgetUsd}`, Effect: `99% loss ${p.varBeforePct}% → ${p.varAfterPct}% (limit ${p.limitPct}%, ${p.window})`, 'Margin plan': p.marginPlan ? `move $${p.marginPlan.moveUsd} ${p.marginPlan.from} → ${p.marginPlan.to}, about ${Math.round(p.marginPlan.etaSec / 60)} min` : 'none needed', 'Valid until': p.validUntil.slice(11, 16) + ' UTC', 'Worst case': p.worstCase.slice(0, 160), Residual: p.residual.slice(0, 160) });
    }
  }
  closeStore(); return r;
}

// 1. The spec's pre-earnings hedge in confirmation mode: sized from the loss limit, asks, user approves, agent acknowledges.
{
  const memo = memoryActions(); setActionsBackend(memo.backend);
  show('1. PRE-EARNINGS HEDGE, CONFIRMATION MODE', { Portfolio: '$50,000 bStocks: NVDA $20k, TSLA $15k, AAPL $15k', 'Loss you accept': '5% over the event', 'Next event': 'NVDA earnings in 18h (12% gap assumed)', 'Daily vol': 'NVDA 3.2%, TSLA 4.2%, AAPL 1.6%', 'Perps margin': '$350 free', 'BNB wallet': '$3,000 USDC', Mode: 'Ask me first' });
  await run(book('confirm'), memo);
  if (memo.rows.length) {
    console.log('>> user clicks Approve in the app'); memo.approve(memo.rows[0].id);
    openStore(':memory:'); await runApproved(book('confirm')); closeStore();
    const a = memo.rows[0]; console.log('AGENT ACKNOWLEDGEMENT'); console.table({ Status: a.status, Message: a.result_message });
  }
  setActionsBackend();
}

// 2. Margin top-up paid by SELLING a bStock (wallet has no stables).
{
  show('2. MARGIN TOP-UP FROM A SOLD bStock', { 'Perps account': '$100, $82 used = 82% (trigger 70%)', 'BNB stables': '$0', 'bStock held': 'SPYB 1 unit = $500, allowance to the agent 1 unit', 'Counted at': '70% of value (30% haircut)', Mode: 'Autonomous' });
  const s = fixtureSnapshot({ bsc: { usdcUsd: 0, usdtUsd: 0, bstocks: [{ symbol: 'SPYB', qty: 1, value: 500, allowanceQty: 1 }], allowanceUsdcBase: '0' } });
  s.config.rebalance.sources = ['sell_bstocks']; s.config.rebalance.sellOrder = ['SPYB'];
  const r = await run(s);
  console.log('STEPS (dry run)'); console.table(r.steps.map((x) => ({ step: x.step.slice(0, 150), status: x.status })));
}

// 3. Bad Tesla news: a flag only. The hedge plan is the same as without news.
{
  show('3. NEWS FLAG: bad Tesla news (advisory only)', { Portfolio: 'same $50k book', 'News switch': 'on', Headlines: 'recall + deliveries miss + new investigation', 'What news may do': 'raise a flag. It cannot size or place a trade.', Mode: 'Autonomous' });
  const s = book('autonomous'); s.config.events = [];
  const r = await run(s);
  console.log('STATUS THE APP SHOWS'); const st = buildStatus(s, { news: r.news, newsAt: r.newsAt });
  console.table({ Mode: st.mode, 'Hedged now': `${st.hedgedPct}% (needs ${st.requiredHedgePct}%)`, 'Modelled loss vs limit': `${st.varPct}% vs ${st.limitPct}%`, 'News flags': st.newsFlags.map((f) => `${f.ticker} ${f.sentiment}`).join(', ') || 'none', 'Cannot see': st.notMonitored[0] });
}

// 4. Limits: the kill switch and a per-trade cap.
{
  show('4. YOUR LIMITS: kill switch, then a $500 per-trade cap', { Portfolio: 'same $50k book', 'Kill switch': 'ON (first run)', 'Max notional per trade': '$500 (second run)', Mode: 'Autonomous' });
  const a = book('autonomous'); a.config.limits.killSwitch = true;
  const r1 = await run(a);
  console.log('Refused:', r1.rejected.map((x) => x.reason).filter((x) => /kill switch/.test(x))[0] ?? 'none');
  const b = book('autonomous'); b.config.limits.maxNotionalPerTradeUsd = 500;
  const r2 = await run(b);
  console.log('Refused:', r2.rejected.map((x) => x.reason).filter((x) => /notional/.test(x))[0] ?? 'none');
}
