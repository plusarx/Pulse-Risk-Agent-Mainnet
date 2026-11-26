import type { Network } from '../types';
import { deriveCurrencyOf, getChain } from './options';

// A live, exact Derive put quote: the chain from the order book plus the instrument's own size rules and fees
// (public/get_instrument: minimum_amount, amount_step, taker_fee_rate, base_fee). Derive charges per contract
// base_fee + min(taker_fee_rate x index, 12.5% x option price).

type Rpc = <T>(n: Network, method: string, params: object) => Promise<T>;
const defaultRpc: Rpc = async <T,>(n: Network, method: string, params: object) => (await import('../tools/derive')).rpc<T>(n, method, params, {});

export interface PutQuoteResult {
  instrument: string; expiry: string; daysToExpiry: number; strike: number; spot: number; ask: number; iv: number;
  contracts: number; step: number; minContracts: number; minCoverUsd: number; coverUsd: number; premiumUsd: number; feesUsd: number;
  /** true when Derive's minimum size covers more than the notional asked for. */
  oversized: boolean;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, '');

export async function quotePut(n: Network, ticker: string, o: { notionalUsd: number; strikePct: number; minDays: number }, rpc: Rpc = defaultRpc, chainOf = getChain, now = Date.now()): Promise<PutQuoteResult | null> {
  const chain = await chainOf(n, ticker); if (!chain) return null;
  const ex = chain.expiries.filter((e) => (Date.parse(e.expiry) - now) / 86_400_000 >= o.minDays).sort((a, b) => Date.parse(a.expiry) - Date.parse(b.expiry))[0]
    ?? chain.expiries[chain.expiries.length - 1];
  if (!ex) return null;
  const target = chain.spot * (o.strikePct / 100);
  const q = ex.puts.filter((p) => p.ask > 0).sort((a, b) => Math.abs(a.strike - target) - Math.abs(b.strike - target))[0];
  if (!q) return null;
  const strikeTxt = String(q.strike).replace('.', '_');
  const instrument = `${deriveCurrencyOf(ticker)}-${ymd(ex.expiry)}-${strikeTxt}-P`;
  const inst = await rpc<{ minimum_amount?: string; amount_step?: string; taker_fee_rate?: string; base_fee?: string }>(n, 'public/get_instrument', { instrument_name: instrument });
  const step = Number(inst?.amount_step) || 1; const min = Number(inst?.minimum_amount) || step;
  const want = o.notionalUsd > 0 ? o.notionalUsd / (chain.spot * chain.contractSize) : min;
  const contracts = Math.max(min, Math.round(want / step) * step);
  const feePer = (Number(inst?.base_fee) || 0) + Math.min((Number(inst?.taker_fee_rate) || 0.0003) * chain.spot, 0.125 * q.ask);
  return {
    instrument, expiry: ex.expiry, daysToExpiry: Math.round(((Date.parse(ex.expiry) - now) / 86_400_000) * 10) / 10, strike: q.strike, spot: chain.spot, ask: q.ask, iv: q.iv,
    contracts: Math.round(contracts * 1e6) / 1e6, step, minContracts: min, minCoverUsd: r2(min * chain.spot * chain.contractSize),
    coverUsd: r2(contracts * chain.spot * chain.contractSize), premiumUsd: r2(contracts * q.ask * chain.contractSize), feesUsd: r2(contracts * feePer),
    oversized: o.notionalUsd > 0 && want < min - 1e-9,
  };
}
