import { createPublicClient, fallback, http } from 'viem';
import { bsc } from 'viem/chains';
import { bstockBySymbol, PANCAKE_V3_FEE_TIERS } from '@/lib/bstocks';
import { PANCAKE_QUOTER_V2, QUOTER_V2_ABI } from '@/lib/bsc';
import { buildPath, type PayToken } from '@/lib/swap-path';
import { cached } from '@/lib/server/cache';

// Quotes a bStock swap across ALL PancakeSwap V3 fee tiers and returns the best one.
// The deepest tier is per-token (QQQB lives at 100, NVDAB at 2500) — never hardcode it.
const client = createPublicClient({
  chain: bsc,
  transport: fallback([
    ...(process.env.BSC_RPC_URL ? [http(process.env.BSC_RPC_URL)] : []),
    http('https://bsc-dataseed.bnb.org'), http('https://bsc-rpc.publicnode.com'),
  ]),
});

export async function GET(req: Request) {
  const u = new URL(req.url);
  const tok = bstockBySymbol(u.searchParams.get('symbol') ?? '');
  const side = u.searchParams.get('side');
  const pay = u.searchParams.get('pay') as PayToken | null;
  const amountIn = u.searchParams.get('amountIn') ?? '';
  if (!tok) return Response.json({ error: 'unknown bStock' }, { status: 400 });
  if (side !== 'buy' && side !== 'sell') return Response.json({ error: 'side must be buy|sell' }, { status: 400 });
  if (pay !== 'USDT' && pay !== 'USDC') return Response.json({ error: 'pay must be USDT|USDC' }, { status: 400 });
  if (!/^\d+$/.test(amountIn) || BigInt(amountIn) === 0n) return Response.json({ error: 'amountIn must be a positive integer (base units)' }, { status: 400 });

  const key = `${tok.symbol}:${side}:${pay}:${amountIn}`;
  const result = await cached(key, 8_000, async () => {
    const tiers = await Promise.all(PANCAKE_V3_FEE_TIERS.map(async (fee: number): Promise<{ fee: number; amountOut: string | null }> => {
      try {
        const [out] = await client.readContract({
          address: PANCAKE_QUOTER_V2, abi: QUOTER_V2_ABI, functionName: 'quoteExactInput',
          args: [buildPath(side, pay, tok.address, fee), BigInt(amountIn)],
        });
        return { fee, amountOut: out.toString() };
      } catch {
        return { fee, amountOut: null }; // no pool at this tier
      }
    }));
    const priced = tiers.filter((t): t is { fee: number; amountOut: string } => !!t.amountOut && BigInt(t.amountOut) > 0n)
      .sort((a, b) => (BigInt(b.amountOut) > BigInt(a.amountOut) ? 1 : -1));
    return { symbol: tok.symbol, side, pay, amountIn, best: priced[0] ?? null, tiers };
  });
  return Response.json(result);
}
