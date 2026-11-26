import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import {
  ASTER, ASTER_MIN_NOTIONAL_USD, asterSymbol, signedPath, stepQty, symbolRules, tickerOfAster,
  type AsterAccount, type AsterNetwork, type AsterOrder, type AsterPosition, type AsterSymbolInfo, type QueryPrimitive, type SignTyped,
} from '../../../lib/aster';
import type { AccountHealth } from '../../../lib/risk-rules';
import { config } from '../config';
import type { Network } from '../types';
import type { AsterCreds } from './appApi';

// Aster perps (BNB Chain), agent side. Reads and orders are signed by the user's Aster AGENT key (fetched per tick from
// the app, never stored); the agent key can trade and read but can never withdraw. Every call has a timeout, and a
// 418/429 (rate limit / IP ban) is retried with backoff. Orders are V3 only: /fapi/v1/order is gone (404).

const TIMEOUT_MS = 10_000;
/** Aster answers every signed call on a never-funded account with this code. It means "connected, $0, no positions". */
export const ASTER_NOT_DEPOSITED = -5050;

export class AsterApiError extends Error {
  constructor(public status: number, public code: number | null, msg: string) { super(msg); }
}

type FetchFn = typeof fetch;
let fetchImpl: FetchFn = (...a) => fetch(...a);
let sleepImpl = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Tests only: no real network, no real waits. */
export const setAsterTransportForTests = (f?: FetchFn, sleep?: (ms: number) => Promise<void>) => {
  fetchImpl = f ?? ((...a) => fetch(...a)); sleepImpl = sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
};

/** One HTTP call with timeout and 418/429 backoff (Retry-After when given, else 1 s, 2 s, 4 s). */
async function request<T>(url: string, method: 'GET' | 'POST' | 'DELETE'): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetchImpl(url, { method, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if ((r.status === 429 || r.status === 418) && attempt < 3) {
      const ra = Number(r.headers.get('retry-after'));
      await sleepImpl(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    const text = await r.text();
    let j: unknown;
    try { j = JSON.parse(text); } catch { throw new AsterApiError(r.status, null, `Aster API unavailable (HTTP ${r.status})`); }
    const code = (j as { code?: unknown })?.code;
    if (!r.ok || (typeof code === 'number' && code < 0)) {
      throw new AsterApiError(r.status, typeof code === 'number' ? code : null, `Aster ${method} ${new URL(url).pathname} HTTP ${r.status}: ${(j as { msg?: string }).msg ?? text.slice(0, 120)}`);
    }
    return j as T;
  }
}

const net = (n: Network): AsterNetwork => n;

/** Public market data (no signature). */
export async function publicGet<T>(n: Network, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const u = new URL(ASTER[net(n)].fapi + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return request<T>(u.toString(), 'GET');
}

const signer = (c: AsterCreds): SignTyped => {
  const acct = privateKeyToAccount(c.agentPrivateKey as Hex);
  return (td) => acct.signTypedData(td as never);
};

/** Agent-signed V3 call. The query is sent verbatim (Aster hashes the raw string). */
export async function signed<T>(n: Network, c: AsterCreds, method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, QueryPrimitive | undefined | null> = {}): Promise<T> {
  const p = await signedPath(net(n), path, params, c.user, c.agentAddress, signer(c));
  return request<T>(ASTER[net(n)].fapi + p, method);
}

const notDeposited = (e: unknown) => e instanceof AsterApiError && e.code === ASTER_NOT_DEPOSITED;

// ── reads ─────────────────────────────────────────────────────────────────────

export interface AsterAccountView { account: AsterAccount | null; positions: AsterPosition[]; funded: boolean }

/** Account and positions. A never-funded account (-5050) reads as connected with $0 and no positions. Other errors throw. */
export async function getAccount(n: Network, c: AsterCreds): Promise<AsterAccountView> {
  try {
    const [account, positions] = await Promise.all([
      signed<AsterAccount>(n, c, 'GET', '/fapi/v3/account'),
      signed<AsterPosition[]>(n, c, 'GET', '/fapi/v3/positionRisk'),
    ]);
    return { account, positions: Array.isArray(positions) ? positions : [], funded: true };
  } catch (e) {
    if (notDeposited(e)) return { account: null, positions: [], funded: false };
    throw e;
  }
}

/** Equity (margin balance) and free margin, USD. */
export function equityOf(v: AsterAccountView | null): { equityUsd: number; freeUsd: number } {
  if (!v?.account) return { equityUsd: 0, freeUsd: 0 };
  const eq = Number(v.account.totalMarginBalance ?? v.account.totalWalletBalance ?? 0);
  const free = Number(v.account.availableBalance ?? 0);
  return { equityUsd: Number.isFinite(eq) ? eq : 0, freeUsd: Number.isFinite(free) ? Math.max(0, free) : 0 };
}

/** Health as planRule expects it: util = (equity − available) / equity, in bps. null view = no key (not connected). */
export function healthOf(v: AsterAccountView | null): AccountHealth {
  if (!v) return { connected: false, utilBps: null, accountUsd: null, usedUsd: null };
  if (!v.account) return { connected: true, utilBps: 0, accountUsd: 0, usedUsd: 0 };
  const equity = Number(v.account.totalMarginBalance ?? v.account.totalWalletBalance); const avail = Number(v.account.availableBalance);
  if (!Number.isFinite(equity) || !Number.isFinite(avail) || equity <= 0) return { connected: true, utilBps: equity === 0 ? 0 : null, accountUsd: Number.isFinite(equity) ? equity : null, usedUsd: 0 };
  const used = Math.max(0, equity - avail);
  return { connected: true, utilBps: Math.round((used / equity) * 10_000), accountUsd: equity, usedUsd: used };
}

/** Signed position size per ticker (negative = short). One-way mode: positionAmt carries the sign. */
export function positionsOf(ps: AsterPosition[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of ps) {
    const t = tickerOfAster(p.symbol); const v = Number(p.positionAmt);
    if (t && Number.isFinite(v) && v !== 0) out[t] = (out[t] ?? 0) + v;
  }
  return out;
}

export async function getPositions(n: Network, c: AsterCreds): Promise<Record<string, number>> {
  try { return positionsOf(await signed<AsterPosition[]>(n, c, 'GET', '/fapi/v3/positionRisk')); } catch (e) { if (notDeposited(e)) return {}; throw e; }
}

/** USDT wallet balance on the futures account (what a deposit credits). 0 on a never-funded account. */
export async function futuresUsdt(n: Network, c: AsterCreds): Promise<number> {
  try {
    const rows = await signed<{ asset: string; balance?: string; walletBalance?: string }[]>(n, c, 'GET', '/fapi/v3/balance');
    const r = (Array.isArray(rows) ? rows : []).find((x) => x.asset === 'USDT');
    return Number(r?.balance ?? r?.walletBalance ?? 0) || 0;
  } catch (e) { if (notDeposited(e)) return 0; throw e; }
}

export async function openOrders(n: Network, c: AsterCreds, ticker?: string): Promise<AsterOrder[]> {
  try { return await signed<AsterOrder[]>(n, c, 'GET', '/fapi/v3/openOrders', ticker ? { symbol: asterSymbol(ticker) } : {}); } catch (e) { if (notDeposited(e)) return []; throw e; }
}

// ── markets (public) ─────────────────────────────────────────────────────────

export interface AsterMarket { ticker: string; symbol: string; minQty: number; stepSize: number; tickSize: number; minNotionalUsd: number }

const marketCache = new Map<Network, { at: number; list: AsterMarket[] }>();
export const clearAsterMarketCache = () => marketCache.clear();

/** Every TRADING USDT-margined perp, cached 10 minutes per network. */
export async function markets(n: Network): Promise<AsterMarket[]> {
  const hit = marketCache.get(n);
  if (hit && Date.now() - hit.at < 600_000) return hit.list;
  const j = await publicGet<{ symbols?: AsterSymbolInfo[] }>(n, '/fapi/v1/exchangeInfo');
  const list: AsterMarket[] = [];
  for (const s of j.symbols ?? []) {
    if (s.status !== 'TRADING' || s.quoteAsset !== 'USDT') continue;
    const t = tickerOfAster(s.symbol); if (!t) continue;
    const r = symbolRules(s);
    list.push({ ticker: t, symbol: s.symbol, minQty: r.minQty, stepSize: r.stepSize, tickSize: r.tickSize, minNotionalUsd: r.minNotional || ASTER_MIN_NOTIONAL_USD });
  }
  marketCache.set(n, { at: Date.now(), list });
  return list;
}

export async function market(n: Network, ticker: string): Promise<AsterMarket> {
  const m = (await markets(n)).find((x) => x.ticker === ticker.toUpperCase());
  if (!m) throw new Error(`the perps venue lists no ${ticker} perp`);
  return m;
}

/** Mark price of a ticker's perp. */
export async function markPrice(n: Network, ticker: string): Promise<number> {
  const j = await publicGet<{ markPrice?: string }>(n, '/fapi/v1/premiumIndex', { symbol: asterSymbol(ticker) });
  const p = Number(j.markPrice);
  if (!(p > 0)) throw new Error(`no mark price for ${ticker}`);
  return p;
}

export interface AsterMarketStats { markPrice: number; indexPrice: number | null; /** per funding interval, percent; positive = longs pay shorts */ fundingRatePct: number | null; nextFundingAt: number | null; change24hPct: number | null; volume24hUsd: number | null }

/** Live stats for one perp: mark and index price, the current funding rate and next funding time, and the 24 h move and volume. Public, no key. */
export async function marketStats(n: Network, ticker: string): Promise<AsterMarketStats> {
  const symbol = asterSymbol(ticker);
  const [pi, t24] = await Promise.all([
    publicGet<{ markPrice?: string; indexPrice?: string; lastFundingRate?: string; nextFundingTime?: number }>(n, '/fapi/v1/premiumIndex', { symbol }),
    publicGet<{ priceChangePercent?: string; quoteVolume?: string }>(n, '/fapi/v1/ticker/24hr', { symbol }).catch(() => null),
  ]);
  const mark = Number(pi.markPrice);
  if (!(mark > 0)) throw new Error(`no mark price for ${ticker}`);
  const f = (v: unknown) => { const x = Number(v); return v !== undefined && v !== null && v !== '' && Number.isFinite(x) ? x : null; };
  const fr = f(pi.lastFundingRate);
  return { markPrice: mark, indexPrice: f(pi.indexPrice), fundingRatePct: fr === null ? null : fr * 100, nextFundingAt: f(pi.nextFundingTime), change24hPct: f(t24?.priceChangePercent), volume24hUsd: f(t24?.quoteVolume) };
}

/** Hourly closes (volatility, proxies) live in ./metrics (fetchHourlyCloses), read from the public klines. */

// ── writes (live only) ───────────────────────────────────────────────────────

export interface MarketOrderReq { ticker: string; side: 'buy' | 'sell'; qty: number; reduceOnly: boolean; clientOrderId?: string }
export interface OrderResult { orderId: number; status: string; executedQty: number; avgPrice: number; qty: string }

/** The quantity Aster will accept (rounded DOWN to the step), or why the order cannot be sent. */
export function orderQty(m: AsterMarket, qty: number, price: number): { qty: string } | { error: string } {
  const q = stepQty(qty, m.stepSize);
  if (!(Number(q) > 0)) return { error: `size rounds to zero for ${m.symbol} (step ${m.stepSize})` };
  if (Number(q) < m.minQty) return { error: `size ${q} is below the ${m.symbol} minimum ${m.minQty}` };
  // A reduce-only buy-back is allowed below the notional minimum on Binance-style books, but we never rely on it.
  if (Number(q) * price < m.minNotionalUsd) return { error: `$${(Number(q) * price).toFixed(2)} is under the $${m.minNotionalUsd} minimum order` };
  return { qty: q };
}

/**
 * MARKET order on the V3 endpoint. `reduceOnly` = true when buying back a short. clientOrderId (newClientOrderId,
 * Binance-compatible) makes a retried POST a duplicate instead of a second order; Aster accepting it on V3 is
 * UNVERIFIED live, so callers also guard with their own idempotent step records.
 */
export async function placeMarketOrder(n: Network, c: AsterCreds, o: MarketOrderReq): Promise<OrderResult> {
  if (!config().live) throw new Error('Aster order called while not live');
  const m = await market(n, o.ticker);
  const px = await markPrice(n, o.ticker);
  const q = orderQty(m, o.qty, px);
  if ('error' in q) throw new Error(q.error);
  const r = await signed<AsterOrder>(n, c, 'POST', '/fapi/v3/order', {
    symbol: m.symbol, side: o.side === 'sell' ? 'SELL' : 'BUY', type: 'MARKET', quantity: q.qty,
    ...(o.reduceOnly ? { reduceOnly: 'true' } : {}), ...(o.clientOrderId ? { newClientOrderId: o.clientOrderId } : {}),
  });
  return { orderId: r.orderId, status: r.status, executedQty: Number(r.executedQty) || 0, avgPrice: Number(r.avgPrice) || 0, qty: q.qty };
}

export async function cancelOrder(n: Network, c: AsterCreds, ticker: string, orderId: number): Promise<void> {
  if (!config().live) throw new Error('Aster cancel called while not live');
  await signed(n, c, 'DELETE', '/fapi/v3/order', { symbol: asterSymbol(ticker), orderId });
}

const maxLevCache = new Map<string, { at: number; max: number }>();
/** Highest leverage the venue allows on this market for a fresh position (bracket 1 of /fapi/v3/leverageBracket; NVDA 20x live 2026-11-26). */
export async function maxLeverage(n: Network, c: AsterCreds, ticker: string): Promise<number> {
  const symbol = asterSymbol(ticker); const k = `${n}:${symbol}`; const hit = maxLevCache.get(k);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.max;
  const r = await signed<{ symbol?: string; brackets: { initialLeverage: number }[] }[] | { brackets: { initialLeverage: number }[] }>(n, c, 'GET', '/fapi/v3/leverageBracket', { symbol });
  const row = Array.isArray(r) ? r.find((x) => x.symbol === symbol) ?? r[0] : r;
  const max = Math.max(1, ...(row?.brackets ?? []).map((b) => Number(b.initialLeverage) || 1));
  maxLevCache.set(k, { at: Date.now(), max });
  return max;
}

export async function setLeverage(n: Network, c: AsterCreds, ticker: string, leverage: number): Promise<void> {
  if (!config().live) throw new Error('Aster leverage called while not live');
  await signed(n, c, 'POST', '/fapi/v3/leverage', { symbol: asterSymbol(ticker), leverage: Math.max(1, Math.floor(leverage)) });
}

/**
 * Move USDT from the Aster spot wallet to the futures wallet. Used only when a deposit has not shown up on futures
 * within ~90 s. UNVERIFIED LIVE: the endpoint, its parameters (asset, amount, kindType=SPOT_FUTURE, clientTranId) and
 * whether an agent key may call it are from the Binance-compatible docs and have not been exercised with real funds.
 */
export async function spotToFutures(n: Network, c: AsterCreds, amountUsdt: string, clientTranId: string): Promise<string> {
  if (!config().live) throw new Error('Aster transfer called while not live');
  const r = await signed<{ tranId?: number | string }>(n, c, 'POST', '/fapi/v3/asset/wallet/transfer', { asset: 'USDT', amount: amountUsdt, kindType: 'SPOT_FUTURE', clientTranId });
  return String(r.tranId ?? clientTranId);
}
