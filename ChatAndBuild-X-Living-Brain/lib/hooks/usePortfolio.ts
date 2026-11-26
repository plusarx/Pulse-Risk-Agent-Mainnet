'use client';
import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useBscBalances } from './useBscBalances';
import { useBStockTickers } from './useBStockTickers';
import { useAsterAccount, useDeriveAccount } from './useVenues';
import { useIntegrity } from './useIntegrity';
import { haircutFor } from '@/lib/integrity-view';
import { toFloat } from '@/lib/format';

export const DEFAULT_HAIRCUT = 0.3;

/** One live view across BSC wallet, bStocks, perps (Aster) and options (Derive). All numbers are display floats. */
export function usePortfolio(haircut = DEFAULT_HAIRCUT) {
  const { address } = useAccount();
  const bsc = useBscBalances();
  const tickers = useBStockTickers();
  const aster = useAsterAccount();
  const derive = useDeriveAccount();
  // Price integrity: empty (flat haircut for every token) unless the switch is on and data has loaded.
  const integ = useIntegrity();

  return useMemo(() => {
    const price = (s: string) => tickers.data?.find((t) => t.symbol === s)?.price ?? null;
    const usdc = bsc.usdc !== null ? toFloat(bsc.usdc, 18) : null;
    const usdt = bsc.usdt !== null ? toFloat(bsc.usdt, 18) : null;
    const stocks = bsc.holdings.filter((h) => h.raw > 0n).map((h) => {
      const qty = toFloat(h.ui, 18); const p = price(h.symbol);
      const tk = tickers.data?.find((t) => t.symbol === h.symbol);
      return { ...h, qty, price: p, value: p !== null ? qty * p : null, changePct: tk?.changePct ?? null, collateral: p !== null ? qty * p * (1 - haircutFor(h.symbol, haircut, integ)) : null, haircutUsed: haircutFor(h.symbol, haircut, integ) };
    });
    const stocksValue = stocks.reduce((s, x) => s + (x.value ?? 0), 0);
    const stocksCollateral = stocks.reduce((s, x) => s + (x.collateral ?? 0), 0);

    // Perps: one Aster futures account per wallet.
    const av = aster.data;
    const perpsOk = av?.state === 'ok';
    const perpsEquity = av && av.state !== 'needs_agent' ? av.equity : null;
    const perpsAvail = av && av.state !== 'needs_agent' ? av.available : null;

    // Sum every Derive subaccount (one per risk universe, plus the fallback).
    const subs = derive.data?.subaccounts ?? (derive.data?.subaccount ? [derive.data.subaccount] : []);
    const ds = derive.data?.subaccount;
    const dColl = subs.reduce((a, s) => a + Number(s.collaterals_value), 0);
    const dFree = subs.filter((s) => !s.isFallback).reduce((a, s) => a + Number(s.initial_margin), 0);
    const deriveEquity = subs.length ? dColl + subs.reduce((a, s) => a + Number(s.positions_value ?? 0), 0) : null;
    const deriveUsage = subs.length && dColl > 0 ? Math.max(0, Math.min(100, (1 - dFree / dColl) * 100)) : null;

    const total = (usdc ?? 0) + (usdt ?? 0) + stocksValue + (perpsEquity ?? 0) + (deriveEquity ?? 0);
    return {
      address, loading: bsc.isLoading, updatedAt: bsc.updatedAt,
      bsc: { usdc, usdt, bnb: bsc.bnb !== null ? toFloat(bsc.bnb, 18) : null },
      stocks, stocksValue, stocksCollateral, haircut,
      perps: {
        state: aster.isLoading && !av ? 'loading' as const : av ? av.state : aster.isError ? 'unavailable' as const : 'signed_out' as const,
        error: aster.error?.message ?? null, equity: perpsEquity, available: perpsAvail, usage: perpsOk ? av.usedPct : null,
        positions: av?.positions ?? [], agentExpiresAt: av?.agentExpiresAt ?? null,
      },
      derive: { state: derive.data?.state ?? (derive.isLoading ? 'loading' : 'signed_out'), equity: deriveEquity, usage: deriveUsage, positions: subs.flatMap((s) => s.positions), subaccountId: ds?.subaccount_id },
      total,
    };
  }, [address, bsc, tickers.data, aster.data, aster.isLoading, aster.isError, aster.error, derive.data, derive.isLoading, haircut, integ]);
}
