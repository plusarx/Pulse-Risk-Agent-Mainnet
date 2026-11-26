'use client';
import { OrderHistory } from '@/components/trade/OrderHistory';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { bstockBySymbol, BSTOCKS_BSC, MIN_LIQUIDITY_USD } from '@/lib/bstocks';
import { useBscBalances } from '@/lib/hooks/useBscBalances';
import { useBStockTickers } from '@/lib/hooks/useBStockTickers';
import { MarketHeader, Tabs } from '@/components/trade/MarketHeader';
import { CandleChart, type Candle } from '@/components/trade/CandleChart';
import { OrderBook, TradesList, type Level } from '@/components/trade/OrderBook';
import { SwapTicket } from '@/components/spot/SwapTicket';
import { TradeLayout, Empty } from '@/components/trade/TradeLayout';
import { fmtNum, fmtUnits, fmtUsd, fmtPct, toFloat } from '@/lib/format';

const INTERVALS = ['5m', '15m', '1h', '4h', '1d'] as const;

export default function SpotPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const router = useRouter();
  const token = bstockBySymbol(symbol) ?? BSTOCKS_BSC[1];
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>('1h');
  const [chartTab, setChartTab] = useState<'chart' | 'info'>('chart');
  const [bookTab, setBookTab] = useState<'book' | 'trades'>('book');
  const [bottomTab, setBottomTab] = useState<'holdings' | 'balances' | 'history'>('holdings');
  const tickers = useBStockTickers();
  const bal = useBscBalances();
  const t = tickers.data?.find((x) => x.symbol === token.symbol);

  const candles = useQuery({ queryKey: ['bk', token.symbol, interval], queryFn: async () => (await (await fetch(`/api/bstocks/market?kind=klines&symbol=${token.symbol}&interval=${interval}`)).json()) as Candle[], refetchInterval: 10_000 });
  const depth = useQuery({ queryKey: ['bd', token.symbol], queryFn: async () => (await (await fetch(`/api/bstocks/market?kind=depth&symbol=${token.symbol}`)).json()) as { bids: Level[]; asks: Level[] }, refetchInterval: 1_500 });
  const trades = useQuery({ queryKey: ['bt', token.symbol], queryFn: async () => (await (await fetch(`/api/bstocks/market?kind=trades&symbol=${token.symbol}`)).json()) as { id: number; price: number; size: number; time: number; side: 'buy' | 'sell' }[], refetchInterval: 2_000, enabled: bookTab === 'trades' });

  const holding = bal.holdings.find((h) => h.symbol === token.symbol);
  const priceOf = (s: string) => tickers.data?.find((x) => x.symbol === s)?.price ?? null;

  return (
    <TradeLayout
      header={
        <MarketHeader
          icon={<span className="grid h-8 w-8 place-items-center rounded-full bg-accent/20 text-xs font-bold text-accent">{token.underlying.slice(0, 2)}</span>}
          title={`${token.symbol}/USDT`} badge="bStock · BNB" price={t?.price} change={t?.change} changePct={t?.changePct}
          stats={[
            { label: 'Underlying', value: token.displayName },
            { label: '24H High', value: fmtNum(t?.high) }, { label: '24H Low', value: fmtNum(t?.low) },
            { label: '24H Volume (USD)', value: fmtNum(t?.volumeUsd, 0) },
            { label: 'On-chain liquidity', value: fmtUsd(token.observedLiquidityUsd, 0) },
          ]}
          markets={(tickers.data ?? BSTOCKS_BSC.map((b) => ({ symbol: b.symbol, name: b.displayName, price: null, changePct: null, liquidityUsd: b.observedLiquidityUsd }))).map((m) => ({
            key: m.symbol, label: m.symbol, sub: m.name, price: m.price, changePct: m.changePct,
            badge: m.liquidityUsd < MIN_LIQUIDITY_USD ? 'thin' : /ETF|Index|S&P|QQQ|Semis/.test(m.name) ? 'ETF' : undefined,
          }))}
          onSelect={(s) => router.push(`/trade/spot/${s}`)}
        />
      }
      chart={
        <>
          <div className="mb-2 flex items-center justify-between">
            <Tabs tabs={[{ id: 'chart', label: 'Chart' }, { id: 'info', label: 'Market Info' }] as const} value={chartTab} onChange={setChartTab} />
            {chartTab === 'chart' && <Tabs size="sm" tabs={INTERVALS.map((i) => ({ id: i, label: i }))} value={interval} onChange={setInterval} />}
          </div>
          {chartTab === 'chart' ? (
            <div className="flex-1 min-h-0">{candles.data?.length ? <CandleChart candles={candles.data} watermark={token.symbol} /> : <Empty>Loading chart…</Empty>}</div>
          ) : (
            <div className="space-y-3 p-2 text-sm">
              <Info k="Token contract (BSC)" v={<a className="underline" target="_blank" rel="noreferrer" href={`https://bscscan.com/token/${token.address}`}>{token.address}</a>} />
              <Info k="Issuer" v="BTech Holdings (ADGM), verified via shared EIP-1967 beacon" />
              <Info k="Standard" v="BEP-20 + BEP-677 scaled UI amount (uiMultiplier)" />
              <Info k="uiMultiplier" v={holding ? (Number(holding.uiMultiplier) / 1e18).toFixed(6) + 'x' : 'connect wallet to read'} />
              <Info k="Execution venue" v="PancakeSwap V3 on BNB Chain; every fee tier is quoted and the best is used" />
              <Info k="Price & book source" v="Binance spot (deepest reference market for bStocks)" />
              <Info k="Hedge market" v={`${token.underlying} perp (Perps tab)`} />
            </div>
          )}
        </>
      }
      book={
        <>
          <div className="mb-2 px-3"><Tabs tabs={[{ id: 'book', label: 'Book' }, { id: 'trades', label: 'Trades' }] as const} value={bookTab} onChange={setBookTab} /></div>
          <div className="flex-1 min-h-0">
            {bookTab === 'book'
              ? (depth.data?.bids ? <OrderBook bids={depth.data.bids} asks={depth.data.asks} last={t?.price} baseLabel={token.symbol.slice(0, -1)} quoteLabel="USDT" note="Reference book (Binance). Your order fills on PancakeSwap at the quoted price." /> : <Empty>Loading book…</Empty>)
              : <TradesList trades={trades.data ?? []} />}
          </div>
        </>
      }
      ticket={
        <SwapTicket token={token} refPrice={t?.price ?? null} onFilled={bal.refetch}
          balances={{ usdc: bal.usdc, usdt: bal.usdt, stockRaw: holding?.raw ?? null, uiMultiplier: holding?.uiMultiplier ?? null }} />
      }
      bottom={
        <>
          <Tabs tabs={[{ id: 'holdings', label: 'bStock holdings' }, { id: 'balances', label: 'Balances' }, { id: 'history', label: 'Order history' }] as const} value={bottomTab} onChange={setBottomTab} />
          {bottomTab === 'history' ? <OrderHistory venues={['bstocks']} /> : !bal.address ? <Empty>Connect MetaMask to see your balances</Empty> : bottomTab === 'balances' ? (
            <table className="mt-2 w-full"><thead><tr><th className="th">Asset</th><th className="th text-right">Balance</th><th className="th text-right">Value</th></tr></thead><tbody>
              <tr><td className="td">USDC (BSC)</td><td className="td text-right">{fmtUnits(bal.usdc, 18, 2)}</td><td className="td text-right">{bal.usdc !== null ? fmtUsd(toFloat(bal.usdc, 18)) : '—'}</td></tr>
              <tr><td className="td">USDT (BSC)</td><td className="td text-right">{fmtUnits(bal.usdt, 18, 2)}</td><td className="td text-right">{bal.usdt !== null ? fmtUsd(toFloat(bal.usdt, 18)) : '—'}</td></tr>
              <tr><td className="td">BNB (gas)</td><td className="td text-right">{fmtUnits(bal.bnb, 18, 5)}</td><td className="td text-right text-muted">gas</td></tr>
            </tbody></table>
          ) : (
            <table className="mt-2 w-full"><thead><tr><th className="th">bStock</th><th className="th text-right">Quantity</th><th className="th text-right">Price</th><th className="th text-right">Value</th><th className="th text-right">24h</th></tr></thead><tbody>
              {bal.holdings.filter((h) => h.raw > 0n).map((h) => {
                const p = priceOf(h.symbol); const v = p !== null ? toFloat(h.ui, 18) * p : null; const tk = tickers.data?.find((x) => x.symbol === h.symbol);
                return <tr key={h.symbol} className="hover:bg-panel2 cursor-pointer" onClick={() => router.push(`/trade/spot/${h.symbol}`)}>
                  <td className="td">{h.symbol} <span className="text-muted">{h.name}</span></td><td className="td text-right">{fmtUnits(h.ui, 18, 4)}</td>
                  <td className="td text-right">{fmtNum(p)}</td><td className="td text-right">{fmtUsd(v)}</td>
                  <td className={`td text-right ${(tk?.changePct ?? 0) >= 0 ? 'text-up' : 'text-down'}`}>{fmtPct(tk?.changePct)}</td></tr>;
              })}
              {!bal.holdings.some((h) => h.raw > 0n) && <tr><td className="td text-muted" colSpan={5}>No bStocks yet. Buy one from the ticket.</td></tr>}
            </tbody></table>
          )}
        </>
      }
    />
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex flex-wrap justify-between gap-2 border-b border-line pb-2"><span className="text-muted">{k}</span><span className="text-right break-all">{v}</span></div>;
}
