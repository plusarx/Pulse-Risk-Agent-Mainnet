'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ShieldCheck } from 'lucide-react';
import { Switch } from '@/components/risk/ZoneBar';
import { useIntegrity } from '@/lib/hooks/useIntegrity';
import { INTEGRITY_LIMITS, type Assessment, type Verdict } from '@/lib/integrity';
import { venueWords } from '@/lib/venue-words';
import { fmtNum, fmtUsd } from '@/lib/format';

const BADGE: Record<Verdict, { label: string; cls: string; dot: string }> = {
  ok: { label: 'OK', cls: 'border-up/50 text-up', dot: 'bg-up' },
  watch: { label: 'WATCH', cls: 'border-accent/60 text-accent', dot: 'bg-accent' },
  block: { label: 'BLOCKED', cls: 'border-down/60 text-down', dot: 'bg-down' },
  unavailable: { label: 'N/A', cls: 'border-line text-muted', dot: 'bg-muted' },
};
const pct0 = (x: number) => `${Math.round(x * 100)}%`;
const gapPct = (a: Assessment) => { const g = [a.gaps.atlas, a.gaps.dex, a.gaps.reference].filter((x): x is number => x !== null); return g.length ? `${(Math.max(...g) * 100).toFixed(2)}%` : '—'; };

export function VerdictBadge({ v }: { v: Verdict }) {
  const b = BADGE[v];
  return <span className={clsx('inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider', b.cls)}>{b.label}</span>;
}

/** Compact: one dot + haircut per bStock. */
export function IntegrityDots({ items }: { items: Assessment[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted">
      {items.map((a) => (
        <span key={a.symbol} title={`${a.symbol}: ${a.reasons[0] ? venueWords(a.reasons[0]) : 'sources agree'}`} className="inline-flex items-center gap-1">
          <span className={clsx('h-2 w-2 rounded-full', BADGE[a.verdict].dot)} />{a.symbol}{a.verdict === 'unavailable' ? '' : ` ${pct0(a.haircut)}`}
        </span>
      ))}
    </div>
  );
}

/**
 * Price integrity for bStock collateral. The switch persists config.integrity.enabled; while it is off the hook does
 * not call the route, so this panel only shows the "off" state and makes no price requests.
 */
export function PriceIntegrity({ enabled, onToggle }: { enabled: boolean; onToggle: (next: boolean) => Promise<string | null> }) {
  const d = useIntegrity();
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1_000); return () => clearInterval(t); }, []);
  const flip = async (next: boolean) => {
    if (!next && !window.confirm('Back to the flat haircut; no price checks. Turn price integrity off?')) return;
    setErr(null); const e = await onToggle(next); if (e) setErr(e);
  };
  const ago = d.at ? Math.max(0, Math.round((Date.now() - d.at) / 1000)) : null;
  const L = INTEGRITY_LIMITS;

  return (
    <section className="panel p-4" data-title="price integrity">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck size={18} className="text-accent" />
          <div>
            <div className="font-mono text-xs font-semibold uppercase tracking-wider">Price integrity</div>
            <div className="text-[11px] text-muted">
              {enabled
                ? <>Each bStock&apos;s price is checked against Atlas, CoinMarketCap and the stock&apos;s perp. A disagreement raises the haircut (never lowers it); a bad price pauses hedges and top-ups on that token.{ago !== null && <> Last checked {ago}s ago.</>}</>
                : 'Price integrity is off: collateral uses your flat haircut and no price checks are made.'}
            </div>
            {err && <div className="text-[11px] text-down">{err}</div>}
          </div>
        </div>
        <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-muted">
          {enabled ? 'Enabled' : 'Disabled'}
          <Switch checked={enabled} onChange={(v) => void flip(v)} label="Price integrity" />
        </label>
      </div>

      {enabled && d.problems.length > 0 && (
        <div className="mt-3 rounded border border-accent/40 bg-accent/5 px-3 py-2 text-[11px] text-accent">{d.problems.map((p) => venueWords(p)).join(' · ')}</div>
      )}

      {enabled && (
        <div className="mt-3 overflow-x-auto">
          {d.items.length === 0
            ? <div className="py-3 text-xs text-muted">{d.isLoading ? 'Checking prices…' : 'No price data yet.'}</div>
            : (
              <table className="w-full min-w-[860px]">
                <thead><tr>{['Token', 'Verdict', 'Atlas', 'CoinMarketCap', 'Perp', 'Biggest gap', 'Haircut', 'Why'].map((h) => <th key={h} className="th font-mono uppercase">{h}</th>)}</tr></thead>
                <tbody>
                  {d.items.map((a) => {
                    const add = Math.round((a.haircut - a.baseHaircut) * 100);
                    return (
                      <tr key={a.symbol} className="border-t border-line/50 align-top">
                        <td className="td font-medium">{a.symbol}</td>
                        <td className="td"><VerdictBadge v={a.verdict} /></td>
                        <td className="td num">{a.atlas ? <>{fmtNum(a.atlas.price)}<div className={clsx('text-[10px]', a.atlas.ageSec > L.atlasMaxAgeSec ? 'text-down' : 'text-muted')}>{(a.atlas.status ?? '').toLowerCase() || 'n/a'}{a.atlas.score !== null ? ` ${a.atlas.score.toFixed(2)}` : ''} · {Math.round(a.atlas.ageSec)}s</div></> : <span className="text-muted">—</span>}</td>
                        <td className="td num">{a.dex ? <>{fmtNum(a.dex.price)}<div className={clsx('text-[10px]', a.dex.liquidityUsd < L.liquidityBlockUsd ? 'text-down' : 'text-muted')}>pool {fmtUsd(a.dex.liquidityUsd, 0)}</div></> : <span className="text-muted">—</span>}</td>
                        <td className="td num">{a.perp ? fmtNum(a.perp) : <span className="text-muted">—</span>}</td>
                        <td className="td num">{gapPct(a)}</td>
                        <td className="td num">{a.verdict === 'unavailable' ? <span className="text-muted">{pct0(a.baseHaircut)}</span> : <>{pct0(a.haircut)}{add > 0 && <div className="text-[10px] text-accent">+{add} pts</div>}</>}</td>
                        <td className="td text-[11px] text-muted">{a.reasons[0] ? venueWords(a.reasons[0]) : 'Sources agree'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
      )}
    </section>
  );
}
