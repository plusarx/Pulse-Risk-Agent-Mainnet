import 'server-only';
import { deriveOrderExpiry } from '@/lib/derive-expiry';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getAddress, type Address, type Hex } from 'viem';
import type { VenueNetwork } from '@/lib/network';
import { DERIVE, DERIVE_AGENT_SCOPES, DERIVE_MODULES } from '@/lib/venues';
import { actionTypedData, encodeSetSessionKeyData, encodeTradeData, encodeTransferData, encodeWhitelistData, encodeWithdrawData, nextNonce, type ActionFields, type DeriveUniverse } from '@/lib/derive-codec';
import { DERIVE_USDC_ASSET } from '@/lib/venues';
import { floorToStep } from '@/lib/decimal';
import { cached, invalidate } from './cache';
import type { HistoryRow } from '@/lib/order-history';
import { promotePending, readPending, writePending } from './keystore';
import { getDb } from './db';
import { decryptSecret, encryptSecret } from './crypto';

// Derive v3 JSON-RPC over REST: POST {base}/{method} with flat params. Browser REST is CORS-blocked,
// so every call goes through here.

interface RpcErr { code: number; message: string; data?: unknown }
export class DeriveError extends Error { constructor(public code: number, msg: string) { super(`Derive ${code}: ${msg}`); } }

export async function deriveRpc<T>(n: VenueNetwork, method: string, params: object, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(`${DERIVE[n].rest}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(params),
    signal: AbortSignal.timeout(12_000), cache: 'no-store',
  });
  const j = (await r.json().catch(() => ({}))) as { result?: T; error?: RpcErr };
  if (j.error) throw new DeriveError(j.error.code, `${j.error.message}${j.error.data ? ' ' + JSON.stringify(j.error.data) : ''}`);
  if (!r.ok || j.result === undefined) throw new DeriveError(r.status, `HTTP ${r.status}`);
  return j.result;
}

const aad = (wallet: string, n: VenueNetwork) => `derive|${n}|${wallet.toLowerCase()}`;
interface KeyRow { account_ref: string; key_ref: string; enc_secret: string; status: string; meta: string | null; expires_at: number | null }
function keyRow(wallet: string, n: VenueNetwork): KeyRow | undefined {
  return getDb().prepare("SELECT account_ref, key_ref, enc_secret, status, meta, expires_at FROM agent_keys WHERE wallet = ? AND venue = 'derive' AND network = ?")
    .get(wallet.toLowerCase(), n) as KeyRow | undefined;
}

/** Headers signed by the session key (no freshness window for session keys). */
async function agentHeaders(n: VenueNetwork, wallet: Address): Promise<{ headers: Record<string, string>; key: ReturnType<typeof privateKeyToAccount>; subaccountId: number }> {
  const row = keyRow(wallet, n);
  if (!row || row.status !== 'active') throw new Error('No active Derive session key — register one on the Agent keys page');
  const key = privateKeyToAccount(decryptSecret(row.enc_secret, aad(wallet, n)) as Hex);
  const ts = String(Date.now());
  const headers = { 'X-DeriveWallet': getAddress(wallet), 'X-DeriveTimestamp': ts, 'X-DeriveSignature': await key.signMessage({ message: ts }) };
  const subaccountId = await ensureTradingSubaccount(n, wallet, headers, Number(row.account_ref));
  return { headers, key, subaccountId };
}

const verifiedSubaccounts = new Map<string, number>();

/**
 * The first deposit creates the trading subaccount AND a non-trading fallback (manager 0). Never trust a
 * stored id blindly: confirm it is not the fallback, otherwise pick the funded non-fallback subaccount
 * and persist the correction. Verified once per process per wallet/network.
 */
async function ensureTradingSubaccount(n: VenueNetwork, wallet: Address, headers: Record<string, string>, stored: number): Promise<number> {
  const k = `${n}:${wallet.toLowerCase()}`;
  const known = verifiedSubaccounts.get(k);
  if (known !== undefined) return known;
  const acct = await deriveRpc<{ subaccount_ids: number[]; fallback_subaccount_id?: number | null }>(n, 'private/get_account', { wallet: getAddress(wallet) }, headers);
  const fallback = acct.fallback_subaccount_id ?? null;
  let chosen = stored;
  if (stored === fallback || !acct.subaccount_ids.includes(stored)) {
    let best: { id: number; value: number } | null = null;
    for (const id of acct.subaccount_ids) {
      if (id === fallback) continue;
      const sub = await deriveRpc<{ manager_id: number; collaterals_value: string }>(n, 'private/get_subaccount', { subaccount_id: id }, headers);
      if (sub.manager_id === 0) continue;
      const value = Number(sub.collaterals_value) || 0;
      if (!best || value > best.value) best = { id, value };
    }
    if (!best) throw new Error('No tradeable Derive subaccount found (only the fallback exists) — deposit again');
    chosen = best.id;
    getDb().prepare("UPDATE agent_keys SET account_ref = ? WHERE wallet = ? AND venue = 'derive' AND network = ?").run(String(chosen), wallet.toLowerCase(), n);
    console.warn(`[derive] corrected trading subaccount ${stored} → ${chosen} (fallback ${fallback})`);
  }
  verifiedSubaccounts.set(k, chosen);
  return chosen;
}

/** Trading subaccount = first non-fallback subaccount. Null if the wallet has never deposited. */
export async function findDeriveSubaccount(n: VenueNetwork, wallet: Address): Promise<number | null> {
  const r = await deriveRpc<{ subaccount_ids: number[] }>(n, 'public/get_subaccounts', { wallet: getAddress(wallet) }).catch((e: unknown) => {
    if (e instanceof DeriveError && e.code === 14000) return { subaccount_ids: [] as number[] };
    throw e;
  });
  if (!r.subaccount_ids?.length) return null;
  // The fallback subaccount (manager 0) catches mis-routed deposits and can't trade; it is created
  // alongside the first real one, so the lowest id with a manager is ours. We pick the first id and
  // confirm its manager once the agent can read it (get_subaccount).
  return [...r.subaccount_ids].sort((a, b) => a - b)[0];
}

const SESSION_KEY_DAYS = 30;

/**
 * Step 1: generate the session key server-side and build what the OWNER (MetaMask) must sign:
 * the set_session_key action, the whitelist-self action (so `withdraw` can pay out to the owner),
 * and the login timestamp for the X-Derive* headers.
 */
export async function prepareDeriveKey(n: VenueNetwork, wallet: Address) {
  const owner = getAddress(wallet);
  const sub = await findDeriveSubaccount(n, owner);
  if (sub === null) throw new Error('No Derive account yet — deposit first (the first deposit creates the account)');
  const pk = generatePrivateKey();
  const agent = privateKeyToAccount(pk).address;
  const now = Math.floor(Date.now() / 1000);
  const keyExpiry = now + SESSION_KEY_DAYS * 86_400;
  const sigExpiry = now + 3_000;
  const setKey: ActionFields = { subaccountId: 0, nonce: nextNonce(), module: DERIVE_MODULES.SET_SESSION_KEY,
    data: encodeSetSessionKeyData(agent, keyExpiry, DERIVE_AGENT_SCOPES.map((s) => s.code)), expirySec: sigExpiry, owner, signer: owner };
  const whitelist: ActionFields = { subaccountId: 0, nonce: nextNonce(), module: DERIVE_MODULES.WHITELISTED_RECIPIENT,
    data: encodeWhitelistData([owner]), expirySec: sigExpiry, owner, signer: owner };
  const loginTs = String(Date.now());
  // Pending only: the current working key (if any) stays active until Derive confirms this one.
  writePending(owner, 'derive', n, {
    account_ref: String(sub), key_ref: agent, public_key: agent, enc_secret: encryptSecret(pk, aad(owner, n)),
    scope: DERIVE_AGENT_SCOPES.map((s) => s.wire).join(','), expires_at: keyExpiry, meta: JSON.stringify({ setKey, whitelist, loginTs }),
  });
  return { subaccountId: sub, agent, chainId: DERIVE[n].chainId, loginMessage: loginTs,
    setKeyTypedData: actionTypedData(setKey, n), whitelistTypedData: actionTypedData(whitelist, n) };
}

/** Step 2: submit with the owner's signatures and read the key back to assert its scopes. */
export async function finalizeDeriveKey(n: VenueNetwork, wallet: Address, sigs: { setKey: Hex; whitelist: Hex; login: Hex }) {
  const owner = getAddress(wallet);
  const row = readPending(owner, 'derive', n);
  if (!row || !row.meta) throw new Error('No pending Derive registration — start again');
  const meta = JSON.parse(row.meta) as { setKey: ActionFields; whitelist: ActionFields; loginTs: string };
  const headers = { 'X-DeriveWallet': owner, 'X-DeriveTimestamp': meta.loginTs, 'X-DeriveSignature': sigs.login };
  await deriveRpc(n, 'private/set_session_key', {
    wallet: owner, public_session_key: row.key_ref, expiry_sec: row.expires_at, subaccount_ids: null,
    nonce: meta.setKey.nonce, signer: owner, signature: sigs.setKey, signature_expiry_sec: meta.setKey.expirySec,
    protocol_scopes: DERIVE_AGENT_SCOPES.map((s) => s.wire), offchain_scopes: ['account_info'], label: 'pulse-risk-agent', ip_whitelist: [],
  }, headers);
  // Whitelisting the owner lets a withdraw-scoped key pay out to it (testnet once required this).
  let whitelisted = true;
  try {
    await deriveRpc(n, 'private/update_whitelisted_recipients', {
      wallet: owner, add: [owner], remove: [], nonce: meta.whitelist.nonce, signer: owner, signature: sigs.whitelist, signature_expiry_sec: meta.whitelist.expirySec,
    }, headers);
  } catch (e) { whitelisted = false; console.warn('[derive] whitelist-self failed', e); }
  const keys = await deriveRpc<{ public_session_keys: { public_session_key: string; protocol_scopes: string[] }[] }>(n, 'private/session_keys', { wallet: owner }, headers);
  const k = keys.public_session_keys.find((x) => x.public_session_key.toLowerCase() === row.key_ref.toLowerCase());
  if (!k) throw new Error('set_session_key accepted but the key is not listed yet — refresh to re-check');
  if (k.protocol_scopes.some((s) => ['admin', 'set_session_key', 'transfer:all', 'transfer:different_owner_subaccount'].includes(s))) {
    throw new Error(`session key has unexpected dangerous scopes: ${k.protocol_scopes.join(',')}`);
  }
  // The first deposit creates the trading subaccount AND a non-trading fallback (manager 0).
  // Ask Derive which one is the fallback instead of guessing by id order.
  const acct = await deriveRpc<{ subaccount_ids: number[]; fallback_subaccount_id?: number | null }>(n, 'private/get_account', { wallet: owner }, headers);
  const trading = [...acct.subaccount_ids].sort((a, b) => a - b).find((id) => id !== acct.fallback_subaccount_id);
  if (trading === undefined) throw new Error('No tradeable Derive subaccount found (only the fallback exists)');
  promotePending(owner, 'derive', n, { account_ref: String(trading), meta: JSON.stringify({ whitelisted, scopes: k.protocol_scopes, fallbackSubaccountId: acct.fallback_subaccount_id ?? null }) });
  verifiedSubaccounts.delete(`${n}:${owner.toLowerCase()}`);
  invalidateSubs(n, owner);
  return { agent: row.key_ref, scopes: k.protocol_scopes, whitelisted, subaccountId: trading };
}

export async function getDeriveSubaccount(n: VenueNetwork, wallet: Address) {
  const { headers, subaccountId } = await agentHeaders(n, wallet);
  return deriveRpc<DeriveSubaccount>(n, 'private/get_subaccount', { subaccount_id: subaccountId }, headers);
}

export interface DeriveSubaccount {
  subaccount_id: number; manager_id: number; margin_type: string; is_under_liquidation: boolean;
  initial_margin: string; maintenance_margin: string; collaterals_value: string; positions_value?: string; open_orders_margin?: string;
  collaterals: { asset_name: string; amount: string; mark_value: string }[];
  positions: { instrument_name: string; instrument_type: string; amount: string; average_price: string; mark_price: string; mark_value: string; unrealized_pnl: string; liquidation_price: string | null; delta?: string }[];
  open_orders: { order_id: string; instrument_name: string; direction: string; amount: string; limit_price: string; filled_amount: string; order_status: string }[];
}

interface Instrument { instrument_name: string; base_asset_address: Address; base_asset_sub_id: string; tick_size: string; amount_step: string; minimum_amount: string; base_fee: string; taker_fee_rate: string; is_active: boolean; risk_universe_id: number }

// ── Risk universes & subaccounts ─────────────────────────────────────────────
// Each Derive subaccount has ONE manager, and the manager fixes the risk universe it can trade
// (PRIME: BTC/ETH, MIDCAP: HYPE, ALT: SOL/XRP/…, RWA: NVDA/US500/…). Trading every market therefore
// needs one subaccount per universe; orders are routed to the subaccount of the instrument's universe.

export async function deriveUniverses(n: VenueNetwork): Promise<DeriveUniverse[]> {
  return cached(`derive-universes:${n}`, 10 * 60_000, async () => {
    const r = await deriveRpc<{ risk_universe_id: number; name: string | null; managers: { manager_id: number; margin_type: string; instruments: string[] }[] }[] | { risk_universes: never[] }>(n, 'public/get_risk_universes', {});
    const list = Array.isArray(r) ? r : r.risk_universes;
    return list.filter((u) => u.risk_universe_id > 0).map((u) => ({
      id: u.risk_universe_id, name: u.name ?? `#${u.risk_universe_id}`,
      managers: u.managers.map((m) => ({ managerId: m.manager_id, marginType: m.margin_type })),
      families: [...new Set(u.managers.flatMap((m) => m.instruments))],
    }));
  });
}

export interface SubaccountView extends DeriveSubaccount { isFallback: boolean; universeId: number | null; universeName: string | null }

/** Every subaccount the wallet owns, with its universe. Cached 3 s (the UI polls). */
export async function listDeriveSubaccounts(n: VenueNetwork, wallet: Address): Promise<SubaccountView[]> {
  const owner = getAddress(wallet);
  return cached(`derive-subs:${n}:${owner}`, 3_000, async () => {
    const { headers } = await agentHeaders(n, owner);
    const [acct, universes] = await Promise.all([
      deriveRpc<{ subaccount_ids: number[]; fallback_subaccount_id?: number | null }>(n, 'private/get_account', { wallet: owner }, headers),
      deriveUniverses(n),
    ]);
    const subs = await Promise.all(acct.subaccount_ids.map((id) => deriveRpc<DeriveSubaccount>(n, 'private/get_subaccount', { subaccount_id: id }, headers)));
    return subs.map((s) => {
      const u = universes.find((x) => x.managers.some((m) => m.managerId === s.manager_id));
      return { ...s, isFallback: s.subaccount_id === acct.fallback_subaccount_id || s.manager_id === 0, universeId: u?.id ?? null, universeName: u?.name ?? null };
    }).sort((a, b) => a.subaccount_id - b.subaccount_id);
  });
}

/** The subaccount that trades `universeId`: prefer the one with the most collateral. */
async function subaccountForUniverse(n: VenueNetwork, wallet: Address, universeId: number): Promise<number> {
  const subs = (await listDeriveSubaccounts(n, wallet)).filter((s) => !s.isFallback && s.universeId === universeId);
  if (!subs.length) {
    const u = (await deriveUniverses(n)).find((x) => x.id === universeId);
    throw new Error(`No subaccount for the ${u?.name ?? universeId} universe yet. Enable it under Options → Risk universes (moves USDC into a new subaccount).`);
  }
  return subs.sort((a, b) => Number(b.collaterals_value) - Number(a.collaterals_value))[0].subaccount_id;
}

function invalidateSubs(n: VenueNetwork, wallet: Address) {
  invalidate(`derive-subs:${n}:${getAddress(wallet)}`);
}

/** Signed transfer_spot from one of the wallet's subaccounts. `to = 0` + `newManager` creates a new subaccount. */
async function transferSpot(n: VenueNetwork, wallet: Address, from: number, to: number, newManager: number, amount: string) {
  const owner = getAddress(wallet);
  const subs = await listDeriveSubaccounts(n, owner);
  const src = subs.find((s) => s.subaccount_id === from);
  if (!src) throw new Error(`subaccount ${from} is not yours`);
  if (to !== 0 && !subs.some((s) => s.subaccount_id === to)) throw new Error(`subaccount ${to} is not yours`);
  if (to === from) throw new Error('source and destination are the same');
  if (!/^\d+(\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) throw new Error('amount must be a positive USDC amount (≤ 6 decimals)');
  const usdc = src.collaterals.find((c) => c.asset_name === 'USDC');
  if (!usdc || Number(usdc.amount) < Number(amount)) throw new Error(`subaccount ${from} holds only ${usdc?.amount ?? 0} USDC`);
  const { headers, key } = await agentHeaders(n, owner);
  const maxFeeUsd = '2'; // creation fee is ~$1; same-universe moves are ~free
  const expirySec = Math.floor(Date.now() / 1000) + 600;
  const action: ActionFields = { subaccountId: from, nonce: nextNonce(), module: DERIVE_MODULES.TRANSFER, expirySec, owner, signer: key.address,
    data: encodeTransferData({ toSubaccountId: to, newSubaccountManager: newManager, asset: DERIVE_USDC_ASSET, amount, maxFeeUsd }) };
  const td = actionTypedData(action, n);
  const signature = await key.signTypedData({ ...td, message: { ...td.message, subaccountId: BigInt(from), nonce: BigInt(action.nonce), expiry: BigInt(expirySec) } });
  const res = await deriveRpc<{ op_uuid?: string; operation_id?: string | number }>(n, 'private/transfer_spot', {
    subaccount_id: from, to_subaccount_id: to, new_subaccount_manager: newManager, asset_name: 'USDC', sub_id: 0, amount,
    max_fee_usd: maxFeeUsd, nonce: action.nonce, signer: key.address, signature, signature_expiry_sec: expirySec,
  }, headers);
  invalidateSubs(n, owner);
  return { opUuid: res.op_uuid ?? null, operationId: res.operation_id ?? null };
}

/** Enable a risk universe: create a subaccount under `managerId`, funded from the richest existing one. */
export async function enableDeriveUniverse(n: VenueNetwork, wallet: Address, managerId: number, amount: string) {
  const universes = await deriveUniverses(n);
  const u = universes.find((x) => x.managers.some((m) => m.managerId === managerId));
  if (!u) throw new Error(`unknown Derive manager ${managerId}`);
  if (Number(amount) < 7) throw new Error('Fund a new subaccount with at least 7 USDC (≈$1 creation fee, ≥ $5 must remain)');
  const subs = (await listDeriveSubaccounts(n, wallet)).filter((s) => !s.isFallback || Number(s.collaterals_value) > 0);
  const src = subs.sort((a, b) => Number(b.initial_margin) - Number(a.initial_margin))[0];
  if (!src || Number(src.initial_margin) < Number(amount)) throw new Error(`Not enough free margin to move ${amount} USDC (most free: ${src ? Number(src.initial_margin).toFixed(2) : 0}). Deposit more first.`);
  return { from: src.subaccount_id, universe: u.name, ...(await transferSpot(n, wallet, src.subaccount_id, 0, managerId, amount)) };
}

export async function moveDeriveFunds(n: VenueNetwork, wallet: Address, from: number, to: number, amount: string) {
  return transferSpot(n, wallet, from, to, 0, amount);
}

/** Most Derive will take as the withdraw fee (USD). Observed ~$1; a quote above this is refused, not paid. */
export const DERIVE_WITHDRAW_MAX_FEE_USD = '3';
/** Smallest withdrawal we send: must clear the fee cap with something left to arrive. */
export const DERIVE_WITHDRAW_MIN_USD = 5;

/**
 * Withdraw USDC from one of the wallet's own subaccounts to the wallet itself on Ethereum (~14 min).
 * Signed by the agent session key (scope `withdraw`); the recipient is pinned to the owner, which the
 * owner whitelisted at onboarding. Funds never go anywhere else.
 */
export async function withdrawDerive(n: VenueNetwork, wallet: Address, subaccountId: number, amount: string) {
  const owner = getAddress(wallet);
  if (!/^\d+(\.\d{1,6})?$/.test(amount) || Number(amount) < DERIVE_WITHDRAW_MIN_USD) throw new Error(`Withdraw at least ${DERIVE_WITHDRAW_MIN_USD} USDC (≤ 6 decimals); the fee can be up to $${DERIVE_WITHDRAW_MAX_FEE_USD}`);
  const subs = await listDeriveSubaccounts(n, owner);
  const src = subs.find((s) => s.subaccount_id === subaccountId);
  if (!src) throw new Error(`subaccount ${subaccountId} is not yours`);
  if (src.is_under_liquidation) throw new Error(`subaccount ${subaccountId} is being liquidated`);
  const usdc = Number(src.collaterals.find((c) => c.asset_name === 'USDC')?.amount ?? 0);
  if (usdc < Number(amount)) throw new Error(`subaccount ${subaccountId} holds only ${usdc.toFixed(2)} USDC`);
  // initial_margin is the free margin left after open positions/orders; Derive refuses anything that would break it.
  if (Number(src.initial_margin) < Number(amount)) throw new Error(`Only ${Math.max(0, Number(src.initial_margin)).toFixed(2)} USDC is free in subaccount ${subaccountId}; close positions or withdraw less`);
  const { headers, key } = await agentHeaders(n, owner);
  const expirySec = Math.floor(Date.now() / 1000) + 600;
  const action: ActionFields = { subaccountId, nonce: nextNonce(), module: DERIVE_MODULES.WITHDRAW, expirySec, owner, signer: key.address,
    data: encodeWithdrawData({ asset: DERIVE_USDC_ASSET, maxFeeUsd: DERIVE_WITHDRAW_MAX_FEE_USD, recipient: owner, amount }) };
  const td = actionTypedData(action, n);
  const signature = await key.signTypedData({ ...td, message: { ...td.message, subaccountId: BigInt(subaccountId), nonce: BigInt(action.nonce), expiry: BigInt(expirySec) } });
  const res = await deriveRpc<{ op_uuid?: string; operation_id?: string | number }>(n, 'private/withdraw', {
    subaccount_id: subaccountId, asset_name: 'USDC', amount_in_underlying: amount, max_fee_usd: DERIVE_WITHDRAW_MAX_FEE_USD,
    recipient: owner, force_batch: false, nonce: action.nonce, signer: key.address, signature, signature_expiry_sec: expirySec,
  }, headers);
  invalidateSubs(n, owner);
  return { opUuid: res.op_uuid ?? null, operationId: res.operation_id ?? null, recipient: owner };
}

export interface WithdrawalView { venue: 'derive' | 'lighter'; account: string; amount: string; fee: string | null; status: string; done: boolean; failed: boolean; timestamp: number; txHash: string | null }

/** The wallet's Derive withdrawals, newest first (last 30 days). */
export async function deriveWithdrawals(n: VenueNetwork, wallet: Address): Promise<WithdrawalView[]> {
  const owner = getAddress(wallet);
  const { headers } = await agentHeaders(n, owner);
  const r = await deriveRpc<{ withdrawals: { amount: string; fee: string; batch_status: string; subaccount_id: number; timestamp: number; tx_hash?: string }[] }>(
    n, 'private/get_withdrawal_history', { wallet: owner, start_timestamp: Date.now() - 30 * 86_400_000 }, headers);
  return (r.withdrawals ?? []).map((w) => ({
    venue: 'derive' as const, account: `#${w.subaccount_id}`, amount: w.amount, fee: w.fee ?? null, status: w.batch_status ?? 'pending',
    done: w.batch_status === 'Settled', failed: (w.batch_status ?? '').endsWith('Error'), timestamp: w.timestamp, txHash: w.tx_hash || null,
  })).sort((a, b) => b.timestamp - a.timestamp);
}

/** The wallet's Derive orders across all subaccounts (filled, cancelled, rejected, expired and open), newest first. */
export async function deriveOrderHistory(n: VenueNetwork, wallet: Address, limit = 50): Promise<HistoryRow[]> {
  const owner = getAddress(wallet);
  const { headers } = await agentHeaders(n, owner);
  const r = await deriveRpc<{ orders?: { creation_timestamp: number; instrument_name: string; direction: 'buy' | 'sell'; order_type: string; amount: string; filled_amount: string; average_price: string; order_status: string; cancel_reason?: string; subaccount_id: number; order_id?: string }[] }>(
    n, 'private/get_order_history', { wallet: owner, page_size: limit }, headers);
  // Settlement hash per order: Derive records it on each trade (tx_hash, once settled on chain). A failed read leaves it empty.
  const hashOf = new Map<string, string>();
  const refOf = new Map<string, { tradeId: string | null; settlement: string | null }>();
  const subs = [...new Set((r.orders ?? []).filter((o) => Number(o.filled_amount) > 0).map((o) => o.subaccount_id))].slice(0, 8);
  await Promise.all(subs.map(async (sub) => {
    try {
      const t = await deriveRpc<{ trades?: { order_id?: string; trade_id?: string; tx_hash?: string | null; batch_status?: string | null }[] }>(n, 'private/get_trade_history', { subaccount_id: sub, page_size: 100 }, headers);
      for (const tr of t.trades ?? []) {
        if (!tr.order_id) continue;
        if (tr.tx_hash && !hashOf.has(tr.order_id)) hashOf.set(tr.order_id, tr.tx_hash);
        if (!refOf.has(tr.order_id)) refOf.set(tr.order_id, { tradeId: tr.trade_id ?? null, settlement: tr.batch_status ?? null });
      }
    } catch { /* no hashes this time */ }
  }));
  return (r.orders ?? []).map((o) => ({
    venue: 'derive' as const, time: o.creation_timestamp, market: o.instrument_name, side: o.direction, type: o.order_type,
    size: o.amount, filled: o.filled_amount, avgPrice: Number(o.filled_amount) > 0 ? o.average_price : null,
    status: o.cancel_reason ? `${o.order_status}:${o.cancel_reason}` : o.order_status, account: `#${o.subaccount_id}`, txHash: (o.order_id && hashOf.get(o.order_id)) || null,
    tradeId: (o.order_id && refOf.get(o.order_id)?.tradeId) || null, settlement: (o.order_id && refOf.get(o.order_id)?.settlement) || null,
  })).sort((a, b) => b.time - a.time);
}

export interface DeriveOrderReq { instrument: string; side: 'buy' | 'sell'; amount: string; limitPrice?: string; type: 'limit' | 'market'; reduceOnly?: boolean; postOnly?: boolean }

export async function placeDeriveOrder(n: VenueNetwork, wallet: Address, o: DeriveOrderReq) {
  const owner = getAddress(wallet);
  const inst = await deriveRpc<Instrument>(n, 'public/get_instrument', { instrument_name: o.instrument });
  if (!inst.is_active) throw new Error(`${o.instrument} is not active`);
  const t = await deriveRpc<{ b: string; a: string; I: string; M: string; minp: string; maxp: string }>(n, 'public/get_ticker', { instrument_name: o.instrument });
  const amount = floorToStep(o.amount, inst.amount_step);
  if (Number(amount) < Number(inst.minimum_amount)) throw new Error(`amount below minimum ${inst.minimum_amount}`);
  const isBid = o.side === 'buy';
  let px: number;
  if (o.type === 'market') {
    // Worst acceptable price: 2% through the touch, clamped to the venue's price band.
    const touch = Number(isBid ? t.a : t.b) || Number(t.M);
    px = isBid ? Math.min(touch * 1.02, Number(t.maxp)) : Math.max(touch * 0.98, Number(t.minp));
  } else {
    if (!o.limitPrice) throw new Error('limit price required');
    px = Number(o.limitPrice);
  }
  const limitPrice = floorToStep(px.toFixed(10), inst.tick_size);
  const basis = Math.max(Number(t.I) || 0, Number(limitPrice));
  const maxFee = ((Number(inst.base_fee) / Number(amount) + Number(inst.taker_fee_rate) * basis) * 3).toFixed(6);
  const { headers, key } = await agentHeaders(n, owner);
  // Route to the subaccount whose manager trades this instrument's risk universe.
  const subaccountId = await subaccountForUniverse(n, owner, inst.risk_universe_id);
  const immediate = o.type === 'market';
  // The order's expiry may not outlive the session key (Derive error 14038).
  const expirySec = deriveOrderExpiry(immediate, keyRow(owner, n)?.expires_at ?? null);
  const action: ActionFields = { subaccountId, nonce: nextNonce(), module: DERIVE_MODULES.TRADE, expirySec, owner, signer: key.address,
    data: encodeTradeData({ asset: inst.base_asset_address, subId: inst.base_asset_sub_id, limitPrice, amount, maxFee, recipientId: subaccountId, isBid }) };
  const td = actionTypedData(action, n);
  const signature = await key.signTypedData({ ...td, message: { ...td.message, subaccountId: BigInt(action.subaccountId), nonce: BigInt(action.nonce), expiry: BigInt(expirySec) } });
  return deriveRpc<{ order: { order_id: string; order_status: string; filled_amount: string; average_price: string } }>(n, 'private/order', {
    instrument_name: o.instrument, direction: o.side, amount, limit_price: limitPrice, max_fee: maxFee,
    nonce: action.nonce, signer: key.address, signature, signature_expiry_sec: expirySec, subaccount_id: subaccountId,
    order_type: o.type, time_in_force: immediate ? 'ioc' : o.postOnly ? 'post_only' : 'gtc', reduce_only: !!o.reduceOnly, label: 'pulse-risk',
  }, headers);
}

export async function cancelDeriveOrder(n: VenueNetwork, wallet: Address, instrument: string, orderId: string) {
  const { headers } = await agentHeaders(n, wallet);
  const inst = await deriveRpc<Instrument>(n, 'public/get_instrument', { instrument_name: instrument });
  const subaccountId = await subaccountForUniverse(n, wallet, inst.risk_universe_id);
  return deriveRpc(n, 'private/cancel', { subaccount_id: subaccountId, instrument_name: instrument, order_id: orderId }, headers);
}
