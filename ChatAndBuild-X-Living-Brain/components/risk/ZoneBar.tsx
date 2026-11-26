'use client';
import clsx from 'clsx';
import type { Meter } from '@/lib/risk-rules';

// Ported from the original terminal components/risk/rebalance/ZoneBar.tsx: one account's meter on a 0..max track,
// painted with the rule's zones — top-up (amber) and release (cyan) — the target dashed, the live value as a fill.

const MIN_LABEL_GAP = 0.11;
function mergeClose<M extends { at: number; label: string }>(markers: M[], max: number): M[] {
  const out: M[] = [];
  for (const m of [...markers].sort((a, b) => a.at - b.at)) {
    const prev = out[out.length - 1];
    if (prev && (m.at - prev.at) / max < MIN_LABEL_GAP) out[out.length - 1] = { ...prev, label: `${prev.label} · ${m.label}` };
    else out.push(m);
  }
  return out;
}

export function ZoneBar({ meter, labels = true, className }: { meter: Meter; labels?: boolean; className?: string }) {
  const { value, max, topUpZone, releaseZone, markers, state } = meter;
  const pos = (n: number) => `${(Math.min(max, Math.max(0, n)) / max) * 100}%`;
  const width = ([a, b]: [number, number]) => `${((Math.min(max, b) - Math.max(0, a)) / max) * 100}%`;
  const labelled = mergeClose(markers, max);
  return (
    <div className={clsx('w-full', className)}>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-bg ring-1 ring-inset ring-line" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value ?? undefined} aria-valuetext={meter.display}>
        {releaseZone && <div className="absolute inset-y-0 bg-cyan-400/[0.14]" style={{ left: pos(releaseZone[0]), width: width(releaseZone) }} />}
        {topUpZone && <div className="absolute inset-y-0 bg-accent/[0.18]" style={{ left: pos(topUpZone[0]), width: width(topUpZone) }} />}
        {value !== null && (
          <div className={clsx('absolute inset-y-0 left-0 rounded-full transition-[width] duration-500',
            state === 'topup' ? 'bg-gradient-to-r from-accent/50 to-accent' : state === 'release' ? 'bg-gradient-to-r from-cyan-400/30 to-cyan-400/70' : 'bg-gradient-to-r from-blue-500/30 to-blue-400/80')}
            style={{ width: pos(value) }} />
        )}
        {markers.map((m) => (
          <span key={`${m.kind}-${m.at}`} className={clsx('absolute top-0 h-full w-px', m.kind === 'target' ? 'border-l border-dashed border-white/60' : 'bg-white/70')} style={{ left: pos(m.at) }} />
        ))}
      </div>
      {labels && labelled.length > 0 && (
        <div className="relative mt-1 h-4" aria-hidden>
          {labelled.map((m) => (
            <span key={`${m.kind}-${m.at}`} style={{ left: pos(m.at) }}
              className={clsx('absolute whitespace-nowrap text-[10px] leading-4 num',
                m.at / max < 0.08 ? 'translate-x-0' : m.at / max > 0.92 ? '-translate-x-full' : '-translate-x-1/2',
                m.kind === 'trigger' ? 'text-accent' : m.kind === 'release' ? 'text-cyan-300' : 'text-muted')}>{m.label}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40', checked ? 'bg-up' : 'bg-line')}>
      <span className={clsx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}
