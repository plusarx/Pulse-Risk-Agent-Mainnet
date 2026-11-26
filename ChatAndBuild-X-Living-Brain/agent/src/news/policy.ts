import type { HeadlineView } from './fetch';

// Pure helpers for reading news. News is advisory only: nothing here sizes or places a hedge.

export type Sentiment = 'positive' | 'negative' | 'neutral';

/** score in [-1,1] -> label. Small scores are neutral so noise never flips the hedge. */
export const sentimentOf = (score: number): Sentiment => (score >= 0.15 ? 'positive' : score <= -0.15 ? 'negative' : 'neutral');

const POS = ['beat', 'beats', 'surge', 'surges', 'soar', 'soars', 'jump', 'jumps', 'rally', 'record', 'upgrade', 'upgrades', 'raises', 'strong', 'growth', 'profit', 'wins', 'approval', 'approved', 'partnership', 'breakthrough', 'outperform', 'bullish', 'gains', 'rises'];
const NEG = ['miss', 'misses', 'plunge', 'plunges', 'fall', 'falls', 'drop', 'drops', 'slump', 'recall', 'probe', 'investigation', 'lawsuit', 'sues', 'downgrade', 'downgrades', 'cuts', 'weak', 'loss', 'losses', 'fraud', 'ban', 'bans', 'tariff', 'tariffs', 'layoffs', 'bearish', 'warns', 'warning', 'crash', 'fine', 'fined', 'delay', 'delays'];

/** Offline fallback when the LLM is off or fails: a plain keyword count. Crude, so confidence stays low. */
export function lexiconSentiment(headlines: HeadlineView[]): { score: number; confidence: number; reason: string } {
  let pos = 0; let neg = 0;
  for (const h of headlines) for (const w of h.title.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/)) { if (POS.includes(w)) pos++; if (NEG.includes(w)) neg++; }
  const n = pos + neg;
  if (!n) return { score: 0, confidence: 0, reason: 'no clear positive or negative words in the headlines' };
  return { score: Math.round(((pos - neg) / (n + 1)) * 100) / 100, confidence: Math.min(0.6, n / 10), reason: `keyword count: ${pos} positive, ${neg} negative words (offline fallback, low confidence)` };
}
