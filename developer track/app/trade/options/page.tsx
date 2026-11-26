'use client';
import { OrderHistory } from '@/components/trade/OrderHistory';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useVenueNetwork } from '@/lib/network';
import { derivePublic, getJson, useDeriveAccount, type DeriveSubView } from '@/lib/hooks/useVenues';
import { universeFor, type DeriveUniverse } from '@/lib/derive-codec';
import { Tabs } from '@/components/trade/MarketHeader';
import { CandleChart, type Candle } from '@/components/trade/CandleChart';
import { Empty } from '@/components/trade/TradeLayout';
import { AgentGate } from '@/components/AgentGate';
import { ClosePositionButton } from '@/components/trade/ClosePositionButton';
import { fmtNum, fmtUsd } from '@/lib/format';

const UNDERLYINGS = [
  { c: 'ETH', label: 'ETH' }, { c: 'BTC', label: 'BTC' }, { c: 'SOL', label: 'SOL' }, { c: 'HYPE', label: 'HYPE' },
  { c: 'NVDA', label: 'NVDA', rwa: true }, { c: 'US500', label: 'US500', rwa: true }, { c: 'US100', label: 'US100', rwa: true },
  { c: 'XAUT', label: 'Gold', rwa: true }, { c: 'WTI', label: 'WTI oil', rwa: true },
] as const;

interface Inst { instrument_name: string; is_active: boolean; option_details: { expiry: number; strike: string; option_type: 'C' | 'P' } }
interface Slim { b: string; B: string; a: string; A: string; M: string; I: string; option_pricing?: { d: string; i: string; m: string }; stats?: { v: string; oi: string } }

/** "ETH-20261127-1400-C" / "ADA-20261127-0_1-P" → Inst (strike decimals use "_"). Expiry is 08:00 UTC. */
function parseOptionName(name: string): Inst | null {
  const m = /^([A-Z0-9]+)-(\d{4})(\d{2})(\d{2})-([0-9_]+)-([CP])$/.exec(name);
  if (!m) return null;
  const expiry = Date.UTC(+m[2], +m[3] - 1, +m[4], 8) / 1000;
  return { instrument_name: name, is_active: true, option_details: { expiry, strike: m[5].replace('_', '.'), option_type: m[6] as 'C' | 'P' } };
}

function ymd(sec: number) { const d = new Date(sec * 1000); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`; }
function label(sec: number) { return new Date(sec * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }

export default function OptionsPage() {
  const { network } = useVenueNetwork();
  const [ccy, setCcy] = useState<string>('ETH');
  const [expiry, setExpiry] = useState<number | null>(null);
  const [sel, setSel] = useState<{ name: string; side: 'buy' | 'sell'; price: string } | null>(null);
  const [view, setView] = useState<'chain' | 'chart'>('chain');

  // Build the chain from live instrument NAMES (~1 s, 74 KB) rather than get_all_instruments, which is
  // ~435 KB and erratically slow on Derive testnet. Option names encode everything: CCY-YYYYMMDD-STRIKE-C|P.
  const insts = useQuery({
    queryKey: ['dlive', network], staleTime: 60_000,
    queryFn: () => derivePublic<string[]>(network, 'public/get_all_live_instruments', {}),
    select: (names) => names.map(parseOptionName).filter((i): i is Inst => !!i && i.instrument_name.startsWith(`${ccy}-`)),
  });
  const expiries = useMemo(() => [...new Set((insts.data ?? []).map((i) => i.option_details.expiry))].sort((a, b) => a - b), [insts.data]);
  useEffect(() => { setExpiry(expiries[0] ?? null); setSel(null); }, [expiries]);

  const tickers = useQuery({
    queryKey: ['dtick', network, ccy, expiry], enabled: expiry !== null, refetchInterval: 3_000,
    queryFn: async () => (await derivePublic<{ tickers: Record<string, Slim> }>(network, 'public/get_tickers', { instrument_type: 'option', currency: ccy, expiry_date: ymd(expiry!) })).tickers,
  });

  const rows = useMemo(() => {
    const byStrike = new Map<number, { C?: Inst; P?: Inst }>();
    for (const i of insts.data ?? []) {
      if (i.option_details.expiry !== expiry) continue;
      const k = Number(i.option_details.strike);
      byStrike.set(k, { ...byStrike.get(k), [i.option_details.option_type]: i });
    }
    return [...byStrike.entries()].sort((a, b) => a[0] - b[0]);
  }, [insts.data, expiry]);

  const index = Number(Object.values(tickers.data ?? {})[0]?.I ?? 0);
  const atm = rows.reduce((best, [k]) => (Math.abs(k - index) < Math.abs(best - index) ? k : best), rows[0]?.[0] ?? 0);
  const acct = useDeriveAccount();
  const universe = universeFor(acct.data?.universes ?? [], ccy);
  const uSub = universe ? subForUniverse(acct.data?.subaccounts, universe.id) : undefined;

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 xl:col-span-1">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#00b3ff]/15 text-xs font-bold text-[#5fd0ff]">D</span>
          <span className="text-lg font-medium">{ccy} Options</span>
          <span className="rounded-md bg-panel2 px-2 py-0.5 text-xs text-[#c9ccd6]">Options{network === 'testnet' ? ' testnet' : ''}</span>
        </div>
        <div><div className="label">Index</div><div className="num text-lg font-semibold">{index ? fmtNum(index, 2) : '—'}</div></div>
        {universe && <div><div className="label">Risk universe</div>
          <div className={clsx('text-sm', acct.data?.state === 'ok' ? (uSub ? 'text-up' : 'text-accent') : 'text-muted')}>
            {universe.name} · {acct.data?.state !== 'ok' ? '—' : uSub ? `subaccount #${uSub.subaccount_id}` : 'not enabled'}</div></div>}
        <div className="flex flex-wrap gap-1">
          {UNDERLYINGS.map((u) => (
            <button key={u.c} onClick={() => setCcy(u.c)} className={clsx('pill text-sm', ccy === u.c ? 'bg-white text-black' : 'bg-panel2 text-[#c9ccd6]')}>
              {u.label}{'rwa' in u && <span className="ml-1 text-[10px] opacity-60">RWA</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="xl:row-span-3 xl:col-start-2 xl:row-start-1"><OptionTicket sel={sel} onClear={() => setSel(null)} universeId={universe?.id ?? null} /></div>

      <div className="panel p-3 min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <Tabs tabs={[{ id: 'chain', label: 'Option chain' }, { id: 'chart', label: 'Chart' }] as const} value={view} onChange={setView} />
          <div className="flex max-w-full gap-1 overflow-x-auto">
            {expiries.map((e) => <button key={e} onClick={() => setExpiry(e)} className={clsx('pill whitespace-nowrap text-sm', expiry === e ? 'pill-on' : 'pill-off')}>{label(e)}</button>)}
          </div>
        </div>
        {view === 'chart' ? (
          <div className="h-[520px]"><OptionChart name={sel?.name ?? `${ccy}-PERP`} /></div>
        ) : !rows.length ? <Empty>{insts.isLoading ? 'Loading chain…' : 'No live options for this underlying'}</Empty> : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-[13px] num">
              <thead className="sticky top-0 bg-panel"><tr>
                <th className="th text-center" colSpan={4}>Calls</th><th className="th text-center">Strike</th><th className="th text-center" colSpan={4}>Puts</th></tr>
                <tr>{['Δ', 'IV', 'Bid', 'Ask', '', 'Bid', 'Ask', 'IV', 'Δ'].map((h, i) => <th key={i} className="th text-center py-1">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map(([k, { C, P }]) => {
                  const c = C ? tickers.data?.[C.instrument_name] : undefined; const p = P ? tickers.data?.[P.instrument_name] : undefined;
                  const cell = (inst: Inst | undefined, t: Slim | undefined, side: 'b' | 'a') => {
                    const v = t ? Number(side === 'b' ? t.b : t.a) : 0;
                    return <td className="px-2 py-1.5 text-center">
                      {v > 0 && inst ? <button onClick={() => setSel({ name: inst.instrument_name, side: side === 'b' ? 'sell' : 'buy', price: side === 'b' ? t!.b : t!.a })}
                        className={clsx('rounded px-2 py-0.5 hover:bg-panel2', side === 'b' ? 'text-up' : 'text-down', sel?.name === inst.instrument_name && 'ring-1 ring-accent')}>{fmtNum(v, 2)}</button> : <span className="text-muted">—</span>}
                    </td>;
                  };
                  const greek = (t: Slim | undefined, f: 'd' | 'i') => t?.option_pricing ? (f === 'i' ? `${(Number(t.option_pricing.i) * 100).toFixed(1)}%` : Number(t.option_pricing.d).toFixed(2)) : '—';
                  return (
                    <tr key={k} className={clsx('border-t border-line/60', k === atm && 'bg-accent/5')}>
                      <td className="px-2 text-center text-muted">{greek(c, 'd')}</td><td className="px-2 text-center text-muted">{greek(c, 'i')}</td>{cell(C, c, 'b')}{cell(C, c, 'a')}
                      <td className={clsx('px-3 text-center font-medium', k === atm && 'text-accent')}>{fmtNum(k, k < 10 ? 2 : 0)}</td>
                      {cell(P, p, 'b')}{cell(P, p, 'a')}<td className="px-2 text-center text-muted">{greek(p, 'i')}</td><td className="px-2 text-center text-muted">{greek(p, 'd')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="panel min-h-[200px] min-w-0 overflow-x-auto p-3"><DeriveAccountPanel /></div>
    </div>
  );
}

function OptionChart({ name }: { name: string }) {
  const { network } = useVenueNetwork();
  const q = useQuery({
    queryKey: ['dchart', network, name], refetchInterval: 30_000,
    queryFn: async () => {
      const end = Math.floor(Date.now() / 1000);
      const r = await derivePublic<{ timestamp: number; open_price: string; high_price: string; low_price: string; close_price: string; volume_contracts: string }[]>(network, 'public/get_tradingview_chart_data',
        { instrument_name: name, period: 3600, start_timestamp: end - 3600 * 300, end_timestamp: end });
      return r.map((k): Candle => ({ time: k.timestamp > 1e12 ? Math.floor(k.timestamp / 1000) : k.timestamp, open: +k.open_price, high: +k.high_price, low: +k.low_price, close: +k.close_price, volume: +k.volume_contracts }));
    },
  });
  return q.data?.length ? <CandleChart candles={q.data} watermark={name} /> : <Empty>{q.isLoading ? 'Loading…' : `No trades yet for ${name}`}</Empty>;
}

function newIdem() { return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }

/** Richest non-fallback subaccount trading `universeId` (orders are routed the same way server-side). */
function subForUniverse(subs: DeriveSubView[] | undefined, universeId: number): DeriveSubView | undefined {
  return (subs ?? []).filter((s) => !s.isFallback && s.universeId === universeId).sort((a, b) => +b.collaterals_value - +a.collaterals_value)[0];
}

/** Create + fund a subaccount for a risk universe, from the richest existing one. */
function EnableUniverse({ managerId, name, compact }: { managerId: number; name: string; compact?: boolean }) {
  const { network } = useVenueNetwork();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    try {
      const r = await getJson<{ from: number; universe: string }>('/api/trade/derive-subaccounts', {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': newIdem() },
        body: JSON.stringify({ network, action: 'enable', managerId, amount }),
      });
      setMsg({ ok: true, text: `Creating ${r.universe} subaccount from #${r.from}… appears in ~10–30 s` });
      for (const ms of [5_000, 15_000, 30_000]) setTimeout(() => void qc.invalidateQueries({ queryKey: ['derive-account'] }), ms);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  return (
    <div className={clsx(!compact && 'rounded-xl bg-accent/10 border border-accent/30 p-3', 'text-sm')}>
      {!compact && <div className="mb-2 text-xs text-[#c9ccd6]">Options needs a separate subaccount for the <b>{name}</b> universe. Fund one from your existing margin (≈$1 fee).</div>}
      <div className="flex items-center gap-2">
        <input className="input w-24 py-1.5 text-sm" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="USDC to move" />
        <span className="text-xs text-muted">USDC</span>
        <button className="btn-primary px-3 py-1.5 text-sm" disabled={busy || !(Number(amount) >= 7)} onClick={() => void go()}>{busy ? 'Enabling…' : `Enable ${name}`}</button>
      </div>
      {msg && <div className={clsx('mt-2 text-xs', msg.ok ? 'text-up' : 'text-down')}>{msg.text}</div>}
    </div>
  );
}

function OptionTicket({ sel, onClear, universeId }: { sel: { name: string; side: 'buy' | 'sell'; price: string } | null; onClear: () => void; universeId: number | null }) {
  const { network } = useVenueNetwork();
  const acct = useDeriveAccount();
  const qc = useQueryClient();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (sel) { setSide(sel.side); setPrice(sel.price); setType('limit'); setMsg(null); } }, [sel]);

  const hasAccount = acct.data ? acct.data.state !== 'no_account' : null;
  // A ref, not state: two fast clicks land before React re-renders the disabled button (this placed a duplicate order).
  const sending = useRef(false);
  async function submit() {
    if (!sel || sending.current) return;
    sending.current = true;
    setBusy(true); setMsg(null);
    try {
      const r = await getJson<{ order: { order_id: string; order_status: string; filled_amount: string; average_price: string } }>('/api/trade/derive', {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': newIdem() },
        body: JSON.stringify({ network, action: 'order', instrument: sel.name, side, type, amount, limitPrice: type === 'limit' ? price : undefined }),
      });
      const filled = Number(r.order.filled_amount);
      setMsg({ ok: true, text: r.order.order_status === 'open'
        ? `Order placed and resting on the book${type === 'limit' ? ` at $${price}` : ''}: ${filled > 0 ? `${filled} filled so far` : 'it fills when a seller meets your price'}. It is listed under Open orders below, where you can cancel it.`
        : `${r.order.order_status === 'filled' ? 'Filled' : r.order.order_status}: ${r.order.filled_amount} @ ${r.order.average_price}` });
      void qc.invalidateQueries({ queryKey: ['derive-account'] });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); sending.current = false; }
  }
  const premium = Number(amount) * Number(price);
  const universe = acct.data?.universes?.find((u) => u.id === universeId);
  const sub = universeId !== null ? subForUniverse(acct.data?.subaccounts, universeId) : acct.data?.subaccount;
  const notEnabled = acct.data?.state === 'ok' && !!universe && !sub;
  const available = sub ? Number(sub.initial_margin) : null; // Derive's initial_margin = margin headroom (excess)
  const short = side === 'buy' && available !== null && premium > available;
  const smManager = universe?.managers.find((m) => m.marginType === 'SM') ?? universe?.managers[0];
  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 rounded-2xl bg-bg p-1">
        <button className={clsx('rounded-xl py-3 font-medium', side === 'buy' ? 'bg-up/15 text-up' : 'text-[#c9ccd6]')} onClick={() => setSide('buy')}>Buy</button>
        <button className={clsx('rounded-xl py-3 font-medium', side === 'sell' ? 'bg-down/15 text-down' : 'text-[#c9ccd6]')} onClick={() => setSide('sell')}>Sell</button>
      </div>
      <div className="rounded-xl bg-bg p-3 text-sm space-y-1">
        <div className="flex justify-between"><span className="text-muted">Available margin</span><span className="num">{available === null ? '—' : fmtUsd(available)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Collateral</span><span className="num">{sub ? fmtUsd(+sub.collaterals_value) : '—'}</span></div>
        {sub && <div className="flex justify-between text-xs"><span className="text-muted">Subaccount</span><span className="num">#{sub.subaccount_id} · {sub.universeName ?? ''} {sub.margin_type}</span></div>}
        {acct.data?.state === 'needs_agent' && <div className="text-xs text-muted">Register the options agent to see margin.</div>}
      </div>
      {notEnabled && smManager && universe && <EnableUniverse managerId={smManager.managerId} name={universe.name} />}
      {sel ? (
        <div className="flex items-center justify-between rounded-xl bg-bg px-3 py-2"><span className="num text-sm">{sel.name}</span><button className="text-xs text-muted" onClick={onClear}>clear</button></div>
      ) : <div className="rounded-xl bg-bg px-3 py-3 text-sm text-muted">Pick a bid or ask in the chain to choose a contract.</div>}
      <Tabs tabs={[{ id: 'limit', label: 'Limit' }, { id: 'market', label: 'Market' }] as const} value={type} onChange={setType} />
      {type === 'limit' && <div><div className="label mb-1.5">Price (USD per contract)</div><input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>}
      <div><div className="label mb-1.5">Contracts</div><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" /></div>
      <div className="rounded-xl bg-bg p-3 text-sm space-y-1">
        <div className="flex justify-between"><span className="text-muted">{side === 'buy' ? 'Premium paid' : 'Premium received'}</span><span className="num">{premium ? fmtUsd(premium) : '—'}</span></div>
        {available !== null && premium > 0 && side === 'buy' && <div className="flex justify-between text-xs"><span className="text-muted">Margin after</span><span className={clsx('num', short ? 'text-down' : '')}>{fmtUsd(available - premium)}</span></div>}
        {side === 'sell' && premium > 0 && <div className="text-xs text-muted">Selling an option locks margin; the order is rejected if your headroom is too small.</div>}
      </div>
      {short && <div className="rounded-xl bg-down/10 px-3 py-2 text-xs text-down">Not enough margin. Deposit more USDC to your options account.</div>}
      <AgentGate venue="derive" hasAccount={hasAccount}>
        <button className={side === 'buy' ? 'btn bg-up text-black' : 'btn bg-down text-black'} disabled={!sel || !(Number(amount) > 0) || (type === 'limit' && !(Number(price) > 0)) || busy || short || notEnabled} onClick={() => void submit()}>
          {busy ? 'Signing with agent…' : `${side === 'buy' ? 'Buy' : 'Sell'} ${sel?.name ?? 'option'}`}
        </button>
      </AgentGate>
      {msg && <div className={clsx('rounded-xl px-3 py-2 text-xs break-words', msg.ok ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{msg.text}</div>}
      <p className="text-[11px] text-muted leading-snug">Orders are signed by your options session key (scopes: trade, transfer between your own subaccounts, withdraw to you). Market orders use a worst price 2% through the touch.</p>
    </div>
  );
}

function DeriveAccountPanel() {
  const acct = useDeriveAccount();
  const { network } = useVenueNetwork();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'positions' | 'orders' | 'history' | 'universes' | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const d = acct.data;
  if (!d) return <Empty>Sign in to see options positions</Empty>;
  if (d.state === 'no_account') return <Empty>No options account yet. Deposit first.</Empty>;
  if (d.state === 'needs_agent' || !d.subaccounts) return <Empty>Register an options agent to read positions</Empty>;
  const subs = d.subaccounts;
  const positions = subs.flatMap((s) => s.positions.map((p) => ({ ...p, sub: s })));
  const orders = subs.flatMap((s) => (s.open_orders ?? []).map((o) => ({ ...o, sub: s })));
  const shown = tab ?? (orders.length ? 'orders' : 'positions');
  async function cancel(instrument: string, orderId: string) {
    setCancelling(orderId); setCancelErr(null);
    try {
      await getJson('/api/trade/derive', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': newIdem() }, body: JSON.stringify({ network, action: 'cancel', instrument, orderId }) });
      await qc.invalidateQueries({ queryKey: ['derive-account'] });
    } catch (e) { setCancelErr((e as Error).message); } finally { setCancelling(null); }
  }
  const total = subs.reduce((a, s) => a + Number(s.collaterals_value), 0);
  async function close(instrument: string, amount: string) {
    // Reduce-only market order on the opposite side for the full size.
    await getJson('/api/trade/derive', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': newIdem() },
      body: JSON.stringify({ network, action: 'order', instrument, side: +amount > 0 ? 'sell' : 'buy', type: 'market', amount: amount.replace('-', ''), reduceOnly: true }),
    });
    void qc.invalidateQueries({ queryKey: ['derive-account'] });
  }
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={[{ id: 'positions', label: `Positions (${positions.length})` }, { id: 'orders', label: `Open orders (${orders.length})` }, { id: 'history', label: 'Order history' }, { id: 'universes', label: 'Risk universes & subaccounts' }] as const} value={shown} onChange={setTab} />
        <span className="text-sm"><span className="text-muted">Total collateral </span><span className="num">{fmtUsd(total)}</span></span>
      </div>
      {shown === 'orders' ? (!orders.length ? <Empty>No open orders</Empty> : (
        <>
          {cancelErr && <p className="mb-2 text-xs text-down">Cancel failed: {cancelErr}</p>}
          <table className="w-full"><thead><tr>{['Instrument', 'Subaccount', 'Side', 'Amount', 'Limit price', 'Filled', 'Status', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
            {orders.map((o) => <tr key={o.order_id}>
              <td className="td">{o.instrument_name}</td>
              <td className="td text-muted">#{o.sub.subaccount_id} · {o.sub.universeName}</td>
              <td className={clsx('td', o.direction === 'buy' ? 'text-up' : 'text-down')}>{o.direction === 'buy' ? 'Buy' : 'Sell'}</td>
              <td className="td">{fmtNum(+o.amount)}</td><td className="td">{fmtNum(+o.limit_price)}</td><td className="td">{fmtNum(+o.filled_amount)}</td>
              <td className="td text-xs text-muted">{o.order_status}</td>
              <td className="td text-right"><button type="button" disabled={cancelling === o.order_id} onClick={() => void cancel(o.instrument_name, o.order_id)}
                className="rounded-full border border-down/60 px-3 py-1 text-xs text-down hover:bg-down/10 disabled:opacity-50">{cancelling === o.order_id ? 'Cancelling…' : 'Cancel'}</button></td>
            </tr>)}
          </tbody></table>
        </>
      )) : shown === 'positions' ? (!positions.length ? <Empty>No positions</Empty> : (
        <table className="w-full"><thead><tr>{['Instrument', 'Subaccount', 'Amount', 'Avg price', 'Mark', 'Value', 'uPnL', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
          {positions.map((p) => <tr key={`${p.sub.subaccount_id}:${p.instrument_name}`}><td className="td">{p.instrument_name}</td>
            <td className="td text-muted">#{p.sub.subaccount_id} · {p.sub.universeName}</td>
            <td className={clsx('td', +p.amount >= 0 ? 'text-up' : 'text-down')}>{p.amount}</td>
            <td className="td">{fmtNum(+p.average_price)}</td><td className="td">{fmtNum(+p.mark_price)}</td><td className="td">{fmtUsd(+p.mark_value)}</td>
            <td className={clsx('td', +p.unrealized_pnl >= 0 ? 'text-up' : 'text-down')}>{fmtUsd(+p.unrealized_pnl)}</td>
            <td className="td text-right"><ClosePositionButton onClose={() => close(p.instrument_name, p.amount)} /></td></tr>)}
        </tbody></table>
      )) : shown === 'history' ? <OrderHistory venues={['derive']} /> : <UniversesTable subs={subs} universes={d.universes ?? []} />}
    </>
  );
}

function UniversesTable({ subs, universes }: { subs: DeriveSubView[]; universes: DeriveUniverse[] }) {
  const tradeable = subs.filter((s) => !s.isFallback);
  return (
    <div className="space-y-3">
      <table className="w-full"><thead><tr>{['Universe', 'Markets', 'Subaccount', 'Margin', 'Collateral', 'Free margin', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
        {universes.map((u) => {
          const mine = tradeable.filter((s) => s.universeId === u.id);
          const markets = [...new Set(u.families.map((f) => f.split('-')[0]))].join(', ');
          const sm = u.managers.find((m) => m.marginType === 'SM') ?? u.managers[0];
          if (!mine.length) return (
            <tr key={u.id} className="border-t border-line/60"><td className="td font-medium">{u.name}</td><td className="td text-xs text-muted">{markets}</td>
              <td className="td text-muted" colSpan={4}>not enabled</td><td className="td text-right">{sm && <EnableUniverse compact managerId={sm.managerId} name={u.name} />}</td></tr>
          );
          return mine.map((s, i) => (
            <tr key={s.subaccount_id} className="border-t border-line/60">
              <td className="td font-medium">{i === 0 ? u.name : ''}</td><td className="td text-xs text-muted">{i === 0 ? markets : ''}</td>
              <td className="td">#{s.subaccount_id}</td><td className="td">{s.margin_type}</td><td className="td">{fmtUsd(+s.collaterals_value)}</td><td className="td">{fmtUsd(+s.initial_margin)}</td>
              <td className="td text-right text-xs text-up">enabled</td>
            </tr>
          ));
        })}
        {subs.filter((s) => s.isFallback).map((s) => (
          <tr key={s.subaccount_id} className="border-t border-line/60 text-muted"><td className="td">Fallback</td><td className="td text-xs">catches mis-routed deposits, cannot trade</td>
            <td className="td">#{s.subaccount_id}</td><td className="td">—</td><td className="td">{fmtUsd(+s.collaterals_value)}</td><td className="td">—</td><td className="td" /></tr>
        ))}
      </tbody></table>
      {subs.length > 1 && <MoveFunds subs={subs} />}
    </div>
  );
}

function MoveFunds({ subs }: { subs: DeriveSubView[] }) {
  const { network } = useVenueNetwork();
  const qc = useQueryClient();
  const funded = subs.filter((s) => Number(s.collaterals_value) > 0);
  const targets = subs.filter((s) => !s.isFallback);
  const [from, setFrom] = useState<number>(funded[0]?.subaccount_id ?? subs[0].subaccount_id);
  const [to, setTo] = useState<number>(targets.find((s) => s.subaccount_id !== from)?.subaccount_id ?? targets[0]?.subaccount_id ?? 0);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const label = (s: DeriveSubView) => `#${s.subaccount_id} · ${s.isFallback ? 'fallback' : s.universeName ?? '?'} · ${fmtUsd(+s.collaterals_value)}`;
  async function go() {
    setBusy(true); setMsg(null);
    try {
      await getJson('/api/trade/derive-subaccounts', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': newIdem() }, body: JSON.stringify({ network, action: 'move', from, to, amount }) });
      setMsg({ ok: true, text: 'Transfer submitted, balances update in a few seconds' });
      setAmount('');
      for (const ms of [3_000, 10_000]) setTimeout(() => void qc.invalidateQueries({ queryKey: ['derive-account'] }), ms);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-xl bg-bg p-3 text-sm">
      <div className="mb-2 font-medium">Move USDC between subaccounts</div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto py-1.5 text-sm" value={from} onChange={(e) => setFrom(+e.target.value)}>{subs.map((s) => <option key={s.subaccount_id} value={s.subaccount_id}>{label(s)}</option>)}</select>
        <span className="text-muted">→</span>
        <select className="input w-auto py-1.5 text-sm" value={to} onChange={(e) => setTo(+e.target.value)}>{targets.filter((s) => s.subaccount_id !== from).map((s) => <option key={s.subaccount_id} value={s.subaccount_id}>{label(s)}</option>)}</select>
        <input className="input w-28 py-1.5 text-sm" inputMode="decimal" placeholder="USDC" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <button className="btn-primary px-3 py-1.5 text-sm" disabled={busy || !(Number(amount) > 0) || from === to} onClick={() => void go()}>{busy ? 'Moving…' : 'Move'}</button>
      </div>
      {msg && <div className={clsx('mt-2 text-xs', msg.ok ? 'text-up' : 'text-down')}>{msg.text}</div>}
    </div>
  );
}
