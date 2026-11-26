import { ruleKey } from '../../../lib/risk-rules';
import { policyCheck } from '../policy';
import type { Candidate, RejectedCandidate, Snapshot } from '../types';
import { splitFunding } from './funding';
import { legInConfig } from './hedgeLeg';
import { isLocked } from './store';
import { blockedReason, haircutFor } from './integrity';
import { ACTIVE_RULE_VENUES, minCooldownSec, minDepositBase } from './venueRules';

// Hard safety checks in code. The LLM can never loosen these: every candidate passes through here before the
// LLM sees it, and the chosen one is re-checked right before execution. Returns a reason string or null.
// The user's limits (kill switch, notional caps, leverage, allowlist, off-BNB cap, daily loss) live in ../policy.

/** USDC, USDT and sold-bStock funding must fit what the user allowed. Returns a reason or null. */
function fundingProblem(s: Snapshot, c: Pick<Candidate, 'amountBaseUnit' | 'funding'>): string | null {
  const sp = splitFunding(c);
  if (!c.funding?.length || sp.unsupported.length) return `funding source not supported yet: ${sp.unsupported.join(', ') || 'none'}`;
  if (sp.usdcBase < 0n) return 'funding plan is inconsistent with the amount';
  if (sp.usdcBase > BigInt(s.bsc.allowanceUsdcBase)) return 'allowance too low: above the on-chain USDC allowance the user granted';
  if (sp.usdtBase > 0n) {
    if (sp.usdtBase > BigInt(s.bsc.allowanceUsdtBase ?? '0')) return 'allowance too low: above the on-chain USDT allowance the user granted';
    if (BigInt(Math.floor(s.bsc.usdtUsd * 1e6)) < sp.usdtBase) return 'not enough USDT in the BNB wallet';
  }
  if (sp.usdcBase > 0n) {
    const reserve = BigInt(s.config.rebalance.keepBscReserveBaseUnit);
    if (BigInt(Math.floor(s.bsc.usdcUsd * 1e6)) - sp.usdcBase < reserve) return 'would dip below the BNB reserve';
  }
  for (const leg of sp.sales) {
    const untrusted = blockedReason(s, leg.symbol); if (untrusted) return `selling ${leg.symbol} for margin is on hold: ${untrusted}`;
    const haircut = haircutFor(s, leg.symbol);
    if (!s.config.rebalance.sellOrder.includes(leg.symbol)) return `${leg.symbol} is not in the list of bStocks you allow the agent to sell`;
    const h = s.bsc.bstocks.find((b) => b.symbol === leg.symbol);
    if (!h || h.qty <= 0 || h.value <= 0) return `${leg.symbol} is not held`;
    const needQty = (leg.usd / (1 - haircut)) / (h.value / h.qty);
    if (needQty > h.qty * (1 + 1e-9)) return `not enough ${leg.symbol} held to sell for $${leg.usd.toFixed(2)}`;
    if ((h.allowanceQty ?? 0) < needQty * (1 - 1e-9)) return `${leg.symbol} allowance to the agent is too small to sell for $${leg.usd.toFixed(2)}`;
  }
  return null;
}

export function checkCandidate(c: Candidate, s: Snapshot, now = new Date()): string | null {
  if (s.dataQuality.length) return `data quality: ${s.dataQuality.join('; ')}`;
  const pol = policyCheck(c, s, now); if (pol.block) return pol.block;

  if (c.kind === 'hedge') {
    // A trade the user asked for in the chat and approved need not be a saved hedge leg; every other check still applies.
    if (!c.chat && !s.config.hedge.enabled) return 'hedging is off';
    if (!c.hedge || (!c.chat && !legInConfig(s.config.hedge.legs, c.hedge))) return 'hedge leg not in config';
    // Price integrity: do not hedge against a bStock whose price is not trusted (a reduce-only close never relies on it).
    if (!c.hedge.reduceOnly) { const untrusted = blockedReason(s, c.hedge.proxyFor ? `${c.hedge.proxyFor}B` : c.hedge.bstock); if (untrusted) return `hedge on hold: ${untrusted}`; }
    const mp = c.plan?.marginPlan;
    if (mp && mp.moveUsd > 0) {
      const base = (BigInt(Math.round(mp.moveUsd * 100)) * 10_000n).toString();
      const why = fundingProblem(s, { amountBaseUnit: base, funding: [{ source: 'bsc_usdc', amountUsd: mp.moveUsd }] });
      if (why) return `margin move for the hedge: ${why}`;
    }
    return null;
  }
  if (!s.config.rebalance.enabled) return 'automation is off';
  const rule = s.config.rebalance.rules.find((r) => ruleKey(r) === c.ruleKey);
  if (!rule || !rule.enabled) return 'rule missing or paused';
  if (!ACTIVE_RULE_VENUES.has(rule.venue)) return 'this venue is retired: set the rule on the perps account instead';
  const amt = BigInt(c.amountBaseUnit);
  if (amt <= 0n) return 'amount must be positive';
  if (amt < BigInt(rule.minMoveBaseUnit) || amt < minDepositBase(rule.venue)) return 'below the minimum move';
  if (amt > BigInt(rule.maxPerMoveBaseUnit)) return 'above the per-move cap';
  const moved = BigInt(s.moved24hBase[c.ruleKey!] ?? '0');
  if (moved + amt > BigInt(rule.dailyCapBaseUnit)) return 'daily cap reached: this move would exceed the 24h cap';
  const st = s.ruleState[c.ruleKey!] ?? {};
  const cool = Math.max(rule.cooldownSec, minCooldownSec(rule.venue)) * 1000;
  if (st.lastMoveAt && now.getTime() - Date.parse(st.lastMoveAt) < cool) return 'cooling down after the last move';
  if (isLocked(`${s.wallet.toLowerCase()}:${s.network}:${c.ruleKey}`, now.getTime())) return 'a move for this rule is already in flight';
  if (c.kind === 'top_up') return fundingProblem(s, c);
  return null;
}

export function filterCandidates(cs: Candidate[], s: Snapshot, now = new Date()): { ok: Candidate[]; rejected: RejectedCandidate[] } {
  const ok: Candidate[] = []; const rejected: RejectedCandidate[] = [];
  for (const c of cs) {
    const why = checkCandidate(c, s, now);
    if (why) rejected.push({ kind: c.kind, ruleKey: c.ruleKey, reason: why, severity: /daily cap|allowance|reserve|per-move cap|kill switch|paused/.test(why) ? 'error' : 'info' }); else ok.push(c);
  }
  return { ok, rejected };
}

export const lockKey = (s: Snapshot, c: Candidate) => `${s.wallet.toLowerCase()}:${s.network}:${c.ruleKey ?? `hedge:${c.hedge?.market}`}`;
