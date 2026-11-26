'use client';
import { useQuery } from '@tanstack/react-query';
import type { Address } from 'viem';
import { useVenueNetwork, type VenueNetwork } from '@/lib/network';
import { useSession } from '@/lib/session';
import type { AsterAccountView, AsterMarket } from '@/lib/aster-view';

export interface LighterMarketDetail {
  symbol: string; market_id: number; status: string; size_decimals: number; price_decimals: number; min_base_amount: string; min_quote_amount: string;
  last_trade_price: number; mark_price: string; index_price: string; daily_price_change: number; daily_price_high: number; daily_price_low: number;
  daily_quote_token_volume: number; open_interest_usd: string; default_initial_margin_fraction: number; maintenance_margin_fraction: number;
}

export interface LighterPositionView { market_id: number; symbol: string; sign: number; position: string; avg_entry_price: string; position_value: string; unrealized_pnl: string; liquidation_price: string; allocated_margin: string; margin_mode: number }
export interface LighterAccountView {
  index: number; account_type: number; collateral: string; available_balance: string; total_asset_value: string; cross_asset_value: string;
  cross_initial_margin_requirement?: string; cross_maintenance_margin_requirement?: string; positions: LighterPositionView[];
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = (await r.json().catch(() => ({}))) as T & { error?: string | { message?: string } };
  if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : j.error?.message ?? `HTTP ${r.status}`);
  return j;
}

/** Perps markets (Aster USDT perps), busiest first. */
export function useAsterMarkets(network?: VenueNetwork) {
  const { network: ctx } = useVenueNetwork();
  const n = network ?? ctx;
  return useQuery({
    queryKey: ['aster-markets', n],
    queryFn: async () => (await getJson<{ markets: AsterMarket[] }>(`/api/trade/aster-market?network=${n}&kind=markets`)).markets,
    refetchInterval: 5_000,
  });
}

/** The signed-in wallet's perps account. state: ok | no_deposit (show "Deposit to start trading perps") | needs_agent. */
export function useAsterAccount() {
  const { network } = useVenueNetwork();
  const { wallet } = useSession();
  return useQuery({
    queryKey: ['aster-account', network, wallet], enabled: !!wallet, refetchInterval: 4_000,
    queryFn: () => getJson<AsterAccountView>(`/api/trade/aster-account?network=${network}`),
  });
}

/** Dormant: Lighter is no longer used in user flows (kept for reference). */
export function useLighterMarkets(network?: VenueNetwork) {
  const { network: ctx } = useVenueNetwork();
  const n = network ?? ctx;
  return useQuery({
    queryKey: ['lighter-markets', n],
    queryFn: async () => {
      const j = await getJson<{ order_book_details?: LighterMarketDetail[] }>(`/api/lighter/orderBookDetails?filter=perp&network=${n}`);
      return (j.order_book_details ?? []).filter((m) => m.status === 'active').sort((a, b) => b.daily_quote_token_volume - a.daily_quote_token_volume);
    },
    refetchInterval: 5_000,
  });
}

async function fetchLighterAccounts(network: VenueNetwork, address: Address): Promise<LighterAccountView[] | null> {
  const r = await fetch(`/api/lighter/account?by=l1_address&value=${address}&network=${network}`);
  const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string; accounts?: LighterAccountView[] };
  if (j.code === 21100) return null; // no account until the first deposit
  if (!r.ok) throw new Error(j.message ?? `HTTP ${r.status}`);
  if (!j.accounts?.length) return null;
  // Master first, then sub-accounts by index.
  return [...j.accounts].sort((a, b) => Number(b.account_type === 0) - Number(a.account_type === 0) || a.index - b.index);
}

/** Every Lighter account (master + sub-accounts) for an L1 address (public endpoint). null = no account yet. */
export function useLighterAllAccounts(address?: Address) {
  const { network } = useVenueNetwork();
  return useQuery({ queryKey: ['lighter-account', network, address], enabled: !!address, queryFn: () => fetchLighterAccounts(network, address!), refetchInterval: 3_000 });
}

/** Master Lighter account for an L1 address. null = no account yet. */
export function useLighterAccount(address?: Address) {
  const { network } = useVenueNetwork();
  return useQuery({
    queryKey: ['lighter-account', network, address], enabled: !!address, refetchInterval: 3_000,
    queryFn: () => fetchLighterAccounts(network, address!),
    select: (all) => (all ? all.find((a) => a.account_type === 0) ?? all[0] : null),
  });
}

export interface LighterAccountSummary { index: number; isMaster: boolean; collateral: string; available: string; equity: string; agent: 'active' | 'pending' | 'none' }

/** Signed-in view: which Lighter accounts carry the agent key. */
export function useLighterAgentAccounts() {
  const { network } = useVenueNetwork();
  const { wallet } = useSession();
  return useQuery({
    queryKey: ['lighter-agent-accounts', network, wallet], enabled: !!wallet, refetchInterval: 6_000,
    queryFn: async () => (await getJson<{ accounts: LighterAccountSummary[] }>(`/api/trade/lighter-accounts?network=${network}`)).accounts,
  });
}

export const lighterAccountName = (a: { index: number; account_type?: number; isMaster?: boolean }) =>
  (a.isMaster ?? a.account_type === 0) ? `Main #${a.index}` : `Sub #${a.index}`;

export interface DeriveSubView {
  subaccount_id: number; manager_id: number; margin_type: string; is_under_liquidation: boolean; initial_margin: string; maintenance_margin: string; collaterals_value: string; positions_value?: string;
  collaterals: { asset_name: string; amount: string; mark_value: string }[];
  positions: { instrument_name: string; instrument_type: string; amount: string; average_price: string; mark_price: string; mark_value: string; unrealized_pnl: string; liquidation_price: string | null }[];
  open_orders: { order_id: string; instrument_name: string; direction: string; amount: string; limit_price: string; filled_amount: string; order_status: string }[];
  isFallback?: boolean; universeId?: number | null; universeName?: string | null;
}

export interface DeriveAccountResp {
  state: 'ok' | 'needs_agent' | 'no_account';
  subaccountId?: number | null;
  /** Richest tradeable subaccount (legacy single-account view). */
  subaccount?: DeriveSubView;
  subaccounts?: DeriveSubView[];
  universes?: import('@/lib/derive-codec').DeriveUniverse[];
}

export function useDeriveAccount() {
  const { network } = useVenueNetwork();
  const { wallet } = useSession();
  return useQuery({
    queryKey: ['derive-account', network, wallet],
    enabled: !!wallet,
    queryFn: () => getJson<DeriveAccountResp>(`/api/trade/derive-account?network=${network}`),
    refetchInterval: 4_000,
  });
}

export interface AgentKeyRow { venue: 'aster' | 'lighter' | 'derive'; network: VenueNetwork; account_ref: string; key_ref: string; public_key: string; scope: string; expires_at: number | null; status: 'active' | 'pending'; created_at: number }

export function useAgentKeys() {
  const { wallet } = useSession();
  return useQuery({
    queryKey: ['agent-keys', wallet],
    enabled: !!wallet,
    queryFn: async () => (await getJson<{ keys: AgentKeyRow[] }>('/api/agent/keys')).keys,
  });
}

export async function derivePublic<T>(network: VenueNetwork, method: string, params: object): Promise<T> {
  const j = await getJson<{ result?: T; error?: { message: string } }>(`/api/derive/${method}?network=${network}`, { method: 'POST', body: JSON.stringify(params) });
  if (j.error || j.result === undefined) throw new Error(j.error?.message ?? 'derive error');
  return j.result;
}

export { getJson };
