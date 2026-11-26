'use client';
import { useMemo, useRef, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import clsx from 'clsx';
import { useVenueNetwork } from '@/lib/network';
import { derivePublic, useAsterMarkets } from '@/lib/hooks/useVenues';
import { useBStockTickers } from '@/lib/hooks/useBStockTickers';
import { LegBuilder, VENUE_NAME, type WhatIfLeg } from './LegBuilder';
import type { RiskAccount } from '@/lib/hooks/useRiskAccounts';
import { bstockBySymbol } from '@/lib/bstocks';
import { planRule, ruleKey, type RiskRule } from '@/lib/risk-rules';
import { bs, curve, firstCrossing, legGreeks, maxDaysToExpiry, parseDeriveOption, pnl, totalGreeks, underlyingOf, type Leg } from '@/lib/scenario';
import { fmtNum, fmtUsd, priceDecimals } from '@/lib/format';

interface Slim { I: string; M: string; option_pricing?: { d: string; g: string; v: string; t: string; i: string; m: string; f: string } | null }

/**
 * Options are priced off Derive's FORWARD (option_pricing.f), not the index: checked live on mainnet 2026-11-23
 * against ETH-20261204-1650/1700/1750-C, our Black-Scholes matched Derive's mark within 0.1% and its delta, gamma,
 * vega (per vol point) and theta (per day) to 4 significant figures.
 */
const fwd = (t: Slim) => Number(t.option_pricing?.f) || Number(t.I);
interface Stock { symbol: string; qty: number; price: number | null }

const W = 760, H = 330, PADL = 64, PADR = 20, PADT = 20, PADB = 46;

/**
 * Scenario forecast: payoff of everything on one underlying (Derive options repriced with Black-Scholes at their
 * live mark IV, perps and bStocks linearly) across a spot move, a time step and a vol shift,
 * with each account's liquidation and rebalance-trigger points marked.
 */
export function ScenarioForecast({ accounts, rules, stocks, initialLegs = [] }: { accounts: RiskAccount[]; rules: RiskRule[]; stocks: Stock[]; initialLegs?: WhatIfLeg[] }) {
  const { network } = useVenueNetwork();
  const [whatIf, setWhatIf] = useState<WhatIfLeg[]>(initialLegs);
  const perpMarkets = useAsterMarkets();
  const bTickers = useBStockTickers();
  const nowMs = useMemo(() => Date.now(), []);

  // Option instruments we need live IV / index / greeks for (held + what-if).
  const optionNames = useMemo(() => [...new Set([
    ...accounts.flatMap((a) => a.positions.filter((p) => p.kind === 'option').map((p) => p.market)),
    ...whatIf.filter((w) => w.venue === 'derive-option').map((w) => w.instrument),
  ])], [accounts, whatIf]);
  const tickerQs = useQueries({
    queries: optionNames.map((name) => ({
      queryKey: ['dticker', network, name], refetchInterval: 15_000,
      queryFn: () => derivePublic<Slim>(network, 'public/get_ticker', { instrument_name: name }),
    })),
  });
  const tickers = Object.fromEntries(optionNames.map((n, i) => [n, tickerQs[i]?.data]));

  /** Live price for a what-if leg (option = Derive mark; perps = mark; bStock = Binance last). */
  function whatIfPrice(w: WhatIfLeg): number | null {
    if (w.venue === 'derive-option') return tickers[w.instrument]?.option_pricing ? Number(tickers[w.instrument]!.option_pricing!.m) : null;
    if (w.venue === 'perp') { const m = perpMarkets.data?.find((x) => x.ticker === w.underlying); return m ? m.mark ?? m.last : null; }
    return bTickers.data?.find((t) => t.symbol === w.instrument)?.price ?? null;
  }

  // All legs, grouped by underlying.
  const legs = useMemo(() => {
    const out: Leg[] = [];
    for (const a of accounts) {
      for (const p of a.positions) {
        const sign = p.side === 'long' ? 1 : -1;
        const opt = p.kind === 'option' ? parseDeriveOption(p.market) : null;
        const t = tickers[p.market];
        if (opt) {
          if (!t?.option_pricing) continue; // wait for live IV; never guess a vol
          out.push({ kind: 'option', id: `${a.key}:${p.market}`, account: a.title, label: p.market, type: opt.type, strike: opt.strike, expiryMs: opt.expiryMs,
            amount: sign * p.size, iv: Number(t.option_pricing.i), spot0: fwd(t), mark: Number(t.option_pricing.m),
            live: { delta: Number(t.option_pricing.d), gamma: Number(t.option_pricing.g), vega: Number(t.option_pricing.v), theta: Number(t.option_pricing.t) } });
        } else if (p.markPrice) {
          out.push({ kind: 'linear', id: `${a.key}:${p.market}`, account: a.title, label: p.market, amount: sign * p.size, price0: p.markPrice });
        }
      }
    }
    for (const s of stocks) {
      const b = bstockBySymbol(s.symbol);
      if (b && s.price && s.qty > 0) out.push({ kind: 'linear', id: `bnb:${s.symbol}`, account: 'BNB wallet', label: s.symbol, amount: s.qty, price0: s.price });
    }
    for (const w of whatIf) {
      const amount = w.side === 'buy' ? w.size : -w.size;
      const base = { id: `whatif:${w.id}`, account: `What-if · ${VENUE_NAME[w.venue]}`, label: w.instrument, underlying: w.underlying };
      if (w.venue === 'derive-option') {
        const opt = parseDeriveOption(w.instrument); const t = tickers[w.instrument];
        if (opt && t?.option_pricing) out.push({ ...base, kind: 'option', type: opt.type, strike: opt.strike, expiryMs: opt.expiryMs,
          amount, iv: Number(t.option_pricing.i), spot0: fwd(t), mark: Number(t.option_pricing.m),
          live: { delta: Number(t.option_pricing.d), gamma: Number(t.option_pricing.g), vega: Number(t.option_pricing.v), theta: Number(t.option_pricing.t) } });
      } else {
        const px = whatIfPrice(w);
        if (px) out.push({ ...base, kind: 'linear', amount, price0: px });
      }
    }
    return out;
  }, [accounts, stocks, whatIf, tickers, perpMarkets.data, bTickers.data]);

  const keyOf = (l: Leg) => l.underlying ?? (l.account === 'BNB wallet' ? bstockBySymbol(l.label)?.underlying ?? l.label : underlyingOf(l.label));
  const underlyings = useMemo(() => [...new Set(legs.map(keyOf))].sort(), [legs]);
  const [picked, setPicked] = useState<string | null>(null);
  const u = picked && underlyings.includes(picked) ? picked : underlyings[0] ?? null;
  const uLegs = legs.filter((l) => keyOf(l) === u);

  const maxDays = Math.max(1, maxDaysToExpiry(uLegs, nowMs) || 30);
  const [range, setRange] = useState(30);
  const [days, setDays] = useState(0);
  const [ivPts, setIvPts] = useState(0);
  const [hover, setHover] = useState<number | null>(null); // move under the cursor
  const d = Math.min(days, maxDays);
  const iv = ivPts / 100;
  const R = range / 100;
  const hasOptions = uLegs.some((l) => l.kind === 'option');

  const firstOpt = uLegs.find((l) => l.kind === 'option');
  const idx = firstOpt ? Number(tickers[firstOpt.label]?.I) || null : null;
  const spot0 = idx ?? (uLegs.find((l) => l.kind === 'linear') as Extract<Leg, { kind: 'linear' }> | undefined)?.price0 ?? null;
  const N = 120;
  const series = useMemo(() => {
    if (!uLegs.length) return [];
    const s = [{ id: 'now', label: `Now${ivPts ? ` (IV ${ivPts > 0 ? '+' : ''}${ivPts})` : ''}`, color: 'var(--line-now)', dash: '', pts: curve(uLegs, R, N, 0, iv, nowMs) }];
    if (d > 0 && d < maxDays) s.push({ id: 'fwd', label: `+${d}d`, color: 'var(--line-fwd)', dash: '6 4', pts: curve(uLegs, R, N, d, iv, nowMs) });
    if (hasOptions) s.push({ id: 'exp', label: 'At expiry', color: 'var(--line-exp)', dash: '2 4', pts: curve(uLegs, R, N, maxDays, iv, nowMs) });
    return s;
  }, [uLegs, R, d, iv, ivPts, maxDays, hasOptions, nowMs]);

  // Markers: venue-reported liquidation prices, and where each rule's trigger would fire.
  const markers = useMemo(() => {
    const out: { move: number; label: string; kind: 'liq' | 'trigger' }[] = [];
    for (const a of accounts) {
      for (const p of a.positions) {
        if (keyOf({ kind: 'linear', id: '', account: a.title, label: p.market, amount: 0, price0: 0 }) !== u) continue;
        if (p.liqPrice && p.markPrice) {
          const m = p.liqPrice / p.markPrice - 1;
          if (Math.abs(m) <= R) out.push({ move: m, label: `Liq ${a.title.replace(/^(Perps|Options|Lighter|Derive) · /, '')}`, kind: 'liq' });
        }
      }
      const rule = rules.find((r) => ruleKey(r) === a.key);
      const aLegs = uLegs.filter((l) => l.account === a.title);
      if (!rule || !aLegs.length || a.health.accountUsd === null) continue;
      const bad = (m: number) => {
        const eq = a.health.accountUsd! + pnl(aLegs, { move: m, days: d, ivShift: iv }, nowMs);
        const util = eq > 0 ? Math.round(((a.health.usedUsd ?? 0) / eq) * 10_000) : 10_000;
        return planRule({ ...rule, enabled: true, releaseOn: false }, { ...a.health, accountUsd: eq, utilBps: util }).kind === 'top_up';
      };
      if (bad(0)) continue; // already in the top-up zone: the card says so
      const c = firstCrossing(bad, R);
      for (const m of [c.down, c.up]) if (m !== null) out.push({ move: m, label: `Top-up ${a.title.replace(/^(Perps|Options|Lighter|Derive) · /, '')}`, kind: 'trigger' });
    }
    return out;
  }, [accounts, rules, uLegs, u, R, d, iv, nowMs]);

  // ── chart geometry ──
  const all = series.flatMap((s) => s.pts.map((p) => p.pnl));
  const yMin = Math.min(0, ...all), yMax = Math.max(0, ...all);
  const pad = (yMax - yMin) * 0.08 || 1;
  const Y0 = yMin - pad, Y1 = yMax + pad;
  const x = (m: number) => PADL + ((m + R) / (2 * R)) * (W - PADL - PADR);
  const y = (v: number) => PADT + (1 - (v - Y0) / (Y1 - Y0)) * (H - PADT - PADB);
  const svgRef = useRef<SVGSVGElement>(null);
  const onMove = (e: React.MouseEvent) => {
    const r = svgRef.current?.getBoundingClientRect(); if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const m = Math.max(-R, Math.min(R, ((px - PADL) / (W - PADL - PADR)) * 2 * R - R));
    setHover(Math.round(m / ((2 * R) / N)) * ((2 * R) / N));
  };
  const at = hover ?? 0;
  const yTicks = 5;
  const greekShock = { move: at, days: d, ivShift: iv };
  const tot = totalGreeks(uLegs, greekShock, nowMs);
  const dp = priceDecimals(spot0 ?? 1);

  return (
    <section className="panel p-5" style={{ ['--line-now' as string]: '#60a5fa', ['--line-fwd' as string]: '#22d3ee', ['--line-exp' as string]: '#9ca3af' }}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Scenario forecast</h3>
          <p className="text-[11px] text-muted">Options repriced with Black-Scholes at the live options mark IV; perps and bStocks linear. Hover the chart to read any point.</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {underlyings.map((x) => (
            <button key={x} onClick={() => { setPicked(x); setHover(null); }} className={clsx('pill text-xs', x === u ? 'bg-white text-black' : 'bg-panel2 text-[#c9ccd6]')}>{x}</button>
          ))}
        </div>
      </div>

      {!u ? (
        <div className="rounded-xl bg-bg p-6 text-center text-sm text-muted">No open positions yet. Build a strategy below to see its payoff and greeks.</div>
      ) : (
        <>
          <div className="mb-3 grid gap-3 text-xs sm:grid-cols-3">
            <label className="block"><span className="text-muted">Spot range ±{range}%</span>
              <input type="range" min={5} max={60} value={range} onChange={(e) => { setRange(+e.target.value); setHover(null); }} className="w-full accent-[#60a5fa]" /></label>
            <label className={clsx('block', !hasOptions && 'opacity-50')}><span className="text-muted">Time forward: {d === 0 ? 'today' : `+${d} day${d === 1 ? '' : 's'}`}{hasOptions ? ` (last expiry in ${maxDays}d)` : ''}</span>
              <input type="range" min={0} max={maxDays} value={d} onChange={(e) => setDays(+e.target.value)} disabled={!hasOptions} className="w-full accent-[#22d3ee]" /></label>
            <label className={clsx('block', !hasOptions && 'opacity-50')}><span className="text-muted">Volatility shift: {ivPts > 0 ? '+' : ''}{ivPts} vol pts</span>
              <input type="range" min={-30} max={30} value={ivPts} onChange={(e) => setIvPts(+e.target.value)} disabled={!hasOptions} className="w-full accent-[#f0b90b]" /></label>
          </div>

          <div className="relative">
            <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full select-none" onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img" aria-label={`${u} payoff`}>
              {Array.from({ length: yTicks + 1 }, (_, i) => Y0 + ((Y1 - Y0) * i) / yTicks).map((v) => (
                <g key={v}><line x1={PADL} x2={W - PADR} y1={y(v)} y2={y(v)} stroke="#23252e" /><text x={PADL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#8a8f9c">{fmtUsd(v, Math.abs(Y1 - Y0) < 20 ? 2 : 0)}</text></g>
              ))}
              <line x1={PADL} x2={W - PADR} y1={y(0)} y2={y(0)} stroke="#4b5060" />
              {[-R, -R / 2, 0, R / 2, R].map((m) => (
                <g key={m}><line x1={x(m)} x2={x(m)} y1={PADT} y2={H - PADB} stroke="#1c1e26" />
                  <text x={x(m)} y={H - PADB + 16} textAnchor="middle" fontSize="11" fill="#8a8f9c">{m > 0 ? '+' : ''}{(m * 100).toFixed(0)}%</text>
                  {spot0 && <text x={x(m)} y={H - PADB + 31} textAnchor="middle" fontSize="10.5" fill="#6b7080">{fmtNum(spot0 * (1 + m), dp)}</text>}</g>
              ))}
              {markers.map((mk, i) => (
                <g key={i}><line x1={x(mk.move)} x2={x(mk.move)} y1={PADT} y2={H - PADB} stroke={mk.kind === 'liq' ? '#ff5b5b' : '#f0b90b'} strokeDasharray="3 3" />
                  <text x={x(mk.move) + 4} y={PADT + 12 + (i % 3) * 13} fontSize="10.5" fill={mk.kind === 'liq' ? '#ff5b5b' : '#f0b90b'}>{mk.label}</text></g>
              ))}
              {series.map((s) => (
                <path key={s.id} d={s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.move).toFixed(1)} ${y(p.pnl).toFixed(1)}`).join('')} fill="none" stroke={s.color} strokeWidth={s.id === 'now' ? 2.2 : 1.6} strokeDasharray={s.dash} />
              ))}
              <line x1={x(0)} x2={x(0)} y1={PADT} y2={H - PADB} stroke="#e8eaf0" strokeOpacity="0.35" />
              {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PADT} y2={H - PADB} stroke="#e8eaf0" strokeOpacity="0.6" />}
            </svg>
            <div className="pointer-events-none absolute left-[9.5%] top-2 rounded-lg bg-bg/90 px-3 py-2 text-xs ring-1 ring-line">
              <div className="mb-1 text-muted">{u} {at > 0 ? '+' : ''}{(at * 100).toFixed(1)}%{spot0 ? ` · ${fmtNum(spot0 * (1 + at), dp)}` : ''}</div>
              {series.map((s) => { const p = s.pts.reduce((b, q) => (Math.abs(q.move - at) < Math.abs(b.move - at) ? q : b), s.pts[0]); return (
                <div key={s.id} className="flex items-center justify-between gap-4 num"><span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-3" style={{ background: s.color }} />{s.label}</span><span className={p.pnl >= 0 ? 'text-up' : 'text-down'}>{fmtUsd(p.pnl)}</span></div>); })}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-4 text-[11px] text-muted">
            <span><span className="text-down">┆</span> liquidation (venue-reported)</span><span><span className="text-accent">┆</span> rebalance top-up would fire</span><span>PnL vs the model value now; perps/bStocks move with the same %.</span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <div className="mb-1 text-xs text-muted">Greeks at {at === 0 ? 'current spot' : `${at > 0 ? '+' : ''}${(at * 100).toFixed(1)}%`}{d ? `, +${d}d` : ''}{ivPts ? `, IV ${ivPts > 0 ? '+' : ''}${ivPts}` : ''} (position-weighted) · <span className="text-white">Options live</span> shown under each option</div>
            <table className="w-full min-w-[760px] text-xs num">
              <thead><tr>{['Leg', 'Account', 'Size', 'IV', 'Model / mark', 'Δ (units)', 'Δ $ per 1%', 'Γ', 'Vega / vol pt', 'Θ / day'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>
                {uLegs.map((l) => {
                  const g = legGreeks(l, greekShock, nowMs);
                  const opt = l.kind === 'option' ? l : null;
                  return (
                    <tr key={l.id} className="border-t border-line/60 align-top">
                      <td className="td">{l.label}</td><td className="td text-muted">{l.account}</td><td className={clsx('td', l.amount >= 0 ? 'text-up' : 'text-down')}>{fmtNum(l.amount, 4)}</td>
                      <td className="td">{opt ? `${(opt.iv * 100).toFixed(1)}%` : '—'}</td>
                      <td className="td">{opt ? <>{fmtNum(bs(opt.type, opt.spot0, opt.strike, Math.max(0, (opt.expiryMs - nowMs) / (365 * 86_400_000)), opt.iv).price, 2)}<div className="text-[10px] text-muted">mark {opt.mark !== undefined ? fmtNum(opt.mark, 2) : '—'}</div></> : '—'}</td>
                      <td className="td">{fmtNum(g.delta, 4)}{opt?.live?.delta !== undefined && <div className="text-[10px] text-muted">live {fmtNum(opt.live.delta * opt.amount, 4)}</div>}</td>
                      <td className="td">{fmtUsd(g.deltaUsd1pct)}</td>
                      <td className="td">{opt ? fmtNum(g.gamma, 6) : '—'}{opt?.live?.gamma !== undefined && <div className="text-[10px] text-muted">live {fmtNum(opt.live.gamma * opt.amount, 6)}</div>}</td>
                      <td className="td">{opt ? fmtUsd(g.vega) : '—'}{opt?.live?.vega !== undefined && <div className="text-[10px] text-muted">live {fmtUsd(opt.live.vega * opt.amount)}</div>}</td>
                      <td className="td">{opt ? fmtUsd(g.theta) : '—'}{opt?.live?.theta !== undefined && <div className="text-[10px] text-muted">live {fmtUsd(opt.live.theta * opt.amount)}</div>}</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-line font-semibold">
                  <td className="td" colSpan={5}>Total {u}</td>
                  <td className="td">{fmtNum(tot.delta, 4)}</td><td className="td">{fmtUsd(tot.deltaUsd1pct)}</td><td className="td">{fmtNum(tot.gamma, 6)}</td><td className="td">{fmtUsd(tot.vega)}</td><td className="td">{fmtUsd(tot.theta)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      <LegBuilder legs={whatIf} perpMarkets={perpMarkets.data} priceOf={whatIfPrice}
        onChange={(next) => { const added = next.find((x) => !whatIf.some((y) => y.id === x.id)); setWhatIf(next); if (added) { setPicked(added.underlying); setHover(null); } }} />
    </section>
  );
}
