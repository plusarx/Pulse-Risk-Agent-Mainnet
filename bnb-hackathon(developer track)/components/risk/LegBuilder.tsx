'use client';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Trash2, X } from 'lucide-react';
import { useVenueNetwork } from '@/lib/network';
import { derivePublic } from '@/lib/hooks/useVenues';
import type { AsterMarket } from '@/lib/aster-view';
import { BSTOCKS_BSC } from '@/lib/bstocks';
import { parseDeriveOption } from '@/lib/scenario';
import { fmtNum } from '@/lib/format';

export type LegVenue = 'derive-option' | 'perp' | 'bstock';
export interface WhatIfLeg { id: string; venue: LegVenue; instrument: string; underlying: string; side: 'buy' | 'sell'; size: number }

const VENUES: { id: LegVenue; label: string; sub: string }[] = [
  { id: 'derive-option', label: 'Options', sub: 'Options' },
  { id: 'perp', label: 'Perps', sub: 'Perps' },
  { id: 'bstock', label: 'bStocks', sub: 'spot · BNB' },
];
export const VENUE_NAME: Record<LegVenue, string> = { 'derive-option': 'Option', perp: 'Perp', bstock: 'bStock (BNB)' };

interface Slim { M: string; I: string; option_pricing?: { i: string; d: string; m: string } | null }
const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });

/**
 * Strategy builder for the scenario forecast: pick a venue, then the market step by step
 * (options: underlying → expiry → strike → call/put), a side and a size; legs can be removed one by one.
 * Legs are hypothetical (nothing is traded); they price off the same live data as real positions.
 */
export function LegBuilder({ legs, onChange, perpMarkets, priceOf }: {
  legs: WhatIfLeg[]; onChange: (legs: WhatIfLeg[]) => void;
  perpMarkets: AsterMarket[] | undefined; priceOf: (l: WhatIfLeg) => number | null;
}) {
  const { network } = useVenueNetwork();
  const [venue, setVenue] = useState<LegVenue>('derive-option');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [size, setSize] = useState('1');
  // Derive option pickers
  const [ou, setOu] = useState('ETH'); const [exp, setExp] = useState<number | null>(null); const [strike, setStrike] = useState<number | null>(null); const [cp, setCp] = useState<'C' | 'P'>('C');
  // Other pickers
  const [lm, setLm] = useState<string | null>(null); const [stock, setStock] = useState('NVDAB');

  const live = useQuery({ queryKey: ['dlive', network], staleTime: 60_000, queryFn: () => derivePublic<string[]>(network, 'public/get_all_live_instruments', {}) });
  const opts = useMemo(() => (live.data ?? []).map((n) => ({ n, o: parseDeriveOption(n) })).filter((x): x is { n: string; o: NonNullable<ReturnType<typeof parseDeriveOption>> } => !!x.o), [live.data]);
  const optUnderlyings = useMemo(() => [...new Set(opts.map((x) => x.o.underlying))].sort(), [opts]);
  const expiries = useMemo(() => [...new Set(opts.filter((x) => x.o.underlying === ou).map((x) => x.o.expiryMs))].sort((a, b) => a - b), [opts, ou]);
  const e = exp !== null && expiries.includes(exp) ? exp : expiries[0] ?? null;
  const strikes = useMemo(() => [...new Set(opts.filter((x) => x.o.underlying === ou && x.o.expiryMs === e).map((x) => x.o.strike))].sort((a, b) => a - b), [opts, ou, e]);

  // Index for the chosen underlying → mark the at-the-money strike (from any option ticker of that expiry).
  const probe = opts.find((x) => x.o.underlying === ou && x.o.expiryMs === e)?.n ?? null;
  const probeT = useQuery({ queryKey: ['dticker', network, probe], enabled: !!probe, refetchInterval: 15_000, queryFn: () => derivePublic<Slim>(network, 'public/get_ticker', { instrument_name: probe }) });
  const index = probeT.data ? Number(probeT.data.I) : null;
  const atm = index && strikes.length ? strikes.reduce((b, k) => (Math.abs(k - index) < Math.abs(b - index) ? k : b), strikes[0]) : null;
  const k = strike !== null && strikes.includes(strike) ? strike : atm ?? strikes[0] ?? null;
  const optName = e !== null && k !== null ? opts.find((x) => x.o.underlying === ou && x.o.expiryMs === e && x.o.strike === k && x.o.type === cp)?.n ?? null : null;
  const optT = useQuery({ queryKey: ['dticker', network, optName], enabled: !!optName && venue === 'derive-option', refetchInterval: 15_000, queryFn: () => derivePublic<Slim>(network, 'public/get_ticker', { instrument_name: optName }) });

  const lmk = perpMarkets?.find((m) => m.ticker === lm) ?? perpMarkets?.find((m) => m.ticker === 'ETH') ?? perpMarkets?.[0];
  const st = BSTOCKS_BSC.find((b) => b.symbol === stock) ?? BSTOCKS_BSC[0];

  const draft: Omit<WhatIfLeg, 'id' | 'side' | 'size'> | null =
    venue === 'derive-option' ? (optName ? { venue, instrument: optName, underlying: ou } : null)
      : venue === 'perp' ? (lmk ? { venue, instrument: `${lmk.ticker}-PERP`, underlying: lmk.ticker } : null)
          : { venue, instrument: st.symbol, underlying: st.underlying };
  const n = Number(size);
  const add = () => { if (draft && n > 0) onChange([...legs, { ...draft, id: `${Date.now()}-${legs.length}`, side, size: n }]); };

  const sel = 'h-9 w-full min-w-0 rounded-lg border border-line bg-panel2 px-3 text-sm text-white outline-none focus:border-accent/60';
  return (
    <div className="mt-4 rounded-xl bg-bg p-4 text-xs ring-1 ring-inset ring-line">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div><div className="text-sm font-medium">Strategy builder</div><div className="text-[11px] text-muted">Hypothetical legs: nothing is traded. They price off live data and show in the chart and greeks above.</div></div>
        <div role="tablist" className="flex flex-wrap gap-1 rounded-lg bg-panel p-0.5 ring-1 ring-inset ring-line">
          {VENUES.map((v) => (
            <button key={v.id} role="tab" aria-selected={venue === v.id} onClick={() => setVenue(v.id)}
              className={clsx('rounded-md px-3 py-1.5 text-left', venue === v.id ? 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/30' : 'text-muted hover:text-white')}>
              <div className="text-xs font-medium leading-none">{v.label}</div><div className="mt-0.5 text-[10px] opacity-80">{v.sub}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(84px,0.8fr)_minmax(130px,1.3fr)_minmax(140px,1.4fr)_104px_176px_76px_auto] lg:items-end">
        {venue === 'derive-option' && (<>
          <Field label="Underlying"><select className={sel} value={ou} onChange={(ev) => { setOu(ev.target.value); setExp(null); setStrike(null); }}>{(optUnderlyings.length ? optUnderlyings : ['ETH']).map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Expiry"><select className={sel} value={e ?? ''} onChange={(ev) => { setExp(Number(ev.target.value)); setStrike(null); }}>{expiries.map((x) => <option key={x} value={x}>{day(x)} · {Math.max(0, Math.round((x - Date.now()) / 864e5))}d</option>)}</select></Field>
          <Field label={`Strike${index ? ` · index ${fmtNum(index, index < 10 ? 4 : 2)}` : ''}`}><select className={sel} value={k ?? ''} onChange={(ev) => setStrike(Number(ev.target.value))}>{strikes.map((x) => <option key={x} value={x}>{fmtNum(x, x < 10 ? 2 : 0)}{x === atm ? '  · ATM' : ''}</option>)}</select></Field>
          <Field label="Type"><Seg value={cp} onChange={setCp} options={[['C', 'Call'], ['P', 'Put']]} /></Field>
        </>)}
        {venue === 'perp' && (
          <div className="lg:col-span-4"><Field label="Market">{perpMarkets?.length
            ? <select className={sel} value={lmk?.ticker ?? ''} onChange={(ev) => setLm(ev.target.value)}>{perpMarkets.map((m) => <option key={m.symbol} value={m.ticker}>{m.ticker}-PERP · {fmtNum(m.mark ?? m.last, 2)}</option>)}</select>
            : <div className="flex h-9 items-center rounded-lg border border-line bg-panel2 px-3 text-sm text-muted">Perps markets unavailable on this network right now</div>}</Field></div>
        )}
        {venue === 'bstock' && (
          <div className="lg:col-span-4"><Field label="bStock (BNB Chain)"><select className={sel} value={stock} onChange={(ev) => setStock(ev.target.value)}>{BSTOCKS_BSC.map((b) => <option key={b.symbol} value={b.symbol}>{b.symbol} · {b.displayName} → {b.underlying}</option>)}</select></Field></div>
        )}
        <Field label="Side"><Seg value={side} onChange={setSide} options={[['buy', 'Buy / long'], ['sell', 'Sell / short']]} tone /></Field>
        <Field label={venue === 'derive-option' ? 'Contracts' : venue === 'bstock' ? 'Shares' : 'Size'}><input className={sel} inputMode="decimal" value={size} onChange={(ev) => setSize(ev.target.value)} /></Field>
        <button className="btn-primary inline-flex h-9 items-center justify-center gap-1 px-4 py-0 text-xs" disabled={!draft || !(n > 0)} onClick={add}><Plus size={13} /> Add leg</button>
      </div>
      {venue === 'derive-option' && optName && (
        <div className="mt-2 text-[11px] text-muted">{optName}{optT.data?.option_pricing ? ` · mark ${fmtNum(Number(optT.data.option_pricing.m), 2)} · IV ${(Number(optT.data.option_pricing.i) * 100).toFixed(1)}% · Δ ${fmtNum(Number(optT.data.option_pricing.d), 3)}` : ' · loading quote…'}</div>
      )}

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between"><span className="font-medium">Legs ({legs.length})</span>
          {legs.length > 0 && <button className="inline-flex items-center gap-1 text-down" onClick={() => onChange([])}><Trash2 size={12} /> Clear all</button>}</div>
        {!legs.length ? <p className="text-muted">No legs yet. Build a strategy leg by leg, e.g. buy an ETH call and sell a higher-strike call for a call spread.</p> : (
          <table className="w-full num">
            <thead><tr>{['#', 'Venue', 'Market', 'Underlying', 'Side', 'Size', 'Live price', ''].map((h) => <th key={h} className="th py-1.5">{h}</th>)}</tr></thead>
            <tbody>
              {legs.map((l, i) => {
                const px = priceOf(l);
                return (
                  <tr key={l.id} className="border-t border-line/60">
                    <td className="td py-1.5 text-muted">{i + 1}</td><td className="td py-1.5">{VENUE_NAME[l.venue]}</td><td className="td py-1.5">{l.instrument}</td><td className="td py-1.5 text-muted">{l.underlying}</td>
                    <td className={clsx('td py-1.5', l.side === 'buy' ? 'text-up' : 'text-down')}>{l.side === 'buy' ? 'Buy' : 'Sell'}</td><td className="td py-1.5">{fmtNum(l.size, 4)}</td>
                    <td className="td py-1.5">{px === null ? <span className="text-muted">loading…</span> : fmtNum(px, px < 10 ? 4 : 2)}</td>
                    <td className="td py-1.5 text-right"><button aria-label={`Remove leg ${i + 1}`} title="Remove leg" onClick={() => onChange(legs.filter((x) => x.id !== l.id))} className="rounded p-1 text-muted hover:bg-panel2 hover:text-down"><X size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0"><span className="mb-1 block truncate text-[11px] text-muted">{label}</span>{children}</label>;
}

function Seg<T extends string>({ value, onChange, options, tone }: { value: T; onChange: (v: T) => void; options: [T, string][]; tone?: boolean }) {
  return (
    <div className="grid h-9 grid-flow-col gap-0.5 rounded-lg bg-panel2 p-0.5">
      {options.map(([v, label], i) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={clsx('rounded-md px-2 text-[11px] font-medium', value === v ? (tone ? (i === 0 ? 'bg-up/20 text-up' : 'bg-down/20 text-down') : 'bg-white text-black') : 'text-muted')}>{label}</button>
      ))}
    </div>
  );
}
