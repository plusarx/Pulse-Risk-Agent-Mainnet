'use client';
import Link from 'next/link';
import clsx from 'clsx';
import { useBStockTickers } from '@/lib/hooks/useBStockTickers';
import { usePortfolio, DEFAULT_HAIRCUT } from '@/lib/hooks/usePortfolio';
import { useIntegrity } from '@/lib/hooks/useIntegrity';
import { IntegrityDots } from '@/components/risk/PriceIntegrity';
import { MIN_LIQUIDITY_USD } from '@/lib/bstocks';
import { venueWords } from '@/lib/venue-words';
import { fmtNum, fmtPct, fmtUsd } from '@/lib/format';

export default function CollateralPage() {
  const tickers = useBStockTickers();
  const p = usePortfolio(DEFAULT_HAIRCUT);
  const integ = useIntegrity();
  const venueMargin = (p.perps.equity ?? 0) + (p.derive.equity ?? 0);
  const stables = (p.bsc.usdc ?? 0) + (p.bsc.usdt ?? 0);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="panel p-6">
        <h1 className="text-2xl font-semibold">bStocks as collateral</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted leading-relaxed">
          Your tokenized stocks stay in your own wallet on BNB Chain and keep their stock exposure. The agent counts them, after a haircut,
          as reserve collateral for your perps and options. If perps or options margin runs short, it uses BNB USDC first, then sells bStocks in your
          chosen order and bridges the USDC to the venue.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-4">
          <Stat k="bStock market value" v={fmtUsd(p.stocksValue)} />
          <Stat k={`Collateral value (−${DEFAULT_HAIRCUT * 100}%)`} v={fmtUsd(p.stocksCollateral)} accent />
          <Stat k="Stables on BNB" v={fmtUsd(stables)} />
          <Stat k="Margin on venues" v={fmtUsd(venueMargin)} />
        </div>
        {integ.enabled && integ.items.length > 0 && <div className="mt-4"><div className="label mb-1">Price integrity</div><IntegrityDots items={integ.items} /></div>}
        <div className="mt-4 text-sm">Total buying-power reserve: <span className="num text-accent">{fmtUsd(p.stocksCollateral + stables)}</span> <Link href="/automation" className="ml-2 text-xs text-accent underline">Configure the rebalance rules →</Link></div>
      </div>
      <div className="panel p-4">
        <div className="mb-2 font-medium">All live bStocks on BNB Chain ({tickers.data?.length ?? 26})</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]"><thead><tr>{['Asset', 'Name', 'Price', '24h', 'On-chain liquidity', 'You hold', 'Collateral value', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
            {(tickers.data ?? []).map((t) => {
              const mine = p.stocks.find((s) => s.symbol === t.symbol);
              return (
                <tr key={t.symbol} className="border-t border-line/50">
                  <td className="td font-medium">{t.symbol}</td><td className="td text-muted">{t.name}</td><td className="td">{fmtNum(t.price)}</td>
                  <td className={clsx('td', (t.changePct ?? 0) >= 0 ? 'text-up' : 'text-down')}>{fmtPct(t.changePct)}</td>
                  <td className={clsx('td', t.liquidityUsd < MIN_LIQUIDITY_USD && 'text-muted')}>{fmtUsd(t.liquidityUsd, 0)}{t.liquidityUsd < MIN_LIQUIDITY_USD && ' · thin'}</td>
                  <td className="td">{mine ? fmtNum(mine.qty, 4) : '—'}</td><td className="td text-accent">{mine ? fmtUsd(mine.collateral) : '—'}{mine && mine.haircutUsed > DEFAULT_HAIRCUT && <div className="text-[10px] text-muted" title={integ.bySymbol[t.symbol]?.reasons[0]}>haircut {Math.round(mine.haircutUsed * 100)}% (+{Math.round((mine.haircutUsed - DEFAULT_HAIRCUT) * 100)} pts){integ.bySymbol[t.symbol]?.reasons[0] ? `: ${venueWords(integ.bySymbol[t.symbol].reasons[0])}` : ''}</div>}</td>
                  <td className="td text-right"><Link className="text-xs text-accent" href={`/trade/spot/${t.symbol}`}>Trade</Link></td>
                </tr>
              );
            })}
          </tbody></table>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return <div className="rounded-xl bg-bg p-4"><div className="label">{k}</div><div className={clsx('num mt-1 text-xl', accent && 'text-accent')}>{v}</div></div>;
}
