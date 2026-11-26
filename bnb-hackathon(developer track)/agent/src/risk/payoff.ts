import type { Candidate, Snapshot } from '../types';
import { tickerOf } from './market';

// Payoff before and after a hedge: profit and loss on the hedged name for a range of moves in its price, at the
// hedge's horizon. "Before" is the holding alone; "after" adds the hedge the agent chose, net of what it costs.
// A proxy short is shown at its EXPECTED offset (correlation x volatility ratio), and the label says so.

export type PayoffHedge =
  | { kind: 'perp'; shortUsd: number; feesUsd: number }
  | { kind: 'proxy'; shortUsd: number; feesUsd: number; via: string; beta: number; sigmaHolding: number; sigmaVia: number }
  | { kind: 'put'; contracts: number; strike: number; spot: number; premiumUsd: number; feesUsd: number };

export interface PayoffPoint { movePct: number; beforeUsd: number; afterUsd: number }
export interface Payoff { ticker: string; holdingUsd: number; hedgeLabel: string; costUsd: number; points: PayoffPoint[]; note: string }

export const PAYOFF_MOVES = [-30, -25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25, 30];
const r2 = (x: number) => Math.round(x * 100) / 100;

export function payoff(ticker: string, holdingUsd: number, h: PayoffHedge, moves = PAYOFF_MOVES): Payoff {
  const cost = h.kind === 'put' ? h.premiumUsd + h.feesUsd : h.feesUsd;
  const hedgeAt = (r: number): number => {
    if (h.kind === 'perp') return -h.shortUsd * r;
    if (h.kind === 'proxy') return -h.shortUsd * r * ((h.beta * h.sigmaVia) / Math.max(h.sigmaHolding, 1e-9));
    return h.contracts * Math.max(0, h.strike - h.spot * (1 + r));
  };
  const points = moves.map((m) => { const r = m / 100; const before = holdingUsd * r; return { movePct: m, beforeUsd: r2(before), afterUsd: r2(before + hedgeAt(r) - cost) }; });
  const label = h.kind === 'perp' ? `Short $${r2(h.shortUsd)} ${ticker} perp`
    : h.kind === 'proxy' ? `Short $${r2(h.shortUsd)} ${h.via} perp (proxy for ${ticker}, correlation ${h.beta})`
    : `${h.contracts} ${ticker} put${h.contracts === 1 ? '' : 's'} at strike ${h.strike} on Derive`;
  const note = h.kind === 'put' ? `Put: the loss below the strike is covered; the upside is kept, minus $${r2(cost)} premium and fees. Profit and loss at expiry.`
    : h.kind === 'proxy' ? `Proxy: the offset shown is the expected one; with correlation ${h.beta} about ${Math.round(Math.sqrt(Math.max(0, 1 - h.beta ** 2)) * 100)}% of ${ticker}'s risk stays. Fees $${r2(cost)}; funding not included.`
    : `Perp short: moves 1:1 against the holding, so both losses and gains are offset. Fees $${r2(cost)}; funding not included.`;
  return { ticker, holdingUsd: r2(holdingUsd), hedgeLabel: label, costUsd: r2(cost), points, note };
}


/** Payoff for the hedge a run chose, built from the snapshot it ran on. null when the choice is not a hedge. */
export function payoffForChoice(s: Snapshot, c: Candidate | null | undefined): Payoff | null {
  const h = c?.kind === 'hedge' ? c.hedge : undefined; if (!h) return null;
  const ticker = h.proxyFor ?? h.ticker ?? tickerOf(h.bstock);
  const held = s.bsc.bstocks.filter((b) => tickerOf(b.symbol) === ticker && b.qty > 0);
  const holdingUsd = held.reduce((a, b) => a + b.value, 0); if (!(holdingUsd > 0)) return null;
  if (h.option) {
    const spot = s.options?.[ticker]?.spot ?? held.reduce((a, b) => a + b.value, 0) / held.reduce((a, b) => a + b.qty, 0);
    return payoff(ticker, holdingUsd, { kind: 'put', contracts: h.option.contracts, strike: h.option.strike, spot, premiumUsd: h.option.premiumUsd, feesUsd: h.option.feesUsd });
  }
  if (!(h.deltaToShort > 0)) return null;   // buying back a short is not a new hedge
  const px = h.hedgePrice ?? (h.proxyFor ? s.proxyPrices?.[h.market] : undefined) ?? holdingUsd / held.reduce((a, b) => a + b.qty, 0);
  const shortUsd = h.deltaToShort * px;
  const pm = h.proxyFor ? s.config.risk.proxyMap?.[ticker] : undefined;
  const sh = s.market?.sigmaDay[ticker]; const sv = s.market?.sigmaDay[h.market];
  if (h.proxyFor && pm && sh && sv) return payoff(ticker, holdingUsd, { kind: 'proxy', shortUsd, feesUsd: 0, via: h.market, beta: pm.beta, sigmaHolding: sh, sigmaVia: sv });
  return payoff(ticker, holdingUsd, { kind: 'perp', shortUsd, feesUsd: 0 });
}
