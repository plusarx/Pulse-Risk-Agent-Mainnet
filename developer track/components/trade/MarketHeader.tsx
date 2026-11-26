'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { fmtNum, fmtPct, priceDecimals } from '@/lib/format';

export interface MarketRow { key: string; label: string; sub?: string; price?: number | null; changePct?: number | null; badge?: string; disabled?: boolean }

export function MarketHeader({ icon, title, badge, price, changePct, change, stats, markets, onSelect }: {
  icon?: ReactNode; title: string; badge?: string; price?: number | null; change?: number | null; changePct?: number | null;
  stats: { label: string; value: string }[]; markets: MarketRow[]; onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const dp = priceDecimals(price ?? 1);
  const list = markets.filter((m) => !q || (m.label + (m.sub ?? '')).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="panel relative flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-4" ref={ref}>
      <button className="flex items-center gap-3" onClick={() => setOpen((o) => !o)}>
        {icon}
        <span className="text-lg font-medium">{title}</span>
        {badge && <span className="rounded-md bg-panel2 px-2 py-0.5 text-xs text-[#c9ccd6]">{badge}</span>}
        <ChevronDown size={18} className="text-muted" />
      </button>
      <span className={clsx('text-xl font-semibold num', (changePct ?? 0) >= 0 ? 'text-up' : 'text-down')}>{price ? fmtNum(price, dp) : '—'}</span>
      <div><div className="label">24H Change</div><div className={clsx('text-sm num', (changePct ?? 0) >= 0 ? 'text-up' : 'text-down')}>{change != null ? `${change >= 0 ? '+' : ''}${fmtNum(change, dp)} ` : ''}{fmtPct(changePct)}</div></div>
      {stats.map((s) => <div key={s.label}><div className="label">{s.label}</div><div className="text-sm num">{s.value}</div></div>)}
      {open && (
        <div className="absolute left-3 top-16 z-50 w-[420px] max-h-[460px] overflow-auto panel p-2 shadow-2xl">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="input mb-2 py-2 text-sm" />
          {list.map((m) => (
            <button key={m.key} disabled={m.disabled} onClick={() => { onSelect(m.key); setOpen(false); }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-panel2 disabled:opacity-40">
              <span className="text-left">{m.label} {m.sub && <span className="text-muted">· {m.sub}</span>} {m.badge && <span className="ml-1 rounded bg-panel2 px-1.5 text-[10px] text-muted">{m.badge}</span>}</span>
              <span className="num text-right">{m.price ? fmtNum(m.price, priceDecimals(m.price)) : ''} <span className={(m.changePct ?? 0) >= 0 ? 'text-up' : 'text-down'}>{m.changePct != null ? fmtPct(m.changePct) : ''}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, size = 'md' }: { tabs: readonly { id: T; label: string }[]; value: T; onChange: (t: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className="flex gap-1">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={clsx('rounded-full border border-transparent transition-colors', size === 'sm' ? 'px-3 py-1 text-sm' : 'px-4 py-1.5 text-[15px]', value === t.id ? 'border border-accent/60 bg-accent/[0.07] text-white' : 'text-muted hover:text-white')}>{t.label}</button>
      ))}
    </div>
  );
}
