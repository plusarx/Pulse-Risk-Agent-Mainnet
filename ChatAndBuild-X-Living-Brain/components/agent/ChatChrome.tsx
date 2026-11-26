'use client';
import { useEffect, useState } from 'react';

// Small pieces of the Pulse chat's terminal look: the working indicator, the empty state with quick prompts.

const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const STAGES = ['reading your live accounts', 'measuring volatility', 'checking perps and options', 'running the hedging agent', 'comparing venues', 'writing the answer'];

/** Replaces "Thinking...": a spinner, the stage it is likely on, and elapsed seconds (long answers take a minute). */
export function Working() {
  const [t, setT] = useState(0);
  useEffect(() => { const s = Date.now(); const id = setInterval(() => setT(Date.now() - s), 100); return () => clearInterval(id); }, []);
  const sec = Math.floor(t / 1000);
  const stage = STAGES[Math.min(STAGES.length - 1, Math.floor(sec / 6))];
  return (
    <div className="mr-6 rounded-xl border border-line bg-bg/60 px-3 py-2.5 font-mono text-[12px]">
      <div className="flex items-center gap-2 text-accent">
        <span className="w-3 text-center">{SPIN[Math.floor(t / 90) % SPIN.length]}</span>
        <span className="text-white">pulse</span><span className="text-muted">›</span><span className="text-muted">{stage}…</span>
        <span className="ml-auto tabular-nums text-muted">{sec}s</span>
      </div>
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-line">
        <div className="h-full w-1/3 animate-[scan_1.4s_ease-in-out_infinite] rounded-full bg-accent/70 motion-reduce:animate-none" />
      </div>
    </div>
  );
}

const PROMPTS = [
  ['Hedge my portfolio', 'runs the agent on your live numbers'],
  ['What is my risk right now?', 'modelled loss vs your limit'],
  ['Price an NVDA put for my holding', 'live perp quote + payoff'],
  ['What is waiting for my approval?', 'requests with Approve / Reject'],
] as const;

/** First screen of the chat: who Pulse is and one-tap prompts. */
export function ChatIntro({ onAsk }: { onAsk: (q: string) => void }) {
  return (
    <div className="space-y-3">
      <pre aria-hidden className="select-none overflow-hidden font-mono text-[10px] leading-[11px] text-accent/80">{`   _    ___       _
──/ \\  /   \\   __/ \\_____
     \\/     \\_/       pulse`}</pre>
      <div className="font-mono text-sm text-white">$ hello, I&apos;m pulse</div>
      <p className="text-[13px] leading-5 text-muted">I watch your bStocks, perps and options accounts, propose hedges with their payoff, and place trades only after you press Approve. Ask anything, or try:</p>
      <div className="grid gap-2">
        {PROMPTS.map(([q, hint]) => (
          <button key={q} type="button" onClick={() => onAsk(q)}
            className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2.5 text-left transition hover:border-accent/60 hover:bg-accent/[0.06] focus:border-accent focus:outline-none">
            <span><span className="block text-[13px] text-white">{q}</span><span className="block font-mono text-[10px] text-muted">{hint}</span></span>
            <span className="font-mono text-xs text-muted transition group-hover:translate-x-0.5 group-hover:text-accent">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
