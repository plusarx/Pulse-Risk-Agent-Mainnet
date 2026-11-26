'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { OctagonX } from 'lucide-react';
import { useVenueNetwork } from '@/lib/network';
import { useSession } from '@/lib/session';
import { getJson, useAsterMarkets } from '@/lib/hooks/useVenues';
import { usePortfolio } from '@/lib/hooks/usePortfolio';
import { useRiskAccounts } from '@/lib/hooks/useRiskAccounts';
import { DEFAULT_CONFIG, type AgentConfig } from '@/lib/agent-config';
import { type RiskRule, type RuleState, type RuleUnits } from '@/lib/risk-rules';
import { FundingPanel } from '@/components/automation/FundingPanel';
import { AutoRebalance, type MoveItem } from '@/components/risk/AutoRebalance';
import { RiskKpiStrip, ScenarioShock, useRiskKpis } from '@/components/risk/RiskOverview';
import { ScenarioForecast } from '@/components/risk/ScenarioForecast';
import { HedgePanel } from '@/components/risk/HedgePanel';
import { Switch } from '@/components/risk/ZoneBar';
import { ProposalCard } from '@/components/risk/ProposalCard';
import { ActionCard, ActionHistory, ModeToggle } from '@/components/risk/ActionCard';
import { HedgeStatus } from '@/components/risk/HedgeStatus';
import { CheckSchedule } from '@/components/risk/CheckSchedule';
import { PriceIntegrity } from '@/components/risk/PriceIntegrity';
import { haircutFor } from '@/lib/integrity-view';
import { useIntegrity } from '@/lib/hooks/useIntegrity';
import { LatestRun } from '@/components/risk/LatestRun';
import { LimitsPanel } from '@/components/risk/LimitsPanel';
import { ActivityFeed, type EventRow } from '@/components/risk/ActivityFeed';


export default function RiskPage() {
  const { wallet, signIn } = useSession();
  const { network } = useVenueNetwork();
  const qc = useQueryClient();
  const markets = useAsterMarkets();
  const loaded = useQuery({ queryKey: ['agent-config', network, wallet], enabled: !!wallet, queryFn: () => getJson<{ config: AgentConfig }>(`/api/agent/config?network=${network}`) });
  const events = useQuery({ queryKey: ['agent-events', network, wallet], enabled: !!wallet, refetchInterval: 5_000, queryFn: () => getJson<{ events: EventRow[] }>(`/api/agent/events?network=${network}`) });
  const ruleStates = useQuery({ queryKey: ['rule-states', network, wallet], enabled: !!wallet, refetchInterval: 10_000, queryFn: () => getJson<{ states: Record<string, RuleState> }>(`/api/agent/rule-state?network=${network}`) });
  const [cfg, setCfg] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [units, setUnits] = useState<RuleUnits>('percent');
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { if (loaded.data) setCfg(loaded.data.config); }, [loaded.data]);

  const p = usePortfolio(cfg.collateral.bstockHaircut);
  const integ = useIntegrity();
  const risk = useRiskAccounts();
  const bscStables = (p.bsc.usdc ?? 0) + (p.bsc.usdt ?? 0);
  const k = useRiskKpis(risk.accounts, p.stocksValue, p.stocksCollateral, bscStables);

  // Rules on the dormant Lighter venue are not shown (and drop out on the next save); perps rules run on Aster.
  const rules = cfg.rebalance.rules.filter((r) => r.venue !== 'lighter') as RiskRule[];

  const held = Object.fromEntries(p.stocks.map((s) => [s.symbol, { qty: s.qty, price: s.price }]));

  const moves: MoveItem[] = (events.data?.events ?? []).filter((e) => e.kind === 'rebalance' || e.kind === 'bridge').map((e) => {
    const pl = e.payload ? (JSON.parse(e.payload) as { direction?: string; amountUsd?: number }) : {};
    return { id: e.id, dir: pl.direction === 'out' ? 'out' : 'in', venue: e.venue, status: e.status, message: e.message, at: e.created_at, amountUsd: typeof pl.amountUsd === 'number' ? pl.amountUsd : null };
  });

  /** Persist the whole config; returns an error message or null. */
  async function persist(next: AgentConfig): Promise<string | null> {
    try {
      const r = await getJson<{ config: AgentConfig }>(`/api/agent/config?network=${network}`, { method: 'PUT', body: JSON.stringify(next) });
      setCfg(r.config);
      void qc.invalidateQueries({ queryKey: ['agent-config'] });
      return null;
    } catch (e) { return (e as Error).message; }
  }
  const saveRules = (rules: RiskRule[]) => persist({ ...cfg, rebalance: { ...cfg.rebalance, rules } });
  const set = (fn: (c: AgentConfig) => void) => setCfg((c) => { const n = structuredClone(c); fn(n); return n; });
  /** Hedge edits save immediately (no separate save step). */
  async function saveHedge(h: AgentConfig['hedge']) {
    set((c) => { c.hedge = h; });
    const e = await persist({ ...cfg, hedge: h });
    setSaved(e ? `Error saving hedge: ${e}` : null);
  }

  if (!wallet) return <div className="panel mx-auto max-w-xl p-6"><p className="mb-3 text-muted">Sign in to manage risk and automation.</p><button className="btn-primary" onClick={() => void signIn()}>Sign in</button></div>;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Risk management</h1>
          <p className="text-sm text-muted">Live risk across perps, every options subaccount and your bStocks, plus the rules the agent runs ({network}).</p>
          {saved && <p className={clsx('mt-1 text-xs', saved.startsWith('Error') ? 'text-down' : 'text-up')}>{saved}</p>}
        </div>
        <ModeToggle mode={cfg.mode} autonomyExpiresAt={cfg.limits.autonomyExpiresAt} onChange={(m) => {
          // Auto stays on until the user turns it off (no expiry); the kill switch still stops everything.
          const limits = m === 'autonomous' ? { ...cfg.limits, autonomyExpiresAt: null } : cfg.limits;
          void persist({ ...cfg, mode: m, limits });
        }} />
      </div>

      {cfg.limits.killSwitch && (
        <div role="alert" className="flex items-center gap-2 rounded-xl bg-down px-4 py-2.5 text-sm font-semibold text-white"><OctagonX size={16} />Kill switch ARMED, no new orders or transfers</div>
      )}

      <CheckSchedule schedule={cfg.schedule ?? { auto: true, runNowAt: null }} onChange={(sch) => persist({ ...cfg, schedule: sch })} />

      <PriceIntegrity enabled={cfg.integrity?.enabled ?? true} onToggle={(v) => persist({ ...cfg, integrity: { enabled: v } })} />

      <HedgeStatus onKillSwitch={(next) => void persist({ ...cfg, limits: { ...cfg.limits, killSwitch: next } })} />

      <RiskKpiStrip k={k} />

      <ActionCard />
      <LatestRun />

      <ProposalCard />

      <ScenarioForecast accounts={risk.accounts} rules={rules} stocks={p.stocks.map((s) => ({ symbol: s.symbol, qty: s.qty, price: s.price }))} />

      <AutoRebalance accounts={risk.accounts} rules={rules} states={ruleStates.data?.states ?? {}} loading={risk.loading}
        live={cfg.rebalance.enabled} onLive={async (v) => { await persist({ ...cfg, rebalance: { ...cfg.rebalance, enabled: v } }); }}
        units={units} onUnits={setUnits} bscUsdc={p.bsc.usdc} moves={moves} onSaveRules={saveRules}
        onRearm={async (key) => { await getJson('/api/agent/rule-state', { method: 'POST', body: JSON.stringify({ network, ruleKey: key, action: 'rearm' }) }); void qc.invalidateQueries({ queryKey: ['rule-states'] }); }} />

      <div className="grid gap-4 xl:grid-cols-2">
        <ScenarioShock accounts={risk.accounts} rules={rules} stocksValue={p.stocksValue} bscStables={bscStables} haircut={integ.enabled && Object.keys(integ.bySymbol).length > 0 && p.stocksValue > 0 ? 1 - p.stocksCollateral / p.stocksValue : cfg.collateral.bstockHaircut} />

        <HedgePanel hedge={cfg.hedge} onChange={(h) => void saveHedge(h)} held={held} accounts={risk.accounts} perpMarkets={markets.data} />
        <section className="panel p-5">
          <div className="flex items-start justify-between gap-3">
            <div><div className="font-semibold">News risk flags</div>
              <p className="text-[11px] text-muted">Advisory only. The agent reads headlines for the stocks you hold and raises flags; news never changes a position or a hedge size.</p></div>
            <Switch checked={cfg.hedge.news.enabled} onChange={(v) => void saveHedge({ ...cfg.hedge, news: { enabled: v } })} label="News risk flags" />
          </div>
          <div className="mt-4">
            <div className="label mb-1">How hedge size is decided</div>
            <div className="flex rounded-xl border border-line bg-bg p-1 text-sm">
              {([['ratio', 'By ratio (value)'], ['loss_limit', 'From my loss limit']] as const).map(([k, label]) => (
                <button key={k} type="button" className={'flex-1 rounded-lg px-3 py-1.5 ' + (cfg.hedge.sizing === k ? 'bg-accent font-semibold text-black' : 'text-muted hover:text-white')} onClick={() => void saveHedge({ ...cfg.hedge, sizing: k })}>{label}</button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">{cfg.hedge.sizing === 'ratio' ? 'Each leg is hedged to its ratio by value: bStock quantity x price x ratio, divided by the hedge price.' : 'The agent solves the smallest hedge that keeps the modelled loss inside your loss limit (h >= 1 - L / VaR99). The leg ratio is the maximum.'}</p>
          </div>
        </section>
      </div>

      <FundingPanel
        value={{ sources: cfg.rebalance.sources, sellOrder: cfg.rebalance.sellOrder, keepBscReserveBaseUnit: cfg.rebalance.keepBscReserveBaseUnit, haircut: cfg.collateral.bstockHaircut }}
        prices={Object.fromEntries(p.stocks.map((s) => [s.symbol, s.price]))}
        haircutFor={(sym) => haircutFor(sym, cfg.collateral.bstockHaircut, integ)}
        onSave={(f) => {
          const next = structuredClone(cfg);
          next.rebalance.sources = f.sources; next.rebalance.sellOrder = f.sellOrder; next.rebalance.keepBscReserveBaseUnit = f.keepBscReserveBaseUnit; next.collateral.bstockHaircut = f.haircut;
          return persist(next);
        }} />

      <LimitsPanel value={cfg} onSave={persist} />

      <ActivityFeed events={events.data?.events ?? []} />

      <ActionHistory />
    </div>
  );
}
