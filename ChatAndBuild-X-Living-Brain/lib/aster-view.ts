// Aster perps: pure view mapping, deposit calldata and the withdraw typed data. No I/O, no secrets, so it is
// unit-tested and shared by the server client (lib/server/aster.ts) and the browser (funding, perps page).
import { encodeFunctionData, erc20Abi, type Address, type Hex } from 'viem';
import { ASTER_VERIFYING_CONTRACT, tickerOfAster, type AsterAccount, type AsterOrder, type AsterPosition } from './aster';
import { BSC_USDC, BSC_USDT, PANCAKE_SMART_ROUTER, SMART_ROUTER_ABI, STABLE_HOP_FEE } from './bsc';
import type { HistoryRow } from './order-history';

// ── account view ─────────────────────────────────────────────────────────────

/** Aster answers this on every signed call for an account that never deposited. It is a state, not an error. */
export const ASTER_NO_DEPOSIT_CODE = -5050;

export interface AsterPositionView {
  symbol: string; ticker: string; side: 'long' | 'short';
  /** Absolute size in base units, as Aster sends it (decimal string, no sign). */
  size: string;
  entryPrice: number; markPrice: number; notional: number; upnl: number; liqPrice: number | null; leverage: number | null;
}
export interface AsterOpenOrderView {
  orderId: string; symbol: string; ticker: string; side: 'buy' | 'sell'; type: string; price: string; size: string; filled: string; reduceOnly: boolean; time: number;
}
export interface AsterAccountView {
  state: 'ok' | 'no_deposit' | 'needs_agent';
  walletBalance: number | null; equity: number | null; available: number | null;
  /** Margin used as % of equity, 0..100; null when unknown or no equity. */
  usedPct: number | null;
  positions: AsterPositionView[];
  openOrders: AsterOpenOrderView[];
  /** Leverage Aster has set per symbol (from positionRisk, which lists flat symbols too). */
  leverage: Record<string, number>;
  /** Agent key expiry, unix ms (null when no agent). */
  agentExpiresAt: number | null;
}

export const emptyAsterView = (state: 'no_deposit' | 'needs_agent', agentExpiresAt: number | null = null): AsterAccountView => ({
  state, walletBalance: state === 'no_deposit' ? 0 : null, equity: state === 'no_deposit' ? 0 : null, available: state === 'no_deposit' ? 0 : null,
  usedPct: null, positions: [], openOrders: [], leverage: {}, agentExpiresAt,
});

const num = (s: string | undefined | null): number | null => {
  if (s === undefined || s === null || s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

export function mapAsterAccount(acct: AsterAccount, positions: AsterPosition[], orders: AsterOrder[], agentExpiresAt: number | null): AsterAccountView {
  const walletBalance = num(acct.totalWalletBalance);
  const equity = num(acct.totalMarginBalance) ?? walletBalance;
  const available = num(acct.availableBalance);
  const usedPct = equity !== null && equity > 0 && available !== null ? Math.max(0, Math.min(100, ((equity - available) / equity) * 100)) : null;
  const leverage: Record<string, number> = {};
  for (const p of positions) { const l = num(p.leverage); if (l && l > 0) leverage[p.symbol] = l; }
  return {
    state: 'ok', walletBalance, equity, available, usedPct, leverage, agentExpiresAt,
    positions: positions.filter((p) => Number(p.positionAmt) !== 0).map((p) => {
      const amt = Number(p.positionAmt);
      const mark = Number(p.markPrice);
      return {
        symbol: p.symbol, ticker: tickerOfAster(p.symbol) ?? p.symbol, side: amt > 0 ? 'long' as const : 'short' as const,
        size: p.positionAmt.replace(/^-/, ''), entryPrice: Number(p.entryPrice), markPrice: mark,
        notional: Math.abs(num(p.notional) ?? amt * mark), upnl: Number(p.unRealizedProfit),
        liqPrice: num(p.liquidationPrice) || null, leverage: num(p.leverage),
      };
    }),
    openOrders: orders.map((o) => ({
      orderId: String(o.orderId), symbol: o.symbol, ticker: tickerOfAster(o.symbol) ?? o.symbol, side: o.side === 'BUY' ? 'buy' as const : 'sell' as const,
      type: o.type.toLowerCase(), price: o.price, size: o.origQty, filled: o.executedQty, reduceOnly: !!o.reduceOnly, time: o.time,
    })).sort((a, b) => b.time - a.time),
  };
}

// ── history ──────────────────────────────────────────────────────────────────

/** Aster status → the lower-case status stored on a history row (see statusLabel in lib/order-history.ts). */
export function asterStatus(s: string): string {
  switch (s) {
    case 'FILLED': return 'filled';
    case 'CANCELED': return 'canceled';
    case 'EXPIRED': return 'expired';
    case 'REJECTED': return 'rejected';
    case 'NEW': case 'PARTIALLY_FILLED': return 'open';
    default: return s.toLowerCase();
  }
}

/**
 * Finished and open orders → history rows, newest first. Aster matches off-chain, so there is no transaction hash:
 * txHash stays null and the Aster order id is the reference.
 */
export function mapAsterHistory(orders: AsterOrder[], limit = 50): HistoryRow[] {
  const seen = new Set<string>();
  const rows: HistoryRow[] = [];
  for (const o of orders) {
    const id = `${o.symbol}:${o.orderId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const filled = Number(o.executedQty);
    rows.push({
      venue: 'aster', time: o.updateTime ?? o.time, market: `${tickerOfAster(o.symbol) ?? o.symbol}-PERP`,
      side: o.side === 'BUY' ? 'buy' : 'sell', type: o.type.toLowerCase(), size: o.origQty, filled: o.executedQty,
      avgPrice: filled > 0 && Number(o.avgPrice) > 0 ? String(o.avgPrice) : null,
      status: asterStatus(o.status), account: null, txHash: null, orderId: String(o.orderId),
    });
  }
  return rows.sort((a, b) => b.time - a.time).slice(0, limit);
}

/** One order → the ticket's outcome shape (lib/perp-order.ts). */
export function asterOutcome(o: AsterOrder | undefined): { state: 'pending' | 'open' | 'filled' | 'partial' | 'canceled'; status: string | null; size: string | null; filled: string | null; avgPrice: string | null } {
  if (!o) return { state: 'pending', status: null, size: null, filled: null, avgPrice: null };
  const filled = Number(o.executedQty);
  const avgPrice = filled > 0 && Number(o.avgPrice) > 0 ? String(o.avgPrice) : null;
  const base = { status: asterStatus(o.status), size: o.origQty, filled: o.executedQty, avgPrice };
  if (o.status === 'FILLED') return { state: 'filled', ...base };
  if (o.status === 'NEW' || o.status === 'PARTIALLY_FILLED') return { state: 'open', ...base };
  return { state: filled > 0 ? 'partial' : 'canceled', ...base };
}

// ── deposit (BNB Chain, from the user's own wallet) ─────────────────────────

/** AstherusVault proxy on BNB Chain (implementation checked to contain deposit(address,uint256,uint256)). */
export const ASTER_VAULT_BSC = '0x128463A60784c4D3f46c23Af3f65Ed859Ba87974' as const;
/** Broker id used by 30 of 38 recent BSC deposits; broker 0 deposits were seen lost on Arbitrum. */
export const ASTER_DEPOSIT_BROKER = 1n;
/** Margin is USDT on BNB Chain (18 decimals). */
export const ASTER_DEPOSIT_TOKEN = BSC_USDT;
export const ASTER_DEPOSIT_DECIMALS = 18;
/** App floor for a deposit (Aster's own minimum is not published; this matches its 5 USD minimum order). */
export const ASTER_MIN_DEPOSIT = 5n * 10n ** 18n;

export const ASTER_VAULT_ABI = [
  { type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [{ name: 'currency', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'broker', type: 'uint256' }], outputs: [] },
] as const;

export interface CallStep { label: string; to: Address; data: Hex }

/** approve (only if the allowance is short, exact amount) → deposit(USDT, amount, broker 1). */
export function asterDepositSteps(amount: bigint, allowance: bigint): CallStep[] {
  if (amount <= 0n) throw new Error('amount must be positive');
  const steps: CallStep[] = [];
  if (allowance < amount) steps.push({ label: 'Approve USDT (exact amount)', to: ASTER_DEPOSIT_TOKEN, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ASTER_VAULT_BSC, amount] }) });
  steps.push({ label: 'Deposit to perps', to: ASTER_VAULT_BSC, data: encodeFunctionData({ abi: ASTER_VAULT_ABI, functionName: 'deposit', args: [ASTER_DEPOSIT_TOKEN, amount, ASTER_DEPOSIT_BROKER] }) });
  return steps;
}

/** PancakeSwap USDC → USDT through the 0.01% stable pool, paid to `recipient` (router multicall with a deadline). */
export function usdcToUsdtSwapSteps(recipient: Address, amountIn: bigint, minOut: bigint, allowance: bigint, deadlineSec: bigint): CallStep[] {
  if (amountIn <= 0n) throw new Error('amount must be positive');
  const steps: CallStep[] = [];
  if (allowance < amountIn) steps.push({ label: 'Approve USDC (exact amount)', to: BSC_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PANCAKE_SMART_ROUTER, amountIn] }) });
  const swap = encodeFunctionData({ abi: SMART_ROUTER_ABI, functionName: 'exactInputSingle', args: [{ tokenIn: BSC_USDC, tokenOut: BSC_USDT, fee: STABLE_HOP_FEE, recipient, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
  steps.push({ label: 'Swap USDC → USDT', to: PANCAKE_SMART_ROUTER, data: encodeFunctionData({ abi: SMART_ROUTER_ABI, functionName: 'multicall', args: [deadlineSec, [swap]] }) });
  return steps;
}

// ── withdraw (signed by the USER in MetaMask; the agent only submits it) ─────
// UNVERIFIED-live: ported field for field from manager-service src/aster/v3/client.ts (withdrawActionTypedData,
// destinationChainLabel, estimateWithdrawFee). Domain name is 'Aster' (not AsterSignTransaction), chainId is the
// DESTINATION chain, and two field names carry a literal space.

export function destinationChainLabel(chainId: number): string {
  if (chainId === 42161) return 'Arbitrum';
  if (chainId === 56) return 'BSC';
  return 'ETH';
}

export function withdrawActionTypedData(chainId: number, destination: Address, token: string, amount: string, fee: string, nonce: string, asterChain: string) {
  return {
    domain: { name: 'Aster', version: '1', chainId, verifyingContract: ASTER_VERIFYING_CONTRACT as Address },
    types: {
      Action: [
        { name: 'type', type: 'string' },
        { name: 'destination', type: 'address' },
        { name: 'destination Chain', type: 'string' },
        { name: 'token', type: 'string' },
        { name: 'amount', type: 'string' },
        { name: 'fee', type: 'string' },
        { name: 'nonce', type: 'uint256' },
        { name: 'aster chain', type: 'string' },
      ],
    },
    primaryType: 'Action' as const,
    message: { type: 'Withdraw', destination, 'destination Chain': destinationChainLabel(chainId), token, amount, fee, nonce, 'aster chain': asterChain },
  };
}

/** Per-asset, per-chain fee floor (mirrors withdrawFeeFloor in the Go signer, 0.6 default). */
export function withdrawFeeFloor(asset: string, chainId: number): number {
  const floors: Record<string, Record<string, number>> = {
    USDC: { '1': 4, '42161': 0.3, '56': 0.6 }, USDT: { '1': 4, '42161': 0.3, '56': 0.6 },
    ETH: { '1': 0.001, '42161': 0.0001 }, BNB: { '56': 0.0003 }, BTC: { '1': 0.0002 },
  };
  const f = floors[asset.trim().toUpperCase()]?.[String(chainId)];
  return f && f > 0 ? f : 0.6;
}

/** First numeric fee field in the estimate reply, in order (the live reply names it inconsistently). */
export function extractFee(body: unknown): number {
  const b = (body ?? {}) as Record<string, unknown>;
  const src = (b.data && typeof b.data === 'object' ? b.data : b) as Record<string, unknown>;
  for (const k of ['fee', 'withdrawFee', 'gasCost', 'gasUsdValue']) {
    if (src[k] !== undefined && src[k] !== null) { const v = Number(src[k]); if (Number.isFinite(v)) return v; }
  }
  const flat = Number(b.data);
  return Number.isFinite(flat) ? flat : 0;
}

/** Quoted fee × 1.1, never below the floor, rounded UP to 2 dp (Aster rejects more decimals). */
export function withdrawFee(quoted: number, asset: string, chainId: number): string {
  const fee = Math.max(quoted > 0 ? quoted * 1.1 : 0, withdrawFeeFloor(asset, chainId));
  return (Math.ceil(fee * 100 - 1e-9) / 100).toFixed(2);
}

// ── markets ──────────────────────────────────────────────────────────────────

export interface AsterMarket {
  symbol: string; ticker: string;
  tickSize: number; stepSize: number; minQty: number; minNotional: number; pricePrecision: number; quantityPrecision: number;
  last: number | null; mark: number | null; index: number | null; fundingRate: number | null;
  changePct: number | null; high: number | null; low: number | null; volumeUsd: number | null;
}

/** Decimal places implied by a venue step (0.001 → 3). */
export const stepDecimals = (step: number): number => (step > 0 ? Math.max(0, Math.round(-Math.log10(step))) : 0);
