'use client';
import { fmtNum, priceDecimals } from '@/lib/format';

export type Level = [number, number];

export function OrderBook({ bids, asks, last, baseLabel, quoteLabel = 'USD', rows = 11, note }: {
  bids: Level[]; asks: Level[]; last?: number | null; baseLabel: string; quoteLabel?: string; rows?: number; note?: string;
}) {
  const a = [...asks].sort((x, y) => x[0] - y[0]).slice(0, rows);
  const b = [...bids].sort((x, y) => y[0] - x[0]).slice(0, rows);
  const cum = (lv: Level[]) => { let s = 0; return lv.map(([p, q]) => { s += q; return [p, q, s] as const; }); };
  const ac = cum(a).reverse(); const bc = cum(b);
  const max = Math.max(ac[0]?.[2] ?? 0, bc[bc.length - 1]?.[2] ?? 0, 1e-12);
  const ref = last ?? b[0]?.[0] ?? a[0]?.[0] ?? 1;
  const dp = priceDecimals(ref);
  const bidTot = b.reduce((s, l) => s + l[1], 0); const askTot = a.reduce((s, l) => s + l[1], 0);
  const bidPct = bidTot + askTot > 0 ? Math.round((bidTot / (bidTot + askTot)) * 100) : 50;
  const row = (p: number, q: number, c: number, side: 'b' | 'a') => (
    <div key={`${side}${p}`} className="relative grid grid-cols-3 px-3 py-[3px] text-[13px] num">
      <div className={side === 'a' ? 'absolute inset-y-0 right-0 bg-down/15' : 'absolute inset-y-0 right-0 bg-up/15'} style={{ width: `${(c / max) * 100}%` }} />
      <span className={side === 'a' ? 'text-down relative' : 'text-up relative'}>{fmtNum(p, dp)}</span>
      <span className="relative text-right">{fmtNum(q, 4)}</span>
      <span className="relative text-right text-[#c9ccd6]">{fmtNum(c, 4)}</span>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="grid grid-cols-3 px-3 pb-1 text-xs text-muted"><span>Price ({quoteLabel})</span><span className="text-right">Size ({baseLabel})</span><span className="text-right">Total ({baseLabel})</span></div>
      {/* Asks anchor to the spread (bottom), bids to the top; each half clips its far end. */}
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">{ac.map(([p, q, c]) => row(p, q, c, 'a'))}</div>
      <div className="shrink-0 border-y border-line/60 px-3 py-1.5 text-lg font-semibold text-up num">{last ? fmtNum(last, dp) : '—'}</div>
      <div className="min-h-0 flex-1 overflow-hidden">{bc.map(([p, q, c]) => row(p, q, c, 'b'))}</div>
      <div className="mx-3 mt-2 flex h-6 shrink-0 overflow-hidden rounded-md text-xs num">
        <div className="flex items-center bg-up/25 pl-2 text-up" style={{ width: `${bidPct}%` }}>{bidPct}%</div>
        <div className="flex flex-1 items-center justify-end bg-down/25 pr-2 text-down">{100 - bidPct}%</div>
      </div>
      {note && <p className="shrink-0 px-3 pt-2 text-[11px] text-muted">{note}</p>}
    </div>
  );
}

export function TradesList({ trades }: { trades: { id: number | string; price: number; size: number; time: number; side: 'buy' | 'sell' }[] }) {
  const dp = priceDecimals(trades[0]?.price ?? 1);
  return (
    <div className="h-full min-h-0 overflow-auto">
      <div className="sticky top-0 grid grid-cols-3 bg-panel px-3 pb-1 text-xs text-muted"><span>Price</span><span className="text-right">Size</span><span className="text-right">Time</span></div>
      {trades.map((t) => (
        <div key={t.id} className="grid grid-cols-3 px-3 py-[3px] text-[13px] num">
          <span className={t.side === 'buy' ? 'text-up' : 'text-down'}>{fmtNum(t.price, dp)}</span>
          <span className="text-right">{fmtNum(t.size, 4)}</span>
          <span className="text-right text-muted">{new Date(t.time).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  );
}
