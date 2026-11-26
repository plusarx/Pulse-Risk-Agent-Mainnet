'use client';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { useVenueNetwork } from '@/lib/network';
import { useSession } from '@/lib/session';
import { getJson } from '@/lib/hooks/useVenues';
import { settlementLabel, shortHash, statusLabel, txUrl, type HistoryRow, type HistoryVenue } from '@/lib/order-history';

const VENUE_LABEL: Record<HistoryVenue, string> = { aster: 'Perps', lighter: 'Perps', derive: 'Options', bstocks: 'bStocks' };
const num = (s: string | null, max = 6) => (s === null || s === '' ? '—' : Number(s).toLocaleString('en-US', { maximumFractionDigits: max }));
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function useOrderHistory(venue: HistoryVenue, on = true) {
  const { network } = useVenueNetwork();
  const { wallet } = useSession();
  return useQuery({
    queryKey: ['order-history', venue, venue === 'bstocks' ? 'mainnet' : network, wallet], enabled: !!wallet && on, refetchInterval: 15_000,
    queryFn: async () => (await getJson<{ rows: HistoryRow[] }>(`/api/trade/history?venue=${venue}&network=${network}`)).rows,
  });
}

/** Past orders for one venue (or several, merged newest first, for the Portfolio activity list). */
export function OrderHistory({ venues, limit = 30, showVenue = false }: { venues: HistoryVenue[]; limit?: number; showVenue?: boolean }) {
  const { wallet } = useSession();
  const { network } = useVenueNetwork();
  const aster = useOrderHistory('aster', venues.includes('aster'));
  const lighter = useOrderHistory('lighter', venues.includes('lighter'));
  const derive = useOrderHistory('derive', venues.includes('derive'));
  const bstocks = useOrderHistory('bstocks', venues.includes('bstocks'));
  const qs = ([['aster', aster], ['lighter', lighter], ['derive', derive], ['bstocks', bstocks]] as const).filter(([v]) => venues.includes(v)).map(([v, q]) => ({ v, q }));
  if (!wallet) return <p className="py-6 text-center text-sm text-muted">Sign in to see your past orders.</p>;
  const rows = qs.flatMap(({ q }) => q.data ?? []).sort((a, b) => b.time - a.time).slice(0, limit);
  const loading = qs.some(({ q }) => q.isLoading);
  const errors = qs.filter(({ q }) => q.error).map(({ v, q }) => `${VENUE_LABEL[v]}: ${(q.error as Error).message}`);
  return (
    <div>
      {errors.map((e) => <p key={e} className="mb-2 rounded-lg bg-down/10 px-3 py-2 text-xs text-down">{e}</p>)}
      {loading && !rows.length ? <p className="py-6 text-center text-sm text-muted">Loading…</p>
        : !rows.length ? <p className="py-6 text-center text-sm text-muted">No past orders yet.{venues.includes('bstocks') ? ' bStock swaps appear here once you trade on Spot.' : ''}</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr>{['Time', ...(showVenue ? ['Venue'] : []), 'Market', 'Side', 'Size', 'Filled', 'Avg price', 'Status', 'Tx'].map((h) => <th key={h} className="th whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const st = statusLabel(r);
                  return (
                    <tr key={`${r.venue}-${r.time}-${i}`} className="border-t border-line/60">
                      <td className="td whitespace-nowrap text-muted">{when(r.time)}</td>
                      {showVenue && <td className="td">{VENUE_LABEL[r.venue]}</td>}
                      <td className="td whitespace-nowrap">{r.market}{r.account && r.venue !== 'bstocks' ? <span className="ml-1 text-[11px] text-muted">{r.account}</span> : null}</td>
                      <td className={clsx('td', r.side === 'buy' ? 'text-up' : 'text-down')}>{r.type === 'deposit' ? 'Deposit' : r.venue === 'bstocks' ? (r.side === 'buy' ? 'Buy' : 'Sell') : r.side === 'buy' ? 'Long / buy' : 'Short / sell'}</td>
                      <td className="td num">{num(r.size)}</td>
                      <td className="td num">{num(r.filled)}</td>
                      <td className="td num">{r.avgPrice ? num(r.avgPrice, 2) : '—'}{r.venue === 'bstocks' && r.account ? <span className="ml-1 text-[11px] text-muted">{r.account}</span> : null}</td>
                      <td className={clsx('td text-xs', st.tone === 'up' ? 'text-up' : st.tone === 'down' ? 'text-down' : 'text-muted')}>
                        {st.text}
                      </td>
                      <td className="td whitespace-nowrap font-mono text-[11px]">
                        {r.txHash ? (() => { const u = txUrl(r.venue, r.txHash, network); return u
                          ? <a className="text-accent underline" target="_blank" rel="noreferrer" href={u} title={r.txHash}>{shortHash(r.txHash)} ↗</a>
                          : <span className="text-muted" title={r.txHash}>{shortHash(r.txHash)}</span>; })()
                          : r.venue === 'aster' && r.orderId
                            ? <button type="button" onClick={() => void navigator.clipboard?.writeText(r.orderId!)} className="text-muted hover:text-white" title="Perps matches off-chain, so there is no transaction hash. This is the venue's order id (click to copy).">order {r.orderId}</button>
                          : r.venue === 'derive' && Number(r.filled) > 0
                            ? <span className="text-muted" title={r.tradeId ? `Trade ${r.tradeId}. The on-chain hash appears here once the settlement batch is posted.` : 'The on-chain hash appears here once the settlement batch is posted.'}>
                                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />{settlementLabel(r.settlement)}</span>
                                {r.tradeId && <button type="button" onClick={() => void navigator.clipboard?.writeText(r.tradeId!)} className="block text-[10px] text-muted hover:text-white" title="Copy trade id">trade {r.tradeId.slice(0, 8)}…</button>}
                              </span>
                            : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}
