'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import clsx from 'clsx';
import { useVenueNetwork } from '@/lib/network';
import { useSession } from '@/lib/session';
import { getJson, useAsterAccount, useAsterMarkets } from '@/lib/hooks/useVenues';
import { MarketHeader, Tabs } from '@/components/trade/MarketHeader';
import { CandleChart, type Candle } from '@/components/trade/CandleChart';
import { OrderBook, TradesList, type Level } from '@/components/trade/OrderBook';
import { TradeLayout, Empty } from '@/components/trade/TradeLayout';
import { AgentGate } from '@/components/AgentGate';
import { ClosePositionButton } from '@/components/trade/ClosePositionButton';
import { fmtNum, fmtUsd, priceDecimals } from '@/lib/format';
import { BSTOCKS_BSC } from '@/lib/bstocks';
import { OrderHistory } from '@/components/trade/OrderHistory';
import { checkPerpOrder, describeOutcome, type OrderOutcome } from '@/lib/perp-order';
import { stepDecimals, type AsterAccountView, type AsterMarket } from '@/lib/aster-view';

const RES = ['5m', '15m', '1h', '4h', '1d'] as const;
type Res = (typeof RES)[number];
const STOCKS = new Set(BSTOCKS_BSC.map((b) => b.underlying));
/** Leverage assumed for the margin estimate when the venue hasn't reported one for this market yet. */
const FALLBACK_LEVERAGE = 10;

export default function PerpsPage() {
  return <Suspense fallback={null}><Perps /></Suspense>;
}

function Perps() {
  const sp = useSearchParams();
  const router = useRouter();
  const { network } = useVenueNetwork();
  const markets = useAsterMarkets();
  const acct = useAsterAccount();
  const q = sp.get('q')?.toUpperCase();
  const m: AsterMarket | undefined = useMemo(() => {
    const list = markets.data ?? [];
    const t = sp.get('m')?.toUpperCase();
    return (t ? list.find((x) => x.ticker === t) : undefined) ?? (q ? list.find((x) => x.ticker === q) ?? list.find((x) => x.ticker.includes(q)) : undefined)
      ?? list.find((x) => x.ticker === 'NVDA') ?? list.find((x) => x.ticker === 'BTC') ?? list[0];
  }, [markets.data, sp, q]);
  const [res, setRes] = useState<Res>('1h');
  const [bookTab, setBookTab] = useState<'book' | 'trades'>('book');
  const [bottom, setBottom] = useState<'positions' | 'orders' | 'history'>('positions');
  const ticker = m?.ticker;

  const candles = useQuery({
    queryKey: ['aster-klines', network, ticker, res], enabled: !!ticker, refetchInterval: 10_000,
    queryFn: async () => (await getJson<{ candles: Candle[] }>(`/api/trade/aster-market?network=${network}&kind=klines&ticker=${ticker}&interval=${res}`)).candles,
  });
  const book = useQuery({
    queryKey: ['aster-depth', network, ticker], enabled: !!ticker, refetchInterval: 2_000,
    queryFn: () => getJson<{ bids: Level[]; asks: Level[] }>(`/api/trade/aster-market?network=${network}&kind=depth&ticker=${ticker}`),
  });
  const trades = useQuery({
    queryKey: ['aster-trades', network, ticker], enabled: !!ticker && bookTab === 'trades', refetchInterval: 3_000,
    queryFn: async () => (await getJson<{ trades: { id: number; price: number; size: number; time: number; side: 'buy' | 'sell' }[] }>(`/api/trade/aster-market?network=${network}&kind=trades&ticker=${ticker}`)).trades,
  });

  const last = m?.last ?? m?.mark ?? null;
  const view = acct.data;
  const lev = m ? view?.leverage[m.symbol] ?? null : null;

  if (markets.isError && !markets.data) {
    return (
      <div className="panel mx-auto mt-10 max-w-xl p-6 text-center">
        <div className="mb-2 text-lg font-semibold">Perps {network} isn&apos;t responding</div>
        <p className="text-sm text-muted">{markets.error.message}. Your account, agent key and positions are unaffected. This page reconnects by itself once perps is back.</p>
      </div>
    );
  }

  return (
    <TradeLayout
      header={
        <MarketHeader
          icon={<span className="grid h-8 w-8 place-items-center rounded-full bg-[#7b61ff]/20 text-xs font-bold text-[#a593ff]">P</span>}
          title={m ? `${m.ticker}-PERP` : 'Loading…'} badge={`${lev ? `${lev}x · ` : ''}Perps${network === 'testnet' ? ' testnet' : ''}`}
          price={last} changePct={m?.changePct ?? null}
          stats={[
            { label: 'Mark', value: fmtNum(m?.mark, priceDecimals(last ?? 1)) },
            { label: 'Index', value: fmtNum(m?.index, priceDecimals(last ?? 1)) },
            { label: '24H High', value: fmtNum(m?.high, priceDecimals(last ?? 1)) },
            { label: '24H Low', value: fmtNum(m?.low, priceDecimals(last ?? 1)) },
            { label: '24H Volume (USD)', value: fmtNum(m?.volumeUsd, 0) },
            { label: 'Funding', value: m?.fundingRate != null ? `${(m.fundingRate * 100).toFixed(4)}%` : '—' },
          ]}
          markets={(markets.data ?? []).map((x) => ({ key: x.ticker, label: `${x.ticker}-PERP`, price: x.last ?? x.mark, changePct: x.changePct, badge: STOCKS.has(x.ticker) ? 'stock · hedge' : undefined }))}
          onSelect={(k) => router.push(`/trade/perps?m=${k}`)}
        />
      }
      chart={
        <>
          <div className="mb-2 flex items-center justify-between"><span className="px-2 text-sm text-muted">Chart</span><Tabs size="sm" tabs={RES.map((r) => ({ id: r, label: r }))} value={res} onChange={setRes} /></div>
          <div className="flex-1 min-h-0">{candles.data?.length ? <CandleChart candles={candles.data} watermark={m?.ticker} /> : <Empty>{candles.isLoading ? 'Loading chart…' : 'No candles'}</Empty>}</div>
        </>
      }
      book={
        <>
          <div className="mb-2 px-3"><Tabs tabs={[{ id: 'book', label: 'Book' }, { id: 'trades', label: 'Trades' }] as const} value={bookTab} onChange={setBookTab} /></div>
          <div className="flex-1 min-h-0">{bookTab === 'book' ? (book.data ? <OrderBook bids={book.data.bids} asks={book.data.asks} last={last} baseLabel={m?.ticker ?? ''} quoteLabel="USDT" /> : <Empty>Loading book…</Empty>) : <TradesList trades={trades.data ?? []} />}</div>
        </>
      }
      ticket={m ? <PerpTicket m={m} view={view ?? null} loading={acct.isLoading} /> : <div className="panel p-4"><Empty>Loading…</Empty></div>}
      bottom={
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs tabs={[{ id: 'positions', label: `Positions (${view?.positions.length ?? 0})` }, { id: 'orders', label: `Open orders (${view?.openOrders.length ?? 0})` }, { id: 'history', label: 'Order history' }] as const} value={bottom} onChange={setBottom} />
            {view?.state === 'ok' && <span className="text-xs text-muted">Equity <span className="num text-white">{fmtUsd(view.equity)}</span> · free <span className="num text-white">{fmtUsd(view.available)}</span></span>}
          </div>
          {bottom === 'positions' ? <AsterPositions view={view ?? null} loading={acct.isLoading} markets={markets.data} />
            : bottom === 'orders' ? <AsterOrders view={view ?? null} />
            : <OrderHistory venues={['aster']} />}
        </>
      }
    />
  );
}

function newIdem() { return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }

const post = (body: object) => getJson<Record<string, unknown>>('/api/trade/aster', {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': newIdem() }, body: JSON.stringify(body),
});

function PerpTicket({ m, view, loading }: { m: AsterMarket; view: AsterAccountView | null; loading: boolean }) {
  const { network } = useVenueNetwork();
  const qc = useQueryClient();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState<'limit' | 'market'>('market');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [reduceOnly, setReduceOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  // Leverage: Aster sets it per market; the ticket applies a changed value just before the order.
  const maxLev = useQuery({ queryKey: ['aster-maxlev', network, m.ticker], enabled: !!view && view.state !== 'needs_agent', staleTime: 3_600_000,
    queryFn: () => getJson<{ max: number }>(`/api/trade/aster-account?network=${network}&ticker=${m.ticker}`).then((r) => r.max) });
  const venueLev = view?.leverage[m.symbol] ?? null;
  const [levPick, setLevPick] = useState<number | null>(null);
  const [sizeMode, setSizeMode] = useState<'base' | 'margin'>('base');
  const [marginUsd, setMarginUsd] = useState('');
  useEffect(() => { setLevPick(null); }, [m.ticker]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const last = m.last ?? m.mark ?? 0;
  const px = type === 'market' ? (m.mark ?? last) : Number(price);
  const maxL = maxLev.data ?? Math.max(venueLev ?? FALLBACK_LEVERAGE, FALLBACK_LEVERAGE);
  const lev = Math.min(levPick ?? venueLev ?? FALLBACK_LEVERAGE, maxL);
  const imf = 1 / lev;
  const sizeDp = stepDecimals(m.stepSize);
  // Margin mode: "$1 at 20x" → a $20 position → size = margin × leverage ÷ price, rounded down to the size step.
  const sizeFromMargin = (usd: number) => (usd > 0 && px > 0 ? (Math.floor(((usd * lev) / px) / m.stepSize + 1e-9) * m.stepSize).toFixed(sizeDp) : '');
  useEffect(() => { if (sizeMode === 'margin') setSize(sizeFromMargin(Number(marginUsd) || 0)); }, [sizeMode, marginUsd, lev, px]); // eslint-disable-line react-hooks/exhaustive-deps
  const available = view?.state === 'ok' ? view.available : view?.state === 'no_deposit' ? 0 : null;
  const check = checkPerpOrder({ size: Number(size) || 0, px, imf, available, minBase: m.minQty, minQuote: m.minNotional, sizeDecimals: sizeDp, reduceOnly, symbol: m.ticker });
  const { notional, margin } = check;
  const hasAccount = loading || !view || view.state === 'needs_agent' ? null : view.state === 'ok';

  async function submit() {
    if (check.problem) { setMsg({ ok: false, text: check.problem }); return; }
    setBusy(true); setMsg(null);
    try {
      if (!reduceOnly && lev !== venueLev) {
        await post({ network, action: 'leverage', ticker: m.ticker, leverage: lev });
        void qc.invalidateQueries({ queryKey: ['aster-account'] });
      }
      const r = await post({ network, action: 'order', ticker: m.ticker, side, type, size, ...(type === 'limit' ? { price } : {}), reduceOnly });
      const orderId = String(r.orderId);
      setSize('');
      setMsg(describeOutcome({ state: 'pending', status: null, size: null, filled: null, avgPrice: null }, m.ticker));
      for (let i = 0; i < 8; i++) {
        await new Promise((res) => setTimeout(res, 1_500));
        const o = await getJson<OrderOutcome>(`/api/trade/aster?network=${network}&ticker=${m.ticker}&orderId=${orderId}`).catch(() => null);
        if (o && o.state !== 'pending') { setMsg(describeOutcome(o, m.ticker)); break; }
        if (i === 7) setMsg({ ok: true, text: `Order ${orderId} sent. The venue hasn't confirmed it yet; check Positions and Open orders.` });
      }
      void qc.invalidateQueries({ queryKey: ['aster-account'] });
      void qc.invalidateQueries({ queryKey: ['order-history', 'aster'] });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  const valid = Number(size) > 0 && (type === 'market' || Number(price) > 0) && !check.problem;
  return (
    <div className="panel flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 rounded-2xl bg-bg p-1">
        <button className={clsx('rounded-xl py-3 font-medium', side === 'buy' ? 'bg-up/15 text-up' : 'text-[#c9ccd6]')} onClick={() => setSide('buy')}>Long</button>
        <button className={clsx('rounded-xl py-3 font-medium', side === 'sell' ? 'bg-down/15 text-down' : 'text-[#c9ccd6]')} onClick={() => setSide('sell')}>Short</button>
      </div>
      <Tabs tabs={[{ id: 'limit', label: 'Limit' }, { id: 'market', label: 'Market' }] as const} value={type} onChange={setType} />
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label">Leverage · max {maxL}x</span>
          <span className="num text-sm font-semibold text-accent">{lev}x{venueLev !== null && lev !== venueLev ? <span className="ml-1 text-[11px] font-normal text-muted">(now {venueLev}x, applied on order)</span> : null}</span>
        </div>
        <div className="flex gap-1.5">{[1, 2, 3, 5, 10, 20, 50].filter((x) => x <= maxL).concat(maxL > 50 || ![1, 2, 3, 5, 10, 20, 50].includes(maxL) ? [maxL] : []).filter((x, i, a) => a.indexOf(x) === i).map((x) => (
          <button key={x} type="button" onClick={() => setLevPick(x)} className={clsx('flex-1 rounded-lg border py-1.5 text-xs num', lev === x ? 'border-accent/60 bg-accent/[0.08] text-white' : 'border-line text-muted hover:text-white')}>{x}x</button>
        ))}</div>
        <input type="range" min={1} max={maxL} step={1} value={lev} onChange={(e) => setLevPick(Number(e.target.value))} aria-label="Leverage" className="mt-2 w-full accent-[#f0b90b]" />
      </div>
      <div className="flex justify-between"><span className="label">Available margin</span><span className="text-sm num">{available === null ? '—' : `${fmtNum(available)} USDT`}</span></div>
      {type === 'limit' && (
        <div><div className="mb-1.5 flex justify-between"><span className="label">Price</span><button className="text-xs text-accent" onClick={() => setPrice(String(last))}>Last</button></div>
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={String(last)} /></div>
      )}
      <div className="flex rounded-lg border border-line p-0.5 text-xs">{([['base', `Size in ${m.ticker}`], ['margin', 'Margin in $']] as const).map(([k, label]) => (
        <button key={k} type="button" onClick={() => setSizeMode(k)} className={clsx('flex-1 rounded-md py-1.5', sizeMode === k ? 'bg-accent/[0.1] text-white' : 'text-muted hover:text-white')}>{label}</button>
      ))}</div>
      {sizeMode === 'margin' && (
        <div><div className="mb-1.5 flex justify-between"><span className="label">Margin (USDT)</span><span className="text-xs text-muted num">= {fmtUsd((Number(marginUsd) || 0) * lev)} position at {lev}x</span></div>
          <input className="input" inputMode="decimal" value={marginUsd} onChange={(e) => setMarginUsd(e.target.value)} placeholder="1" />
          <div className="mt-1 text-[11px] text-muted num">Size {size || '0'} {m.ticker} (rounded down to the {m.stepSize} step)</div></div>
      )}
      {sizeMode === 'base' && <div><div className="mb-1.5 flex justify-between"><span className="label">Size ({m.ticker}) · min {m.minQty}</span>
          {check.maxSize !== null && check.maxSize > 0 && !reduceOnly && <button className="text-xs text-accent" onClick={() => setSize(check.maxSize!.toFixed(sizeDp))}>Max {check.maxSize.toFixed(sizeDp)}</button>}</div>
        <input className="input" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="0" /></div>}
      {available !== null && available > 0 && px > 0 && (
        <div className="flex gap-2">{[10, 25, 50, 100].map((p) => (
          <button key={p} className="flex-1 rounded-lg bg-panel2 py-1.5 text-xs text-[#c9ccd6] hover:text-white"
            onClick={() => setSize((Math.floor(((available * p) / 100 / imf / px) / m.stepSize + 1e-9) * m.stepSize).toFixed(sizeDp))}>{p}%</button>
        ))}</div>
      )}
      <div className="rounded-xl bg-bg p-3 text-sm space-y-1.5">
        <div className="flex justify-between"><span className="text-muted">Order value</span><span className="num">{fmtUsd(notional || null)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Initial margin ({lev}x)</span><span className="num">{fmtUsd(margin || null)}</span></div>
        <div className="flex justify-between"><span className="text-muted">Minimum order</span><span className="num">{fmtUsd(m.minNotional)}</span></div>
      </div>
      {check.problem && <div className="rounded-xl bg-down/10 px-3 py-2 text-xs text-down">{check.problem}</div>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={reduceOnly} onChange={(e) => setReduceOnly(e.target.checked)} />Reduce only</label>
      <AgentGate venue="aster" hasAccount={hasAccount}>
        <button className={side === 'buy' ? 'btn bg-up text-black' : 'btn bg-down text-black'} disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? 'Signing with agent…' : `${side === 'buy' ? 'Long' : 'Short'} ${m.ticker}`}
        </button>
      </AgentGate>
      {msg && <div className={clsx('rounded-xl px-3 py-2 text-xs', msg.ok ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{msg.text}</div>}
      <p className="text-[11px] text-muted leading-snug">Perps orders are signed by your registered agent key on the server and matched off-chain: no gas, no MetaMask popup. Margin is USDT.</p>
    </div>
  );
}

function AsterPositions({ view, loading, markets }: { view: AsterAccountView | null; loading: boolean; markets: AsterMarket[] | undefined }) {
  const { wallet } = useSession();
  const { network } = useVenueNetwork();
  const qc = useQueryClient();
  if (!wallet) return <Empty>Sign in to see your positions</Empty>;
  if (!view) return <Empty>{loading ? 'Loading…' : 'Perps account unavailable'}</Empty>;
  if (view.state === 'needs_agent') return <Empty><span>Register the perps agent to see positions. <Link className="text-accent underline" href="/agents">Agent keys →</Link></span></Empty>;
  if (view.state === 'no_deposit') return <Empty><span>Deposit to start trading perps. <Link className="text-accent underline" href="/funding">Deposit →</Link></span></Empty>;
  if (!view.positions.length) return <Empty>No open positions</Empty>;

  async function close(p: AsterAccountView['positions'][number]) {
    if (!markets?.some((x) => x.symbol === p.symbol)) throw new Error('market data not loaded yet');
    // Market, reduce-only: it can never flip or enlarge the position.
    await post({ network, action: 'order', ticker: p.ticker, side: p.side === 'long' ? 'sell' : 'buy', type: 'market', size: p.size, reduceOnly: true });
    await new Promise((r) => setTimeout(r, 1_200));
    void qc.invalidateQueries({ queryKey: ['aster-account'] });
  }

  return (
    <table className="mt-2 w-full"><thead><tr>{['Market', 'Side', 'Size', 'Entry', 'Mark', 'Value', 'uPnL', 'Liq. price', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
      {view.positions.map((p) => <tr key={p.symbol}>
        <td className="td">{p.ticker}-PERP{p.leverage ? <span className="ml-1 text-[11px] text-muted">{p.leverage}x</span> : null}</td>
        <td className={clsx('td', p.side === 'long' ? 'text-up' : 'text-down')}>{p.side === 'long' ? 'Long' : 'Short'}</td>
        <td className="td">{p.size}</td><td className="td">{fmtNum(p.entryPrice, priceDecimals(p.entryPrice))}</td><td className="td">{fmtNum(p.markPrice, priceDecimals(p.markPrice))}</td>
        <td className="td">{fmtUsd(p.notional)}</td>
        <td className={clsx('td', p.upnl >= 0 ? 'text-up' : 'text-down')}>{fmtUsd(p.upnl)}</td><td className="td">{p.liqPrice ? fmtNum(p.liqPrice, priceDecimals(p.liqPrice)) : '—'}</td>
        <td className="td text-right"><ClosePositionButton onClose={() => close(p)} /></td>
      </tr>)}
    </tbody></table>
  );
}

function AsterOrders({ view }: { view: AsterAccountView | null }) {
  const { network } = useVenueNetwork();
  const { wallet } = useSession();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  if (!wallet) return <Empty>Sign in to see open orders</Empty>;
  if (view?.state === 'needs_agent') return <Empty>Register a perps agent to see orders</Empty>;
  if (!view?.openOrders.length) return <Empty>No open orders</Empty>;
  const cancel = async (o: AsterAccountView['openOrders'][number]) => {
    setErr(null);
    await post({ network, action: 'cancel', ticker: o.ticker, orderId: o.orderId }).catch((e: Error) => setErr(e.message));
    void qc.invalidateQueries({ queryKey: ['aster-account'] });
  };
  return (
    <>
      {err && <p className="mt-2 rounded-lg bg-down/10 px-3 py-2 text-xs text-down">{err}</p>}
      <table className="mt-2 w-full"><thead><tr>{['Market', 'Side', 'Price', 'Size', 'Filled', 'Type', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
        {view.openOrders.map((o) => <tr key={o.orderId}>
          <td className="td">{o.ticker}-PERP{o.reduceOnly ? <span className="ml-1 text-[11px] text-muted">reduce-only</span> : null}</td>
          <td className={clsx('td', o.side === 'sell' ? 'text-down' : 'text-up')}>{o.side === 'sell' ? 'Sell' : 'Buy'}</td><td className="td">{o.price}</td><td className="td">{o.size}</td><td className="td">{o.filled}</td><td className="td">{o.type}</td>
          <td className="td text-right"><button className="text-xs text-down" onClick={() => void cancel(o)}>Cancel</button></td>
        </tr>)}
      </tbody></table>
    </>
  );
}
