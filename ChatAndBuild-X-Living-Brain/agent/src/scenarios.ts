import { DEFAULT_CONFIG } from '../../lib/agent-config';
import { defaultRule } from '../../lib/risk-rules';
import { fixtureSnapshot } from './fixtures';
import type { FitInputs } from './proposal/compute';
import type { Snapshot } from './types';

// Test scenarios for testnet: every input the agent can meet, with the outcome it must produce.
// Action scenarios run the real graph on a snapshot (dry run). Proposal scenarios run the rule fitting.

export interface ActionScenario {
  name: string; describe: string; snapshot: () => Snapshot;
  expect: { outcome: 'simulated' | 'idle' | 'error' | 'awaiting'; kind?: 'top_up' | 'release' | 'hedge'; rejected?: RegExp; stepsInclude?: RegExp };
}
export interface ProposalScenario {
  name: string; describe: string; inputs: FitInputs; /** true = the scenario is about a specific volatility; --real leaves it alone. */ fixedVol?: boolean;
  expect: { source?: 'bstocks_bnb' | 'exchange_wallet'; triggerAtMost?: number; triggerAtLeast?: number; fact?: RegExp };
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const H = (utilBps: number, accountUsd = 100) => ({ connected: true, utilBps, accountUsd, usedUsd: (accountUsd * utilBps) / 10_000 });
const withHealth = (utilBps: number, accountUsd = 100): Partial<Snapshot> => ({ health: { 'aster:': H(utilBps, accountUsd) } });

/** The perps rule from the fixture, with release switched on. */
function releaseSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  const s = fixtureSnapshot(over);
  s.config.rebalance.rules[0] = { ...s.config.rebalance.rules[0], releaseOn: true, releaseLevelBps: 2500, releaseForSec: 1800 };
  return s;
}
/** Hold 10 NVDAB ($2,000). NVDA moves 3.5% a day, so the 99% loss is 8.1% against a 5% limit: about 38% must be hedged. */
function hedgeSnapshot(shortSize: number, held = 10, over: Partial<Snapshot> = {}): Snapshot {
  const s = fixtureSnapshot({ health: { 'aster:': H(5000) }, ...over });
  s.config.hedge = { enabled: true, driftThresholdPct: 5, sizing: 'loss_limit', news: { enabled: false }, legs: [{ bstock: 'NVDAB', venue: 'aster', kind: 'perp', market: 'NVDA', hedgeRatio: 1 }] };
  s.config.risk = { ...s.config.risk, lossTolerancePct: 5 };
  s.bsc = { ...s.bsc, bstocks: [{ symbol: 'NVDAB', qty: held, value: held * 200, allowanceQty: held }] };
  s.perpPositions = shortSize ? { NVDA: -shortSize } : {};
  s.market = { sigmaDay: { NVDA: 0.035 }, at: new Date().toISOString() };
  s.perpMain = { equityUsd: 1000, freeUsd: 800 };
  s.hedgeProblems = [];
  s.perpEtaSec = 600;
  s.today = { notionalUsd: 0, lossUsd: 0, capitalOffBnbUsd: 1000, pausedReason: null };
  Object.assign(s, over);
  return s;
}

export const ACTION_SCENARIOS: ActionScenario[] = [
  { name: 'top-up: utilization above trigger', describe: 'Perps at 82% (trigger 70%), BNB wallet funded', snapshot: () => fixtureSnapshot(), expect: { outcome: 'simulated', kind: 'top_up', stepsInclude: /deposit the USDT/ } },
  { name: 'idle: inside the band', describe: 'Perps at 50%', snapshot: () => fixtureSnapshot(withHealth(5000)), expect: { outcome: 'idle' } },
  { name: 'top-up: account-value mode', describe: 'Account value $40, floor $100', snapshot: () => {
    const s = fixtureSnapshot({ health: { 'aster:': { connected: true, utilBps: 3000, accountUsd: 40, usedUsd: 12 } } });
    s.config.rebalance.rules[0] = { ...s.config.rebalance.rules[0], mode: 'account_value', triggerBaseUnit: '100000000', targetBaseUnit: '150000000' };
    return s; }, expect: { outcome: 'simulated', kind: 'top_up' } },
  { name: 'top-up: Derive subaccount (dry run)', describe: 'Derive rule at 85%', snapshot: () => {
    const s = fixtureSnapshot({ health: { 'derive:42': H(8500) }, moved24hBase: { 'derive:42': '0' } });
    s.config.rebalance.rules[0] = { ...defaultRule('derive', '42'), triggerBps: 7000, targetBps: 4500 };
    return s; }, expect: { outcome: 'simulated', kind: 'top_up', stepsInclude: /depositToNewSubaccount/ } },
  { name: 'release: perps surplus is reported, never withdrawn', describe: 'Utilization 10% for 2 h, release below 25% for 30 min; the agent key cannot withdraw', snapshot: () => releaseSnapshot({
    health: { 'aster:': H(1000, 200) }, ruleState: { 'aster:': { releaseBelowSince: ago(2 * 3_600_000) } } }), expect: { outcome: 'idle', rejected: /wallet signature/ } },
  { name: 'idle: release waits for the dwell time', describe: 'Utilization 10% for only 5 min', snapshot: () => releaseSnapshot({
    health: { 'aster:': H(1000, 200) }, ruleState: { 'aster:': { releaseBelowSince: ago(5 * 60_000) } } }), expect: { outcome: 'idle' } },
  { name: 'idle: top-up already ran (run-once)', describe: 'topUpOnce set and done', snapshot: () => {
    const s = fixtureSnapshot({ ruleState: { 'aster:': { topUpDoneAt: ago(3_600_000) } } });
    s.config.rebalance.rules[0] = { ...s.config.rebalance.rules[0], topUpOnce: true };
    return s; }, expect: { outcome: 'idle' } },
  { name: 'blocked: BNB wallet empty', describe: 'No USDC to pull', snapshot: () => fixtureSnapshot({ bsc: { usdcUsd: 0, usdtUsd: 0, bstocks: [], allowanceUsdcBase: '300000000' } }), expect: { outcome: 'idle', rejected: /BNB funds short/ } },
  { name: 'blocked: wallet only just above the reserve', describe: '$12 on BNB, reserve $10', snapshot: () => fixtureSnapshot({ bsc: { usdcUsd: 12, usdtUsd: 0, bstocks: [], allowanceUsdcBase: '300000000' } }), expect: { outcome: 'idle', rejected: /BNB funds short/ } },
  { name: 'blocked: above the on-chain allowance', describe: 'Allowance $1, need $82', snapshot: () => fixtureSnapshot({ bsc: { usdcUsd: 500, usdtUsd: 0, bstocks: [], allowanceUsdcBase: '1000000' } }), expect: { outcome: 'idle', rejected: /BNB funds short/ } },
  { name: 'blocked: 24h cap reached', describe: 'Already moved $1,999.99 of a $2,000 cap', snapshot: () => fixtureSnapshot({ moved24hBase: { 'aster:': '1999999999' } }), expect: { outcome: 'idle', rejected: /24h cap/ } },
  { name: 'blocked: cooling down', describe: 'Last move 1 minute ago, cooldown 10 min', snapshot: () => fixtureSnapshot({ ruleState: { 'aster:': { lastMoveAt: ago(60_000) } } }), expect: { outcome: 'idle', rejected: /cooling down/ } },
  { name: 'blocked: automation switched off', describe: 'Master switch off', snapshot: () => { const s = fixtureSnapshot(); s.config.rebalance.enabled = false; return s; }, expect: { outcome: 'idle' } },
  { name: 'blocked: rule paused', describe: 'Rule disabled', snapshot: () => { const s = fixtureSnapshot(); s.config.rebalance.rules[0] = { ...s.config.rebalance.rules[0], enabled: false }; return s; }, expect: { outcome: 'idle' } },
  { name: 'sell: top-up funded by selling a bStock', describe: '$0 stables, 1 SPYB ($500) with an allowance to the agent', snapshot: () => {
    const s = fixtureSnapshot({ bsc: { usdcUsd: 0, usdtUsd: 0, bstocks: [{ symbol: 'SPYB', qty: 1, value: 500, allowanceQty: 1 }], allowanceUsdcBase: '0' } });
    s.config.rebalance = { ...s.config.rebalance, sources: ['sell_bstocks'], sellOrder: ['SPYB'] };
    return s; }, expect: { outcome: 'simulated', kind: 'top_up', stepsInclude: /sell .*SPYB/ } },
  { name: 'blocked: bStock sale has no allowance', describe: 'Allowance to the agent is 0', snapshot: () => {
    const s = fixtureSnapshot({ bsc: { usdcUsd: 0, usdtUsd: 0, bstocks: [{ symbol: 'SPYB', qty: 1, value: 500, allowanceQty: 0 }], allowanceUsdcBase: '0' } });
    s.config.rebalance = { ...s.config.rebalance, sources: ['sell_bstocks'], sellOrder: ['SPYB'] };
    return s; }, expect: { outcome: 'idle', rejected: /BNB funds short/ } },
  { name: 'blocked: bStock not on the sell list', describe: 'NVDAB held but only SPYB may be sold', snapshot: () => {
    const s = fixtureSnapshot({ bsc: { usdcUsd: 0, usdtUsd: 0, bstocks: [{ symbol: 'NVDAB', qty: 10, value: 2000, allowanceQty: 10 }], allowanceUsdcBase: '0' } });
    s.config.rebalance = { ...s.config.rebalance, sources: ['sell_bstocks'], sellOrder: ['SPYB'] };
    return s; }, expect: { outcome: 'idle' } },
  { name: 'blocked: kill switch stops a top-up', describe: 'Kill switch on, account at 82%', snapshot: () => { const s = fixtureSnapshot(); s.config.limits.killSwitch = true; return s; }, expect: { outcome: 'idle', rejected: /kill switch/ } },
  { name: 'blocked: too much capital would sit off BNB', describe: 'Cap $100 off BNB, top-up would add $82 to $100 already there', snapshot: () => {
    const s = fixtureSnapshot({ today: { notionalUsd: 0, lossUsd: 0, capitalOffBnbUsd: 100, pausedReason: null } }); s.config.limits.maxCapitalOffBnbUsd = 150; return s; }, expect: { outcome: 'idle', rejected: /off BNB/ } },
  { name: 'mode gate: autonomy expired, so it asks first', describe: 'Autonomous but the expiry passed an hour ago', snapshot: () => {
    const s = fixtureSnapshot(); s.config.limits.autonomyExpiresAt = ago(3_600_000); return s; }, expect: { outcome: 'awaiting', kind: 'top_up' } },
  { name: 'mode gate: daily loss cap hit stops autonomy', describe: 'Lost $1,200 today against a $1,000 cap', snapshot: () => {
    return fixtureSnapshot({ today: { notionalUsd: 0, lossUsd: 1200, capitalOffBnbUsd: 100, pausedReason: null } }); }, expect: { outcome: 'awaiting', kind: 'top_up' } },
  { name: 'blocked: BSC USDT funding is not supported', describe: 'Only USDT on BNB', snapshot: () => {
    const s = fixtureSnapshot({ bsc: { usdcUsd: 0, usdtUsd: 500, bstocks: [], allowanceUsdcBase: '300000000' } });
    s.config.rebalance = { ...s.config.rebalance, sources: ['bsc_usdt'] };
    return s; }, expect: { outcome: 'idle', rejected: /BNB funds short/ } },
  { name: 'fail closed: perps account unreadable', describe: 'Venue read failed', snapshot: () => fixtureSnapshot({ dataQuality: ['perps account unreadable: HTTP 404'] }), expect: { outcome: 'error' } },
  { name: 'fail closed: no price for a bStock', describe: 'Price missing', snapshot: () => fixtureSnapshot({ dataQuality: ['no price for NVDAB'] }), expect: { outcome: 'error' } },
  { name: 'fail closed: BNB balances unreadable', describe: 'RPC down', snapshot: () => fixtureSnapshot({ dataQuality: ['BNB balances unreadable: timeout'] }), expect: { outcome: 'error' } },
  { name: 'hedge: sized from the loss limit (no hedge yet)', describe: '$2,000 NVDAB, 99% loss 8.1% vs 5% limit: hedge about 38%', snapshot: () => hedgeSnapshot(0), expect: { outcome: 'simulated', kind: 'hedge', stepsInclude: /sell [\d.]+ NVDA/ } },
  { name: 'hedge: already hedged enough', describe: 'Short 4 NVDA ($800 of $2,000) already meets the 5% limit', snapshot: () => hedgeSnapshot(3.85), expect: { outcome: 'idle' } },
  { name: 'hedge: loss limit is loose, nothing needed', describe: 'Tolerance 50%', snapshot: () => { const s = hedgeSnapshot(0); s.config.risk.lossTolerancePct = 50; return s; }, expect: { outcome: 'idle' } },
  { name: 'hedge: an existing hedge is never trimmed', describe: 'Short 10 (100%) but the limit only needs 38%: the agent leaves it alone', snapshot: () => hedgeSnapshot(10), expect: { outcome: 'idle' } },
  { name: 'hedge: tickers on the do-not-hedge list', describe: 'NVDA excluded by the user', snapshot: () => { const s = hedgeSnapshot(0); s.config.risk.excludeTickers = ['NVDA']; return s; }, expect: { outcome: 'idle' } },
  { name: 'hedge: user wants NVDA fully hedged', describe: 'fullyHedgeTickers = NVDA', snapshot: () => { const s = hedgeSnapshot(0); s.config.risk.fullyHedgeTickers = ['NVDA']; s.config.risk.lossTolerancePct = 50; return s; }, expect: { outcome: 'simulated', kind: 'hedge', stepsInclude: /sell 10 NVDA/ } },
  { name: 'hedge: scheduled earnings use the event gap', describe: 'NVDA earnings in 6h, 12% gap: the hedge grows', snapshot: () => { const s = hedgeSnapshot(3.85); s.config.events = [{ ticker: 'NVDA', at: new Date(Date.now() + 6 * 3_600_000).toISOString(), kind: 'earnings', gapPct: 12 }]; return s; }, expect: { outcome: 'simulated', kind: 'hedge', stepsInclude: /sell [\d.]+ NVDA/ } },
  { name: 'hedge: no volatility data (fail closed)', describe: 'Candles unavailable', snapshot: () => hedgeSnapshot(0, 10, { hedgeProblems: ['NVDA volatility unavailable: HTTP 404'] }), expect: { outcome: 'idle', rejected: /volatility/ } },
  { name: 'hedge: kill switch', describe: 'Kill switch on', snapshot: () => { const s = hedgeSnapshot(0); s.config.limits.killSwitch = true; return s; }, expect: { outcome: 'idle', rejected: /kill switch/ } },
  { name: 'hedge: trimmed to the per-trade notional limit', describe: 'Max $100 per trade: sells $100 now, the rest later', snapshot: () => { const s = hedgeSnapshot(0); s.config.limits.maxNotionalPerTradeUsd = 100; return s; }, expect: { outcome: 'simulated', kind: 'hedge', stepsInclude: /sell 0\.5 NVDA/ } },
  { name: 'hedge: trimmed to what is left of the daily limit', describe: '$19,900 already hedged today of $20,000', snapshot: () => { const s = hedgeSnapshot(0); s.today = { notionalUsd: 19_900, lossUsd: 0, capitalOffBnbUsd: 1000, pausedReason: null }; return s; }, expect: { outcome: 'simulated', kind: 'hedge', stepsInclude: /sell 0\.5 NVDA/ } },
  { name: 'hedge: daily notional limit used up', describe: '$20,000 already hedged today', snapshot: () => { const s = hedgeSnapshot(0); s.today = { notionalUsd: 20_000, lossUsd: 0, capitalOffBnbUsd: 1000, pausedReason: null }; return s; }, expect: { outcome: 'idle', rejected: /used up/ } },
  { name: 'hedge: agent paused by the anomaly stop', describe: 'Paused for limit probing', snapshot: () => { const s = hedgeSnapshot(0); s.today = { notionalUsd: 0, lossUsd: 0, capitalOffBnbUsd: 1000, pausedReason: '6 refusals in 10 minutes looks like limit probing' }; return s; }, expect: { outcome: 'idle', rejected: /paused/ } },
  { name: 'hedge: no perps margin and a slow deposit', describe: 'Earnings in 10 min, deposit 25 min, $0 free margin', snapshot: () => {
    const s = hedgeSnapshot(0); s.perpMain = { equityUsd: 0, freeUsd: 0 }; s.perpEtaSec = 1500;
    s.config.events = [{ ticker: 'NVDA', at: new Date(Date.now() + 10 * 60_000).toISOString(), kind: 'earnings', gapPct: 12 }]; return s; }, expect: { outcome: 'idle', rejected: /deposit time/ } },
  { name: 'hedge: needs margin, deposit is fast enough', describe: 'No free margin, 10 min deposit, no event: moves margin first', snapshot: () => {
    const s = hedgeSnapshot(0); s.perpMain = { equityUsd: 0, freeUsd: 0 }; return s; }, expect: { outcome: 'simulated', kind: 'hedge', stepsInclude: /deposit the USDT/ } },
  { name: 'hedge: switched off', describe: 'Hedge disabled', snapshot: () => { const s = hedgeSnapshot(0); s.config.hedge.enabled = false; return s; }, expect: { outcome: 'idle' } },
];

const book: FitInputs = { vol1h: 0.041, latencySec: 18, leverage: 12, utilNow: 0.55, equityUsd: 10_000, usedUsd: 5_500, bnbStablesUsd: 0, bstocksAfterHaircutUsd: 7_000 };

export const PROPOSAL_SCENARIOS: ProposalScenario[] = [
  { name: 'spec demo: empty wallet, bStocks held', describe: 'Vol 4.1%, latency 18s, 12x, $0 stables, $7k bStocks', inputs: book, expect: { source: 'bstocks_bnb', fact: /no USDC or USDT/ } },
  { name: 'calm market', fixedVol: true, describe: 'Vol 0.4%: trigger can sit high', inputs: { ...book, vol1h: 0.004, bnbStablesUsd: 20_000 }, expect: { source: 'exchange_wallet', triggerAtLeast: 0.7 } },
  { name: 'violent market', fixedVol: true, describe: 'Vol 12%: trigger must drop', inputs: { ...book, vol1h: 0.12, bnbStablesUsd: 20_000 }, expect: { triggerAtMost: 0.55 } },
  { name: 'very high leverage', fixedVol: true, describe: '40x book', inputs: { ...book, leverage: 40, bnbStablesUsd: 20_000 }, expect: { triggerAtMost: 0.5 } },
  { name: 'slow transfers', fixedVol: true, describe: 'Top-up takes 15 min', inputs: { ...book, latencySec: 900, bnbStablesUsd: 20_000 }, expect: { triggerAtMost: 0.45 } },
  { name: 'stables can cover it', describe: '$20k USDC on BNB', inputs: { ...book, bnbStablesUsd: 20_000 }, expect: { source: 'exchange_wallet' } },
  { name: 'nothing can cover it', describe: '$0 stables, $10 bStocks', inputs: { ...book, bstocksAfterHaircutUsd: 10 }, expect: { fact: /no source has capacity/ } },
  { name: 'already near the limit', describe: 'Utilization 80%', inputs: { ...book, utilNow: 0.8, bnbStablesUsd: 20_000 }, expect: { fact: /already 80%/ } },
];
