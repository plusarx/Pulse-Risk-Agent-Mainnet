import type { VenueAlternative } from '../../../lib/agent-action';
import { tickerOf } from '../risk/market';
import { chatTradeRequest, quoteSpec, specFrom } from './trade';
import { describeSubs, managerFor, moveProblems, moveRequest, resolveSub, subLabel, usdcOf, freeOf, type ChatMoveSpec } from './move';
import { deriveUniverses, listSubaccounts } from '../tools/derive';
import { perpMarketItems, perpsAccountItems } from './perps';
import { fundCandidate, fundRequest, resolveRule, ruleLabel, toBase, type ChatFundSpec } from './fund';
import { ruleKey } from '../../../lib/risk-rules';
import { checkCandidate } from '../tools/guard';
import * as asterTools from '../tools/aster';
import { getAsterCreds, postActionToApp } from '../tools/appApi';
import { payoff, type Payoff } from '../risk/payoff';
import { quotePut } from '../risk/putQuote';
import { deriveCurrencyOf, liveOptionNames } from '../risk/options';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { config } from '../config';
import { log } from '../log';
import { readPrompt } from '../llm/prompts';
import * as app from '../tools/appApi';
import { collectSnapshot } from '../tools/collect';
import { integrityDetail } from '../tools/integrity';
import { callCmc } from '../tools/cmc';
import { assessRisk } from '../risk/plan';
import { buildStatus } from '../status';
import type { Snapshot } from '../types';
import { buildFacts, type Fact, type Recorded } from './facts';
import { buildMockSnapshot, describeMock, MARKETS, MockPortfolio } from './mock';
import { applyOverrides, Overrides } from './overrides';
import { DEFAULT_CONFIG } from '../../../lib/agent-config';
import { runWhatIf, withScratchStore, type WhatIfResult } from './whatif';
import { markets as perpMarketList } from '../tools/aster';

// The chat agent: a tool-using LangGraph (model -> tools -> model ...). The model decides, per message, whether it needs any tool at all. "Hi"
// gets a plain reply and no data is read. Questions about the user's money read their portfolio; "what if" questions and portfolios typed in text
// run the real hedging agent (the graph in src/graph) as a tool on mock numbers, in dry run. Every fact a tool returns gets an id; the reply cites
// ids and code checks every dollar figure and percentage in it against those facts. The chat cannot execute, approve or save anything: approving
// is the Approve button the chat UI shows for a pending request, which calls the app's own approval endpoint.

export interface ChatRequest { /** true only when the app has a signed-in session for this wallet (trade requests need it). */ signedIn?: boolean; wallet: string; network: 'mainnet' | 'testnet'; message: string; history: { role: 'user' | 'agent'; text: string }[]; recorded: Recorded }
export interface Step { tool: string; label: string }
/** What the hedge card shows in its Home and Limits tabs, built by code from the numbers the test ran on. */
export interface CardView {
  portfolioUsd: number; hedgedPct: number; requiredHedgePct: number; varPct: number; limitPct: number; mode: 'autonomous' | 'confirm'; killSwitch: boolean;
  holdings: { ticker: string; usd: number; hedgedPct: number }[]; nextEvent: { ticker: string; kind: string; inHours: number } | null;
  limits: { maxPerTradeUsd: number; maxPerDayUsd: number; maxLeverage: number; dailyLossCapUsd: number; weeklyBudgetPct: number; lossTolerancePct: number };
}
export interface Scenario { kind: 'current' | 'mock'; /** the user's real numbers with nothing changed, so an Approve on a matching pending request is real */ live: boolean; view: CardView | null; inputs: string[]; decision: string; outcome: string; reasons: string[]; why: string | null; limitMet: boolean | null;
  plan: { instrument?: string; sizeUsd?: number; varBeforePct?: number; varAfterPct?: number; limitPct?: number; costUsd?: number; budgetUsd?: number } | null;
  /** Profit and loss on the hedged name before and after the recommendation. */
  payoff: Payoff | null;
  /** Every venue considered, with why it was or was not used. */
  alternatives: VenueAlternative[] }
export interface PutQuoteView { ticker: string; instrument: string; expiry: string; strike: number; contracts: number; ask: number; iv: number; premiumUsd: number; feesUsd: number; coverUsd: number; holdingUsd: number; minContracts: number; oversized: boolean; payoff: Payoff }
export interface ChatResponse {
  answer: string; cites: Fact[]; unsure: boolean; unsureReason: string | null;
  source: 'live' | null; sourceNote: string | null; steps: Step[]; scenarios: Scenario[];
  /** Live put quotes priced in this reply, each with its before/after payoff. */
  quotes?: PutQuoteView[];
  ui: { showPending: boolean; showActivity: boolean }; usedTools: boolean; usedModel: boolean;
}

/** Money and percentages in a text, as numbers: "$1,500" -> 1500, "$50k" -> 50000, "7.45%" -> 7.45. Only tokens with a $ or % sign count. */
export function figures(text: string): { raw: string; value: number }[] {
  const out: { raw: string; value: number }[] = [];
  for (const m of text.matchAll(/(\$)?(\d[\d,]*(?:\.\d+)?)\s?([kKmM](?![A-Za-z]))?(%)?/g)) {
    if (!m[1] && !m[4]) continue;
    let v = Number(m[2].replace(/,/g, '')); if (Number.isNaN(v)) continue;
    if (m[3]) v *= /k/i.test(m[3]) ? 1e3 : 1e6;
    out.push({ raw: m[0].trim(), value: v });
  }
  return out;
}
/** Figures in the answer that appear nowhere in the facts, the user's message or the conversation. Rounding to the displayed precision is allowed. */
const REQUEST_TOOLS = new Set(['propose_trade', 'propose_margin_move', 'propose_fund_move', 'propose_enable_subaccount']);
/** The answer says a request or move was created / is waiting for Approve. */
export const claimsRequest = (a: string) => /\b(request|move|transfer|trade|order)\b[^.]{0,80}\b(created|is waiting|waiting (below|for your approval)|has been (placed|submitted|queued))\b|\b(approve|approval) (button|card)\b[^.]{0,40}\bbelow\b/i.test(a);
const madeRequest = (ctx: Ctx) => ctx.requestCreated || (ctx.steps.some((s) => REQUEST_TOOLS.has(s.tool)) && ctx.facts.some((f) => /\b(created|already waiting)\b/.test(f.value)));

export function ungroundedFigures(answer: string, sources: string[]): string[] {
  const allowed = sources.flatMap((t) => [...t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?([kKmM](?![A-Za-z]))?/g)].map((m) => Number(m[1].replace(/,/g, '')) * (m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1))).filter((n) => !Number.isNaN(n));
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.06, Math.abs(b) * 0.005);
  return [...new Set(figures(answer).filter((f) => !allowed.some((n) => near(f.value, n))).map((f) => f.raw))];
}

// ---- the model (injectable so tests never touch the network) ------------------------------------------------------------------------------
export type ChatModel = (messages: BaseMessage[], tools: StructuredToolInterface[]) => Promise<AIMessage>;
const realModel: ChatModel = async (messages, tools) => {
  const c = config();
  if (!c.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set');
  const llm = new ChatOpenAI({ model: c.LLM_MODEL_ANALYST, apiKey: c.OPENROUTER_API_KEY, temperature: c.LLM_TEMPERATURE, timeout: Math.max(c.LLM_TIMEOUT_MS, c.CHAT_LLM_TIMEOUT_MS), maxRetries: c.LLM_MAX_RETRIES, configuration: { baseURL: c.OPENROUTER_BASE_URL } });
  return (await llm.bindTools(tools).invoke(messages)) as AIMessage;
};
let model: ChatModel = realModel;
export const setChatModel = (m?: ChatModel) => { model = m ?? realModel; };
const modelAvailable = () => model !== realModel || !!config().OPENROUTER_API_KEY;

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);
const text = (m: AIMessage) => (typeof m.content === 'string' ? m.content : (m.content as { type: string; text?: string }[]).filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n'));

// ---- per-request context and the tools -----------------------------------------------------------------------------------------------------
/** Thrown when the user's live accounts cannot be read. The tool result carries the message, so the model tells the user and answers nothing from data. */
class LiveUnavailable extends Error {}
type LiveReader = (wallet: string, network: ChatRequest['network']) => Promise<{ snapshot: Snapshot; note: string | null }>;
const realReadLive: LiveReader = async (wallet, network) => {
  const ws = await withTimeout(app.listWallets(network), 15_000, 'the app');
  const w = ws.find((x) => x.wallet.toLowerCase() === wallet.toLowerCase());
  // No saved settings yet: still read the wallet and venues live, with the default settings.
  const snapshot = await withTimeout(withScratchStore(() => collectSnapshot(wallet, network, w?.config ?? DEFAULT_CONFIG, undefined, true)), 45_000, 'reading the accounts');
  return { snapshot, note: w ? null : 'No agent settings saved for this wallet yet; read with the defaults.' };
};
let readLive: LiveReader = realReadLive;
/** Tests only: supply the account read (like setChatModel). No argument restores the real live read. */
export function setLiveReader(fn?: LiveReader) { readLive = fn ?? realReadLive; }

class Ctx {
  snapshot: Snapshot | null = null; source: 'live' | null = null; sourceNote: string | null = null; blocked: string | null = null;
  /** A hedging request was raised for Approve in this reply (so the answer may say so). */
  requestCreated = false;
  facts: Fact[] = []; steps: Step[] = []; scenarios: Scenario[] = []; quotes: PutQuoteView[] = []; ui = { showPending: false, showActivity: false };
  constructor(readonly req: ChatRequest) {}
  /** Give every fact a conversation-wide id and return them for the model to read. */
  register(items: { label: string; value: string }[]): Fact[] { const base = this.facts.length; const out = items.map((x, i) => ({ id: `F${base + i + 1}`, label: x.label, value: x.value })); this.facts.push(...out.map((f) => ({ ...f }))); return out; }
  /** Live data only, read fresh for every message. There is no sample fallback: if the accounts cannot be read, say why and answer nothing from data. */
  async ensureSnapshot(): Promise<Snapshot> {
    if (this.snapshot) return this.snapshot;
    if (this.blocked) throw new LiveUnavailable(this.blocked);
    const { wallet, network } = this.req;
    // Not signed in: the app sends the zero address. There is no account to read.
    if (/^0x0{40}$/i.test(wallet)) { this.blocked = 'No wallet is registered with the agent on this app yet, so there is no live portfolio to read. Connect a wallet and its agent keys on the Risk management page, then ask again.'; throw new LiveUnavailable(this.blocked); }
    try { const r = await readLive(wallet, network); this.snapshot = r.snapshot; this.source = 'live'; this.sourceNote = r.note; return this.snapshot; }
    catch (e) {
      const why = e instanceof Error ? e.message : String(e); log.warn(`chat: live read failed: ${why}`);
      this.blocked = `I could not read your live accounts just now (${why}). I only answer from your live portfolio, so I will not guess. Try again in a moment.`; throw new LiveUnavailable(this.blocked);
    }
  }
}

const when = (t?: number | null) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown time');
const ok = (ctx: Ctx, items: { label: string; value: string }[], note?: string) => JSON.stringify({ facts: ctx.register(items), ...(note ? { note } : {}) });

function viewOf(s: Snapshot): CardView | null {
  try {
    const st = buildStatus(s); const l = s.config.limits;
    return { portfolioUsd: st.portfolioUsd, hedgedPct: st.hedgedPct, requiredHedgePct: st.requiredHedgePct, varPct: st.varPct, limitPct: st.limitPct, mode: st.mode as 'autonomous' | 'confirm', killSwitch: st.killSwitch,
      holdings: st.tickers.map((t) => ({ ticker: t.ticker, usd: t.usd, hedgedPct: t.hedgedPct })), nextEvent: st.nextEvent ? { ticker: st.nextEvent.ticker, kind: st.nextEvent.kind, inHours: st.nextEvent.inHours } : null,
      limits: { maxPerTradeUsd: l.maxNotionalPerTradeUsd, maxPerDayUsd: l.maxNotionalPerDayUsd, maxLeverage: l.maxLeverage, dailyLossCapUsd: l.dailyLossCapUsd, weeklyBudgetPct: s.config.risk.premiumBudgetWeeklyPct, lossTolerancePct: s.config.risk.lossTolerancePct } };
  } catch { return null; }
}
function scenarioOf(kind: 'current' | 'mock', inputs: string[], r: WhatIfResult, snap: Snapshot, live = false): Scenario {
  const p = r.card?.plan as { instrument?: string; sizeUsd?: number; varBeforePct?: number; varAfterPct?: number; limitPct?: number; cost?: { premiumUsd: number; feesUsd: number; weeklyBudgetUsd: number } } | null | undefined;
  return { kind, live, view: viewOf(snap), inputs, decision: r.decision, outcome: r.outcome, reasons: r.reasons, why: r.card?.why ?? null,
    limitMet: p && p.varAfterPct !== undefined && p.limitPct !== undefined ? p.varAfterPct <= p.limitPct + 1e-9 : null,
    plan: p ? { instrument: p.instrument, sizeUsd: p.sizeUsd, varBeforePct: p.varBeforePct, varAfterPct: p.varAfterPct, limitPct: p.limitPct, costUsd: p.cost ? p.cost.premiumUsd + p.cost.feesUsd : undefined, budgetUsd: p.cost?.weeklyBudgetUsd } : null, payoff: r.payoff ?? null, alternatives: r.alternatives ?? [] };
}
const usd = (n: number | undefined) => (n === undefined ? 'unknown' : `$${Math.round(n).toLocaleString('en-US')}`);
function resultFacts(inputs: string[], r: WhatIfResult): { label: string; value: string }[] {
  const p = r.card?.plan as { instrument?: string; sizeUsd?: number; varBeforePct?: number; varAfterPct?: number; limitPct?: number; cost?: { premiumUsd: number; feesUsd: number; weeklyBudgetUsd: number } } | null | undefined;
  const f = [{ label: 'Test input', value: `${inputs.join('. ')} (a dry-run test: nothing was sent or saved)` }, { label: 'Test decision', value: `${r.decision} [${r.outcome}]` }];
  if (p) f.push({ label: 'Test plan', value: `${p.instrument ?? ''} ${usd(p.sizeUsd)}; modelled loss ${p.varBeforePct}% to ${p.varAfterPct}% against a ${p.limitPct}% limit; cost ${usd((p.cost?.premiumUsd ?? 0) + (p.cost?.feesUsd ?? 0))} of a ${usd(p.cost?.weeklyBudgetUsd)} weekly budget. Limit ${(p.varAfterPct ?? 99) <= (p.limitPct ?? 0) + 1e-9 ? 'MET' : 'NOT met'}: ${p.varAfterPct}% after against ${p.limitPct}%` });
  if (r.card) f.push({ label: 'Test why', value: r.card.why.slice(0, 600) }, { label: 'Test steps if approved', value: r.card.willDo.join('; ').slice(0, 400) });
  for (const a of r.alternatives ?? []) f.push({ label: `Venue ${a.status}: ${a.instrument}`, value: a.why });
  if (r.payoff) { const at = (mv: number) => r.payoff!.points.find((x) => x.movePct === mv); const d = at(-20), u = at(20); if (d && u) f.push({ label: `${r.payoff.ticker} payoff with the hedge`, value: `${r.payoff.hedgeLabel}: at -20% ${d.beforeUsd} before vs ${d.afterUsd} after; at +20% ${u.beforeUsd} vs ${u.afterUsd} (USD); cost ${r.payoff.costUsd}` }); }
  for (const x of r.reasons.slice(0, 4)) f.push({ label: 'Test note', value: x });
  for (const x of r.events.slice(0, 5)) f.push({ label: 'Test event posted', value: x.slice(0, 300) });
  return f;
}

async function readDeriveSubs(ctx: Ctx) {
  const creds = await app.getDeriveCreds(ctx.req.wallet, ctx.req.network);
  const subs = await listSubaccounts(ctx.req.network, ctx.req.wallet, creds);
  return Object.assign(subs, { mainId: creds.subaccountId });
}

function makeTools(ctx: Ctx): StructuredToolInterface[] {
  return [
    tool(async () => {
      ctx.steps.push({ tool: 'get_portfolio', label: 'Read your portfolio' });
      const s = await ctx.ensureSnapshot();
      const facts = buildFacts(s, { actions: [], events: [] }, null, ctx.source!).map((f) => ({ label: f.label, value: f.value }));
      return ok(ctx, facts, ctx.sourceNote ?? undefined);
    }, { name: 'get_portfolio', description: "Read the user's portfolio: holdings, hedges, positions, balances, limits, settings, mode, modelled loss, events, news flags. Use for anything about their current state.", schema: z.object({}) }),

    tool(async () => {
      ctx.steps.push({ tool: 'get_price_integrity', label: 'Checked the bStock price integrity' });
      const s = await ctx.ensureSnapshot();
      return ok(ctx, integrityDetail(s));
    }, { name: 'get_price_integrity', description: "Read-only. Price integrity of the user's bStock collateral: for each held token the Atlas oracle price (age, consensus), the CoinMarketCap DEX price and pool liquidity, the stock's perp price, the gaps between them, the verdict (ok, watch, block, unavailable) and the collateral haircut used. Use for 'can I trust the price of NVDAB', 'why is my haircut higher', 'why will the agent not hedge'. If it says the layer is off, say so.", schema: z.object({}) }),

    tool(async ({ kind, symbol }: { kind: 'stock_events' | 'market_overview' | 'derivatives_overview'; symbol?: string }) => {
      ctx.steps.push({ tool: 'get_cmc_data', label: 'Read CoinMarketCap data' });
      const r = await callCmc(kind, { symbol });
      return ok(ctx, [{ label: 'CoinMarketCap', value: r.ok ? r.text : `unavailable: ${r.reason}` }]);
    }, { name: 'get_cmc_data', description: "Read-only CoinMarketCap data. kind 'stock_events' (needs symbol, a US stock ticker like NVDA): scheduled events in the next 7 days such as earnings, which is when a stock can gap; use it for 'is there an event before I hedge NVDA', 'when are NVDA earnings'. kind 'market_overview': whole-crypto-market snapshot, for BTC/ETH context. kind 'derivatives_overview': crypto futures and perpetuals open interest. If it says it is not set up or unavailable, say so plainly and do not guess the data.", schema: z.object({ kind: z.enum(['stock_events', 'market_overview', 'derivatives_overview']), symbol: z.string().max(8).optional() }) }),

    tool(async ({ limit }: { limit?: number }) => {
      ctx.steps.push({ tool: 'get_activity', label: 'Read recent activity' }); ctx.ui.showActivity = true;
      const s = await ctx.ensureSnapshot();
      const rec = ctx.req.recorded; const n = Math.min(limit ?? 6, 10);
      const items: { label: string; value: string }[] = [{ label: 'Mode', value: s.config.mode === 'autonomous' ? 'Autonomous: the agent acts on its own inside your caps' : 'Ask me first: the agent waits for your approval' }];
      for (const a of rec.actions.slice(0, n)) items.push({ label: `Recorded request #${a.id}`, value: `${a.status} on ${when(a.created_at)}: ${a.title}. Why: ${a.why.slice(0, 320)}${a.result_message ? ` Result: ${a.result_message.slice(0, 180)}` : ''}` });
      for (const e of rec.events.slice(0, n)) items.push({ label: 'Recorded event', value: `${when(e.created_at)} ${e.kind}${e.status ? `/${e.status}` : ''}: ${e.message.slice(0, 240)}` });
      if (!rec.actions.length && !rec.events.length) items.push({ label: 'Recorded activity', value: 'none yet' });
      return ok(ctx, items);
    }, { name: 'get_activity', description: 'Read what the agent has recorded: requests it proposed, what it did, what was blocked and why, and the current mode. Use for "why did you ...", "what did you do", and in autonomous mode to say what the agent has been doing. The chat then shows the activity list.', schema: z.object({ limit: z.number().int().min(1).max(10).optional() }) }),

    tool(async () => {
      ctx.steps.push({ tool: 'get_pending_requests', label: 'Checked what is waiting for approval' });
      const s = await ctx.ensureSnapshot(); const pend = ctx.req.recorded.actions.filter((a) => a.status === 'pending');
      if (pend.length) ctx.ui.showPending = true;
      const items: { label: string; value: string }[] = [{ label: 'Mode', value: s.config.mode === 'autonomous' ? 'Autonomous (a request still waits for you only when the agent needed your approval)' : 'Ask me first: nothing runs until the user presses Approve' }];
      for (const a of pend) items.push({ label: `Pending request #${a.id}`, value: `${a.title}. Why: ${a.why.slice(0, 360)}` });
      if (!pend.length) items.push({ label: 'Pending requests', value: 'none waiting' });
      return ok(ctx, items, pend.length ? 'The chat shows each pending request with Approve and Decline buttons. Tell the user to press Approve to run it.' : undefined);
    }, { name: 'get_pending_requests', description: 'List hedge requests waiting for the user. The chat then shows each with Approve and Decline buttons. Use when they ask what is waiting, what you propose, or want to approve.', schema: z.object({}) }),

    tool(async ({ base, overrides, mock }: { base: 'current' | 'mock'; overrides?: Overrides; mock?: MockPortfolio }) => {
      try {
        if (base === 'mock') {
          const m = MockPortfolio.parse(mock); const snap = buildMockSnapshot(m, ctx.req.wallet, ctx.req.network); const inputs = describeMock(m);
          const r = await withTimeout(runWhatIf(snap, { news: m.news }), 60_000, 'the hedging agent');
          ctx.steps.push({ tool: 'run_hedging_agent', label: 'Ran the hedging agent on a mock portfolio' }); ctx.scenarios.push(scenarioOf('mock', inputs, r, snap)); if (r.card?.plan) ctx.ui.showPending = false;
          return ok(ctx, resultFacts(inputs, r));
        }
        const s = await ctx.ensureSnapshot(); const o = Overrides.parse(overrides ?? {});
        const { snapshot, applied } = applyOverrides(s, o); const inputs = [`your portfolio with ${applied.length ? applied.join('; ') : 'no changes'}`];
        const r = await withTimeout(runWhatIf(snapshot), 60_000, 'the hedging agent');
        ctx.steps.push({ tool: 'run_hedging_agent', label: applied.length ? 'Ran the hedging agent with changed values' : 'Ran the hedging agent on your current numbers' }); ctx.scenarios.push(scenarioOf('current', inputs, r, snapshot, applied.length === 0)); if (applied.length === 0) ctx.ui.showPending = true; if (applied.length === 0 && r.card?.plan) ctx.ui.showPending = true;
        // The user's own numbers, nothing changed, and the agent would ask first: raise that very request now (same slot and key the live agent uses, so it is
        // never doubled) so Approve is there as soon as the hedge is recommended, not after the next 30 s check. Signed-in only: Approve needs a session.
        const items = resultFacts(inputs, r);
        if (applied.length === 0 && ctx.req.signedIn && r.request && r.outcome === 'awaiting') {
          try {
            const posted = await postActionToApp({ ...r.request, wallet: ctx.req.wallet, network: ctx.req.network });
            ctx.requestCreated = true; ctx.ui.showPending = true;
            items.push({ label: 'Hedge request', value: `${posted.duplicate ? 'already waiting' : 'created'} for Approve (status ${posted.status}): ${r.request.title}. It is NOT placed yet: it runs only when the user presses Approve below. Caps, reserve and the kill switch are re-checked then.` });
          } catch (e) { items.push({ label: 'Hedge request', value: `could not be raised for Approve just now (${e instanceof Error ? e.message : String(e)}); the live agent will post it within about 30 seconds` }); }
        }
        return ok(ctx, items, ctx.sourceNote ?? undefined);
      } catch (e) {
        const msg = e instanceof z.ZodError ? `invalid arguments: ${e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` : e instanceof Error ? e.message : String(e);
        return JSON.stringify({ error: msg });
      }
    }, { name: 'run_hedging_agent', description: 'Run the real hedging agent in dry run on numbers you choose, and read its decision, plan and whether the limit is met. base "current" with overrides tests the user\'s portfolio with a few values changed; base "mock" with mock tests a whole portfolio you build from what the user typed (defaults fill in what they did not say). Nothing is sent or saved.',
      schema: z.object({ base: z.enum(['current', 'mock']), overrides: Overrides.optional(), mock: MockPortfolio.optional() }) }),

    tool(async ({ tickers }: { tickers?: string[] }) => {
      ctx.steps.push({ tool: 'get_venue_tickers', label: 'Looked up the tickers on perps and options' });
      const want = (tickers ?? []).map((t) => t.toUpperCase().replace(/B$/, '')).filter(Boolean);
      const items: { label: string; value: string }[] = [];
      try {
        const all = await withTimeout(perpMarketList('mainnet'), 12_000, 'perps');
        if (!want.length) items.push({ label: 'Perp markets', value: `${all.length} perp markets: ${all.map((m) => m.symbol).join(', ')}` });
        for (const t of want) { const hit = all.find((m) => m.ticker === t || m.symbol === t); items.push({ label: `Perps ${t}`, value: hit ? `listed: ${hit.symbol} (minimum order $${hit.minNotionalUsd}, size step ${hit.stepSize})` : 'no market with that symbol in the live perps market list' }); }
      } catch (e) { items.push({ label: 'Perp markets', value: `could not be read just now (${e instanceof Error ? e.message : String(e)})` }); }
      try {
        // Derive v3 has no public/get_instruments: the live list is public/get_all_live_instruments (names encode
        // UNDERLYING-YYYYMMDD-STRIKE-C|P). Index ETFs map to Derive's index options (SPY -> US500, QQQ -> US100).
        const live = await withTimeout(liveOptionNames('mainnet'), 15_000, 'Derive');
        const per = new Map<string, { n: number; puts: number; exp: Set<string> }>();
        for (const nm of live) { const m = /^([A-Z0-9_]+)-(\d{8})-[0-9_]+-([CP])$/.exec(nm); if (!m) continue; const e = per.get(m[1]) ?? { n: 0, puts: 0, exp: new Set<string>() }; e.n++; if (m[3] === 'P') e.puts++; e.exp.add(m[2]); per.set(m[1], e); }
        const listed = [...per.entries()].filter(([, v]) => v.n > 1).sort((a, b) => b[1].n - a[1].n);
        if (!want.length) items.push({ label: 'Derive option underlyings', value: `${listed.length}: ${listed.map(([k, v]) => `${k} (${v.n} options, ${v.exp.size} expiries)`).join(', ')}` });
        for (const t of want) {
          const ccy = deriveCurrencyOf(t); const v = per.get(ccy);
          const exps = v ? [...v.exp].sort().slice(0, 4).map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`).join(', ') : '';
          items.push({ label: `Derive ${t}`, value: v && v.n > 1 ? `options listed${ccy !== t ? ` (as ${ccy})` : ''}: ${v.n} live (${v.puts} puts), expiries ${exps}${v.exp.size > 4 ? ', ...' : ''}` : 'no live options with that underlying on Derive' });
        }
      } catch (e) { items.push({ label: 'Derive currencies', value: `could not be read just now (${e instanceof Error ? e.message : String(e)})` }); }
      return ok(ctx, items, 'Read live from the perps and options public APIs just now.');
    }, { name: 'get_venue_tickers', description: 'List what is actually tradeable right now on perps (perp markets, e.g. NVDAUSDT) and Derive (option underlyings), read live from both venues. Pass tickers to check specific ones (for example NVDA, XAU, ETH); omit to list everything. Use it when the user asks which tickers or markets exist, or before saying a hedge market is unavailable: never claim a ticker is missing without checking here.', schema: z.object({ tickers: z.array(z.string().max(10)).max(12).optional() }) }),

    tool(async () => {
      ctx.steps.push({ tool: 'get_perps_account', label: 'Read your perps account' });
      try {
        const creds = await getAsterCreds(ctx.req.wallet, ctx.req.network);
        const view = await withTimeout(asterTools.getAccount(ctx.req.network, creds), 15_000, 'perps');
        const orders = view.funded ? await withTimeout(asterTools.openOrders(ctx.req.network, creds), 15_000, 'perps') : [];
        return ok(ctx, perpsAccountItems(view, orders), 'Read live from the perps account just now.');
      } catch (e) { return ok(ctx, [{ label: 'Perps account', value: `could not be read just now (${e instanceof Error ? e.message : String(e)}). Nothing was changed.` }]); }
    }, { name: 'get_perps_account', description: "Read the user's perps account live: equity, free margin, unrealised profit and loss, each open position (side, size, entry, mark, leverage, liquidation price) and open orders. Use it for 'what are my perps positions', 'how much margin is free', 'how close am I to liquidation', 'what is my leverage'. A never-funded account reads as $0 with no positions.", schema: z.object({}) }),

    tool(async ({ ticker }: { ticker: string }) => {
      const t = ticker.toUpperCase().replace(/B$/, '').replace(/USDT$/, '').replace(/-PERP$/, '');
      ctx.steps.push({ tool: 'get_perp_market', label: `Looked up the ${t} perp` });
      try {
        const net = ctx.req.network;
        const m = await withTimeout(asterTools.market(net, t), 12_000, 'perps');
        const st = await withTimeout(asterTools.marketStats(net, t), 12_000, 'perps').catch(() => null);
        let maxLev: number | null = null;
        try { maxLev = await withTimeout(asterTools.maxLeverage(net, await getAsterCreds(ctx.req.wallet, net), t), 12_000, 'perps'); } catch { /* the leverage cap needs the user's key; leave it out */ }
        return ok(ctx, perpMarketItems(t, m, st, maxLev), 'Read live from the perps market just now.');
      } catch (e) { return ok(ctx, [{ label: `Perps ${t}`, value: `could not be read just now (${e instanceof Error ? e.message : String(e)})` }]); }
    }, { name: 'get_perp_market', description: "Look up one perp market live: mark and index price, funding rate and when it is paid, the 24 h move and volume, the minimum order size and value, and the maximum leverage. Use it before proposing a perps trade, and for 'what is NVDA trading at', 'what is the funding', 'what leverage can I use'. Pass the ticker (NVDA, BTC, XAU).", schema: z.object({ ticker: z.string().min(1).max(20) }) }),

    tool(async ({ ticker, notionalUsd, strikePct, minDays }: { ticker: string; notionalUsd?: number; strikePct?: number; minDays?: number }) => {
      const t = ticker.toUpperCase().replace(/B$/, '');
      ctx.steps.push({ tool: 'price_derive_put', label: `Priced a live ${t} put on Derive` });
      try {
        let holdingUsd = 0;
        try { const s = await ctx.ensureSnapshot(); holdingUsd = s.bsc.bstocks.filter((b) => tickerOf(b.symbol) === t).reduce((a, b) => a + b.value, 0); } catch { /* not signed in: price on the notional given */ }
        const want = notionalUsd ?? holdingUsd;
        const q = await withTimeout(quotePut('mainnet', t, { notionalUsd: want, strikePct: strikePct ?? 100, minDays: minDays ?? 7 }), 25_000, 'Derive');
        if (!q) return ok(ctx, [{ label: `Derive ${t} put`, value: 'no live put with an ask on Derive for that underlying and window' }]);
        const pay = payoff(t, holdingUsd > 0 ? holdingUsd : q.coverUsd, { kind: 'put', contracts: q.contracts, strike: q.strike, spot: q.spot, premiumUsd: q.premiumUsd, feesUsd: q.feesUsd });
        ctx.quotes.push({ ticker: t, instrument: q.instrument, expiry: q.expiry, strike: q.strike, contracts: q.contracts, ask: q.ask, iv: q.iv, premiumUsd: q.premiumUsd, feesUsd: q.feesUsd, coverUsd: q.coverUsd, holdingUsd: pay.holdingUsd, minContracts: q.minContracts, oversized: q.oversized, payoff: pay });
        const at = (m: number) => pay.points.find((p) => p.movePct === m)!;
        return ok(ctx, [
          { label: `Derive ${t} put quote`, value: `${q.instrument}: ${q.contracts} contract(s) at the ask $${q.ask} (implied volatility ${Math.round(q.iv * 100)}%, ${q.daysToExpiry} days), covering $${q.coverUsd} of ${t}. Premium $${q.premiumUsd} + fees $${q.feesUsd} = $${(q.premiumUsd + q.feesUsd).toFixed(2)}` },
          { label: `Derive ${t} put minimum`, value: `Derive trades this put in steps of ${q.step} contract, minimum ${q.minContracts} (= $${q.minCoverUsd} of cover).${q.oversized ? ` Your $${want.toFixed(2)} needs less than that, so the smallest put covers ${Math.round(q.coverUsd / Math.max(want, 0.01))}x what you hold: the premium is the real cost but most of the cover is more than you need.` : ''}` },
          { label: `${t} payoff with the put`, value: `at -20%: $${at(-20).beforeUsd} unhedged vs $${at(-20).afterUsd} with the put; at 0%: $${at(0).afterUsd} (the cost); at +20%: $${at(20).beforeUsd} vs $${at(20).afterUsd}` },
        ], 'Priced live from the Derive order book just now; the chat shows the payoff chart.');
      } catch (e) { return ok(ctx, [{ label: `Derive ${t} put`, value: `could not be priced just now (${e instanceof Error ? e.message : String(e)})` }]); }
    }, { name: 'price_derive_put', description: "Price a protective put on Derive LIVE for one ticker: reads the order book and returns the instrument, contracts, premium, fees, Derive's minimum size, and the payoff before and after (the chat draws it). Defaults: the user's holding value, an at-the-money strike, the first expiry at least 7 days out. Use whenever the user asks what a put costs or to compare a put with a perp.", schema: z.object({ ticker: z.string().max(10), notionalUsd: z.number().positive().max(10_000_000).optional(), strikePct: z.number().min(50).max(120).optional(), minDays: z.number().min(1).max(45).optional() }) }),

    tool(async ({ venue: v, instrument, side, amount: amount0, leverage, marginUsd, close }: { venue: 'perps' | 'derive'; instrument: string; side: 'buy' | 'sell'; amount?: number; leverage?: number; marginUsd?: number; close?: boolean }) => {
      const venue = v === 'derive' ? 'derive' as const : 'aster' as const;
      ctx.steps.push({ tool: 'propose_trade', label: `Prepared ${side} ${amount0 ?? `$${marginUsd} margin`} ${instrument}${leverage ? ` at ${leverage}x` : ''} for your approval` });
      if (!ctx.req.signedIn) return ok(ctx, [{ label: 'Trade request', value: 'not created: you are not signed in. Sign in with your wallet, then ask again.' }]);
      try {
        const s = await ctx.ensureSnapshot();
        if (ctx.source !== 'live') return ok(ctx, [{ label: 'Trade request', value: 'not created: your live accounts could not be read' }]);
        if (venue === 'derive' && (leverage || marginUsd)) return ok(ctx, [{ label: 'Trade request', value: 'not created: leverage and margin sizing apply to perps only' }]);
        // Leverage (perps): within the market's own maximum and the user's cap (Limits on the Risk page).
        let amount = amount0 ?? 0;
        if (venue === 'aster' && (leverage || marginUsd)) {
          const lev = leverage ?? s.config.limits.maxLeverage;
          if (!Number.isInteger(lev) || lev < 1) return ok(ctx, [{ label: 'Trade request', value: 'not created: leverage must be a whole number, 1 or more' }]);
          const t = instrument.trim().toUpperCase().replace(/-PERP$/, '').replace(/USDT$/, '');
          const creds = await getAsterCreds(s.wallet, s.network);
          const max = await withTimeout(asterTools.maxLeverage(s.network, creds, t), 15_000, 'perps');
          if (lev > max) return ok(ctx, [{ label: 'Trade request', value: `not created: ${t} allows at most ${max}x leverage` }]);
          if (lev > s.config.limits.maxLeverage) return ok(ctx, [{ label: 'Trade request', value: `not created: ${lev}x is above your max leverage of ${s.config.limits.maxLeverage}x. Raise "Max leverage" under Limits on the Risk page (up to ${max}x on ${t}), then ask again` }]);
          // "$1 at 20x": size = margin x leverage / price, rounded down to the market's step.
          if (!amount0 && marginUsd) {
            const m = await asterTools.market(s.network, t); const px = await asterTools.markPrice(s.network, t);
            amount = Math.floor(((marginUsd * lev) / px) / m.stepSize + 1e-9) * m.stepSize;
            amount = Number(amount.toFixed(Math.max(0, Math.round(-Math.log10(m.stepSize)))));
            if (!(amount > 0)) return ok(ctx, [{ label: 'Trade request', value: `not created: $${marginUsd} at ${lev}x is below the smallest ${t} size` }]);
          }
          leverage = lev;
        }
        if (!(amount > 0)) return ok(ctx, [{ label: 'Trade request', value: 'not created: give a size, or for perps a margin in dollars with a leverage' }]);
        const spec0 = await specFrom(s.network, { venue, instrument, side, amount, ...(venue === 'aster' && leverage ? { leverage } : {}), ...(venue === 'aster' && close ? { reduceOnly: true } : {}) });
        const q = await withTimeout(quoteSpec(s.network, spec0), 20_000, venue === 'derive' ? 'Derive' : 'perps');
        const spec = { ...spec0, quotedPrice: q.price };
        const { post, payoff: po } = chatTradeRequest(s, spec, q);
        const r = await postActionToApp(post);
        ctx.ui.showPending = true;
        const items = [
          { label: 'Trade request', value: `${post.title}: ${r.duplicate ? 'already waiting' : 'created'} (status ${r.status}). It is NOT placed yet: it runs only when you press Approve below; the agent re-quotes it then and refuses if the price is more than 25% worse. Your caps and kill switch still apply.` },
          { label: 'Live quote', value: `${spec.side === 'buy' ? 'ask' : 'bid'} $${q.price}; ${spec.kind === 'put' ? `premium about $${q.costUsd} plus about $${(spec.amount * 0.5).toFixed(2)} fees` : `notional about $${q.notionalUsd}`}` },
        ];
        if (po) { const d = po.points.find((x) => x.movePct === -20); const u = po.points.find((x) => x.movePct === 20); if (d && u) items.push({ label: `${po.ticker} payoff with this trade`, value: `at -20%: ${d.beforeUsd} before vs ${d.afterUsd} after; at +20%: ${u.beforeUsd} vs ${u.afterUsd} (USD)` }); }
        return ok(ctx, items, 'The request card with Approve and Reject is shown below the answer.');
      } catch (e) { return ok(ctx, [{ label: 'Trade request', value: `not created: ${e instanceof Error ? e.message : String(e)}` }]); }
    }, { name: 'propose_trade', description: "Turn a position the user asks for into a real order request in their account, shown with Approve and Reject. Use it when they ask you to take, place, open, buy, sell, short or close a position (e.g. 'buy that NVDA put', 'short 0.07 NVDA perp'). derive: buy a put (exact instrument name such as NVDA-20261204-133-P, from price_derive_put) or trade a perp (NVDA-PERP). perps: a perp by ticker (NVDA, traded as NVDAUSDT; $5 minimum order); sell opens or adds to a short, buy only buys back a short (reduce-only). amount = contracts (derive) or units (perps). Nothing executes until the user presses Approve. For perps the user may set leverage ('long NVDA with $1 at 20x', 'short 0.1 BTC at 5x'): pass `leverage` (whole number) and either `amount` (units) or `marginUsd` (dollars of margin; size = margin x leverage / price). Pass `close: true` when they ask to close or reduce a position (reduce-only); otherwise a buy opens a long. Leverage is checked against the market maximum and their own max-leverage limit.", schema: z.object({ venue: z.enum(['perps', 'derive']), instrument: z.string().min(2).max(40), side: z.enum(['buy', 'sell']), amount: z.number().positive().max(1_000_000).optional(), leverage: z.number().int().min(1).max(125).optional(), marginUsd: z.number().positive().max(1_000_000).optional(), close: z.boolean().optional() }) }),

    tool(async () => {
      ctx.steps.push({ tool: 'get_derive_subaccounts', label: 'Read your Derive subaccounts' });
      if (!ctx.req.signedIn) return ok(ctx, [{ label: 'Derive subaccounts', value: 'not read: you are not signed in' }]);
      try {
        const subs = await withTimeout(readDeriveSubs(ctx), 20_000, 'Derive');
        return ok(ctx, subs.map((s) => ({ label: subLabel(s), value: `${usdcOf(s).toFixed(2)} USDC, ${Math.max(0, freeOf(s)).toFixed(2)} free margin${s.is_under_liquidation ? ', BEING LIQUIDATED' : ''}; positions: ${s.positions.length ? s.positions.map((p) => `${p.instrument_name} ${p.amount}`).join(', ') : 'none'}` })));
      } catch (e) { return ok(ctx, [{ label: 'Derive subaccounts', value: `could not be read: ${e instanceof Error ? e.message : String(e)}` }]); }
    }, { name: 'get_derive_subaccounts', description: "List the user's own Derive subaccounts (main account and the per-universe ones such as RWA, PRIME) with their USDC, free margin and positions. Use it before moving margin, or when they ask what is in each Derive account.", schema: z.object({}) }),

    tool(async ({ from, to, amountUsd }: { from: string; to: string; amountUsd: number }) => {
      ctx.steps.push({ tool: 'propose_margin_move', label: `Prepared a $${amountUsd} margin move for your approval` });
      if (!ctx.req.signedIn) return ok(ctx, [{ label: 'Margin move', value: 'not created: you are not signed in. Sign in with your wallet, then ask again.' }]);
      try {
        const s = await ctx.ensureSnapshot();
        const subs = await withTimeout(readDeriveSubs(ctx), 20_000, 'Derive');
        const a = resolveSub(subs, from, subs.mainId); const b = resolveSub(subs, to, subs.mainId);
        const spec: ChatMoveSpec = { venue: 'derive', fromId: a.subaccount_id, toId: b.subaccount_id, fromLabel: subLabel(a), toLabel: subLabel(b), amountUsd: (Math.floor(amountUsd * 100) / 100).toFixed(2) };
        const problems = moveProblems(subs, spec, s.config.limits);
        if (problems.length) return ok(ctx, [{ label: 'Margin move', value: `not created: ${problems.join('; ')}. Nothing was moved. Subaccounts now: ${describeSubs(subs)}` }]);
        const r = await postActionToApp(moveRequest(s, spec));
        ctx.ui.showPending = true;
        return ok(ctx, [{ label: 'Margin move', value: `${spec.amountUsd} USDC from ${spec.fromLabel} to ${spec.toLabel}: ${r.duplicate ? 'already waiting' : 'created'} (status ${r.status}). It is NOT moved yet: it runs only when the user presses Approve below, in every mode. The agent re-checks both balances, the per-move cap and the kill switch then.` }], 'The request card with Approve and Reject is shown below the answer.');
      } catch (e) { return ok(ctx, [{ label: 'Margin move', value: `not created: ${e instanceof Error ? e.message : String(e)}` }]); }
    }, { name: 'propose_margin_move', description: "Ask to move USDC margin between the user's OWN Derive subaccounts (e.g. 'move 200 from my NVDA account to main'). from/to = a subaccount id, 'main', a universe name (RWA, PRIME, MIDCAP, ALT) or a ticker held there (NVDA). Creates a request with Approve and Reject; nothing moves until they press Approve, in every mode. Call get_derive_subaccounts first if you are unsure which account they mean. Only Derive subaccount-to-subaccount moves are supported here, not perps, withdrawals or other wallets.", schema: z.object({ from: z.string().min(1).max(40), to: z.string().min(1).max(40), amountUsd: z.number().min(1).max(1_000_000) }) }),
    tool(async ({ universe, amountUsd, from }: { universe: string; amountUsd: number; from?: string }) => {
      ctx.steps.push({ tool: 'propose_enable_subaccount', label: `Prepared enabling the ${universe.toUpperCase()} subaccount for your approval` });
      if (!ctx.req.signedIn) return ok(ctx, [{ label: 'Enable subaccount', value: 'not created: you are not signed in. Sign in with your wallet, then ask again.' }]);
      try {
        const s = await ctx.ensureSnapshot();
        const [subs, universes] = await withTimeout(Promise.all([readDeriveSubs(ctx), deriveUniverses(ctx.req.network)]), 20_000, 'Derive');
        const m = managerFor(universes, universe);
        const amt = (Math.floor(amountUsd * 100) / 100).toFixed(2);
        // Source: what they named, else the subaccount with the most free USDC (the fallback counts: its money is idle there).
        const src = from ? resolveSub(subs, from, subs.mainId) : [...subs].sort((a, b) => freeOf(b) - freeOf(a))[0];
        if (!src) return ok(ctx, [{ label: 'Enable subaccount', value: 'not created: you have no Derive subaccount to fund it from' }]);
        const spec: ChatMoveSpec = { venue: 'derive', fromId: src.subaccount_id, toId: 0, newManager: m.managerId, fromLabel: subLabel(src), toLabel: `new ${m.name} subaccount`, amountUsd: amt };
        const problems = moveProblems(subs, spec, s.config.limits);
        if (problems.length) return ok(ctx, [{ label: 'Enable subaccount', value: `not created: ${problems.join('; ')}` }]);
        const r = await postActionToApp(moveRequest(s, spec));
        ctx.ui.showPending = true;
        return ok(ctx, [{ label: 'Enable subaccount', value: `${spec.toLabel}, funded with ${amt} USDC from ${spec.fromLabel}: ${r.duplicate ? 'already waiting' : 'created'} (status ${r.status}). Nothing happens until you press Approve below; Derive charges about $1 and the subaccount appears 10 to 30 seconds after it runs.` }], 'The request card with Approve and Reject is shown below the answer.');
      } catch (e) { return ok(ctx, [{ label: 'Enable subaccount', value: `not created: ${e instanceof Error ? e.message : String(e)}` }]); }
    }, { name: 'propose_enable_subaccount', description: "Open a new Derive subaccount for a risk universe the user has not enabled yet (e.g. RWA for NVDA/US500/gold options, PRIME for crypto), funded by moving USDC from one of their own subaccounts. Creates a request with Approve and Reject; nothing happens until they approve. `from` is optional (default: the subaccount with the most free USDC, including the fallback).", schema: z.object({ universe: z.string().min(2).max(20), amountUsd: z.number().min(1).max(1_000_000), from: z.string().max(40).optional() }) }),

    tool(async ({ direction, venue: v, account, amountUsd }: { direction: 'add' | 'withdraw'; venue: 'perps' | 'derive'; account?: string; amountUsd: number }) => {
      const venue = v === 'derive' ? 'derive' as const : 'aster' as const;
      ctx.steps.push({ tool: 'propose_fund_move', label: `Prepared ${direction === 'add' ? 'adding' : 'withdrawing'} $${amountUsd} for your approval` });
      if (!ctx.req.signedIn) return ok(ctx, [{ label: 'Funds move', value: 'not created: you are not signed in. Sign in with your wallet, then ask again.' }]);
      try {
        const s = await ctx.ensureSnapshot();
        const rule = resolveRule(s.config.rebalance.rules, venue, account);
        const spec: ChatFundSpec = { direction, ruleKey: ruleKey(rule), venue, amountBaseUnit: toBase(amountUsd), amountUsd: (Math.floor(amountUsd * 100) / 100).toFixed(2), label: ruleLabel(rule) };
        const { c, problem } = fundCandidate(s, spec, 'chat-fund-check');
        if (!c) return ok(ctx, [{ label: 'Funds move', value: `not created: ${problem}. Nothing was moved.` }]);
        const why = await withScratchStore(async () => checkCandidate(c, s)); if (why) return ok(ctx, [{ label: 'Funds move', value: `not created: ${why}. Nothing was moved.` }]);
        const r = await postActionToApp(fundRequest(s, spec, c));
        ctx.ui.showPending = true;
        return ok(ctx, [{ label: 'Funds move', value: `${direction === 'add' ? 'Add' : 'Withdraw'} $${spec.amountUsd} ${direction === 'add' ? 'to' : 'from'} ${spec.label}: ${r.duplicate ? 'already waiting' : 'created'} (status ${r.status}). It is NOT moved yet: it runs only when the user presses Approve below, in every mode. ${direction === 'withdraw' ? 'A withdrawal lands in their Ethereum wallet, not on BNB Chain, and takes about 14 minutes. ' : `The money comes from their BNB wallet cash (USDC/USDT) within the allowance they gave the agent${venue === 'aster' ? '; it is deposited on BNB Chain (no bridge)' : ''}. `}Caps, reserve and kill switch are re-checked at approval.` }], 'The request card with Approve and Reject is shown below the answer.');
      } catch (e) { return ok(ctx, [{ label: 'Funds move', value: `not created: ${e instanceof Error ? e.message : String(e)}` }]); }
    }, { name: 'propose_fund_move', description: "Ask to move money between the user's BNB wallet and a venue account they have set up on the Risk page: direction 'add' puts USDC from their BNB wallet into the perps account (swapped to USDT and deposited on BNB Chain, no bridge) or a Derive subaccount (bridged and deposited); 'withdraw' takes idle margin out of a Derive subaccount to their own Ethereum wallet. The agent cannot withdraw from perps: that needs the user's own wallet signature in the app, so say so plainly. account = 'main' or the account number from their set-up accounts (omit if they have one). Creates a request with Approve and Reject; nothing moves until they press Approve, in every mode. Use it for 'add $500 to my perps account', 'top up my Derive account', 'take $300 out of my Derive account'. It never sells bStocks. Moving between two Derive subaccounts is propose_margin_move. Perps to Derive directly, or Derive back to BNB Chain, is not supported (Derive withdrawals land on Ethereum): say so plainly.", schema: z.object({ direction: z.enum(['add', 'withdraw']), venue: z.enum(['perps', 'derive']), account: z.string().max(40).optional(), amountUsd: z.number().min(1).max(1_000_000) }) }),

    tool(async ({ tickers }: { tickers?: string[] }) => {
      ctx.steps.push({ tool: 'get_market_data', label: 'Looked up market data' });
      const want = (tickers?.length ? tickers : Object.keys(MARKETS)).map((t) => t.toUpperCase());
      return ok(ctx, want.map((t) => { const m = MARKETS[t]; return { label: `${t} market`, value: m ? `spot ${usd(m.spot)}, daily volatility ${(m.sigma * 100).toFixed(1)}%, perp ${m.perp ? 'yes' : 'no'}, Derive put ${m.put !== null ? `yes (implied volatility ${Math.round(m.put * 100)}%)` : 'no'}` : 'not in the agent market table' }; }), "These are the agent's market table values, used for tests; live runs read prices from the venues.");
    }, { name: 'get_market_data', description: "Spot, daily volatility and which hedge markets (perp, Derive put) exist, per ticker, from the agent's market table.", schema: z.object({ tickers: z.array(z.string().max(8)).max(12).optional() }) }),
    tool(async () => {
      ctx.steps.push({ tool: 'get_context', label: 'Checked the agent state' });
      const s = await ctx.ensureSnapshot(); const st = buildStatus(s); const rec = ctx.req.recorded; const pend = rec.actions.filter((a) => a.status === 'pending').length;
      const last = rec.events[0]?.created_at ?? rec.actions[0]?.created_at ?? null;
      return ok(ctx, [
        { label: 'Data source', value: 'live accounts' },
        { label: 'Mode', value: `${st.mode === 'autonomous' ? 'Autonomous: acts on its own inside the caps' : 'Ask me first: waits for approval'}${st.killSwitch ? '; kill switch ON, no new orders or transfers' : ''}${st.limitsUsed.autonomyExpiresAt ? `; autonomy until ${st.limitsUsed.autonomyExpiresAt.slice(0, 16).replace('T', ' ')} UTC` : ''}` },
        { label: 'Agent state', value: `network ${ctx.req.network}; hedging ${s.config.hedge.enabled ? 'on' : 'OFF'}; news flags ${s.config.hedge.news.enabled ? 'on' : 'off'}; ${pend} request${pend === 1 ? '' : 's'} waiting for approval; last recorded activity ${last ? when(last) : 'none'}${st.paused ? `; PAUSED: ${st.paused.reason}` : ''}` },
        ...st.alerts.slice(0, 3).map((a) => ({ label: 'Alert', value: a })),
      ], ctx.sourceNote ?? undefined);
    }, { name: 'get_context', description: 'A short read of the agent state: live or sample data, the mode (Ask me first or Autonomous), the kill switch, whether it is paused, how many requests wait for approval, the last activity. Use for "what mode am I in", "is the agent running", "what is going on". Cheaper than get_portfolio.', schema: z.object({}) }),

    tool(async () => {
      const s = await ctx.ensureSnapshot(); const st = buildStatus(s); const risk = assessRisk(s);
      const r = await withTimeout(runWhatIf(s), 60_000, 'the hedging agent');
      ctx.steps.push({ tool: 'get_suggestions', label: 'Worked out suggestions' }); ctx.scenarios.push(scenarioOf('current', [`your current numbers`], r, s, true)); if (r.card?.plan) ctx.ui.showPending = true;
      const items: { label: string; value: string }[] = [];
      const p = r.card?.plan as { options?: string[]; varAfterPct?: number; limitPct?: number } | null | undefined;
      items.push({ label: 'Suggestion: the agent would', value: `${r.decision}${p && p.varAfterPct !== undefined && p.limitPct !== undefined ? `. Limit ${p.varAfterPct <= p.limitPct + 1e-9 ? 'MET' : 'NOT met'}: ${p.varAfterPct}% after against ${p.limitPct}%` : ''}` });
      for (const o of p?.options ?? []) items.push({ label: 'Suggestion: option', value: o });
      if (st.varPct > st.limitPct + 1e-9) items.push({ label: 'Suggestion: why', value: `modelled loss ${st.varPct}% is above your ${st.limitPct}% limit; the limit needs ${st.requiredHedgePct}% of the portfolio hedged and ${st.hedgedPct}% is` });
      for (const t of st.tickers.filter((x) => x.bucket === 'none' && !x.excluded)) items.push({ label: 'Suggestion: no hedge market', value: `${t.ticker} (${usd(t.usd)}) has no hedge market, so it stays unhedged` });
      if (risk?.concentration) items.push({ label: 'Suggestion: concentration', value: risk.concentration });
      if (st.nextEvent) { const t = st.tickers.find((x) => x.ticker === st.nextEvent!.ticker); items.push({ label: 'Suggestion: next event', value: `${st.nextEvent.ticker} ${st.nextEvent.kind} in ${Math.round(st.nextEvent.inHours)}h; ${t ? `${Math.round(t.hedgedPct)}% hedged now` : 'not held'}` }); }
      const pend = ctx.req.recorded.actions.filter((a) => a.status === 'pending').length;
      if (pend) { items.push({ label: 'Suggestion: waiting for you', value: `${pend} request${pend === 1 ? '' : 's'} waiting for your approval` }); ctx.ui.showPending = true; }
      for (const a of st.alerts.slice(0, 3)) items.push({ label: 'Alert', value: a });
      if (r.reasons[0] && !r.card) items.push({ label: 'Suggestion: why nothing', value: r.reasons[0] });
      return ok(ctx, items, ctx.sourceNote ?? undefined);
    }, { name: 'get_suggestions', description: 'Work out what to do next: runs the hedging agent on the current numbers and collects code-derived suggestions (what it would do, whether the limit is met, options when it is not, unhedged names, the next event, concentration, requests waiting). Use when the user asks what to do, what you suggest, or how to improve their protection. Do not call it for greetings or general questions.', schema: z.object({}) }),
  ] as unknown as StructuredToolInterface[];
}

// ---- the graph: model -> tools -> model ... -------------------------------------------------------------------------------------------------
const MAX_STEPS = 7;
const S = Annotation.Root({ messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }), n: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }) });

function buildLoop(ctx: Ctx) {
  const tools = makeTools(ctx); const byName = new Map(tools.map((t) => [t.name, t]));
  return new StateGraph(S)
    .addNode('model', async (st: typeof S.State) => ({ messages: [await withTimeout(model(st.messages, tools), 90_000, 'the model')], n: st.n + 1 }))
    .addNode('tools', async (st: typeof S.State) => {
      const last = st.messages[st.messages.length - 1] as AIMessage; const out: ToolMessage[] = [];
      for (const c of last.tool_calls ?? []) {
        const t = byName.get(c.name);
        let content: string;
        try { content = t ? String(await (t as unknown as { invoke: (a: unknown) => Promise<unknown> }).invoke(c.args)) : JSON.stringify({ error: `unknown tool ${c.name}` }); }
        catch (e) { content = JSON.stringify({ error: e instanceof z.ZodError ? `invalid arguments: ${e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` : e instanceof Error ? e.message : String(e) }); }
        out.push(new ToolMessage({ content, tool_call_id: c.id ?? c.name, name: c.name }));
      }
      return { messages: out };
    })
    .addEdge(START, 'model')
    .addConditionalEdges('model', (st) => ((st.messages[st.messages.length - 1] as AIMessage).tool_calls?.length && st.n < MAX_STEPS ? 'tools' : END), ['tools', END])
    .addEdge('tools', 'model').compile();
}

/** Split the model's closing SOURCES and UNSURE lines from the answer. */
export function parseReply(raw: string): { answer: string; sources: string[]; unsure: string | null } {
  let sources: string[] = []; let unsure: string | null = null; const keep: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.replace(/^[`*\s]+|[`*\s]+$/g, '');
    const a = /^SOURCES:\s*(.*)$/i.exec(s); const b = /^UNSURE:\s*(.*)$/i.exec(s);
    if (a) sources = a[1].split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^F\d+$/i.test(x)).map((x) => x.toUpperCase());
    else if (b) unsure = b[1].trim() || 'The agent is not sure.';
    else keep.push(line);
  }
  return { answer: keep.join('\n').trim(), sources, unsure };
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const ctx = new Ctx(req);
  const empty = (answer: string, why: string): ChatResponse => ({ answer, cites: [], unsure: true, unsureReason: why, source: ctx.source, sourceNote: ctx.sourceNote, steps: ctx.steps, scenarios: ctx.scenarios, quotes: ctx.quotes, ui: ctx.ui, usedTools: ctx.steps.length > 0, usedModel: false });
  if (!modelAvailable()) {
    // No model: the plain summary of the portfolio, labelled as such.
    let s: Snapshot; try { s = await ctx.ensureSnapshot(); } catch (e) { return empty(e instanceof Error ? e.message : String(e), 'No live data was read for this answer.'); }
    const f = buildFacts(s, req.recorded, null, 'live');
    const pick = ['Portfolio', 'Modelled 99% loss', 'Next event'].map((l) => f.find((x) => x.label === l)).filter((x): x is Fact => !!x);
    ctx.steps.push({ tool: 'get_portfolio', label: 'Read your portfolio' });
    return { ...empty(`${pick.map((x) => `${x.label}: ${x.value}.`).join(' ')} (The language model is not configured, so this is the plain summary.)`, 'The language model is not configured.'), cites: ctx.register(pick), usedTools: true };
  }
  const loop = buildLoop(ctx);
  const history = req.history.slice(-8).map((h) => (h.role === 'user' ? new HumanMessage(h.text) : new AIMessage(h.text)));
  const start: BaseMessage[] = [new SystemMessage(`${readPrompt('chat_agent.md')}\n\nContext: network ${req.network}. Today is ${new Date().toISOString().slice(0, 10)}.`), ...history, new HumanMessage(req.message)];
  let messages: BaseMessage[]; let finalText = '';
  try {
    const r = await loop.invoke({ messages: start });
    messages = r.messages; finalText = text(messages[messages.length - 1] as AIMessage);
  } catch (e) {
    log.warn(`chat failed: ${e instanceof Error ? e.message : String(e)}`);
    return empty('I could not answer that just now: the language model did not respond. Try again in a moment.', 'The language model did not respond.');
  }
  const sources = [req.message, ...req.history.map((h) => h.text)]; // With no tool used, plain percentages are general knowledge (a 10% gap, a 0.01% funding rate) but a dollar figure would be a claim about money with no live read behind it.
  const check = (t: string) => { const bad = ungroundedFigures(t, [...sources, ...ctx.facts.map((f) => f.value)]); return ctx.steps.length ? bad : bad.filter((x) => x.includes('$')); };
  let parsed = parseReply(finalText); let bad = check(parsed.answer);
  // Every money figure and percentage must come from the tool results. If the model made one up, ask once more with the offending figures named.
  if (bad.length) {
    try {
      const r2 = await loop.invoke({ messages: [...messages, new HumanMessage(`Your last answer used figures that are not in the tool results or my message: ${bad.join(', ')}. Rewrite the answer using only figures from the tool results already above or my message; do NOT call tools you already called (call a new one only if a figure truly needs data you have not read). Leave out a figure you cannot source. If they cannot answer it, say so and add an UNSURE line. Do not mention this correction, do not apologise, and do not refer to an earlier answer: reply as if it were your first answer.`)] });
      parsed = parseReply(text(r2.messages[r2.messages.length - 1] as AIMessage)); bad = check(parsed.answer);
    } catch { /* keep the first answer, it is flagged below */ }
  }
  // Never claim a request exists unless a request tool ran this turn (live 2026-11-26: "Done. The request ... is waiting below"
  // with no tool call, so no Approve card ever appeared). Ask once more, telling the model to call the tool or say it did not.
  if (claimsRequest(parsed.answer) && !madeRequest(ctx)) {
    try {
      const r3 = await loop.invoke({ messages: [...messages, new HumanMessage('You said a request was created, but no request tool ran in this turn, so nothing was created and there is no Approve button. If I asked to move funds or trade, call the right tool now (propose_margin_move, propose_fund_move or propose_trade) and report its result; otherwise say plainly that nothing was created.')] });
      messages = r3.messages; parsed = parseReply(text(messages[messages.length - 1] as AIMessage)); bad = check(parsed.answer);
    } catch { /* fall through to the correction below */ }
    if (claimsRequest(parsed.answer) && !madeRequest(ctx)) parsed = { ...parsed, answer: 'I did not create that request (no request was made, so there is no Approve button). Please ask again, for example: "move $7 from fallback to PRIME".' };
  }
  const known = new Map(ctx.facts.map((f) => [f.id, f])); const cites = [...new Set(parsed.sources)].map((i) => known.get(i)).filter((x): x is Fact => !!x);
  const usedTools = ctx.steps.length > 0;
  let unsureReason: string | null = parsed.unsure;
  if (bad.length) unsureReason = `Some figures in this answer are not in my data and may be wrong: ${bad.slice(0, 6).join(', ')}.`;
  else if (ctx.blocked && !cites.length) unsureReason = 'No live data was read for this answer.';
  else if (usedTools && !cites.length && !unsureReason) unsureReason = 'I could not tie this answer to any of the data I read.';
  return { answer: (parsed.answer.length > 2200 ? `${parsed.answer.slice(0, 2200)}...` : parsed.answer) || 'I have nothing to add.', cites, unsure: !!unsureReason, unsureReason, source: ctx.source, sourceNote: ctx.sourceNote,
    steps: ctx.steps, scenarios: ctx.scenarios, quotes: ctx.quotes, ui: { ...ctx.ui, showPending: ctx.ui.showPending || (ctx.source === 'live' && ctx.req.recorded.actions.some((a) => a.status === 'pending')) }, usedTools, usedModel: true };
}
