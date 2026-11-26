import type { AgentConfig } from '../../lib/agent-config';
import type { AccountHealth, RiskRule, RuleState } from '../../lib/risk-rules';
import type { HedgePlanView } from '../../lib/agent-action';
import type { OptionChain } from './risk/options';
import type { Assessment } from '../../lib/integrity';

export type Network = 'mainnet' | 'testnet';

export interface BscFunds {
  usdcUsd: number;
  usdtUsd: number;
  /** allowanceQty: how many units the user let the agent pull (needed to sell a bStock for margin). */
  bstocks: { symbol: string; qty: number; value: number; allowanceQty?: number }[];
  /** User's on-chain allowance of BSC USDC to the agent, in USDC base units (6 dp). */
  allowanceUsdcBase: string;
  /** User's on-chain allowance of BSC USDT to the agent (6 dp base units). Needed to pull USDT. */
  allowanceUsdtBase?: string;
}

/** Everything the graph knows about ONE wallet on ONE network for ONE tick. Pure data, JSON-safe. */
export interface Snapshot {
  wallet: string;
  network: Network;
  takenAt: string;
  config: AgentConfig;
  ruleState: Record<string, RuleState>;
  /** keyed by ruleKey */
  health: Record<string, AccountHealth>;
  /** Perps (Aster) signed position size by ticker, e.g. { NVDA: -0.5 } (negative = short). */
  perpPositions: Record<string, number>;
  bsc: BscFunds;
  /** Anything non-empty means: fail closed. */
  dataQuality: string[];
  /** Moves the agent already made in the last 24 h, by ruleKey (USDC base units). */
  moved24hBase: Record<string, string>;
  /** Volatility per underlying ticker, read from the perps venue's hourly klines. Only present when hedging is on. */
  market?: MarketData;
  /** Why hedging cannot be planned this tick (missing volatility, no perps account). Never blocks margin top-ups. */
  hedgeProblems?: string[];
  /** Calendar vs news disagreements per ticker (set by the news step). A hedge for that ticker is never run autonomously. */
  eventConflicts?: Record<string, string>;
  /** Names whose price feed is missing, by ticker. Only that name is skipped; the others are still planned. */
  unassessed?: Record<string, string>;
  /** Spot price of proxy hedge instruments (a ticker that is hedged through another ticker's perp). */
  proxyPrices?: Record<string, number>;
  /** Derive put chains per underlying ticker (the data a protective put needs). Empty when Derive options are not connected. */
  options?: Record<string, OptionChain>;
  /** Puts already bought and not yet expired: counted as hedges so the agent never buys the same protection twice. */
  heldPuts?: { ticker: string; notionalUsd: number; expiry: string }[];
  /** Free collateral on the Derive subaccount that would pay a put premium. */
  deriveFree?: { ref: string; freeUsd: number };
  /** EVERY venue account the wallet owns (the Aster perps account, all Derive subaccounts), read each check. */
  venueAccounts?: VenueAccount[];
  /** Why a venue could not be used this tick (missing key, outage). Rules on that venue are skipped; other venues still run. */
  venueProblems?: Partial<Record<'aster' | 'derive', string>>;
  /** Perps order minimums per ticker: minimum size, size step, minimum notional ($5 on Aster). Orders below are never sent. */
  marketMins?: Record<string, { minBase: number; step: number; minNotionalUsd: number }>;
  /** Value-based hedge inputs per leg (key = hedgeKey): the HEDGE price, signed positions, and venue minimums. */
  hedgePrices?: Record<string, number>;
  hedgePositions?: Record<string, number>;
  hedgeMins?: Record<string, { minBase: number; step: number; minNotionalUsd: number }>;
  /** The Derive put each put leg would buy: expiry nearest the target, strike nearest the target %, with its quote. */
  putPicks?: Record<string, { instrument: string; strike: number; expiry: string; ask: number; bid: number; daysToExpiry: number }>;
  /** Long put contracts the user holds on Derive, per instrument (used to roll puts before expiry). */
  putPositions?: { key: string; instrument: string; amount: number; expiry: string; strike: number; daysToExpiry: number }[];
  /** Seconds a margin move BNB -> Derive takes. */
  deriveEtaSec?: number;
  /** Seconds a margin move BNB -> perps takes (BNB Chain deposit, no bridge; measured median, else the default). */
  perpEtaSec?: number;
  /** The perps (Aster) account that carries the hedges. */
  perpMain?: { equityUsd: number; freeUsd: number };
  /** Whether the price-integrity layer is on for this snapshot (config.integrity.enabled). Off = nothing below is set and nothing is fetched. */
  integrityEnabled?: boolean;
  /** One assessment per held/relevant bStock (only when the layer is on and at least one read worked). */
  integrity?: { at: number; items: Assessment[] };
  /** Running totals the policy engine checks (today's notional, today's loss, capital parked off BNB). */
  today?: TodayStats;
}

export interface MarketData { sigmaDay: Record<string, number>; at: string }
export interface TodayStats {
  /** Hedge notional placed in the last 24 h, USD. */
  notionalUsd: number;
  /** Loss since the first reading of the UTC day, USD (0 when up). */
  lossUsd: number;
  /** Equity parked on the perps and options venues, USD. */
  capitalOffBnbUsd: number;
  /** Set when the anomaly stop has paused the agent. */
  pausedReason: string | null;
}

export interface VenueAccount { venue: 'aster' | 'derive'; id: number; label: string; equityUsd: number; freeUsd: number; main: boolean }

export type CandidateKind = 'top_up' | 'release' | 'hedge';

/** Checks done in CODE and handed to the LLM nodes as facts. A model may not state anything these contradict. */
export interface CandidateFacts {
  budget: { costUsd: number; weeklyBudgetUsd: number; within: boolean } | null;
  caps: { notionalUsd: number; perTradeCapUsd: number; dayLeftUsd: number; withinPerTrade: boolean; withinDay: boolean } | null;
  margin: { moveUsd: number; from: string | null; sufficient: boolean } | null;
  limit: { limitPct: number; varBeforePct: number; varAfterPct: number; met: boolean } | null;
  data: { complete: boolean; missing: string[] };
  calendarNewsConflict: string | null;
  /** The real reasons the order is not larger (cap, budget, chain depth, Derive collateral). Writers must use these and no others. */
  bindingConstraints?: string[];
}

export interface Candidate {
  id: string;
  kind: CandidateKind;
  ruleKey?: string;
  venue: 'aster' | 'derive';
  /** USDC base units (6 dp), integer string. For hedge: '0' (size lives in hedge.*). */
  amountBaseUnit: string;
  reason: string;
  /** One plain sentence, written by code, saying exactly what this action does and what it changes. */
  explain: string;
  /** Where the money comes from (top_up only). */
  funding?: { source: string; amountUsd: number }[];
  /** Expected utilization after the move, computed by code (so no LLM has to do the arithmetic). */
  after?: { utilBps: number | null; accountUsd: number | null };
  hedge?: { bstock: string; market: string; deltaToShort: number; driftPct: number; ticker?: string; targetUsd?: number; currentUsd?: number; instrument?: 'perp' | 'put'; key?: string; venue?: 'aster' | 'derive'; kind?: 'perp' | 'put'; hedgePrice?: number; proxyFor?: string; removesNetShort?: boolean; orderQtys?: number[]; derive?: { instrument: string; roll?: { sell: { instrument: string; amount: number }[] } }; option?: { expiry: string; strike: number; contracts: number; ask: number; premiumUsd: number; feesUsd: number; notionalUsd: number } ; /** Chat trades only: leverage to set on the market before the order. */ leverage?: number; /** Chat trades only: a close (reduce-only); otherwise a buy opens a long. */ reduceOnly?: boolean };
  /** What limited the size of this order, computed by code. */
  binding?: string[];
  /** Hard checks computed by code; see CandidateFacts. */
  facts?: CandidateFacts;
  /** Full hedge proposal shown to the user (cost, VaR before/after, margin plan, validity). */
  plan?: HedgePlanView;
  /** USD notional this action trades (hedge only), for the per-trade and per-day limits. */
  notionalUsd?: number;
  /** A trade the user asked for in the chat and approved: exact instrument and size, not chosen by the planner. */
  chat?: boolean;
  /** Stable per (wallet, rule, kind, amount, lastMoveAt): the same action reuses the same key on retry. */
  idempotencyKey: string;
  /** Plain-language need score used only for ordering (higher = more urgent). */
  urgency: number;
  rule?: RiskRule;
}

/** severity 'error' = the user should be told (funds short, cap reached, venue down); 'info' = a normal "not now". */
export interface RejectedCandidate { kind: CandidateKind; ruleKey?: string; reason: string; severity?: 'info' | 'error' }

export type StepStatus = 'pending' | 'done' | 'failed' | 'simulated';
export interface StepResult { step: string; status: StepStatus; detail?: string; ref?: string }
