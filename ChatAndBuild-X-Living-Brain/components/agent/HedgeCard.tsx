import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check } from 'lucide-react';
import { marked, Renderer } from 'marked';
import { getJson } from '@/lib/hooks/useVenues';
import type { AgentConfig } from '@/lib/agent-config';
import { PayoffChart, type PayoffData } from './PayoffChart';
import { VenueAlternatives } from './VenueAlternatives';
import type { VenueAlternative } from '@/lib/agent-action';

/**
 * Mode (Confirm / Auto) and the kill switch, read from and saved to the user's real agent settings (the same
 * /api/agent/config the Risk page uses, so both stay in sync). They are account settings, not part of a test run.
 * Auto stays on until switched back, as on the Risk page; turning the kill switch OFF asks first.
 */
function useAgentControls(network: 'mainnet') {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['agent-config', network, 'chat'], refetchInterval: 15_000, queryFn: () => getJson<{ config: AgentConfig }>(`/api/agent/config?network=${network}`) });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const save = async (fn: (c: AgentConfig) => AgentConfig) => {
    if (!q.data) return;
    setBusy(true); setErr(null);
    try {
      await getJson(`/api/agent/config?network=${network}`, { method: 'PUT', body: JSON.stringify(fn(structuredClone(q.data.config))) });
      await Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: ['agent-config'] })]);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const cfg = q.data?.config;
  // "Needs your attention" items the agent posts with its status (dry run, gas, budget, venue minimums), each with its fix.
  const st = useQuery({ queryKey: ['agent-status', network, 'chat'], refetchInterval: 15_000, queryFn: () => getJson<{ status: { alerts: string[] } | null }>(`/api/agent/status?network=${network}`) });
  const attention = (st.data?.status?.alerts ?? []).filter((a) => a.startsWith('Needs your attention: ')).map((a) => a.slice('Needs your attention: '.length));
  return {
    attention,
    ready: !!cfg, busy, err, signedOut: !!q.error,
    mode: cfg?.mode, killSwitch: cfg?.limits.killSwitch, autonomyExpiresAt: cfg?.limits.autonomyExpiresAt ?? null,
    setMode: (m: 'autonomous' | 'confirm') => {
      if (!cfg || cfg.mode === m) return;
      if (m === 'autonomous' && !window.confirm('Switch to Auto?\n\nThe agent will hedge and move margin on its own, within your limits, until you switch back. The kill switch stops it at any time.')) return;
      // Auto stays on until the user turns it off: no expiry (a lapsed old expiry would otherwise drop it back to Confirm).
      void save((c) => ({ ...c, mode: m, limits: m === 'autonomous' ? { ...c.limits, autonomyExpiresAt: null } : c.limits }));
    },
    toggleKill: () => {
      if (!cfg) return;
      const next = !cfg.limits.killSwitch;
      if (!next && !window.confirm('Turn the kill switch OFF?\n\nThe agent will be allowed to act again (in your current mode).')) return;
      void save((c) => ({ ...c, limits: { ...c.limits, killSwitch: next } }));
    },
  };
}

// Markdown from the model, rendered safely: raw HTML is escaped, images are dropped, only http(s) links survive.
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const renderer = new Renderer();
renderer.html = ({ text }) => esc(text);
renderer.image = () => '';
renderer.link = ({ href, text }) => (/^https?:\/\//i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text);
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => marked.parse(text, { renderer, gfm: true, breaks: true, async: false }) as string, [text]);
  return <div className="md break-words [&_a]:text-accent [&_a]:underline [&_code]:rounded [&_code]:bg-bg [&_code]:px-1 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p+p]:mt-2 [&_p+ul]:mt-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-bg [&_pre]:p-2 [&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_td]:border [&_td]:border-line [&_td]:px-1.5 [&_td]:py-0.5 [&_th]:border [&_th]:border-line [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: html }} />;
}

const usd = (n: number | null | undefined, dp = 0) => (n === null || n === undefined ? '-' : `$${n.toLocaleString('en-US', { maximumFractionDigits: dp })}`);
export interface CardView {
  portfolioUsd: number; hedgedPct: number; requiredHedgePct: number; varPct: number; limitPct: number; mode: 'autonomous' | 'confirm'; killSwitch: boolean;
  holdings: { ticker: string; usd: number; hedgedPct: number }[]; nextEvent: { ticker: string; kind: string; inHours: number } | null;
  limits: { maxPerTradeUsd: number; maxPerDayUsd: number; maxLeverage: number; dailyLossCapUsd: number; weeklyBudgetPct: number; lossTolerancePct: number };
}
export interface CardScenario { payoff?: PayoffData | null; alternatives?: VenueAlternative[]; kind: 'current' | 'mock'; live: boolean; view: CardView | null; inputs: string[]; decision: string; outcome: string; reasons: string[]; why: string | null; limitMet: boolean | null; plan: { instrument?: string; sizeUsd?: number; varBeforePct?: number; varAfterPct?: number; limitPct?: number; costUsd?: number; budgetUsd?: number } | null }
export interface CardPending { id: number; plan: { instrument?: string } | null }
type Tab = 'Home' | 'Hedges' | 'Activity' | 'Limits';

/** The hedge proposal card: Home, Hedges, Activity and Limits tabs, with Approve, Edit size and Decline on the Hedges tab. Approve only ever
 *  acts on a real pending request from the live agent (the same one the Risk page shows); on a test it says so and does nothing. */
export function HedgeCard({ s, pending, hasLiveRequest = false, result, busy, onApprove, onDecline, onEdit }: { hasLiveRequest?: boolean; s: CardScenario; pending: CardPending | undefined; result: string | undefined; busy: boolean; onApprove: (id: number) => void; onDecline: (id: number | null) => void; onEdit: (size: number) => void }) {
  const [tab, setTab] = useState<Tab>(s.plan || s.payoff ? 'Hedges' : 'Home'); const [editing, setEditing] = useState(false); const [size, setSize] = useState(String(Math.round(s.plan?.sizeUsd ?? 0))); const [dismissed, setDismissed] = useState(false);
  const v = s.view; const p = s.plan; const test = s.kind === 'mock' || !s.live;
  const pill = 'rounded-full border px-2 py-0.5 text-[11px]';
  const ctl = useAgentControls('mainnet');
  // Live saved settings win; the run's snapshot is only a fallback until they load.
  const mode = ctl.mode ?? v?.mode; const kill = ctl.killSwitch ?? v?.killSwitch ?? false;
  const ctlTitle = ctl.signedOut ? 'Sign in to change your agent settings' : 'Your real agent setting (same as the Risk page)';
  return (
    <div className="mt-2 rounded-xl border border-line bg-bg text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="text-sm font-semibold">{p ? 'Hedge proposal' : 'Hedge agent'}</div>
        <div className="flex items-center gap-1.5">{test && <span className={clsx(pill, 'border-yellow-400/60 text-yellow-400')}>{s.kind === 'mock' ? 'Mock test' : 'Test'}</span>}<button type="button" disabled={!ctl.ready || ctl.busy} onClick={ctl.toggleKill} title={ctlTitle} aria-pressed={kill}
            className={clsx(pill, 'transition disabled:opacity-50', kill ? 'border-down bg-down/15 font-semibold text-down' : 'border-line text-muted hover:border-down hover:text-down')}>{ctl.busy ? '…' : `Kill switch ${kill ? 'ON' : 'off'}`}</button></div>
      </div>
      <div className="px-3 py-2.5">
        {tab === 'Home' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between"><span className="text-muted">Mode</span>
              <span className="flex overflow-hidden rounded-full border border-line" title={ctlTitle}>
                {(['confirm', 'autonomous'] as const).map((m) => (
                  <button key={m} type="button" disabled={!ctl.ready || ctl.busy} aria-pressed={mode === m} onClick={() => ctl.setMode(m)}
                    className={clsx('px-2.5 py-0.5 transition disabled:opacity-50', (m === 'autonomous' ? mode === 'autonomous' : mode !== 'autonomous') ? 'bg-accent/25 font-semibold' : 'text-muted hover:text-white')}>{m === 'confirm' ? 'Confirm' : 'Auto'}</button>
                ))}
              </span></div>
            {mode === 'autonomous' && ctl.autonomyExpiresAt && <div className="text-right text-[11px] text-muted">Auto until {new Date(ctl.autonomyExpiresAt).toLocaleString()}</div>}
            {kill && <div className="rounded-lg bg-down/10 px-2 py-1 text-[11px] text-down">Kill switch is ON: the agent will not act until you turn it off.</div>}
            {ctl.attention.length > 0 && <div className="rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300"><div className="font-semibold">Needs your attention</div><ul className="list-disc pl-4">{ctl.attention.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
            {ctl.err && <div className="text-[11px] text-down">{ctl.err}</div>}
            {v ? <>
              <div className="flex items-center justify-between"><span className="font-semibold">Portfolio {usd(v.portfolioUsd)}</span><span className="text-muted">Hedged {v.hedgedPct}%</span></div>
              <ul className="space-y-1">{v.holdings.length === 0 && <li className="text-muted">No holdings.</li>}{v.holdings.map((h) => <li key={h.ticker} className="flex items-center justify-between"><span>{h.ticker} <span className="text-muted">{usd(h.usd)}</span></span><span className={clsx(pill, h.hedgedPct >= 1 ? 'border-up/60 text-up' : 'border-yellow-400/60 text-yellow-400')}>{h.hedgedPct >= 1 ? `Hedged ${h.hedgedPct}%` : 'Unhedged'}</span></li>)}</ul>
              <div className="flex items-center justify-between border-t border-line pt-2"><span>Event VaR {v.varPct}%</span><span className="text-muted">Your limit {v.limitPct}%</span></div>
              {v.nextEvent && <div className="text-muted">{v.nextEvent.ticker} {v.nextEvent.kind} in {Math.round(v.nextEvent.inHours)}h.</div>}
            </> : <div className="text-muted">No portfolio numbers for this run.</div>}
          </div>)}
        {tab === 'Hedges' && (p ? (
          <div className="space-y-2">
            <div><div className="text-sm font-semibold">{s.decision}</div><div className="text-muted">{p.instrument} {usd(p.sizeUsd)} notional{v && v.portfolioUsd > 0 && p.sizeUsd ? `, ${Math.round((p.sizeUsd / v.portfolioUsd) * 1000) / 10}% of portfolio` : ''}</div></div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">Cost</dt><dd className="text-right">{usd(p.costUsd, 2)}{p.budgetUsd ? <span className="text-muted"> of {usd(p.budgetUsd)} weekly budget</span> : ''}</dd>
              <dt className="text-muted">Event VaR</dt><dd className="text-right">{p.varBeforePct}% to {p.varAfterPct}%</dd>
              <dt className="text-muted">Your limit</dt><dd className="text-right">{p.limitPct}%{s.limitMet !== null && <span className={clsx('ml-1.5', s.limitMet ? 'text-up' : 'text-down')}>{s.limitMet ? 'met' : 'NOT met'}</span>}</dd>
            </dl>
            {s.payoff && <PayoffChart p={s.payoff} />}
            {s.alternatives?.length ? <VenueAlternatives alts={s.alternatives} /> : null}
            {s.why && <details className="text-muted"><summary className="cursor-pointer">Why</summary><p className="mt-1">{s.why}</p></details>}
            {result ? <div className="flex items-center gap-1 text-up"><Check size={13} />{result}</div>
              : dismissed ? <div className="text-muted">Declined. Nothing was sent.</div>
              : <>
                {editing && <div className="flex items-center gap-2"><span className="text-muted">Size $</span><input value={size} onChange={(e) => setSize(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" className="w-24 rounded border border-line bg-panel px-2 py-1 outline-none" /><button type="button" disabled={!Number(size)} onClick={() => { onEdit(Number(size)); setEditing(false); }} className="rounded-full border border-accent px-3 py-1 font-semibold disabled:opacity-40">Re-run</button></div>}
                {hasLiveRequest && !pending ? <div className="rounded-lg bg-accent/10 px-2 py-1.5 text-accent">The agent&apos;s live request is below: approve or reject it there.</div> : <div className="flex gap-2">
                  <button type="button" disabled={!pending || busy} onClick={() => pending && onApprove(pending.id)} title={pending ? undefined : 'Only a live request from the agent can be approved'} className="flex-1 rounded-full border border-accent bg-accent/20 py-1.5 text-sm font-semibold disabled:opacity-40">{busy ? '...' : 'Approve'}</button>
                  <button type="button" onClick={() => setEditing((x) => !x)} className="rounded-full border border-line px-3 py-1.5">Edit size</button>
                  <button type="button" disabled={busy} onClick={() => { onDecline(pending?.id ?? null); if (!pending) setDismissed(true); }} className="rounded-full border border-line px-3 py-1.5">Decline</button>
                </div>}
                <div className="text-muted">{hasLiveRequest && !pending ? 'Nothing executes until you approve.' : pending ? 'Confirmation mode: nothing executes until you approve.' : test ? 'This is a test on numbers you gave, so there is nothing to approve. Nothing was sent or saved.' : 'The live agent has not raised this request yet. It checks every 30 seconds; it will appear here with Approve.'}</div>
              </>}
          </div>) : <div className="space-y-2"><div className="text-sm font-semibold">{s.decision}</div>{s.reasons.slice(0, 3).map((r) => <div key={r} className="text-muted">{r}</div>)}
            {s.payoff && <PayoffChart p={s.payoff} />}
            {s.alternatives?.length ? <VenueAlternatives alts={s.alternatives} /> : null}
            <div className={hasLiveRequest ? 'rounded-lg bg-accent/10 px-2 py-1.5 text-accent' : 'text-muted'}>{hasLiveRequest ? 'The agent\'s live request is below: approve or reject it there.' : s.payoff ? 'The live agent posts this as a request with Approve and Reject when it runs (every 30 seconds).' : 'No hedge to approve.'}</div></div>)}
        {tab === 'Activity' && (
          <div className="space-y-1.5">
            <div className="text-muted">Why the agent decided this ({s.outcome}):</div>
            <ul className="list-disc space-y-1 pl-4">{(s.reasons.length ? s.reasons : [s.why ?? s.decision]).map((r) => <li key={r}>{r}</li>)}</ul>
            <div className="text-muted">Run on: {s.inputs.join('; ')}</div>
          </div>)}
        {tab === 'Limits' && (v ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt className="text-muted">Loss tolerance</dt><dd>{v.limits.lossTolerancePct}% of portfolio</dd>
            <dt className="text-muted">Weekly premium budget</dt><dd>{v.limits.weeklyBudgetPct}% of portfolio</dd>
            <dt className="text-muted">Max per trade</dt><dd>{usd(v.limits.maxPerTradeUsd)}</dd>
            <dt className="text-muted">Max per day</dt><dd>{usd(v.limits.maxPerDayUsd)}</dd>
            <dt className="text-muted">Max leverage</dt><dd>{v.limits.maxLeverage}x</dd>
            <dt className="text-muted">Daily loss cap</dt><dd>{usd(v.limits.dailyLossCapUsd)}</dd>
          </dl>) : <div className="text-muted">No limits for this run.</div>)}
      </div>
      <div className="flex border-t border-line">{(['Home', 'Hedges', 'Activity', 'Limits'] as Tab[]).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={clsx('flex-1 py-2 text-[11px]', tab === t ? 'border-t-2 border-accent font-semibold text-white' : 'text-muted hover:text-white')}>{t}</button>)}</div>
    </div>
  );
}
