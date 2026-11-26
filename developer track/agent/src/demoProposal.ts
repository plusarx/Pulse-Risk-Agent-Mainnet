import { config } from './config';
import { log } from './log';
import { buildProposal } from './proposal/propose';
import { postProposal } from './tools/appApi';
import { openStore } from './tools/store';

// Pushes ONE made-up risk proposal into the app for a real wallet, to see the proposal card and Approve button.
// Usage: npm run demo:propose -- 0xYourWalletAddress
// Scenario (from the build spec): hedged, leveraged book; realised 1h vol 4.1%; top-up latency 18 s; the BNB
// wallet has $0 stables but holds bStocks. Numbers are fitted by code, the real LLM (LLM_MODE=on) explains them.
// Nothing is armed and nothing moves: the proposal waits for approval in the UI.
const wallet = process.argv[2];
if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) { console.error('Usage: npm run demo:propose -- 0xYourWalletAddress'); process.exit(1); }
openStore(':memory:');
const c = config();
const p = await buildProposal(wallet, c.AGENT_NETWORK,
  { venue: 'aster', accountRef: '', equityUsd: 10_000, usedUsd: 5_500, positions: [{ symbol: 'ETH', valueUsd: 66_000 }] },
  { vol1h: 0.041, latencySec: 18, leverage: 12, utilNow: 0.55, equityUsd: 10_000, usedUsd: 5_500, bnbStablesUsd: 0, bstocksAfterHaircutUsd: 7_000 });
console.log(JSON.stringify(p, null, 2));
const r = await postProposal(p);
log.info(r.duplicate ? 'same proposal was already submitted' : `proposal #${r.id} submitted. Open Risk management and click Approve.`);
