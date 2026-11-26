'use client';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Activity } from 'lucide-react';
import { getJson } from '@/lib/hooks/useVenues';
import { useSession } from '@/lib/session';
import { useVenueNetwork } from '@/lib/network';
import type { StatusIn } from '@/lib/agent-status';

const usd = (n: number | null) => (n === null ? '-' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const ago = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)}h ago`; };
const TONE: Record<string, string> = { awaiting: 'border-accent/40', done: 'border-up/40', simulated: 'border-line', failed: 'border-down/40', vetoed: 'border-down/40', error: 'border-down/40' };

/** The agent's latest check (it runs every ~30 s on live data): what it decided, what happens next in the current mode, and the numbers it read. */
export function LatestRun() {
  const { wallet } = useSession();
  const { network } = useVenueNetwork();
  const q = useQuery({ queryKey: ['agent-status', network, wallet], enabled: !!wallet, refetchInterval: 5_000,
    queryFn: () => getJson<{ status: StatusIn | null; updated_at: number | null }>(`/api/agent/status?network=${network}`) });
  const s = q.data?.status ?? null; const r = s?.lastRun ?? null;
  if (!r) return <section className="panel p-5"><div className="flex items-center gap-2 font-semibold"><Activity size={17} className="text-accent" />Latest agent run</div><p className="mt-2 text-sm text-muted">No run reported yet. The agent checks every 30 seconds and the result shows here.</p></section>;
  const f = r.feed; const age = Date.now() - new Date(r.at).getTime();
  return (
    <section className={clsx('panel space-y-3 border p-5', TONE[r.outcome] ?? 'border-line')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold"><Activity size={17} className="text-accent" />Latest agent run
          <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-medium', r.live ? 'bg-up/15 text-up' : 'bg-panel2 text-muted')}>{r.live ? 'live' : 'dry run'}</span>
          <span className="rounded-md bg-panel2 px-2 py-0.5 text-[11px] font-medium text-muted">{s?.mode === 'autonomous' ? 'Autonomous' : 'Ask me first'}</span></div>
        <div className={clsx('text-xs', age > 120_000 ? 'text-down' : 'text-muted')}>{ago(age)}{age > 120_000 ? ' (the agent may be stopped)' : ''}</div>
      </div>
      <div><div className="label mb-1">Decision</div><div className="text-lg font-semibold">{r.decision}</div><p className="mt-1 text-sm text-muted">{r.next}</p></div>
      {r.why && <div className="text-sm"><div className="label mb-1">Why</div><p>{r.why}</p></div>}
      {r.candidates.length > 0 && <div className="text-sm"><div className="label mb-1">Actions it queued</div><ol className="list-decimal pl-5">{r.candidates.map((c) => <li key={c}>{c}</li>)}</ol></div>}
      {r.reasons.length > 0 && <div className="text-sm"><div className="label mb-1">Notes</div><ul className="list-disc pl-5 text-muted">{r.reasons.map((c) => <li key={c}>{c}</li>)}</ul></div>}
      {(r.analyst || r.decider || r.reviewer) && <div className="space-y-1 text-sm"><div className="label">Analyst, decider, reviewer</div>
        {r.analyst && <p><span className="text-muted">Analyst: </span>{r.analyst}</p>}{r.decider && <p><span className="text-muted">Decider: </span>{r.decider}</p>}{r.reviewer && <p><span className="text-muted">Reviewer: </span>{r.reviewer}</p>}</div>}
      <details className="text-sm"><summary className="cursor-pointer text-muted">Live data this run used</summary>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          <div>BNB USDC: <span className="num">{usd(f.bnbUsdc)}</span> · USDT: <span className="num">{usd(f.bnbUsdt)}</span></div>
          <div>Perps equity: <span className="num">{usd(f.lighterEquityUsd)}</span> · free: <span className="num">{usd(f.lighterFreeUsd)}</span></div>
          <div>Options free: <span className="num">{usd(f.deriveFreeUsd)}</span></div>
          <div>bStocks: {f.bstocks.length ? f.bstocks.map((b) => `${b.symbol} ${b.qty} (${usd(b.usd)})`).join(', ') : 'none'}</div>
          <div>Perps positions: {f.positions.length ? f.positions.map((p) => `${p.market} ${p.units > 0 ? 'long' : 'short'} ${Math.abs(p.units)}`).join(', ') : 'none'}</div>
        </div></details>
    </section>
  );
}
