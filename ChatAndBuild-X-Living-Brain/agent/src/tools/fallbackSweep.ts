import { config } from '../config';
import { log } from '../log';
import { effectiveMode } from '../policy';
import type { Snapshot } from '../types';
import * as app from './appApi';
import { listSubaccounts, transferSpot, type SubaccountView } from './derive';
import { moveProblems, moveRequest, subLabel, usdcOf, type ChatMoveSpec } from '../chat/move';

// Money that lands in the Derive FALLBACK subaccount (mis-routed deposits, or a move sent there) cannot trade. The agent moves it to
// the main trading subaccount (the one its key was registered for): on its own in Auto mode, as an Approve request in Confirm mode.
// Same checks as any move (kill switch, per-move cap, balance). Read at most every SWEEP_EVERY_MS per wallet.

export const SWEEP_EVERY_MS = 5 * 60_000;
export const SWEEP_MIN_USD = 1;
const lastSweep = new Map<string, number>();
export const clearSweepForTests = () => lastSweep.clear();

/** What to do for this wallet now: nothing, or move `amountUsd` from the fallback to the main subaccount. Pure. */
export function planSweep(subs: SubaccountView[], mainId: number | null): ChatMoveSpec | null {
  const fb = subs.find((x) => x.isFallback); const main = subs.find((x) => x.subaccount_id === mainId && !x.isFallback);
  if (!fb || !main) return null;
  const usdc = Math.floor(usdcOf(fb) * 100) / 100;
  if (usdc < SWEEP_MIN_USD) return null;
  return { venue: 'derive', fromId: fb.subaccount_id, toId: main.subaccount_id, fromLabel: subLabel(fb), toLabel: subLabel(main), amountUsd: usdc.toFixed(2) };
}

export async function sweepFallback(s: Snapshot, now = Date.now()): Promise<string | null> {
  const k = `${s.wallet}:${s.network}`;
  if (now - (lastSweep.get(k) ?? 0) < SWEEP_EVERY_MS) return null;
  lastSweep.set(k, now);
  let creds: app.DeriveCreds;
  try { creds = await app.getDeriveCreds(s.wallet, s.network); } catch { return null; }          // no Derive key: nothing to sweep
  const subs = await listSubaccounts(s.network, s.wallet, creds);
  const spec = planSweep(subs, creds.subaccountId);
  if (!spec) return null;
  const problems = moveProblems(subs, spec, s.config.limits);
  if (problems.length) return `fallback sweep skipped: ${problems.join('; ')}`;
  const why = `${spec.amountUsd} USDC is sitting in your Derive fallback subaccount, which cannot trade (it catches mis-routed deposits). This moves it to ${spec.toLabel}, your main trading subaccount. Nothing leaves Derive; your caps and kill switch apply.`;
  if (effectiveMode(s, new Date(now)).mode === 'autonomous' && config().live) {
    await transferSpot(s.network, s.wallet, creds, spec.fromId, spec.toId, spec.amountUsd);
    await app.postEvent({ wallet: s.wallet, network: s.network, kind: 'rebalance', venue: 'derive', status: 'done', message: `Moved ${spec.amountUsd} USDC out of the Derive fallback subaccount #${spec.fromId} to ${spec.toLabel} (Auto mode).`,
      payload: { direction: 'in', amountUsd: Number(spec.amountUsd), ruleKey: null, dryRun: false }, idempotencyKey: `sweep-${spec.fromId}-${spec.amountUsd}-${Math.floor(now / SWEEP_EVERY_MS)}` }).catch(() => undefined);
    return `moved ${spec.amountUsd} USDC from the fallback to #${spec.toId}`;
  }
  const r = await app.postAction(moveRequest(s, spec, now, { origin: 'rule', why }));
  return r.duplicate ? null : `asked to move ${spec.amountUsd} USDC from the fallback to #${spec.toId}`;
}

/** Tick hook: never throws, logs what it did. */
export async function sweepFallbackSafe(s: Snapshot): Promise<void> {
  try { const m = await sweepFallback(s); if (m) log.info(`[${s.wallet.slice(0, 8)}] ${m}`); }
  catch (e) { log.warn(`[${s.wallet.slice(0, 8)}] fallback sweep failed: ${e instanceof Error ? e.message : String(e)}`); }
}
