import { encodePacked, type Address } from 'viem';
import { BSC_USDC, BSC_USDT, STABLE_HOP_FEE } from './bsc';

export type PayToken = 'USDT' | 'USDC';
export const PAY_TOKENS: Record<PayToken, Address> = { USDT: BSC_USDT, USDC: BSC_USDC };

/**
 * V3 packed path. bStock pools are quoted in USDT, so USDC routes through the
 * USDC/USDT 0.01% pool: USDC -100-> USDT -fee-> bStock (and the reverse for sells).
 */
export function buildPath(side: 'buy' | 'sell', pay: PayToken, bstock: Address, fee: number): `0x${string}` {
  if (pay === 'USDT') {
    return side === 'buy'
      ? encodePacked(['address', 'uint24', 'address'], [BSC_USDT, fee, bstock])
      : encodePacked(['address', 'uint24', 'address'], [bstock, fee, BSC_USDT]);
  }
  return side === 'buy'
    ? encodePacked(['address', 'uint24', 'address', 'uint24', 'address'], [BSC_USDC, STABLE_HOP_FEE, BSC_USDT, fee, bstock])
    : encodePacked(['address', 'uint24', 'address', 'uint24', 'address'], [bstock, fee, BSC_USDT, STABLE_HOP_FEE, BSC_USDC]);
}

/** amountOutMinimum from a quote and slippage in bps — pure bigint math. */
export function minOut(quoted: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5000) throw new Error('slippage out of range');
  return (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
}
