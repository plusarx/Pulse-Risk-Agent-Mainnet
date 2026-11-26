import { z } from 'zod';

export const AnalystOut = z.object({
  dataLooksSane: z.boolean().describe('false if any number looks wrong or inconsistent'),
  concerns: z.array(z.string().max(600)).max(8),
  summary: z.string().max(800),
});
export type AnalystOut = z.infer<typeof AnalystOut>;

export const DeciderOut = z.object({
  action: z.enum(['execute', 'skip']),
  candidateId: z.string().optional().describe('required when action is execute; must be one of the given candidate ids'),
  reason: z.string().min(1).max(900),
});
export type DeciderOut = z.infer<typeof DeciderOut>;

export const ReviewerOut = z.object({
  verdict: z.enum(['approve', 'veto']),
  reason: z.string().min(1).max(900),
});
export type ReviewerOut = z.infer<typeof ReviewerOut>;

export const ReporterOut = z.object({ message: z.string().min(1).max(600) });
export type ReporterOut = z.infer<typeof ReporterOut>;

/** The risk analyst only WRITES the explanation. The numbers in the proposed rule are computed by code. */
export const RiskAnalystOut = z.object({
  structural_risk: z.string().min(1).max(500).describe('plain-language structural risk of this book'),
  reasoning: z.string().min(1).max(1000).describe('why these numbers, citing vol, latency, leverage and funding'),
});
export type RiskAnalystOut = z.infer<typeof RiskAnalystOut>;

/** News sentiment per stock. The LLM only READS headlines; code turns the score into a hedge ratio inside the user's limits. */
export const NewsOut = z.object({
  items: z.array(z.object({
    ticker: z.string().max(12).describe('one of the tickers in the input'),
    score: z.number().min(-1).max(1).describe('-1 very negative for the stock price, 0 neutral, +1 very positive'),
    confidence: z.number().min(0).max(1).describe('how sure you are, given how many headlines agree and how fresh they are'),
    reason: z.string().min(1).max(700).describe('plain words, at most two short sentences (under 200 characters): what the news says and why it moves the price'),
    keyHeadlines: z.array(z.string().max(400)).max(3).describe('the headlines that drove the score, copied from the input'),
  })).max(30),
});
export type NewsOut = z.infer<typeof NewsOut>;
