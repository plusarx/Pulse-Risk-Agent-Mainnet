import { hedgeKey, type AgentConfig } from './agent-config';

// Pure planning math shared by the UI preview and (as a reference) the agent service.
// Display floats only — the agent must convert to venue base units with its own decimals.

export interface Funding { bscUsdc: number; bscUsdt: number; bstocks: { symbol: string; value: number }[] }

export interface FundingPlan { sources: { source: string; amountUsd: number }[]; shortfallUsd: number }

/**
 * Which BNB-chain funds pay for a top-up of `amountBaseUnit` (sized by planRule in lib/risk-rules.ts):
 * stables above the reserve first, then bStocks in the user's sell order, valued after the haircut.
 */
export function planFunding(amountBaseUnit: string, funding: Funding, cfg: AgentConfig['rebalance'], haircut: number | ((symbol: string) => number)): FundingPlan {
  const need = Number(BigInt(amountBaseUnit)) / 1e6;
  {
    let left = need;
    const sources: { source: string; amountUsd: number }[] = [];
    let reserve = Number(BigInt(cfg.keepBscReserveBaseUnit)) / 1e6;
    for (const src of cfg.sources) {
      if (left <= 0) break;
      if (src === 'bsc_usdc' || src === 'bsc_usdt') {
        let avail = src === 'bsc_usdc' ? funding.bscUsdc : funding.bscUsdt;
        const fromReserve = Math.min(avail, reserve); avail -= fromReserve; reserve -= fromReserve;
        const take = Math.min(avail, left);
        if (take > 0) { sources.push({ source: src, amountUsd: round2(take) }); left -= take; }
      } else {
        for (const sym of cfg.sellOrder) {
          if (left <= 0) break;
          const h = funding.bstocks.find((b) => b.symbol === sym);
          if (!h || h.value <= 0) continue;
          // Selling raises cash at market value; the haircut is the buffer kept for slippage/price risk.
          const take = Math.min(h.value * (1 - (typeof haircut === 'function' ? haircut(sym) : haircut)), left);
          if (take > 0) { sources.push({ source: `sell ${sym}`, amountUsd: round2(take) }); left -= take; }
        }
      }
    }
    return { sources, shortfallUsd: round2(Math.max(0, left)) };
  }
}

export interface HedgeAction {
  bstock: string; venue: 'aster' | 'lighter' | 'derive'; kind: 'perp' | 'put'; market: string; key: string;
  held: number;
  /** Hedge size the rule wants, in the hedge instrument's units (perp size or put contracts); null = no price yet. */
  targetUnits: number | null;
  /** Hedge size held now: short perp size, or long put contracts. */
  currentUnits: number;
  /** Units to ADD to the hedge (negative = reduce). For perps a long on the hedge market is closed too. */
  deltaUnits: number;
  driftPct: number;
  act: boolean;
  reason: string;
}

/**
 * Hedge plan per leg, sized by NOTIONAL: target = bStock qty × bStock price × ratio ÷ hedge price.
 * - perp:  the hedge is a SHORT on the perp (Lighter market or Derive <CCY>-PERP); a long there is closed first.
 * - put:   the hedge is LONG protective puts on Derive (<CCY> options; strike/expiry chosen by the agent per leg.put).
 * `positions[key]` = signed perp size for perps, or long put contracts for puts. `prices[key]` = hedge price
 * (perp mark, or the Derive index for puts). Acts only when drift exceeds the threshold.
 */
export function planHedge(
  cfg: Pick<AgentConfig['hedge'], 'enabled' | 'driftThresholdPct' | 'legs'>,
  held: Record<string, { qty: number; price: number | null }>,
  positions: Record<string, number>,
  prices: Record<string, number | null | undefined>,
): HedgeAction[] {
  return cfg.legs.map((leg) => {
    const key = hedgeKey(leg);
    const kind = leg.kind ?? 'perp';
    const h = held[leg.bstock] ?? { qty: 0, price: null };
    const hp = prices[key] ?? null;
    const pos = positions[key] ?? 0;
    const currentUnits = kind === 'perp' ? (pos < 0 ? -pos : 0) : Math.max(0, pos);
    const base = { bstock: leg.bstock, venue: leg.venue, kind, market: leg.market, key, held: h.qty, currentUnits };
    if (!h.price || !hp) return { ...base, targetUnits: null, deltaUnits: 0, driftPct: 0, act: false, reason: 'waiting for prices' };
    const targetUnits = (h.qty * h.price * leg.hedgeRatio) / hp;
    const deltaUnits = targetUnits - currentUnits + (kind === 'perp' && pos > 0 ? pos : 0);
    const driftPct = targetUnits > 0 ? (Math.abs(targetUnits - currentUnits) / targetUnits) * 100 : currentUnits > 0 ? 100 : 0;
    const act = cfg.enabled && (driftPct > cfg.driftThresholdPct || (kind === 'perp' && pos > 0));
    const verb = kind === 'perp' ? (deltaUnits > 0 ? 'short more' : 'buy back') : deltaUnits > 0 ? 'buy puts' : 'sell puts';
    return { ...base, targetUnits, deltaUnits, driftPct, act, reason: act ? `${verb} ${Math.abs(deltaUnits).toFixed(4)}` : 'in band' };
  });
}

function round2(n: number) { return Math.round(n * 100) / 100; }
