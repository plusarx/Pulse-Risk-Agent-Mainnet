'use client';
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { usePathname, useRouter } from 'next/navigation';
import { Check, ChevronDown, Send, Trash2, Wallet, X } from 'lucide-react';
import { PORTFOLIO_HASH, scrollToPortfolio } from '@/lib/portfolio-link';
import { getJson } from '@/lib/hooks/useVenues';
import { HedgeCard, Markdown, type CardScenario } from './HedgeCard';
import { PayoffChart, type PayoffData } from './PayoffChart';
import { ChatIntro, Working } from './ChatChrome';
import { LogoMark } from '@/components/Logo';
import { VenueAlternatives } from './VenueAlternatives';
import type { VenueAlternative } from '@/lib/agent-action';

// A compact "Ask agent" dropdown at the bottom right of every page. The agent decides what it needs: a greeting gets a plain reply, a question about
// your money reads your portfolio, a "what if" or a portfolio you type runs the real hedging agent on those numbers. When something waits for you it
// shows Approve and Decline here; in autonomous mode it shows what the agent has been doing. The chat itself never trades.
const usd = (n: number | null | undefined, dp = 0) => (n === null || n === undefined ? '-' : `$${n.toLocaleString('en-US', { maximumFractionDigits: dp })}`);
interface Fact { id: string; label: string; value: string }
type Scenario = CardScenario;
interface PutQuote { ticker: string; instrument: string; expiry: string; strike: number; contracts: number; ask: number; iv: number; premiumUsd: number; feesUsd: number; coverUsd: number; holdingUsd: number; minContracts: number; oversized: boolean; payoff: PayoffData }
interface Pending { payoff?: PayoffData | null; alternatives?: VenueAlternative[]; id: number; title: string; why: string; helps: string; willDo: string[]; plan: { cost?: { premiumUsd: number; feesUsd: number }; varBeforePct?: number; varAfterPct?: number; limitPct?: number; instrument?: string; sizeUsd?: number; marginPlan?: { moveUsd: number; from: string; to: string } | null } | null }
interface Activity { actions: { id: number; status: string; title: string; created_at: number }[]; events: { id: number; kind: string; status: string | null; message: string; created_at: number }[] }
interface Reply { answer: string; cites: Fact[]; unsure: boolean; unsureReason: string | null; source: 'live' | null; sourceNote: string | null; steps: { tool: string; label: string }[]; scenarios: Scenario[]; quotes?: PutQuote[]; usedTools: boolean; pending: Pending[]; activity: Activity | null }
interface Msg { role: 'user' | 'agent'; text: string; reply?: Reply; decided?: Record<number, string> }
const ago = (t: number) => { const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 172800 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };

/** A request posted before payoffs were attached: reuse the payoff from this reply's run on the same name, if any. */
function payoffFor(title: string, scenarios: Scenario[]): PayoffData | null {
  return scenarios.map((x) => x.payoff).find((po): po is PayoffData => !!po && new RegExp(`\\b${po.ticker}`).test(title)) ?? null;
}

export function ChatWidget() {
  const network = 'mainnet' as const;
  const [open, setOpen] = useState(false); const [msgs, setMsgs] = useState<Msg[]>([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [deciding, setDeciding] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // Resizable window: default 448 x 576; remembered per browser (a convenience only, so storage errors are ignored).
  const DEFAULT_SIZE = { w: 448, h: 576 };
  const [size, setSize] = useState(DEFAULT_SIZE);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem('pulse-chat-size') ?? 'null') as { w?: number; h?: number } | null; if (v?.w && v?.h) setSize({ w: v.w, h: v.h }); } catch { /* no saved size */ } }, []);
  const clampSize = (w: number, h: number) => ({ w: Math.round(Math.min(Math.max(w, 320), window.innerWidth - 32)), h: Math.round(Math.min(Math.max(h, 360), window.innerHeight - 96)) });
  const resetSize = () => { setSize(DEFAULT_SIZE); try { localStorage.removeItem('pulse-chat-size'); } catch { /* ignore */ } };
  const startResize = (axis: 'both' | 'w' | 'h') => (e: React.PointerEvent) => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, start = size; let last = start;
    const move = (ev: PointerEvent) => { last = clampSize(axis === 'h' ? start.w : start.w + (sx - ev.clientX), axis === 'w' ? start.h : start.h + (sy - ev.clientY)); setSize(last); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.userSelect = ''; try { localStorage.setItem('pulse-chat-size', JSON.stringify(last)); } catch { /* ignore */ } };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  // The whole widget (button and window) can be dragged anywhere so it never sits on top of what the user is reading. Drag the button or the window
  // header; a plain click still opens and closes. The spot is remembered, and kept on screen.
  const [pos, setPos] = useState({ x: 0, y: 0 }); const rootRef = useRef<HTMLDivElement>(null); const dragged = useRef(false);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem('pulse-chat-pos') ?? 'null') as { x?: number; y?: number } | null; if (typeof v?.x === 'number' && typeof v?.y === 'number') setPos({ x: v.x, y: v.y }); } catch { /* no saved spot */ } }, []);
  useEffect(() => {
    const id = requestAnimationFrame(() => { const r = rootRef.current?.getBoundingClientRect(); if (!r) return;
      const dx = r.left < 8 ? 8 - r.left : r.right > window.innerWidth - 8 ? window.innerWidth - 8 - r.right : 0; const dy = r.top < 8 ? 8 - r.top : r.bottom > window.innerHeight - 8 ? window.innerHeight - 8 - r.bottom : 0;
      if (dx || dy) setPos((p) => ({ x: p.x + dx, y: p.y + dy })); });
    return () => cancelAnimationFrame(id);
  }, [open, size.w, size.h]);
  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0 || !rootRef.current) return;
    const sx = e.clientX, sy = e.clientY, start = pos, r = rootRef.current.getBoundingClientRect(); let last = start; dragged.current = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy; if (!dragged.current && Math.hypot(dx, dy) < 4) return; dragged.current = true;
      last = { x: Math.min(Math.max(start.x + dx, start.x - r.left + 8), start.x + window.innerWidth - 8 - r.right), y: Math.min(Math.max(start.y + dy, start.y - r.top + 8), start.y + window.innerHeight - 8 - r.bottom) }; setPos(last);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.userSelect = ''; if (dragged.current) { try { localStorage.setItem('pulse-chat-pos', JSON.stringify(last)); } catch { /* ignore */ } } };
    document.body.style.userSelect = 'none'; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const router = useRouter(); const pathname = usePathname();
  const viewPortfolio = () => { setOpen(false); if (pathname === '/') scrollToPortfolio(); else router.push(`/${PORTFOLIO_HASH}`); };
  // Bumped by Clear chat, so a reply still in flight from the old conversation is dropped, not appended.
  const generation = useRef(0);
  const clearChat = () => { generation.current++; setMsgs([]); setText(''); setBusy(false); setDeciding(null); };
  useEffect(() => { if (open) end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs, busy, open]);

  async function send(q: string) {
    const message = q.trim(); if (!message || busy) return;
    const history = msgs.slice(-8).map((m) => ({ role: m.role, text: m.text.slice(0, 1600) }));
    setMsgs((m) => [...m, { role: 'user', text: message }]); setText(''); setBusy(true);
    const gen = generation.current;
    try {
      const reply = await getJson<Reply>('/api/agent/chat', { method: 'POST', body: JSON.stringify({ network, message, history }) });
      if (gen !== generation.current) return;
      setMsgs((m) => [...m, { role: 'agent', text: reply.answer, reply }]);
    } catch (e) { if (gen !== generation.current) return; setMsgs((m) => [...m, { role: 'agent', text: e instanceof Error ? e.message : String(e) }]); }
    finally { if (gen === generation.current) setBusy(false); }
  }
  async function decide(msgIndex: number, id: number, decision: 'approve' | 'reject') {
    setDeciding(id);
    let result: string;
    try { await getJson(`/api/agent/actions/${id}?network=${network}`, { method: 'POST', body: JSON.stringify({ decision }) }); result = decision === 'approve' ? 'Approved. The agent runs it on its next check (within about 30 seconds).' : 'Declined.'; }
    catch (e) { result = `Could not ${decision}: ${e instanceof Error ? e.message : String(e)}`; }
    setMsgs((m) => m.map((x, i) => (i === msgIndex ? { ...x, decided: { ...(x.decided ?? {}), [id]: result } } : x))); setDeciding(null);
  }

  return (
    <div ref={rootRef} style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }} className="fixed bottom-20 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div role="dialog" aria-label="Hedge agent chat" style={{ width: size.w, height: size.h }} className="relative flex max-h-[calc(100vh-6rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-line bg-[#07090d] shadow-[0_20px_60px_-10px_rgba(0,0,0,0.9)]">
          {/* Drag the top-left corner (or the left / top edge) to resize; the window stays anchored bottom-right. Double-click resets. */}
          <div aria-hidden onPointerDown={startResize('both')} onDoubleClick={resetSize} title="Drag to resize · double-click to reset" className="absolute left-0 top-0 z-10 h-4 w-4 cursor-nwse-resize rounded-br border-b border-r border-line/60 bg-line/30 hover:bg-accent/40" />
          <div aria-hidden onPointerDown={startResize('w')} onDoubleClick={resetSize} className="absolute bottom-4 left-0 top-4 z-10 w-1.5 cursor-ew-resize hover:bg-accent/30" />
          <div aria-hidden onPointerDown={startResize('h')} onDoubleClick={resetSize} className="absolute left-4 right-0 top-0 z-10 h-1.5 cursor-ns-resize hover:bg-accent/30" />
          <div onPointerDown={(e) => { if (!(e.target as HTMLElement).closest('button')) startDrag(e); }} title="Drag to move" className="flex cursor-grab touch-none items-center justify-between border-b border-dashed border-line bg-[#0a0d12] px-4 py-3 active:cursor-grabbing">
            <div className="flex min-w-0 items-center gap-2.5">
              <LogoMark size={26} />
              <div className="min-w-0">
                <div className="font-mono text-sm font-semibold tracking-wide text-white">pulse<span className="text-accent">_</span></div>
                <div className="flex items-center gap-1.5 truncate whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.15em] text-muted"><span className={clsx('h-1.5 w-1.5 rounded-full', busy ? 'animate-pulse bg-accent' : 'bg-up')} />{busy ? 'working' : 'online'} · hedge agent · {network}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={clearChat} disabled={!msgs.length && !busy} title="Clear chat" className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-down/60 hover:text-down disabled:opacity-30"><Trash2 size={12} />Clear chat</button>
              <button type="button" aria-label="Close chat" onClick={() => setOpen(false)} className="rounded-full p-1 text-muted hover:bg-white/5 hover:text-white"><X size={16} /></button>
            </div>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
            {msgs.length === 0 && !busy && <ChatIntro onAsk={(q) => void send(q)} />}
            {msgs.map((m, i) => m.role === 'user'
              ? <div key={i} className="ml-10 flex gap-2 rounded-xl border border-accent/25 bg-accent/[0.07] px-3 py-2 text-sm"><span className="font-mono text-accent">›</span><span className="min-w-0 flex-1 break-words">{m.text}</span></div>
              : (
                <div key={i} className="relative mr-3 rounded-xl border border-line bg-panel px-3 pb-2.5 pt-3.5 text-sm">
                  <span className="absolute -top-2 left-3 bg-[#07090d] px-1.5 font-mono text-[9px] uppercase tracking-[0.25em] text-accent">┤ pulse ├</span>
                  {m.reply && m.reply.steps.length > 0 && <div className="mb-2 flex flex-wrap gap-1">{m.reply.steps.map((s, k) => <span key={k} className="rounded-md border border-line bg-bg px-1.5 py-0.5 font-mono text-[10px] text-muted"><span className="text-up">✓</span> {s.label}</span>)}</div>}
                  <Markdown text={m.text} />
                  {m.reply?.unsure && <div className="mt-2 rounded-md bg-yellow-400/10 px-2 py-1 text-xs text-yellow-400">Not sure: {m.reply.unsureReason}</div>}
                  {m.reply?.quotes?.map((q) => (
                    <div key={q.instrument} className="space-y-1.5 rounded-xl border border-line bg-panel p-2.5 text-[11px]">
                      <div className="flex items-center justify-between"><span className="font-semibold">{q.instrument}</span><span className="text-muted">Options · live</span></div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                        <span className="text-muted">Contracts</span><span className="text-right">{q.contracts} at ${q.ask}</span>
                        <span className="text-muted">Premium + fees</span><span className="text-right font-semibold">${(q.premiumUsd + q.feesUsd).toFixed(2)}</span>
                        <span className="text-muted">Covers</span><span className="text-right">${q.coverUsd.toFixed(2)} of {q.ticker}</span>
                        <span className="text-muted">Implied vol</span><span className="text-right">{Math.round(q.iv * 100)}%</span>
                      </div>
                      {q.oversized && <div className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">The options minimum is {q.minContracts} contract (${q.coverUsd.toFixed(2)} of cover), more than your ${q.holdingUsd.toFixed(2)} of {q.ticker}.</div>}
                      <PayoffChart p={q.payoff} />
                    </div>
                  ))}
                  {m.reply?.scenarios.map((s, k) => {
                    // Approve / Reject lives on the request block below (one place, always visible), not inside the card's tabs.
                    const match = undefined;
                    return <HedgeCard key={k} s={s} pending={match} hasLiveRequest={(m.reply?.pending.length ?? 0) > 0} result={undefined} busy={false}
                      onApprove={(id) => void decide(i, id, 'approve')} onDecline={(id) => (id === null ? undefined : void decide(i, id, 'reject'))}
                      onEdit={(size) => void send(`Re-run that hedge on ${s.plan?.instrument ?? 'the same instrument'} with a size of $${size}`)} />;
                  })}
                  {m.reply?.pending.map((p) => { const pay = p.payoff ?? payoffFor(p.title, m.reply!.scenarios); return (
                    <div key={p.id} className="mt-2 rounded-lg border border-accent/50 bg-bg p-2.5 text-xs">
                      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-accent">Hedging request · approve or reject</div>
                      <div className="text-sm font-semibold">{p.title}</div>
                      {p.plan && <div className="mt-1 text-muted">{p.plan.instrument} {usd(p.plan.sizeUsd)}. Cost {usd((p.plan.cost?.premiumUsd ?? 0) + (p.plan.cost?.feesUsd ?? 0), 2)}. Modelled loss {p.plan.varBeforePct}% to {p.plan.varAfterPct}% (limit {p.plan.limitPct}%).{p.plan.marginPlan ? ` Moves ${usd(p.plan.marginPlan.moveUsd)} ${p.plan.marginPlan.from} to ${p.plan.marginPlan.to} first.` : ''}</div>}
                      {pay && <div className="mt-1.5"><PayoffChart p={pay} /></div>}
                      {p.alternatives?.length ? <div className="mt-1.5"><VenueAlternatives alts={p.alternatives} /></div> : null}
                      <details className="mt-1 text-muted"><summary className="cursor-pointer">Why and what runs</summary><p className="mt-1">{p.why}</p><ol className="mt-1 list-decimal pl-4">{p.willDo.map((x) => <li key={x}>{x}</li>)}</ol></details>
                      {m.decided?.[p.id]
                        ? <div className="mt-2 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-1 text-up"><Check size={13} />{m.decided[p.id]}</div>{m.decided[p.id].startsWith('Approved') && <button type="button" onClick={viewPortfolio} className="flex items-center gap-1.5 rounded-full border border-accent/60 bg-accent/10 px-3 py-1 font-mono text-[11px] font-semibold text-accent transition hover:bg-accent/20"><Wallet size={12} />view portfolio</button>}</div>
                        : <div className="mt-2 flex gap-2">
                            <button type="button" disabled={deciding === p.id} onClick={() => void decide(i, p.id, 'approve')} className="flex-1 rounded-full border border-up bg-up/20 py-1.5 text-sm font-semibold text-up">{deciding === p.id ? '...' : 'Approve'}</button>
                            <button type="button" disabled={deciding === p.id} onClick={() => void decide(i, p.id, 'reject')} className="flex-1 rounded-full border border-down/60 py-1.5 text-sm font-semibold text-down">{deciding === p.id ? '...' : 'Reject'}</button>
                          </div>}
                    </div>); })}
                  {m.reply?.activity && (
                    <div className="mt-2 rounded-lg border border-line bg-bg p-2.5 text-xs">
                      <div className="mb-1 font-semibold text-muted">Recent agent activity</div>
                      <ul className="space-y-1">{m.reply.activity.events.length === 0 && m.reply.activity.actions.length === 0 && <li className="text-muted">Nothing recorded yet.</li>}
                        {m.reply.activity.actions.map((a) => <li key={`a${a.id}`} className="flex justify-between gap-2"><span className="truncate">{a.title}</span><span className="shrink-0 text-muted">{a.status} · {ago(a.created_at)}</span></li>)}
                        {m.reply.activity.events.map((e) => <li key={`e${e.id}`} className="flex justify-between gap-2"><span className="truncate">{e.message}</span><span className="shrink-0 text-muted">{ago(e.created_at)}</span></li>)}</ul>
                    </div>)}
                  {m.reply && m.reply.usedTools && (
                    <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Data used ({m.reply.cites.length}){m.reply.source ? ' · live mainnet' : ''}</summary>
                      {m.reply.sourceNote && <div className="mt-1 text-yellow-400">{m.reply.sourceNote}</div>}
                      <ul className="mt-1 space-y-1">{m.reply.cites.map((c) => <li key={c.id}><span className="text-white">{c.label}:</span> {c.value}</li>)}{m.reply.cites.length === 0 && <li>No specific data was cited.</li>}</ul>
                    </details>)}
                </div>))}
            {busy && <Working />}
            <div ref={end} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="m-3 mt-1 flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 transition focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(240,185,11,0.10)]">
            <span className="font-mono text-sm text-accent">$</span>
            <input value={text} onChange={(e) => setText(e.target.value)} disabled={busy} placeholder={busy ? 'pulse is working…' : 'ask pulse anything — hedge, price a put, place a trade'} maxLength={1200} className="min-w-0 flex-1 bg-transparent font-mono text-[13px] caret-accent outline-none placeholder:text-muted/70" />
            <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-black transition hover:brightness-110 disabled:bg-line disabled:text-muted"><Send size={13} /></button>
          </form>
        </div>
      )}
      <button type="button" aria-label={open ? 'Close hedge agent chat' : 'Open hedge agent chat'} aria-expanded={open} onPointerDown={startDrag} title="Click to open · drag to move" onClick={() => { if (dragged.current) { dragged.current = false; return; } setOpen((o) => !o); }}
        className={clsx('group flex cursor-grab touch-none items-center gap-2 rounded-full border border-line bg-[#07090d] py-1.5 pl-1.5 pr-3.5 text-sm font-semibold text-white shadow-[0_6px_24px_rgba(0,0,0,0.7)] transition active:cursor-grabbing hover:border-white/25')}>
        <span className="relative"><LogoMark size={26} />{!open && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-up ring-2 ring-[#07090d]" />}</span>
        <span className="font-mono">ask pulse</span><ChevronDown size={15} className={clsx('text-muted transition-transform', !open && 'rotate-180')} />
      </button>
    </div>
  );
}
