import type { VenueAlternative } from '../../../lib/agent-action';
import { ASTER_MIN_NOTIONAL_USD } from '../../../lib/aster';
import type { Candidate, Snapshot } from '../types';
import { tickerOf } from './market';
import { pickPut } from './options';

// Why this venue and not the others: for a hedge on one name, every venue the agent can use (perp, Derive
// put, a proxy perp) with whether it was chosen, is possible, or is blocked, and the concrete reason from live
// numbers (venue minimums, free funds across ALL accounts, cost against the weekly budget, transfer time).

/** Perps (Aster) minimum order notional (exchangeInfo MIN_NOTIONAL). */
const PERP_MIN_USD = ASTER_MIN_NOTIONAL_USD;
const m = (x: number) => `$${x.toFixed(2)}`;

export type HedgeChoice = 'perp' | 'put' | 'proxy' | null;

export function choiceOf(c: Candidate | null | undefined): HedgeChoice {
  const h = c?.kind === 'hedge' ? c.hedge : undefined; if (!h) return null;
  return h.option || h.instrument === 'put' ? 'put' : h.proxyFor ? 'proxy' : 'perp';
}

export function venueAlternatives(s: Snapshot, ticker: string, chosen: HedgeChoice): VenueAlternative[] {
  const cfg = s.config; const out: VenueAlternative[] = [];
  const held = s.bsc.bstocks.filter((b) => tickerOf(b.symbol) === ticker && b.qty > 0);
  const holding = held.reduce((a, b) => a + b.value, 0);
  const portfolio = s.bsc.bstocks.reduce((a, b) => a + (b.qty > 0 ? b.value : 0), 0);
  const accts = s.venueAccounts ?? [];
  const perpAll = accts.filter((a) => a.venue === 'aster');
  const perpMainFree = perpAll.find((a) => a.main)?.freeUsd ?? s.perpMain?.freeUsd ?? 0;
  const deriveAll = accts.filter((a) => a.venue === 'derive');
  const deriveFree = deriveAll.length ? Math.max(...deriveAll.map((a) => a.freeUsd)) : s.deriveFree?.freeUsd ?? 0;
  const deriveTotal = deriveAll.reduce((a, b) => a + b.freeUsd, 0);
  const lev = Math.max(1, cfg.limits.maxLeverage);
  const tag = (k: HedgeChoice): VenueAlternative['status'] => (chosen === k ? 'chosen' : 'possible');

  // Perp on the name itself.
  const leg = cfg.hedge.legs.find((l) => l.venue === 'aster' && l.kind === 'perp' && tickerOf(l.bstock) === ticker);
  {
    const size = holding * (leg?.hedgeRatio ?? 1); const margin = size / lev;
    let why: string; let status = tag('perp');
    if (!leg) { status = 'blocked'; why = `The perps venue lists no ${ticker} perp.`; }
    else if (size < PERP_MIN_USD) { status = 'blocked'; why = `A ${m(size)} short is under the perps venue's ${m(PERP_MIN_USD)} minimum order; hold at least ${m(PERP_MIN_USD)} of ${ticker}.`; }
    else if (perpMainFree < margin) { status = chosen === 'perp' ? 'chosen' : 'blocked'; why = `Needs about ${m(margin)} margin at ${lev}x; the perps account has ${m(perpMainFree)} free, otherwise a top-up from BNB (a BNB Chain deposit, no bridge) takes about ${Math.max(1, Math.round((s.perpEtaSec ?? 60) / 60))} min.`; }
    else why = `${m(size)} short, margin about ${m(margin)} of ${m(perpMainFree)} free on the perps account. Offsets moves 1:1 both ways; costs funding, needs monitoring, can be liquidated on a gap.`;
    out.push({ venue: 'aster', instrument: `Short ${ticker} perp`, status, why });
  }

  // Derive put on the name (or its index options for SPY/QQQ).
  {
    const chain = s.options?.[ticker];
    let why: string; let status = tag('put');
    if (!chain) { status = 'blocked'; why = `Derive lists no ${ticker} options right now.`; }
    else {
      const pick = pickPut(chain, Math.max(holding, chain.spot * chain.contractSize), new Date(Date.now() + 2 * 86_400_000), new Date(), 1);
      const budget = (cfg.risk.premiumBudgetWeeklyPct / 100) * portfolio;
      if (!pick) { status = 'blocked'; why = `No ${ticker} put with a live ask covers the next 2 days.`; }
      else {
        const cost = pick.premiumUsd + pick.feesUsd;
        const minCover = chain.spot * chain.contractSize;
        const reasons: string[] = [];
        if (holding < minCover) reasons.push(`Derive's minimum is 1 contract (${m(minCover)} of cover) against your ${m(holding)}, so you would pay for ${Math.round(minCover / Math.max(holding, 0.01))}x the cover you need`);
        if (cost > budget) reasons.push(`costs ${m(cost)} (strike ${pick.strike}, ${pick.daysToExpiry} days), over your ${m(budget)} weekly premium budget`);
        if (deriveFree < cost) reasons.push(`needs ${m(cost)} on Derive; the best subaccount has ${m(deriveFree)} free${deriveAll.length > 1 ? ` (${m(deriveTotal)} across ${deriveAll.length} subaccounts)` : ''}, and bridging takes about ${Math.round((s.deriveEtaSec ?? 1800) / 60)} min`);
        if (reasons.length && chosen !== 'put') { status = 'blocked'; why = `${reasons.join('; ')}.`; }
        else why = `${pick.contracts} put(s) at strike ${pick.strike}, ${pick.daysToExpiry} days, ${m(cost)} premium and fees. Caps the loss below the strike and keeps the upside; no monitoring or liquidation risk.${reasons.length ? ` Note: ${reasons.join('; ')}.` : ''}`;
      }
    }
    out.push({ venue: 'derive', instrument: `Buy ${ticker} put on Derive`, status, why });
  }

  // Proxy perp (measured correlation).
  {
    const pm = cfg.risk.proxyMap?.[ticker]; const sigT = s.market?.sigmaDay[ticker]; const sigV = pm ? s.market?.sigmaDay[pm.via] : undefined;
    let why: string; let status = tag('proxy');
    if (!pm || !s.proxyPrices?.[pm.via]) { status = 'blocked'; why = `No perps market tracks ${ticker} closely enough (correlation under 0.3) to use as a proxy.`; }
    else {
      const size = sigT && sigV ? holding * pm.beta * (sigT / sigV) : holding * pm.beta;
      const left = Math.round(Math.sqrt(Math.max(0, 1 - pm.beta ** 2)) * 100);
      if (size < PERP_MIN_USD) { status = 'blocked'; why = `A ${m(size)} ${pm.via} short is under the perps venue's ${m(PERP_MIN_USD)} minimum order.`; }
      else if (chosen !== 'proxy' && (chosen === 'perp' || chosen === 'put' || leg)) { status = 'possible'; why = `Short about ${m(size)} ${pm.via} (correlation ${pm.beta}); leaves about ${left}% of ${ticker}'s risk, so the agent uses it only when there is no direct hedge.`; }
      else why = `Short about ${m(size)} ${pm.via} (correlation ${pm.beta}); about ${left}% of ${ticker}'s risk stays.`;
    }
    out.push({ venue: 'proxy', instrument: pm ? `Short ${pm.via} perp (proxy)` : 'Proxy perp', status, why });
  }
  return out;
}

/** Alternatives for the hedge a candidate carries; [] when it is not a hedge. */
export function alternativesFor(s: Snapshot, c: Candidate | null | undefined): VenueAlternative[] {
  const h = c?.kind === 'hedge' ? c.hedge : undefined; if (!h) return [];
  return venueAlternatives(s, h.proxyFor ?? h.ticker ?? tickerOf(h.bstock), choiceOf(c));
}
