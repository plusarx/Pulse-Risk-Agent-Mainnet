'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Brain, Pin, PinOff, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { getJson } from '@/lib/hooks/useVenues';

// The Memory tab of the chat: everything the agent remembers about this wallet in Living Brain, with pin, delete one and Clear all, and a usage meter
// that shows how much of the memory budget has been used. Memory belongs to the signed-in wallet; signed out there is none.
export interface MemoryItem { id: string; title: string; text: string; pinned: boolean; at: string | null }
interface Usage { enabled: boolean; backend: string | null; captures: number; recalls: number; estSpentUsd: number; budgetUsd: number; budgetReached: boolean }
interface State { enabled: boolean; signedOut?: boolean; backend?: string | null; items: MemoryItem[]; usage: Usage | null; note?: string | null }

/** The chat tells the panel a memory was just saved or forgotten, so the list updates by itself (Living Brain organises a note in about 15 seconds). */
export const MEMORY_CHANGED = 'pulse-memory-changed';
export const announceMemoryChange = (saved: string[] = []) => { try { window.dispatchEvent(new CustomEvent(MEMORY_CHANGED, { detail: { saved } })); } catch { /* no window */ } };
const WATCH_MS = 45_000;

const money = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

export function MemoryPanel() {
  const [s, setS] = useState<State | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState(''); const [confirmClear, setConfirmClear] = useState(false);
  // Notes saved a moment ago that Living Brain is still organising: shown as "saving" cards until the list grows (or a minute passes).
  const [saving, setSaving] = useState<string[]>([]); const [watchUntil, setWatchUntil] = useState(0); const baseline = useRef(0);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    try { const r = await getJson<State>('/api/agent/memory'); if (alive.current) { setS(r); setErr(null); } }
    catch (e) { if (alive.current) setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const watch = useCallback((saved: string[]) => { baseline.current = Math.max(baseline.current, 0); if (saved.length) setSaving((x) => [...x, ...saved].slice(-5)); setWatchUntil(Date.now() + WATCH_MS); void load(); }, [load]);
  // A memory saved from the chat refreshes this list now, then every 5 s until it lands (about 15 s) or 45 s pass. No polling otherwise: every read is a paid-plan request.
  useEffect(() => { const h = (e: Event) => watch(((e as CustomEvent).detail?.saved as string[] | undefined) ?? []); window.addEventListener(MEMORY_CHANGED, h); return () => window.removeEventListener(MEMORY_CHANGED, h); }, [watch]);
  useEffect(() => {
    if (!watchUntil) return;
    const t = setInterval(() => { if (Date.now() > watchUntil) { setWatchUntil(0); setSaving([]); } else void load(); }, 5_000);
    return () => clearInterval(t);
  }, [watchUntil, load]);
  // The list grew: the pending notes have landed.
  const count = s?.items.length ?? 0; useEffect(() => { if (count > baseline.current && saving.length) { setSaving([]); setWatchUntil(0); } baseline.current = count; }, [count, saving.length]);

  async function act(body: object, after?: () => void) {
    setBusy(true); setErr(null);
    try { await getJson('/api/agent/memory', { method: 'POST', body: JSON.stringify(body) }); after?.(); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  // A saved note is compiled into pages in the background (about 15 seconds), so refresh once it should be there.
  const addNote = () => { const t = text.trim(); if (!t) return; void act({ action: 'note', text: t }, () => { setText(''); watch([t]); }); };

  const u = s?.usage; const pct = u ? Math.min(100, Math.round((u.estSpentUsd / Math.max(u.budgetUsd, 0.0001)) * 100)) : 0;

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Brain size={16} className="text-accent" /><span className="font-semibold">Memory</span>
          <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent">Powered by Living Brain</span></div>
        <button type="button" onClick={() => void load()} disabled={busy} title="Refresh" className="rounded-full p-1 text-muted hover:bg-white/5 hover:text-white disabled:opacity-40"><RefreshCw size={13} /></button>
      </div>

      {err && <div className="rounded-md bg-down/10 px-2 py-1.5 text-xs text-down">{err}</div>}
      {s?.note && <div className="rounded-md bg-yellow-400/10 px-2 py-1.5 text-xs text-yellow-400">{s.note}</div>}
      {s?.signedOut && <p className="text-xs text-muted">Sign in with your wallet, and the agent remembers your preferences and decisions between chats.</p>}
      {s && !s.enabled && !s.signedOut && <p className="text-xs text-muted">Memory is not switched on for this app. Set <code>LIVING_BRAIN_API_KEY</code> on the agent to turn it on; the chat works the same without it.</p>}

      {u?.enabled && (
        <div className="rounded-xl border border-line bg-panel p-2.5 text-xs">
          <div className="mb-1.5 flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-wider text-muted">Memory usage</span><span className={clsx('font-mono', u.budgetReached ? 'text-down' : 'text-muted')}>{money(u.estSpentUsd)} of {money(u.budgetUsd)} est.</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line"><div className={clsx('h-full rounded-full', u.budgetReached ? 'bg-down' : pct > 75 ? 'bg-yellow-400' : 'bg-up')} style={{ width: `${pct}%` }} /></div>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-center"><div><div className="num text-base font-semibold text-white">{s?.items.length ?? 0}</div><div className="text-muted">remembered</div></div>
            <div><div className="num text-base font-semibold text-white">{u.captures}</div><div className="text-muted">saved</div></div><div><div className="num text-base font-semibold text-white">{u.recalls}</div><div className="text-muted">recalls</div></div></div>
          {u.budgetReached && <div className="mt-1.5 text-down">The memory budget for this demo is used up. The chat keeps working without memory.</div>}
          <div className="mt-1.5 text-[10px] text-muted">Living Brain has no balance API, so the spend is our own estimate. Memory holds your preferences and decisions, never balances or keys.</div>
        </div>)}

      {u?.enabled && (
        <form onSubmit={(e) => { e.preventDefault(); addNote(); }} className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 focus-within:border-accent">
          <input value={text} onChange={(e) => setText(e.target.value)} disabled={busy || u.budgetReached} maxLength={300} placeholder="Tell it something to remember, e.g. I prefer puts over perps" className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted/70" />
          <button type="submit" disabled={busy || !text.trim() || u.budgetReached} aria-label="Remember" className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent text-black disabled:bg-line disabled:text-muted"><Plus size={13} /></button>
        </form>)}
      {saving.map((t, k) => <div key={`${k}${t}`} className="flex items-center gap-2 rounded-lg border border-dashed border-accent/40 bg-accent/[0.05] px-2.5 py-2 text-xs"><RefreshCw size={12} className="shrink-0 animate-spin text-accent" /><div className="min-w-0"><div className="text-accent">Saving to Living Brain…</div><div className="break-words text-muted">{t}</div></div></div>)}

      {u?.enabled && (
        <div className="space-y-1.5">
          {s!.items.length === 0 && <div className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-muted">Nothing remembered yet. Say &ldquo;remember that I prefer puts over perps&rdquo; in the chat, or add a note above.</div>}
          {s!.items.map((it) => (
            <div key={it.id} className="rounded-lg border border-line bg-bg px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="flex items-center gap-1.5 text-[11px] font-semibold text-white">{it.pinned && <Pin size={11} className="text-accent" />}<span className="truncate">{it.title}</span></div>
                  <div className="mt-0.5 break-words text-xs text-muted">{it.text}</div></div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button type="button" disabled={busy} onClick={() => void act({ action: 'pin', id: it.id, pinned: !it.pinned })} title={it.pinned ? 'Unpin' : 'Pin: always keep in mind'} className="rounded-full p-1 text-muted hover:bg-white/5 hover:text-accent disabled:opacity-40">{it.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
                  <button type="button" disabled={busy} onClick={() => void act({ action: 'forget', id: it.id })} title="Forget this" className="rounded-full p-1 text-muted hover:bg-white/5 hover:text-down disabled:opacity-40"><Trash2 size={13} /></button>
                </div></div></div>))}
          {s!.items.length > 0 && (confirmClear
            ? <div className="flex items-center justify-between gap-2 rounded-lg border border-down/50 bg-down/10 px-2.5 py-2 text-xs"><span>Forget everything? This cannot be undone.</span>
                <span className="flex gap-1.5"><button type="button" disabled={busy} onClick={() => void act({ action: 'clear' }, () => setConfirmClear(false))} className="rounded-full border border-down/60 px-2.5 py-0.5 font-semibold text-down">Clear all</button><button type="button" onClick={() => setConfirmClear(false)} className="rounded-full border border-line px-2.5 py-0.5 text-muted">Cancel</button></span></div>
            : <button type="button" onClick={() => setConfirmClear(true)} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-down/60 hover:text-down"><Trash2 size={11} />Clear all memory</button>)}
        </div>)}
    </div>
  );
}
