'use client';
import { useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Info, Pencil, Plus, RotateCcw, Scale, Trash2 } from 'lucide-react';
import { defaultRule, formatUsd, meterFor, planRule, ruleKey, ruleLines, unitsOf, type RiskRule, type RuleState, type RuleUnits } from '@/lib/risk-rules';
import type { RiskAccount } from '@/lib/hooks/useRiskAccounts';
import { Switch, ZoneBar } from './ZoneBar';
import { Drawer, RuleEditor } from './RuleEditor';

export interface MoveItem { id: number; dir: 'in' | 'out'; venue: string | null; status: string | null; message: string; at: number; amountUsd: number | null }

const TONE = {
  ok: 'bg-up', busy: 'bg-blue-400', warn: 'bg-accent', alert: 'bg-down', idle: 'bg-muted',
} as const;

function timeAgo(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86_400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86_400)}d ago`;
}

function AccountCard({ acct, rule, state, units, live, onAdd, onEdit, onToggle, onDelete, onRearm }: {
  acct: RiskAccount; rule?: RiskRule; state?: RuleState; units: RuleUnits; live: boolean;
  onAdd: () => void; onEdit: () => void; onToggle: () => Promise<void>; onDelete: () => Promise<void>; onRearm: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async () => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const meter = meterFor(rule, acct.health, rule ? unitsOf(rule.mode) : units);
  const action = rule ? planRule(rule, acct.health, state) : null;
  const lines = rule ? ruleLines(rule, state) : null;
  const usedUp = rule ? [rule.topUpOnce && state?.topUpDoneAt ? 'top-up' : null, rule.releaseOnce && state?.releaseDoneAt ? 'release' : null].filter(Boolean) : [];
  const tone: keyof typeof TONE = !rule ? 'idle' : !rule.enabled ? 'idle' : action?.kind === 'top_up' ? 'alert' : action?.kind === 'release' ? 'busy' : 'ok';
  const statusText = !rule ? 'Manual' : !rule.enabled ? 'Paused' : !live ? 'Automation off · rules saved'
    : action?.kind === 'top_up' ? `Needs top-up of ${formatUsd(action.amountBaseUnit)}` : action?.kind === 'release' ? `Surplus ${formatUsd(action.amountBaseUnit)} to release` : action?.reason ?? 'Healthy';
  return (
    <article className={clsx('flex min-w-0 flex-col rounded-xl bg-panel2/50 p-4 ring-1 ring-inset', tone === 'alert' ? 'ring-down/35' : tone === 'busy' ? 'ring-blue-400/25' : 'ring-line', rule && !rule.enabled && 'opacity-75')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold">{acct.title}</h4>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-muted">
            {rule ? (rule.enabled ? (rule.mode === 'utilization' ? 'Auto · % utilization' : 'Auto · account value') : 'Paused') : 'Manual'}{acct.label ? ` · ${acct.label}` : ''}
          </p>
        </div>
        <div className="ml-auto shrink-0 text-right">
          <p className={clsx('text-xl font-bold leading-none num', meter.state === 'topup' ? 'text-accent' : meter.state === 'release' ? 'text-cyan-300' : 'text-white')}>{meter.display}</p>
          <p className="mt-1 text-[10px] text-muted">{meter.caption}</p>
        </div>
      </div>
      <ZoneBar className="mt-3" meter={meter} labels={!!rule} />
      {lines ? (
        <dl className="mt-3 space-y-1 text-xs">
          <div className="flex min-w-0 items-center gap-2"><ArrowUpRight size={13} className="shrink-0 text-accent" /><dd className="truncate text-[#c9ccd6]">{lines.topUp}</dd></div>
          <div className="flex min-w-0 items-center gap-2"><ArrowDownLeft size={13} className={clsx('shrink-0', lines.release ? 'text-cyan-300' : 'text-muted')} /><dd className={clsx('truncate', lines.release ? 'text-[#c9ccd6]' : 'text-muted')}>{lines.release ?? 'Release off'}</dd></div>
        </dl>
      ) : <p className="mt-3 text-xs text-muted">No rule — this account is not rebalanced.</p>}
      {rule && unitsOf(rule.mode) !== units && <button onClick={onEdit} className="mt-2 self-start text-[11px] text-accent hover:underline">Written in {rule.mode === 'utilization' ? '%' : 'USDC'} · edit</button>}
      {state?.lastOutcomeMsg && <p className="mt-3 line-clamp-3 rounded-lg bg-bg/60 px-2.5 py-1.5 text-[11px] text-muted">{state.lastOutcomeMsg}{state.lastOutcomeAt && <span className="opacity-60"> · {timeAgo(Date.parse(state.lastOutcomeAt))}</span>}</p>}
      <div className="mt-auto flex min-h-[32px] items-center gap-2 pt-3">
        <span className={clsx('h-2 w-2 shrink-0 rounded-full', TONE[tone], tone === 'alert' && 'animate-pulse')} />
        <span className={clsx('truncate text-xs', tone === 'alert' ? 'text-down' : tone === 'busy' ? 'text-blue-300' : 'text-[#c9ccd6]')}>{statusText}</span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {!rule ? (
            <button onClick={onAdd} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-accent ring-1 ring-inset ring-accent/30 hover:bg-accent/10"><Plus size={12} /> Add rule</button>
          ) : confirm ? (
            <div className="flex items-center gap-1 text-[11px]">
              <button onClick={() => void run(onDelete)()} disabled={busy} className="h-7 rounded-md bg-down/15 px-2 font-semibold text-down">Delete rule</button>
              <button onClick={() => setConfirm(false)} className="h-7 px-2 text-muted">Keep</button>
            </div>
          ) : (
            <>
              <button onClick={onEdit} aria-label="Edit rule" className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-accent"><Pencil size={13} /></button>
              <button onClick={() => setConfirm(true)} aria-label="Delete rule" className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-down"><Trash2 size={13} /></button>
              {usedUp.length > 0 && <button onClick={() => void run(onRearm)()} disabled={busy} title={`This rule's ${usedUp.join(' and ')} runs once and has run. Re-arm to let it move again.`}
                className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-accent ring-1 ring-inset ring-accent/30"><RotateCcw size={12} /> Re-arm</button>}
              <span className="mx-1 h-4 w-px bg-line" />
              <Switch checked={rule.enabled} onChange={() => void run(onToggle)()} disabled={busy} label={rule.enabled ? 'Pause rule' : 'Resume rule'} />
            </>
          )}
        </div>
      </div>
    </article>
  );
}

export function AutoRebalance({ accounts, rules, states, live, onLive, units, onUnits, bscUsdc, moves, onSaveRules, onRearm, loading }: {
  accounts: RiskAccount[]; rules: RiskRule[]; states: Record<string, RuleState>; live: boolean; onLive: (v: boolean) => Promise<void>;
  units: RuleUnits; onUnits: (u: RuleUnits) => void; bscUsdc: number | null; moves: MoveItem[];
  onSaveRules: (rules: RiskRule[]) => Promise<string | null>; onRearm: (key: string) => Promise<void>; loading: boolean;
}) {
  const [editor, setEditor] = useState<{ rule: RiskRule; editing: boolean } | null>(null);
  const [explain, setExplain] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const day = Date.now() - 86_400_000;
  const inDay = moves.filter((m) => m.dir === 'in' && m.at > day && m.status !== 'failed').reduce((a, m) => a + (m.amountUsd ?? 0), 0);
  const outDay = moves.filter((m) => m.dir === 'out' && m.at > day && m.status !== 'failed').reduce((a, m) => a + (m.amountUsd ?? 0), 0);
  const smallestMin = rules.filter((r) => r.enabled).reduce<number | null>((a, r) => { const v = Number(BigInt(r.minMoveBaseUnit)) / 1e6; return a === null || v < a ? v : a; }, null);
  const walletShort = live && smallestMin !== null && bscUsdc !== null && bscUsdc < smallestMin;
  const attention = rules.filter((r) => r.enabled).filter((r) => { const a = accounts.find((x) => x.key === ruleKey(r)); return a && planRule(r, a.health, states[ruleKey(r)]).kind === 'top_up'; }).length;
  const orphan = rules.filter((r) => !accounts.some((a) => a.key === ruleKey(r)));

  const upsert = async (r: RiskRule) => { const e = await onSaveRules([...rules.filter((x) => ruleKey(x) !== ruleKey(r)), r]); if (!e) setEditor(null); return e; };
  const first = accounts[0];

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 pb-3 pt-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 ring-1 ring-inset ring-accent/20"><Scale size={17} className="text-accent" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold leading-tight">Auto margin rebalancing</h2>
          <p className="text-[11px] text-muted">Tops venue margin up from your BNB wallet and sends surplus back.</p>
        </div>
        <div className="flex items-center gap-2">
          <div role="radiogroup" className="inline-flex items-center gap-0.5 rounded-lg bg-bg p-0.5 ring-1 ring-inset ring-line">
            {(['percent', 'usdc'] as const).map((u) => (
              <button key={u} role="radio" aria-checked={units === u} onClick={() => onUnits(u)}
                className={clsx('h-7 rounded-md px-2.5 text-[11px] font-semibold', units === u ? 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/30' : 'text-muted')}>{u === 'percent' ? '%' : 'USDC'}</button>
            ))}
          </div>
          <button onClick={() => setExplain((v) => !v)} className={clsx('inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] ring-1 ring-inset', explain ? 'bg-accent/10 text-accent ring-accent/30' : 'text-muted ring-line')}><Info size={14} /> How it works</button>
          <button disabled={!first} onClick={() => first && setEditor({ rule: rules.find((r) => ruleKey(r) === first.key) ?? defaultRule(first.venue, first.accountRef, first.label), editing: false })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-black disabled:opacity-40"><Plus size={14} /> New rule</button>
        </div>
      </div>

      <div className="mx-5 mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-bg/60 px-3 py-2 text-xs ring-1 ring-inset ring-line">
        <label className="inline-flex items-center gap-2">
          <Switch checked={live} onChange={(v) => void onLive(v)} label="Automation on" />
          <span className={live ? 'text-up' : 'text-accent'}>{live ? 'Live' : 'Automation off · rules are saved, nothing moves'}</span>
        </label>
        <span className="text-muted">·</span>
        <span className="text-muted">BNB wallet <span className={clsx('font-semibold num', walletShort ? 'text-accent' : 'text-white')}>{bscUsdc === null ? '—' : `$${bscUsdc.toFixed(2)}`}</span></span>
        <span className="text-muted">·</span>
        <span className="text-muted">24h <span className="inline-flex items-center num text-white"><ArrowUpRight size={12} className="text-accent" />${inDay.toFixed(2)}</span> <span className="inline-flex items-center num text-white"><ArrowDownLeft size={12} className="text-cyan-300" />${outDay.toFixed(2)}</span></span>
        {attention > 0 && <span className="inline-flex items-center gap-1.5 font-medium text-down sm:ml-auto"><AlertTriangle size={13} /> {attention} need{attention === 1 ? 's' : ''} a top-up</span>}
      </div>

      {explain && (
        <div className="mx-5 mb-4 space-y-1.5 rounded-lg bg-bg/60 p-4 text-xs leading-relaxed text-[#c9ccd6] ring-1 ring-inset ring-line">
          <p><b className="text-white">Top-up.</b> When an account crosses its trigger (utilization too high, or account value too low), the agent sizes a move that brings it back to the target: <span className="num">x = used ÷ target − equity</span>. It is rounded up to the minimum move and capped by the per-move and 24h limits.</p>
          <p><b className="text-white">Where the money comes from.</b> Your BNB wallet, in the order set under Funding: USDC, USDT, then bStocks you allowed it to sell. It only pulls within the allowance you granted, then Relay bridges it to the venue (perps directly; options via Ethereum).</p>
          <p><b className="text-white">Release surplus.</b> Optional. When the account sits on the other side of the release level for the whole dwell time, the surplus goes back down to the release target, home to your BNB wallet.</p>
          <p><b className="text-white">Every time / Once.</b> Once = one move, then that direction pauses until you press Re-arm. Cooldown stops a second top-up before the first one lands.</p>
          <p className="text-muted">Rules are executed by the Pulse Risk agent service. This page shows what it would do right now from live balances.</p>
        </div>
      )}

      {walletShort && (
        <div className="mx-5 mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-accent/[0.06] px-3 py-2.5 ring-1 ring-inset ring-accent/25">
          <AlertTriangle size={15} className="shrink-0 text-accent" />
          <p className="min-w-0 flex-1 text-xs text-[#c9ccd6]"><b className="text-white">Top-ups can&apos;t fire.</b> Your BNB wallet holds ${bscUsdc?.toFixed(2)}, less than the smallest top-up your rules allow (${smallestMin?.toFixed(2)}).</p>
          <Link href="/funding" className="inline-flex h-7 items-center rounded-lg px-3 text-[11px] font-semibold text-accent ring-1 ring-inset ring-accent/30">Fund wallet</Link>
        </div>
      )}

      {loading && !accounts.length ? (
        <div className="grid grid-cols-1 gap-3 px-5 pb-5 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-panel2/60" />)}</div>
      ) : !accounts.length ? (
        <p className="px-5 pb-5 text-sm text-muted">No venue accounts yet. Deposit to perps or options, then add a rule here.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 px-5 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => {
            const rule = rules.find((r) => ruleKey(r) === a.key);
            return (
              <AccountCard key={a.key} acct={a} rule={rule} state={states[a.key]} units={units} live={live}
                onAdd={() => setEditor({ rule: units === 'usdc' ? { ...defaultRule(a.venue, a.accountRef, a.label), mode: 'account_value', triggerBps: null, targetBps: null, releaseLevelBps: null,
                  triggerBaseUnit: String(Math.max(20, Math.round((a.health.accountUsd ?? 100) * 0.7)) * 1_000_000), targetBaseUnit: String(Math.max(30, Math.round(a.health.accountUsd ?? 100)) * 1_000_000) } : defaultRule(a.venue, a.accountRef, a.label), editing: false })}
                onEdit={() => rule && setEditor({ rule, editing: true })}
                onToggle={async () => { if (rule) await onSaveRules(rules.map((r) => (ruleKey(r) === a.key ? { ...r, enabled: !r.enabled } : r))); }}
                onDelete={async () => { await onSaveRules(rules.filter((r) => ruleKey(r) !== a.key)); }}
                onRearm={() => onRearm(a.key)} />
            );
          })}
        </div>
      )}
      {orphan.length > 0 && <p className="mx-5 mt-3 text-[11px] text-muted">{orphan.length} saved rule{orphan.length === 1 ? '' : 's'} for accounts not visible on this network ({orphan.map(ruleKey).join(', ')}).</p>}

      <div className="px-5 pb-4 pt-5">
        <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">Recent moves</h3>
        {!moves.length ? <p className="py-1 text-xs text-muted">Nothing moved yet. The agent records each move here.</p> : (
          <>
            <ol className="divide-y divide-line/50">
              {(showAll ? moves : moves.slice(0, 5)).map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2">
                  {m.dir === 'in' ? <ArrowUpRight size={14} className="shrink-0 text-accent" /> : <ArrowDownLeft size={14} className="shrink-0 text-cyan-300" />}
                  <span className="min-w-0 flex-1 truncate text-xs text-[#c9ccd6]">{m.message}</span>
                  <span className={clsx('w-16 shrink-0 rounded px-1.5 py-px text-center text-[10px] uppercase tracking-wider',
                    m.status === 'done' ? 'bg-up/10 text-up' : m.status === 'failed' ? 'bg-down/10 text-down' : 'bg-accent/10 text-accent')}>{m.status ?? 'info'}</span>
                  <span className="hidden w-14 shrink-0 text-right text-[11px] text-muted sm:block">{timeAgo(m.at)}</span>
                </li>
              ))}
            </ol>
            {moves.length > 5 && <button onClick={() => setShowAll((v) => !v)} className="mt-1 text-[11px] text-muted hover:text-accent">{showAll ? 'Show less' : `Show all ${moves.length}`}</button>}
          </>
        )}
      </div>

      <Drawer open={!!editor} title={editor?.editing ? 'Edit rule' : 'New rule'} onClose={() => setEditor(null)}>
        {editor && <RuleEditor initial={editor.rule} editing={editor.editing} accounts={accounts} rules={rules} onSave={upsert} onCancel={() => setEditor(null)} />}
      </Drawer>
    </section>
  );
}
