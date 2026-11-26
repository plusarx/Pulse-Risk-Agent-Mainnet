'use client';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { healthScore, planRule, ruleKey, type RiskRule } from '@/lib/risk-rules';
import type { RiskAccount } from '@/lib/hooks/useRiskAccounts';
import { fmtUsd } from '@/lib/format';

// KPI strip + spot-shock scenario, after the original terminal's components/risk/RiskKpiStrip.tsx and ScenarioForecast.tsx.

function Card({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="panel space-y-2 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</p>
      {children}
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
const Bar = ({ pct, className }: { pct: number; className: string }) => (
  <div className="h-1 overflow-hidden rounded-full bg-panel2"><div className={clsx('h-full rounded-full transition-all', className)} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>
);

export function useRiskKpis(accounts: RiskAccount[], stocksValue: number, stocksCollateral: number, bscStables: number) {
  return useMemo(() => {
    const equity = accounts.reduce((a, x) => a + (x.health.accountUsd ?? 0), 0);
    const used = accounts.reduce((a, x) => a + (x.health.usedUsd ?? 0), 0);
    const positions = accounts.flatMap((a) => a.positions);
    const upnl = positions.reduce((a, p) => a + p.upnl, 0);
    const util = equity > 0 ? (used / equity) * 100 : null;
    // Nearest liquidation: |liq − mark| / mark, perps only.
    let worst: { market: string; pct: number; side: string } | null = null;
    for (const p of positions) {
      if (!p.liqPrice || !p.markPrice) continue;
      const pct = (Math.abs(p.liqPrice - p.markPrice) / p.markPrice) * 100;
      if (!worst || pct < worst.pct) worst = { market: p.market, pct, side: p.side };
    }
    const notional = positions.filter((p) => p.kind === 'perp').reduce((a, p) => a + p.valueUsd, 0);
    return {
      equity, used, upnl, util, worst, positions, notional,
      leverage: equity > 0 ? notional / equity : null,
      buyingPower: Math.max(0, equity - used),
      health: healthScore(util, worst?.pct ?? null),
      total: equity + stocksValue + bscStables, stocksValue, stocksCollateral, bscStables,
    };
  }, [accounts, stocksValue, stocksCollateral, bscStables]);
}

export function RiskKpiStrip({ k }: { k: ReturnType<typeof useRiskKpis> }) {
  const hc = k.health >= 70 ? 'text-up' : k.health >= 40 ? 'text-accent' : 'text-down';
  const hb = k.health >= 70 ? 'bg-up' : k.health >= 40 ? 'bg-accent' : 'bg-down';
  const uc = k.util === null ? 'text-muted' : k.util >= 100 ? 'text-down' : k.util >= 80 ? 'text-accent' : 'text-white';
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
      <Card label="Account health" hint={k.positions.length ? 'margin · liquidation distance' : 'no open positions'}>
        <div className="flex items-baseline gap-1"><span className={clsx('text-2xl font-bold leading-none num', hc)}>{k.health}</span><span className="text-xs text-muted">/100</span></div>
        <Bar pct={k.health} className={hb} />
      </Card>
      <Card label="Total value" hint="venues + bStocks + BNB stables"><p className="text-2xl font-bold leading-none num">{fmtUsd(k.total)}</p></Card>
      <Card label="Venue equity" hint={`${fmtUsd(k.buyingPower)} free`}><p className="text-2xl font-bold leading-none num">{fmtUsd(k.equity)}</p></Card>
      <Card label="Unrealized PnL" hint={k.positions.length ? `${k.positions.length} positions` : 'no open positions'}>
        <p className={clsx('text-2xl font-bold leading-none num', !k.positions.length ? 'text-muted' : k.upnl >= 0 ? 'text-up' : 'text-down')}>{k.positions.length ? `${k.upnl >= 0 ? '+' : ''}${fmtUsd(k.upnl)}` : '—'}</p>
      </Card>
      <Card label="Margin utilization" hint={k.util === null ? 'no venue equity' : `${fmtUsd(k.used)} committed`}>
        <p className={clsx('text-2xl font-bold leading-none num', uc)}>{k.util === null ? '—' : `${k.util.toFixed(1)}%`}</p>
        <Bar pct={k.util ?? 0} className={k.util !== null && k.util >= 80 ? 'bg-accent' : 'bg-blue-400'} />
      </Card>
      <Card label="Liq. distance" hint={k.worst ? `${k.worst.market} · ${k.worst.side}` : 'nothing liquidatable'}>
        <p className={clsx('text-2xl font-bold leading-none num', !k.worst ? 'text-muted' : k.worst.pct < 15 ? 'text-down' : k.worst.pct < 30 ? 'text-accent' : 'text-white')}>
          {k.worst ? `${k.worst.side === 'long' ? '−' : '+'}${k.worst.pct.toFixed(1)}%` : '—'}</p>
      </Card>
      <Card label="bStock collateral" hint={`${fmtUsd(k.stocksValue)} market value`}><p className="text-2xl font-bold leading-none text-accent num">{fmtUsd(k.stocksCollateral)}</p></Card>
    </div>
  );
}

/**
 * Spot shock: move every underlying by X% at once. bStocks and perps are linear (value × X, sign by side);
 * options are left out (non-linear — Derive margins them itself). Equity changes, margin used is held,
 * so utilization rises on a loss; each rule is then re-planned against the shocked account.
 */
export function ScenarioShock({ accounts, rules, stocksValue, bscStables, haircut }: { accounts: RiskAccount[]; rules: RiskRule[]; stocksValue: number; bscStables: number; /** 0.3 = 30% */ haircut: number }) {
  const [shock, setShock] = useState(-20);
  const rows = accounts.map((a) => {
    const pnl = a.positions.filter((p) => p.kind === 'perp').reduce((s, p) => s + (p.side === 'long' ? 1 : -1) * p.valueUsd * (shock / 100), 0);
    const eq = (a.health.accountUsd ?? 0) + pnl;
    const used = a.health.usedUsd ?? 0;
    const shocked = { ...a.health, accountUsd: eq, utilBps: eq > 0 ? Math.min(10_000, Math.round((used / eq) * 10_000)) : 10_000 };
    const rule = rules.find((r) => ruleKey(r) === a.key);
    const act = rule ? planRule({ ...rule, enabled: true }, shocked) : null;
    return { a, pnl, eq, util: shocked.utilBps / 100, act, liquidated: eq <= used * 0.5, options: a.positions.some((p) => p.kind === 'option') };
  });
  const stockPnl = stocksValue * (shock / 100);
  const topUps = rows.reduce((s, r) => s + (r.act?.kind === 'top_up' ? Number(BigInt(r.act.amountBaseUnit)) / 1e6 : 0), 0);
  const funding = bscStables + Math.max(0, stocksValue + stockPnl) * (1 - haircut);
  return (
    <section className="panel p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-semibold">Stress test</h3><p className="text-[11px] text-muted">Move every underlying at once and see what the rules would do.</p></div>
        <div className="flex items-center gap-3"><input type="range" min={-40} max={40} value={shock} onChange={(e) => setShock(+e.target.value)} className="w-44 accent-[#f0b90b]" />
          <span className={clsx('w-14 text-right font-semibold num', shock < 0 ? 'text-down' : 'text-up')}>{shock > 0 ? '+' : ''}{shock}%</span></div>
      </div>
      <table className="w-full text-sm"><thead><tr>{['Account', 'PnL', 'Equity after', 'Utilization after', 'Rule would'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead><tbody>
        {rows.map((r) => (
          <tr key={r.a.key} className="border-t border-line/60">
            <td className="td">{r.a.title}{r.options && <span className="ml-1 text-[10px] text-muted">(options excluded)</span>}</td>
            <td className={clsx('td', r.pnl >= 0 ? 'text-up' : 'text-down')}>{r.pnl >= 0 ? '+' : ''}{fmtUsd(r.pnl)}</td>
            <td className="td">{fmtUsd(r.eq)}</td>
            <td className={clsx('td', r.util >= 100 ? 'text-down' : r.util >= 70 ? 'text-accent' : '')}>{r.util.toFixed(1)}%{r.liquidated && <span className="ml-1 text-[10px] text-down">liq risk</span>}</td>
            <td className="td text-xs">{!r.act ? <span className="text-muted">no rule</span> : r.act.kind === 'top_up' ? <span className="text-accent">top up ${(Number(BigInt(r.act.amountBaseUnit)) / 1e6).toFixed(2)}</span> : r.act.kind === 'release' ? <span className="text-cyan-300">release</span> : <span className="text-muted">{r.act.reason}</span>}</td>
          </tr>
        ))}
        <tr className="border-t border-line/60"><td className="td">bStocks (BNB)</td><td className={clsx('td', stockPnl >= 0 ? 'text-up' : 'text-down')}>{stockPnl >= 0 ? '+' : ''}{fmtUsd(stockPnl)}</td><td className="td">{fmtUsd(stocksValue + stockPnl)}</td><td className="td text-muted">—</td><td className="td text-xs text-muted">collateral source</td></tr>
      </tbody></table>
      <p className={clsx('mt-3 rounded-lg px-3 py-2 text-xs', topUps > funding ? 'bg-down/10 text-down' : 'bg-panel2 text-[#c9ccd6]')}>
        Top-ups needed: <b className="num">{fmtUsd(topUps)}</b> · BNB funds available after the shock (stables + bStocks after {Math.round(haircut * 100)}% haircut): <b className="num">{fmtUsd(funding)}</b>
        {topUps > funding ? ' — not enough: add USDC on BNB or reduce positions.' : topUps > 0 ? ' — covered.' : ''}
      </p>
    </section>
  );
}
