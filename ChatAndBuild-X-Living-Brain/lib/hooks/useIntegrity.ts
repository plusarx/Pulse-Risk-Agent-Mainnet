'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getJson } from '@/lib/hooks/useVenues';
import { useSession } from '@/lib/session';
import { useVenueNetwork } from '@/lib/network';
import type { AgentConfig } from '@/lib/agent-config';
import type { Assessment } from '@/lib/integrity';
import { mapBySymbol, type IntegrityView } from '@/lib/integrity-view';

interface Payload { enabled: boolean; at: number; items: Assessment[]; problems: string[] }
const NONE: Record<string, Assessment> = {};

/**
 * Price-integrity data for the UI. The route is called ONLY while the switch is on: when it is off (or the saved
 * setting is not known yet) nothing is fetched and `bySymbol` is empty, so every number stays the flat haircut.
 * The switch is the signed-in wallet's saved config (same query key as the Risk page, so it shares that request).
 */
export function useIntegrity(): IntegrityView & { at: number | null; items: Assessment[]; problems: string[]; isLoading: boolean; switchKnown: boolean } {
  const { wallet } = useSession(); const { network } = useVenueNetwork();
  const cfg = useQuery({ queryKey: ['agent-config', network, wallet], enabled: !!wallet, queryFn: () => getJson<{ config: AgentConfig }>(`/api/agent/config?network=${network}`) });
  const switchKnown = !wallet || cfg.data !== undefined;
  const on = !wallet ? true : cfg.data?.config.integrity?.enabled === true;
  const q = useQuery({ queryKey: ['integrity', network, wallet], enabled: on, refetchInterval: 20_000, queryFn: () => getJson<Payload>(`/api/integrity?network=${network}`) });
  const live = on && q.data?.enabled !== false ? q.data : undefined;
  return useMemo(() => ({
    enabled: on && q.data?.enabled !== false, switchKnown,
    at: live?.at ?? null, items: live?.items ?? [], problems: live?.problems ?? [],
    bySymbol: live ? mapBySymbol(live.items) : NONE, isLoading: on && q.isLoading,
  }), [on, q.data, q.isLoading, live, switchKnown]);
}
