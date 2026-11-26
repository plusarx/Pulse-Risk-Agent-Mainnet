import { createHash } from 'node:crypto';
import { planFunding } from '../../../lib/plan';
import { ruleKey, type RiskRule } from '../../../lib/risk-rules';
import { minDepositBase } from '../tools/venueRules';
import type { ActionPost } from '../tools/appApi';
import type { Candidate, Snapshot } from '../types';
import { haircutArg } from '../tools/integrity';

// Funds the user asks to move between their BNB wallet and a venue account in the chat ("add $500 to my perps account", "send $300 of idle margin back").
// Same as every other chat action: the chat only posts a request, nothing moves until Approve, and on approval the live agent rebuilds the move
// from this spec against fresh balances and runs it through the same guard (allowance, per-move and daily caps, reserve, kill switch) and the
// same executor as the rule-driven moves. Adding uses BNB USDC/USDT only: the chat never sells bStocks to fund a move.

export interface ChatFundSpec { direction: 'add' | 'withdraw'; ruleKey: string; venue: 'aster' | 'derive'; /** USDC base units (6 dp) */ amountBaseUnit: string; amountUsd: string; label: string }

const usdText = (base: string) => `$${(Number(BigInt(base)) / 1e6).toFixed(2)}`;
export const toBase = (usd: number) => String(BigInt(Math.floor(usd * 100)) * 10_000n);
export const ruleLabel = (r: { venue: string; accountRef: string }) => r.venue === 'derive' ? `Derive ${r.accountRef === '' ? 'main account' : `account #${r.accountRef}`}` : 'perps account';
export const describeRules = (rules: { venue: string; accountRef: string }[]) => rules.map((r) => `${ruleLabel(r)} (${ruleKey(r)})`).join('; ') || 'none';

/** Which saved account rule the user means. The move runs through that rule's account, so the account must be one the user set up on the Risk page. */
export function resolveRule(rules: { venue: string; accountRef: string }[], venue: 'aster' | 'derive', account?: string): RiskRule {
  const mine = rules.filter((r) => r.venue === venue) as RiskRule[]; const ref = (account ?? '').trim().toLowerCase().replace(/^#/, '').replace(/\s*account$/, '').trim();
  const fail = (why: string): never => { throw new Error(`${why}. Accounts you have set up for ${venue === 'aster' ? 'perps' : 'Derive'} on the Risk page: ${describeRules(mine)}`); };
  if (!mine.length) return fail(`You have no ${venue === 'aster' ? 'perps' : 'Derive'} account set up on the Risk page yet`);
  if (!ref || ref === 'main' || ref === 'default') { const m = venue === 'aster' ? mine.filter((r) => r.accountRef === '') : mine; return m.length === 1 ? m[0] : fail('Tell me which account'); }
  return mine.find((r) => r.accountRef.toLowerCase() === ref) ?? fail(`"${account}" is not one of your set-up accounts`);
}

/** The candidate the executor runs, or the plain reason it cannot be made. Built fresh each time from the spec and the current snapshot. */
export function fundCandidate(s: Snapshot, spec: ChatFundSpec, key: string): { c: Candidate | null; problem: string | null } {
  const rule = s.config.rebalance.rules.find((r) => ruleKey(r) === spec.ruleKey);
  if (!rule) return { c: null, problem: `${spec.label} is no longer set up on the Risk page` };
  if (rule.venue !== 'aster' && rule.venue !== 'derive') return { c: null, problem: `${spec.label} is on a retired venue; set up the perps account on the Risk page` };
  const venue = rule.venue;
  const amt = BigInt(spec.amountBaseUnit); const usd = Number(amt) / 1e6; const health = s.health[spec.ruleKey];
  if (amt < BigInt(rule.minMoveBaseUnit)) return { c: null, problem: `${usdText(spec.amountBaseUnit)} is under the ${usdText(rule.minMoveBaseUnit)} minimum move for ${spec.label}` };
  const base = { ruleKey: spec.ruleKey, venue, amountBaseUnit: spec.amountBaseUnit, idempotencyKey: key, urgency: 0, rule: rule as RiskRule, chat: true } as const;
  if (spec.direction === 'withdraw') {
    // The perps agent key cannot withdraw (canWithdraw=false by design).
    if (venue === 'aster') return { c: null, problem: 'withdrawals from perps need your wallet signature in the app; the agent cannot take money out of your perps account' };
    if (health?.accountUsd != null && health.usedUsd != null && usd > health.accountUsd - health.usedUsd + 1e-9) return { c: null, problem: `only $${Math.max(0, health.accountUsd - health.usedUsd).toFixed(2)} is free in ${spec.label}; the rest backs open positions` };
    return { c: { ...base, id: `chat-fund:release:${spec.ruleKey}:${spec.amountBaseUnit}`, kind: 'release', reason: `You asked in the chat: take ${usdText(spec.amountBaseUnit)} out of ${spec.label}`,
      explain: `Withdraw ${usdText(spec.amountBaseUnit)} from ${spec.label} to your own Ethereum wallet (it does not come back to BNB Chain).` }, problem: null };
  }
  if (amt < minDepositBase(venue)) return { c: null, problem: `${venue === 'aster' ? 'Perps' : 'Derive'} needs at least ${usdText(minDepositBase(venue).toString())} per deposit` };
  const cfg = s.config; const reserveUsd = Number(BigInt(cfg.rebalance.keepBscReserveBaseUnit)) / 1e6; const allowUsd = Number(BigInt(s.bsc.allowanceUsdcBase)) / 1e6; const allowUsdtUsd = Number(BigInt(s.bsc.allowanceUsdtBase ?? '0')) / 1e6;
  const fp = planFunding(spec.amountBaseUnit, { bscUsdc: Math.min(s.bsc.usdcUsd, allowUsd + reserveUsd), bscUsdt: Math.min(s.bsc.usdtUsd, allowUsdtUsd + Math.max(0, reserveUsd - s.bsc.usdcUsd)), bstocks: [] }, cfg.rebalance, haircutArg(s));
  if (fp.shortfallUsd > 0) return { c: null, problem: `your BNB wallet cash is short by $${fp.shortfallUsd} (USDC/USDT you allowed the agent to use, after the $${reserveUsd} it keeps back). The chat does not sell your bStocks to fund a move` };
  if (fp.sources.some((x) => x.source.startsWith('sell'))) return { c: null, problem: 'this would need selling bStocks, which the chat does not do' };
  return { c: { ...base, id: `chat-fund:top_up:${spec.ruleKey}:${spec.amountBaseUnit}`, kind: 'top_up', reason: `You asked in the chat: add ${usdText(spec.amountBaseUnit)} to ${spec.label}`, funding: fp.sources,
    explain: `Add ${usdText(spec.amountBaseUnit)} USDC to ${spec.label} (${fp.sources.map((x) => `$${x.amountUsd} from BNB ${x.source === 'bsc_usdt' ? 'USDT' : 'USDC'}`).join(' and ')}), ${venue === 'aster' ? 'swapped to USDT and deposited on BNB Chain (no bridge)' : 'bridged and deposited'}.` }, problem: null };
}

export function fundRequest(s: Snapshot, spec: ChatFundSpec, c: Candidate, now = Date.now()): ActionPost {
  const key = `act-fund-${createHash('sha256').update(`${s.wallet.toLowerCase()}|${s.network}|${spec.ruleKey}|${spec.direction}|${spec.amountBaseUnit}|${Math.floor(now / 600_000)}`).digest('hex').slice(0, 20)}`;
  const add = spec.direction === 'add'; const usd = usdText(spec.amountBaseUnit);
  return {
    wallet: s.wallet, network: s.network, kind: add ? 'top_up' : 'release', venue: spec.venue, origin: 'chat', slot: `chat-fund:${spec.ruleKey}`.slice(0, 60),
    title: `${add ? `Add ${usd} to` : `Withdraw ${usd} from`} ${spec.label} (you asked in chat)`.slice(0, 160),
    why: `You asked for this in the chat. ${c.explain} On approval the agent re-reads your balances and runs it through the same checks as every other move (your allowance, per-move and daily caps, the BNB reserve and the kill switch); if any fails nothing moves. Only your own accounts are used.`.slice(0, 800),
    helps: (add ? `More margin in ${spec.label}, so it sits further from liquidation.` : `Takes idle margin out of ${spec.label}.`).slice(0, 500),
    willDo: add
      ? [`pull ${usd} of USDC from your BNB wallet using the allowance you gave the agent`, spec.venue === 'aster' ? `swap it to USDT and deposit it into ${spec.label} on BNB Chain (no bridge)` : `bridge it and deposit it into ${spec.label}`]
      : [`withdraw ${usd} from ${spec.label} to your own Ethereum wallet (it takes about 14 minutes and lands on Ethereum, not BNB Chain)`],
    detail: { candidateId: c.id, kind: c.kind, ruleKey: spec.ruleKey, amountBaseUnit: spec.amountBaseUnit, hedgeMarket: null, hedgeKey: null, hedgeDelta: null, optionContracts: null, chatFund: spec },
    idempotencyKey: key,
  };
}
