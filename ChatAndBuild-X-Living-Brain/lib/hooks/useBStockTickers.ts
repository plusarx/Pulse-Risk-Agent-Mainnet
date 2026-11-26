'use client';
import { useQuery } from '@tanstack/react-query';
import type { BStockTicker } from './useBscBalances';

export function useBStockTickers() {
  return useQuery({
    queryKey: ['bstock-tickers'],
    queryFn: async () => {
      const r = await fetch('/api/bstocks/market?kind=tickers');
      if (!r.ok) throw new Error('tickers unavailable');
      return (await r.json()) as BStockTicker[];
    },
    refetchInterval: 3_000,
  });
}
