/** Mirrors agent/src/risk/payoff.ts Payoff (sent as JSON by the chat service). */
export interface PayoffData { ticker: string; holdingUsd: number; hedgeLabel: string; costUsd: number; points: { movePct: number; beforeUsd: number; afterUsd: number }[]; note: string }

const W = 360, H = 170, L = 44, R = 10, T = 12, B = 28;
const money = (x: number) => `${x < 0 ? '-' : ''}$${Math.abs(x) >= 100 ? Math.round(Math.abs(x)) : Math.abs(x).toFixed(2)}`;

/**
 * Profit and loss on the hedged name across price moves: BEFORE the agent's recommendation (the holding alone, dashed)
 * and AFTER it (holding + hedge, net of cost). Values come from the agent's payoff model; nothing is computed here.
 */
export function PayoffChart({ p }: { p: PayoffData }) {
  const pts = p.points; if (pts.length < 2) return null;
  const xs = pts.map((x) => x.movePct); const ys = pts.flatMap((x) => [x.beforeUsd, x.afterUsd, 0]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs); let y0 = Math.min(...ys), y1 = Math.max(...ys); if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
  const X = (m: number) => L + ((m - x0) / (x1 - x0)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const line = (k: 'beforeUsd' | 'afterUsd') => pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.movePct).toFixed(1)},${Y(q[k]).toFixed(1)}`).join(' ');
  const yTicks = [y0 + pad, 0, y1 - pad].filter((v, i, a) => a.findIndex((w) => Math.abs(w - v) < (y1 - y0) * 0.1) === i);
  const at = (m: number) => pts.find((q) => q.movePct === m);
  const down = at(-20), up = at(20), flat = at(0);
  return (
    <div className="space-y-1.5 rounded-lg border border-line bg-bg p-2">
      <div className="flex items-center justify-between text-[11px]"><span className="font-semibold">Payoff before and after · {p.ticker}</span><span className="text-muted">holding {money(p.holdingUsd)}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Profit and loss of ${p.ticker} before and after the hedge`}>
        {yTicks.map((v) => <g key={v}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="currentColor" className={v === 0 ? 'text-muted' : 'text-line'} strokeWidth={v === 0 ? 1 : 0.5} /><text x={L - 4} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="currentColor" className="text-muted">{money(v)}</text></g>)}
        {[x0, -10, 0, 10, x1].filter((v, i, a) => a.indexOf(v) === i && v >= x0 && v <= x1).map((m) => <text key={m} x={X(m)} y={H - 10} textAnchor="middle" fontSize="9" fill="currentColor" className="text-muted">{m > 0 ? `+${m}` : m}%</text>)}
        <path d={line('beforeUsd')} fill="none" stroke="currentColor" className="text-muted" strokeWidth={1.5} strokeDasharray="4 3" />
        <path d={line('afterUsd')} fill="none" stroke="currentColor" className="text-accent" strokeWidth={2} />
        {pts.map((q) => <circle key={q.movePct} cx={X(q.movePct)} cy={Y(q.afterUsd)} r={1.8} fill="currentColor" className="text-accent"><title>{`${q.movePct}%: before ${money(q.beforeUsd)}, after ${money(q.afterUsd)}`}</title></circle>)}
        <text x={W - R} y={H - 1} textAnchor="end" fontSize="9" fill="currentColor" className="text-muted">{p.ticker} price move</text>
      </svg>
      <div className="flex flex-wrap gap-x-3 text-[10px]"><span className="text-muted">- - before (no hedge)</span><span className="text-accent">── after: {p.hedgeLabel}</span></div>
      {down && up && flat && (
        <table className="w-full text-[10px]"><thead><tr className="text-muted"><th className="text-left font-normal">Move</th><th className="text-right font-normal">Before</th><th className="text-right font-normal">After</th></tr></thead>
          <tbody>{[down, flat, up].map((q) => <tr key={q.movePct}><td>{q.movePct > 0 ? '+' : ''}{q.movePct}%</td><td className="text-right">{money(q.beforeUsd)}</td><td className="text-right">{money(q.afterUsd)}</td></tr>)}</tbody></table>
      )}
      <p className="text-[10px] text-muted">{p.note}</p>
    </div>
  );
}
