import { TRADEABLE, bstockBySymbol } from './bstocks';
import { atlasFeedFor } from './atlas-feeds';
import { assess, type Assessment, type AtlasQuote, type DexQuote } from './integrity';

// Fetchers for the four price views (no secrets stored here; the Atlas key is passed in) and the orchestration that
// turns them into one assessment per bStock. Shared by the app server and the agent. Every network call has a timeout,
// and any source that fails is simply missing: the result is then "unavailable" or judged on the rest, never an error.

export type Fetch = typeof fetch;
const T = 8_000;

const ATLAS_URL = 'https://api.atlasoracle.io/report/v1/price/latest';
const CMC_DEX_SEARCH = 'https://pro-api.coinmarketcap.com/trial-pro-api/v1/dex/search';
const ASTER_MARKS = 'https://fapi.asterdex.com/fapi/v1/premiumIndex';

/** Pure: the Atlas response for one feed → a quote (price is 18-decimal fixed point). */
export function parseAtlas(json: unknown, feedId: number, nowMs: number): AtlasQuote | null {
  const d = (json as { data?: { parsedPayload?: string; consensusScores?: { feedId: string; consensusScore: number; consensusStatus: string }[] } })?.data;
  if (!d?.parsedPayload) return null;
  let rows: { feedId: string; price: number | string; timestampSeconds: string | number }[];
  try { rows = JSON.parse(d.parsedPayload); } catch { return null; }
  const row = rows.find((r) => String(r.feedId) === String(feedId)); if (!row) return null;
  const price = Number(row.price) / 1e18; const ts = Number(row.timestampSeconds);
  if (!(price > 0) || !(ts > 0)) return null;
  const c = d.consensusScores?.find((x) => String(x.feedId) === String(feedId));
  return { price, ageSec: Math.max(0, nowMs / 1000 - ts), score: c?.consensusScore ?? null, status: c?.consensusStatus ?? null };
}

/** One call per feed: a batch is rejected as a whole when any id in it is not readable with the key. */
export async function fetchAtlas(feedIds: number[], apiKey: string, f: Fetch = fetch, nowMs = Date.now()): Promise<Record<number, AtlasQuote>> {
  const out: Record<number, AtlasQuote> = {};
  await Promise.all(feedIds.map(async (id) => {
    try {
      const r = await f(ATLAS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey }, body: JSON.stringify({ signed: false, feedIds: [String(id)] }), signal: AbortSignal.timeout(T) });
      if (!r.ok) return;
      const q = parseAtlas(await r.json(), id, nowMs); if (q) out[id] = q;
    } catch { /* this feed is just missing */ }
  }));
  return out;
}

const dexCache = new Map<string, { at: number; q: DexQuote }>();
export const clearDexCache = () => dexCache.clear();

/**
 * CoinMarketCap DEX data for one token contract (keyless trial tier). Searching by ADDRESS avoids lookalike tickers.
 * Pool liquidity barely moves, so each token is cached for a minute; one retry covers CMC's "system is busy" replies
 * (13 simultaneous requests were all refused on 2026-11-26, single ones always worked).
 */
export async function fetchDex(address: string, f: Fetch = fetch, nowMs = Date.now()): Promise<DexQuote | null> {
  const k = address.toLowerCase(); const hit = dexCache.get(k);
  if (hit && nowMs - hit.at < 60_000) return hit.q;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await f(`${CMC_DEX_SEARCH}?q=${address}`, { signal: AbortSignal.timeout(T), headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.ok) {
        const j = await r.json() as { data?: { tks?: { plt?: string; addr?: string; pu?: string; liq?: string; v24h?: string }[] } };
        const t = j.data?.tks?.find((x) => x.plt === 'BSC' && (x.addr ?? '').toLowerCase() === k);
        const price = Number(t?.pu);
        if (t && price > 0) { const q = { price, liquidityUsd: Number(t.liq) || 0, volume24hUsd: t.v24h !== undefined ? Number(t.v24h) : null }; dexCache.set(k, { at: nowMs, q }); return q; }
        return null;                                                   // answered, but this token is not listed
      }
    } catch { /* retry once */ }
    if (attempt === 0) await new Promise((res) => setTimeout(res, 400));
  }
  return hit?.q ?? null;                                               // stale beats nothing
}

/** Mark prices of the underlying stocks' perps, by ticker. */
export async function fetchPerpMarks(tickers: string[], f: Fetch = fetch): Promise<Record<string, number>> {
  try {
    const r = await f(ASTER_MARKS, { signal: AbortSignal.timeout(T) });
    if (!r.ok) return {};
    const all = await r.json() as { symbol: string; markPrice: string }[];
    const want = new Set(tickers.map((t) => `${t}USDT`));
    return Object.fromEntries(all.filter((m) => want.has(m.symbol)).map((m) => [m.symbol.replace(/USDT$/, ''), Number(m.markPrice)]));
  } catch { return {}; }
}

export interface IntegrityDeps {
  atlasKey: string | null;
  /** The price the app already uses, by bStock symbol. */
  reference: (symbol: string) => number | null;
  baseHaircut: number;
  fetch?: Fetch;
  now?: () => number;
}
export interface IntegritySnapshot { at: number; items: Assessment[]; problems: string[] }

/** Assess every tradeable bStock (or the given symbols). Never throws. */
export async function assessBStocks(deps: IntegrityDeps, symbols?: string[]): Promise<IntegritySnapshot> {
  const f = deps.fetch ?? fetch; const now = (deps.now ?? Date.now)();
  const list = (symbols ?? TRADEABLE.map((t) => t.symbol)).map((s) => bstockBySymbol(s)).filter((t): t is NonNullable<typeof t> => !!t);
  const problems: string[] = [];
  const feedIds = list.map((t) => atlasFeedFor(t.symbol)).filter((x): x is number => x !== null);
  const [atlas, marks, dexes] = await Promise.all([
    deps.atlasKey && feedIds.length ? fetchAtlas(feedIds, deps.atlasKey, f, now) : Promise.resolve({} as Record<number, AtlasQuote>),
    fetchPerpMarks([...new Set(list.map((t) => t.underlying))], f),
    (async () => { const out: (DexQuote | null)[] = []; for (const t of list) { out.push(await fetchDex(t.address, f, now)); } return out; })(),
  ]);
  if (!deps.atlasKey) problems.push('no Atlas API key set: Atlas feeds are not read');
  else if (feedIds.length && !Object.keys(atlas).length) problems.push('Atlas returned no prices');
  if (!Object.keys(marks).length) problems.push('perp prices could not be read');
  if (dexes.every((d) => d === null)) problems.push('CoinMarketCap DEX data could not be read');
  const items = list.map((t, k) => {
    const feed = atlasFeedFor(t.symbol);
    return assess({ symbol: t.symbol, atlas: feed !== null ? atlas[feed] ?? null : null, dex: dexes[k], perp: marks[t.underlying] ?? null, reference: deps.reference(t.symbol), baseHaircut: deps.baseHaircut });
  });
  return { at: now, items, problems };
}

// Short cache so a page load or an agent tick does not hit three services each time.
let cache: { key: string; at: number; value: Promise<IntegritySnapshot> } | null = null;
export function assessBStocksCached(deps: IntegrityDeps, symbols?: string[], ttlMs = 15_000): Promise<IntegritySnapshot> {
  const key = `${deps.baseHaircut}|${(symbols ?? []).join(',')}`; const t = (deps.now ?? Date.now)();
  if (cache && cache.key === key && t - cache.at < ttlMs) return cache.value;
  const value = assessBStocks(deps, symbols);
  cache = { key, at: t, value };
  return value;
}
export const clearIntegrityCache = () => { cache = null; clearDexCache(); };
