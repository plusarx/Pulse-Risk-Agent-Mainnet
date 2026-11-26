import { bstockBySymbol } from '../../../lib/bstocks';
import { config } from '../config';
import { log } from '../log';
import { NewsOut } from '../llm/schemas';
import { runLlm } from '../llm/run';
import type { Snapshot } from '../types';
import { fetchHeadlines, toView, type HeadlineView } from './fetch';
import { lexiconSentiment, sentimentOf, type Sentiment } from './policy';
import { screenHeadlines, type Suspect } from './screen';

export * from './fetch';
export * from './policy';
export * from './screen';

// NEWS IS ADVISORY ONLY (spec): it raises flags and can prompt a review, but it never changes a position, a hedge
// size or a limit. Nothing in this module feeds the planner.

/** What the agent concluded about one stock from the news. Shown as a flag to the user and to the LLM nodes as context. */
export interface NewsView {
  bstock: string; ticker: string; name: string;
  headlines: HeadlineView[];
  sentiment: Sentiment; score: number; confidence: number; signal: number; reason: string; keyHeadlines: string[];
  /** True when the signal is strong enough to raise a flag (|score x confidence| >= NEWS_MIN_SIGNAL). */
  flagged: boolean;
  by: 'llm' | 'keywords' | 'none';
  problems: string[];
  /** Items removed before scoring because they looked like instructions to the agent (never shown verbatim). */
  suspects: Suspect[];
  /** Market rumours from sources that are not known outlets: shown as an UNVERIFIED advisory flag, never scored or acted on. */
  rumours: HeadlineView[];
}

/** Stocks worth reading news for: everything held that has a hedge leg, plus any open hedge. */
export function relevantLegs(s: Snapshot) {
  const held = Object.fromEntries(s.bsc.bstocks.map((b) => [b.symbol, b.qty]));
  return s.config.hedge.legs.filter((l) => (held[l.bstock] ?? 0) > 0 || (l.venue === 'aster' && (s.perpPositions[l.market] ?? 0) !== 0));
}

/** Read the news and score it. Never throws: any failure yields no flag. */
export async function computeNews(s: Snapshot, now = Date.now()): Promise<NewsView[]> {
  const h = s.config.hedge;
  if (!h.enabled || !h.news.enabled) return [];
  const legs = relevantLegs(s); if (!legs.length) return [];
  const min = config().NEWS_MIN_SIGNAL;

  const fetched = await Promise.all(legs.map(async (leg) => {
    const t = bstockBySymbol(leg.bstock); const ticker = t?.underlying ?? leg.market; const name = t?.displayName ?? ticker;
    const f = await fetchHeadlines(ticker, name, now).catch((e) => ({ headlines: [], problems: [e instanceof Error ? e.message : String(e)] }));
    const { clean, suspects, rumours } = screenHeadlines(f.headlines.map((x) => toView(x, now)));
    return { leg, ticker, name, headlines: clean, suspects, rumours, problems: f.problems };
  }));

  // One LLM call scores every stock that has headlines (the model has no tools). If it fails, a keyword count is used.
  const scored = new Map<string, { score: number; confidence: number; reason: string; keyHeadlines: string[]; by: 'llm' | 'keywords' }>();
  const withNews = fetched.filter((x) => x.headlines.length);
  if (withNews.length) {
    if (config().LLM_MODE === 'on') {
      try {
        const out = await runLlm('news_analyst', NewsOut, { stocks: withNews.map((x) => ({ ticker: x.ticker, name: x.name, headlines: x.headlines })) });
        for (const it of out.items) if (withNews.some((x) => x.ticker === it.ticker)) scored.set(it.ticker, { ...it, by: 'llm' });
      } catch (e) { log.warn(`news analyst unavailable, using keyword fallback: ${e instanceof Error ? e.message : String(e)}`); }
    }
    for (const x of withNews) if (!scored.has(x.ticker)) { const l = lexiconSentiment(x.headlines); scored.set(x.ticker, { ...l, keyHeadlines: [], by: 'keywords' }); }
  }

  return fetched.map((x): NewsView => {
    const sc = scored.get(x.ticker);
    const score = sc ? Math.max(-1, Math.min(1, sc.score)) : 0;
    const share = x.headlines.length ? x.headlines.filter((h) => h.trusted).length / x.headlines.length : 0;   // unknown sources count for less
    const confidence = sc && x.headlines.length ? Math.max(0, Math.min(1, sc.confidence)) * (0.5 + 0.5 * share) : 0;   // no headlines: no signal
    const signal = Math.round(score * confidence * 100) / 100;
    return {
      bstock: x.leg.bstock, ticker: x.ticker, name: x.name, headlines: x.headlines, sentiment: sentimentOf(score), score, confidence, signal,
      reason: sc?.reason ?? (x.problems.length ? `no news available (${x.problems.join('; ')})` : 'no recent headlines'),
      keyHeadlines: sc?.keyHeadlines ?? [], flagged: Math.abs(signal) >= min, by: sc?.by ?? 'none', problems: x.problems, suspects: x.suspects, rumours: x.rumours,
    };
  });
}
