'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Play, Timer } from 'lucide-react';
import { getJson } from '@/lib/hooks/useVenues';
import { useSession } from '@/lib/session';
import { useVenueNetwork } from '@/lib/network';
import type { AgentConfig } from '@/lib/agent-config';
import { Switch } from '@/components/risk/ZoneBar';

const ago = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)}h ago`; };

/**
 * When the agent checks this wallet: automatically every 30 seconds, or only when you press Run now. Approved
 * requests run within seconds either way. "Last check" is the time of the agent's latest posted status.
 */
export function CheckSchedule({ schedule, onChange }: { schedule: AgentConfig['schedule']; onChange: (s: AgentConfig['schedule']) => Promise<string | null> }) {
  const { wallet } = useSession(); const { network } = useVenueNetwork();
  const st = useQuery({ queryKey: ['agent-status', network, wallet, 'schedule'], enabled: !!wallet, refetchInterval: 3_000,
    queryFn: () => getJson<{ updated_at: number | null }>(`/api/agent/status?network=${network}`) });
  const last = st.data?.updated_at ?? null;
  const [pressedAt, setPressedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1_000); return () => clearInterval(t); }, []);
  const running = pressedAt !== null && (last ?? 0) < pressedAt && Date.now() - pressedAt < 90_000;

  const set = async (next: AgentConfig['schedule']) => { setErr(null); const e = await onChange(next); if (e) setErr(e); return e; };
  const runNow = async () => { const at = Date.now(); setPressedAt(at); const e = await set({ ...schedule, runNowAt: at }); if (e) setPressedAt(null); };

  return (
    <section className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3">
        <Timer size={18} className="text-accent" />
        <div>
          <div className="text-sm font-semibold">Agent checks</div>
          <div className="text-[11px] text-muted">
            {schedule.auto ? 'Automatic: every 30 seconds.' : 'Manual: the agent checks only when you press Run now.'} Approved requests run within seconds either way.
            {last ? <> Last check {ago(Date.now() - last)}.</> : null}
          </div>
          {err && <div className="text-[11px] text-down">{err}</div>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted">Every 30 s
          <Switch checked={schedule.auto} onChange={(v) => void set({ ...schedule, auto: v })} label="Automatic 30-second checks" />
        </label>
        <button type="button" onClick={() => void runNow()} disabled={running}
          className={clsx('flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold', running ? 'border-line text-muted' : 'border-accent text-accent hover:bg-accent/10')}>
          <Play size={12} />{running ? 'Checking…' : 'Run now'}
        </button>
      </div>
    </section>
  );
}
