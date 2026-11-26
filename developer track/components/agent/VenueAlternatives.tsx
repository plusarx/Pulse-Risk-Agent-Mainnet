import clsx from 'clsx';
import type { VenueAlternative } from '@/lib/agent-action';

const BADGE: Record<VenueAlternative['status'], string> = { chosen: 'bg-accent text-black', possible: 'border border-line text-muted', blocked: 'bg-down/15 text-down' };
const LABEL: Record<VenueAlternative['status'], string> = { chosen: 'Recommended', possible: 'Also possible', blocked: 'Not possible' };

/** Every venue the agent considered for this hedge, with why it was or was not used (computed by the agent from live numbers). */
export function VenueAlternatives({ alts }: { alts: VenueAlternative[] }) {
  if (!alts.length) return null;
  const order = { chosen: 0, possible: 1, blocked: 2 } as const;
  return (
    <div className="space-y-1 rounded-lg border border-line bg-bg p-2 text-[11px]">
      <div className="font-semibold">Why this venue</div>
      {[...alts].sort((a, b) => order[a.status] - order[b.status]).map((a) => (
        <div key={a.instrument} className="flex items-start gap-2">
          <span className={clsx('mt-0.5 shrink-0 rounded px-1.5 py-px text-[9px] font-semibold uppercase', BADGE[a.status])}>{LABEL[a.status]}</span>
          <div><div className="font-medium">{a.instrument}</div><div className="text-muted">{a.why}</div></div>
        </div>
      ))}
    </div>
  );
}
