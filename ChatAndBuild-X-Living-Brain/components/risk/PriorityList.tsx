'use client';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Switch } from './ZoneBar';

export interface PriorityItem { id: string; label: string; hint?: string }

/**
 * An ordered list where each row stays put: a switch turns it on/off, arrows move it up/down.
 * Only "on" rows are numbered (1 = used first). `value` is the ordered list of ON ids — what gets saved.
 * Off rows keep their position on screen (local state), so toggling never reshuffles the list.
 */
export function PriorityList({ items, value, onChange, emptyText }: { items: PriorityItem[]; value: string[]; onChange: (ids: string[]) => void; emptyText?: string }) {
  const known = (ids: string[]) => ids.filter((id) => items.some((i) => i.id === id));
  const initial = () => [...known(value), ...items.map((i) => i.id).filter((id) => !value.includes(id))];
  const [order, setOrder] = useState<string[]>(initial);
  // Keep new items (e.g. a newly bought bStock) in sync without reshuffling existing rows.
  // Depend on the id list as a STRING: `items` is a fresh array every render, and depending on it
  // (or always returning a new array) loops render → effect → setState → render forever.
  const idKey = items.map((i) => i.id).join('|');
  useEffect(() => {
    const ids = idKey ? idKey.split('|') : [];
    setOrder((cur) => {
      const kept = cur.filter((id) => ids.includes(id));
      const added = ids.filter((id) => !kept.includes(id));
      const next = [...kept, ...added];
      return next.length === cur.length && next.every((id, i) => id === cur[i]) ? cur : next;
    });
  }, [idKey]);

  const emit = (nextOrder: string[], on: Set<string>) => { setOrder(nextOrder); onChange(nextOrder.filter((id) => on.has(id))); };
  const on = new Set(value);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= order.length) return;
    const next = [...order]; [next[i], next[j]] = [next[j], next[i]];
    emit(next, on);
  };
  const toggle = (id: string, v: boolean) => { const s = new Set(on); if (v) s.add(id); else s.delete(id); emit(order, s); };

  if (!items.length) return <p className="text-xs text-muted">{emptyText ?? 'Nothing to choose.'}</p>;
  let rank = 0;
  return (
    <ol className="divide-y divide-line/60 overflow-hidden rounded-xl bg-bg ring-1 ring-inset ring-line">
      {order.map((id, i) => {
        const item = items.find((x) => x.id === id); if (!item) return null;
        const enabled = on.has(id);
        if (enabled) rank += 1;
        return (
          <li key={id} className={clsx('flex items-center gap-3 px-3 py-2', !enabled && 'opacity-50')}>
            <span className={clsx('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold num', enabled ? 'bg-accent/20 text-accent' : 'bg-panel2 text-muted')}>{enabled ? rank : '–'}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{item.label}</div>
              {item.hint && <div className="truncate text-[11px] text-muted">{enabled ? item.hint : 'Off: never used'}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button type="button" aria-label={`Move ${item.label} up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-muted hover:bg-panel2 hover:text-white disabled:opacity-25"><ArrowUp size={14} /></button>
              <button type="button" aria-label={`Move ${item.label} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-muted hover:bg-panel2 hover:text-white disabled:opacity-25"><ArrowDown size={14} /></button>
            </div>
            <Switch checked={enabled} onChange={(v) => toggle(id, v)} label={`${enabled ? 'Turn off' : 'Turn on'} ${item.label}`} />
          </li>
        );
      })}
    </ol>
  );
}
