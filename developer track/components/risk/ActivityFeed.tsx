'use client';
import { useState } from 'react';
import clsx from 'clsx';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';

export interface EventRow { id: number; kind: string; venue: string | null; status: string | null; message: string; payload: string | null; created_at: number }

const KIND: Record<string, string> = { info: 'Note', rebalance: 'Margin move', hedge: 'Hedge', error: 'Problem', status: 'Status', news: 'News', warning: 'Warning', bridge: 'Bridge' };
const VENUE: Record<string, string> = { aster: 'Perps', lighter: 'Perps', derive: 'Options', bsc: 'BNB' };
export const eventLabel = (e: Pick<EventRow, 'kind' | 'venue'>) => `${KIND[e.kind] ?? e.kind.charAt(0).toUpperCase() + e.kind.slice(1)}${e.venue ? ` · ${VENUE[e.venue] ?? e.venue}` : ''}`;

interface Details { reasoning?: string; safetyReview?: string; analysis?: string; concerns?: string[]; technical?: string }
/**
 * The feed shows ONE plain message per event. The AI's reasoning sits behind "Details". Older events carry the
 * reasoning as the whole message ("AI recommendation: ..."): those show a short line and keep the text in Details.
 */
export function splitEvent(e: EventRow): { message: string; details: Details | null } {
  let payload: { details?: Details } | null = null;
  try { payload = e.payload ? JSON.parse(e.payload) : null; } catch { payload = null; }
  const legacy = e.message.match(/^AI recommendation:\s*([\s\S]*)$/);
  if (legacy) return { message: 'The agent explained its recommendation.', details: { reasoning: legacy[1] } };
  return { message: e.message, details: payload?.details ?? null };
}

export function ActivityFeed({ events }: { events: EventRow[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <section className="panel p-5">
      <div className="mb-3 flex items-center gap-2 font-semibold"><Activity size={16} />Agent activity</div>
      <div className="max-h-[320px] space-y-1 overflow-auto">
        {events.map((e) => {
          const { message, details } = splitEvent(e); const isOpen = open.has(e.id);
          return (
            <div key={e.id} className="rounded-lg px-2 py-1.5 text-xs hover:bg-panel2">
              <div className="flex gap-3">
                <span className="w-16 shrink-0 text-muted">{new Date(e.created_at).toLocaleTimeString()}</span>
                <span className={clsx('w-28 shrink-0', e.status === 'failed' || e.kind === 'error' ? 'text-down' : e.kind === 'warning' ? 'text-yellow-400' : e.status === 'done' ? 'text-up' : 'text-accent')}>{eventLabel(e)}</span>
                <span className="min-w-0 flex-1">{message}</span>
                {details && (
                  <button type="button" className="flex shrink-0 items-center gap-0.5 text-muted hover:text-white" onClick={() => toggle(e.id)} aria-expanded={isOpen}>
                    {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}Details
                  </button>
                )}
              </div>
              {details && isOpen && (
                <div className="mt-1 ml-[calc(4rem+7rem+1.5rem)] space-y-1 rounded-lg bg-bg p-2 text-muted">
                  {details.reasoning && <p><span className="text-white">Why.</span> {details.reasoning}</p>}
                  {details.safetyReview && <p><span className="text-white">Safety review.</span> {details.safetyReview}</p>}
                  {details.analysis && <p><span className="text-white">Analysis.</span> {details.analysis}</p>}
                  {details.technical && <p><span className="text-white">Technical detail.</span> {details.technical}</p>}
                  {details.concerns?.length ? <ul className="list-disc pl-4">{details.concerns.map((c) => <li key={c}>{c}</li>)}</ul> : null}
                </div>
              )}
            </div>
          );
        })}
        {!events.length && <div className="text-sm text-muted">No agent activity yet. The agent posts here via POST /api/agent/v1/events.</div>}
      </div>
    </section>
  );
}
