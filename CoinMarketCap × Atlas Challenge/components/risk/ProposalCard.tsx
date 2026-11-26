'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Sparkles, X } from 'lucide-react';
import { getJson } from '@/lib/hooks/useVenues';
import { useSession } from '@/lib/session';
import { useVenueNetwork } from '@/lib/network';
import type { ProposalRow } from '@/lib/agent-proposal';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const SOURCE = { bstocks_bnb: 'bStocks on BNB Chain', exchange_wallet: 'USDC / USDT on BNB' } as const;
const METRIC_LABEL: Record<string, string> = {
  vol_1h_pct: 'Realised 1h vol', latency_sec: 'Top-up latency', leverage: 'Leverage', utilization_pct: 'Utilization now',
  worst_case_move_pct: 'Stress move', bnb_stables_usd: 'BNB stables', bstocks_usd: 'bStocks (after haircut)',
};
const metricText = (k: string, v: number | string | null) => (v === null ? '-' : k.endsWith('_pct') ? `${v}%` : k.endsWith('_sec') ? `${v}s` : k.endsWith('_usd') ? `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : k === 'leverage' ? `${v}x` : String(v));

/** The risk analyst's proposal: the agent proposes, the human approves. Nothing is armed until Approve is clicked. */
export function ProposalCard() {
  const { wallet } = useSession();
  const { network } = useVenueNetwork();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['agent-proposals', network, wallet], enabled: !!wallet, refetchInterval: 5_000,
    queryFn: () => getJson<{ proposals: ProposalRow[] }>(`/api/agent/proposals?network=${network}`) });
  const all = q.data?.proposals ?? [];
  // Several recommendations can show at once (one per account), but each account keeps only its LATEST one:
  // a recommendation from an earlier run is dropped when a newer one for the same account arrives.
  const newest = new Map<string, (typeof all)[number]>();
  for (const x of all) { const k = `${x.venue}:${x.accountRef ?? ''}`; const cur = newest.get(k); if (!cur || x.created_at > cur.created_at) newest.set(k, x); }
  const latest = [...newest.values()].sort((x, y) => y.created_at - x.created_at);
  const pending = latest.filter((x) => x.status === 'pending');
  const past = latest.filter((x) => x.status !== 'pending');

  async function decide(id: number, decision: 'approve' | 'reject' | 'revert') {
    setBusy(id); setErr(null);
    try {
      await getJson(`/api/agent/proposals/${id}?network=${network}`, { method: 'POST', body: JSON.stringify({ decision }) });
      await Promise.all([qc.invalidateQueries({ queryKey: ['agent-proposals'] }), qc.invalidateQueries({ queryKey: ['agent-config'] }), qc.invalidateQueries({ queryKey: ['agent-events'] })]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      {pending.map((p) => {
        const r = p.proposed_rule;
        return (
          <section key={p.id} className="panel border border-accent/40 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-semibold"><Sparkles size={17} className="text-accent" />AI risk proposal
                <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">needs your approval</span></div>
              <div className="text-xs text-muted">{p.venue === 'derive' ? 'Options' : 'Perps'} {p.accountRef ? `#${p.accountRef}` : 'main account'}</div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="space-y-3 text-sm">
                <div><div className="label mb-1">Structural risk</div><p>{p.structural_risk}</p></div>
                <div><div className="label mb-1">Why these numbers</div><p className="text-muted">{p.reasoning}</p></div>
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-bg p-3"><div className="label">Top up above</div><div className="num mt-1 text-lg font-semibold text-down">{pct(r.top_up_trigger)}</div></div>
                  <div className="rounded-xl bg-bg p-3"><div className="label">Restore to</div><div className="num mt-1 text-lg font-semibold">{pct(r.restore_target)}</div></div>
                  <div className="rounded-xl bg-bg p-3"><div className="label">Release below</div><div className="num mt-1 text-lg font-semibold text-up">{pct(r.release_trigger)}</div></div>
                </div>
                <div className="text-xs text-muted">Pay from: <span className="text-white">{SOURCE[r.primary_source]}</span></div>
                {p.metrics && <div className="flex flex-wrap gap-1.5">
                  {Object.entries(p.metrics).map(([k, v]) => <span key={k} className="rounded-md bg-bg px-2 py-1 text-[11px] text-muted">{METRIC_LABEL[k] ?? k}: <span className="num text-white">{metricText(k, v)}</span></span>)}
                </div>}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="btn-primary py-2 text-sm" disabled={busy === p.id} onClick={() => void decide(p.id, 'approve')}><Check size={15} className="mr-1 inline" />Approve &amp; arm</button>
              <button className={clsx('rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-white')} disabled={busy === p.id} onClick={() => void decide(p.id, 'reject')}><X size={15} className="mr-1 inline" />Reject</button>
              <span className="text-[11px] text-muted">The agent proposes, you approve. Approving sets this account&apos;s rule and turns Automation on; your caps, cooldown and on-chain allowance still apply.</span>
              {err && <span className="text-xs text-down">{err}</span>}
            </div>
          </section>
        );
      })}

      <section className="panel p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold"><Sparkles size={16} className="text-accent" />Latest AI recommendations</div>
        </div>
        {err && <div className="mb-2 text-xs text-down">{err}</div>}
        {!all.length && <div className="text-sm text-muted">No recommendations yet. The risk analyst reads your book every few minutes and posts a proposal here for you to approve.</div>}
        {!!pending.length && <div className="text-sm text-muted">Waiting for your decision on the proposal above.</div>}
        <div className="space-y-2">
          {past.map((p, i) => {
            const r = p.proposed_rule;
            return (
              <details key={p.id} className="rounded-xl bg-bg p-3 text-sm">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-medium', p.status === 'approved' ? 'bg-up/15 text-up' : p.status === 'rejected' ? 'bg-down/15 text-down' : p.status === 'reverted' ? 'bg-accent/15 text-accent' : 'bg-panel2 text-muted')}>{p.status}</span>
                  <span className="num">top up &gt; {pct(r.top_up_trigger)} · restore {pct(r.restore_target)} · release &lt; {pct(r.release_trigger)}</span>
                  <span className="text-xs text-muted">{SOURCE[r.primary_source]}</span>
                  <span className="ml-auto flex items-center gap-3 text-xs text-muted">{new Date(p.created_at).toLocaleString()}
                    {p.status === 'approved' && <button className="rounded-lg border border-line px-3 py-1 text-xs text-white hover:bg-panel2" disabled={busy === p.id}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void decide(p.id, 'revert'); }}>Undo</button>}
                  </span>
                </summary>
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <div><div className="label mb-0.5">Structural risk</div><p>{p.structural_risk}</p></div>
                  <div><div className="label mb-0.5">Why these numbers</div><p className="text-muted">{p.reasoning}</p></div>
                  {p.metrics && <div className="flex flex-wrap gap-1.5">{Object.entries(p.metrics).map(([k, v]) => <span key={k} className="rounded-md bg-panel2 px-2 py-1 text-[11px] text-muted">{METRIC_LABEL[k] ?? k}: <span className="num text-white">{metricText(k, v)}</span></span>)}</div>}
                </div>
              </details>
            );
          })}
        </div>
      </section>
    </div>
  );
}
