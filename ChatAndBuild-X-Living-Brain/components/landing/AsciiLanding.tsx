'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ConnectButton } from '@/components/ConnectButton';
import { fmtNum, fmtPct } from '@/lib/format';

// The signed-out landing page, drawn in ASCII: a live heartbeat field, a block-letter banner, a ticker tape, a
// terminal market table and a typed agent log. All art is generated in code (no images), so it stays sharp and
// themable. Animation stops when the visitor prefers reduced motion.

type Ticker = { symbol: string; price: number | null; changePct: number | null };

// ── Block letters (ANSI Shadow style), joined row by row so the columns always line up ──
const GLYPHS: Record<string, string[]> = {
  P: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔═══╝ ', '██║     ', '╚═╝     '],
  U: ['██╗   ██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  K: ['██╗  ██╗', '██║ ██╔╝', '█████╔╝ ', '██╔═██╗ ', '██║  ██╗', '╚═╝  ╚═╝'],
  ' ': ['  ', '  ', '  ', '  ', '  ', '  '],
};
const banner = (word: string) => Array.from({ length: 6 }, (_, r) => [...word].map((ch) => GLYPHS[ch]?.[r] ?? '').join(''));

// ── Heartbeat field: an ECG trace sweeping right, over a faint drifting grid of dots ──
const RAMP = ' .·:-=+*#%@';
function ecg(x: number): number {
  // One beat per unit: small P wave, sharp QRS spike, T wave. Returns -1..1 (up is positive).
  const p = x - Math.floor(x);
  const g = (c: number, w: number, a: number) => a * Math.exp(-((p - c) ** 2) / (2 * w * w));
  return g(0.18, 0.025, 0.18) + g(0.30, 0.008, -0.25) + g(0.33, 0.009, 1.0) + g(0.36, 0.01, -0.4) + g(0.58, 0.05, 0.32);
}
function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => { const m = window.matchMedia('(prefers-reduced-motion: reduce)'); setR(m.matches); const f = () => setR(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return r;
}

function PulseField({ heat }: { heat: number }) {
  const pre = useRef<HTMLPreElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    let raf = 0; let cols = 100; let rows = 22; let last = 0;
    const measure = () => {
      const el = box.current; if (!el) return;
      const cw = window.innerWidth < 640 ? 6.6 : 8.4; const ch = window.innerWidth < 640 ? 11 : 14;
      cols = Math.max(40, Math.floor(el.clientWidth / cw)); rows = Math.max(12, Math.floor(el.clientHeight / ch));
    };
    measure(); window.addEventListener('resize', measure);
    const draw = (tms: number) => {
      raf = requestAnimationFrame(draw);
      if (tms - last < 45) return; last = tms;                       // ~22 fps is plenty for text
      const t = reduced ? 0 : tms / 1000;
      const mid = rows * 0.55; const amp = rows * 0.42;
      const speed = 0.55 + heat * 0.6;                                // a falling market beats faster
      const head = reduced ? cols : ((t * 28 * speed) % (cols + 30));  // the bright sweep position
      let out = '';
      for (let y = 0; y < rows; y++) {
        let line = '';
        for (let x = 0; x < cols; x++) {
          const v = mid - ecg(x / 34 - t * speed * 0.15) * amp;       // trace row at this column
          const d = Math.abs(y - v);
          const behind = head - x;                                     // fresh trace just behind the sweep is brightest
          const fade = behind >= 0 ? Math.max(0.3, 1 - behind / (cols * 1.2)) : 0.3;
          let k = d < 0.7 ? 10 : d < 1.5 ? 8 : d < 2.6 ? 4 : 0;
          k = Math.round(k * fade);
          if (k === 0 && (x * 7 + y * 13 + Math.floor(t * 2)) % 53 === 0) k = 1;   // drifting grid dust
          if (x === Math.floor(head) && d < 2.5) k = 10;
          line += RAMP[Math.min(RAMP.length - 1, k)];
        }
        out += line + '\n';
      }
      if (pre.current) pre.current.textContent = out;
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure); };
  }, [reduced, heat]);
  return (
    <div ref={box} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden [mask-image:radial-gradient(ellipse_at_center,black_45%,transparent_90%)]">
      <pre ref={pre} className="select-none font-mono text-[11px] leading-[11px] text-accent/70 sm:text-[14px] sm:leading-[14px]" />
    </div>
  );
}

// ── ASCII bar for a % move: ▓ right for gains, ░ left for losses, centred on a │ ──
function bar(pct: number | null, half = 8): string {
  const n = Math.min(half, Math.round(Math.abs(pct ?? 0) / 1.25));
  return (pct ?? 0) < 0 ? ' '.repeat(half - n) + '░'.repeat(n) + '│' + ' '.repeat(half) : ' '.repeat(half) + '│' + '▓'.repeat(n) + ' '.repeat(half - n);
}

// ── Typed agent log (illustrative copy of what the agent prints; real numbers appear after you connect) ──
const LOG = [
  '$ pulse agent --watch',
  '› read BNB · perps · options subs ...... ok',
  '› live vol from perps candles ........... ok',
  '› proxies MSTR→BTC SPY→US500 ............ ok',
  '› 99% loss vs your limit ....... hedge needed',
  '› venues  perp ✓  put ✓  proxy ✓  + payoff',
  '› request posted · waiting for Approve',
];
function TypedLog() {
  const reduced = useReducedMotion();
  const full = LOG.join('\n');
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) { setN(full.length); return; }
    let i = 0; const id = setInterval(() => { i = i >= full.length + 60 ? 0 : i + 2; setN(Math.min(i, full.length)); }, 28);
    return () => clearInterval(id);
  }, [reduced, full]);
  return <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-up/90 sm:text-xs">{full.slice(0, n)}<span className="animate-pulse text-accent">▌</span></pre>;
}

function Frame({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('relative min-w-0 rounded-lg border border-line bg-bg/80 p-4 pt-5 font-mono backdrop-blur', className)}>
      <span className="absolute -top-2.5 left-3 bg-bg px-1.5 text-[11px] uppercase tracking-[0.2em] text-accent">┤ {title} ├</span>
      {children}
    </div>
  );
}

export function AsciiLanding({ tickers }: { tickers: Ticker[] }) {
  const list = tickers.filter((t) => t.price !== null).slice(0, 12);
  const avg = list.length ? list.reduce((a, t) => a + (t.changePct ?? 0), 0) / list.length : 0;
  const heat = Math.min(1, Math.max(0, -avg / 8));                    // 0 calm .. 1 sharp sell-off
  const tape = useMemo(() => list.map((t) => `[ ${t.symbol} ${fmtNum(t.price)} ${(t.changePct ?? 0) >= 0 ? '▲' : '▼'}${Math.abs(t.changePct ?? 0).toFixed(2)}% ]`).join('   '), [list]);
  const pulse = banner('PULSE'); const risk = banner('RISK');

  return (
    <div className="mx-auto -mt-2 w-full min-w-0 max-w-6xl space-y-6 overflow-x-hidden pb-16">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-[#07090d] px-4 pb-10 pt-12 sm:px-8 sm:pt-16">
        <PulseField heat={heat} />
        <div className="relative text-center">
          <div className="mb-5 font-mono text-[10px] uppercase tracking-[0.35em] text-muted sm:text-xs">bnb chain · perps · options · one agent</div>
          <pre aria-label="Pulse Risk" style={{ fontFamily: 'Menlo, "SF Mono", Consolas, "DejaVu Sans Mono", monospace' }} className="mx-auto inline-block text-left text-[5px] leading-[6px] text-accent drop-shadow-[0_0_12px_rgba(240,185,11,0.35)] min-[420px]:text-[7px] min-[420px]:leading-[8px] sm:text-[11px] sm:leading-[12px] lg:text-[13px] lg:leading-[14px]">
            {pulse.map((r, i) => <div key={`p${i}`}>{r}{'  '}{risk[i]}</div>)}
          </pre>
          <h1 className="no-prompt mx-auto mt-6 max-w-2xl text-2xl font-semibold tracking-tight [text-shadow:0_2px_18px_#07090d,0_0_4px_#07090d] sm:text-4xl">
            Your stocks, perps and options. <span className="text-accent">One pulse.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-2xl rounded-lg bg-[#07090d]/70 px-2 text-sm text-muted sm:text-base">
            Hold tokenized stocks on BNB Chain as collateral, trade perps and options, and let an agent hedge your book and keep margin topped up. Every hedge comes with its payoff and why that venue. Nothing moves without your OK.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <ConnectButton />
            <Link href="/trade/spot/NVDAB" className="rounded-full border border-line px-4 py-2 font-mono text-sm text-muted hover:border-accent hover:text-accent">./browse-markets →</Link>
          </div>
        </div>
      </section>

      {/* Ticker tape */}
      {tape && (
        <div className="relative overflow-hidden rounded-lg border border-line bg-bg py-2 font-mono text-xs [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
          <div className="flex w-max animate-[tape_40s_linear_infinite] gap-10 whitespace-nowrap motion-reduce:animate-none">
            {[0, 1].map((k) => <span key={k} className="text-muted">{list.map((t) => (
              <span key={`${k}${t.symbol}`} className="mr-8">[ <span className="text-white">{t.symbol}</span> {fmtNum(t.price)} <span className={(t.changePct ?? 0) >= 0 ? 'text-up' : 'text-down'}>{(t.changePct ?? 0) >= 0 ? '▲' : '▼'}{Math.abs(t.changePct ?? 0).toFixed(2)}%</span> ]</span>
            ))}</span>)}
          </div>
        </div>
      )}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Market table */}
        <Frame title="bStocks · live">
          <div className="overflow-x-auto">
            <div className="min-w-[420px] text-xs">
              <div className="grid grid-cols-[5.5rem_5rem_4.5rem_1fr] gap-2 border-b border-dashed border-line pb-1.5 text-muted"><span>SYMBOL</span><span className="text-right">PRICE</span><span className="text-right">24H</span><span className="pl-2">-10% ··· 0 ··· +10%</span></div>
              {list.length ? list.map((t) => (
                <Link key={t.symbol} href={`/trade/spot/${t.symbol}`} className="grid grid-cols-[5.5rem_5rem_4.5rem_1fr] items-center gap-2 py-1 hover:bg-white/[0.03]">
                  <span className="text-white">{t.symbol}</span>
                  <span className="text-right tabular-nums">{fmtNum(t.price)}</span>
                  <span className={clsx('text-right tabular-nums', (t.changePct ?? 0) >= 0 ? 'text-up' : 'text-down')}>{fmtPct(t.changePct)}</span>
                  <span className={clsx('whitespace-pre pl-2', (t.changePct ?? 0) >= 0 ? 'text-up' : 'text-down')}>{bar(t.changePct)}</span>
                </Link>
              )) : <div className="py-6 text-center text-muted">loading quotes<span className="animate-pulse">…</span></div>}
            </div>
          </div>
        </Frame>

        <div className="min-w-0 space-y-6">
          <Frame title="agent · stdout"><TypedLog /></Frame>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            {[
              ['01', 'Collateral', 'bStocks on BNB back your perps and options.'],
              ['02', 'Hedge', 'Perp, put or proxy, with the payoff before and after.'],
              ['03', 'Approve', 'The agent asks; you decide. Or switch it to Auto.'],
            ].map(([n, t, d]) => (
              <div key={n} className="rounded-lg border border-line bg-bg p-3 font-mono">
                <div className="text-[11px] text-accent">┌─ {n} ─────</div>
                <div className="mt-1 text-sm text-white">{t}</div>
                <div className="mt-1 text-[11px] leading-4 text-muted">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
