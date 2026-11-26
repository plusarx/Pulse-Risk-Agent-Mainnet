'use client';
import { useMemo } from 'react';
import { useAsterAccount, useDeriveAccount } from './useVenues';
import type { AccountHealth, RuleVenue } from '@/lib/risk-rules';

export interface RiskPosition {
  venue: RuleVenue; account: string; market: string; side: 'long' | 'short'; size: number;
  valueUsd: number; upnl: number; liqPrice: number | null; markPrice: number | null; kind: 'perp' | 'option';
}

export interface RiskAccount {
  key: string; venue: RuleVenue; accountRef: string; title: string; label: string | null;
  health: AccountHealth; positions: RiskPosition[];
}

/**
 * Every venue account a rebalance rule can watch, with live health:
 * - Perps (Aster) account: equity = totalMarginBalance, margin used = equity − available.
 * - Each tradeable Derive subaccount (one per risk universe): account value = collateral + positions,
 *   margin used = collateral − initial_margin (Derive's initial_margin is the free headroom).
 */
export function useRiskAccounts() {
  const aster = useAsterAccount();
  const derive = useDeriveAccount();

  return useMemo(() => {
    const accounts: RiskAccount[] = [];
    // Perps: one Aster account per wallet, ruleKey "aster:" (accountRef '').
    const av = aster.data;
    if (av?.state === 'ok') {
      const eq = av.equity ?? 0;
      const used = Math.max(0, eq - (av.available ?? 0));
      accounts.push({
        key: 'aster:', venue: 'aster', accountRef: '', title: 'Perps · Main', label: 'Main',
        health: { connected: true, accountUsd: eq, usedUsd: used, utilBps: eq > 0 ? Math.round((used / eq) * 10_000) : null },
        positions: av.positions.map((p) => ({
          venue: 'aster' as const, account: 'Perps · Main', market: `${p.ticker}-PERP`, side: p.side, size: Number(p.size),
          valueUsd: p.notional, upnl: p.upnl, liqPrice: p.liqPrice, markPrice: p.markPrice || null, kind: 'perp' as const,
        })),
      });
    }
    for (const s of derive.data?.subaccounts ?? []) {
      if (s.isFallback) continue;
      const coll = Number(s.collaterals_value);
      const used = Math.max(0, coll - Number(s.initial_margin));
      const title = `Options · ${s.universeName ?? `#${s.subaccount_id}`}`;
      accounts.push({
        key: `derive:${s.subaccount_id}`, venue: 'derive', accountRef: String(s.subaccount_id), title, label: `${s.universeName ?? ''} #${s.subaccount_id}`.trim(),
        health: { connected: true, accountUsd: coll + Number(s.positions_value ?? 0), usedUsd: used, utilBps: coll > 0 ? Math.round((used / coll) * 10_000) : null },
        positions: s.positions.map((p) => ({
          venue: 'derive' as const, account: title, market: p.instrument_name, side: +p.amount >= 0 ? 'long' as const : 'short' as const,
          size: Math.abs(+p.amount), valueUsd: Math.abs(+p.mark_value), upnl: +p.unrealized_pnl,
          liqPrice: p.liquidation_price ? +p.liquidation_price || null : null, markPrice: +p.mark_price || null,
          kind: p.instrument_type === 'option' ? 'option' as const : 'perp' as const,
        })),
      });
    }
    return {
      accounts,
      loading: aster.isLoading || derive.isLoading,
      deriveState: derive.data?.state ?? null,
    };
  }, [aster.data, aster.isLoading, derive.data, derive.isLoading]);
}
