import { z } from 'zod';
import { ruleKey, ruleProblem, type RiskRule } from './risk-rules';

// The contract between this UI and the agent service. The agent reads it via
// GET /api/agent/v1/config and acts on it; docs/AGENT.md explains every field.
// Money is integer USDC base units (6 dp) as strings; percentages are integer basis points.

const pct = z.number().min(0).max(100);
const baseUnits = z.string().regex(/^\d{1,15}$/, 'USDC base units (6 dp) as an integer string');
const bps = z.number().int().min(1).max(10_000);

/**
 * One hedge leg for a bStock held on BNB (see lib/plan.ts planHedge). Sized by NOTIONAL:
 * hedge units = bStock qty × bStock price × hedgeRatio ÷ hedge price — identical to share count for
 * NVDAB → NVDA, and correct for index proxies (SPYB → Derive US500, QQQB → Derive US100).
 */
export const HedgeLeg = z.object({
  bstock: z.string().min(2).max(12),            // e.g. 'NVDAB' (held on BSC)
  venue: z.enum(['aster', 'lighter', 'derive']),
  /** perp = short the perp; put = hold protective puts (long), rolled before expiry. */
  kind: z.enum(['perp', 'put']).default('perp'),
  market: z.string().min(1).max(24),            // Lighter symbol ('NVDA') or Derive currency ('NVDA', 'US500')
  marketId: z.number().int().min(0).optional(), // Lighter market id (required for Lighter)
  hedgeRatio: z.number().min(0).max(1.5),       // 1.0 = fully hedged by notional
  put: z.object({
    strikePct: z.number().min(50).max(100),     // strike as % of spot: 90 = 10% out of the money
    minDaysToExpiry: z.number().int().min(1).max(90),   // roll when the held put has fewer days left
    targetDaysToExpiry: z.number().int().min(2).max(365), // buy the expiry closest to this
  }).optional(),
}).superRefine((l, ctx) => {
  if ((l.venue === 'lighter' || l.venue === 'aster') && l.kind !== 'perp') ctx.addIssue({ code: 'custom', path: ['kind'], message: 'Perp hedges are perps only' });
  if (l.venue === 'lighter' && l.marketId === undefined) ctx.addIssue({ code: 'custom', path: ['marketId'], message: 'Lighter hedge needs marketId' });
  if (l.kind === 'put' && !l.put) ctx.addIssue({ code: 'custom', path: ['put'], message: 'Put hedge needs strikePct and expiry settings' });
  if (l.put && l.put.targetDaysToExpiry <= l.put.minDaysToExpiry) ctx.addIssue({ code: 'custom', path: ['put', 'targetDaysToExpiry'], message: 'Target expiry must be later than the roll point' });
});

/** Key used to look up the current hedge position for a leg. */
export const hedgeKey = (l: { venue: 'aster' | 'lighter' | 'derive'; kind?: 'perp' | 'put'; market: string; marketId?: number }) =>
  l.venue === 'aster' ? `aster:${l.market}` : l.venue === 'lighter' ? `lighter:${l.marketId}` : `derive-${l.kind ?? 'perp'}:${l.market}`;

/** One auto-rebalance rule for one venue account (see lib/risk-rules.ts for the semantics). */
export const RiskRuleSchema = z.object({
  venue: z.enum(['aster', 'lighter', 'derive']),
  accountRef: z.string().max(24),
  accountLabel: z.string().max(40).nullable().optional(),
  mode: z.enum(['utilization', 'account_value']),
  triggerBps: bps.nullable(), targetBps: bps.nullable(),
  triggerBaseUnit: baseUnits.nullable(), targetBaseUnit: baseUnits.nullable(),
  topUpOnce: z.boolean(),
  releaseOn: z.boolean(),
  releaseLevelBps: bps.nullable(), releaseLevelBaseUnit: baseUnits.nullable(),
  releaseForSec: z.number().int().min(0).max(7 * 86_400).nullable(),
  releaseTargetBps: bps.nullable(), releaseTargetBaseUnit: baseUnits.nullable(),
  releaseOnce: z.boolean(),
  maxPerMoveBaseUnit: baseUnits, dailyCapBaseUnit: baseUnits, minMoveBaseUnit: baseUnits,
  cooldownSec: z.number().int().min(60).max(86_400),
  enabled: z.boolean(),
});

/** News is ADVISORY ONLY: it raises flags and can prompt a review, but never changes a position or a hedge size. */
export const NewsFlags = z.object({ enabled: z.boolean() });

/**
 * What the user can stand to lose, from which the agent SOLVES the hedge size: h >= 1 - L / VaR99.
 * The agent can propose changes to these but never applies them: only the user changes limits.
 */
export const RiskProfile = z.object({
  /** Maximum loss accepted over one day or one event, as % of the bStock portfolio. */
  lossTolerancePct: z.number().min(0.1).max(50),
  /** Most the user will pay for protection per week (premium, fees and funding), % of the portfolio. */
  premiumBudgetWeeklyPct: z.number().min(0).max(10),
  /** Tickers never hedged (underlying symbols, e.g. 'GME'). */
  excludeTickers: z.array(z.string().max(12)).max(26),
  /** Tickers always hedged in full, whatever the loss limit says. */
  fullyHedgeTickers: z.array(z.string().max(12)).max(26),
  /** Assumed pairwise correlation between stocks for the portfolio VaR (0 = independent, 1 = move together). */
  correlation: z.number().min(0).max(1),
  /** A name with no hedge market of its own can be hedged through another name's perp: MSTR to COIN at correlation 0.7. */
  proxyMap: z.record(z.string().max(12), z.object({ via: z.string().max(12), beta: z.number().min(0).max(1) })).default({}),
  /** Hedge ahead of a known event this many hours before it. */
  eventLeadHours: z.number().min(1).max(168),
});
export const DEFAULT_RISK: z.infer<typeof RiskProfile> = { lossTolerancePct: 5, premiumBudgetWeeklyPct: 1, excludeTickers: [], fullyHedgeTickers: [], correlation: 0.5, eventLeadHours: 24, proxyMap: {} };

/** Hard limits the policy engine enforces on every action. Set by the user only. */
export const Limits = z.object({
  maxNotionalPerTradeUsd: z.number().min(0).max(10_000_000),
  maxNotionalPerDayUsd: z.number().min(0).max(100_000_000),
  /** Cap on perp leverage. The agent also caps it so that (p99 gap x leverage) stays under ~30% of margin. */
  /** Your cap on leverage (agent hedges and chat trades). Each market's own maximum still applies (NVDA 20x). */
  maxLeverage: z.number().min(1).max(125),
  /** Stop autonomous actions once the account has lost this much since the start of the day. */
  dailyLossCapUsd: z.number().min(0).max(100_000_000),
  /** Most idle margin the user will park on Lighter and Derive. */
  maxCapitalOffBnbUsd: z.number().min(0).max(100_000_000),
  /** Autonomous permission lapses at this time (null = no expiry set). After it the agent asks first. */
  autonomyExpiresAt: z.string().datetime().nullable(),
  /** Halts every new order and transfer instantly. Existing protective hedges stay open. */
  killSwitch: z.boolean(),
});
export const DEFAULT_LIMITS: z.infer<typeof Limits> = { maxNotionalPerTradeUsd: 5_000, maxNotionalPerDayUsd: 20_000, maxLeverage: 3, dailyLossCapUsd: 1_000, maxCapitalOffBnbUsd: 10_000, autonomyExpiresAt: null, killSwitch: false };

/** A known scheduled event for a ticker. The agent hedges ahead of it using the event-window gap. */
export const MarketEvent = z.object({
  ticker: z.string().min(1).max(12),
  at: z.string().datetime(),
  kind: z.enum(['earnings', 'corporate_action', 'halt']),
  /** Expected 99% gap for this event, % of price. Omit to use the agent's default for the kind. */
  gapPct: z.number().min(0).max(100).optional(),
});
export type MarketEvent = z.infer<typeof MarketEvent>;

const AgentConfigBase = z.object({
  /**
   * autonomous: the agent acts on its own and reports in the activity feed.
   * confirm: the agent asks first (what, why, what it does) and acts only after you approve in the app.
   */
  mode: z.enum(['autonomous', 'confirm']).default('confirm'),
  hedge: z.object({
    enabled: z.boolean(),
    driftThresholdPct: pct,                     // re-hedge when |hedge - target| / target exceeds this
    legs: z.array(HedgeLeg).max(26),
    /** ratio (default): each leg is hedged to its ratio by value. loss_limit: the smallest hedge that keeps modelled loss inside risk.lossTolerancePct (the leg ratio is the maximum). */
    sizing: z.enum(['ratio', 'loss_limit']).default('ratio'),
    news: NewsFlags.default({ enabled: false }),
  }),
  risk: RiskProfile.default(DEFAULT_RISK),
  limits: Limits.default(DEFAULT_LIMITS),
  events: z.array(MarketEvent).max(50).default([]),
  rebalance: z.object({
    /** Master switch: off = rules are saved but nothing moves. */
    enabled: z.boolean(),
    /** One rule per venue account (Lighter main; each Derive subaccount). */
    rules: z.array(RiskRuleSchema).max(16),
    /** Where top-up money comes from on BNB Chain, in order. */
    sources: z.array(z.enum(['bsc_usdc', 'bsc_usdt', 'sell_bstocks'])).min(1).max(3),
    /** bStocks the agent may sell (in this order) when 'sell_bstocks' is a source. */
    sellOrder: z.array(z.string()).max(26),
    /** Never drain the BNB wallet below this. */
    keepBscReserveBaseUnit: baseUnits,
  }),
  collateral: z.object({
    /** Haircut applied to a bStock's value when counting what selling it yields (0.3 = 30% off). */
    bstockHaircut: z.number().min(0).max(0.9),
  }),
  /**
   * Price integrity for bStock collateral (Atlas oracle + CoinMarketCap DEX + the stock's perp). ON by default.
   * OFF = exactly the behaviour from before this existed: flat haircut, no price checks, nothing blocked. The one-click
   * way back if a data source misbehaves (for example in a live demo). A saved config without this key means ON.
   */
  integrity: z.object({ enabled: z.boolean() }).default({ enabled: true }),
  /** When the agent checks this wallet: automatically every 30 s, or only when you press Run now. Approved requests always run. */
  schedule: z.object({
    auto: z.boolean(),
    /** Unix ms of the last "Run now" press; the agent runs one check when this is newer than its last check. */
    runNowAt: z.number().int().nullable(),
  }).default({ auto: true, runNowAt: null }),
}).superRefine((c, ctx) => {
  const seen = new Set<string>();
  c.rebalance.rules.forEach((r, i) => {
    const k = ruleKey(r);
    if (seen.has(k)) ctx.addIssue({ code: 'custom', path: ['rebalance', 'rules', i], message: `two rules for ${k}` });
    seen.add(k);
    const p = ruleProblem(r as RiskRule);
    if (p) ctx.addIssue({ code: 'custom', path: ['rebalance', 'rules', i], message: p });
  });
});

/**
 * Legacy configs: the old 'pledge_bstocks' source maps to 'sell_bstocks', and the old pledge order list
 * (any other rebalance key ending in 'Order') becomes sellOrder when sellOrder is absent.
 */
const legacy = (raw: unknown): unknown => {
  if (!raw || typeof raw !== 'object') return raw;
  const r = structuredClone(raw) as { rebalance?: Record<string, unknown> };
  const rb = r.rebalance;
  if (rb) {
    if (Array.isArray(rb.sources)) {
      const kept = [...new Set(rb.sources.map((x) => (typeof x === 'string' && x !== 'sell_bstocks' && x.endsWith('_bstocks') ? 'sell_bstocks' : x)))];
      rb.sources = kept.length ? kept : ['bsc_usdc'];
    }
    for (const k of Object.keys(rb)) {
      if (k !== 'sellOrder' && k.endsWith('Order')) { if (rb.sellOrder === undefined && Array.isArray(rb[k])) rb.sellOrder = rb[k]; delete rb[k]; }
    }
    if (rb.sellOrder === undefined) rb.sellOrder = [];
  }
  return r;
};
export const AgentConfig = z.preprocess(legacy, AgentConfigBase);
export type AgentConfig = z.infer<typeof AgentConfigBase>;
export type HedgeLeg = z.infer<typeof HedgeLeg>;

export const DEFAULT_CONFIG: AgentConfig = {
  mode: 'confirm',
  hedge: { enabled: false, driftThresholdPct: 5, legs: [], sizing: 'ratio', news: { enabled: false } },
  risk: DEFAULT_RISK,
  limits: DEFAULT_LIMITS,
  events: [],
  rebalance: {
    enabled: false,
    rules: [],
    sources: ['bsc_usdc', 'bsc_usdt', 'sell_bstocks'],
    sellOrder: ['SPYB', 'QQQB'],
    keepBscReserveBaseUnit: '10000000',
  },
  collateral: { bstockHaircut: 0.3 },
  schedule: { auto: true, runNowAt: null },
  integrity: { enabled: true },
};

/** Agent-written runtime state for one rule (dwell timers, run-once markers, last outcome). */
export const RuleStateSchema = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  network: z.enum(['mainnet', 'testnet']),
  ruleKey: z.string().regex(/^(aster|lighter|derive):\d{0,24}$/),
  topUpDoneAt: z.string().datetime().nullable().optional(),
  releaseDoneAt: z.string().datetime().nullable().optional(),
  releaseBelowSince: z.string().datetime().nullable().optional(),
  lastMoveAt: z.string().datetime().nullable().optional(),
  lastOutcome: z.string().max(40).nullable().optional(),
  lastOutcomeMsg: z.string().max(300).nullable().optional(),
});

export const AgentEvent = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  network: z.enum(['mainnet', 'testnet']),
  kind: z.enum(['hedge', 'rebalance', 'bridge', 'info', 'error', 'news', 'warning']),
  venue: z.enum(['aster', 'lighter', 'derive', 'bsc', 'relay']).optional(),
  status: z.enum(['pending', 'done', 'failed']).optional(),
  message: z.string().min(1).max(500),
  payload: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(8).max(80),
});
