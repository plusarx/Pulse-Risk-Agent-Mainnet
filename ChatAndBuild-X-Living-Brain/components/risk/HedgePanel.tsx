'use client';
import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, Plus, Shield, Trash2 } from 'lucide-react';
import { useVenueNetwork } from '@/lib/network';
import { derivePublic } from '@/lib/hooks/useVenues';
import type { AsterMarket } from '@/lib/aster-view';
import type { RiskAccount } from '@/lib/hooks/useRiskAccounts';
import { BSTOCKS_BSC, bstockBySymbol } from '@/lib/bstocks';
import { hedgeKey, type AgentConfig, type HedgeLeg } from '@/lib/agent-config';
import { planHedge } from '@/lib/plan';
import { parseDeriveOption } from '@/lib/scenario';
import { fmtNum } from '@/lib/format';
import { Switch } from './ZoneBar';

/** Index contract that proxies an ETF bStock on either venue (sized by notional, so price scale doesn't matter). */
const INDEX_PROXY: Record<string, string> = { SPY: 'US500', QQQ: 'US100' };
const RATIOS = [25, 50, 75, 100];
const STRIKES = [{ pct: 95, label: '5% below' }, { pct: 90, label: '10% below' }, { pct: 80, label: '20% below' }];
const EXPIRIES = [{ days: 7, roll: 2, label: '1 week' }, { days: 30, roll: 7, label: '1 month' }, { days: 90, roll: 14, label: '3 months' }];

type Venue = 'aster' | 'derive';
type Kind = 'perp' | 'put';
interface Target { market: string; proxy: boolean }

/**
 * bStock hedge, made simple: pick the bStock, the venue, short perp or puts, and how much. Saves immediately.
 * Each hedge then reads as one sentence with its live status (target vs what you hold now).
 */
export function HedgePanel({ hedge, onChange, held, accounts, perpMarkets }: {
  hedge: AgentConfig['hedge']; onChange: (h: AgentConfig['hedge']) => void;
  held: Record<string, { qty: number; price: number | null }>;
  accounts: RiskAccount[]; perpMarkets: AsterMarket[] | undefined;
}) {
  const { network } = useVenueNetwork();
  const universes = useQuery({
    queryKey: ['d-universes', network], staleTime: 10 * 60_000,
    queryFn: () => derivePublic<{ name: string; managers: { instruments: string[] }[] }[]>(network, 'public/get_risk_universes', {}),
  });
  const families = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of universes.data ?? []) for (const mg of u.managers) for (const f of mg.instruments) m.set(f, u.name);
    return m;
  }, [universes.data]);

  // ── live status of existing legs ──
  const deriveCcys = [...new Set(hedge.legs.filter((l) => l.venue === 'derive').map((l) => l.market))];
  const tick = useQueries({ queries: deriveCcys.map((c) => ({ queryKey: ['dticker', network, `${c}-PERP`], refetchInterval: 15_000,
    queryFn: () => derivePublic<{ M: string; I: string }>(network, 'public/get_ticker', { instrument_name: `${c}-PERP` }) })) });
  const prices: Record<string, number | null> = {};
  for (const l of hedge.legs) {
    const k = hedgeKey(l);
    if (l.venue === 'aster') { const mk = perpMarkets?.find((x) => x.ticker === l.market); prices[k] = mk ? mk.mark ?? mk.last : null; }
    else if (l.venue === 'lighter') prices[k] = null; // dormant venue: legacy legs are shown but never priced
    else { const t = tick[deriveCcys.indexOf(l.market)]?.data; prices[k] = t ? Number(l.kind === 'put' ? t.I : t.M) || null : null; }
  }
  const positions: Record<string, number> = {};
  for (const a of accounts) for (const p of a.positions) {
    const signed = (p.side === 'long' ? 1 : -1) * p.size;
    if (a.venue === 'aster') {
      const t = p.market.replace(/-PERP$/, '');
      positions[`aster:${t}`] = (positions[`aster:${t}`] ?? 0) + signed;
    } else {
      const opt = parseDeriveOption(p.market);
      if (opt?.type === 'P' && signed > 0) positions[`derive-put:${opt.underlying}`] = (positions[`derive-put:${opt.underlying}`] ?? 0) + signed;
      else if (!opt && p.market.endsWith('-PERP')) { const c = p.market.replace(/-PERP$/, ''); positions[`derive-perp:${c}`] = (positions[`derive-perp:${c}`] ?? 0) + signed; }
    }
  }
  const plans = planHedge(hedge, held, positions, prices);

  // ── builder state ──
  const heldSymbols = Object.keys(held).filter((s) => held[s].qty > 0);
  const [bstock, setBstock] = useState(heldSymbols[0] ?? 'NVDAB');
  const [venue, setVenue] = useState<Venue>('aster');
  const [kind, setKind] = useState<Kind>('perp');
  const [ratio, setRatio] = useState(100);
  const [strike, setStrike] = useState(90);
  const [expiry, setExpiry] = useState(30);
  const underlying = bstockBySymbol(bstock)?.underlying ?? '';
  const proxy = INDEX_PROXY[underlying];

  // What each venue can hedge this bStock with (direct symbol first, then the index proxy).
  const perpTarget: Target | null = useMemo(() => {
    const direct = perpMarkets?.find((m) => m.ticker === underlying);
    if (direct) return { market: direct.ticker, proxy: false };
    const px = proxy ? perpMarkets?.find((m) => m.ticker === proxy) : undefined;
    return px ? { market: px.ticker, proxy: true } : null;
  }, [perpMarkets, underlying, proxy]);
  const deriveCcy = families.has(`${underlying}-PERP`) || families.has(`${underlying}-OPTION`) ? underlying : proxy && (families.has(`${proxy}-PERP`) || families.has(`${proxy}-OPTION`)) ? proxy : null;
  const derivePerp = !!deriveCcy && families.has(`${deriveCcy}-PERP`);
  const derivePut = !!deriveCcy && families.has(`${deriveCcy}-OPTION`);
  const perpWhy = perpMarkets === undefined ? `Perps ${network} is not responding` : `No ${underlying} perps market on ${network}`;
  const deriveWhy = universes.isLoading ? 'Loading…' : `No ${underlying} options market on ${network}`;
  const v: Venue = venue === 'aster' && !perpTarget && (derivePerp || derivePut) ? 'derive' : venue === 'derive' && !deriveCcy && perpTarget ? 'aster' : venue;
  const k: Kind = v === 'aster' ? 'perp' : kind === 'put' && !derivePut ? 'perp' : kind === 'perp' && !derivePerp && derivePut ? 'put' : kind;
  const target: Target | null = v === 'aster' ? perpTarget : deriveCcy ? { market: deriveCcy, proxy: deriveCcy !== underlying } : null;
  const draftKey = target ? hedgeKey({ venue: v, kind: k, market: target.market }) : null;
  const duplicate = !!draftKey && hedge.legs.some((l) => l.bstock === bstock && hedgeKey(l) === draftKey);

  const add = () => {
    if (!target || duplicate) return;
    const e = EXPIRIES.find((x) => x.days === expiry) ?? EXPIRIES[1];
    const leg: HedgeLeg = { bstock, venue: v, kind: k, market: target.market, hedgeRatio: ratio / 100,
      ...(k === 'put' ? { put: { strikePct: strike, targetDaysToExpiry: e.days, minDaysToExpiry: e.roll } } : {}) };
    onChange({ ...hedge, enabled: true, legs: [...hedge.legs, leg] });
  };
  const setLeg = (i: number, patch: Partial<HedgeLeg>) => onChange({ ...hedge, legs: hedge.legs.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-semibold"><Shield size={17} className="text-accent" />bStock hedge</div>
          <p className="mt-0.5 text-xs text-muted">Protect bStocks you hold against a price drop. The agent keeps each hedge on target.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">{hedge.enabled ? 'On' : 'Off'}<Switch checked={hedge.enabled} onChange={(x) => onChange({ ...hedge, enabled: x })} label="Agent keeps hedges on target" /></label>
      </div>

      {/* ── existing hedges, one sentence each ── */}
      {hedge.legs.length > 0 && (
        <div className="mt-4 space-y-2">
          {hedge.legs.map((leg, i) => {
            const pl = plans[i];
            const venueName = leg.venue === 'derive' ? 'Options' : 'Perps';
            const what = leg.kind === 'put' ? `${leg.market} puts` : `${leg.market}-PERP`;
            const verb = leg.kind === 'put' ? 'Buy' : 'Short';
            const ok = pl && pl.targetUnits !== null && !pl.act;
            return (
              <div key={`${leg.bstock}-${hedgeKey(leg)}`} className="rounded-xl bg-bg p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{verb} {pl?.targetUnits != null ? fmtNum(pl.targetUnits, 2) : '…'} {what}</span>
                    <span className="text-muted"> on {venueName} · covers {Math.round(leg.hedgeRatio * 100)}% of your {fmtNum(pl?.held ?? 0, 3)} {leg.bstock}</span>
                    {leg.kind === 'put' && leg.put && <div className="text-xs text-muted">Strike {100 - leg.put.strikePct}% below spot · ~{leg.put.targetDaysToExpiry} days · rolled with {leg.put.minDaysToExpiry} days left</div>}
                  </div>
                  <span className={clsx('shrink-0 rounded-full px-2 py-0.5 text-[11px]', !pl || pl.targetUnits === null ? 'bg-panel2 text-muted' : ok ? 'bg-up/10 text-up' : 'bg-accent/15 text-accent')}>
                    {!pl || pl.targetUnits === null ? 'waiting for prices' : ok ? <span className="inline-flex items-center gap-1"><Check size={11} />On target</span> : `Needs ${pl.deltaUnits > 0 ? '+' : ''}${fmtNum(pl.deltaUnits, 2)}`}
                  </span>
                  <button aria-label="Remove hedge" title="Remove hedge" className="shrink-0 rounded p-1 text-muted hover:text-down" onClick={() => onChange({ ...hedge, legs: hedge.legs.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="mr-1 text-muted">Cover</span>
                  {RATIOS.map((r) => <Chip key={r} on={Math.round(leg.hedgeRatio * 100) === r} onClick={() => setLeg(i, { hedgeRatio: r / 100 })}>{r}%</Chip>)}
                  <span className="ml-1 text-muted">· now {fmtNum(pl?.currentUnits ?? 0, 2)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── add a hedge: four simple choices ── */}
      <div className="mt-4 space-y-3 rounded-xl bg-bg p-4 text-sm">
        <div className="font-medium">Add a hedge</div>
        <Row n={1} label="bStock">
          <div className="flex flex-wrap gap-1.5">
            {(heldSymbols.length ? heldSymbols : ['NVDAB', 'SPYB', 'QQQB', 'TSLAB']).map((s) => <Chip key={s} on={bstock === s} onClick={() => setBstock(s)}>{s}{held[s]?.qty ? ` · ${fmtNum(held[s].qty, 2)}` : ''}</Chip>)}
            <select aria-label="Other bStock" className="h-8 rounded-full border border-line bg-panel2 px-3 text-xs text-muted outline-none" value="" onChange={(e) => e.target.value && setBstock(e.target.value)}>
              <option value="">Other…</option>
              {BSTOCKS_BSC.filter((b) => !heldSymbols.includes(b.symbol)).map((b) => <option key={b.symbol} value={b.symbol}>{b.symbol} · {b.displayName}</option>)}
            </select>
          </div>
        </Row>
        <Row n={2} label="Hedge on">
          <div className="grid grid-cols-2 gap-2">
            <VenueButton on={v === 'aster'} disabled={!perpTarget} onClick={() => setVenue('aster')} title="Perps" sub={perpTarget ? `${perpTarget.market}-PERP${perpTarget.proxy ? ' (index proxy)' : ''}` : perpWhy} />
            <VenueButton on={v === 'derive'} disabled={!deriveCcy} onClick={() => setVenue('derive')} title="Options" sub={deriveCcy ? `${deriveCcy} perp${derivePut ? ' & puts' : ''}${deriveCcy !== underlying ? ' (index proxy)' : ''} · ${families.get(`${deriveCcy}-PERP`) ?? families.get(`${deriveCcy}-OPTION`)} universe` : deriveWhy} />
          </div>
        </Row>
        <Row n={3} label="How">
          <div className="flex flex-wrap gap-1.5">
            <Chip on={k === 'perp'} disabled={v === 'derive' && !derivePerp} onClick={() => setKind('perp')}>Short the perp</Chip>
            <Chip on={k === 'put'} disabled={v !== 'derive' || !derivePut} onClick={() => setKind('put')} title={v === 'aster' ? 'Perps has no options' : ''}>Buy protective puts{v === 'aster' ? ' (options only)' : ''}</Chip>
          </div>
          {k === 'put' && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted">Strike</span>{STRIKES.map((s) => <Chip key={s.pct} on={strike === s.pct} onClick={() => setStrike(s.pct)}>{s.label}</Chip>)}
              <span className="ml-2 text-muted">Expiry</span>{EXPIRIES.map((x) => <Chip key={x.days} on={expiry === x.days} onClick={() => setExpiry(x.days)}>{x.label}</Chip>)}
            </div>
          )}
        </Row>
        <Row n={4} label="Cover">
          <div className="flex flex-wrap gap-1.5">{RATIOS.map((r) => <Chip key={r} on={ratio === r} onClick={() => setRatio(r)}>{r}%</Chip>)}</div>
        </Row>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">
            {target ? <>{k === 'put' ? 'Buy' : 'Short'} <span className="text-white">{k === 'put' ? `${target.market} puts` : `${target.market}-PERP`}</span> on {v === 'aster' ? 'perps' : 'options'} worth {ratio}% of your {bstock}{held[bstock]?.qty ? ` (${fmtNum(held[bstock].qty, 3)})` : ''}.{v === 'derive' ? ' Needs an options subaccount in that universe.' : ''}</> : `No hedge available for ${bstock} on this network.`}
          </p>
          <button className="btn-primary inline-flex h-9 items-center gap-1 px-4 py-0 text-sm" disabled={!target || duplicate} onClick={add}>
            <Plus size={14} />{duplicate ? 'Already added' : 'Add hedge'}
          </button>
        </div>
      </div>
    </section>
  );
}

function Row({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[110px_1fr] sm:items-start">
      <div className="flex items-center gap-2 pt-1.5 text-xs text-muted"><span className="grid h-5 w-5 place-items-center rounded-full bg-panel2 text-[11px] text-white">{n}</span>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children, disabled, title }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={clsx('h-8 rounded-full px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35',
        on ? 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/40' : 'bg-panel2 text-[#c9ccd6] hover:text-white')}>{children}</button>
  );
}

function VenueButton({ on, disabled, onClick, title, sub }: { on: boolean; disabled: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={clsx('rounded-xl px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        on && !disabled ? 'bg-accent/10 ring-1 ring-inset ring-accent/40' : 'bg-panel2 hover:bg-line')}>
      <div className={clsx('text-sm font-medium', on && !disabled ? 'text-accent' : 'text-white')}>{title}</div>
      <div className="truncate text-[11px] text-muted">{sub}</div>
    </button>
  );
}
