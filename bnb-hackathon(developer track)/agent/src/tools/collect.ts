import { ruleKey, type AccountHealth, type RuleState } from '../../../lib/risk-rules';
import type { VenueAccount } from '../types';
import type { AgentConfig } from '../../../lib/agent-config';
import { TRADEABLE } from '../../../lib/bstocks';
import type { BscFunds, Network, Snapshot } from '../types';
import * as app from './appApi';
import * as bsc from './bsc';
import * as derive from './derive';
import * as aster from './aster';
import * as pancake from './pancake';
import * as store from './store';
import * as metrics from './metrics';
import { collectHedgeData, realHedgeDeps, type HedgeDataDeps } from './hedgeData';
import { config } from '../config';
import { collectMarket, realSigma, tickerOf, type SigmaFn } from '../risk/market';
import { getChain, type OptionChain, type OptionsProvider } from '../risk/options';
import { pickProxy, type ProxyPick } from '../risk/proxy';
import { refreshIntegrity } from './integrity';
import type { IntegritySnapshot } from '../../../lib/integrity-sources';

// Builds the Snapshot: every live reading the graph needs for one wallet. A failed read never throws; it adds a
// dataQuality flag, which makes the graph fail closed (report an error, move nothing).

export interface CollectDeps {
  getRuleStates(wallet: string, n: Network): Promise<Record<string, RuleState>>;
  getAsterCreds(wallet: string, n: Network): Promise<app.AsterCreds>;
  getDeriveCreds(wallet: string, n: Network): Promise<app.DeriveCreds>;
  /** The perps (Aster) account and positions. A never-funded account reads as connected with $0 (not an error). */
  asterAccount(n: Network, c: app.AsterCreds): Promise<aster.AsterAccountView>;
  deriveSubaccount(n: Network, wallet: string, c: app.DeriveCreds, id: number): Promise<derive.DeriveSubaccountView>;
  funds(wallet: string, symbols: string[]): Promise<{ funds: BscFunds; problems: string[] }>;
  moved24h(wallet: string, n: Network, ruleKey: string): bigint;
  /** Daily volatility of a perps market by ticker (fraction), or null when there is not enough history. */
  sigma?: SigmaFn;
  /** Hedge prices, positions and minimums (value-based sizing). Omitted = not read (real runs pass the live venues). */
  hedge?: HedgeDataDeps;
  /** Tickers the perps venue lists (USDT perps, TRADING), used to give a held bStock a default hedge leg. */
  perpMarkets?: (n: Network) => Promise<string[]>;
  /** Live Derive put chain per underlying. Omitted = no puts read (real runs pass the live Derive reader). */
  options?: OptionsProvider;
  /** A perps market's order minimums by ticker. Omitted = no minimums read. */
  perpMins?: (n: Network, ticker: string) => Promise<{ minBase: number; step: number; minNotionalUsd: number }>;
  /** Every Derive subaccount. Omitted = main accounts only. (Aster has one futures account per wallet.) */
  allDeriveSubaccounts?: (n: Network, wallet: string, c: app.DeriveCreds, mainId: number) => Promise<VenueAccount[]>;
  /** Best measured proxy market for a holding (correlation of hourly returns), or null. Omitted = no proxies. */
  proxy?: (n: Network, ticker: string, listed: string[]) => Promise<ProxyPick | null>;
  /** Price integrity of the held bStocks (Atlas + CoinMarketCap + perp). Never throws; null = unavailable. Omitted = not read. Only called when config.integrity.enabled. */
  integrity?: (funds: BscFunds, cfg: AgentConfig) => Promise<IntegritySnapshot | null>;
}

/** The perps venue's listed tickers (Aster exchangeInfo, cached 10 minutes inside the client). */
export const realPerpMarkets = async (n: Network): Promise<string[]> => (await aster.markets(n)).map((m) => m.ticker);

/**
 * A held bStock with no hedge leg of its own gets the matching perps market (NVDAB -> NVDA, traded as NVDAUSDT) at
 * ratio 1, so hedging works without hand-configuring every holding. Legs the user set always win; a stock the perps
 * venue does not list stays without a leg (the planner then tries a proxy, or reports it as unhedgeable).
 */
export function defaultHedgeLegs(legs: AgentConfig['hedge']['legs'], held: string[], markets: string[]): AgentConfig['hedge']['legs'] {
  const covered = new Set(legs.map((l) => tickerOf(l.bstock)));
  const listed = new Set(markets);
  const added: AgentConfig['hedge']['legs'] = [];
  for (const bstock of held) {
    const ticker = tickerOf(bstock);
    if (covered.has(ticker) || !listed.has(ticker)) continue;
    added.push({ bstock, venue: 'aster', kind: 'perp', market: ticker, hedgeRatio: 1 });
    covered.add(ticker);
  }
  return added;
}

export const realDeps: CollectDeps = {
  getRuleStates: app.getRuleStates, getAsterCreds: app.getAsterCreds, getDeriveCreds: app.getDeriveCreds,
  asterAccount: aster.getAccount, deriveSubaccount: derive.getSubaccount,
  funds: (wallet, symbols) => bsc.getFunds(wallet, bsc.agentAddress(), symbols, pancake.priceOf),
  moved24h: store.moved24h,
  sigma: realSigma,
  proxy: (n, t, listed) => pickProxy(n, t, listed),
  options: (n, t) => getChain(n, t),
  hedge: realHedgeDeps,
  integrity: (funds, cfg) => refreshIntegrity({ funds, cfg }),
  perpMarkets: realPerpMarkets,
  perpMins: async (n, t) => { const m = await aster.market(n, t); return { minBase: m.minQty, step: m.stepSize, minNotionalUsd: m.minNotionalUsd }; },
  allDeriveSubaccounts: async (n, wallet, c, mainId) => (await derive.listSubaccounts(n, wallet, c)).map((x) => {
    // Derive's initial_margin IS the free margin (equity minus the initial-margin requirement), as healthOf reads it.
    const eq = Number(x.collaterals_value) || 0; const free = Number(x.initial_margin) || 0;
    return { venue: 'derive' as const, id: x.subaccount_id, label: `Derive #${x.subaccount_id}${x.universeName ? ` (${x.universeName})` : ''}`, equityUsd: eq, freeUsd: Math.max(0, Math.min(eq, free)), main: x.subaccount_id === mainId };
  }),
};

const safe = <T,>(f: () => T): T | undefined => { try { return f(); } catch { return undefined; } };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * `wide` (chat only): also read every listed bStock and both venues even when no rule or hedge leg names them, so
 * "what do I hold?" is answered from the real wallet. The tick loop leaves it off and reads only what its rules need.
 */
export async function collectSnapshot(wallet: string, network: Network, userCfg: AgentConfig, deps: CollectDeps = realDeps, wide = false): Promise<Snapshot> {
  // May gain default hedge legs below (never saved: the user's settings are untouched).
  let cfg = userCfg;
  const dq: string[] = []; const health: Record<string, AccountHealth> = {}; const moved: Record<string, string> = {};
  let ruleState: Record<string, RuleState> = {}; let perpPositions: Record<string, number> = {};
  let perpMain: Snapshot['perpMain'];
  const hedgeProblems: string[] = [];
  let unassessed: Record<string, string> | undefined;
  let funds: BscFunds = { usdcUsd: 0, usdtUsd: 0, bstocks: [], allowanceUsdcBase: '0' };

  try { ruleState = await deps.getRuleStates(wallet, network); } catch (e) { dq.push(`rule-state unreadable: ${msg(e)}`); }

  let asterCreds: app.AsterCreds | null = null; let deriveCreds: app.DeriveCreds | null = null;
  // Hedging on means the perps venue may be needed even with no leg configured yet (a held bStock gets a default leg).
  const needAster = wide || cfg.rebalance.rules.some((r) => r.venue === 'aster') || cfg.hedge.enabled;
  const needDerive = wide || cfg.rebalance.rules.some((r) => r.venue === 'derive') || (cfg.hedge.enabled && cfg.hedge.legs.some((l) => l.venue === 'derive'));
  const venueProblems: NonNullable<Snapshot['venueProblems']> = {};
  if (needAster) { try { asterCreds = await deps.getAsterCreds(wallet, network); } catch (e) { venueProblems.aster = `no usable perps key (${msg(e)})`; } }
  if (needDerive) { try { deriveCreds = await deps.getDeriveCreds(wallet, network); } catch (e) { venueProblems.derive = `no usable Derive key (${msg(e)})`; } }

  // One Aster futures account per wallet. A never-funded account (-5050) is connected with $0 and no positions.
  let asterView: aster.AsterAccountView | null = null;
  if (asterCreds) {
    try {
      asterView = await deps.asterAccount(network, asterCreds);
      perpPositions = aster.positionsOf(asterView.positions);
      perpMain = aster.equityOf(asterView);
    } catch (e) { dq.push(`perps account unreadable: ${msg(e)}`); }
  }

  for (const rule of cfg.rebalance.enabled ? cfg.rebalance.rules : []) {
    const rk = ruleKey(rule);
    moved[rk] = deps.moved24h(wallet, network, rk).toString();
    try {
      if (rule.venue === 'aster') {
        if (!asterCreds) { health[rk] = aster.healthOf(null); continue; }
        // Aster has a single futures account per wallet (accountRef ''); it was read once above.
        if (rule.accountRef !== '') { dq.push(`${rk}: the perps venue has one account per wallet; set this rule on the main account`); health[rk] = aster.healthOf(null); continue; }
        if (!asterView) { health[rk] = { connected: false, utilBps: null, accountUsd: null, usedUsd: null }; continue; }   // read failed: already in dataQuality
        health[rk] = aster.healthOf(asterView);
      } else if (rule.venue === 'derive') {
        if (!deriveCreds) { health[rk] = derive.healthOf(null); continue; }
        const id = rule.accountRef ? Number(rule.accountRef) : deriveCreds.subaccountId;
        health[rk] = derive.healthOf(await deps.deriveSubaccount(network, wallet, deriveCreds, id));
      } else continue;   // a rule saved for any other venue is not read; the planner reports it
      if (!health[rk].connected) dq.push(`${rk} account not found: check the Derive subaccount (no deposit was sent)`);
    } catch (e) { dq.push(`${rk} unreadable: ${msg(e)}`); health[rk] = { connected: false, utilBps: null, accountUsd: null, usedUsd: null }; }
  }

  if (wide && deriveCreds && !Object.keys(health).some((k) => k.startsWith('derive:'))) {
    const rk = `derive:${deriveCreds.subaccountId}`;
    try { health[rk] = derive.healthOf(await deps.deriveSubaccount(network, wallet, deriveCreds, deriveCreds.subaccountId)); }
    catch (e) { dq.push(`${rk} unreadable: ${msg(e)}`); }
  }

  // Every account, not only the ones a rule points at: balances and free margin across all sub-accounts.
  const venueAccounts: VenueAccount[] = [];
  if (asterCreds && asterView) { const e = aster.equityOf(asterView); venueAccounts.push({ venue: 'aster', id: 0, label: asterView.funded ? 'Perps account' : 'Perps account (no deposit yet)', equityUsd: e.equityUsd, freeUsd: e.freeUsd, main: true }); }
  if (deriveCreds && deps.allDeriveSubaccounts) { try { venueAccounts.push(...await deps.allDeriveSubaccounts(network, wallet, deriveCreds, deriveCreds.subaccountId)); } catch (e) { dq.push(`Derive subaccounts unreadable: ${msg(e)}`); } }

  try {
    // With hedging on, read every listed bStock: a holding with no leg yet must still be seen to be hedged.
    const symbols = [...new Set([...cfg.hedge.legs.map((l) => l.bstock), ...cfg.rebalance.sellOrder, ...(wide || cfg.hedge.enabled ? TRADEABLE.map((t) => t.symbol) : [])])];
    const r = await deps.funds(wallet, symbols);
    funds = r.funds; dq.push(...r.problems);
  } catch (e) { dq.push(`BNB balances unreadable: ${msg(e)}`); }

  if (cfg.hedge.enabled) {
    const held = funds.bstocks.filter((b) => b.qty > 0).map((b) => b.symbol);
    if (held.some((s) => !cfg.hedge.legs.some((l) => tickerOf(l.bstock) === tickerOf(s)))) {
      try {
        const added = defaultHedgeLegs(cfg.hedge.legs, held, await (deps.perpMarkets ?? realPerpMarkets)(network));
        if (added.length) cfg = { ...cfg, hedge: { ...cfg.hedge, legs: [...cfg.hedge.legs, ...added] } };
      } catch (e) { hedgeProblems.push(`perps market list unreadable, so holdings without a hedge leg are not hedged: ${msg(e)}`); }
    }
  }

  // Hedging inputs. A problem here only stops hedging (never margin top-ups): the agent never guesses a volatility.
  let market: Snapshot['market'];
  let proxyPrices: Snapshot['proxyPrices'];
  const options: Record<string, OptionChain> = {};
  let hedgeData: Awaited<ReturnType<typeof collectHedgeData>> | undefined;
  const marketMins: NonNullable<Snapshot['marketMins']> = {};
  if (cfg.hedge.enabled && cfg.hedge.legs.length) {
    if (needAster && !perpMain) hedgeProblems.push('no perps account to hedge on');
    const heldSet = new Set(funds.bstocks.filter((b) => b.qty > 0).map((b) => b.symbol));
    if (cfg.hedge.sizing === 'ratio') {
      // Value-based sizing: read the HEDGE price, positions and venue minimums per leg. A leg whose price cannot be read is skipped.
      if (heldSet.size) {
        // Live reads come only from the deps (realDeps passes the real venues), never as a hidden default.
        if (deps.hedge) { const hd = await collectHedgeData(network, wallet, cfg.hedge, heldSet, perpPositions, deriveCreds, deps.hedge); hedgeData = hd; hedgeProblems.push(...hd.problems); }
      }
    }
    // Volatility for every held name, in both sizing modes: the risk view (modelled loss, required hedge ratio) needs it
    // even when hedges are sized by ratio. Read live from the perps hourly klines, cached 10 minutes.
    if (heldSet.size && deps.sigma) { const m = await collectMarket(network, cfg.hedge, heldSet, deps.sigma); market = m.market; hedgeProblems.push(...m.problems); unassessed = m.unassessed; }
    // Perps order minimums (exchangeInfo: LOT_SIZE, MIN_NOTIONAL $5) for the hedge markets of held bStocks (a missing read just skips the check).
    if (cfg.hedge.sizing !== 'ratio' && deps.perpMins) for (const leg of cfg.hedge.legs.filter((l) => heldSet.has(l.bstock) && l.venue === 'aster')) { try { marketMins[leg.market] = await deps.perpMins(network, leg.market); } catch { /* no minimum known */ } }
    // Derive put chains for every held ticker, read live (both sizing modes, so the risk view knows a put exists).
    // A missing chain just means no put is offered for that ticker.
    const chainOf = deps.options;
    if (chainOf) await Promise.all([...new Set([...heldSet].map(tickerOf))].map(async (t) => { try { const ch = await chainOf(network, t); if (ch) options[ch.ticker] = ch; } catch { /* no put offered */ } }));
    // Proxy hedges: for each held name, the perps market whose hourly returns track it best (measured live).
    // The user's own proxyMap entries win; the via market gets a perp leg so the planner can trade it.
    if (deps.proxy && market) {
      try {
        const listed = await (deps.perpMarkets ?? realPerpMarkets)(network);
        const proxyMap = { ...(cfg.risk.proxyMap ?? {}) }; const legs = [...cfg.hedge.legs]; const prices: Record<string, number> = {};
        for (const t of [...new Set([...heldSet].map(tickerOf))]) {
          const p = await deps.proxy(network, t, listed).catch(() => null);
          if (!p) continue;
          const via = proxyMap[t]?.via ?? p.via; if (via !== p.via) continue;   // user chose another proxy: leave it
          proxyMap[t] ??= { via: p.via, beta: p.beta };
          prices[p.via] = p.price;
          if (market.sigmaDay[p.via] === undefined && deps.sigma) { const sg = await deps.sigma(network, p.via).catch(() => null); if (sg) market.sigmaDay[p.via] = sg; }
          if (!legs.some((l) => l.venue === 'aster' && tickerOf(l.bstock) === p.via)) legs.push({ bstock: `${p.via}B`, venue: 'aster', kind: 'perp', market: p.via, hedgeRatio: 1 });
        }
        if (Object.keys(prices).length) { cfg = { ...cfg, risk: { ...cfg.risk, proxyMap }, hedge: { ...cfg.hedge, legs } }; proxyPrices = prices; }
      } catch (e) { hedgeProblems.push(`proxy markets unreadable: ${msg(e)}`); }
    }
  }

  // Price integrity of the bStocks (only when the layer is on: off = nothing is fetched and the field stays absent).
  const integrityEnabled = cfg.integrity?.enabled === true;
  let integrity: Snapshot['integrity'];
  if (integrityEnabled && deps.integrity) {
    try { const r = await deps.integrity(funds, cfg); if (r) integrity = { at: r.at, items: r.items }; } catch { /* unavailable: behave as before */ }
  }

  // Running totals the policy engine checks. The store may be closed in tests; then everything reads as zero.
  let today: Snapshot['today'];
  try {
    const off = (perpMain?.equityUsd ?? 0) + Object.entries(health).filter(([k, h]) => !k.startsWith('aster:') && h.connected).reduce((a, [, h]) => a + (h.accountUsd ?? 0), 0);
    const dl = store.dailyLoss(wallet, network, off);
    today = { notionalUsd: store.notional24h(wallet, network), lossUsd: dl.lossUsd, capitalOffBnbUsd: off, pausedReason: store.pausedReason(wallet, network) };
  } catch { today = undefined; }

  return { wallet, network, takenAt: new Date().toISOString(), config: cfg, ruleState, health, perpPositions, bsc: funds, dataQuality: dq, moved24hBase: moved, market, hedgeProblems, unassessed: unassessed && Object.keys(unassessed).length ? unassessed : undefined, perpMain, today, perpEtaSec: metrics.topUpLatencySec('aster').sec, venueProblems: Object.keys(venueProblems).length ? venueProblems : undefined, marketMins: Object.keys(marketMins).length ? marketMins : undefined,
    hedgePrices: hedgeData?.prices, hedgePositions: hedgeData?.positions, hedgeMins: hedgeData?.mins, putPositions: hedgeData?.putPositions, putPicks: hedgeData?.putPicks,
    options: Object.keys(options).length ? options : undefined, proxyPrices, heldPuts: safe(() => store.openPuts(wallet, network)), deriveEtaSec: config().DERIVE_ETA_SEC,
    venueAccounts: venueAccounts.length ? venueAccounts : undefined, integrityEnabled, ...(integrity ? { integrity } : {}),
    // Derive: the subaccount with the most free funds across ALL of them (falls back to a rule's account).
    deriveFree: (() => {
      const best = venueAccounts.filter((a) => a.venue === 'derive').sort((a, b) => b.freeUsd - a.freeUsd)[0];
      if (best) return { ref: String(best.id), freeUsd: best.freeUsd };
      const k = Object.keys(health).find((x) => x.startsWith('derive:') && health[x].connected); return k ? { ref: k.slice(7), freeUsd: Math.max(0, (health[k].accountUsd ?? 0) - (health[k].usedUsd ?? 0)) } : undefined;
    })() };
}
