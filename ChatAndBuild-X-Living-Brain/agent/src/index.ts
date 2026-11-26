import { config } from './config';
import { log } from './log';
import { buildGraph } from './graph';
import * as app from './tools/appApi';
import { collectSnapshot } from './tools/collect';
import { proposeForWallet } from './proposal/propose';
import { openStore } from './tools/store';
import { runApproved } from './tools/approved';
import { sweepFallbackSafe } from './tools/fallbackSweep';
import { buildLastRun, buildStatus } from './status';
import { agentAddress, publicClient } from './tools/bsc';
import { agentEthBalance } from './tools/deriveFunding';
import type { ReadinessEnv } from './readiness';
import type { Snapshot } from './types';

/** Live numbers for the readiness alerts; a failed read is null (no alert), never a crash. */
async function readinessEnv(s: Snapshot, live: boolean): Promise<ReadinessEnv> {
  const addr = agentAddress();
  const needEth = s.config.rebalance.enabled && s.config.rebalance.rules.some((r) => r.enabled && r.venue === 'derive');
  const [bnb, ethW] = await Promise.all([
    addr ? publicClient().getBalance({ address: addr }).catch(() => null) : Promise.resolve(null),
    addr && needEth ? agentEthBalance(s.network).catch(() => null) : Promise.resolve(null),
  ]);
  return { live, agentBsc: addr, agentBnbWei: bnb, agentEthWei: ethW };
}

// The 30 s loop: for every wallet with rules, collect → run the graph. Wallets run one at a time so a slow
// venue never causes two moves for the same user at once. One failing wallet never stops the others.

const lastProposed = new Map<string, number>();

const lastCheck = new Map<string, number>();

/** Run this wallet now? Due on schedule (auto on), Run now pressed since the last check, or an approval waiting. */
export function dueReason(cfg: { schedule?: { auto: boolean; runNowAt: number | null } }, last: number | undefined, intervalMs: number, approvedWaiting: boolean, now = Date.now()): 'scheduled' | 'run-now' | 'approved' | null {
  const sch = cfg.schedule ?? { auto: true, runNowAt: null };
  if (sch.runNowAt && sch.runNowAt > (last ?? 0)) return 'run-now';
  if (approvedWaiting) return 'approved';
  if (sch.auto && now - (last ?? 0) >= intervalMs) return 'scheduled';
  return null;
}

export async function tick(graph = buildGraph(), opts: { forceProposal?: boolean; all?: boolean } = {}) {
  const c = config();
  const wallets = await app.listWallets(c.AGENT_NETWORK);
  for (const w of wallets) {
    const lk = `${w.wallet}:${c.AGENT_NETWORK}`;
    // Money stuck in the Derive fallback subaccount is swept to the main one even when automatic checks are off (its own
    // 5-minute timer): on its own in Auto mode, as an Approve request in Confirm mode. Needs only the wallet's settings.
    await sweepFallbackSafe({ wallet: w.wallet, network: c.AGENT_NETWORK, config: w.config } as unknown as Snapshot);
    if (!opts.all) {
      let waiting = false;
      try { waiting = (await app.listActions(w.wallet, c.AGENT_NETWORK, 'approved')).length > 0; } catch { /* checked on the next wake */ }
      const why = dueReason(w.config, lastCheck.get(lk), c.TICK_INTERVAL_SEC * 1000, waiting);
      if (!why) continue;
      if (why !== 'scheduled') log.info(`[${w.wallet.slice(0, 8)}] check now (${why === 'run-now' ? 'Run now pressed' : 'approved request waiting'})`);
    }
    lastCheck.set(lk, Date.now());
    try {
      const snapshot = await collectSnapshot(w.wallet, c.AGENT_NETWORK, w.config);
      // Anything the user approved since the last check runs first (each is re-planned and re-guarded).
      const ran = await runApproved(snapshot);
      if (ran) log.info(`[${w.wallet.slice(0, 8)}] ran ${ran} approved request(s)`);
      // One action per wallet per tick: if an approved request just ran, wait for the next check.
      let extra: Parameters<typeof buildStatus>[1] = {};
      if (!ran) { const out = await graph.invoke({ snapshot }); log.debug(`${w.wallet} → ${out.outcome}`); extra = { news: out.news, newsAt: out.newsAt, run: buildLastRun(snapshot, out, 0, c.live) }; }
      else extra = { run: buildLastRun(snapshot, null, ran, c.live) };
      // The status is posted every tick, even with the kill switch on or the agent paused, so the app always shows the truth.
      extra.readiness = await readinessEnv(snapshot, c.live);
      await app.postStatus(buildStatus(snapshot, extra)).catch((e) => log.warn(`status post failed: ${e instanceof Error ? e.message : String(e)}`));
    } catch (e) { log.error(`wallet ${w.wallet} failed: ${e instanceof Error ? e.message : String(e)}`); }
    // The risk analyst re-fits the rule every PROPOSE_INTERVAL_SEC and submits it for human approval.
    const k = `${w.wallet}:${c.AGENT_NETWORK}`;
    if ((w.config.schedule?.auto ?? true) === false && !opts.forceProposal) continue;   // automatic checks off: no unprompted rule proposals either
    if (opts.forceProposal || Date.now() - (lastProposed.get(k) ?? 0) >= c.PROPOSE_INTERVAL_SEC * 1000) {
      lastProposed.set(k, Date.now());
      log.info(`[${w.wallet.slice(0, 8)}] risk analyst: ${await proposeForWallet(w.wallet, c.AGENT_NETWORK, w.config)}`);
    }
  }
}

async function main() {
  const c = config();
  openStore(c.AGENT_DB_PATH);
  log.info(`agent start · network=${c.AGENT_NETWORK} · mode=${c.live ? 'LIVE' : 'dry-run'} · llm=${c.LLM_MODE}`);
  if (!c.AGENT_API_TOKEN) throw new Error('AGENT_API_TOKEN is not set');
  const graph = buildGraph();
  const once = process.argv.includes('--once') || process.argv.includes('--propose-once');
  const forceProposal = process.argv.includes('--propose-once');
  // Wake every 5 s: each wallet is checked when it is due (every TICK_INTERVAL_SEC with automatic checks on), when
  // Run now was pressed, or when an approved request is waiting.
  const WAKE_MS = 5_000;
  for (;;) {
    const started = Date.now();
    try { await tick(graph, { forceProposal, all: once }); } catch (e) { log.error(`tick failed: ${e instanceof Error ? e.message : String(e)}`); }
    if (once) return;
    await new Promise((r) => setTimeout(r, Math.max(1000, WAKE_MS - (Date.now() - started))));
  }
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('index.ts')) {
  main().catch((e) => { log.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
