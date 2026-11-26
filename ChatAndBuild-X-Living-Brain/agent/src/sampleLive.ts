import { config } from './config';
import { buildGraph } from './graph';
import { log } from './log';
import { buildProposal } from './proposal/propose';
import { applyEffect, installSampleFeeds, samplePortfolio } from './sample';
import { buildStatus } from './status';
import * as app from './tools/appApi';
import { runApproved } from './tools/approved';
import { openStore } from './tools/store';

// LIVE SAMPLE MODE. The real agent (real LLM, real graph) runs on the TEST portfolio and talks to your running app, so
// the recommendations, approval cards, status panel and news flags show up on the Risk management page. Nothing is
// connected to a real account and nothing is signed or sent: it is always a dry run.
//
//   npm run sample -- 0xYourWallet            (testnet, keeps running, checks every 15 s; Ctrl+C to stop)
//   npm run sample -- 0xYourWallet --once     (one pass, then exit)
//
// Your own settings in the app are respected: mode (ask first / autonomous), loss limit, limits, kill switch,
// and scheduled events. News flags are always on here so you can see them. The test portfolio supplies the balances and positions.
process.env.DRY_RUN = 'true'; process.env.POST_EVENTS = 'true';
const args = process.argv.slice(2);
const wallet = args.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) ?? '0xFfa4Bcc5576995865B083224aD49da28B6a02c7A';
const once = args.includes('--once');
const intervalSec = Number(args[args.indexOf('--interval') + 1]) || 15;
const c = config();
if (!c.AGENT_API_TOKEN) { console.error('AGENT_API_TOKEN is not set in agent/.env'); process.exit(1); }

openStore(':memory:');
installSampleFeeds();
const snapshot = samplePortfolio('confirm');
snapshot.wallet = wallet; snapshot.network = c.AGENT_NETWORK;
const graph = buildGraph();
log.info(`sample mode · wallet ${wallet} · ${c.AGENT_NETWORK} · llm=${c.LLM_MODE} · dry run · app ${c.APP_API_URL}`);

/** Take the user's own settings from the app and keep the sample balances. */
async function syncSettings() {
  try {
    const cfg = await app.getConfig(wallet, c.AGENT_NETWORK);
    snapshot.config.mode = cfg.mode; snapshot.config.limits = cfg.limits; snapshot.config.risk = cfg.risk;
    snapshot.config.hedge.driftThresholdPct = cfg.hedge.driftThresholdPct;
    if (cfg.events.length) snapshot.config.events = cfg.events;
    if (cfg.rebalance.keepBscReserveBaseUnit) snapshot.config.rebalance.keepBscReserveBaseUnit = cfg.rebalance.keepBscReserveBaseUnit;
    snapshot.config.collateral = cfg.collateral;
  } catch (e) { log.warn(`could not read your settings from the app, using sample defaults: ${e instanceof Error ? e.message : String(e)}`); }
}

let proposed = false;
async function tick() {
  await syncSettings();
  snapshot.takenAt = new Date().toISOString();
  const ran = await runApproved(snapshot, { onExecuted: (ch) => log.info(`applied: ${applyEffect(snapshot, ch)}`) });
  let extra: Parameters<typeof buildStatus>[1] = {};
  if (!ran) {
    const out = await graph.invoke({ snapshot });
    log.info(`tick: ${out.outcome}${out.chosen ? ` · ${out.chosen.id}` : ''}${out.note ? ` · ${out.note}` : ''}`);
    if (out.chosen && out.outcome === 'simulated') log.info(`applied: ${applyEffect(snapshot, out.chosen)}`);
    extra = { news: out.news, newsAt: out.newsAt };
  }
  await app.postStatus(buildStatus(snapshot, extra)).catch((e) => log.warn(`status post failed: ${e instanceof Error ? e.message : String(e)}`));
  // One margin-rule proposal (the risk analyst) so the proposal card appears too.
  if (!proposed) {
    proposed = true;
    try {
      const p = await buildProposal(wallet, c.AGENT_NETWORK, { venue: 'aster', accountRef: '', equityUsd: 4000, usedUsd: 1400, positions: [{ symbol: 'ETH', valueUsd: 30_000 }] },
        { vol1h: 0.041, latencySec: 18, leverage: 21, utilNow: 0.35, equityUsd: 4000, usedUsd: 1400, bnbStablesUsd: 400, bstocksAfterHaircutUsd: 7_000 });
      const r = await app.postProposal(p); log.info(r.duplicate ? 'rule proposal already submitted' : `rule proposal #${r.id} submitted for approval`);
    } catch (e) { log.warn(`proposal failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
}

for (;;) {
  const t0 = Date.now();
  try { await tick(); } catch (e) { log.error(`tick failed: ${e instanceof Error ? e.message : String(e)}`); }
  if (once) break;
  await new Promise((r) => setTimeout(r, Math.max(2000, intervalSec * 1000 - (Date.now() - t0))));
}
