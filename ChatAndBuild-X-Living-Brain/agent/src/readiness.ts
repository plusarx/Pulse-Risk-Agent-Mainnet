import { ASTER_MIN_NOTIONAL_USD } from '../../lib/aster';
import type { Snapshot } from './types';
import { haircutFor } from './tools/integrity';

// "Needs your attention": everything that would silently stop the agent from acting on its own, each with the fix.
// Pure: the tick loop gathers the few live numbers (dry-run flag, agent gas) and passes them in.

export interface ReadinessEnv {
  /** config().live: false = dry run (decides, never sends). */
  live: boolean;
  agentBsc: string | null;
  /** Agent's BNB on BNB Chain (gas for pulls, swaps and the perps deposit), wei. null = could not read. */
  agentBnbWei: bigint | null;
  /** Agent's ETH on Ethereum (gas for Derive deposits), wei. null = not needed or could not read. */
  agentEthWei: bigint | null;
}

export const MIN_AGENT_BNB_WEI = 500_000_000_000_000n;   // 0.0005 BNB: dozens of BSC transactions at 0.05 gwei
export const MIN_AGENT_ETH_WEI = 300_000_000_000_000n;   // 0.0003 ETH: one Derive approve + deposit
const PERP_MIN_ORDER_USD = ASTER_MIN_NOTIONAL_USD;   // perps (Aster) minimum order notional: $5
const DERIVE_TOPUP_MIN_USD = 8;
const eth = (w: bigint) => (Number(w) / 1e18).toFixed(5);
const usd = (n: number) => `$${n.toFixed(2)}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function readinessAlerts(s: Snapshot, env: ReadinessEnv): string[] {
  const cfg = s.config; const out: string[] = [];
  const rules = cfg.rebalance.enabled ? cfg.rebalance.rules.filter((r) => r.enabled) : [];
  const hedging = cfg.hedge.enabled;
  const wantsToAct = rules.length > 0 || hedging;
  if (!wantsToAct) return out;

  if (!env.live) out.push(cfg.mode === 'autonomous'
    ? 'Auto mode is on, but the agent is in dry run: it decides and never sends. To let it act, set DRY_RUN=false and ALLOW_LIVE=yes-i-understand in agent/.env and restart it.'
    : 'The agent is in dry run: it decides and never sends. Set DRY_RUN=false and ALLOW_LIVE=yes-i-understand in agent/.env to let it act.');

  if (!env.agentBsc) out.push('The agent has no BNB Chain wallet (AGENT_BSC_PRIVATE_KEY is empty), so it cannot move margin.');
  else if (env.agentBnbWei !== null && env.agentBnbWei < MIN_AGENT_BNB_WEI && rules.length) out.push(`The agent wallet ${short(env.agentBsc)} has ${eth(env.agentBnbWei)} BNB for gas; it needs about 0.002 BNB to move margin. Send a little BNB to it on BNB Smart Chain.`);

  if (rules.some((r) => r.venue === 'derive') && env.agentEthWei !== null && env.agentEthWei < MIN_AGENT_ETH_WEI && env.agentBsc) out.push(`Derive top-ups deposit on Ethereum: the agent's address ${short(env.agentBsc)} has ${eth(env.agentEthWei)} ETH there and needs about 0.0003 ETH. Send a little ETH to it on Ethereum.`);

  for (const r of rules.filter((x) => x.venue === 'derive' && Number(BigInt(x.minMoveBaseUnit)) / 1e6 < DERIVE_TOPUP_MIN_USD)) out.push(`Your Derive rule${r.accountLabel ? ` (${r.accountLabel})` : ''} has a minimum move under ${usd(DERIVE_TOPUP_MIN_USD)}; Derive top-ups need at least ${usd(DERIVE_TOPUP_MIN_USD)} because the bridge fee comes off the amount. Raise it on the Risk page.`);

  // Budget: what the agent is allowed to pull (USDC allowance, plus bStocks it may sell) vs the smallest top-up.
  if (rules.length) {
    const minMove = Math.min(...rules.map((r) => Number(BigInt(r.minMoveBaseUnit)) / 1e6));
    const usdcAllowed = Number(BigInt(s.bsc.allowanceUsdcBase || '0')) / 1e6;
    const sellable = cfg.rebalance.sources.includes('sell_bstocks') ? s.bsc.bstocks.filter((b) => cfg.rebalance.sellOrder.includes(b.symbol) && (b.allowanceQty ?? 0) > 0).reduce((a, b) => a + Math.min(b.qty, b.allowanceQty ?? 0) * (b.qty > 0 ? b.value / b.qty : 0) * (1 - haircutFor(s, b.symbol)), 0) : 0;
    if (usdcAllowed + sellable < minMove) out.push(`No budget for top-ups: the agent may use ${usd(usdcAllowed + sellable)}, the smallest top-up is ${usd(minMove)}. Allow at least ${usd(minMove)} under "Agent budget for top-ups" on the Risk page.`);
  }

  if (hedging) {
    for (const leg of cfg.hedge.legs.filter((l) => l.venue === 'aster')) {
      const b = s.bsc.bstocks.find((x) => x.symbol === leg.bstock && x.qty > 0);
      if (b && b.value * leg.hedgeRatio < PERP_MIN_ORDER_USD) out.push(`${leg.market}: your ${leg.bstock} is ${usd(b.value)}, so its hedge would be under the perps venue's ${usd(PERP_MIN_ORDER_USD)} minimum order. Hold at least ${usd(PERP_MIN_ORDER_USD / Math.max(leg.hedgeRatio, 0.01))} of ${leg.bstock} for the agent to hedge it.`);
    }
  }

  for (const [venue, why] of Object.entries(s.venueProblems ?? {})) out.push(`${venue === 'aster' ? 'Perps' : 'Options'}: ${why}. Register it on the Agent keys page.`);
  return out;
}
