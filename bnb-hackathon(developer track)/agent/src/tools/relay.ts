import { createWalletClient, decodeFunctionData, getAddress, http, parseAbi, type Address, type Hex } from 'viem';
import { bsc } from 'viem/chains';
import { BSC_USDC } from '../../../lib/bsc';
import { RELAY_API } from '../../../lib/venues';
import { config } from '../config';
import { agentAccount, publicClient } from './bsc';

// Relay bridge client. Quote and status are read-only. executeSteps signs and sends
// only after validateQuote passes, and only when config().live is true. Ported from app/api/relay/quote/route.ts.

const DEPOSITORY = '0x4cd00e387622c35bddb9b4c962c136462338bc31';
const ERC20 = parseAbi(['function approve(address spender, uint256 amount)']);
const DEPOSIT = parseAbi(['function depositErc20(address depositor, address token, uint256 amount, bytes32 id)']);

export interface RelayStep { id: string; to: Address; data: Hex }
export interface ValidatedQuote { requestId: string; steps: RelayStep[]; amountOut: string; minOut: string; feeUsd: string }

interface RelayItem { data: { to: string; data: Hex; value?: string; chainId: number } }
interface RelayResp {
  steps?: { id: string; kind: string; requestId?: string; items: RelayItem[] }[];
  fees?: { relayer?: { amountUsd?: string } };
  details?: { currencyOut?: { amount: string; minimumAmount?: string }; recipient?: string };
  message?: string; errorCode?: string;
}

export interface QuoteReq {
  /** The agent's BSC address: it holds the funds after the pull and is the depositor. */
  depositor: Address;
  /** Destination recipient the quote must be addressed to. */
  recipientAccountIndex: string;
  /** Amount in 18-dp wei of `token` (BSC USDC and USDT are both 18 dp). */
  amountWei: bigint;
  /** Token being bridged. Defaults to BSC USDC; BSC USDT is used after selling bStocks. */
  token?: Address;
}

/** Throws unless every step is exactly approve(token→router) / depositErc20(depositor, token, amount) on BSC. */
export function validateQuote(q: RelayResp, req: QuoteReq): ValidatedQuote {
  const steps: RelayStep[] = []; let requestId = '';
  for (const s of q.steps ?? []) {
    if (s.kind !== 'transaction') throw new Error(`unexpected Relay step kind ${s.kind}`);
    requestId ||= s.requestId ?? '';
    for (const it of s.items) {
      const d = it.data; const to = d.to.toLowerCase();
      if (d.chainId !== 56) throw new Error('Relay step on unexpected chain');
      if ((d.value ?? '0') !== '0') throw new Error('Relay step sends native value');
      if (s.id === 'approve') {
        if (to !== (req.token ?? BSC_USDC).toLowerCase()) throw new Error('approve targets wrong token');
        const { args } = decodeFunctionData({ abi: ERC20, data: d.data });
        if ((args[0] as string).toLowerCase() !== DEPOSITORY || (args[1] as bigint) > req.amountWei) throw new Error('approve spender/amount mismatch');
      } else {
        if (to !== DEPOSITORY) throw new Error('deposit targets unexpected contract');
        const { functionName, args } = decodeFunctionData({ abi: DEPOSIT, data: d.data });
        if (functionName !== 'depositErc20' || getAddress(args[0]) !== getAddress(req.depositor) || getAddress(args[1]) !== getAddress(req.token ?? BSC_USDC) || args[2] !== req.amountWei) throw new Error('deposit calldata mismatch');
      }
      steps.push({ id: s.id, to: getAddress(d.to), data: d.data });
    }
  }
  if (!steps.length || !requestId) throw new Error('Relay quote has no steps / requestId');
  if (q.details?.recipient && q.details.recipient.toLowerCase() !== req.recipientAccountIndex.toLowerCase()) throw new Error('Relay quote recipient mismatch');
  return { requestId, steps, amountOut: q.details?.currencyOut?.amount ?? '0', minOut: q.details?.currencyOut?.minimumAmount ?? '0', feeUsd: q.fees?.relayer?.amountUsd ?? '0' };
}

export async function executeSteps(v: ValidatedQuote): Promise<{ txHashes: Hex[] }> {
  if (!config().live) throw new Error('Relay execute called while not live');
  const acct = agentAccount();
  const w = createWalletClient({ account: acct, chain: bsc, transport: http(config().BSC_RPC_URL) });
  const txHashes: Hex[] = [];
  for (const s of v.steps) {
    const hash = await w.sendTransaction({ to: s.to, data: s.data, value: 0n });
    const r = await publicClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (r.status !== 'success') throw new Error(`Relay step ${s.id} reverted (${hash})`);
    txHashes.push(hash);
  }
  return { txHashes };
}

export type RelayStatus = 'success' | 'refund' | 'pending' | 'failed' | 'unknown';
export async function getStatus(requestId: string): Promise<RelayStatus> {
  const r = await fetch(`${RELAY_API}/intents/status/v3?requestId=${requestId}`, { signal: AbortSignal.timeout(10_000) });
  const j = (await r.json().catch(() => ({}))) as { status?: string };
  const s = j.status ?? 'unknown';
  return s === 'success' || s === 'refund' || s === 'failed' ? s : s === 'unknown' ? 'unknown' : 'pending';
}

export interface RelayStatusDetail { status: RelayStatus; refundAmountBase?: string; refundTxHash?: string }

const pickStr = (...vals: unknown[]): string | undefined => { for (const v of vals) if (typeof v === 'string' && v) return v; for (const v of vals) if (typeof v === 'number' && Number.isFinite(v)) return String(v); return undefined; };

/**
 * Status plus, for a refund, the refunded amount (origin-token base units) and refund tx hash.
 * The documented v3 response has no refund-amount field (docs/reference/relay-api.md), so this only reads fields that
 * are explicitly named for it (refund / refunds[0] / refundCurrency / refundAmount) and leaves the rest undefined.
 */
export async function getStatusDetail(requestId: string): Promise<RelayStatusDetail> {
  const r = await fetch(`${RELAY_API}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`, { signal: AbortSignal.timeout(10_000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = typeof j.status === 'string' ? j.status : 'unknown';
  const status: RelayStatus = raw === 'success' || raw === 'refund' ? raw : raw === 'failure' || raw === 'failed' ? 'failed' : raw === 'fallback' ? 'refund' : raw === 'unknown' ? 'unknown' : 'pending';
  if (status !== 'refund') return { status };
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
  const refund = obj(j.refund); const first = obj(Array.isArray(j.refunds) ? j.refunds[0] : undefined); const details = obj(j.details);
  const cur = obj(refund.currency ?? details.refundCurrency ?? j.refundCurrency);
  const amount = pickStr(refund.amount, first.amount, cur.amount, j.refundAmount);
  const tx = pickStr(refund.txHash, first.txHash, refund.hash, j.refundTxHash);
  return { status, refundAmountBase: amount && /^\d+$/.test(amount) ? amount : undefined, refundTxHash: tx && /^0x[0-9a-fA-F]{64}$/.test(tx) ? tx : undefined };
}
