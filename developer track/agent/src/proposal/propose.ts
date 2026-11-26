import { createHash } from 'node:crypto';
import { ProposalIn } from '../../../lib/agent-proposal';
import type { AgentConfig } from '../../../lib/agent-config';
import { ruleKey } from '../../../lib/risk-rules';
import { config } from '../config';
import { log } from '../log';
import { RiskAnalystOut } from '../llm/schemas';
import { runLlm } from '../llm/run';
import * as app from '../tools/appApi';
import * as bsc from '../tools/bsc';
import { tickerOfAster } from '../../../lib/aster';
import * as aster from '../tools/aster';
import * as metrics from '../tools/metrics';
import * as pancake from '../tools/pancake';
import type { BscFunds, Network } from '../types';
import { refreshIntegrity } from '../tools/integrity';
import { effectiveHaircut } from '../../../lib/integrity';
import type { IntegritySnapshot } from '../../../lib/integrity-sources';
import { draftText, fitRule, type Fit, type FitInputs } from './compute';

// The risk analyst: once in a while, fit a rule to the user's book (volatility, latency, leverage, funding)
// and submit it as a PROPOSAL. Nothing is armed until the human approves it in the UI.

export const fitParams = () => { const c = config(); return { maxUtil: c.PROPOSE_MAX_UTIL, kSigma: c.PROPOSE_K_SIGMA, volStress: c.PROPOSE_VOL_STRESS, minTrigger: c.PROPOSE_MIN_TRIGGER, maxTrigger: c.PROPOSE_MAX_TRIGGER, tickSec: c.TICK_INTERVAL_SEC }; };

export interface AccountView { venue: 'aster' | 'derive'; accountRef: string; equityUsd: number; usedUsd: number; positions: { symbol: string; valueUsd: number }[] }

/** Fit + explain. Numbers come from code; the LLM (if on) only writes the two explanation fields. */
export async function buildProposal(wallet: string, network: Network, acct: AccountView, inputs: FitInputs): Promise<ProposalIn> {
  const fit: Fit = fitRule(inputs, fitParams());
  let text = draftText(fit);
  if (config().LLM_MODE === 'on') {
    try {
      text = await runLlm('risk_analyst', RiskAnalystOut, { account: { ...acct, leverage: inputs.leverage, utilizationNow: inputs.utilNow }, fit: fit.rule, metrics: fit.metrics, facts: fit.facts });
    } catch (e) { log.warn(`risk analyst LLM unavailable, using plain draft: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const key = createHash('sha256').update(`${wallet.toLowerCase()}|${network}|${acct.venue}|${acct.accountRef}|${JSON.stringify(fit.rule)}`).digest('hex').slice(0, 24);
  return ProposalIn.parse({ wallet, network, venue: acct.venue, accountRef: acct.accountRef, structural_risk: text.structural_risk, proposed_rule: fit.rule, reasoning: text.reasoning, metrics: fit.metrics, idempotencyKey: `prop-${key}` });
}

/** True if the user's existing rule for this account already matches the proposal (nothing to ask). */
export function alreadyApplied(cfg: AgentConfig, p: ProposalIn): boolean {
  const r = cfg.rebalance.rules.find((x) => ruleKey(x) === ruleKey(p));
  const bps = (f: number) => Math.round(f * 10_000);
  return !!r && r.enabled && Math.abs((r.triggerBps ?? 0) - bps(p.proposed_rule.top_up_trigger)) <= 100 && Math.abs((r.targetBps ?? 0) - bps(p.proposed_rule.restore_target)) <= 100;
}

export interface ProposeDeps {
  getAsterCreds: typeof app.getAsterCreds;
  asterAccount: typeof aster.getAccount;
  vol1h: typeof metrics.vol1h;
  latency: typeof metrics.topUpLatencySec;
  funds: (wallet: string, symbols: string[]) => ReturnType<typeof bsc.getFunds>;
  post: typeof app.postProposal;
  /** Price integrity of the bStocks; only called when config.integrity.enabled. Omitted = flat haircut. */
  integrity?: (funds: BscFunds, cfg: AgentConfig) => Promise<IntegritySnapshot | null>;
}
export const realProposeDeps: ProposeDeps = {
  getAsterCreds: app.getAsterCreds, asterAccount: aster.getAccount, vol1h: metrics.vol1h, latency: metrics.topUpLatencySec,
  funds: (w, s) => bsc.getFunds(w, bsc.agentAddress(), s, pancake.priceOf), post: app.postProposal,
  integrity: (funds, cfg) => refreshIntegrity({ funds, cfg }),
};

/** One analysis pass for a wallet's perps (Aster) account. Returns what happened; never throws. */
export async function proposeForWallet(wallet: string, network: Network, cfg: AgentConfig, deps: ProposeDeps = realProposeDeps): Promise<string> {
  try {
    const creds = await deps.getAsterCreds(wallet, network);
    const a = await deps.asterAccount(network, creds);
    if (!a.account) return 'perps account has no deposit yet';
    const { equityUsd: equity, freeUsd } = aster.equityOf(a); const used = Math.max(0, equity - freeUsd);
    const positions = a.positions.map((p) => ({ ticker: tickerOfAster(p.symbol) ?? p.symbol, symbol: p.symbol, valueUsd: Math.abs(Number(p.notional ?? 0)) })).filter((p) => p.valueUsd > 0);
    if (!positions.length || used <= 0 || equity <= 0) return 'no open positions to protect';
    const top = positions.sort((x, y) => y.valueUsd - x.valueUsd)[0];
    const vol = await deps.vol1h(network, top.ticker);
    if (vol === null) return 'volatility unavailable (fail closed)';
    const symbols = [...new Set([...cfg.hedge.legs.map((l) => l.bstock), ...cfg.rebalance.sellOrder])];
    const { funds, problems } = await deps.funds(wallet, symbols);
    if (problems.length) return `funds unreadable: ${problems.join('; ')}`;
    const hair = cfg.collateral.bstockHaircut;
    let afterHaircutUsd = funds.bstocks.reduce((s, b) => s + b.value, 0) * (1 - hair);
    if (cfg.integrity?.enabled && deps.integrity) {
      // Each bStock counts at its own (never lower) haircut; unassessed or unavailable tokens keep the flat one.
      try { const r = await deps.integrity(funds, cfg); if (r) afterHaircutUsd = funds.bstocks.reduce((s, b) => s + b.value * (1 - effectiveHaircut(r.items.find((a) => a.symbol === b.symbol), hair, true)), 0); } catch { /* flat haircut */ }
    }
    const inputs: FitInputs = {
      vol1h: vol, latencySec: deps.latency('aster').sec, leverage: positions.reduce((s, p) => s + p.valueUsd, 0) / used, utilNow: used / equity, equityUsd: equity, usedUsd: used,
      bnbStablesUsd: funds.usdcUsd + funds.usdtUsd, bstocksAfterHaircutUsd: afterHaircutUsd, haircutPct: hair * 100,
    };
    const p = await buildProposal(wallet, network, { venue: 'aster', accountRef: '', equityUsd: equity, usedUsd: used, positions: positions.slice(0, 5).map((x) => ({ symbol: x.symbol, valueUsd: Math.round(x.valueUsd) })) }, inputs);
    if (alreadyApplied(cfg, p)) return 'current rule already matches the fitted proposal';
    const r = await deps.post(p);
    return r.duplicate ? 'same proposal already submitted' : `proposal #${r.id} submitted for approval`;
  } catch (e) { return `skipped: ${e instanceof Error ? e.message : String(e)}`; }
}
