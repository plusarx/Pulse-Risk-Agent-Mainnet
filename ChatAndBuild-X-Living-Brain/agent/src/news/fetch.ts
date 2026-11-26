import { config } from '../config';

// Free news sources, no API key: Google News RSS and Yahoo Finance RSS. A failing source never stops the agent:
// it just contributes no headlines (the hedge then stays at the user's own base ratio).

export interface Headline { title: string; source: string; publishedAt: string; url: string; /** Copies of this exact item that arrived in the same read. */ repeats?: number }
export interface HeadlineView { title: string; source: string; ageHours: number; repeats?: number; /** A known wire or major outlet. Unknown sources count for less. */ trusted?: boolean }

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => entities[m] ?? m).replace(/\s+/g, ' ').trim();
const tag = (block: string, name: string) => { const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i')); return m ? decode(m[1]) : ''; };

/** Parse an RSS 2.0 feed into headlines. Tolerant: skips items without a title or a valid date. */
export function parseRss(xml: string, fallbackSource: string): Headline[] {
  const out: Headline[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const b = m[0]; const title = tag(b, 'title'); const date = Date.parse(tag(b, 'pubDate'));
    if (!title || !Number.isFinite(date)) continue;
    // Google News appends " - Publisher" to the title; the publisher is also in <source>.
    const source = tag(b, 'source') || fallbackSource;
    const clean = source && title.endsWith(` - ${source}`) ? title.slice(0, -(source.length + 3)) : title;
    out.push({ title: clean, source, publishedAt: new Date(date).toISOString(), url: tag(b, 'link') });
  }
  return out;
}

export type TextFetcher = (url: string) => Promise<string>;
const realFetch: TextFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; margin-agent)', accept: 'application/rss+xml, application/xml, text/xml' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};
let fetcher: TextFetcher = realFetch;
/** Tests and demos inject canned feeds so no network is touched. Call with no argument to restore the real one. */
export const setTextFetcher = (f?: TextFetcher) => { fetcher = f ?? realFetch; cache.clear(); };

const sources = (ticker: string, name: string) => [
  { id: 'Google News', url: `https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}" OR ${ticker} stock when:2d`)}&hl=en-US&gl=US&ceid=US:en` },
  { id: 'Yahoo Finance', url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US` },
];

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export interface NewsFetch { headlines: Headline[]; problems: string[] }
const cache = new Map<string, { at: number; v: NewsFetch }>();

/** Fresh, de-duplicated headlines for one stock, newest first (max 10). Cached for NEWS_TTL_SEC. */
export async function fetchHeadlines(ticker: string, name: string, now = Date.now()): Promise<NewsFetch> {
  const c = config(); const hit = cache.get(ticker);
  if (hit && now - hit.at < c.NEWS_TTL_SEC * 1000) return hit.v;
  const problems: string[] = []; const all: Headline[] = [];
  await Promise.all(sources(ticker, name).map(async (s) => {
    try { all.push(...parseRss(await fetcher(s.url), s.id)); } catch (e) { problems.push(`${s.id}: ${e instanceof Error ? e.message : String(e)}`); }
  }));
  const seen = new Map<string, Headline>(); const maxAge = c.NEWS_MAX_AGE_HOURS * 3_600_000;
  const headlines = all
    .filter((h) => now - Date.parse(h.publishedAt) <= maxAge && Date.parse(h.publishedAt) <= now + 3_600_000)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .filter((h) => { const k = `${h.source}|${norm(h.title).slice(0, 80)}`; const first = seen.get(k); if (first) { first.repeats = (first.repeats ?? 1) + 1; return false; } seen.set(k, h); return true; })
    .slice(0, 10);
  const v = { headlines, problems };
  if (headlines.length || !problems.length) cache.set(ticker, { at: now, v }); // do not cache a total outage
  return v;
}

export const toView = (h: Headline, now = Date.now()): HeadlineView => ({ title: h.title, source: h.source, ageHours: Math.max(0, Math.round(((now - Date.parse(h.publishedAt)) / 3_600_000) * 10) / 10), ...(h.repeats && h.repeats > 1 ? { repeats: h.repeats } : {}) });
