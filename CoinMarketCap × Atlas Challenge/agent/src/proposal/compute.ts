import type { ProposedRule } from '../../../lib/agent-proposal';

// Deterministic rule fitting. The LLM never sets these numbers: code derives them from volatility, latency and
// leverage, and the human approves them in the UI. The LLM only explains them afterwards.

export interface FitParams { maxUtil: number; kSigma: number; volStress: number; minTrigger: number; maxTrigger: number; tickSec: number }

export interface FitInputs {
  /** Realised 1h volatility as a fraction (0.041 = 4.1%). */
  vol1h: number;
  /** Seconds for a top-up to land (measured median, else default). */
  latencySec: number;
  /** Position notional ÷ margin used (leverage of the book). */
  leverage: number;
  /** Utilization now, 0..1. */
  utilNow: number;
  equityUsd: number;
  usedUsd: number;
  /** Spendable BNB stables (USDC + USDT) and bStock collateral value after haircut. */
  bnbStablesUsd: number;
  bstocksAfterHaircutUsd: number;
  /** The bStock haircut in percent (30 = 30%). Used to show the value before the haircut. Defaults to 30. */
  haircutPct?: number;
}

/** $7,000 (whole dollars, thousands separators). */
const money = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;

export interface Fit {
  rule: ProposedRule;
  /** Numbers shown to the approver next to the proposal. */
  metrics: Record<string, number | string | null>;
  /** Plain facts the LLM must cover. */
  facts: string[];
  /** Estimated top-up size if the trigger fired now (USD), for source selection. */
  estTopUpUsd: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * The trigger leaves enough room to survive a k-sigma adverse move during the time a top-up takes to land
 * (detection cycle + transfer). With margin M, notional N = L·M, equity E = M/u at the trigger and a loss
 * k·σ·√τ·N, utilization stays below `maxUtil` when  u ≤ 1 / (1/maxUtil + k·σ·√τ·L).
 */
export function fitRule(i: FitInputs, p: FitParams): Fit {
  const tau = p.tickSec + i.latencySec;                       // seconds exposed before funds land
  const sigmaTau = i.vol1h * p.volStress * Math.sqrt(tau / 3600);
  const raw = 1 / (1 / p.maxUtil + p.kSigma * sigmaTau * i.leverage);
  const trigger = r2(clamp(raw, p.minTrigger, p.maxTrigger));
  const restore = r2(Math.max(0.25, trigger - 0.17));
  const release = r2(Math.max(0.1, restore - 0.2));

  // How much a top-up would need to be if it fired right now at the trigger, restoring to `restore`.
  const estTopUpUsd = i.usedUsd > 0 ? Math.max(0, i.usedUsd / restore - i.usedUsd / trigger) : 0;
  const stablesOk = i.bnbStablesUsd >= Math.max(estTopUpUsd, 1);
  const bstocksOk = i.bstocksAfterHaircutUsd >= Math.max(estTopUpUsd, 1);
  const primary: ProposedRule['primary_source'] = stablesOk ? 'exchange_wallet' : bstocksOk ? 'bstocks_bnb' : 'exchange_wallet';

  const facts: string[] = [
    `Realised 1h volatility is ${(i.vol1h * 100).toFixed(1)}%; the book is ${i.leverage.toFixed(1)}x leveraged.`,
    `A top-up takes about ${Math.round(i.latencySec)}s to land and the agent checks every ${p.tickSec}s, so the account is exposed for about ${Math.round(tau)}s.`,
    `A ${p.kSigma}-sigma move (volatility stressed x${p.volStress}) in that window must not push utilization past ${Math.round(p.maxUtil * 100)}%, which gives a trigger of ${Math.round(trigger * 100)}%${raw !== trigger ? ` (limited to the allowed range ${Math.round(p.minTrigger * 100)}-${Math.round(p.maxTrigger * 100)}%)` : ''}.`,
  ];
  if (i.bnbStablesUsd < 1) facts.push('The BNB wallet has no USDC or USDT, so funding from stables cannot fire.');
  const hair = i.haircutPct ?? 30;
  const worth = hair < 100 ? i.bstocksAfterHaircutUsd / (1 - hair / 100) : i.bstocksAfterHaircutUsd;
  const stocksText = `${money(worth)} value, ${money(i.bstocksAfterHaircutUsd)} after the ${Math.round(hair)}% haircut`;
  // Stables come first; bStocks are only the fallback, because selling one is final.
  if (!stablesOk && bstocksOk) facts.push(`BNB stables (${money(i.bnbStablesUsd)}) cannot cover an estimated top-up of ${money(estTopUpUsd)}. Your bStocks (${stocksText}) could cover it by being sold, which is final; to avoid a sale, add USDC or USDT to the BNB wallet.`);
  if (!stablesOk && !bstocksOk) facts.push(`Neither BNB stables (${money(i.bnbStablesUsd)}) nor bStocks (${stocksText}) can cover an estimated top-up of ${money(estTopUpUsd)}: no source has capacity.`);
  if (i.utilNow >= trigger) facts.push(`Utilization is already ${Math.round(i.utilNow * 100)}%, above the proposed trigger.`);

  return {
    rule: { top_up_trigger: trigger, restore_target: restore, release_trigger: release, primary_source: primary },
    metrics: {
      vol_1h_pct: r2(i.vol1h * 100), latency_sec: Math.round(i.latencySec), leverage: r2(i.leverage), utilization_pct: r2(i.utilNow * 100),
      worst_case_move_pct: r2(p.kSigma * sigmaTau * 100), bnb_stables_usd: r2(i.bnbStablesUsd), bstocks_usd: r2(i.bstocksAfterHaircutUsd),
    },
    facts, estTopUpUsd,
  };
}

/** Plain-text fallback used when the LLM is off or unavailable. */
export function draftText(f: Fit): { structural_risk: string; reasoning: string } {
  const r = f.rule;
  return {
    structural_risk: `The account is leveraged ${f.metrics.leverage}x, so a sharp move can liquidate it before a top-up lands.${f.facts.some((x) => x.includes('no USDC')) ? ' The BNB wallet is empty of stables.' : ''}`,
    reasoning: `${f.facts.join(' ')} Proposed: top up above ${Math.round(r.top_up_trigger * 100)}%, restore to ${Math.round(r.restore_target * 100)}%, release below ${Math.round(r.release_trigger * 100)}%, funded from ${r.primary_source === 'bstocks_bnb' ? 'bStocks on BNB (sold, after USDC and USDT)' : 'USDC/USDT on BNB'}.`.slice(0, 1000),
  };
}
