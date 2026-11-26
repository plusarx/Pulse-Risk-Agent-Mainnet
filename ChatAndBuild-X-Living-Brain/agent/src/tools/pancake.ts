import { createWalletClient, encodeFunctionData, getAddress, http, type Hex } from 'viem';
import { bsc } from 'viem/chains';
import { BSC_USDC, ERC20_ABI, PANCAKE_QUOTER_V2, PANCAKE_SMART_ROUTER, QUOTER_V2_ABI, SMART_ROUTER_ABI } from '../../../lib/bsc';
import { BSC_USDT, PANCAKE_V3_FEE_TIERS, bstockBySymbol } from '../../../lib/bstocks';
import { buildPath, minOut } from '../../../lib/swap-path';
import { config } from '../config';
import { agentAccount, publicClient } from './bsc';

// PancakeSwap V3 QUOTING of bStocks (used to price them). bStocks are sold on PancakeSwap V3 only to fund a margin top-up (sellBstockForUsdc).
// The fee tier is ALWAYS chosen by quoting all four tiers (the deepest pool differs per token, see lib/bstocks.ts).

export interface SellQuote { feeTier: number; amountOut: bigint }

/** Best USDT output for `amountIn` (raw token units) across all fee tiers, or null if no pool quotes. */
export async function quoteSell(symbol: string, amountIn: bigint): Promise<SellQuote | null> {
  const t = bstockBySymbol(symbol); if (!t) return null;
  const c = publicClient();
  const quotes = await Promise.all(PANCAKE_V3_FEE_TIERS.map(async (fee) => {
    try {
      const r = await c.simulateContract({ address: PANCAKE_QUOTER_V2, abi: QUOTER_V2_ABI, functionName: 'quoteExactInputSingle', args: [{ tokenIn: t.address, tokenOut: BSC_USDT, amountIn, fee, sqrtPriceLimitX96: 0n }] });
      return { feeTier: fee as number, amountOut: r.result[0] as bigint };
    } catch { return null; }
  }));
  const ok = quotes.filter((q): q is SellQuote => !!q && q.amountOut > 0n);
  return ok.sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1))[0] ?? null;
}

/** USD price of one bStock (quote 1 token → USDT), or null. */
export async function priceOf(symbol: string): Promise<number | null> {
  const q = await quoteSell(symbol, 10n ** 18n);
  return q ? Number(q.amountOut) / 1e18 : null;
}

/**
 * Swap USDT the agent just pulled into USDC: PancakeSwap V3 exactInputSingle on the 0.01% pool (fee 100, the stable hop
 * lib/swap-path.ts uses), min-out 0.5% under a fresh quote. Returns the USDC actually received (balance difference).
 */
export async function swapUsdtToUsdc(amountInWei: bigint, slippageBps = 50): Promise<{ txHash: Hex; usdcOutWei: bigint }> {
  if (!config().live) throw new Error('swapUsdtToUsdc called while not live');
  const c = publicClient(); const acct = agentAccount();
  const q = await c.simulateContract({ address: PANCAKE_QUOTER_V2, abi: QUOTER_V2_ABI, functionName: 'quoteExactInputSingle', args: [{ tokenIn: BSC_USDT, tokenOut: BSC_USDC, amountIn: amountInWei, fee: 100, sqrtPriceLimitX96: 0n }] });
  const quoted = q.result[0] as bigint;
  if (quoted <= 0n) throw new Error('no PancakeSwap quote for USDT to USDC');
  const minOut = (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
  const w = createWalletClient({ account: acct, chain: bsc, transport: http(config().BSC_RPC_URL) });
  const before = (await c.readContract({ address: BSC_USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct.address] })) as bigint;
  const approve = await w.writeContract({ address: BSC_USDT, abi: ERC20_ABI, functionName: 'approve', args: [PANCAKE_SMART_ROUTER, amountInWei] });
  await c.waitForTransactionReceipt({ hash: approve, timeout: 90_000 });
  const swap = encodeFunctionData({ abi: SMART_ROUTER_ABI, functionName: 'exactInputSingle', args: [{ tokenIn: BSC_USDT, tokenOut: BSC_USDC, fee: 100, recipient: getAddress(acct.address), amountIn: amountInWei, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
  const hash = await w.writeContract({ address: PANCAKE_SMART_ROUTER, abi: SMART_ROUTER_ABI, functionName: 'multicall', args: [swapDeadline(), [swap]] });
  const r = await c.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== 'success') throw new Error(`USDT to USDC swap reverted (${hash})`);
  const after = (await c.readContract({ address: BSC_USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct.address] })) as bigint;
  return { txHash: hash, usdcOutWei: after - before };
}

/**
 * Sell `rawAmount` of a bStock the agent already holds for USDC: SmartRouter exactInput along bStock -fee-> USDT -0.01%-> USDC
 * (lib/swap-path.ts), min-out from a fresh QuoterV2 quote. Returns the USDC actually received (balance difference).
 * A sale is final: there is no rollback.
 */
/** A swap that sits unconfirmed must not execute later at a stale price: it expires 5 minutes after it is signed (same as the app's swap). */
export const SWAP_DEADLINE_SEC = 300;
export const swapDeadline = (nowMs = Date.now()): bigint => BigInt(Math.floor(nowMs / 1000) + SWAP_DEADLINE_SEC);

export async function sellBstockForUsdc(symbol: string, rawAmount: bigint, slippageBps = 100): Promise<{ txHash: Hex; usdcOutWei: bigint }> {
  if (!config().live) throw new Error('sellBstockForUsdc called while not live');
  const t = bstockBySymbol(symbol); if (!t) throw new Error(`unknown bStock ${symbol}`);
  const best = await quoteSell(symbol, rawAmount); if (!best) throw new Error(`no PancakeSwap quote for ${symbol}`);
  const path = buildPath('sell', 'USDC', t.address, best.feeTier);
  const c = publicClient(); const acct = agentAccount();
  const q = await c.simulateContract({ address: PANCAKE_QUOTER_V2, abi: QUOTER_V2_ABI, functionName: 'quoteExactInput', args: [path, rawAmount] });
  const quoted = q.result[0] as bigint;
  if (quoted <= 0n) throw new Error(`no PancakeSwap USDC quote for ${symbol}`);
  const floor = minOut(quoted, slippageBps);
  const w = createWalletClient({ account: acct, chain: bsc, transport: http(config().BSC_RPC_URL) });
  const before = (await c.readContract({ address: BSC_USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct.address] })) as bigint;
  const approve = await w.writeContract({ address: t.address, abi: ERC20_ABI, functionName: 'approve', args: [PANCAKE_SMART_ROUTER, rawAmount] });
  await c.waitForTransactionReceipt({ hash: approve, timeout: 90_000 });
  const swap = encodeFunctionData({ abi: SMART_ROUTER_ABI, functionName: 'exactInput', args: [{ path, recipient: getAddress(acct.address), amountIn: rawAmount, amountOutMinimum: floor }] });
  const hash = await w.writeContract({ address: PANCAKE_SMART_ROUTER, abi: SMART_ROUTER_ABI, functionName: 'multicall', args: [swapDeadline(), [swap]] });
  const r = await c.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== 'success') throw new Error(`${symbol} sale reverted (${hash})`);
  const after = (await c.readContract({ address: BSC_USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct.address] })) as bigint;
  return { txHash: hash, usdcOutWei: after - before };
}
