import { z } from 'zod';
import { AgentConfig } from './agent-config';
import { defaultRule, ruleKey, type RiskRule } from './risk-rules';

// Risk-analyst proposals: the agent PROPOSES a rule fitted to volatility, transfer latency and the portfolio;
// a human approves it in the UI. Nothing is armed until then. Shared by the API routes, the UI and the agent.

const frac = z.number().min(0.05).max(0.95);

export const ProposedRule = z.object({
  top_up_trigger: frac,      // top up when utilization rises above this (0.62 = 62%)
  restore_target: frac,      // bring utilization back to this
  release_trigger: frac,     // release surplus when utilization stays below this
  primary_source: z.enum(['bstocks_bnb', 'exchange_wallet']),
});
export type ProposedRule = z.infer<typeof ProposedRule>;

export const ProposalIn = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  network: z.enum(['mainnet', 'testnet']),
  venue: z.enum(['aster', 'lighter', 'derive']),
  /** '' = the perps (Aster) account; Derive subaccount id otherwise. */
  accountRef: z.string().max(24),
  structural_risk: z.string().min(1).max(600),
  proposed_rule: ProposedRule,
  reasoning: z.string().min(1).max(1200),
  /** Numbers the proposal was fitted to (vol, latency, leverage…). Shown to the approver. */
  metrics: z.record(z.union([z.number(), z.string(), z.null()])).optional(),
  idempotencyKey: z.string().min(8).max(80),
}).superRefine((p, ctx) => {
  const r = p.proposed_rule;
  if (r.restore_target >= r.top_up_trigger) ctx.addIssue({ code: 'custom', path: ['proposed_rule', 'restore_target'], message: 'restore_target must be below top_up_trigger' });
  if (r.release_trigger >= r.restore_target) ctx.addIssue({ code: 'custom', path: ['proposed_rule', 'release_trigger'], message: 'release_trigger must be below restore_target' });
});
export type ProposalIn = z.infer<typeof ProposalIn>;

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'reverted';

export interface ProposalRow {
  id: number; network: string; venue: 'aster' | 'lighter' | 'derive'; accountRef: string; status: ProposalStatus;
  structural_risk: string; proposed_rule: ProposedRule; reasoning: string; metrics: Record<string, number | string | null> | null;
  created_at: number; decided_at: number | null;
}

const bps = (f: number) => Math.round(f * 10_000);

/** Funding order implied by the proposal's primary source. */
export const sourcesFor = (p: ProposedRule['primary_source']): AgentConfig['rebalance']['sources'] =>
  p === 'bstocks_bnb' ? ['sell_bstocks', 'bsc_usdc', 'bsc_usdt'] : ['bsc_usdc', 'bsc_usdt', 'sell_bstocks'];

/**
 * The config after approval: this account's rule gets the proposed deadband (existing caps and cooldown are
 * kept), the funding order follows the primary source, and automation is armed. Throws if the result is invalid.
 */
export function applyProposal(cfg: AgentConfig, p: Pick<ProposalIn, 'venue' | 'accountRef' | 'proposed_rule'>): AgentConfig {
  // Lighter is dormant: it is no longer a rule venue, so a proposal for it cannot be applied.
  if (p.venue === 'lighter') throw new Error('Perps rules now run on the new perps account; this proposal is out of date');
  const venue = p.venue;
  const next = structuredClone(cfg);
  const key = ruleKey(p);
  const i = next.rebalance.rules.findIndex((r) => ruleKey(r) === key);
  const base: RiskRule = i >= 0 ? (next.rebalance.rules[i] as RiskRule) : defaultRule(venue, p.accountRef);
  const r = p.proposed_rule;
  const rule = {
    ...base, mode: 'utilization' as const, triggerBps: bps(r.top_up_trigger), targetBps: bps(r.restore_target),
    triggerBaseUnit: null, targetBaseUnit: null,
    releaseOn: true, releaseLevelBps: bps(r.release_trigger), releaseLevelBaseUnit: null, releaseTargetBps: null, releaseTargetBaseUnit: null,
    releaseForSec: base.releaseForSec ?? 1800, enabled: true,
  };
  if (i >= 0) next.rebalance.rules[i] = rule; else next.rebalance.rules.push(rule);
  next.rebalance.sources = sourcesFor(r.primary_source);
  next.rebalance.enabled = true;
  return AgentConfig.parse(next);
}

/**
 * Undo an approval when the config from before it was not saved (older proposals): drop this account's rule and
 * turn Automation off if no rule is left. Funding order is left as it is.
 */
export function withoutProposalRule(cfg: AgentConfig, p: Pick<ProposalIn, 'venue' | 'accountRef'>): AgentConfig {
  const next = structuredClone(cfg);
  const key = ruleKey(p);
  next.rebalance.rules = next.rebalance.rules.filter((r) => ruleKey(r) !== key);
  if (!next.rebalance.rules.length) next.rebalance.enabled = false;
  return AgentConfig.parse(next);
}
