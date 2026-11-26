import { z } from 'zod';

// Confirmation mode: before a real move, the agent asks. The user sees WHAT it wants to do, WHY, what it HELPS,
// and the exact steps it will run on approval. After approving, the agent runs it and reports back (the ack).
// Shared by the API routes, the UI and the agent service.

/** Profit and loss on the hedged name before and after the hedge, from the agent's payoff model. */
export const PayoffView = z.object({
  ticker: z.string().max(12), holdingUsd: z.number(), hedgeLabel: z.string().max(200), costUsd: z.number(), note: z.string().max(400),
  points: z.array(z.object({ movePct: z.number(), beforeUsd: z.number(), afterUsd: z.number() })).max(40),
});
export type PayoffView = z.infer<typeof PayoffView>;

/** Each venue the agent considered for a hedge, and why it was or was not used. */
export const VenueAlternative = z.object({
  venue: z.enum(['aster', 'lighter', 'derive', 'proxy']), instrument: z.string().max(120), status: z.enum(['chosen', 'possible', 'blocked']), why: z.string().max(400),
});
export type VenueAlternative = z.infer<typeof VenueAlternative>;

export const ActionIn = z.object({
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  network: z.enum(['mainnet', 'testnet']),
  kind: z.enum(['top_up', 'release', 'hedge']),
  venue: z.enum(['aster', 'lighter', 'derive']),
  /** Why it came up: a margin rule or a news-driven hedge. */
  origin: z.enum(['rule', 'news', 'chat']),
  /** One request per slot is open at a time; a newer one supersedes it. e.g. 'lighter:' or 'hedge:NVDA'. */
  slot: z.string().min(1).max(60),
  title: z.string().min(1).max(160),
  why: z.string().min(1).max(800),
  helps: z.string().min(1).max(500),
  willDo: z.array(z.string().min(1).max(300)).min(1).max(8),
  /** What the agent needs back to run it (candidate id, amounts, hedge leg). Opaque to the UI. */
  detail: z.record(z.unknown()),
  /** Hedge proposals carry the full plan so the card can show cost, VaR before/after, margin plan and validity. */
  plan: z.lazy(() => HedgePlanView).optional(),
  /** Hedge requests: the payoff before and after, and every venue considered with why it was or was not used. */
  payoff: PayoffView.optional(),
  alternatives: z.array(VenueAlternative).max(6).optional(),
  idempotencyKey: z.string().min(8).max(80),
});
export type ActionIn = z.infer<typeof ActionIn>;

export type ActionStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'expired' | 'executed' | 'failed';

export interface ActionRow {
  id: number; network: string; slot: string; status: ActionStatus;
  kind: ActionIn['kind']; venue: ActionIn['venue']; origin: ActionIn['origin'];
  title: string; why: string; helps: string; willDo: string[]; detail: Record<string, unknown>; plan: HedgePlanView | null; payoff: PayoffView | null; alternatives: VenueAlternative[];
  result_message: string | null; created_at: number; decided_at: number | null; completed_at: number | null;
}

/** A pending request goes stale (prices move): after this many minutes the agent asks again instead. */
export const ACTION_TTL_MIN = 30;

/**
 * What a hedge proposal shows the user (spec: "Each hedge proposal shows"): what is and is not hedged, the
 * instrument and size, the cost, the effect on VaR, the margin plan with transfer time, how long it is valid,
 * the assumptions, and the worst case on the hedge itself. Every number is computed by code, never by the LLM.
 */
export const HedgePlanView = z.object({
  /** Share of portfolio notional with a direct hedge, a proxy hedge, or none, before this action. */
  coverage: z.object({ directPct: z.number(), proxyPct: z.number(), nonePct: z.number() }),
  tickers: z.array(z.object({
    ticker: z.string(), usd: z.number(), hedgedPct: z.number(), bucket: z.enum(['direct', 'proxy', 'none']),
    /** Hedged share AFTER this trade, and the raw amounts held and short (a short above the holding is a net short). */
    hedgedAfterPct: z.number().optional(), shortUsd: z.number().optional(), netShortUsd: z.number().optional(), via: z.string().max(40).optional(),
  })).max(30),
  /** Portfolio share hedged now and after this trade (coverage above is how much COULD be hedged). */
  portfolioHedgedPct: z.number().optional(),
  /** Modelled loss if every hedge proposed in this check runs (each card also shows its own effect). */
  varAfterAllPct: z.number().optional(),
  portfolioHedgedAfterPct: z.number().optional(),
  /** What limited the size, and the choices the user has when the limit is not met. */
  bindingConstraint: z.string().max(300).optional(),
  options: z.array(z.string().max(300)).max(6).optional(),
  /** Notional of each order when the trade is split to fit the per-trade cap, the gap-up cost and the margin it uses. */
  orders: z.array(z.number()).max(12).optional(),
  gapUpCostUsd: z.number().optional(),
  marginUsedUsd: z.number().optional(),
  concentration: z.string().max(300).optional(),
  portfolioUsd: z.number(),
  instrument: z.string().max(80),
  venue: z.enum(['aster', 'lighter', 'derive']),
  ticker: z.string().max(12),
  sizeUsd: z.number(),
  leverage: z.number().nullable(),
  /** Loss the user accepts and the modelled 99% loss before and after this hedge, % of portfolio. */
  limitPct: z.number(),
  varBeforePct: z.number(),
  varAfterPct: z.number(),
  requiredHedgePct: z.number(),
  window: z.enum(['day', 'event']),
  cost: z.object({ feesUsd: z.number(), premiumUsd: z.number(), fundingEstUsd: z.number(), idleMarginUsd: z.number(), weeklyBudgetUsd: z.number() }),
  marginPlan: z.object({ moveUsd: z.number(), from: z.string(), to: z.string(), etaSec: z.number() }).nullable(),
  validUntil: z.string().datetime(),
  assumptions: z.array(z.string().max(300)).max(10),
  invalidatedBy: z.array(z.string().max(300)).max(10),
  worstCase: z.string().max(600),
  residual: z.string().max(600),
});
export type HedgePlanView = z.infer<typeof HedgePlanView>;
