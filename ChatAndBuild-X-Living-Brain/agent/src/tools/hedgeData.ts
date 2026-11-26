import { hedgeKey, type AgentConfig, type HedgeLeg } from '../../../lib/agent-config';
import { parseDeriveOption } from '../../../lib/scenario';
import * as derive from './derive';
import * as aster from './aster';
import type { DeriveCreds } from './appApi';
import type { Network, Snapshot } from '../types';

// What the value-based hedge planner needs per leg: the HEDGE price (perps mark, Derive perp mark or index for puts),
// the current hedge positions, and the venue minimums. A leg whose price cannot be read is simply left out: the planner
// then reports "waiting for prices" for it and trades nothing.

export interface HedgeData {
  prices: Record<string, number>;
  positions: Record<string, number>;
  mins: NonNullable<Snapshot['hedgeMins']>;
  putPositions: NonNullable<Snapshot['putPositions']>;
  putPicks: NonNullable<Snapshot['putPicks']>;
  problems: string[];
}

export interface PutPickInfo { instrument: string; strike: number; expiry: string; ask: number; bid: number; daysToExpiry: number }

export interface HedgeDataDeps {
  /** Perps (Aster) market by ticker: mark price and order minimums. */
  perpMarket(n: Network, ticker: string): Promise<{ price: number; minBase: number; step: number; minNotionalUsd: number }>;
  deriveTicker(n: Network, instrument: string): Promise<{ mark: number; index: number }>;
  deriveInstrument(n: Network, instrument: string): Promise<{ minimumAmount: number; amountStep: number }>;
  deriveHoldings(n: Network, wallet: string, creds: DeriveCreds): Promise<{ instrument: string; amount: number }[]>;
  /** The put this leg would buy, from the live instrument list, or null when none lists or there is no ask. */
  derivePutPick(n: Network, ccy: string, put: NonNullable<HedgeLeg['put']>, indexPrice: number, now: number): Promise<PutPickInfo | null>;
}

export const realHedgeDeps: HedgeDataDeps = {
  perpMarket: async (n, t) => { const [m, price] = await Promise.all([aster.market(n, t), aster.markPrice(n, t)]); return { price, minBase: m.minQty, step: m.stepSize, minNotionalUsd: m.minNotionalUsd }; },
  deriveTicker: (n, i) => derive.getTicker(n, i),
  deriveInstrument: (n, i) => derive.getInstrument(n, i),
  derivePutPick: async (n, ccy, put, index, now) => {
    const names = (await derive.rpc<string[]>(n, 'public/get_all_live_instruments', {}, {})) ?? [];
    const re = new RegExp(`^${ccy}-(\\d{4})(\\d{2})(\\d{2})-([0-9_]+)-P$`);
    const list = names.map((name) => { const m = re.exec(name); return m ? { name, expiryMs: Date.UTC(+m[1], +m[2] - 1, +m[3], 8), strike: Number(m[4].replace('_', '.')) } : null; }).filter((x): x is { name: string; expiryMs: number; strike: number } => !!x)
      .map((x) => ({ ...x, days: (x.expiryMs - now) / 86_400_000 })).filter((x) => x.days >= put.minDaysToExpiry);
    if (!list.length) return null;
    const bestDays = [...list].sort((a, b) => Math.abs(a.days - put.targetDaysToExpiry) - Math.abs(b.days - put.targetDaysToExpiry))[0].days;
    const sameExpiry = list.filter((x) => Math.abs(x.days - bestDays) < 1e-6);
    const want = (index * put.strikePct) / 100;
    const pick = [...sameExpiry].sort((a, b) => Math.abs(a.strike - want) - Math.abs(b.strike - want))[0];
    const t = await derive.getTicker(n, pick.name);
    if (!(t.ask > 0)) return null;
    return { instrument: pick.name, strike: pick.strike, expiry: new Date(pick.expiryMs).toISOString(), ask: t.ask, bid: t.bid, daysToExpiry: Math.round(pick.days * 10) / 10 };
  },
  deriveHoldings: async (n, w, c) => (await derive.listSubaccounts(n, w, c)).filter((s) => !s.isFallback).flatMap((s) => s.positions.map((p) => ({ instrument: p.instrument_name, amount: Number(p.amount) }))),
};

const PUT_MIN_CONTRACTS = 1;       // Derive puts: 1 contract
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function collectHedgeData(n: Network, wallet: string, hedge: AgentConfig['hedge'], held: Set<string>, perpPositions: Record<string, number>, deriveCreds: DeriveCreds | null, deps: HedgeDataDeps = realHedgeDeps, now = Date.now()): Promise<HedgeData> {
  const out: HedgeData = { prices: {}, positions: {}, mins: {}, putPositions: [], putPicks: {}, problems: [] };
  const legs = hedge.legs.filter((l) => held.has(l.bstock));
  const needDeriveHoldings = legs.some((l) => l.venue === 'derive');
  let holdings: { instrument: string; amount: number }[] = [];
  if (needDeriveHoldings) {
    if (!deriveCreds) out.problems.push('no usable Derive key, so Derive hedge legs are skipped');
    else { try { holdings = await deps.deriveHoldings(n, wallet, deriveCreds); } catch (e) { out.problems.push(`Derive positions unreadable: ${msg(e)}`); } }
  }
  await Promise.all(legs.map(async (leg: HedgeLeg) => {
    const key = hedgeKey(leg);
    try {
      if (leg.venue === 'aster') {
        const m = await deps.perpMarket(n, leg.market);
        out.prices[key] = m.price; out.positions[key] = perpPositions[leg.market] ?? 0;
        out.mins[key] = { minBase: m.minBase, step: m.step, minNotionalUsd: m.minNotionalUsd };
        return;
      }
      if (leg.venue !== 'derive') return;   // only Derive legs are priced here; perps legs were handled above
      if (!deriveCreds) return;
      const inst = `${leg.market}-PERP`;
      const t = await deps.deriveTicker(n, inst);
      if (leg.kind === 'perp') {
        const i = await deps.deriveInstrument(n, inst);
        out.prices[key] = t.mark; out.mins[key] = { minBase: i.minimumAmount, step: i.amountStep, minNotionalUsd: 0 };
        out.positions[key] = holdings.filter((h) => h.instrument === inst).reduce((a, h) => a + h.amount, 0);
      } else {
        out.prices[key] = t.index; out.mins[key] = { minBase: PUT_MIN_CONTRACTS, step: 1, minNotionalUsd: 0 };
        let longs = 0;
        for (const h of holdings) {
          const o = h.amount > 0 ? parseDeriveOption(h.instrument) : null;
          if (o && o.type === 'P' && o.underlying === leg.market) { longs += h.amount; out.putPositions.push({ key, instrument: h.instrument, amount: h.amount, expiry: new Date(o.expiryMs).toISOString(), strike: o.strike, daysToExpiry: Math.round(((o.expiryMs - now) / 86_400_000) * 10) / 10 }); }
        }
        out.positions[key] = longs;
        if (leg.put) { const pick = await deps.derivePutPick(n, leg.market, leg.put, t.index, now); if (pick) out.putPicks[key] = pick; }
      }
    } catch (e) { out.problems.push(`${leg.market} ${leg.kind} price or limits unavailable: ${msg(e)}`); }
  }));
  return out;
}
