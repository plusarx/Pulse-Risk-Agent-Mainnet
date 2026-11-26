'use client';
import { LogoMark } from '@/components/Logo';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { Home, CandlestickChart, Bot, ArrowLeftRight, BookOpen, Layers, Search, Scale } from 'lucide-react';
import clsx from 'clsx';
import { ConnectButton } from './ConnectButton';
import { ChatWidget } from '@/components/agent/ChatWidget';
import { useVenueNetwork } from '@/lib/network';
import { BSTOCKS_BSC } from '@/lib/bstocks';

type Item = { href: string; label: string; sub?: string; match: string };
const TRADE: Item[] = [
  { href: '/trade/spot/NVDAB', label: 'Spot', sub: 'bStocks · BNB', match: '/trade/spot' },
  { href: '/trade/perps', label: 'Perps', match: '/trade/perps' },
  { href: '/trade/options', label: 'Options', match: '/trade/options' },
];
const AGENT: Item[] = [
  { href: '/agents', label: 'Agent keys', match: '/agents' },
  { href: '/automation', label: 'Risk management', match: '/automation' },
];

function NavLink({ href, active, icon, children }: { href: string; active: boolean; icon?: ReactNode; children: ReactNode }) {
  return (
    <Link href={href} className={clsx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors',
      active ? 'border border-accent/50 bg-accent/[0.07] text-white shadow-[inset_3px_0_0_#f0b90b]' : 'border border-transparent text-[#c9ccd6] hover:border-line hover:text-white')}>
      {icon}{children}
    </Link>
  );
}

function MarketSearch() {
  const [q, setQ] = useState('');
  const router = useRouter();
  const results = useMemo(() => {
    const t = q.trim().toUpperCase();
    if (!t) return [];
    return BSTOCKS_BSC.filter((s) => s.symbol.includes(t) || s.displayName.toUpperCase().includes(t)).slice(0, 8);
  }, [q]);
  return (
    <div className="relative w-full max-w-xl">
      <div className="flex items-center gap-3 rounded-full bg-panel border border-line px-4 py-2.5 sm:px-5">
        <Search size={18} className="text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bStocks, perps, options…"
          className="w-full min-w-0 bg-transparent outline-none text-sm placeholder:text-muted" />
      </div>
      {results.length > 0 && (
        <div className="absolute z-50 mt-2 w-full panel p-1 shadow-xl">
          {results.map((r) => (
            <button key={r.symbol} className="flex w-full items-center justify-between rounded-lg px-4 py-2 text-sm hover:bg-panel2"
              onClick={() => { router.push(`/trade/spot/${r.symbol}`); setQ(''); }}>
              <span>{r.symbol} <span className="text-muted">· {r.displayName}</span></span>
              <span className="text-xs text-muted">bStock spot</span>
            </button>
          ))}
          <button className="w-full rounded-lg px-4 py-2 text-left text-sm text-muted hover:bg-panel2"
            onClick={() => { router.push(`/trade/perps?q=${encodeURIComponent(q)}`); setQ(''); }}>Search “{q}” in perps →</button>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { network, setNetwork } = useVenueNetwork();
  return (
    <div className="flex min-h-screen">
      <aside className="hidden lg:flex w-60 shrink-0 flex-col gap-1 border-r border-line/60 bg-[#06080b]/80 px-4 py-5 sticky top-0 h-screen backdrop-blur">
        <Link href="/" className="mb-6 flex items-center gap-2 px-2 text-xl font-semibold">
          <LogoMark size={32} />
          <span className="whitespace-nowrap">Pulse Risk</span> <span className="text-accent text-sm font-medium">BNB</span>
        </Link>
        <NavLink href="/" active={path === '/'} icon={<Home size={18} />}>Portfolio</NavLink>
        <div className="mt-1 flex items-center gap-3 px-3 py-2.5 text-[15px] text-white"><CandlestickChart size={18} />Trade</div>
        <div className="ml-5 border-l border-line pl-2 flex flex-col gap-0.5">
          {TRADE.map((i) => (
            <Link key={i.href} href={i.href} className={clsx('rounded-xl px-3 py-2', path.startsWith(i.match) ? 'border border-accent/50 bg-accent/[0.07] text-white shadow-[inset_3px_0_0_#f0b90b]' : 'border border-transparent text-[#c9ccd6] hover:border-line hover:text-white')}>
              <div className="text-[15px]">{i.label}</div>
              {i.sub && <div className="text-[11px] text-muted">{i.sub}</div>}
            </Link>
          ))}
        </div>
        <NavLink href="/funding" active={path.startsWith('/funding')} icon={<ArrowLeftRight size={18} />}>Deposit & bridge</NavLink>
        <div className="mt-1 flex items-center gap-3 px-3 py-2.5 text-[15px] text-white"><Bot size={18} />Agent</div>
        <div className="ml-5 border-l border-line pl-2 flex flex-col gap-0.5">
          {AGENT.map((i) => (
            <Link key={i.href} href={i.href} className={clsx('rounded-xl px-3 py-2 text-[15px]', path.startsWith(i.match) ? 'border border-accent/50 bg-accent/[0.07] text-white shadow-[inset_3px_0_0_#f0b90b]' : 'border border-transparent text-[#c9ccd6] hover:border-line hover:text-white')}>{i.label}</Link>
          ))}
        </div>
        <NavLink href="/collateral" active={path.startsWith('/collateral')} icon={<Scale size={18} />}>Collateral</NavLink>
        <NavLink href="/docs" active={path.startsWith('/docs')} icon={<BookOpen size={18} />}>Endpoints</NavLink>
        <div className="mt-auto rounded-xl bg-panel p-3 text-xs text-muted">
          <div className="mb-2 flex items-center gap-2 text-white"><Layers size={14} />Venue network</div>
          <div className="flex rounded-full bg-panel2 p-1">
            {(['mainnet', 'testnet'] as const).map((n) => (
              <button key={n} onClick={() => setNetwork(n)} className={clsx('flex-1 rounded-full py-1 capitalize', network === n ? 'bg-white text-black' : 'text-muted')}>{n}</button>
            ))}
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex items-center gap-2 bg-bg/90 px-3 py-3 backdrop-blur sm:gap-4 sm:px-6 sm:py-4">
          <div className="flex min-w-0 flex-1 justify-center"><MarketSearch /></div>
          {network === 'testnet' && <span className="pill bg-accent/15 text-accent text-xs">Venues: testnet</span>}
          <ConnectButton />
        </header>
        <main className="flex-1 px-4 pb-10 lg:px-6">{children}</main>
        <ChatWidget />
      </div>
    </div>
  );
}
