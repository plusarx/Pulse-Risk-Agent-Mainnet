import { config } from './config';
import { buildGraph } from './graph';
import { ACTION_SCENARIOS, PROPOSAL_SCENARIOS } from './scenarios';
import { fitRule } from './proposal/compute';
import { fetchCloses, realizedVol1h } from './tools/metrics';
import { buildProposal } from './proposal/propose';
import { postProposal } from './tools/appApi';
import { openStore, closeStore } from './tools/store';
import { memoryActions, setActionsBackend } from './tools/appApi';

// Runs every scenario and prints a pass/fail table.
//   npm run scenarios                         deterministic (no LLM), nothing leaves this machine
//   npm run scenarios -- --llm                the real LLM nodes decide (uses OpenRouter)
//   npm run scenarios -- --real               use REAL realised 1h volatility from the perps venue instead of made-up numbers
//   npm run scenarios -- --ui 0xWallet        also push each dry-run result into that wallet's Activity feed
//   npm run scenarios -- --ui 0xWallet --proposal "calm market"   also submit that proposal scenario for approval
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const val = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const wallet = val('--ui');
if (wallet && !/^0x[0-9a-fA-F]{40}$/.test(wallet)) { console.error('--ui needs a wallet address'); process.exit(1); }

process.env.DRY_RUN = 'true';
process.env.POST_EVENTS = wallet ? 'true' : 'false';
if (!flag('--llm')) process.env.LLM_MODE = 'off';
const c = config();
console.log(`scenarios · llm=${c.LLM_MODE} · network=${c.AGENT_NETWORK} · ${wallet ? `pushing to ${wallet}` : 'local only'}\n`);

let failed = 0;
const row = (ok: boolean, name: string, detail: string) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} ${detail}`); };

setActionsBackend(memoryActions().backend);   // confirmation requests go to an in-memory inbox here
console.log('ACTIONS');
const graph = buildGraph();
for (const s of ACTION_SCENARIOS) {
  openStore(':memory:'); setActionsBackend(memoryActions().backend);   // a fresh inbox per scenario
  const snap = s.snapshot(); if (wallet) { snap.wallet = wallet; snap.network = c.AGENT_NETWORK; }
  const out = await graph.invoke({ snapshot: snap });
  const e = s.expect; const problems: string[] = [];
  if (out.outcome !== e.outcome) problems.push(`outcome ${out.outcome}, wanted ${e.outcome}`);
  if (e.kind && out.chosen?.kind !== e.kind) problems.push(`kind ${out.chosen?.kind ?? 'none'}, wanted ${e.kind}`);
  if (e.rejected && !out.rejected.some((r) => e.rejected!.test(r.reason))) problems.push(`no rejection matching ${e.rejected} (got: ${out.rejected.map((r) => r.reason).join(' | ') || 'none'})`);
  if (e.stepsInclude && !out.steps.some((x) => e.stepsInclude!.test(x.step))) problems.push(`no step matching ${e.stepsInclude}`);
  if (problems.length && out.note) problems.push(`LLM said: ${out.note.slice(0, 700)}`);
  row(!problems.length, s.name, problems.length ? problems.join('; ') : `${out.outcome}${out.chosen ? ` → ${out.chosen.kind}` : ''}`);
  closeStore();
}

let realVol: number | null = null;
if (flag('--real')) {
  // Real market data: realised 1h volatility of the ETH perp (ETHUSDT, public klines; most liquid, always trading).
  realVol = realizedVol1h(await fetchCloses('mainnet', 'ETH'));
  console.log(`\nREAL DATA: ETH 1h realised volatility on perps = ${realVol === null ? 'unavailable (using scenario values)' : (realVol * 100).toFixed(3) + '%'}`);
}
const volFor = (s: { fixedVol?: boolean; inputs: { vol1h: number } }) => (realVol !== null && !s.fixedVol ? realVol : s.inputs.vol1h);

console.log('\nPROPOSALS (rule fitting)');
for (const s of PROPOSAL_SCENARIOS) {
  const f = fitRule({ ...s.inputs, vol1h: volFor(s) }, { maxUtil: c.PROPOSE_MAX_UTIL, kSigma: c.PROPOSE_K_SIGMA, volStress: c.PROPOSE_VOL_STRESS, minTrigger: c.PROPOSE_MIN_TRIGGER, maxTrigger: c.PROPOSE_MAX_TRIGGER, tickSec: c.TICK_INTERVAL_SEC });
  const e = s.expect; const problems: string[] = []; const r = f.rule;
  if (e.source && r.primary_source !== e.source) problems.push(`source ${r.primary_source}, wanted ${e.source}`);
  if (e.triggerAtMost !== undefined && r.top_up_trigger > e.triggerAtMost) problems.push(`trigger ${r.top_up_trigger} > ${e.triggerAtMost}`);
  if (e.triggerAtLeast !== undefined && r.top_up_trigger < e.triggerAtLeast) problems.push(`trigger ${r.top_up_trigger} < ${e.triggerAtLeast}`);
  if (e.fact && !e.fact.test(f.facts.join(' '))) problems.push(`no fact matching ${e.fact}`);
  if (!(r.release_trigger < r.restore_target && r.restore_target < r.top_up_trigger)) problems.push('ordering broken');
  row(!problems.length, s.name, problems.length ? problems.join('; ') : `trigger ${Math.round(r.top_up_trigger * 100)}% · restore ${Math.round(r.restore_target * 100)}% · release ${Math.round(r.release_trigger * 100)}% · ${r.primary_source}`);
}

const pick = val('--proposal');
if (wallet && pick) {
  const s = PROPOSAL_SCENARIOS.find((x) => x.name === pick);
  if (!s) { console.error(`\nno proposal scenario named "${pick}". Options: ${PROPOSAL_SCENARIOS.map((x) => x.name).join(' | ')}`); process.exit(1); }
  openStore(':memory:');
  const p = await buildProposal(wallet, c.AGENT_NETWORK, { venue: 'aster', accountRef: '', equityUsd: s.inputs.equityUsd, usedUsd: s.inputs.usedUsd, positions: [{ symbol: 'ETH', valueUsd: Math.round(s.inputs.usedUsd * s.inputs.leverage) }] }, { ...s.inputs, vol1h: volFor(s) });
  const r = await postProposal(p);
  console.log(`\nproposal "${pick}" ${r.duplicate ? 'was already submitted' : `submitted as #${r.id}: open Risk management to approve it`}`);
}

console.log(failed ? `\n${failed} scenario(s) FAILED` : `\nALL ${ACTION_SCENARIOS.length + PROPOSAL_SCENARIOS.length} SCENARIOS PASSED`);
process.exit(failed ? 1 : 0);
