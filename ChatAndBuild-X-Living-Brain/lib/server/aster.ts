import 'server-only';
import { asterDepositRows } from './aster-deposits';
import { getAddress, verifyTypedData, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { VenueNetwork } from '@/lib/network';
import {
  ASTER, ASTER_AGENT_TTL_MS, agentApprovalBody, agentApprovalMessage, agentApprovalTypedData, asterNonce, asterSymbol, signedPath,
  stepQty, symbolRules, tickPrice, tickerOfAster,
  type AsterAccount, type AsterOrder, type AsterPosition, type AsterSymbolInfo, type SignTyped, type TypedData,
} from '@/lib/aster';
import {
  ASTER_NO_DEPOSIT_CODE, asterOutcome, emptyAsterView, extractFee, mapAsterAccount, mapAsterHistory, withdrawActionTypedData, withdrawFee, withdrawFeeFloor,
  type AsterAccountView, type AsterMarket,
} from '@/lib/aster-view';
import { BSTOCKS_BSC } from '@/lib/bstocks';
import type { HistoryRow } from '@/lib/order-history';
import { cached, invalidate } from './cache';
import { getDb } from './db';
import { decryptSecret, encryptSecret } from './crypto';
import { promotePending, readPending, writePending } from './keystore';

// Aster perps (BNB Chain) server client. Reads and orders are signed by the wallet's AGENT key (approved once by the
// user in MetaMask, kept encrypted here); the agent can never withdraw. Every outbound call has a 10 s timeout, and a
// 418/429 from Aster pauses all calls to that network until the venue's back-off has passed.

const TIMEOUT_MS = 10_000;
const ASTER_WEB = 'https://www.asterdex.com';

export class AsterError extends Error {
  constructor(public code: number, msg: string) { super(`Aster ${code}: ${msg}`); }
}

// ── transport ────────────────────────────────────────────────────────────────
const coolUntil = new Map<VenueNetwork, number>();

async function asterFetch<T>(n: VenueNetwork, pathAndQuery: string, init: RequestInit = {}): Promise<T> {
  const until = coolUntil.get(n) ?? 0;
  if (until > Date.now()) throw new Error(`Perps venue asked us to slow down; retry in ${Math.ceil((until - Date.now()) / 1000)} s`);
  const r = await fetch(`${ASTER[n].fapi}${pathAndQuery}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  if (r.status === 418 || r.status === 429) {
    const after = Number(r.headers.get('retry-after'));
    coolUntil.set(n, Date.now() + (Number.isFinite(after) && after > 0 ? after * 1000 : r.status === 418 ? 120_000 : 30_000));
    throw new Error(`Perps venue rate limit (HTTP ${r.status}); backing off`);
  }
  const text = await r.text();
  let j: unknown;
  try { j = text ? JSON.parse(text) : {}; } catch {
    throw new Error(`Perps venue API is unavailable right now (HTTP ${r.status}). Try again shortly.`);
  }
  // Binance-style error body: { code: <negative>, msg }. Some management replies use { code: 200 } for success.
  const e = j as { code?: number; msg?: string };
  if (e && typeof e === 'object' && !Array.isArray(e) && typeof e.code === 'number' && e.code < 0) throw new AsterError(e.code, e.msg ?? 'error');
  if (!r.ok) throw new AsterError(r.status, e?.msg ?? `HTTP ${r.status}`);
  return j as T;
}

function publicGet<T>(n: VenueNetwork, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  return asterFetch<T>(n, q ? `${path}?${q}` : path);
}

// ── agent key ────────────────────────────────────────────────────────────────
const aad = (wallet: string, n: VenueNetwork) => `aster|${n}|${wallet.toLowerCase()}`;

interface KeyRow { account_ref: string; key_ref: string; enc_secret: string; status: string; expires_at: number | null; meta: string | null }
function keyRow(wallet: string, n: VenueNetwork): KeyRow | undefined {
  return getDb().prepare("SELECT account_ref, key_ref, enc_secret, status, expires_at, meta FROM agent_keys WHERE wallet = ? AND venue = 'aster' AND network = ?")
    .get(wallet.toLowerCase(), n) as KeyRow | undefined;
}

export function hasAsterAgent(wallet: string, n: VenueNetwork): boolean {
  const r = keyRow(wallet, n);
  return r?.status === 'active' && (r.expires_at === null || r.expires_at > Date.now());
}

interface Agent { user: string; agent: string; sign: SignTyped; expiresAt: number | null }
function agentFor(wallet: string, n: VenueNetwork): Agent {
  const row = keyRow(wallet, n);
  if (!row || row.status !== 'active') throw new Error('No active perps agent key — register one on the Agent keys page');
  if (row.expires_at !== null && row.expires_at <= Date.now()) throw new Error('The perps agent key has expired — register it again on the Agent keys page');
  const acct = privateKeyToAccount(decryptSecret(row.enc_secret, aad(wallet, n)) as Hex);
  const sign: SignTyped = (td: TypedData) => acct.signTypedData({ domain: td.domain, types: td.types, primaryType: td.primaryType, message: td.message });
  return { user: row.account_ref, agent: row.key_ref, sign, expiresAt: row.expires_at };
}

async function signed<T>(n: VenueNetwork, wallet: string, method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const a = agentFor(wallet, n);
  return asterFetch<T>(n, await signedPath(n, path, params, a.user, a.agent, a.sign), { method });
}

/** Remember which symbols this wallet traded here, so history (which Aster serves per symbol) can find them. */
function rememberSymbol(wallet: string, n: VenueNetwork, symbol: string) {
  const row = keyRow(wallet, n);
  if (!row) return;
  const meta = (row.meta ? JSON.parse(row.meta) : {}) as { symbols?: string[] };
  const symbols = [symbol, ...(meta.symbols ?? []).filter((s) => s !== symbol)].slice(0, 12);
  getDb().prepare("UPDATE agent_keys SET meta = ? WHERE wallet = ? AND venue = 'aster' AND network = ?").run(JSON.stringify({ ...meta, symbols }), wallet.toLowerCase(), n);
}

// ── agent registration: prepare → the user signs in MetaMask → confirm ─────
export async function prepareAsterKey(n: VenueNetwork, wallet: Address): Promise<{ typedData: TypedData; msg: string; agent: Address; expiresAt: number }> {
  const user = getAddress(wallet);
  const pk = generatePrivateKey();
  const agent = privateKeyToAccount(pk).address;
  const expiresAt = Date.now() + ASTER_AGENT_TTL_MS;
  const msg = agentApprovalMessage(n, { user, agentAddress: agent, nonce: String(asterNonce()), expiredMs: expiresAt });
  // Pending only: the working key (if any) stays active until Aster accepts this one.
  writePending(user, 'aster', n, {
    account_ref: user.toLowerCase(), key_ref: agent, public_key: agent, enc_secret: encryptSecret(pk, aad(user, n)),
    scope: 'perp-trade,read', expires_at: expiresAt, meta: JSON.stringify({ msg }),
  });
  return { typedData: agentApprovalTypedData(n, msg), msg, agent, expiresAt };
}

export async function confirmAsterKey(n: VenueNetwork, wallet: Address, signature: Hex): Promise<{ agent: string; expiresAt: number | null }> {
  const user = getAddress(wallet);
  const p = readPending(user, 'aster', n);
  if (!p?.meta) throw new Error('No pending perps registration — start again');
  const { msg } = JSON.parse(p.meta) as { msg: string };
  const td = agentApprovalTypedData(n, msg);
  // Check the signature is the signed-in wallet's before sending it on (a wrong chain in MetaMask fails here).
  const ok = await verifyTypedData({ address: user, domain: td.domain, types: td.types, primaryType: td.primaryType, message: td.message, signature });
  if (!ok) throw new Error('That signature is not from your wallet for this approval. Make sure MetaMask is on BNB Chain and try again.');
  try {
    await asterFetch<{ code?: number }>(n, '/fapi/v3/registerAndApproveAgent', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: agentApprovalBody(msg, signature),
    });
  } catch (e) {
    // Re-submitting an already-approved agent is a success, not a failure.
    if (!/already exists/i.test((e as Error).message)) throw e;
  }
  promotePending(user, 'aster', n, { meta: JSON.stringify({ approvedAt: Date.now() }) });
  invalidate(`aster-acct:${n}:${user.toLowerCase()}`);
  return { agent: p.key_ref, expiresAt: p.expires_at };
}

// ── account ──────────────────────────────────────────────────────────────────
export async function asterAccountView(n: VenueNetwork, wallet: Address): Promise<AsterAccountView> {
  const row = keyRow(wallet, n);
  if (!row || row.status !== 'active' || (row.expires_at !== null && row.expires_at <= Date.now())) return emptyAsterView('needs_agent');
  return cached(`aster-acct:${n}:${wallet.toLowerCase()}`, 2_000, async () => {
    try {
      const [acct, pos, orders] = await Promise.all([
        signed<AsterAccount>(n, wallet, 'GET', '/fapi/v3/account'),
        signed<AsterPosition[]>(n, wallet, 'GET', '/fapi/v3/positionRisk'),
        signed<AsterOrder[]>(n, wallet, 'GET', '/fapi/v3/openOrders'),
      ]);
      return mapAsterAccount(acct, Array.isArray(pos) ? pos : [], Array.isArray(orders) ? orders : [], row.expires_at);
    } catch (e) {
      if (e instanceof AsterError && e.code === ASTER_NO_DEPOSIT_CODE) return emptyAsterView('no_deposit', row.expires_at);
      throw e;
    }
  });
}

// ── markets (public) ─────────────────────────────────────────────────────────
interface ExchangeInfo { symbols: (AsterSymbolInfo & { contractType?: string })[] }

async function symbolInfos(n: VenueNetwork): Promise<Map<string, AsterSymbolInfo>> {
  return cached(`aster-xinfo:${n}`, 10 * 60_000, async () => {
    const j = await publicGet<ExchangeInfo>(n, '/fapi/v1/exchangeInfo');
    const out = new Map<string, AsterSymbolInfo>();
    for (const s of j.symbols ?? []) {
      if (s.status !== 'TRADING' || s.quoteAsset !== 'USDT' || (s.contractType && s.contractType !== 'PERPETUAL')) continue;
      if (!tickerOfAster(s.symbol)) continue;
      out.set(s.symbol, s);
    }
    return out;
  });
}

interface Ticker24 { symbol: string; lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string; quoteVolume: string }
interface Premium { symbol: string; markPrice: string; indexPrice: string; lastFundingRate: string }

export async function asterMarkets(n: VenueNetwork): Promise<AsterMarket[]> {
  const infos = await symbolInfos(n);
  return cached(`aster-markets:${n}`, 5_000, async () => {
    // 24h stats are best-effort (Binance-compatible endpoint); fall back to the last price alone.
    const t24 = await publicGet<Ticker24[]>(n, '/fapi/v1/ticker/24hr').catch(async () =>
      (await publicGet<{ symbol: string; price: string }[]>(n, '/fapi/v1/ticker/price')).map((t) => ({ symbol: t.symbol, lastPrice: t.price, priceChangePercent: '', highPrice: '', lowPrice: '', quoteVolume: '' })));
    const prem = await publicGet<Premium[]>(n, '/fapi/v1/premiumIndex').catch(() => [] as Premium[]);
    const tk = new Map(t24.map((t) => [t.symbol, t]));
    const pm = new Map(prem.map((p) => [p.symbol, p]));
    const f = (s: string | undefined) => (s === undefined || s === '' || !Number.isFinite(Number(s)) ? null : Number(s));
    return [...infos.values()].map((s) => {
      const r = symbolRules(s); const t = tk.get(s.symbol); const p = pm.get(s.symbol);
      return {
        symbol: s.symbol, ticker: tickerOfAster(s.symbol)!, ...r, pricePrecision: s.pricePrecision, quantityPrecision: s.quantityPrecision,
        last: f(t?.lastPrice), mark: f(p?.markPrice), index: f(p?.indexPrice), fundingRate: f(p?.lastFundingRate),
        changePct: f(t?.priceChangePercent), high: f(t?.highPrice), low: f(t?.lowPrice), volumeUsd: f(t?.quoteVolume),
      };
    }).sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0));
  });
}

const INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
export async function asterKlines(n: VenueNetwork, ticker: string, interval: string, limit = 400) {
  if (!INTERVALS.has(interval)) throw new Error('bad interval');
  const rows = await publicGet<[number, string, string, string, string, string][]>(n, '/fapi/v1/klines', { symbol: asterSymbol(ticker), interval, limit: Math.min(1000, Math.max(1, limit)) });
  return rows.map((k) => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
}

export async function asterDepth(n: VenueNetwork, ticker: string) {
  const j = await publicGet<{ bids: [string, string][]; asks: [string, string][] }>(n, '/fapi/v1/depth', { symbol: asterSymbol(ticker), limit: 50 });
  return { bids: j.bids.map(([p, q]) => [+p, +q] as [number, number]), asks: j.asks.map(([p, q]) => [+p, +q] as [number, number]) };
}

export async function asterRecentTrades(n: VenueNetwork, ticker: string) {
  const j = await publicGet<{ id: number; price: string; qty: string; time: number; isBuyerMaker: boolean }[]>(n, '/fapi/v1/trades', { symbol: asterSymbol(ticker), limit: 40 });
  return j.map((t) => ({ id: t.id, price: +t.price, size: +t.qty, time: t.time, side: (t.isBuyerMaker ? 'sell' : 'buy') as 'buy' | 'sell' })).reverse();
}

// ── orders (agent-signed; no MetaMask popup) ─────────────────────────────────
export interface AsterOrderReq { ticker: string; side: 'buy' | 'sell'; type: 'market' | 'limit'; size: string; price?: string; reduceOnly?: boolean }

export async function placeAsterOrder(n: VenueNetwork, wallet: Address, o: AsterOrderReq): Promise<{ orderId: string; symbol: string; status: string }> {
  const symbol = asterSymbol(o.ticker);
  const info = (await symbolInfos(n)).get(symbol);
  if (!info) throw new Error(`${o.ticker} is not a tradeable perps market`);
  const r = symbolRules(info);
  const quantity = stepQty(Number(o.size), r.stepSize);
  if (!(Number(quantity) > 0) || Number(quantity) < r.minQty) throw new Error(`Size is below the market minimum of ${r.minQty} ${o.ticker}`);
  let price: string | undefined;
  let refPx: number | null;
  if (o.type === 'limit') {
    if (!(Number(o.price) > 0)) throw new Error('limit price required');
    // Round so the limit never becomes more aggressive than asked: buys down, sells up.
    price = tickPrice(Number(o.price), r.tickSize, o.side === 'sell');
    refPx = Number(price);
  } else {
    refPx = (await asterMarkets(n)).find((m) => m.symbol === symbol)?.mark ?? null;
  }
  if (!o.reduceOnly && refPx !== null && Number(quantity) * refPx < r.minNotional) {
    throw new Error(`The perps minimum order is $${r.minNotional}; this one is $${(Number(quantity) * refPx).toFixed(2)}`);
  }
  const params: Record<string, string> = { symbol, side: o.side === 'buy' ? 'BUY' : 'SELL', type: o.type === 'limit' ? 'LIMIT' : 'MARKET' };
  if (o.type === 'limit') params.timeInForce = 'GTC';
  params.quantity = quantity;
  if (price) params.price = price;
  if (o.reduceOnly) params.reduceOnly = 'true';
  const res = await signed<AsterOrder>(n, wallet, 'POST', '/fapi/v3/order', params);
  rememberSymbol(wallet, n, symbol);
  invalidate(`aster-acct:${n}:${wallet.toLowerCase()}`);
  invalidate(`aster-hist:${n}:${wallet.toLowerCase()}`);
  return { orderId: String(res.orderId), symbol, status: res.status };
}

// ── leverage (per market; changes the margin an order needs, not the order) ──
const maxLevCache = new Map<string, { at: number; max: number }>();
/** Highest leverage Aster allows on this market for a fresh position (bracket 1 of /fapi/v3/leverageBracket; NVDA = 20, live 2026-11-26). */
export async function asterMaxLeverage(n: VenueNetwork, wallet: Address, ticker: string): Promise<number> {
  const symbol = asterSymbol(ticker); const k = `${n}:${symbol}`; const hit = maxLevCache.get(k);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.max;
  const r = await signed<{ symbol: string; brackets: { bracket: number; initialLeverage: number }[] }[] | { brackets: { bracket: number; initialLeverage: number }[] }>(n, wallet, 'GET', '/fapi/v3/leverageBracket', { symbol });
  const row = Array.isArray(r) ? r.find((x) => x.symbol === symbol) ?? r[0] : r;
  const max = Math.max(1, ...(row?.brackets ?? []).map((b) => Number(b.initialLeverage) || 1));
  maxLevCache.set(k, { at: Date.now(), max });
  return max;
}

/** Set this market's leverage (whole number, 1..max). Aster itself refuses an invalid value (-4028). */
export async function setAsterLeverage(n: VenueNetwork, wallet: Address, ticker: string, leverage: number): Promise<{ leverage: number; max: number }> {
  const max = await asterMaxLeverage(n, wallet, ticker);
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > max) throw new Error(`Leverage must be a whole number from 1 to ${max}x on ${ticker}`);
  const res = await signed<{ leverage: number }>(n, wallet, 'POST', '/fapi/v3/leverage', { symbol: asterSymbol(ticker), leverage });
  invalidate(`aster-acct:${n}:${wallet.toLowerCase()}`);
  return { leverage: Number(res.leverage) || leverage, max };
}

export async function cancelAsterOrder(n: VenueNetwork, wallet: Address, ticker: string, orderId: string): Promise<{ ok: true }> {
  if (!/^\d+$/.test(orderId)) throw new Error('bad orderId');
  await signed(n, wallet, 'DELETE', '/fapi/v3/order', { symbol: asterSymbol(ticker), orderId });
  invalidate(`aster-acct:${n}:${wallet.toLowerCase()}`);
  return { ok: true };
}

async function ordersFor(n: VenueNetwork, wallet: Address, symbol: string, limit: number): Promise<AsterOrder[]> {
  const j = await signed<AsterOrder[]>(n, wallet, 'GET', '/fapi/v3/allOrders', { symbol, limit });
  return Array.isArray(j) ? j : [];
}

/** What happened to one order (fill, still open, or canceled). */
export async function asterOrderOutcome(n: VenueNetwork, wallet: Address, ticker: string, orderId: string) {
  const all = await ordersFor(n, wallet, asterSymbol(ticker), 20);
  return asterOutcome(all.find((o) => String(o.orderId) === orderId));
}

/**
 * Past orders, newest first. Aster serves order history per symbol, so we ask for the symbols this wallet holds,
 * has open orders in, traded through this app, and the bStock underlyings (hedges the agent places), capped at 10.
 */
export async function asterOrderHistory(n: VenueNetwork, wallet: Address, limit = 50): Promise<HistoryRow[]> {
  if (!hasAsterAgent(wallet, n)) return [];
  return cached(`aster-hist:${n}:${wallet.toLowerCase()}`, 15_000, async () => {
    const view = await asterAccountView(n, wallet);
    if (view.state !== 'ok') return [];
    const infos = await symbolInfos(n);
    const meta = (() => { const m = keyRow(wallet, n)?.meta; return (m ? JSON.parse(m) : {}) as { symbols?: string[] }; })();
    // Aster's income log names every market actually traded (commission / PnL rows carry the symbol) and lists
    // deposits. Live 2026-11-26: a trade on a market outside the fixed list never showed in Activity before this.
    const income = await signed<{ symbol?: string; incomeType: string; income: string; asset: string; time: number; tranId: string | number }[]>(n, wallet, 'GET', '/fapi/v3/income', { limit: 200 }).catch(() => []);
    const traded = (Array.isArray(income) ? income : []).filter((x) => x.symbol && x.incomeType !== 'DEPOSIT' && x.incomeType !== 'WITHDRAW').map((x) => x.symbol as string);
    const want = [...new Set([
      ...traded, ...view.positions.map((p) => p.symbol), ...view.openOrders.map((o) => o.symbol), ...(meta.symbols ?? []),
      ...BSTOCKS_BSC.map((b) => asterSymbol(b.underlying)),
    ])].filter((s) => infos.has(s)).slice(0, 12);
    const out: AsterOrder[] = [];
    for (const s of want) out.push(...await ordersFor(n, wallet, s, limit));
    // Deposits, each with its BNB Chain transaction hash (found once on chain, then stored).
    const deposits = (Array.isArray(income) ? income : []).filter((x) => x.incomeType === 'DEPOSIT' && Number(x.income) > 0)
      .map((x) => ({ tranId: String(x.tranId), asset: x.asset, amount: Number(x.income), timeMs: Number(x.time) }));
    const depositRows = deposits.length ? await asterDepositRows(n, wallet, deposits).catch(() => []) : [];
    return [...mapAsterHistory(out, limit), ...depositRows].sort((a, b) => b.time - a.time).slice(0, limit);
  });
}

// ── spot → futures (deposit follow-up) ───────────────────────────────────────
/**
 * UNVERIFIED on BNB Chain: on Arbitrum a vault deposit credited Aster SPOT, which then needed this agent-signed
 * transfer into FUTURES. The funding page calls it only when the futures balance has not risen ~90 s after a deposit.
 */
export async function asterSpotToFutures(n: VenueNetwork, wallet: Address, amount: string): Promise<{ ok: true }> {
  if (!/^\d+(\.\d{1,8})?$/.test(amount) || Number(amount) <= 0) throw new Error('amount must be a positive decimal');
  await signed(n, wallet, 'POST', '/fapi/v3/asset/wallet/transfer', { asset: 'USDT', amount, kindType: 'SPOT_FUTURE', clientTranId: `pr_${Date.now()}` });
  invalidate(`aster-acct:${n}:${wallet.toLowerCase()}`);
  return { ok: true };
}

// ── withdraw: the USER signs the Action in MetaMask, the agent submits it ──
// UNVERIFIED-live: ported from manager-service src/aster/v3/client.ts (withdraw / estimateWithdrawFee).
const WITHDRAW_ASSET = 'USDT';
const withdrawChain = (n: VenueNetwork) => {
  if (n !== 'mainnet') throw new Error('Perps withdrawals from the app are mainnet only');
  return 56; // BNB Chain: the money goes back where it came from
};

export async function estimateAsterWithdrawFee(chainId: number): Promise<string> {
  let quoted = 0;
  try {
    const r = await fetch(`${ASTER_WEB}/bapi/futures/v1/public/future/aster/estimate-withdraw-fee?chainId=${chainId}&network=EVM&currency=${WITHDRAW_ASSET}&accountType=perp`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    quoted = extractFee(await r.json().catch(() => ({})));
  } catch (e) {
    // The floor alone is a safe fee; an unreachable public estimate must not strand funds.
    console.warn('[aster] withdraw fee estimate failed, using the floor', (e as Error).message);
  }
  return withdrawFee(quoted, WITHDRAW_ASSET, chainId);
}

const AMT = /^\d+(\.\d{1,6})?$/;

export async function prepareAsterWithdraw(n: VenueNetwork, wallet: Address, amount: string) {
  if (!AMT.test(amount) || Number(amount) <= 0) throw new Error('amount must be a USDT decimal (≤ 6 places)');
  const chainId = withdrawChain(n);
  const view = await asterAccountView(n, wallet);
  if (view.state !== 'ok') throw new Error(view.state === 'no_deposit' ? 'Nothing to withdraw: deposit to start trading perps' : 'Register the perps agent first');
  const fee = await estimateAsterWithdrawFee(chainId);
  if (Number(amount) <= Number(fee)) throw new Error(`The withdrawal fee is ${fee} USDT; withdraw more than that`);
  if (view.available !== null && Number(amount) > view.available) throw new Error(`Only ${view.available.toFixed(2)} USDT is free to withdraw`);
  const nonce = String(asterNonce());
  const receiver = getAddress(wallet);
  return { chainId, amount, fee, nonce, receiver, typedData: withdrawActionTypedData(chainId, receiver, WITHDRAW_ASSET, amount, fee, nonce, ASTER[n].asterChain) };
}

export async function submitAsterWithdraw(n: VenueNetwork, wallet: Address, w: { amount: string; fee: string; nonce: string; signature: Hex }): Promise<{ withdrawId: string | null; receiver: Address }> {
  const chainId = withdrawChain(n);
  if (!AMT.test(w.amount) || !/^\d+(\.\d{1,2})?$/.test(w.fee) || !/^\d{1,30}$/.test(w.nonce)) throw new Error('amount, fee and nonce required');
  if (Number(w.fee) < withdrawFeeFloor(WITHDRAW_ASSET, chainId)) throw new Error('fee below the venue floor');
  // The receiver is never an input: it is the signed-in wallet, and the signature must be that wallet's.
  const receiver = getAddress(wallet);
  const td = withdrawActionTypedData(chainId, receiver, WITHDRAW_ASSET, w.amount, w.fee, w.nonce, ASTER[n].asterChain);
  const ok = await verifyTypedData({ address: receiver, domain: td.domain, types: td.types, primaryType: td.primaryType, message: { ...td.message, nonce: BigInt(w.nonce) }, signature: w.signature });
  if (!ok) throw new Error('The withdrawal signature is not from your wallet. Make sure MetaMask is on BNB Chain.');
  // Field order is the signed order (the query string is signed raw and unsorted).
  const out = await signed<Record<string, unknown>>(n, wallet, 'POST', '/fapi/v3/aster/user-withdraw', {
    chainId: String(chainId), asset: WITHDRAW_ASSET, receiver, amount: w.amount, fee: w.fee, userNonce: w.nonce, userSignature: w.signature, recvWindow: 5000,
  });
  invalidate(`aster-acct:${n}:${wallet.toLowerCase()}`);
  const data = ((out?.data as Record<string, unknown> | undefined) ?? out ?? {}) as Record<string, unknown>;
  for (const k of ['id', 'withdrawOrderId', 'withdrawId']) if (data[k] !== undefined && data[k] !== null) return { withdrawId: String(data[k]), receiver };
  return { withdrawId: null, receiver };
}
