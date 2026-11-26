'use client';
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Gauge } from 'lucide-react';
import { DEFAULT_LIMITS, DEFAULT_RISK, type AgentConfig } from '@/lib/agent-config';
import { BSTOCKS_BSC } from '@/lib/bstocks';
import { Switch } from '@/components/risk/ZoneBar';

type Risk = AgentConfig['risk'];
type Limits = AgentConfig['limits'];
type Draft = { risk: Risk; limits: Limits };

const TICKERS = [...new Set(BSTOCKS_BSC.map((b) => b.underlying))];
const EXPIRY = [['', 'Keep as is'], ['1h', '1 hour'], ['8h', '8 hours'], ['24h', '24 hours'], ['7d', '7 days'], ['none', 'No expiry']] as const;
const EXPIRY_MS: Record<string, number> = { '1h': 3_600_000, '8h': 8 * 3_600_000, '24h': 24 * 3_600_000, '7d': 7 * 86_400_000 };

// Same bounds as RiskProfile / Limits in lib/agent-config.ts.
const NUM: { group: 'risk' | 'limits'; key: string; label: string; min: number; max: number; unit: string }[] = [
  { group: 'risk', key: 'lossTolerancePct', label: 'Loss tolerance per day or event', min: 0.1, max: 50, unit: '% of portfolio' },
  { group: 'risk', key: 'premiumBudgetWeeklyPct', label: 'Protection budget per week', min: 0, max: 10, unit: '% of portfolio' },
  { group: 'risk', key: 'eventLeadHours', label: 'Hedge ahead of events by', min: 1, max: 168, unit: 'hours' },
  { group: 'limits', key: 'maxNotionalPerTradeUsd', label: 'Max size per trade', min: 0, max: 10_000_000, unit: 'USD' },
  { group: 'limits', key: 'maxNotionalPerDayUsd', label: 'Max traded per day', min: 0, max: 100_000_000, unit: 'USD' },
  { group: 'limits', key: 'maxLeverage', label: 'Max leverage', min: 1, max: 125, unit: 'x' },
  { group: 'limits', key: 'dailyLossCapUsd', label: 'Daily loss cap', min: 0, max: 100_000_000, unit: 'USD' },
  { group: 'limits', key: 'maxCapitalOffBnbUsd', label: 'Max capital off BNB', min: 0, max: 100_000_000, unit: 'USD' },
];

const fmtList = (l: string[]) => (l.length ? l.join(', ') : 'none');
const fmtExpiry = (v: string | null) => (v ? new Date(v).toLocaleString() : 'no expiry');
function timeLeft(v: string | null, now: number): string {
  if (!v) return 'No expiry set';
  const ms = new Date(v).getTime() - now;
  if (ms <= 0) return 'Expired';
  const m = Math.round(ms / 60_000);
  return m < 90 ? `${m} min left` : m < 2880 ? `${Math.round(m / 60)}h left` : `${Math.round(m / 1440)}d left`;
}

/** Edit the loss limit and hard limits. Nothing is saved until the user reviews the changes and confirms. */
export function LimitsPanel({ value, onSave }: { value: AgentConfig; onSave: (next: AgentConfig) => Promise<string | null> }) {
  const base: Draft = useMemo(() => ({ risk: { ...DEFAULT_RISK, ...value.risk }, limits: { ...DEFAULT_LIMITS, ...value.limits } }), [value.risk, value.limits]);
  const [d, setD] = useState<Draft>(base);
  const [text, setText] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setD(base); setText({}); }, [base]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const get = (g: 'risk' | 'limits', k: string) => (d[g] as unknown as Record<string, number>)[k];
  const shown = (g: 'risk' | 'limits', k: string) => text[`${g}.${k}`] ?? String(get(g, k));
  const errors: Record<string, string> = {};
  for (const f of NUM) {
    const id = `${f.group}.${f.key}`;
    const raw = shown(f.group, f.key).trim();
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n)) errors[id] = 'Enter a number';
    else if (n < f.min) errors[id] = `At least ${f.min}`;
    else if (n > f.max) errors[id] = `At most ${f.max.toLocaleString()}`;
  }
  const valid = Object.keys(errors).length === 0;

  const setNum = (g: 'risk' | 'limits', k: string, raw: string) => {
    setText((t) => ({ ...t, [`${g}.${k}`]: raw })); setReview(false); setMsg(null);
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) setD((x) => ({ ...x, [g]: { ...x[g], [k]: n } }));
  };
  const upd = (fn: (x: Draft) => void) => { setD((x) => { const n = structuredClone(x); fn(n); return n; }); setReview(false); setMsg(null); };
  const toggle = (list: 'excludeTickers' | 'fullyHedgeTickers', t: string) => upd((x) => {
    const has = x.risk[list].includes(t);
    x.risk[list] = has ? x.risk[list].filter((y) => y !== t) : [...x.risk[list], t];
    // A ticker is either excluded or fully hedged, never both.
    const other = list === 'excludeTickers' ? 'fullyHedgeTickers' : 'excludeTickers';
    if (!has) x.risk[other] = x.risk[other].filter((y) => y !== t);
  });
  const setExpiry = (k: string) => upd((x) => { x.limits.autonomyExpiresAt = k === 'none' ? null : new Date(Date.now() + EXPIRY_MS[k]).toISOString(); });

  const changes = useMemo(() => {
    const out: { label: string; from: string; to: string }[] = [];
    for (const f of NUM) {
      const a = (base[f.group] as unknown as Record<string, number>)[f.key]; const b = (d[f.group] as unknown as Record<string, number>)[f.key];
      if (a !== b) out.push({ label: f.label, from: `${a} ${f.unit}`, to: `${b} ${f.unit}` });
    }
    if (base.risk.correlation !== d.risk.correlation) out.push({ label: 'Assumed correlation', from: String(base.risk.correlation), to: String(d.risk.correlation) });
    if (fmtList(base.risk.excludeTickers) !== fmtList(d.risk.excludeTickers)) out.push({ label: 'Never hedge', from: fmtList(base.risk.excludeTickers), to: fmtList(d.risk.excludeTickers) });
    if (fmtList(base.risk.fullyHedgeTickers) !== fmtList(d.risk.fullyHedgeTickers)) out.push({ label: 'Always hedge in full', from: fmtList(base.risk.fullyHedgeTickers), to: fmtList(d.risk.fullyHedgeTickers) });
    if (base.limits.autonomyExpiresAt !== d.limits.autonomyExpiresAt) out.push({ label: 'Autonomy expires', from: fmtExpiry(base.limits.autonomyExpiresAt), to: fmtExpiry(d.limits.autonomyExpiresAt) });
    if (base.limits.killSwitch !== d.limits.killSwitch) out.push({ label: 'Kill switch', from: base.limits.killSwitch ? 'armed' : 'off', to: d.limits.killSwitch ? 'armed' : 'off' });
    return out;
  }, [base, d]);

  async function confirm() {
    setBusy(true); setMsg(null);
    const e = await onSave({ ...value, risk: d.risk, limits: d.limits });
    setBusy(false);
    if (e) setMsg(`Error: ${e}`); else { setReview(false); setMsg('Limits saved.'); }
  }

  const chips = (list: 'excludeTickers' | 'fullyHedgeTickers') => (
    <div className="flex flex-wrap gap-1.5">{TICKERS.map((t) => {
      const on = d.risk[list].includes(t);
      return <button key={t} type="button" aria-pressed={on} onClick={() => toggle(list, t)}
        className={clsx('rounded-md px-2 py-1 text-xs transition', on ? 'bg-accent text-black font-semibold' : 'bg-bg text-muted hover:text-white')}>{t}</button>;
    })}</div>
  );
  const numField = (g: 'risk' | 'limits', k: string) => {
    const f = NUM.find((x) => x.group === g && x.key === k)!; const id = `${g}.${k}`;
    return (
      <label key={id} className="block"><span className="label">{f.label} ({f.unit})</span>
        <input className={clsx('input mt-1 py-2 text-sm', errors[id] && 'border-down')} inputMode="decimal" value={shown(g, k)} onChange={(e) => setNum(g, k, e.target.value)} />
        {errors[id] && <span className="text-[11px] text-down">{errors[id]}</span>}</label>
    );
  };

  return (
    <section className="panel p-5">
      <div className="mb-1 flex items-center gap-2 font-semibold"><Gauge size={17} className="text-accent" />Risk limits</div>
      <p className="mb-4 text-[11px] text-muted">Only you can change limits. The agent can only propose.</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 text-sm">
          <div className="label">What you can stand to lose</div>
          <div className="grid grid-cols-2 gap-3">{numField('risk', 'lossTolerancePct')}{numField('risk', 'premiumBudgetWeeklyPct')}{numField('risk', 'eventLeadHours')}</div>
          <label className="block"><span className="label">Assumed correlation between stocks {d.risk.correlation.toFixed(2)}</span>
            <input type="range" min={0} max={1} step={0.05} value={d.risk.correlation} onChange={(e) => upd((x) => { x.risk.correlation = +e.target.value; })} className="w-full accent-[#f0b90b]" />
            <span className="text-[11px] text-muted">0 = move independently, 1 = move together. Higher means a larger modelled loss.</span></label>
          <div><div className="label mb-1">Never hedge these</div>{chips('excludeTickers')}</div>
          <div><div className="label mb-1">Always hedge these in full</div>{chips('fullyHedgeTickers')}</div>
        </div>

        <div className="space-y-3 text-sm">
          <div className="label">Hard limits on every action</div>
          <div className="grid grid-cols-2 gap-3">
            {numField('limits', 'maxNotionalPerTradeUsd')}{numField('limits', 'maxNotionalPerDayUsd')}{numField('limits', 'maxLeverage')}
            {numField('limits', 'dailyLossCapUsd')}{numField('limits', 'maxCapitalOffBnbUsd')}
          </div>
          <div className="grid grid-cols-2 items-end gap-3">
            <label className="block"><span className="label">Autonomy: {timeLeft(d.limits.autonomyExpiresAt, now)}</span>
              <select className="input mt-1 py-2 text-sm" value="" onChange={(e) => e.target.value && setExpiry(e.target.value)}>
                {EXPIRY.map(([k, l]) => <option key={k} value={k}>{k === '' ? 'Set autonomy time…' : l}</option>)}
              </select></label>
            <div className="flex items-center justify-between rounded-xl bg-bg p-2.5"><span className="text-xs">Kill switch</span>
              <Switch checked={d.limits.killSwitch} onChange={(v) => upd((x) => { x.limits.killSwitch = v; })} label="Kill switch" /></div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn-primary py-2 text-sm" disabled={!valid || changes.length === 0} onClick={() => setReview(true)}>Review changes{changes.length ? ` (${changes.length})` : ''}</button>
        {changes.length > 0 && <button className="text-xs text-muted hover:text-white" onClick={() => { setD(base); setText({}); setReview(false); setMsg(null); }}>Discard</button>}
        {!valid && <span className="text-xs text-down">Fix the highlighted fields first.</span>}
        {msg && <span className={clsx('text-xs', msg.startsWith('Error') ? 'text-down' : 'text-up')}>{msg}</span>}
      </div>

      {review && changes.length > 0 && (
        <div className="mt-3 rounded-xl border border-accent/40 bg-bg p-4 text-sm">
          <div className="mb-2 font-medium">You are about to change:</div>
          <ul className="space-y-1">{changes.map((c) => (
            <li key={c.label} className="flex flex-wrap gap-x-2 text-xs"><span className="text-muted">{c.label}:</span><span className="num">{c.from}</span><span className="text-muted">→</span><span className="num font-semibold">{c.to}</span></li>
          ))}</ul>
          <div className="mt-3 flex gap-3">
            <button className="btn-primary py-2 text-sm" disabled={busy || !valid} onClick={() => void confirm()}>Confirm and save limits</button>
            <button className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-white" onClick={() => setReview(false)}>Back</button>
          </div>
        </div>
      )}
    </section>
  );
}
