import { decodeFunctionData, getAddress, parseAbi, type Address } from 'viem';
import { json } from '@/lib/server/auth';
import { withWallet } from '@/lib/server/http';
import { findLighterAccount } from '@/lib/server/lighter';
import { BSC_USDC } from '@/lib/bsc';
import { ETH_USDC, RELAY_API, RELAY_LIGHTER_CHAIN_ID } from '@/lib/venues';
import type { BridgeRoute, RelayQuote, RelayTxStep } from '@/lib/relay';

export const runtime = 'nodejs';

// Relay router seen on every EVM origin (2026-11-23). We refuse any step that targets something else
// (other than the exact ERC-20 approve on the input token).
const RELAY_DEPOSITORY = '0x4cd00e387622c35bddb9b4c962c136462338bc31';
const ERC20 = parseAbi(['function approve(address spender, uint256 amount)']);
const DEPOSITORY = parseAbi(['function depositErc20(address depositor, address token, uint256 amount, bytes32 id)']);

interface RelayItem { data: { to: string; data: `0x${string}`; value?: string; chainId: number } }
interface RelayResp {
  steps?: { id: string; description?: string; kind: string; requestId?: string; items: RelayItem[] }[];
  fees?: { relayer?: { amountUsd?: string } };
  details?: { currencyIn?: { amount: string }; currencyOut?: { amount: string; minimumAmount?: string; currency?: { decimals: number } }; timeEstimate?: number; recipient?: string };
  message?: string; errorCode?: string;
}

const ROUTES: Record<BridgeRoute, { origin: number; dest: number; inToken: Address; outCurrency: string; inDecimals: number }> = {
  bsc_to_lighter: { origin: 56, dest: RELAY_LIGHTER_CHAIN_ID, inToken: BSC_USDC, outCurrency: '0', inDecimals: 18 },
  bsc_to_eth: { origin: 56, dest: 1, inToken: BSC_USDC, outCurrency: ETH_USDC, inDecimals: 18 },
  eth_to_bsc: { origin: 1, dest: 56, inToken: ETH_USDC, outCurrency: BSC_USDC, inDecimals: 6 },
};

/** POST { route, amount (base units of the input token) } → validated tx steps for MetaMask. Mainnet only. */
export async function POST(req: Request) {
  return withWallet(async (wallet) => {
    const b = (await req.json().catch(() => ({}))) as { route?: BridgeRoute; amount?: string };
    const r = b.route ? ROUTES[b.route] : undefined;
    if (!r || !b.amount || !/^\d+$/.test(b.amount) || BigInt(b.amount) === 0n) return json({ error: 'route and amount (base units) required' }, 400);
    let recipient: string = wallet;
    if (b.route === 'bsc_to_lighter') {
      const idx = await findLighterAccount('mainnet', wallet);
      if (idx === null) return json({ error: 'No Lighter account yet. Your first deposit must go BSC → Ethereum → Lighter (creates the account).' }, 400);
      recipient = String(idx); // Relay's Lighter chain takes the account index, not an address
    }
    const res = await fetch(`${RELAY_API}/quote/v2`, {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/json', ...(process.env.RELAY_API_KEY ? { 'x-api-key': process.env.RELAY_API_KEY } : {}) },
      body: JSON.stringify({ user: wallet, recipient, originChainId: r.origin, destinationChainId: r.dest, originCurrency: r.inToken,
        destinationCurrency: r.outCurrency, amount: b.amount, tradeType: 'EXACT_INPUT', slippageTolerance: '50', refundTo: wallet }),
    });
    const q = (await res.json().catch(() => ({}))) as RelayResp;
    if (!res.ok || !q.steps) return json({ error: `Relay: ${q.message ?? q.errorCode ?? res.status}` }, 502);

    // ── Validate every step before it reaches the wallet ──
    const steps: RelayTxStep[] = [];
    let requestId = '';
    for (const s of q.steps) {
      if (s.kind !== 'transaction') return json({ error: `unexpected Relay step kind ${s.kind}` }, 502);
      requestId ||= s.requestId ?? '';
      for (const it of s.items) {
        const d = it.data;
        if (d.chainId !== r.origin) return json({ error: 'Relay step on unexpected chain' }, 502);
        if ((d.value ?? '0') !== '0') return json({ error: 'Relay step sends native value' }, 502);
        const to = d.to.toLowerCase();
        if (s.id === 'approve') {
          if (to !== r.inToken.toLowerCase()) return json({ error: 'approve targets wrong token' }, 502);
          const { args } = decodeFunctionData({ abi: ERC20, data: d.data });
          if ((args[0] as string).toLowerCase() !== RELAY_DEPOSITORY || (args[1] as bigint) > BigInt(b.amount)) return json({ error: 'approve spender/amount mismatch' }, 502);
        } else {
          if (to !== RELAY_DEPOSITORY) return json({ error: 'deposit targets unexpected contract' }, 502);
          const { functionName, args } = decodeFunctionData({ abi: DEPOSITORY, data: d.data });
          if (functionName !== 'depositErc20' || getAddress(args[0]) !== getAddress(wallet) || getAddress(args[1]) !== getAddress(r.inToken) || args[2] !== BigInt(b.amount)) {
            return json({ error: 'deposit calldata mismatch' }, 502);
          }
        }
        steps.push({ id: s.id, description: s.description ?? s.id, chainId: d.chainId, to: getAddress(d.to), data: d.data, value: '0' });
      }
    }
    // The destination lives in Relay's off-chain order, not the calldata — so check the quote's echo.
    if (q.details?.recipient && q.details.recipient.toLowerCase() !== recipient.toLowerCase()) return json({ error: 'Relay quote recipient mismatch' }, 502);
    const out: RelayQuote = {
      requestId, route: b.route!, steps,
      amountIn: b.amount, amountOut: q.details?.currencyOut?.amount ?? '0', minOut: q.details?.currencyOut?.minimumAmount ?? '0',
      outDecimals: q.details?.currencyOut?.currency?.decimals ?? 6, feeUsd: q.fees?.relayer?.amountUsd ?? '0', timeEstimateSec: q.details?.timeEstimate ?? 0,
    };
    return json(out);
  });
}
