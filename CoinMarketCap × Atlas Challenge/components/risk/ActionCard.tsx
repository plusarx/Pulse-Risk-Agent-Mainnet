'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bot, Check, ShieldCheck, X } from 'lucide-react';
import { getJson } from '@/lib/hooks/useVenues';
import { useSession } from '@/lib/session';
import { useVenueNetwork } from '@/lib/network';
import type { ActionRow, HedgePlanView } from '@/lib/agent-action';
import { PayoffChart } from '@/components/agent/PayoffChart';
import { VenueAlternatives } from '@/components/agent/VenueAlternatives';

type Mode = 'autonomous' | 'confirm';

/** The autonomous / confirmation switch. Confirmation: the agent asks before every move. Autonomous: it acts and reports. */
export function ModeToggle({ mode, onChange, autonomyExpiresAt }: { mode: Mode; onChange: (m: Mode) => void; autonomyExpiresAt?: string | null }) {
  const opt = (m: Mode, label: string, hint: string) => (
    <button type="button" onClick={() => onChange(m)} title={hint}
      className={clsx('rounded-lg px-3 py-1.5 text-sm transition', mode === m ? 'bg-accent text-black font-semibold' : 'text-muted hover:text-white')}>{label}</button>
  );
  const expMs = autonomyExpiresAt ? new Date(autonomyExpiresAt).getTime() : null;
  const expired = expMs !== null && expMs <= Date.now();
  const caption = expired ? 'Autonomy expired, the agent asks first.'
    : mode === 'confirm' ? 'Agent asks before every move.'
    : expMs !== null ? `Autonomous until ${new Date(expMs).toLocaleString()}. Agent acts inside your caps.`
    : 'Agent acts on its own inside your caps. You see everything below.';
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex rounded-xl border border-line bg-bg p-1">
        {opt('confirm', 'Ask me first', 'The agent asks for your approval before every move')}
        {opt('autonomous', 'Autonomous', 'The agent acts on its own inside your limits and reports here')}
      </div>
      <span className={clsx('text-[11px]', expired ? 'text-down' : 'text-muted')}>{caption}</span>
    </div>
  );
}

/** The full hedge proposal: instrument, cost, effect on the modelled loss, coverage, margin plan, validity and assumptions. */
function PlanBlock({ p }: { p: HedgePlanView }) {
  const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const c = p.cost;
  // Two decimals when the loss is within 0.05 points of the limit, so "5%" never hides 5.01%.
  const near = Math.abs(p.varAfterPct - p.limitPct) < 0.05 + 1e-9 || Math.abs(p.varBeforePct - p.limitPct) < 0.05 + 1e-9;
  const v = (x: number) => (near ? x.toFixed(2) : x.toFixed(1));
  const notMet = (p.varAfterAllPct ?? p.varAfterPct) > p.limitPct + 0.05;
  return (
    <div className="mt-4 space-y-3 rounded-xl bg-bg p-4 text-sm">
      <div><div className="label mb-0.5">Instrument</div>
        <p>{p.instrument} on {p.venue}, size {usd(p.sizeUsd)}{p.leverage !== null ? `, ${p.leverage.toFixed(1)}x leverage` : ''}{p.orders && p.orders.length > 1 ? `, placed as ${p.orders.length} orders (${p.orders.map((o) => usd(o)).join(', ')})` : ''}</p></div>
      <div className="grid gap-4 md:grid-cols-2">
        <div><div className="label mb-1">Cost</div>
          <table className="w-full text-xs"><tbody>
            {([['Fees', c.feesUsd], ['Premium', c.premiumUsd], ['Funding (estimate)', c.fundingEstUsd], ['Idle margin tied up', c.idleMarginUsd], ['Your weekly budget', c.weeklyBudgetUsd]] as const).map(([k, val]) => (
              <tr key={k} className="border-t border-line/60 first:border-0"><td className="py-1 text-muted">{k}</td><td className="num text-right">{usd(val)}</td></tr>))}
            {p.gapUpCostUsd !== undefined && <tr className="border-t border-line/60"><td className="py-1 text-muted">Loss if the price gaps against it</td><td className="num text-right">{usd(p.gapUpCostUsd)}</td></tr>}
          </tbody></table></div>
        <div className="space-y-2">
          <div><div className="label mb-0.5">Effect</div>
            <p>Modelled 99% loss {v(p.varBeforePct)}% → <span className={notMet ? 'text-down' : 'text-up'}>{v(p.varAfterPct)}%</span> (your limit {v(p.limitPct)}%, window {p.window}).{notMet ? ' The limit is not met.' : ''}{p.varAfterAllPct !== undefined && p.varAfterAllPct !== p.varAfterPct ? ` If every hedge proposed in this check runs: ${v(p.varAfterAllPct)}%.` : ''}</p></div>
          <div><div className="label mb-0.5">Margin</div>
            <p>{p.marginPlan ? `Move ${usd(p.marginPlan.moveUsd)} from ${p.marginPlan.from} to ${p.marginPlan.to}, about ${Math.max(1, Math.round(p.marginPlan.etaSec / 60))} min.` : 'No margin move needed.'}</p></div>
        </div>
      </div>
      {p.bindingConstraint && <div><div className="label mb-0.5">What limited the size</div><p>{p.bindingConstraint}</p></div>}
      {p.options && p.options.length > 0 && <div><div className="label mb-0.5">Your options</div><ul className="list-disc pl-4 text-muted">{p.options.map((o, i) => <li key={i}>{o}</li>)}</ul></div>}
      <div><div className="label mb-0.5">Coverage</div>
        <p>Can be hedged: directly {p.coverage.directPct.toFixed(0)}%, through a proxy {p.coverage.proxyPct.toFixed(0)}%, not at all {p.coverage.nonePct.toFixed(0)}%.
          {p.portfolioHedgedPct !== undefined && <> Hedged now {p.portfolioHedgedPct.toFixed(0)}%{p.portfolioHedgedAfterPct !== undefined ? `, after this trade ${p.portfolioHedgedAfterPct.toFixed(0)}%` : ''} of the portfolio.</>}</p>
        {p.tickers.length > 0 && <ul className="mt-1 grid gap-x-4 text-xs text-muted sm:grid-cols-2">{p.tickers.map((t) => (
          <li key={t.ticker}>{t.ticker}: {t.hedgedPct.toFixed(0)}%{t.hedgedAfterPct !== undefined && t.hedgedAfterPct !== t.hedgedPct ? ` → ${t.hedgedAfterPct.toFixed(0)}%` : ''} hedged ({t.bucket === 'none' ? 'cannot be hedged' : t.bucket}), {usd(t.usd)}{t.netShortUsd ? `, net short ${usd(t.netShortUsd)} (short ${usd(t.shortUsd ?? 0)})` : ''}</li>))}</ul>}
        {p.concentration && <p className="mt-1 text-xs text-muted">Concentration: {p.concentration}</p>}</div>
      <div className="grid gap-4 md:grid-cols-2">
        <div><div className="label mb-0.5">Worst case</div><p className="text-muted">{p.worstCase}</p></div>
        <div><div className="label mb-0.5">Residual risk</div><p className="text-muted">{p.residual}</p></div>
      </div>
      <p className="text-xs text-muted">Valid until {new Date(p.validUntil).toLocaleString()}.</p>
      <details className="text-xs"><summary className="cursor-pointer text-muted">Assumptions and what voids this plan</summary>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          <div><div className="label mb-0.5">Assumptions</div><ul className="list-disc pl-4 text-muted">{p.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
          <div><div className="label mb-0.5">This plan is void if</div><ul className="list-disc pl-4 text-muted">{p.invalidatedBy.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
        </div></details>
    </div>
  );
}

const KIND_LABEL = { top_up: 'Margin top-up', release: 'Release surplus', hedge: 'Hedge' } as const;
const STATUS_STYLE: Record<string, string> = { executed: 'bg-up/15 text-up', failed: 'bg-down/15 text-down', approved: 'bg-accent/15 text-accent', rejected: 'bg-down/15 text-down', expired: 'bg-panel2 text-muted', superseded: 'bg-panel2 text-muted' };
const when = (t: number) => new Date(t).toLocaleString();

/** Requests the agent made in confirmation mode: what, why, what it helps, what happens on approval, then the result. */
export function ActionCard() {
  const { wallet } = useSession();
  const { network } = useVenueNetwork();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['agent-actions', network, wallet], enabled: !!wallet, refetchInterval: 4_000,
    queryFn: () => getJson<{ actions: ActionRow[] }>(`/api/agent/actions?network=${network}`) });
  const all = q.data?.actions ?? [];
  const pending = all.filter((a) => a.status === 'pending');

  async function decide(id: number, decision: 'approve' | 'reject') {
    setBusy(id); setErr(null);
    try {
      await getJson(`/api/agent/actions/${id}?network=${network}`, { method: 'POST', body: JSON.stringify({ decision }) });
      await Promise.all([qc.invalidateQueries({ queryKey: ['agent-actions'] }), qc.invalidateQueries({ queryKey: ['agent-events'] })]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  if (!all.length) return null;
  return (
    <div className="space-y-3">
      {pending.map((a) => (
        <section key={a.id} className="panel border border-accent/40 p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-semibold"><Bot size={17} className="text-accent" />{a.title}
              <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">needs your OK</span></div>
            <div className="text-xs text-muted">{KIND_LABEL[a.kind]} · {a.venue} · {a.origin === 'news' ? 'from news' : 'from your rule'}</div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3 text-sm">
            <div><div className="label mb-1">Why it is asking</div><p>{a.why}</p></div>
            <div><div className="label mb-1">What it helps</div><p className="text-muted">{a.helps}</p></div>
            <div><div className="label mb-1">What happens if you approve</div>
              <ol className="list-decimal space-y-0.5 pl-4 text-muted">{a.willDo.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
          </div>
          {a.plan && <PlanBlock p={a.plan} />}
          {a.payoff && <PayoffChart p={a.payoff} />}
          {a.alternatives?.length ? <VenueAlternatives alts={a.alternatives} /> : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn-primary py-2 text-sm" disabled={busy === a.id} onClick={() => void decide(a.id, 'approve')}><Check size={15} className="mr-1 inline" />Approve</button>
            <button className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-white" disabled={busy === a.id} onClick={() => void decide(a.id, 'reject')}><X size={15} className="mr-1 inline" />Reject</button>
            <span className="text-[11px] text-muted"><ShieldCheck size={12} className="mr-1 inline" />Your caps, cooldown and on-chain allowance still apply. This request expires in 30 minutes.</span>
            {err && <span className="text-xs text-down">{err}</span>}
          </div>
        </section>
      ))}
    </div>
  );
}

/** The requests already answered (approved, rejected, executed, failed, expired). Shown at the bottom of the page, below the live sections. */
export function ActionHistory() {
  const { wallet } = useSession();
  const { network } = useVenueNetwork();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['agent-actions', network, wallet], enabled: !!wallet, refetchInterval: 4_000,
    queryFn: () => getJson<{ actions: ActionRow[] }>(`/api/agent/actions?network=${network}`) });
  const past = (q.data?.actions ?? []).filter((a) => a.status !== 'pending');
  const clearable = past.filter((a) => ['rejected', 'superseded', 'expired'].includes(a.status)).length;
  async function clearHistory() {
    try { await getJson(`/api/agent/actions?network=${network}`, { method: 'DELETE' }); await qc.invalidateQueries({ queryKey: ['agent-actions'] }); } catch (e) { setErr((e as Error).message); }
  }
  if (!past.length) return null;
  return (
    <div className="space-y-3">
      {!!past.length && (
        <section className="panel p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold"><Bot size={16} className="text-accent" />Agent requests</div>
            {clearable > 0 && <button className="text-xs text-muted hover:text-white" onClick={() => void clearHistory()}>Clear history ({clearable})</button>}
          </div>
          <div className="space-y-2">
            {past.map((a) => (
              <details key={a.id} className="rounded-xl bg-bg p-3 text-sm">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className={clsx('rounded-md px-2 py-0.5 text-[11px] font-medium', STATUS_STYLE[a.status] ?? 'bg-panel2 text-muted')}>{a.status}</span>
                  <span>{a.title}</span>
                  <span className="ml-auto text-xs text-muted">{when(a.created_at)}</span>
                </summary>
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <div><div className="label mb-0.5">Why</div><p>{a.why}</p></div>
                  <div><div className="label mb-0.5">What it helps</div><p className="text-muted">{a.helps}</p></div>
                  <div><div className="label mb-0.5">Steps</div><ol className="list-decimal pl-4 text-muted">{a.willDo.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
                  {a.plan && <PlanBlock p={a.plan} />}
                  {a.payoff && <PayoffChart p={a.payoff} />}
                  {a.alternatives?.length ? <VenueAlternatives alts={a.alternatives} /> : null}
                  {a.result_message && <div><div className="label mb-0.5">Result (agent&apos;s acknowledgement)</div><p className={a.status === 'failed' ? 'text-down' : 'text-up'}>{a.result_message}</p></div>}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
      {err && <div className="text-xs text-down">{err}</div>}
    </div>
  );
}
