'use client';
import { useEffect, useId, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ChevronDown, X } from 'lucide-react';
import {
  baseUnitsToText, bpsText, defaultRule, describeRule, effectiveCooldownSec, formatUsd, meterFor, minutes, MIN_DEPOSIT_BASE_UNIT, percentToBps,
  RELEASE_ARRIVAL, ruleKey, ruleProblem, ruleTitle, usdToBaseUnits, type RiskRule, type RuleMode,
} from '@/lib/risk-rules';
import { venueWords } from '@/lib/venue-words';
import type { RiskAccount } from '@/lib/hooks/useRiskAccounts';
import { Switch, ZoneBar } from './ZoneBar';

// Ported from the original terminal components/risk/rebalance/RuleEditor.tsx. The form edits TEXT (what the user typed);
// the rule is rebuilt from it on every change, so validation and the live preview always agree.

interface Draft {
  venue: RiskRule['venue']; accountRef: string; accountLabel: string | null; mode: RuleMode;
  trigger: string; target: string; topUpOnce: boolean;
  releaseOn: boolean; releaseLevel: string; releaseForMin: string; releaseTarget: string; releaseOnce: boolean;
  perMove: string; daily: string; min: string; cooldownMin: string; enabled: boolean;
}

function toDraft(r: RiskRule): Draft {
  const usd = r.mode === 'account_value';
  return {
    venue: r.venue, accountRef: r.accountRef, accountLabel: r.accountLabel ?? null, mode: r.mode,
    trigger: usd ? baseUnitsToText(r.triggerBaseUnit) : bpsText(r.triggerBps), target: usd ? baseUnitsToText(r.targetBaseUnit) : bpsText(r.targetBps),
    topUpOnce: r.topUpOnce, releaseOn: r.releaseOn,
    releaseLevel: usd ? baseUnitsToText(r.releaseLevelBaseUnit) : bpsText(r.releaseLevelBps),
    releaseForMin: r.releaseForSec === null ? '30' : String(Math.round(r.releaseForSec / 60)),
    releaseTarget: usd ? baseUnitsToText(r.releaseTargetBaseUnit) : bpsText(r.releaseTargetBps), releaseOnce: r.releaseOnce,
    perMove: baseUnitsToText(r.maxPerMoveBaseUnit), daily: baseUnitsToText(r.dailyCapBaseUnit), min: baseUnitsToText(r.minMoveBaseUnit),
    cooldownMin: String(Math.round(r.cooldownSec / 60)), enabled: r.enabled,
  };
}

type Field = 'trigger' | 'target' | 'releaseLevel' | 'releaseForMin' | 'releaseTarget' | 'perMove' | 'daily' | 'min' | 'cooldownMin';

function fromDraft(d: Draft): { rule: RiskRule | null; errors: Partial<Record<Field, string>>; problem: string | null } {
  const errors: Partial<Record<Field, string>> = {};
  const usd = d.mode === 'account_value';
  const lvl = (v: string, f: Field, optional = false) => {
    if (optional && !v.trim()) return null;
    const out = usd ? usdToBaseUnits(v) : percentToBps(v);
    if (out === null) errors[f] = usd ? 'Enter a USDC amount' : 'Enter a % between 0 and 100';
    return out;
  };
  const money = (v: string, f: Field) => { const o = usdToBaseUnits(v); if (o === null) errors[f] = 'Enter a USDC amount'; return o ?? '0'; };
  const mins = (v: string, f: Field) => { const n = Number(v); if (!/^\d+$/.test(v) || n < 1) errors[f] = 'Whole minutes ≥ 1'; return n * 60; };
  const trig = lvl(d.trigger, 'trigger'); const tgt = lvl(d.target, 'target');
  const rl = d.releaseOn ? lvl(d.releaseLevel, 'releaseLevel') : null;
  const rt = d.releaseOn ? lvl(d.releaseTarget, 'releaseTarget', true) : null;
  const rf = d.releaseOn ? mins(d.releaseForMin, 'releaseForMin') : null;
  const rule: RiskRule = {
    venue: d.venue, accountRef: d.accountRef, accountLabel: d.accountLabel, mode: d.mode,
    triggerBps: usd ? null : (trig as number | null), targetBps: usd ? null : (tgt as number | null),
    triggerBaseUnit: usd ? (trig as string | null) : null, targetBaseUnit: usd ? (tgt as string | null) : null, topUpOnce: d.topUpOnce,
    releaseOn: d.releaseOn, releaseLevelBps: usd ? null : (rl as number | null), releaseLevelBaseUnit: usd ? (rl as string | null) : null,
    releaseForSec: d.releaseOn ? rf : 1800, releaseTargetBps: usd ? null : (rt as number | null), releaseTargetBaseUnit: usd ? (rt as string | null) : null,
    releaseOnce: d.releaseOnce,
    maxPerMoveBaseUnit: money(d.perMove, 'perMove'), dailyCapBaseUnit: money(d.daily, 'daily'), minMoveBaseUnit: money(d.min, 'min'),
    cooldownSec: mins(d.cooldownMin, 'cooldownMin'), enabled: d.enabled,
  };
  if (Object.keys(errors).length) return { rule: null, errors, problem: null };
  const problem = ruleProblem(rule);
  return { rule: problem ? null : rule, errors, problem };
}

function Input({ label, value, onChange, error, prefix, suffix, disabled, hint }: { label: string; value: string; onChange: (v: string) => void; error?: string; prefix?: string; suffix?: string; disabled?: boolean; hint?: string }) {
  const id = useId();
  return (
    <div className={clsx('min-w-0 space-y-1', disabled && 'opacity-40')}>
      <label htmlFor={id} className="block truncate text-[11px] text-muted">{label}</label>
      <div className={clsx('flex h-10 items-center gap-1 rounded-lg border bg-bg px-2.5', error ? 'border-down/60' : 'border-line focus-within:border-accent/50')}>
        {prefix && <span className="text-xs text-muted">{prefix}</span>}
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} inputMode="decimal"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none num disabled:cursor-not-allowed" />
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
      </div>
      {error ? <p className="text-[10px] text-down">{error}</p> : hint ? <p className="text-[10px] text-muted">{hint}</p> : null}
    </div>
  );
}

function RunMode({ label, once, onChange, disabled }: { label: string; once: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={clsx('flex items-center gap-2', disabled && 'opacity-40')}>
      <span className="text-[11px] text-muted" title="Every time: moves whenever the condition holds, within the limits. Once: one move, then this direction pauses until you re-arm it.">{label}</span>
      <div className="ml-auto grid grid-cols-2 gap-0.5 rounded-md bg-bg p-0.5 ring-1 ring-inset ring-line">
        {([false, true] as const).map((v) => (
          <button key={String(v)} type="button" disabled={disabled} onClick={() => onChange(v)}
            className={clsx('h-6 rounded px-2.5 text-[11px] font-medium', once === v ? 'bg-panel2 text-white ring-1 ring-inset ring-line' : 'text-muted')}>{v ? 'Once' : 'Every time'}</button>
        ))}
      </div>
    </div>
  );
}

function Fold({ title, summary, open, onToggle, aside, invalid, children }: { title: string; summary: ReactNode; open: boolean; onToggle: () => void; aside?: ReactNode; invalid?: boolean; children: ReactNode }) {
  return (
    <section className={clsx('rounded-xl bg-bg/40 ring-1 ring-inset', invalid ? 'ring-down/40' : 'ring-line')}>
      <div className="flex items-center gap-2 px-3">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 py-2.5 text-left">
          <ChevronDown size={14} className={clsx('shrink-0 text-muted transition-transform', !open && '-rotate-90')} />
          <span className="shrink-0 text-xs font-medium">{title}</span>
          {!open && <span className="truncate text-[11px] text-muted">{summary}</span>}
        </button>
        {aside}
      </div>
      {open && <div className="space-y-3 px-3 pb-3">{children}</div>}
    </section>
  );
}

export function RuleEditor({ initial, editing, accounts, rules, onSave, onCancel }: {
  initial: RiskRule; editing: boolean; accounts: RiskAccount[]; rules: RiskRule[];
  onSave: (r: RiskRule) => Promise<string | null>; onCancel: () => void;
}) {
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openRelease, setOpenRelease] = useState(initial.releaseOn);
  const [openLimits, setOpenLimits] = useState(false);
  useEffect(() => { setD(toDraft(initial)); setTouched(false); setErr(null); }, [initial]);

  const { rule, errors, problem } = fromDraft(d);
  const shown = touched ? errors : {};
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => { setD((x) => ({ ...x, [k]: v })); setErr(null); };
  const usd = d.mode === 'account_value';
  const unit = usd ? { prefix: '$' } : { suffix: '%' };
  const acct = accounts.find((a) => a.venue === d.venue && a.accountRef === d.accountRef);
  const live = acct?.health ?? { connected: false, utilBps: null, accountUsd: null, usedUsd: null };
  const meter = meterFor(rule ?? undefined, live, usd ? 'usdc' : 'percent');
  const existing = !editing && rules.some((r) => ruleKey(r) === ruleKey(d));
  const L = usd
    ? { trigger: 'Top up when account value below', target: 'Target account value', release: 'Release when account value above', rtarget: 'Release down to account value' }
    : { trigger: 'Top up when utilization above', target: 'Target utilization', release: 'Release when utilization below', rtarget: 'Release down to utilization' };
  const lvl = (v: string) => (usd ? `$${v}` : `${v}%`);

  const switchMode = (m: RuleMode) => {
    if (m === d.mode) return;
    const base = defaultRule(d.venue, d.accountRef, d.accountLabel);
    // Account value defaults: top up below the live value, back to ~1.5×, release above ~3×.
    const a = Math.max(20, Math.round(live.accountUsd ?? 100));
    setD({ ...d, mode: m, ...(m === 'account_value'
      ? { trigger: String(Math.round(a * 0.7)), target: String(a), releaseLevel: String(a * 3), releaseTarget: '' }
      : { trigger: bpsText(base.triggerBps), target: bpsText(base.targetBps), releaseLevel: bpsText(base.releaseLevelBps), releaseTarget: '' }) });
  };

  const save = async () => {
    setTouched(true);
    if (!rule) {
      if (errors.releaseLevel || errors.releaseTarget || errors.releaseForMin) setOpenRelease(true);
      if (errors.perMove || errors.daily || errors.min || errors.cooldownMin) setOpenLimits(true);
      return;
    }
    setBusy(true);
    const e = await onSave(rule);
    setBusy(false);
    if (e) setErr(e);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {!editing && (() => {
          const pick = (a: RiskAccount | undefined) => { if (!a) return; const keep = rules.find((r) => ruleKey(r) === a.key); setD(toDraft(keep ?? defaultRule(a.venue, a.accountRef, a.label))); setErr(null); };
          const inVenue = accounts.filter((a) => a.venue === d.venue);
          return (
            <div className="space-y-2">
              <div role="tablist" aria-label="Venue" className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-0.5 ring-1 ring-inset ring-line">
                {(['aster', 'derive'] as const).map((v) => {
                  const on = d.venue === v; const has = rules.some((r) => r.venue === v); const any = accounts.some((a) => a.venue === v);
                  return (
                    <button key={v} role="tab" aria-selected={on} disabled={!any} onClick={() => pick(accounts.find((a) => a.venue === v))}
                      className={clsx('h-8 rounded-md text-xs font-medium disabled:opacity-40', on ? 'bg-accent/10 text-accent ring-1 ring-inset ring-accent/25' : 'text-muted hover:text-white')}>
                      {v === 'aster' ? 'Perps' : 'Options'}{has && <span className="ml-1.5 inline-block h-1 w-1 rounded-full bg-current align-middle opacity-70" />}
                    </button>
                  );
                })}
              </div>
              <select aria-label="Account" className="input py-2 text-sm" value={`${d.venue}:${d.accountRef}`} onChange={(e) => pick(accounts.find((x) => x.key === e.target.value))}>
                {inVenue.map((a) => <option key={a.key} value={a.key}>{a.label ?? a.title}{rules.some((r) => ruleKey(r) === a.key) ? ' · has a rule' : ''}</option>)}
              </select>
              <p className="text-[10px] text-muted">
                {d.venue === 'aster'
                  ? 'Your perps account (USDT margin on BNB Chain). Top-ups are deposited straight from your BNB wallet.'
                  : 'One options subaccount per risk universe (PRIME, MIDCAP, ALT, RWA). Enable more under Options → Risk universes.'}
              </p>
            </div>
          );
        })()}
        <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-0.5 ring-1 ring-inset ring-line">
          {(['utilization', 'account_value'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={d.mode === m} onClick={() => switchMode(m)}
              className={clsx('h-8 rounded-md text-xs font-medium', d.mode === m ? 'bg-panel2 text-white ring-1 ring-inset ring-line' : 'text-muted')}>{m === 'utilization' ? '% Utilization' : 'USDC · Account value'}</button>
          ))}
        </div>
        {!usd && <p className="text-[11px] text-muted">Every % here is <span className="text-white">margin utilization</span>: margin used ÷ account value.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Input label={L.trigger} value={d.trigger} onChange={set('trigger')} {...unit} error={shown.trigger} />
          <Input label={L.target} value={d.target} onChange={set('target')} {...unit} error={shown.target} />
        </div>
        <RunMode label="Top-up runs" once={d.topUpOnce} onChange={set('topUpOnce')} />

        <div className="rounded-xl bg-bg/60 px-3 pb-1.5 pt-2.5 ring-1 ring-inset ring-line">
          <div className="mb-2 flex items-baseline gap-2">
            <p className="truncate text-[11px] text-muted">{acct?.title ?? venueWords(ruleTitle(d))} now</p>
            <p className="ml-auto text-sm font-semibold num">{meter.display}</p>
          </div>
          <ZoneBar meter={meter} labels={!!rule} />
          {!rule && <p className="pb-1 text-[10px] text-muted">{problem ?? 'Fix the highlighted fields to preview.'}</p>}
        </div>

        <Fold title="Release surplus" open={openRelease} onToggle={() => setOpenRelease((v) => !v)} invalid={d.releaseOn && !!(shown.releaseLevel || shown.releaseTarget || shown.releaseForMin)}
          summary={d.releaseOn ? `${usd ? 'Above' : 'Below'} ${lvl(d.releaseLevel)} for ${d.releaseForMin} min → ${lvl(d.releaseTarget.trim() || d.target)}${d.releaseOnce ? ' · once' : ''}` : 'Off'}
          aside={<Switch checked={d.releaseOn} onChange={(v) => { set('releaseOn')(v); if (v) setOpenRelease(true); }} label="Release surplus" />}>
          <div className="grid grid-cols-2 gap-3">
            <Input label={L.release} value={d.releaseLevel} onChange={set('releaseLevel')} {...unit} error={d.releaseOn ? shown.releaseLevel : undefined} disabled={!d.releaseOn} />
            <Input label="For at least" value={d.releaseForMin} onChange={set('releaseForMin')} suffix="min" error={d.releaseOn ? shown.releaseForMin : undefined} disabled={!d.releaseOn} />
            <Input label={L.rtarget} value={d.releaseTarget} onChange={set('releaseTarget')} {...unit} disabled={!d.releaseOn}
              hint={d.releaseOn && !d.releaseTarget.trim() ? `Blank = the top-up target (${lvl(d.target)})` : undefined} error={d.releaseOn ? shown.releaseTarget : undefined} />
          </div>
          <RunMode label="Release runs" once={d.releaseOnce} onChange={set('releaseOnce')} disabled={!d.releaseOn} />
          <p className="text-[10px] text-muted">{d.releaseOn ? `Goes back to your BNB wallet: ${venueWords(RELEASE_ARRIVAL[d.venue])}.` : 'Off — surplus stays on the venue.'}</p>
        </Fold>

        <Fold title="Limits" open={openLimits} onToggle={() => setOpenLimits((v) => !v)} invalid={!!(shown.perMove || shown.daily || shown.min || shown.cooldownMin)}
          summary={`$${d.perMove}/move · $${d.daily}/24h · min $${d.min} · ${d.cooldownMin} min`}>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Max per move" value={d.perMove} onChange={set('perMove')} prefix="$" error={shown.perMove} />
            <Input label="Cap per 24h" value={d.daily} onChange={set('daily')} prefix="$" error={shown.daily} />
            <Input label="Minimum move" value={d.min} onChange={set('min')} prefix="$" error={shown.min} hint={`${d.venue === 'aster' ? 'Perps' : 'Options'} floor ${formatUsd(MIN_DEPOSIT_BASE_UNIT[d.venue])}`} />
            <Input label="Cooldown" value={d.cooldownMin} onChange={set('cooldownMin')} suffix="min" error={shown.cooldownMin}
              hint={rule && effectiveCooldownSec(rule) > rule.cooldownSec ? `Applied: ${minutes(effectiveCooldownSec(rule))} (venue credit time)` : 'Time between moves'} />
          </div>
        </Fold>
      </div>

      <div className="shrink-0 space-y-2.5 border-t border-line bg-panel px-5 py-3">
        {rule ? <p className="rounded-lg border border-blue-400/30 bg-blue-400/10 px-3 py-2 text-xs leading-relaxed">{venueWords(describeRule(rule))} Cooldown {minutes(rule.cooldownSec)}.</p>
          : <p className="text-xs text-muted">{touched && problem ? problem : 'Complete the rule to see what it will do.'}</p>}
        {existing && <p className="text-[11px] text-accent">Replaces the existing rule for this account.</p>}
        {err && <p className="rounded-lg bg-down/10 px-2.5 py-1.5 text-xs text-down">{err}</p>}
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="h-10 px-3 text-xs text-muted hover:text-white">Cancel</button>
          <button onClick={() => void save()} disabled={busy} className="btn-primary ml-auto min-w-[120px] py-2.5 text-xs">{busy ? 'Saving…' : editing ? 'Save rule' : existing ? 'Replace rule' : 'Add rule'}</button>
        </div>
      </div>
    </div>
  );
}

export function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button aria-label="Close" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[460px] flex-col border-l border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-white" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </aside>
    </div>
  );
}
