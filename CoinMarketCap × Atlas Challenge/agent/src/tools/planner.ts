import { createHash } from 'node:crypto';
import { planFunding } from '../../../lib/plan';
import { assessRisk, planHedges, type RiskView } from '../risk/plan';
import { planRatioHedges } from '../risk/ratio';
import { planRule, ruleKey, type RiskRule, type RuleState } from '../../../lib/risk-rules';
import { ACTIVE_RULE_VENUES, minDepositBase } from './venueRules';
import type { Candidate, RejectedCandidate, Snapshot } from '../types';
import { haircutArg } from './integrity';

// Deterministic planning. Wraps the app's own pure functions (planRule / planFunding / planHedge) so the
// agent and the UI preview always agree. No I/O, no randomness: same snapshot in, same candidates out.

export interface StatePatch { ruleKey: string; releaseBelowSince: string | null }
export interface PlanResult { candidates: Candidate[]; rejected: RejectedCandidate[]; statePatches: StatePatch[]; risk: RiskView | null }

const key = (...p: (string | undefined | null)[]) => createHash('sha256').update(p.map((x) => x ?? '').join('|')).digest('hex').slice(0, 24);
/** A top-up ADDS to account value (margin used is unchanged); a release removes it. */
function afterOf(h: { accountUsd: number | null; usedUsd: number | null }, deltaUsd: number): { utilBps: number | null; accountUsd: number | null } {
  if (h.accountUsd === null || h.usedUsd === null) return { utilBps: null, accountUsd: null };
  const acct = h.accountUsd + deltaUsd;
  return { accountUsd: Math.round(acct * 100) / 100, utilBps: acct > 0 ? Math.round((h.usedUsd / acct) * 10_000) : null };
}
const pct0 = (bps: number | null | undefined) => (bps === null || bps === undefined ? '?' : `${Math.round(bps / 100)}%`);
const usd0 = (base: string) => `$${(Number(BigInt(base)) / 1e6).toFixed(2)}`;
const EPOCH = '1970-01-01T00:00:00.000Z';

export function buildCandidates(s: Snapshot, now = new Date()): PlanResult {
  const out: Candidate[] = []; const rejected: RejectedCandidate[] = []; const statePatches: StatePatch[] = [];
  const cfg = s.config;

  if (cfg.rebalance.enabled) {
    for (const rule of cfg.rebalance.rules) {
      const rk = ruleKey(rule);
      if (!ACTIVE_RULE_VENUES.has(rule.venue)) { rejected.push({ kind: 'top_up', ruleKey: rk, reason: 'this venue is retired: set the rule on the perps account instead', severity: 'error' }); continue; }
      const venue = rule.venue as 'aster' | 'derive';
      const health = s.health[rk];
      if (!health) { rejected.push({ kind: 'top_up', ruleKey: rk, reason: 'no health reading', severity: 'error' }); continue; }
      if (s.venueProblems?.[venue]) { rejected.push({ kind: 'top_up', ruleKey: rk, reason: `${venue === 'aster' ? 'perps' : 'options'} skipped: ${s.venueProblems[venue]}`, severity: 'error' }); continue; }
      const st: RuleState = s.ruleState[rk] ?? {};

      // Keep the release dwell clock current: start it when the release condition begins, clear it when it stops.
      const probe = planRule(rule as RiskRule, health, { ...st, releaseBelowSince: EPOCH }, now);
      const holds = probe.kind === 'release';
      if (holds && !st.releaseBelowSince) statePatches.push({ ruleKey: rk, releaseBelowSince: now.toISOString() });
      if (!holds && st.releaseBelowSince) statePatches.push({ ruleKey: rk, releaseBelowSince: null });

      const act = planRule(rule as RiskRule, health, st, now);
      if (act.kind === 'none') { rejected.push({ kind: 'top_up', ruleKey: rk, reason: act.reason }); continue; }

      const idem = `ag-${key(s.wallet, s.network, rk, act.kind, act.amountBaseUnit, st.lastMoveAt)}`;
      if (act.kind === 'top_up') {
        // Only plan with what the agent may actually use: USDC up to the user's allowance, and each bStock up to the
        // amount the user allowed to be sold. (The guard re-checks both.) USDT counts up to its own allowance (it is swapped to USDC before the bridge).
        const reserveUsd = Number(BigInt(cfg.rebalance.keepBscReserveBaseUnit)) / 1e6;
        const allowUsd = Number(BigInt(s.bsc.allowanceUsdcBase)) / 1e6;
        const allowUsdtUsd = Number(BigInt(s.bsc.allowanceUsdtBase ?? '0')) / 1e6;
        const fp = planFunding(act.amountBaseUnit, {
          bscUsdc: Math.min(s.bsc.usdcUsd, allowUsd + reserveUsd), bscUsdt: Math.min(s.bsc.usdtUsd, allowUsdtUsd + Math.max(0, reserveUsd - s.bsc.usdcUsd)),
          bstocks: s.bsc.bstocks.map((b) => ({ symbol: b.symbol, value: b.qty > 0 ? b.value * Math.min(1, (b.allowanceQty ?? 0) / b.qty) : 0 })),
        }, cfg.rebalance, haircutArg(s));
        let amountBase = act.amountBaseUnit; let funding = fp;
        if (fp.shortfallUsd > 0) {
          const capped = s.bsc.usdcUsd - reserveUsd > allowUsd;
          const why = `BNB funds short by $${fp.shortfallUsd}${capped ? ` (allowance too low: the USDC allowance to the agent is only $${allowUsd})` : ''}`;
          // Top up what the funds do cover (if that is at least the minimum move) and report the shortfall.
          const funded = BigInt(act.amountBaseUnit) - BigInt(Math.round(fp.shortfallUsd * 1e6));
          if (funded < BigInt(rule.minMoveBaseUnit) || funded < minDepositBase(rule.venue)) { rejected.push({ kind: 'top_up', ruleKey: rk, reason: why, severity: 'error' }); continue; }
          amountBase = funded.toString();
          funding = planFunding(amountBase, { bscUsdc: Math.min(s.bsc.usdcUsd, allowUsd + reserveUsd), bscUsdt: Math.min(s.bsc.usdtUsd, allowUsdtUsd + Math.max(0, reserveUsd - s.bsc.usdcUsd)), bstocks: s.bsc.bstocks.map((b) => ({ symbol: b.symbol, value: b.qty > 0 ? b.value * Math.min(1, (b.allowanceQty ?? 0) / b.qty) : 0 })) }, cfg.rebalance, haircutArg(s));
          rejected.push({ kind: 'top_up', ruleKey: rk, reason: `${why}; topping up the ${usd0(amountBase)} the funds do cover`, severity: 'error' });
        }
        out.push({ id: `top_up:${rk}:${amountBase}`, kind: 'top_up', ruleKey: rk, venue, amountBaseUnit: amountBase, reason: act.reason,
          explain: `Add ${usd0(amountBase)} USDC to the account (${funding.sources.map((x) => (x.source === 'bsc_usdc' ? `$${x.amountUsd} from BNB USDC` : `a $${x.amountUsd} sale of your ${x.source.replace('sell ', '')}`)).join(' and ')}). Account value goes up, margin used is unchanged, so utilization falls from ${pct0(health.utilBps)} to ${pct0(afterOf(health, Number(BigInt(amountBase)) / 1e6).utilBps)}.`,
          funding: funding.sources, after: afterOf(health, Number(BigInt(amountBase)) / 1e6), idempotencyKey: idem, urgency: 1_000_000 + Number(BigInt(amountBase) / 1_000_000n), rule: rule as RiskRule });
      } else if (venue === 'aster') {
        // The agent key on the perps venue has canWithdraw=false by design: it can never take money out. Say so; move nothing.
        rejected.push({ kind: 'release', ruleKey: rk, reason: `${usd0(act.amountBaseUnit)} of idle margin could be released, but withdrawals from perps need your wallet signature in the app. Nothing was moved.`, severity: 'error' });
      } else {
        out.push({ id: `release:${rk}:${act.amountBaseUnit}`, kind: 'release', ruleKey: rk, venue, amountBaseUnit: act.amountBaseUnit, reason: act.reason,
          explain: `Withdraw ${usd0(act.amountBaseUnit)} of idle margin. Utilization has been below the ${pct0(rule.releaseLevelBps)} release level for the required time. Taking this margin out raises utilization from ${pct0(health.utilBps)} up to about ${pct0(afterOf(health, -Number(BigInt(act.amountBaseUnit)) / 1e6).utilBps)} (the restore target), still below the ${pct0(rule.triggerBps)} top-up trigger.`,
          after: afterOf(health, -Number(BigInt(act.amountBaseUnit)) / 1e6), idempotencyKey: idem, urgency: 1, rule: rule as RiskRule });
      }
    }
  }

  // Hedge sizing. 'ratio' (default): by value, bStock qty x price x ratio / hedge price (AGENT_BUILD.md section 6).
  // 'loss_limit': solved from the user's loss tolerance and the portfolio VaR (see risk/). News never enters either.
  let risk: RiskView | null = null;
  if (cfg.hedge.enabled) {
    if (cfg.hedge.sizing === 'ratio') {
      for (const why of s.hedgeProblems ?? []) rejected.push({ kind: 'hedge', reason: why, severity: 'error' });
      const r = planRatioHedges(s, now); out.push(...r.candidates); rejected.push(...r.rejected);
    } else if (s.hedgeProblems?.length) for (const why of s.hedgeProblems) rejected.push({ kind: 'hedge', reason: why });
    else {
      risk = assessRisk(s, now);
      if (risk) { const h = planHedges(s, risk, now); out.push(...h.candidates); rejected.push(...h.rejected); }
    }
  }

  out.sort((x, y) => y.urgency - x.urgency);
  return { candidates: out, rejected, statePatches, risk };
}
