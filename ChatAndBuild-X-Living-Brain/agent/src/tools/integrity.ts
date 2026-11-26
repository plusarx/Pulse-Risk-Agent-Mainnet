import type { AgentConfig } from '../../../lib/agent-config';
import { TRADEABLE } from '../../../lib/bstocks';
import { effectiveHaircut, mayRely, type Assessment } from '../../../lib/integrity';
import { assessBStocksCached, type IntegrityDeps, type IntegritySnapshot } from '../../../lib/integrity-sources';
import { config } from '../config';
import type { BscFunds, Snapshot } from '../types';

// Price integrity for bStock collateral, agent side. refreshIntegrity reads the sources (through the shared 15 s cache),
// never throws, and gives up after a hard timeout. The helpers below are what every decision uses: when the layer is
// off (or nothing was assessed) they return exactly the user's own flat haircut and never refuse anything.

export interface RefreshInput { funds: BscFunds; cfg: AgentConfig }
export interface RefreshDeps {
  atlasKey?: string;
  fetch?: IntegrityDeps['fetch'];
  now?: () => number;
  timeoutMs?: number;
  /** Tests: replace the real assessor. */
  assess?: (deps: IntegrityDeps, symbols?: string[]) => Promise<IntegritySnapshot>;
}

let lastGood: IntegritySnapshot | null = null;
const LAST_GOOD_MAX_AGE_MS = 5 * 60_000;
export const clearLastGoodIntegrity = () => { lastGood = null; };

/** Held bStocks, the sell order and the hedge legs' bStocks: the names a decision can depend on. */
export function relevantSymbols(input: RefreshInput): string[] {
  const known = new Set(TRADEABLE.map((t) => t.symbol));
  const all = [...input.funds.bstocks.filter((b) => b.qty > 0).map((b) => b.symbol), ...input.cfg.rebalance.sellOrder, ...input.cfg.hedge.legs.map((l) => l.bstock)];
  return [...new Set(all)].filter((x) => known.has(x)).sort();
}

const fresh = (deps: RefreshDeps): IntegritySnapshot | null => (lastGood && (deps.now ?? Date.now)() - lastGood.at < LAST_GOOD_MAX_AGE_MS ? lastGood : null);

export async function refreshIntegrity(input: RefreshInput, deps: RefreshDeps = {}): Promise<IntegritySnapshot | null> {
  const symbols = relevantSymbols(input);
  if (!symbols.length) return null;
  const px = new Map(input.funds.bstocks.map((b) => [b.symbol, b.qty > 0 && b.value > 0 ? b.value / b.qty : null] as const));
  const d: IntegrityDeps = { atlasKey: (deps.atlasKey ?? config().ATLAS_API_KEY) || null, reference: (sym) => px.get(sym) ?? null, baseHaircut: input.cfg.collateral.bstockHaircut, fetch: deps.fetch, now: deps.now };
  const run = deps.assess ?? assessBStocksCached;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([run(d, symbols), new Promise<null>((res) => { timer = setTimeout(() => res(null), deps.timeoutMs ?? 10_000); })]);
    if (r) { lastGood = r; return r; }
    return fresh(deps);                    // timed out: the last good reading (if recent), else unavailable
  } catch { return fresh(deps); }
  finally { if (timer) clearTimeout(timer); }
}

// ---- what decisions use -----------------------------------------------------------------------------------------------------

/** On only when the snapshot says so AND the config still says so (a what-if may switch it off). */
export const integrityOn = (s: Pick<Snapshot, 'integrityEnabled' | 'integrity' | 'config'>): boolean => s.integrityEnabled === true && s.config.integrity?.enabled !== false && !!s.integrity;
export const assessmentFor = (s: Pick<Snapshot, 'integrity'>, symbol: string): Assessment | undefined => s.integrity?.items.find((a) => a.symbol === symbol);

/** The haircut collateral in `symbol` is counted at. Off or unassessed: exactly the flat one. */
export function haircutFor(s: Snapshot, symbol: string): number {
  const base = s.config.collateral.bstockHaircut;
  return integrityOn(s) ? effectiveHaircut(assessmentFor(s, symbol), base, true) : base;
}
/** For planFunding: a per-symbol function when on, the plain number when off (so the old code path is untouched). */
export const haircutArg = (s: Snapshot): number | ((symbol: string) => number) => (integrityOn(s) ? (sym: string) => haircutFor(s, sym) : s.config.collateral.bstockHaircut);

/** Null when the agent may rely on this token's price, else the refusal reason. */
export function blockedReason(s: Snapshot, symbol: string): string | null {
  if (!integrityOn(s)) return null;
  const r = mayRely(assessmentFor(s, symbol), true);
  return r.ok ? null : r.reason;
}

// ---- text shown to the user (never names the perps venue) -------------------------------------------------------------------

const p0 = (x: number) => `${Math.round(x * 100)}%`;
const px = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : `$${x.toFixed(2)}`);

/** One alert line per token that is not ok (watch, block). Empty when the layer is off or everything is fine/unavailable. */
export function integrityAlerts(s: Snapshot): string[] {
  if (!integrityOn(s)) return [];
  const out: string[] = [];
  for (const a of s.integrity!.items) {
    if (a.verdict === 'watch') out.push(`Price integrity: ${a.symbol} is on watch: ${a.reasons.join('; ')}; haircut ${p0(a.haircut)} instead of ${p0(a.baseHaircut)}`);
    else if (a.verdict === 'block') out.push(`Price integrity: ${a.symbol} is BLOCKED: ${a.reasons[0] ?? 'sources disagree'}, the agent will not hedge or top up against it`);
  }
  return out;
}

/** One chat fact per assessed token. */
export function integrityFacts(s: Snapshot): { label: string; value: string }[] {
  if (!integrityOn(s)) return [];
  return s.integrity!.items.map((a) => ({
    label: `Price integrity ${a.symbol}`,
    value: `${a.verdict}; collateral haircut ${p0(a.haircut)} (your own ${p0(a.baseHaircut)}); ${a.sources} price sources read${a.reasons.length ? `; ${a.reasons.join('; ')}` : ''}`,
  }));
}

/** The full read for the get_price_integrity chat tool: each token's prices, gaps, verdict and haircut. */
export function integrityDetail(s: Snapshot): { label: string; value: string }[] {
  if (!s.integrityEnabled || s.config.integrity?.enabled === false) return [{ label: 'Price integrity', value: 'the layer is off: collateral is counted at your own flat haircut and no price is checked' }];
  if (!s.integrity) return [{ label: 'Price integrity', value: 'unavailable right now (the price sources could not be read): the agent behaves as if the layer were off' }];
  const g = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(2)}%`);
  return s.integrity.items.map((a) => ({
    label: `Price integrity ${a.symbol}`,
    value: `${a.verdict}; haircut ${p0(a.haircut)} (your own ${p0(a.baseHaircut)}); Atlas ${px(a.atlas?.price)}${a.atlas ? ` (${Math.round(a.atlas.ageSec)} s old${a.atlas.score !== null ? `, consensus ${a.atlas.score.toFixed(2)}` : ''}${a.atlas.status ? `, ${a.atlas.status}` : ''})` : ''}; CoinMarketCap DEX ${px(a.dex?.price)}${a.dex ? ` (pool liquidity $${Math.round(a.dex.liquidityUsd).toLocaleString('en-US')})` : ''}; stock perp ${px(a.perp)}; app price ${px(a.reference)}; gaps to the perp: Atlas ${g(a.gaps.atlas)}, DEX ${g(a.gaps.dex)}, app ${g(a.gaps.reference)}${a.reasons.length ? `; ${a.reasons.join('; ')}` : '; everything agrees'}`,
  }));
}
