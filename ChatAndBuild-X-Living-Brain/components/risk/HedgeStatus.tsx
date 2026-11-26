'use client';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Eye, EyeOff, OctagonX, Radar } from 'lucide-react';
import { getJson } from '@/lib/hooks/useVenues';
import { useSession } from '@/lib/session';
import { useVenueNetwork } from '@/lib/network';
import type { StatusIn } from '@/lib/agent-status';

const STALE_MS = 3 * 60_000;
const BUCKET_STYLE = { direct: 'bg-up/15 text-up', proxy: 'bg-accent/15 text-accent', none: 'bg-down/15 text-down' } as const;
const SENT_STYLE = { positive: 'bg-up/15 text-up', negative: 'bg-down/15 text-down', neutral: 'bg-panel2 text-muted' } as const;

const pct = (n: number, d = 1) => `${n.toFixed(d)}%`;
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60); if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60); return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
function left(ms: number): string {
  if (ms <= 0) return 'expired';
  const m = Math.round(ms / 60_000); if (m < 90) return `${m} min left`;
  const h = Math.round(m / 60); return h < 48 ? `${h}h left` : `${Math.round(h / 24)}d left`;
}

function Bar({ label, value, max, text, warn }: { label: string; value: number; max: number; text: string; warn?: boolean }) {
  const f = max > 0 ? Math.min(1, value / max) : value > 0 ? 1 : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="text-muted">{label}</span><span className="num">{text}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line"><div className={clsx('h-full rounded-full', warn || f >= 0.9 ? 'bg-down' : f >= 0.7 ? 'bg-accent' : 'bg-up')} style={{ width: `${f * 100}%` }} /></div>
    </div>
  );
}

/** Always-visible agent status: mode, kill switch, hedge coverage, VaR against the user's limit, limits used, what it can and cannot see. */
export function HedgeStatus({ onKillSwitch }: { onKillSwitch: (next: boolean) => void }) {
  const { wallet } = useSession();
  const { network } = useVenueNetwork();
  const q = useQuery({ queryKey: ['agent-status', network, wallet], enabled: !!wallet, refetchInterval: 5_000,
    queryFn: () => getJson<{ status: StatusIn | null; updated_at: number | null }>(`/api/agent/status?network=${network}`) });
  const s = q.data?.status ?? null;

  if (!s) {
    return (
      <section className="panel p-5">
        <div className="flex items-center gap-2 font-semibold"><Radar size={17} className="text-accent" />Agent status</div>
        <p className="mt-2 text-sm text-muted">{q.isLoading ? 'Loading…' : 'The agent has not reported yet. Its status appears here as soon as it runs its first check.'}</p>
      </section>
    );
  }

  const now = Date.now();
  const taken = new Date(s.takenAt).getTime();
  const stale = now - taken > STALE_MS;
  const u = s.limitsUsed;
  const autonomyLeft = u.autonomyExpiresAt ? new Date(u.autonomyExpiresAt).getTime() - now : null;
  const varOver = s.varPct > s.limitPct;
  const varMax = Math.max(s.varPct, s.limitPct, 0.1) * 1.15;
  const cov = s.coverage;
  const ev = s.nextEvent;
  const scanAgo = s.lastNewsScanAt ? ago(now - new Date(s.lastNewsScanAt).getTime()) : null;
  const evHedged = ev ? s.tickers.find((t) => t.ticker === ev.ticker)?.hedgedPct ?? 0 : 0;
  const evLine = !ev ? 'No known events ahead.'
    : evHedged >= 99.5 ? `${ev.ticker} is fully hedged through its ${ev.kind} in ${Math.round(ev.inHours)}h.`
    : evHedged > 0 ? `${ev.ticker} is ${Math.round(evHedged)}% hedged ahead of its ${ev.kind} in ${Math.round(ev.inHours)}h.`
    : `${ev.ticker} ${ev.kind} in ${Math.round(ev.inHours)}h: not hedged yet.`;
  const coverageLine = `${evLine} ${scanAgo ? `Last news scan ${scanAgo}.` : 'No news scan yet.'}`;

  return (
    <section className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2 font-semibold"><Radar size={17} className="text-accent" />Agent status
            <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-medium', s.mode === 'autonomous' ? 'bg-accent/15 text-accent' : 'bg-panel2 text-muted')}>{s.mode === 'autonomous' ? 'Autonomous' : 'Asks first'}</span></div>
          {s.modeNote && <p className="mt-0.5 text-[11px] text-muted">{s.modeNote}</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className={clsx('text-[11px]', stale ? 'text-down' : 'text-muted')}>Updated {ago(now - taken)}</span>
          <button type="button" onClick={() => onKillSwitch(!s.killSwitch)}
            className={clsx('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold', s.killSwitch ? 'bg-down text-white' : 'border border-down/60 text-down hover:bg-down/10')}>
            <OctagonX size={15} />Kill switch{s.killSwitch ? ': ARMED' : ''}
          </button>
        </div>
      </div>

      {stale && <div className="flex items-center gap-2 rounded-xl border border-down/40 bg-down/10 p-3 text-sm text-down"><AlertTriangle size={15} />Status is more than 3 minutes old. The agent may be down, so treat these numbers as out of date.</div>}
      {(s.paused || s.alerts.length > 0) && (
        <div className={clsx('space-y-1 rounded-xl border p-3 text-sm', s.paused ? 'border-down/40 bg-down/10 text-down' : 'border-accent/40 bg-accent/10 text-accent')}>
          {s.paused && <div className="flex items-start gap-2 font-medium"><AlertTriangle size={15} className="mt-0.5 shrink-0" />Agent paused: {s.paused.reason}</div>}
          {s.alerts.map((a, i) => <div key={i} className="flex items-start gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{a}</div>)}
          {s.requiredHedgePct > s.hedgedPct && <div className="text-xs">Unhedged exposure: {pct(s.requiredHedgePct - s.hedgedPct)} of {usd(s.portfolioUsd)} is not covered.</div>}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div><div className="label">Portfolio</div><div className="num text-xl font-semibold">{usd(s.portfolioUsd)}</div></div>
        <div><div className="label">Hedged vs required</div><div className="num text-xl font-semibold">{pct(s.hedgedPct, 0)} <span className="text-sm font-normal text-muted">of {pct(s.requiredHedgePct, 0)}</span></div></div>
        <div>
          <Bar label={`Event VaR ${pct(s.varPct)} / Your limit ${pct(s.limitPct)} (${s.window})`} value={s.varPct} max={varMax} text={varOver ? 'over limit' : 'within limit'} warn={varOver} />
          <div className="relative -mt-1.5 h-0"><div className="absolute top-[-2px] h-2.5 w-0.5 bg-white/70" style={{ left: `${(s.limitPct / varMax) * 100}%` }} title="Your limit" /></div>
        </div>
      </div>

      <p className="text-sm">{coverageLine}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="label mb-1">Coverage now</div>
          <div className="flex gap-2 text-xs">
            <span className={clsx('rounded-md px-2 py-0.5', BUCKET_STYLE.direct)}>direct {pct(cov.directPct, 0)}</span>
            <span className={clsx('rounded-md px-2 py-0.5', BUCKET_STYLE.proxy)}>proxy {pct(cov.proxyPct, 0)}</span>
            <span className={clsx('rounded-md px-2 py-0.5', BUCKET_STYLE.none)}>none {pct(cov.nonePct, 0)}</span>
          </div>
          {s.tickers.length > 0 && (
            <table className="mt-2 w-full text-xs">
              <thead><tr className="text-left text-muted"><th className="py-1 font-normal">Ticker</th><th className="font-normal">USD</th><th className="font-normal">Hedged</th><th className="font-normal">Cover</th></tr></thead>
              <tbody>{s.tickers.map((t) => (
                <tr key={t.bstock} className="border-t border-line/60">
                  <td className="py-1">{t.ticker}</td><td className="num">{usd(t.usd)}</td><td className="num">{pct(t.hedgedPct, 0)}</td>
                  <td><span className={clsx('rounded-md px-1.5 py-0.5', BUCKET_STYLE[t.bucket])}>{t.bucket}</span>{t.excluded && <span className="ml-1 rounded-md bg-panel2 px-1.5 py-0.5 text-muted">excluded</span>}</td>
                </tr>))}</tbody>
            </table>
          )}
        </div>

        <div className="space-y-2">
          <div className="label">Limits used today</div>
          <Bar label="Notional today" value={u.notionalTodayUsd} max={u.maxNotionalPerDayUsd} text={`${usd(u.notionalTodayUsd)} / ${usd(u.maxNotionalPerDayUsd)}`} />
          <Bar label="Loss today" value={u.lossTodayUsd} max={u.dailyLossCapUsd} text={`${usd(u.lossTodayUsd)} / ${usd(u.dailyLossCapUsd)}`} />
          <Bar label="Capital off BNB" value={u.capitalOffBnbUsd} max={u.maxCapitalOffBnbUsd} text={`${usd(u.capitalOffBnbUsd)} / ${usd(u.maxCapitalOffBnbUsd)}`} />
          <div className="flex justify-between text-xs"><span className="text-muted">Autonomy</span>
            <span className="num">{autonomyLeft === null ? (s.mode === 'autonomous' ? 'no expiry set' : 'off') : left(autonomyLeft)}</span></div>
        </div>
      </div>

      <div>
        <div className="label mb-1">News flags</div>
        {s.newsFlags.length === 0 ? <p className="text-xs text-muted">No flags.</p> : (
          <div className="space-y-1.5">{s.newsFlags.map((f, i) => (
            <div key={i} className="rounded-lg bg-bg p-2 text-xs">
              <div className="flex flex-wrap items-center gap-2"><b>{f.ticker}</b>
                <span className={clsx('rounded-md px-1.5 py-0.5', SENT_STYLE[f.sentiment])}>{f.sentiment}</span>
                <span className="num text-muted">score {f.score.toFixed(2)}</span></div>
              <div className="mt-0.5">{f.reason}</div>
              {f.headline && <div className="text-muted">{f.headline}</div>}
            </div>))}</div>
        )}
        <p className="mt-1.5 text-[11px] text-muted">Advisory only. News never changes a position.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div><div className="label mb-1 flex items-center gap-1"><Eye size={12} />What the agent watches</div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">{s.monitored.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
        <div><div className="label mb-1 flex items-center gap-1"><EyeOff size={12} />What it cannot see</div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">{s.notMonitored.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
      </div>
    </section>
  );
}
