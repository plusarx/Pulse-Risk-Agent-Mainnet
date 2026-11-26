'use client';
import { useMemo } from 'react';
import { useAccount, useBalance, useReadContracts, useWatchContractEvent } from 'wagmi';
import { bsc } from 'wagmi/chains';
import type { Address } from 'viem';
import { BSTOCKS_BSC } from '@/lib/bstocks';
import { BSC_USDC, BSC_USDT, ERC20_ABI, UI_MULTIPLIER_ABI } from '@/lib/bsc';

export interface BStockHolding { symbol: string; name: string; address: Address; raw: bigint; uiMultiplier: bigint; /** raw * uiMultiplier / 1e18 (18 decimals) */ ui: bigint }

const POLL_MS = 4_000;

/**
 * Realtime BSC balances for the connected wallet: BNB, USDC, USDT and every verified bStock.
 * Polls every 4s and also refetches immediately on any USDC/USDT Transfer touching the wallet.
 * bStock amounts are BEP-677 scaled by uiMultiplier() — raw balanceOf is never shown as the position.
 */
export function useBscBalances(override?: Address) {
  const { address: connected } = useAccount();
  const address = override ?? connected;
  const enabled = !!address;

  const bnb = useBalance({ address, chainId: bsc.id, query: { enabled, refetchInterval: POLL_MS } });

  const contracts = useMemo(() => {
    if (!address) return [];
    const stable = [BSC_USDC, BSC_USDT].map((t) => ({ address: t, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [address] as const, chainId: bsc.id }));
    const stocks = BSTOCKS_BSC.flatMap((t) => [
      { address: t.address, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [address] as const, chainId: bsc.id },
      { address: t.address, abi: UI_MULTIPLIER_ABI, functionName: 'uiMultiplier' as const, chainId: bsc.id },
    ]);
    return [...stable, ...stocks];
  }, [address]);

  const reads = useReadContracts({ contracts, allowFailure: true, query: { enabled, refetchInterval: POLL_MS } });

  const onTransfer = () => { void reads.refetch(); };
  const watch = (token: Address, dir: 'to' | 'from') => ({
    address: token, abi: ERC20_ABI, eventName: 'Transfer' as const, chainId: bsc.id,
    args: dir === 'to' ? { to: address } : { from: address }, enabled, onLogs: onTransfer,
  });
  useWatchContractEvent(watch(BSC_USDC, 'to'));
  useWatchContractEvent(watch(BSC_USDC, 'from'));
  useWatchContractEvent(watch(BSC_USDT, 'to'));
  useWatchContractEvent(watch(BSC_USDT, 'from'));

  const data = useMemo(() => {
    const r = reads.data;
    if (!r) return null;
    const val = (i: number): bigint | null => (r[i]?.status === 'success' ? (r[i].result as bigint) : null);
    const holdings: BStockHolding[] = [];
    let failedStocks = 0;
    BSTOCKS_BSC.forEach((t, i) => {
      const raw = val(2 + i * 2);
      const mult = val(3 + i * 2);
      if (raw === null || mult === null) { failedStocks++; return; }
      holdings.push({ symbol: t.symbol, name: t.displayName, address: t.address, raw, uiMultiplier: mult, ui: (raw * mult) / 10n ** 18n });
    });
    return { usdc: val(0), usdt: val(1), holdings, failedStocks };
  }, [reads.data]);

  return {
    address,
    bnb: bnb.data?.value ?? null,
    usdc: data?.usdc ?? null,
    usdt: data?.usdt ?? null,
    holdings: data?.holdings ?? [],
    failedStocks: data?.failedStocks ?? 0,
    isLoading: reads.isLoading || bnb.isLoading,
    error: reads.error ?? bnb.error,
    updatedAt: reads.dataUpdatedAt,
    refetch: () => { void reads.refetch(); void bnb.refetch(); },
  };
}

export interface BStockTicker { symbol: string; name: string; address: string; liquidityUsd: number; price: number | null; change: number | null; changePct: number | null; high: number | null; low: number | null; volumeUsd: number | null }
