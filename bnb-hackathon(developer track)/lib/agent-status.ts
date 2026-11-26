import { z } from 'zod';

// The agent's always-visible status (spec: "Always-visible status"): mode, limits used today, coverage line,
// next event, last news scan, what is monitored and what is not. The agent POSTs it every tick; the UI reads it.

export const NewsFlagView = z.object({
  ticker: z.string().max(12),
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  score: z.number(),
  confidence: z.number(),
  /** Advisory only: news never changes a position. */
  reason: z.string().max(400),
  headline: z.string().max(300).nullable(),
});

/** What the agent did on its most recent check, with the live data it read. Posted every tick so the page always shows the latest run. */
export const LastRun = z.object({
  at: z.string().datetime(),
  /** false = dry run: nothing is sent to a venue or chain even in autonomous mode. */
  live: z.boolean(),
  outcome: z.string().max(20),
  /** One line: what it decided ("Buy 11 XAU puts ...", "No action"). */
  decision: z.string().max(300),
  /** What happens next in the current mode, in plain words. */
  next: z.string().max(300),
  why: z.string().max(900).nullable(),
  candidates: z.array(z.string().max(500)).max(10),
  reasons: z.array(z.string().max(400)).max(10),
  analyst: z.string().max(900).nullable(),
  decider: z.string().max(900).nullable(),
  reviewer: z.string().max(900).nullable(),
  /** The live numbers the run was based on. */
  feed: z.object({
    bnbUsdc: z.number(), bnbUsdt: z.number(), lighterEquityUsd: z.number().nullable(), lighterFreeUsd: z.number().nullable(), deriveFreeUsd: z.number().nullable(),
    bstocks: z.array(z.object({ symbol: z.string().max(12), qty: z.number(), usd: z.number() })).max(30),
    positions: z.array(z.object({ market: z.string().max(20), units: z.number() })).max(30),
  }),
});
export type LastRun = z.infer<typeof LastRun>;

export const StatusIn = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  network: z.enum(['mainnet', 'testnet']),
  /** What the agent is actually doing right now. 'confirm' also when autonomy expired or a limit forced it. */
  mode: z.enum(['confirm', 'autonomous']),
  modeNote: z.string().max(300).nullable(),
  killSwitch: z.boolean(),
  /** Set when the agent paused itself (anomaly stop, daily loss cap, stale data, venue outage). */
  paused: z.object({ reason: z.string().max(300) }).nullable(),
  portfolioUsd: z.number(),
  /** Share of portfolio notional that is hedged, and the share the loss limit requires. */
  hedgedPct: z.number(),
  requiredHedgePct: z.number(),
  /** Modelled 99% loss over the window (day or next event) against the user's limit, % of portfolio. */
  varPct: z.number(),
  limitPct: z.number(),
  window: z.enum(['day', 'event']),
  coverage: z.object({ directPct: z.number(), proxyPct: z.number(), nonePct: z.number() }),
  tickers: z.array(z.object({ ticker: z.string(), bstock: z.string(), usd: z.number(), hedgedPct: z.number(), bucket: z.enum(['direct', 'proxy', 'none']), excluded: z.boolean() })).max(30),
  nextEvent: z.object({ ticker: z.string(), kind: z.string(), at: z.string().datetime(), inHours: z.number() }).nullable(),
  lastNewsScanAt: z.string().datetime().nullable(),
  newsFlags: z.array(NewsFlagView).max(30),
  limitsUsed: z.object({
    notionalTodayUsd: z.number(), maxNotionalPerDayUsd: z.number(),
    lossTodayUsd: z.number(), dailyLossCapUsd: z.number(),
    capitalOffBnbUsd: z.number(), maxCapitalOffBnbUsd: z.number(),
    autonomyExpiresAt: z.string().datetime().nullable(),
  }),
  /** Plain-language list of what the agent watches and what it cannot see. */
  monitored: z.array(z.string().max(200)).max(12),
  notMonitored: z.array(z.string().max(200)).max(12),
  /** Banner lines: data, agent or bridge down; blind spots; unhedged exposure. */
  alerts: z.array(z.string().max(300)).max(10),
  takenAt: z.string().datetime(),
  lastRun: LastRun.nullable().optional(),
});
export type StatusIn = z.infer<typeof StatusIn>;
