import type { ActionRow } from '../../../lib/agent-action';
import { config } from '../config';
import { guard, executeNode, report } from '../graph/nodes';
import type { AgentStateT } from '../graph/state';
import { log } from '../log';
import type { Candidate, Snapshot } from '../types';
import * as app from './appApi';
import { filterCandidates } from './guard';
import { legKeyOf } from './hedgeLeg';
import { buildCandidates } from './planner';
import { candidateFromSpec, priceStillOk, quoteSpec, type ChatTradeSpec } from '../chat/trade';
import { moveProblems, type ChatMoveSpec } from '../chat/move';
import { fundCandidate, type ChatFundSpec } from '../chat/fund';
import { listSubaccounts, transferSpot } from './derive';

// Runs requests the user approved (confirmation mode). The approval says "do this kind of move"; the numbers are
// re-planned from fresh data and re-checked by the guard, so an old approval can never push a stale or oversized move.

const TOLERANCE = 0.25;
const near = (asked: number, now: number) => asked > 0 && Math.abs(asked - now) / asked <= TOLERANCE;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const blank = (snapshot: Snapshot, chosen: Candidate | null): AgentStateT => ({
  snapshot, candidates: [], rejected: [], statePatches: [], news: [], newsAt: null, risk: null, analysis: null, decision: null, review: null, chosen, steps: [], outcome: 'idle', note: '', detail: null, message: '',
});

function matches(a: ActionRow, c: Candidate): boolean {
  const d = a.detail as { kind?: string; ruleKey?: string | null; hedgeMarket?: string | null; hedgeKey?: string | null };
  if (d.kind !== c.kind) return false;
  return c.kind === 'hedge' ? (d.hedgeKey ? (c.hedge ? legKeyOf(c.hedge) : null) === d.hedgeKey : c.hedge?.market === d.hedgeMarket) : c.ruleKey === d.ruleKey;
}

function withinAsked(a: ActionRow, c: Candidate): boolean {
  const d = a.detail as { amountBaseUnit?: string; hedgeDelta?: number | null };
  const od = a.detail as { optionContracts?: number | null };
  if (c.kind === 'hedge' && c.hedge!.option) return near(od.optionContracts ?? 0, c.hedge!.option.contracts);
  if (c.kind === 'hedge') { const asked = d.hedgeDelta ?? 0; const now = c.hedge!.deltaToShort; return Math.sign(asked) === Math.sign(now) && near(Math.abs(asked), Math.abs(now)); }
  return near(Number(BigInt(d.amountBaseUnit ?? '0')), Number(BigInt(c.amountBaseUnit)));
}

// A margin move that already went out but whose acknowledgement failed: never send it a second time, only retry the acknowledgement.
const moved = new Map<number, string>();
/** Tests only: action ids restart in every test. */
export const clearMovedForTests = () => moved.clear();

/** A margin move the user asked for in the chat and approved: both balances re-read, the same checks as when it was requested, then exactly the approved amount. */
async function runMove(snapshot: Snapshot, a: ActionRow, spec: ChatMoveSpec, ack: (a: ActionRow, s: 'executed' | 'failed' | 'expired', m: string) => Promise<unknown>) {
  const done = moved.get(a.id); if (done) { await ack(a, 'executed', done); return; }
  try {
    const creds = await app.getDeriveCreds(snapshot.wallet, snapshot.network);
    const subs = await listSubaccounts(snapshot.network, snapshot.wallet, creds);
    const problems = moveProblems(subs, spec, snapshot.config.limits);
    if (problems.length) { await ack(a, 'failed', `Not moved: ${problems.join('; ')}. Nothing was moved.`); return; }
    if (!config().live) { await ack(a, 'executed', `Dry run, no money moved. It would have moved ${spec.amountUsd} USDC from ${spec.fromLabel} to ${spec.toLabel} on Derive.`); return; }
    const { opUuid } = await transferSpot(snapshot.network, snapshot.wallet, creds, spec.fromId, spec.toId, spec.amountUsd, spec.toId === 0 ? spec.newManager ?? 0 : 0);
    const msg = `Done. Moved ${spec.amountUsd} USDC from ${spec.fromLabel} to ${spec.toLabel} on Derive${opUuid ? ` (operation ${opUuid})` : ''}.`;
    moved.set(a.id, msg); await ack(a, 'executed', msg);
  } catch (e) { await ack(a, 'failed', `Not moved: ${errText(e)}. Check your Derive balances before asking again.`); }
}

/** Run every approved request for this wallet. Returns how many were handled. Never throws. */
export async function runApproved(snapshot: Snapshot, opts: { onExecuted?: (c: Candidate) => void } = {}): Promise<number> {
  let approved: ActionRow[];
  try { approved = await app.listActions(snapshot.wallet, snapshot.network, 'approved'); } catch (e) { log.warn(`could not read approvals: ${errText(e)}`); return 0; }
  if (!approved.length) return 0;
  const now = new Date();
  const plan = buildCandidates(snapshot, now);
  const f = filterCandidates(plan.candidates, snapshot, now);
  const ack = (a: ActionRow, status: 'executed' | 'failed' | 'expired', msg: string) =>
    app.postActionResult(a.id, snapshot.wallet, snapshot.network, status, msg).catch((e) => log.warn(`ack failed for #${a.id}: ${errText(e)}`));

  const runOne = async (a: ActionRow, chosen: Candidate) => {
    const st = blank(snapshot, chosen);
    const g = guard(st);
    if (g.outcome) { await ack(a, 'failed', `${g.note ?? 'guard refused'}. Nothing was moved.`); return; }
    const ex = await executeNode(st);
    const done: AgentStateT = { ...st, ...ex, decision: { action: 'execute', candidateId: chosen.id, reason: `You approved: ${a.title}` } };
    const rep = await report(done).catch(() => ({ message: '' }));
    const failedStep = done.steps.find((x) => x.status === 'failed');
    if (done.outcome === 'failed') await ack(a, 'failed', `Failed at "${failedStep?.step ?? 'a step'}": ${failedStep?.detail ?? 'unknown error'}. Nothing further was moved.`);
    else { opts.onExecuted?.(chosen); await ack(a, 'executed', config().live ? `Done. ${rep.message ?? ''}`.trim() : `Dry run, no money moved. It would have: ${done.steps.map((x) => x.step).join('; ')}.`); }
  };

  for (const a of approved) {
    const fd = (a.detail as { chatFund?: ChatFundSpec }).chatFund;
    if (a.origin === 'chat' && fd) {
      // Rebuilt from the approved spec against fresh balances: the exact approved amount or nothing, through the same guard and executor as every move.
      const { c, problem } = fundCandidate(snapshot, fd, `chat-fund-${a.id}`);
      if (!c) { await ack(a, 'failed', `Not moved: ${problem}. Nothing was moved.`); continue; }
      await runOne(a, c); continue;
    }
    const mv = (a.detail as { chatMove?: ChatMoveSpec }).chatMove;
    if (mv && (a.origin === 'chat' || a.origin === 'rule')) { await runMove(snapshot, a, mv, ack); continue; }
    // A trade the user asked for in the chat: rebuilt from its exact spec, re-quoted, then the same guard as any trade.
    const spec = (a.detail as { chatTrade?: ChatTradeSpec }).chatTrade;
    if (a.origin === 'chat' && spec) {
      try {
        const q = await quoteSpec(snapshot.network, spec);
        if (!priceStillOk(spec, q.price)) { await ack(a, 'expired', `Not run: the price moved from $${spec.quotedPrice} to $${q.price} (more than 25%) since you approved. Nothing was moved; ask again for a fresh quote.`); continue; }
        await runOne(a, candidateFromSpec(spec, q, `chat-${a.id}`));
      } catch (e) { await ack(a, 'failed', `Not run: ${errText(e)}. Nothing was moved.`); }
      continue;
    }
    const fresh = f.ok.find((c) => matches(a, c));
    if (!fresh) {
      const why = [...plan.rejected, ...f.rejected].find((r) => (a.detail as { ruleKey?: string | null }).ruleKey === (r.ruleKey ?? null))?.reason;
      await ack(a, 'expired', `Not run: conditions changed since you approved${why ? ` (${why})` : ' (this move is no longer needed)'}. Nothing was moved. The agent will ask again if it is still needed.`);
      continue;
    }
    if (!withinAsked(a, fresh)) {
      await ack(a, 'expired', 'Not run: the size changed by more than 25% since you approved, so it needs a fresh OK. Nothing was moved.');
      continue;
    }
    await runOne(a, fresh);
  }
  return approved.length;
}
