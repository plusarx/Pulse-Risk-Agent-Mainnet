import type { Candidate } from '../types';

// Splits a top-up's funding plan into "USDC pulled as is", "USDT pulled and swapped" and "bStocks pulled and sold for USDC".
// Shared by the guard, the step descriptions and the executor so they can never disagree about the amounts.

export interface SaleLeg { symbol: string; usd: number; base: bigint }
export interface FundingSplit { usdcBase: bigint; /** USDT pulled and swapped to USDC before the bridge. */ usdtBase: bigint; sales: SaleLeg[]; unsupported: string[] }

const SELL = /^sell ([A-Z0-9]+)$/;
const centsToBase = (usd: number) => BigInt(Math.round(usd * 100)) * 10_000n;

export function splitFunding(c: Pick<Candidate, 'amountBaseUnit' | 'funding'>): FundingSplit {
  const sales: SaleLeg[] = []; const unsupported: string[] = []; let usdc = 0n; let usdt = 0n;
  for (const f of c.funding ?? []) {
    const m = f.source.match(SELL);
    if (f.source === 'bsc_usdc') usdc += centsToBase(f.amountUsd);
    else if (f.source === 'bsc_usdt') usdt += centsToBase(f.amountUsd);
    else if (m) sales.push({ symbol: m[1], usd: f.amountUsd, base: centsToBase(f.amountUsd) });
    else unsupported.push(f.source);
  }
  // The total must equal the requested amount exactly. Rounding to cents leaves a few base units: they go to the
  // last sale when only bStocks fund the move, else to the USDC part.
  const sold = sales.reduce((a, x) => a + x.base, 0n);
  const total = BigInt(c.amountBaseUnit);
  const other = sold + usdt;
  if (!sales.length) return { usdcBase: usdc || usdt ? total - other : 0n, usdtBase: usdt, sales, unsupported };
  if (usdc === 0n && usdt === 0n) { sales[sales.length - 1].base += total - sold; return { usdcBase: 0n, usdtBase: 0n, sales, unsupported }; }
  return { usdcBase: total - other, usdtBase: usdt, sales, unsupported };
}

/** Extra bStock sold on top of the cash needed, to absorb DEX slippage (1%). */
export const SELL_BUFFER = 1.01;
