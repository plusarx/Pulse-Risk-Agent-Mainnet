'use client';
import Link from 'next/link';
import { OrderHistory } from '@/components/trade/OrderHistory';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ArrowUpRight, Bot } from 'lucide-react';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { useBStockTickers } from '@/lib/hooks/useBStockTickers';
import { useAgentKeys } from '@/lib/hooks/useVenues';
import { useVenueNetwork } from '@/lib/network';
import { fmtNum, fmtPct, fmtUsd } from '@/lib/format';
import { AsciiLanding } from '@/components/landing/AsciiLanding';
import { scrollToPortfolio } from '@/lib/portfolio-link';

function Live({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!at) return null;
  return <span className="flex items-center gap-1.5 text-xs text-muted"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-up" />Live · updated {Math.max(0, Math.round((now - at) / 1000))}s ago</span>;
}

function Card({ title, sub, href, children }: { title: string; sub: string; href?: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5 pt-6" data-title={title}>
      <div className="mb-4 flex items-start justify-between">
        <div><div className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{sub}</div></div>
        {href && <Link href={href} className="text-muted hover:text-white"><ArrowUpRight size={18} /></Link>}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v, cls }: { k: string; v: React.ReactNode; cls?: string }) {
  return <div className="flex justify-between py-1 text-sm"><span className="text-muted">{k}</span><span className={clsx('num', cls)}>{v}</span></div>;
}

function Usage({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const color = pct > 70 ? 'bg-down' : pct > 45 ? 'bg-accent' : 'bg-up';
  return <div className="mt-2"><div className="mb-1 flex justify-between text-xs"><span className="text-muted">Margin used</span><span className="num">{pct.toFixed(1)}%</span></div><div className="h-1.5 rounded-full bg-panel2"><div className={clsx('h-1.5 rounded-full', color)} style={{ width: `${pct}%` }} /></div></div>;
}

export default function PortfolioPage() {
  const p = usePortfolio();
  // Arriving from the chat's "View portfolio" button (/#portfolio): scroll to the section once the page has rendered.
  useEffect(() => { if (window.location.hash === '#portfolio') { const t = setTimeout(() => scrollToPortfolio(), 350); return () => clearTimeout(t); } }, []);
  const tickers = useBStockTickers();
  const keys = useAgentKeys();
  const { network } = useVenueNetwork();
  const keyFor = (v: string) => keys.data?.find((k) => k.venue === v && k.network === network && k.status === 'active');

  if (!p.address) return <AsciiLanding tickers={tickers.data ?? []} />;

  const allPositions = [
    ...p.perps.positions.map((x) => ({ venue: 'Perps', name: `${x.ticker}-PERP`, side: x.side === 'long' ? 'Long' : 'Short', size: x.size, value: x.notional, pnl: x.upnl })),
    ...p.derive.positions.map((x) => ({ venue: 'Options', name: x.instrument_name, side: +x.amount >= 0 ? 'Long' : 'Short', size: x.amount, value: +x.mark_value, pnl: +x.unrealized_pnl })),
  ];

  return (
    <div className="space-y-4">
      <div id="portfolio" className="panel flex scroll-mt-4 flex-wrap items-end justify-between gap-4 p-6">
        <div>
          <div className="label mb-1">Total portfolio value</div>
          <div className="num text-4xl font-semibold">{fmtUsd(p.total)}</div>
          <div className="mt-2"><Live at={p.updatedAt} /></div>
        </div>
        <div className="flex flex-wrap gap-8 text-sm">
          <div><div className="label">BNB wallet (stables)</div><div className="num text-lg">{fmtUsd((p.bsc.usdc ?? 0) + (p.bsc.usdt ?? 0))}</div></div>
          <div><div className="label">bStocks</div><div className="num text-lg">{fmtUsd(p.stocksValue)}</div></div>
          <div><div className="label">Perps</div><div className="num text-lg">{fmtUsd(p.perps.equity ?? 0)}</div></div>
          <div><div className="label">Options</div><div className="num text-lg">{fmtUsd(p.derive.equity ?? 0)}</div></div>
        </div>
      </div>

      <div id="positions" className="grid gap-4 lg:grid-cols-4">
        <Card title="BNB Chain wallet" sub="MetaMask · BSC mainnet" href="/funding">
          <Row k="USDC" v={fmtNum(p.bsc.usdc)} cls="text-lg" />
          <Row k="USDT" v={fmtNum(p.bsc.usdt)} />
          <Row k="BNB (gas)" v={fmtNum(p.bsc.bnb, 5)} />
        </Card>
        <Card title="bStocks collateral" sub={`${p.stocks.length} positions · ${(p.haircut * 100).toFixed(0)}% haircut`} href="/collateral">
          <Row k="Market value" v={fmtUsd(p.stocksValue)} cls="text-lg" />
          <Row k="Collateral value" v={fmtUsd(p.stocksCollateral)} cls="text-accent" />
          <p className="mt-2 text-xs text-muted">Reserve the agent can sell to top up perp margin.</p>
        </Card>
        <Card title="Perps" sub={network === 'testnet' ? 'testnet' : 'mainnet'} href="/trade/perps">
          {p.perps.state === 'unavailable' ? (
            <div className="rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
              Perps {network} is not responding right now, so balances can&apos;t be read. Your funds are unaffected; they reappear here when perps is back.
            </div>
          ) : p.perps.state === 'needs_agent' || p.perps.state === 'signed_out' ? <p className="text-sm text-muted">Register the perps agent to read balances. <Link href="/agents" className="text-accent">Agent keys →</Link></p>
            : p.perps.state === 'no_deposit' ? <p className="text-sm text-muted">Deposit to start trading perps. <Link href="/funding" className="text-accent">Deposit →</Link></p> : <>
            <Row k="Equity" v={fmtUsd(p.perps.equity)} cls="text-lg" />
            <Row k="Available" v={fmtUsd(p.perps.available)} />
            <Usage pct={p.perps.usage} />
          </>}
          <AgentBadge ok={!!keyFor('aster')} />
        </Card>
        <Card title="Options" sub={network === 'testnet' ? 'testnet' : 'mainnet'} href="/trade/options">
          {p.derive.state === 'no_account' ? <p className="text-sm text-muted">No account yet. <Link href="/funding" className="text-accent">Deposit →</Link></p>
            : p.derive.state === 'needs_agent' || p.derive.state === 'signed_out' ? <p className="text-sm text-muted">Register the options agent to read balances.</p> : <>
              <Row k="Equity" v={fmtUsd(p.derive.equity)} cls="text-lg" />
              <Usage pct={p.derive.usage} />
            </>}
          <AgentBadge ok={!!keyFor('derive')} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <div className="mb-2 flex items-center justify-between"><span className="font-medium">bStock holdings</span><Link href="/trade/spot/NVDAB" className="text-xs text-accent">Trade →</Link></div>
          <table className="w-full"><thead><tr>{['Asset', 'Qty', 'Price', 'Value', '24h', 'Collateral'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
            {p.stocks.map((s) => <tr key={s.symbol}><td className="td">{s.symbol}</td><td className="td">{fmtNum(s.qty, 4)}</td><td className="td">{fmtNum(s.price)}</td><td className="td">{fmtUsd(s.value)}</td>
              <td className={clsx('td', (s.changePct ?? 0) >= 0 ? 'text-up' : 'text-down')}>{fmtPct(s.changePct)}</td><td className="td text-accent">{fmtUsd(s.collateral)}</td></tr>)}
            {!p.stocks.length && <tr><td colSpan={6} className="td text-muted">No bStocks held yet.</td></tr>}
          </tbody></table>
        </div>
        <div className="panel p-4">
          <div className="mb-2 font-medium">Derivatives positions</div>
          <table className="w-full"><thead><tr>{['Venue', 'Market', 'Side', 'Size', 'Value', 'uPnL'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
            {allPositions.map((x) => <tr key={x.venue + x.name}><td className="td text-muted">{x.venue}</td><td className="td">{x.name}</td><td className={clsx('td', x.side === 'Long' ? 'text-up' : 'text-down')}>{x.side}</td>
              <td className="td">{x.size}</td><td className="td">{fmtUsd(x.value)}</td><td className={clsx('td', x.pnl >= 0 ? 'text-up' : 'text-down')}>{fmtUsd(x.pnl)}</td></tr>)}
            {!allPositions.length && <tr><td colSpan={6} className="td text-muted">No open perps or options.</td></tr>}
          </tbody></table>
        </div>
      </div>

      <div className="panel p-4">
        <div className="mb-2 flex items-center justify-between"><span className="font-medium">Activity</span><span className="text-xs text-muted">Past orders on perps, options and bStocks, newest first</span></div>
        <OrderHistory venues={['aster', 'derive', 'bstocks']} limit={25} showVenue />
      </div>
    </div>
  );
}

function AgentBadge({ ok }: { ok: boolean }) {
  return <Link href="/agents" className={clsx('mt-3 flex items-center gap-1.5 text-xs', ok ? 'text-up' : 'text-muted')}><Bot size={13} />{ok ? 'Agent key active' : 'No agent key'}</Link>;
}
