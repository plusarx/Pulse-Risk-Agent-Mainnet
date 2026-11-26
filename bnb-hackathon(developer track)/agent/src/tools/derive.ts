import { deriveOrderExpiry } from '../../../lib/derive-expiry';
import { getAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DERIVE, DERIVE_MODULES, DERIVE_USDC_ASSET } from '../../../lib/venues';
import { actionTypedData, encodeTradeData, encodeTransferData, encodeWithdrawData, nextNonce, type ActionFields, type DeriveUniverse } from '../../../lib/derive-codec';
import { floorToStep } from '../../../lib/decimal';
import { parseDeriveOption } from '../../../lib/scenario';
import type { AccountHealth } from '../../../lib/risk-rules';
import { config } from '../config';
import type { Network } from '../types';
import type { DeriveCreds } from './appApi';

// Derive tools. Reads are plain REST. Writes (order / transfer_spot / withdraw) are signed with the session key
// (EIP-712 actions from lib/derive-codec.ts, ported from lib/server/derive.ts) and only reachable when config().live is true.
// The deposit leg lives in deriveFunding.ts.

export class NotWiredError extends Error { constructor(what: string) { super(`${what} is not wired yet (needs Derive action signing + a funded test run)`); } }

export async function rpc<T>(n: Network, method: string, params: object, headers: Record<string, string>): Promise<T> {
  const r = await fetch(`${DERIVE[n].rest}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(params), signal: AbortSignal.timeout(12_000) });
  const j = (await r.json().catch(() => ({}))) as { result?: T; error?: { code: number; message: string } };
  if (j.error) throw new Error(`Derive ${j.error.code}: ${j.error.message}`);
  if (!r.ok || j.result === undefined) throw new Error(`Derive HTTP ${r.status}`);
  return j.result;
}

/** Headers signed by the session key: X-DeriveSignature = personal_sign(timestamp_ms). */
export async function authHeaders(wallet: string, c: DeriveCreds): Promise<Record<string, string>> {
  const key = privateKeyToAccount(c.sessionPrivateKey as Hex);
  const ts = String(Date.now());
  return { 'X-DeriveWallet': getAddress(wallet), 'X-DeriveTimestamp': ts, 'X-DeriveSignature': await key.signMessage({ message: ts }) };
}

export interface DeriveSubaccountView { subaccount_id: number; collaterals_value: string; initial_margin: string; is_under_liquidation: boolean; positions: { instrument_name: string; amount: string }[] }

export async function getSubaccount(n: Network, wallet: string, c: DeriveCreds, subaccountId: number): Promise<DeriveSubaccountView> {
  return rpc<DeriveSubaccountView>(n, 'private/get_subaccount', { subaccount_id: subaccountId }, await authHeaders(wallet, c));
}

/** Derive health: used = collateral − initial_margin (initial_margin is free headroom), util = used / collateral. */
export function healthOf(s: DeriveSubaccountView | null): AccountHealth {
  if (!s) return { connected: false, utilBps: null, accountUsd: null, usedUsd: null };
  const coll = Number(s.collaterals_value); const free = Number(s.initial_margin);
  if (!Number.isFinite(coll) || !Number.isFinite(free)) return { connected: true, utilBps: null, accountUsd: null, usedUsd: null };
  if (coll <= 0) return { connected: true, utilBps: 0, accountUsd: coll, usedUsd: 0 };
  const used = Math.max(0, coll - free);
  return { connected: true, utilBps: Math.round((used / coll) * 10_000), accountUsd: coll, usedUsd: used };
}

const liveOnly = (what: string) => { if (!config().live) throw new Error(`Derive ${what} called while not live`); };

// ── Public market data ─────────────────────────────────────────────────────────
interface RawInstrument { instrument_name: string; base_asset_address: Address; base_asset_sub_id: string; tick_size: string; amount_step: string; minimum_amount: string; base_fee: string; taker_fee_rate: string; is_active: boolean; risk_universe_id: number }

export async function getInstrument(n: Network, name: string): Promise<{ name: string; isActive: boolean; minimumAmount: number; amountStep: number; tickSize: number; universeId: number }> {
  const i = await rpc<RawInstrument>(n, 'public/get_instrument', { instrument_name: name }, {});
  return { name: i.instrument_name, isActive: !!i.is_active, minimumAmount: Number(i.minimum_amount), amountStep: Number(i.amount_step), tickSize: Number(i.tick_size), universeId: i.risk_universe_id };
}

export async function getTicker(n: Network, name: string): Promise<{ mark: number; index: number; bid: number; ask: number; minPrice: number; maxPrice: number }> {
  const t = await rpc<{ M: string; I: string; b: string; a: string; minp: string; maxp: string }>(n, 'public/get_ticker', { instrument_name: name }, {});
  return { mark: Number(t.M), index: Number(t.I), bid: Number(t.b), ask: Number(t.a), minPrice: Number(t.minp), maxPrice: Number(t.maxp) };
}

export async function deriveUniverses(n: Network): Promise<DeriveUniverse[]> {
  const r = await rpc<{ risk_universe_id: number; name: string | null; managers: { manager_id: number; margin_type: string; instruments: string[] }[] }[] | { risk_universes: never[] }>(n, 'public/get_risk_universes', {}, {});
  const list = Array.isArray(r) ? r : r.risk_universes;
  return list.filter((u) => u.risk_universe_id > 0).map((u) => ({
    id: u.risk_universe_id, name: u.name ?? `#${u.risk_universe_id}`,
    managers: u.managers.map((m) => ({ managerId: m.manager_id, marginType: m.margin_type })),
    families: [...new Set(u.managers.flatMap((m) => m.instruments))],
  }));
}

// ── Subaccounts ────────────────────────────────────────────────────────────────
export interface DeriveSubaccount {
  subaccount_id: number; manager_id: number; margin_type?: string; is_under_liquidation: boolean;
  initial_margin: string; maintenance_margin?: string; collaterals_value: string;
  collaterals: { asset_name: string; amount: string; mark_value?: string }[];
  positions: { instrument_name: string; instrument_type?: string; amount: string }[];
}
export interface SubaccountView extends DeriveSubaccount { isFallback: boolean; universeId: number | null; universeName: string | null }

/** Every subaccount the wallet owns, with its risk universe. */
export async function listSubaccounts(n: Network, wallet: string, creds: DeriveCreds): Promise<SubaccountView[]> {
  const owner = getAddress(wallet);
  const headers = await authHeaders(owner, creds);
  const [acct, universes] = await Promise.all([
    rpc<{ subaccount_ids: number[]; fallback_subaccount_id?: number | null }>(n, 'private/get_account', { wallet: owner }, headers),
    deriveUniverses(n),
  ]);
  const subs = await Promise.all(acct.subaccount_ids.map((id) => rpc<DeriveSubaccount>(n, 'private/get_subaccount', { subaccount_id: id }, headers)));
  return subs.map((s) => {
    const u = universes.find((x) => x.managers.some((m) => m.managerId === s.manager_id));
    return { ...s, isFallback: s.subaccount_id === acct.fallback_subaccount_id || s.manager_id === 0, universeId: u?.id ?? null, universeName: u?.name ?? null };
  }).sort((a, b) => a.subaccount_id - b.subaccount_id);
}

async function subaccountForUniverse(n: Network, wallet: string, creds: DeriveCreds, universeId: number): Promise<number> {
  const subs = (await listSubaccounts(n, wallet, creds)).filter((s) => !s.isFallback && s.universeId === universeId);
  if (!subs.length) throw new Error(`No Derive subaccount for universe ${universeId}; it must be enabled first`);
  return subs.sort((a, b) => Number(b.collaterals_value) - Number(a.collaterals_value))[0].subaccount_id;
}

/**
 * Hedge positions the planner compares against targets: `derive-perp:<CCY>` = signed perp amount over all subaccounts,
 * `derive-put:<CCY>` = LONG put contracts (amount > 0) from option names like NVDA-20261218-145-P.
 */
export async function hedgePositions(n: Network, wallet: string, creds: DeriveCreds): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const s of await listSubaccounts(n, wallet, creds)) {
    for (const p of s.positions ?? []) {
      const amt = Number(p.amount); if (!Number.isFinite(amt) || amt === 0) continue;
      const opt = parseDeriveOption(p.instrument_name);
      if (opt) { if (opt.type === 'P' && amt > 0) out[`derive-put:${opt.underlying}`] = (out[`derive-put:${opt.underlying}`] ?? 0) + amt; continue; }
      const m = /^([A-Z0-9]+)-PERP$/.exec(p.instrument_name);
      if (m) out[`derive-perp:${m[1]}`] = (out[`derive-perp:${m[1]}`] ?? 0) + amt;
    }
  }
  return out;
}

// ── Signed writes ──────────────────────────────────────────────────────────────
async function signAction(n: Network, creds: DeriveCreds, owner: Address, subaccountId: number, module: Address, data: Hex, expirySec: number) {
  const key = privateKeyToAccount(creds.sessionPrivateKey as Hex);
  const action: ActionFields = { subaccountId, nonce: nextNonce(), module, expirySec, owner, signer: key.address, data };
  const td = actionTypedData(action, n);
  const signature = await key.signTypedData({ ...td, message: { ...td.message, subaccountId: BigInt(subaccountId), nonce: BigInt(action.nonce), expiry: BigInt(expirySec) } });
  return { action, signature, signer: key.address };
}

export interface PlaceOrderReq { instrument: string; side: 'buy' | 'sell'; amount: string; type: 'market' | 'limit'; limitPrice?: string; reduceOnly?: boolean }

/** Order on the subaccount of the instrument's universe. Market = IOC, worst price 2% through the touch, clamped to the venue band. */
export async function placeOrder(n: Network, wallet: string, creds: DeriveCreds, o: PlaceOrderReq): Promise<{ orderId: string; status: string; filled: number; avgPrice: number }> {
  liveOnly('order');
  const owner = getAddress(wallet);
  const inst = await rpc<RawInstrument>(n, 'public/get_instrument', { instrument_name: o.instrument }, {});
  if (!inst.is_active) throw new Error(`${o.instrument} is not active`);
  const t = await rpc<{ b: string; a: string; I: string; M: string; minp: string; maxp: string }>(n, 'public/get_ticker', { instrument_name: o.instrument }, {});
  const amount = floorToStep(o.amount, inst.amount_step);
  if (Number(amount) < Number(inst.minimum_amount)) throw new Error(`amount ${amount} below minimum ${inst.minimum_amount} for ${o.instrument}`);
  const isBid = o.side === 'buy';
  let px: number;
  if (o.type === 'market') {
    const touch = Number(isBid ? t.a : t.b) || Number(t.M);
    if (!Number.isFinite(touch) || touch <= 0) throw new Error(`no price for ${o.instrument}`);
    px = isBid ? Math.min(touch * 1.02, Number(t.maxp)) : Math.max(touch * 0.98, Number(t.minp));
  } else {
    if (!o.limitPrice) throw new Error('limit price required');
    px = Number(o.limitPrice);
  }
  const limitPrice = floorToStep(px.toFixed(10), inst.tick_size);
  const basis = Math.max(Number(t.I) || 0, Number(limitPrice));
  const maxFee = ((Number(inst.base_fee) / Number(amount) + Number(inst.taker_fee_rate) * basis) * 3).toFixed(6);
  const headers = await authHeaders(owner, creds);
  const subaccountId = await subaccountForUniverse(n, owner, creds, inst.risk_universe_id);
  const immediate = o.type === 'market';
  // The order's expiry may not outlive the session key (Derive error 14038).
  const expirySec = deriveOrderExpiry(immediate, creds.expiresAt);
  const { action, signature, signer } = await signAction(n, creds, owner, subaccountId, DERIVE_MODULES.TRADE,
    encodeTradeData({ asset: inst.base_asset_address, subId: inst.base_asset_sub_id, limitPrice, amount, maxFee, recipientId: subaccountId, isBid }), expirySec);
  const r = await rpc<{ order: { order_id: string; order_status: string; filled_amount: string; average_price: string } }>(n, 'private/order', {
    instrument_name: o.instrument, direction: o.side, amount, limit_price: limitPrice, max_fee: maxFee,
    nonce: action.nonce, signer, signature, signature_expiry_sec: expirySec, subaccount_id: subaccountId,
    order_type: o.type, time_in_force: immediate ? 'ioc' : 'gtc', reduce_only: !!o.reduceOnly, label: 'pulse-risk',
  }, headers);
  return { orderId: r.order.order_id, status: r.order.order_status, filled: Number(r.order.filled_amount) || 0, avgPrice: Number(r.order.average_price) || 0 };
}

/** Signed transfer_spot between two of the wallet's own subaccounts. `to = 0` + `newManager` creates a new subaccount. */
export async function transferSpot(n: Network, wallet: string, creds: DeriveCreds, from: number, to: number, amountUsd: string, newManager = 0): Promise<{ opUuid: string | null }> {
  liveOnly('transfer_spot');
  const owner = getAddress(wallet);
  const subs = await listSubaccounts(n, owner, creds);
  const src = subs.find((s) => s.subaccount_id === from);
  if (!src) throw new Error(`subaccount ${from} is not yours`);
  if (to !== 0 && !subs.some((s) => s.subaccount_id === to)) throw new Error(`subaccount ${to} is not yours`);
  if (to === from) throw new Error('source and destination are the same');
  if (!/^\d+(\.\d{1,6})?$/.test(amountUsd) || Number(amountUsd) <= 0) throw new Error('amount must be a positive USDC amount (<= 6 decimals)');
  const usdc = src.collaterals.find((c) => c.asset_name === 'USDC');
  if (!usdc || Number(usdc.amount) < Number(amountUsd)) throw new Error(`subaccount ${from} holds only ${usdc?.amount ?? 0} USDC`);
  const headers = await authHeaders(owner, creds);
  const maxFeeUsd = '2';
  const expirySec = Math.floor(Date.now() / 1000) + 600;
  const { action, signature, signer } = await signAction(n, creds, owner, from, DERIVE_MODULES.TRANSFER,
    encodeTransferData({ toSubaccountId: to, newSubaccountManager: newManager, asset: DERIVE_USDC_ASSET, amount: amountUsd, maxFeeUsd }), expirySec);
  const res = await rpc<{ op_uuid?: string }>(n, 'private/transfer_spot', {
    subaccount_id: from, to_subaccount_id: to, new_subaccount_manager: newManager, asset_name: 'USDC', sub_id: 0, amount: amountUsd,
    max_fee_usd: maxFeeUsd, nonce: action.nonce, signer, signature, signature_expiry_sec: expirySec,
  }, headers);
  return { opUuid: res.op_uuid ?? null };
}

export const DERIVE_WITHDRAW_MAX_FEE_USD = '3';
export const DERIVE_WITHDRAW_MIN_USD = 5;

/** Withdraw USDC to the wallet itself on Ethereum (~14 min). Recipient is pinned to the owner; nothing else is accepted. */
export async function withdrawToOwner(n: Network, wallet: string, creds: DeriveCreds, subaccountId: number, amountUsd: string): Promise<{ opUuid: string | null; recipient: string }> {
  liveOnly('withdraw');
  const owner = getAddress(wallet);
  if (!/^\d+(\.\d{1,6})?$/.test(amountUsd) || Number(amountUsd) < DERIVE_WITHDRAW_MIN_USD) throw new Error(`Withdraw at least ${DERIVE_WITHDRAW_MIN_USD} USDC (<= 6 decimals); the fee can be up to $${DERIVE_WITHDRAW_MAX_FEE_USD}`);
  const src = (await listSubaccounts(n, owner, creds)).find((s) => s.subaccount_id === subaccountId);
  if (!src) throw new Error(`subaccount ${subaccountId} is not yours`);
  if (src.is_under_liquidation) throw new Error(`subaccount ${subaccountId} is being liquidated`);
  const usdc = Number(src.collaterals.find((c) => c.asset_name === 'USDC')?.amount ?? 0);
  if (usdc < Number(amountUsd)) throw new Error(`subaccount ${subaccountId} holds only ${usdc.toFixed(2)} USDC`);
  // initial_margin is the free margin left after positions/orders; Derive refuses anything that would break it.
  if (Number(src.initial_margin) < Number(amountUsd)) throw new Error(`Only ${Math.max(0, Number(src.initial_margin)).toFixed(2)} USDC is free in subaccount ${subaccountId}`);
  const headers = await authHeaders(owner, creds);
  const expirySec = Math.floor(Date.now() / 1000) + 600;
  const { action, signature, signer } = await signAction(n, creds, owner, subaccountId, DERIVE_MODULES.WITHDRAW,
    encodeWithdrawData({ asset: DERIVE_USDC_ASSET, maxFeeUsd: DERIVE_WITHDRAW_MAX_FEE_USD, recipient: owner, amount: amountUsd }), expirySec);
  const res = await rpc<{ op_uuid?: string }>(n, 'private/withdraw', {
    subaccount_id: subaccountId, asset_name: 'USDC', amount_in_underlying: amountUsd, max_fee_usd: DERIVE_WITHDRAW_MAX_FEE_USD,
    recipient: owner, force_batch: false, nonce: action.nonce, signer, signature, signature_expiry_sec: expirySec,
  }, headers);
  return { opUuid: res.op_uuid ?? null, recipient: owner };
}

export interface DeriveWithdrawal { subaccountId: number; amount: string; fee: string | null; status: string; done: boolean; failed: boolean; timestamp: number; txHash: string | null }

/** The wallet's Derive withdrawals, newest first (last 30 days). */
export async function withdrawals(n: Network, wallet: string, creds: DeriveCreds): Promise<DeriveWithdrawal[]> {
  const owner = getAddress(wallet);
  const r = await rpc<{ withdrawals: { amount: string; fee: string; batch_status: string; subaccount_id: number; timestamp: number; tx_hash?: string }[] }>(
    n, 'private/get_withdrawal_history', { wallet: owner, start_timestamp: Date.now() - 30 * 86_400_000 }, await authHeaders(owner, creds));
  return (r.withdrawals ?? []).map((w) => ({
    subaccountId: w.subaccount_id, amount: w.amount, fee: w.fee ?? null, status: w.batch_status ?? 'pending',
    done: w.batch_status === 'Settled', failed: (w.batch_status ?? '').endsWith('Error'), timestamp: w.timestamp, txHash: w.tx_hash || null,
  })).sort((a, b) => b.timestamp - a.timestamp);
}
