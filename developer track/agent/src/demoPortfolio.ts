import { config } from './config';
import { buildGraph } from './graph';
import { applyEffect, installSampleFeeds, money, samplePortfolio } from './sample';
import { buildStatus } from './status';
import { memoryActions, setActionsBackend } from './tools/appApi';
import { closeStore, openStore } from './tools/store';

// One realistic test portfolio across perps, Derive and bStocks, with news, run through the real agent graph tick
// by tick (dry run). After each tick the chosen action's effect is applied to the portfolio so the next tick sees it.
//   npm run demo:portfolio                   autonomous mode
//   npm run demo:portfolio -- --confirm      confirmation mode: every action is approved automatically, as if you clicked Approve
process.env.DRY_RUN = 'true'; process.env.POST_EVENTS = 'false';
const confirmMode = process.argv.includes('--confirm');
const c = config();
console.log(`models: decider=${c.LLM_MODEL_DECIDER} · llm=${c.LLM_MODE} · mode=${confirmMode ? 'ask first (auto-approved here)' : 'autonomous'} · news=canned test headlines\n`);

installSampleFeeds();
const portfolio = () => samplePortfolio(confirmMode ? 'confirm' : 'autonomous');
const snap0 = portfolio();

console.log('══ INPUT: the test portfolio ══');
console.log('\n1. PERPS');
console.table({
  'Main account': `equity ${money(4000)}, margin used ${money(1400)} (35%), free ${money(2600)}`,
  'Main positions': 'ETH long 10 (about $30,000), TSLA short 20 (about $5,000, an existing hedge)',
});
console.log('2. DERIVE');
console.table({
  'Subaccount 42 (PRIME)': `collateral ${money(1000)}, margin used ${money(860)} (86%), rule: top up above 70%`,
  'Open options (listed, not used by the agent yet)': 'SPY 1-week put x5, NVDA call spread x2',
});
console.log('3. bSTOCKS ON BNB CHAIN');
console.table(snap0.bsc.bstocks.map((b) => ({ bStock: b.symbol, units: b.qty, 'value $': b.value, 'daily vol %': { NVDAB: 3.2, TSLAB: 4.2, AAPLB: 1.6, SPYB: 'no perp market' }[b.symbol], 'may sell': snap0.config.rebalance.sellOrder.includes(b.symbol) ? `yes (allowance ${b.allowanceQty} units)` : 'no', 'hedge market': { NVDAB: 'NVDA-PERP', TSLAB: 'TSLA-PERP', AAPLB: 'AAPL-PERP', SPYB: 'none' }[b.symbol] })));
console.log('4. BNB WALLET');
console.table({ USDC: money(400), USDT: `${money(250)} (not usable: no allowance check yet)`, 'USDC allowance to agent': money(350), 'Reserve kept': money(10) });
console.log('5. YOUR RULES AND LIMITS');
console.table({ Mode: snap0.config.mode, 'Loss you accept': '5% (day or event)', 'Weekly protection budget': '1% of portfolio', 'Max per trade / per day': '$5,000 / $20,000', 'Max leverage': '3x', 'Daily loss cap': '$1,000', 'Max capital off BNB': '$10,000', 'Funding order': 'USDC first, then sell SPYB, AAPLB', 'Events': 'NVDA earnings in 20h (12% gap), TSLA earnings in 72h' });
console.log('6. NEWS (test headlines)');
console.table({ TSLA: 'recall; deliveries miss; new investigation (all bad)', NVDA: 'earnings beat; analyst upgrade (all good)', AAPL: 'no headlines' });

openStore(':memory:');
const memo = memoryActions(); setActionsBackend(memo.backend);   // anything that needs your approval lands here
const s = portfolio(); const before = buildStatus(s);
console.log('\n══ WHAT THE AGENT DOES, TICK BY TICK ══');
const rows: Record<string, unknown>[] = [];
for (let tick = 1; tick <= 8; tick++) {
  const r = await buildGraph().invoke({ snapshot: s });
  if (tick === 1) {
    if (r.risk) console.table({ 'Portfolio': money(r.risk.portfolioUsd), 'Window': r.risk.window, '99% loss now': `${(r.risk.solution.varNow * 100).toFixed(1)}%`, 'Your limit': `${r.risk.limitPct}%`, 'Hedge needed': `${(r.risk.solution.requiredHedgeRatio * 100).toFixed(1)}%` });
    const flags = r.news.filter((n) => n.flagged).map((n) => `${n.ticker} ${n.sentiment} (${n.score})`).join(', ') || 'none';
    console.log(`News flags (advisory only): ${flags}\n`);
  }
  const chosen = r.chosen; let outcome: string = r.outcome;
  const asked = r.outcome === 'awaiting' && memo.rows.length ? memo.rows[memo.rows.length - 1] : null;
  if (asked && confirmMode) { memo.approve(asked.id); outcome = 'asked, then approved by you'; }
  else if (asked) outcome = 'WAITING FOR YOUR APPROVAL';
  const eff = chosen && (r.outcome === 'simulated' || (asked && confirmMode)) ? applyEffect(s, chosen) : '';
  rows.push({ tick, 'candidates': r.candidates.map((x) => x.id.split(':').slice(0, 2).join(':')).join(', ') || 'none', 'agent chose': chosen ? (chosen.kind === 'hedge' ? `hedge ${chosen.hedge!.deltaToShort > 0 ? 'sell' : 'buy'} ${Math.abs(chosen.hedge!.deltaToShort)} ${chosen.hedge!.market}` : `${chosen.kind} $${(Number(BigInt(chosen.amountBaseUnit)) / 1e6).toFixed(2)} on ${chosen.ruleKey}`) : 'nothing', outcome, 'then': eff });
  console.log(`tick ${tick}: ${chosen ? chosen.explain.slice(0, 150) : 'nothing to do'}`);
  if (r.decision?.reason) console.log(`   why: ${r.decision.reason.slice(0, 260)}`);
  if (r.rejected.length) { const blocked = r.rejected.filter((x) => !/within|no action|waiting|below|not met|dwell/i.test(x.reason)).map((x) => `${x.kind}: ${x.reason}`).slice(0, 3); if (blocked.length) console.log(`   not done: ${blocked.join(' | ')}`); }
  if (!chosen || (asked && !confirmMode) || (r.outcome !== 'simulated' && !asked)) break;
}
console.log('\nSEQUENCE'); console.table(rows);
const after = buildStatus(s);
console.log('BEFORE vs AFTER');
console.table({
  'Perps utilization': { before: '35%', after: `${(s.health['aster:'].utilBps! / 100).toFixed(0)}%` },
  'Derive 42 utilization': { before: '86%', after: `${(s.health['derive:42'].utilBps! / 100).toFixed(0)}%` },
  'BNB USDC': { before: money(400), after: money(s.bsc.usdcUsd) },
  'SPYB / AAPLB units free': { before: '10 / 50', after: `${s.bsc.bstocks.find((b) => b.symbol === 'SPYB')!.qty.toFixed(2)} / ${s.bsc.bstocks.find((b) => b.symbol === 'AAPLB')!.qty.toFixed(2)}` },
  'Hedged % of portfolio': { before: `${before.hedgedPct}%`, after: `${after.hedgedPct}%` },
  '99% loss vs your 5% limit': { before: `${before.varPct}%`, after: `${after.varPct}%` },
});
if (after.alerts.length) { console.log('ALERTS THE APP SHOWS'); for (const a of after.alerts) console.log(` - ${a}`); }
closeStore(); setActionsBackend();
