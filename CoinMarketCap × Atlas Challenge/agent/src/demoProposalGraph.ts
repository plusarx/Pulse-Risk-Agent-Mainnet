import { config } from './config';
import { buildProposalGraph, setProposalSubmitter } from './graph/proposal';
import { openStore } from './tools/store';

// Runs the proposal LangGraph on the build spec's scenario; prints the input table, output table and text.
// Usage: npm run demo:graph [-- --post 0xWallet]   (without --post nothing is sent to the app)
openStore(':memory:');
const postIdx = process.argv.indexOf('--post');
const wallet = postIdx > 0 ? process.argv[postIdx + 1] : '0x1111111111111111111111111111111111111111';
if (postIdx < 0) setProposalSubmitter(null);
const market = { vol1h: 0.041, latencySec: 18, leverage: 12, utilNow: 0.55, equityUsd: 10_000, usedUsd: 5_500, bnbStablesUsd: 0, bstocksAfterHaircutUsd: 7_000 };
const input = { wallet, network: config().AGENT_NETWORK, account: { venue: 'aster' as const, accountRef: '', equityUsd: 10_000, usedUsd: 5_500, positions: [{ symbol: 'ETH', valueUsd: 66_000 }] }, market };
console.log(`models: risk_analyst=${config().LLM_MODEL_RISK_ANALYST} llm=${config().LLM_MODE}\n`);
console.log('INPUT');
console.table({
  'Venue / account': 'Perps account', 'Position': 'ETH $66,000', 'Account value': '$10,000', 'Margin used': '$5,500', 'Utilization now': '55%', 'Leverage': '12x',
  'Realised 1h volatility': '4.1%', 'Top-up latency': '18 s', 'Agent check interval': `${config().TICK_INTERVAL_SEC} s`, 'BNB stables': '$0', 'bStocks (after haircut)': '$7,000',
});
const out = await buildProposalGraph().invoke({ input });
if (out.status === 'error') { console.log('STOPPED (fail closed):', out.note); process.exit(1); }
const r = out.proposal!.proposed_rule;
console.log('\nOUTPUT');
console.table({ 'Top up above': `${Math.round(r.top_up_trigger * 100)}%`, 'Restore to': `${Math.round(r.restore_target * 100)}%`, 'Release below': `${Math.round(r.release_trigger * 100)}%`, 'Pay from': r.primary_source, 'Needs human approval': 'yes' });
console.log('\nstructural_risk:\n ', out.proposal!.structural_risk, '\n\nreasoning:\n ', out.proposal!.reasoning, '\n\nstatus:', out.status, '-', out.note);
console.log('\nmetrics:', JSON.stringify(out.proposal!.metrics));
