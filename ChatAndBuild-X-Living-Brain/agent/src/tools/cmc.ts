import { config } from '../config';

// CoinMarketCap MCP (https://mcp.coinmarketcap.com/mcp) as a read-only data source for the chat agent.
// Tool LISTING is keyless, but every CALL needs a (free) CMC MCP key in CMC_API_KEY: without it this returns a plain
// "not set up" note and the agent says so. Only the allowlisted read tools below can be called; the model never picks a
// tool name or URL freely. Every call has a timeout, the reply is capped, and no failure ever throws into a decision.

export const CMC_MCP_URL = 'https://mcp.coinmarketcap.com/mcp';
const TIMEOUT_MS = 25_000;   // the stock calendar takes 6-12 s
const MAX_CHARS = 3_500;

export const CMC_TOOLS = {
  /** Scheduled events for one US-listed stock over the next 7 days (earnings and the like): the gap risk a hedge is for. */
  stock_events: { mcp: 'us_equity_upcoming_event_calendar', args: (a: CmcArgs) => ({ symbol: String(a.symbol ?? '').toUpperCase() }), need: 'symbol' },
  /** Whole-crypto-market snapshot (fear/greed, dominance, volume): context for BTC/ETH perps. */
  market_overview: { mcp: 'get_global_metrics_latest', args: () => ({}), need: null },
  /** Crypto derivatives open interest and funding context. */
  derivatives_overview: { mcp: 'get_global_crypto_derivatives_metrics', args: () => ({}), need: null },
} as const;
export type CmcKind = keyof typeof CMC_TOOLS;
export interface CmcArgs { symbol?: string }

export type CmcResult = { ok: true; text: string } | { ok: false; reason: string };
type Fetch = typeof fetch;

/** Pure: pull the text out of an MCP reply, which may arrive as plain JSON or as one SSE "data:" line. */
export function parseMcpReply(raw: string): CmcResult {
  const line = raw.split('\n').map((l) => l.trim()).find((l) => l.startsWith('data:'));
  const body = line ? line.slice(5).trim() : raw.trim();
  let j: { result?: { isError?: boolean; content?: { type?: string; text?: string }[] }; error?: { message?: string } };
  try { j = JSON.parse(body); } catch { return { ok: false, reason: 'CoinMarketCap sent a reply that could not be read' }; }
  if (j.error) return { ok: false, reason: `CoinMarketCap refused: ${String(j.error.message ?? 'error').slice(0, 120)}` };
  const text = (j.result?.content ?? []).filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n').trim();
  if (j.result?.isError) return { ok: false, reason: `CoinMarketCap: ${text.slice(0, 120) || 'error'}` };
  if (!text) return { ok: false, reason: 'CoinMarketCap returned nothing' };
  return { ok: true, text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[cut: more data exists]` : text };
}

export async function callCmc(kind: CmcKind, args: CmcArgs, deps: { key?: string; fetch?: Fetch } = {}): Promise<CmcResult> {
  const key = deps.key ?? config().CMC_API_KEY;
  if (!key) return { ok: false, reason: 'CoinMarketCap MCP is not set up (no CMC_API_KEY on the agent)' };
  const spec = CMC_TOOLS[kind];
  if (!spec) return { ok: false, reason: 'unknown CoinMarketCap data kind' };
  if (spec.need === 'symbol' && !/^[A-Z.]{1,6}$/.test(String(args.symbol ?? '').toUpperCase())) return { ok: false, reason: 'a stock ticker is needed (like NVDA)' };
  try {
    const r = await (deps.fetch ?? fetch)(CMC_MCP_URL, {
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'X-CMC-MCP-API-KEY': key },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: spec.mcp, arguments: spec.args(args) } }),
    });
    if (r.status === 401 || r.status === 403) return { ok: false, reason: 'CoinMarketCap rejected the key' };
    if (!r.ok) return { ok: false, reason: `CoinMarketCap answered HTTP ${r.status}` };
    return parseMcpReply(await r.text());
  } catch { return { ok: false, reason: 'CoinMarketCap could not be reached' }; }
}
