// Aster perps: the shared, pure core used by the app server and the agent. No secrets live here; a signer is passed in.
//
// Two signing flows, both EIP-712 on the domain "AsterSignTransaction" v1 with verifyingContract 0x0:
//  * Agent approval: signed ONCE by the user's own wallet (MetaMask), chainId = signatureChainId (56), primaryType
//    Message{ msg: "user=..&nonce=..&agentName=..&agentAddress=..&expired=..&signatureChainId=56&canSpotTrade=..
//    &canPerpTrade=..&canWithdraw=false" }, POSTed as a form body to /fapi/v3/registerAndApproveAgent. The agent can
//    trade and read; it can never withdraw.
//  * Trading and reads: signed by the AGENT key on the MESSAGE domain (chainId 1666 mainnet, 714 testnet), primaryType
//    Message{ msg: <raw query string> }, sent as "<path>?<query>&signature=0x..". The query is NOT sorted or encoded:
//    Aster rebuilds the message from the URL verbatim, so any re-encoding breaks the signature.
// Ported from the PulsarX manager-service V3 client, which is verified live on mainnet (orders filled 2026-11-19).

export type AsterNetwork = 'mainnet' | 'testnet';
export type QueryPrimitive = string | number | boolean;

export interface AsterNet {
  fapi: string;
  /** EIP-712 chainId for agent-signed trading/query messages. */
  messageChainId: number;
  /** signatureChainId used in the one-time agent approval (BNB Chain). */
  signatureChainId: number;
  asterChain: 'Mainnet' | 'Testnet';
}

export const ASTER: Record<AsterNetwork, AsterNet> = {
  mainnet: { fapi: 'https://fapi.asterdex.com', messageChainId: 1666, signatureChainId: 56, asterChain: 'Mainnet' },
  testnet: { fapi: 'https://fapi.asterdex-testnet.com', messageChainId: 714, signatureChainId: 97, asterChain: 'Testnet' },
};

export const ASTER_DOMAIN_NAME = 'AsterSignTransaction';
export const ASTER_DOMAIN_VERSION = '1';
export const ASTER_VERIFYING_CONTRACT = '0x0000000000000000000000000000000000000000';
/** Aster refuses agents that expire in under a few days; 180 days is accepted (measured). */
export const ASTER_AGENT_TTL_MS = 180 * 86_400_000;
export const ASTER_AGENT_NAME = 'PulseRisk';
/** Aster's minimum order notional on equity and crypto perps (exchangeInfo MIN_NOTIONAL, 2026-11-26). */
export const ASTER_MIN_NOTIONAL_USD = 5;

export interface TypedData {
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
  types: { Message: { name: string; type: string }[] };
  primaryType: 'Message';
  message: { msg: string };
}

const messageTypedData = (msg: string, chainId: number): TypedData => ({
  domain: { name: ASTER_DOMAIN_NAME, version: ASTER_DOMAIN_VERSION, chainId, verifyingContract: ASTER_VERIFYING_CONTRACT },
  types: { Message: [{ name: 'msg', type: 'string' }] },
  primaryType: 'Message',
  message: { msg },
});

// ── nonce: microsecond-style, unique per process per second (Aster dedups POST nonces per agent: -4226) ──
let lastSecond = 0; let counter = 0;
export function asterNonce(nowMs = Date.now()): number {
  const s = Math.floor(nowMs / 1000);
  if (s === lastSecond) counter += 1; else { lastSecond = s; counter = Math.floor(Math.random() * 500); }
  return s * 1_000_000 + counter;
}

// ── one-time agent approval (signed by the user's wallet) ──
export interface AgentApproval { user: string; agentAddress: string; nonce: string; expiredMs: number; agentName?: string }

const ADDR = /^0x[0-9a-fA-F]{40}$/;
export function agentApprovalMessage(n: AsterNetwork, a: AgentApproval): string {
  if (!ADDR.test(a.user) || !ADDR.test(a.agentAddress)) throw new Error('Aster approval: user and agent must be addresses');
  if (!/^\d+$/.test(a.nonce)) throw new Error('Aster approval: nonce must be digits');
  // Aster replaces an earlier agent that has the SAME name, so each key gets its own name (a second instance must not revoke the first).
  const name = a.agentName ?? `${ASTER_AGENT_NAME}-${a.agentAddress.slice(-6).toLowerCase()}`;
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(name)) throw new Error('Aster approval: bad agent name');
  // Field order is what Aster rebuilds and hashes. canWithdraw is always false: the agent can never move funds out.
  return `user=${a.user.toLowerCase()}&nonce=${a.nonce}&agentName=${name}&agentAddress=${a.agentAddress.toLowerCase()}&expired=${a.expiredMs}`
    + `&signatureChainId=${ASTER[n].signatureChainId}&canSpotTrade=false&canPerpTrade=true&canWithdraw=false`;
}
export const agentApprovalTypedData = (n: AsterNetwork, msg: string): TypedData => messageTypedData(msg, ASTER[n].signatureChainId);

/** POST body for /fapi/v3/registerAndApproveAgent: the message's own pairs in order, then the signature. */
export function agentApprovalBody(msg: string, signature: string): string {
  const p = new URLSearchParams();
  for (const pair of msg.split('&')) { const i = pair.indexOf('='); p.append(pair.slice(0, i), pair.slice(i + 1)); }
  p.append('signature', signature);
  return p.toString();
}

// ── agent-signed trading / reads ──
export type SignTyped = (td: TypedData) => Promise<string>;

/** Raw, unsorted, unencoded query (exactly what Aster hashes). */
export function rawQuery(params: Record<string, QueryPrimitive | undefined | null>): string {
  return Object.entries(params).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}=${String(v)}`).join('&');
}

/** The signed URL path for a trading/query call: params, then asterChain, user, signer, nonce, then the signature. */
export async function signedPath(n: AsterNetwork, path: string, params: Record<string, QueryPrimitive | undefined | null>, user: string, agent: string, sign: SignTyped, nonce = asterNonce()): Promise<string> {
  const q = rawQuery({ ...params, asterChain: ASTER[n].asterChain, user, signer: agent, nonce });
  const signature = await sign(messageTypedData(q, ASTER[n].messageChainId));
  return `${path}?${q}&signature=${signature}`;
}

// ── symbols: one Aster perp per stock / asset (the USDT-margined one) ──
/** Ticker (NVDA) → Aster perp symbol (NVDAUSDT). */
export const asterSymbol = (ticker: string) => `${ticker.toUpperCase()}USDT`;
/** Aster perp symbol → ticker (NVDAUSDT → NVDA); null for non-USDT books. */
export const tickerOfAster = (symbol: string): string | null => (/^([A-Z0-9]+)USDT$/.exec(symbol)?.[1] ?? null);

// ── raw shapes (Binance-compatible) ──
export interface AsterAccount { totalWalletBalance?: string; totalMarginBalance?: string; availableBalance?: string; totalUnrealizedProfit?: string; totalPositionInitialMargin?: string; assets?: { asset: string; walletBalance?: string; availableBalance?: string; maxWithdrawAmount?: string }[] }
export interface AsterPosition { symbol: string; positionAmt: string; entryPrice: string; markPrice: string; unRealizedProfit: string; liquidationPrice: string; leverage: string; notional: string; positionSide?: string }
export interface AsterOrder { orderId: number; symbol: string; side: 'BUY' | 'SELL'; type: string; status: string; price: string; avgPrice?: string; origQty: string; executedQty: string; reduceOnly?: boolean; time: number; updateTime?: number; clientOrderId?: string }
export interface AsterTrade { id: number; orderId: number; symbol: string; side: 'BUY' | 'SELL'; price: string; qty: string; realizedPnl?: string; commission?: string; time: number }
export interface AsterSymbolInfo { symbol: string; status: string; baseAsset: string; quoteAsset: string; pricePrecision: number; quantityPrecision: number; filters: { filterType: string; tickSize?: string; stepSize?: string; minQty?: string; notional?: string; minNotional?: string }[] }

export function symbolRules(s: AsterSymbolInfo): { tickSize: number; stepSize: number; minQty: number; minNotional: number } {
  const f = (t: string) => s.filters.find((x) => x.filterType === t);
  return {
    tickSize: Number(f('PRICE_FILTER')?.tickSize ?? 0) || 10 ** -s.pricePrecision,
    stepSize: Number(f('LOT_SIZE')?.stepSize ?? 0) || 10 ** -s.quantityPrecision,
    minQty: Number(f('LOT_SIZE')?.minQty ?? 0),
    minNotional: Number(f('MIN_NOTIONAL')?.notional ?? f('MIN_NOTIONAL')?.minNotional ?? ASTER_MIN_NOTIONAL_USD),
  };
}

/** Round a quantity DOWN to the venue step, as a decimal string Aster accepts. */
export function stepQty(qty: number, step: number): string {
  const d = Math.max(0, Math.round(-Math.log10(step)));
  const v = Math.floor(qty / step + 1e-9) * step;
  return v.toFixed(d);
}
export function tickPrice(px: number, tick: number, up: boolean): string {
  const d = Math.max(0, Math.round(-Math.log10(tick)));
  const v = (up ? Math.ceil(px / tick - 1e-9) : Math.floor(px / tick + 1e-9)) * tick;
  return v.toFixed(d);
}
