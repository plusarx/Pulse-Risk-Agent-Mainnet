// Price integrity for bStock collateral: is the price we hold these tokens at one we can trust?
//
// Four independent views of the same stock are compared:
//   * Atlas       the on-chain oracle feed for the bStock token (price, age, consensus score and status)
//   * CMC DEX     CoinMarketCap's DEX data for the token contract (price and pool liquidity)
//   * perp        the underlying stock's perpetual on the perps venue (the anchor: it is the real stock's price)
//   * reference   the price the app already uses (Binance spot / PancakeSwap)
//
// A verdict per token:
//   ok           everything agrees; collateral counted at the user's own haircut
//   watch        something is off but usable; the haircut is raised
//   block        do not rely on this price: the agent will not hedge or top up against it
//   unavailable  fewer than two sources could be read: behave exactly as before (never block on OUR outage)
//
// Safety property: the dynamic haircut can only ADD to the user's haircut, never go below it.
// Pure: no network, no clock (the caller passes ages), so every rule is testable.

export const INTEGRITY_LIMITS = {
  /** Atlas pushes on a 60 s heartbeat: three missed beats is stale. */
  atlasMaxAgeSec: 180,
  scoreWatch: 0.85,
  scoreBlock: 0.7,
  /** Gap to the underlying's perp, as a fraction (0.015 = 1.5%). */
  gapWatch: 0.015,
  gapBlock: 0.04,
  /** Pool liquidity below this: the token cannot be sold at size, so it is not collateral worth trusting. */
  liquidityBlockUsd: 100_000,
  maxHaircut: 0.9,
} as const;

export interface AtlasQuote { price: number; ageSec: number; score: number | null; status: string | null }
export interface DexQuote { price: number; liquidityUsd: number; volume24hUsd?: number | null }

export interface IntegrityInput {
  symbol: string;
  atlas: AtlasQuote | null;
  dex: DexQuote | null;
  /** Mark price of the underlying stock's perp. */
  perp: number | null;
  /** The price the app already uses for this token. */
  reference: number | null;
  /** The user's own haircut (0.3 = 30%): the floor of the result. */
  baseHaircut: number;
}

export type Verdict = 'ok' | 'watch' | 'block' | 'unavailable';

export interface Assessment {
  symbol: string;
  verdict: Verdict;
  /** What collateral is discounted by: >= baseHaircut, <= maxHaircut (a blocked token gets maxHaircut). */
  haircut: number;
  baseHaircut: number;
  /** Plain-language reasons, worst first. Empty when everything agrees. */
  reasons: string[];
  /** |price / perp - 1| per source (null when that source or the perp is missing). */
  gaps: { atlas: number | null; dex: number | null; reference: number | null };
  atlas: AtlasQuote | null;
  dex: DexQuote | null;
  perp: number | null;
  reference: number | null;
  /** How many of the four views were available. */
  sources: number;
}

const gapTo = (p: number | null | undefined, anchor: number | null): number | null =>
  p && anchor && p > 0 && anchor > 0 ? Math.abs(p / anchor - 1) : null;
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const usd = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;

/** Extra haircut for how easily the token can be sold: deeper pools discount less. null = too thin to trust. */
export function liquidityAdd(liquidityUsd: number): number | null {
  if (liquidityUsd < INTEGRITY_LIMITS.liquidityBlockUsd) return null;
  if (liquidityUsd >= 1_000_000) return 0;
  if (liquidityUsd >= 500_000) return 0.02;
  if (liquidityUsd >= 250_000) return 0.04;
  return 0.06;
}

export function assess(i: IntegrityInput): Assessment {
  const L = INTEGRITY_LIMITS;
  const views = [i.atlas?.price, i.dex?.price, i.perp, i.reference].filter((x): x is number => typeof x === 'number' && x > 0).length;
  const base = Math.min(L.maxHaircut, Math.max(0, i.baseHaircut));
  const out: Assessment = {
    symbol: i.symbol, verdict: 'ok', haircut: base, baseHaircut: base, reasons: [], gaps: { atlas: null, dex: null, reference: null },
    atlas: i.atlas, dex: i.dex, perp: i.perp, reference: i.reference, sources: views,
  };
  // Not enough independent views to judge: do nothing different from today.
  if (views < 2) { out.verdict = 'unavailable'; out.reasons = [`only ${views} price source${views === 1 ? '' : 's'} could be read`]; return out; }

  // Anchor: the underlying's perp; without it, the middle of the on-chain views.
  const others = [i.atlas?.price, i.dex?.price, i.reference].filter((x): x is number => typeof x === 'number' && x > 0).sort((a, b) => a - b);
  const anchor = i.perp && i.perp > 0 ? i.perp : others.length ? others[Math.floor((others.length - 1) / 2)] : null;
  out.gaps = { atlas: gapTo(i.atlas?.price, anchor), dex: gapTo(i.dex?.price, anchor), reference: gapTo(i.reference, anchor) };

  const block: string[] = []; const watch: string[] = []; let add = 0;

  // Oracle freshness and health.
  if (i.atlas) {
    if (i.atlas.ageSec > L.atlasMaxAgeSec) block.push(`Atlas price is ${Math.round(i.atlas.ageSec)} s old (limit ${L.atlasMaxAgeSec} s): the oracle is stale`);
    if (i.atlas.score !== null && i.atlas.score < L.scoreBlock) block.push(`Atlas consensus score ${i.atlas.score.toFixed(2)} is below ${L.scoreBlock}`);
    else if ((i.atlas.status ?? '').toUpperCase() === 'DEGRADED' || (i.atlas.score !== null && i.atlas.score < L.scoreWatch)) {
      watch.push(`Atlas marks this feed ${(i.atlas.status ?? 'degraded').toLowerCase()}${i.atlas.score !== null ? ` (consensus ${i.atlas.score.toFixed(2)})` : ''}`); add += 0.03;
    }
  }

  // Disagreement with the real stock's price.
  const named: [string, number | null][] = [['Atlas', out.gaps.atlas], ['DEX', out.gaps.dex], ['reference', out.gaps.reference]];
  const worst = named.filter((n): n is [string, number] => n[1] !== null).sort((a, b) => b[1] - a[1])[0];
  if (worst) {
    const anchorName = i.perp && i.perp > 0 ? "the stock's perp" : 'the other sources';
    if (worst[1] >= L.gapBlock) block.push(`${worst[0]} price is ${pct(worst[1])} away from ${anchorName} (limit ${pct(L.gapBlock)})`);
    else if (worst[1] >= L.gapWatch) { watch.push(`${worst[0]} price is ${pct(worst[1])} away from ${anchorName}`); add += Math.min(0.1, worst[1] * 2); }
  }

  // Can the token be sold?
  if (i.dex) {
    const la = liquidityAdd(i.dex.liquidityUsd);
    if (la === null) block.push(`DEX liquidity is only ${usd(i.dex.liquidityUsd)} (minimum ${usd(L.liquidityBlockUsd)})`);
    else if (la > 0) { watch.push(`DEX liquidity ${usd(i.dex.liquidityUsd)} is limited`); add += la; }
  }

  out.reasons = [...block, ...watch];
  if (block.length) { out.verdict = 'block'; out.haircut = L.maxHaircut; }
  else if (watch.length) { out.verdict = 'watch'; out.haircut = Math.min(L.maxHaircut, base + add); }
  return out;
}

/** The haircut collateral is counted at: the user's own when the layer is off or the token is unassessed. */
export function effectiveHaircut(a: Assessment | undefined, base: number, enabled: boolean): number {
  if (!enabled || !a || a.verdict === 'unavailable') return base;
  return Math.max(base, a.haircut);
}

/** Whether the agent may act against this token's price. Only a blocked token is refused, and only while the layer is on. */
export function mayRely(a: Assessment | undefined, enabled: boolean): { ok: true } | { ok: false; reason: string } {
  if (!enabled || !a || a.verdict !== 'block') return { ok: true };
  return { ok: false, reason: `${a.symbol} price is not trusted: ${a.reasons[0] ?? 'sources disagree'}` };
}
