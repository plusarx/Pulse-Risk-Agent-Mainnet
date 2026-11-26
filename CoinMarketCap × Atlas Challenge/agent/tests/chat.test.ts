import { clearAsterMarketCache } from '../src/tools/aster';
import { clearOptionNames } from '../src/risk/options';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { loadConfig, resetConfigForTests } from '../src/config';
import { chat, figures, parseReply, setChatModel, setLiveReader, ungroundedFigures, type ChatRequest } from '../src/chat/chat';
import { applyOverrides, Overrides } from '../src/chat/overrides';
import { buildMockSnapshot, MockPortfolio } from '../src/chat/mock';
import { sampleSnapshot } from '../src/chat/sample';

const WALLET = '0x1111111111111111111111111111111111111111';
const req = (message: string, over: Partial<ChatRequest> = {}): ChatRequest => ({ wallet: WALLET, network: 'mainnet', message, history: [], recorded: { actions: [], events: [] }, ...over });
// The chat only ever answers from live data. Tests supply a known portfolio as the live read (the sample portfolio is just a fixture here).
beforeEach(() => { setLiveReader(async (w, n) => ({ snapshot: sampleSnapshot(w, n), note: null })); resetConfigForTests(loadConfig({ ...process.env, DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off', OPENROUTER_API_KEY: 'test', APP_API_URL: 'http://127.0.0.1:9', AGENT_API_TOKEN: 'x' })); });
afterEach(() => { setChatModel(); setLiveReader(); });

const ai = (content: string, calls: { name: string; args: Record<string, unknown> }[] = []) => new AIMessage({ content, tool_calls: calls.map((c, i) => ({ id: `c${i}`, name: c.name, args: c.args, type: 'tool_call' as const })) });
/** A scripted model: each call returns the next reply and records the messages it was given. */
function script(replies: ((msgs: BaseMessage[]) => AIMessage)[]) {
  const seen: BaseMessage[][] = []; let i = 0;
  setChatModel(async (msgs) => { seen.push([...msgs]); return replies[Math.min(i++, replies.length - 1)](msgs); });
  return { seen, calls: () => i };
}
const toolFacts = (msgs: BaseMessage[]) => msgs.filter((m): m is ToolMessage => m instanceof ToolMessage).flatMap((m) => (JSON.parse(String(m.content)).facts ?? []) as { id: string; label: string; value: string }[]);
const idOf = (msgs: BaseMessage[], label: string) => toolFacts(msgs).find((f) => f.label === label)!.id;

describe('the chat agent decides when to use tools', () => {
  it('says hi without reading any data or suggesting anything', async () => {
    const m = script([() => ai('Hi, I am Pulse. What would you like to know?')]);
    const r = await chat(req('hi'));
    expect(m.calls()).toBe(1); expect(r.steps).toEqual([]); expect(r.usedTools).toBe(false); expect(r.cites).toEqual([]);
    expect(r.source).toBeNull(); expect(r.unsure).toBe(false); expect(r.ui).toEqual({ showPending: false, showActivity: false }); expect(r.answer).toMatch(/Pulse/);
  }, 30_000);

  it('reads the portfolio for a question about it and cites what it used', async () => {
    const m = script([() => ai('', [{ name: 'get_portfolio', args: {} }]),
      (msgs) => ai(`You hold a $50,000 portfolio, 0% hedged.\nSOURCES: ${idOf(msgs, 'Portfolio')}, F999`)]);
    const r = await chat(req('How exposed am I?'));
    expect(r.steps.map((s) => s.tool)).toEqual(['get_portfolio']); expect(m.calls()).toBe(2);
    expect(r.source).toBe('live'); expect(r.sourceNote).toBeNull();
    expect(r.cites.map((c) => c.label)).toEqual(['Portfolio']); expect(r.cites[0].value).toMatch(/\$50,000/); expect(r.unsure).toBe(false);
    expect(r.answer).not.toMatch(/SOURCES/);
  }, 30_000);

  it('is unsure when it used tools but cited nothing', async () => {
    script([() => ai('', [{ name: 'get_portfolio', args: {} }]), () => ai('Probably fine.')]);
    const r = await chat(req('Is it fine?'));
    expect(r.unsure).toBe(true); expect(r.unsureReason).toMatch(/could not tie/);
  }, 30_000);

  it('signed out: reads no account, shows no sample figures, and says why', async () => {
    let read = false; setLiveReader(async () => { read = true; throw new Error('should not read'); });
    const m = script([() => ai('', [{ name: 'get_portfolio', args: {} }]), () => ai('You are not signed in, so I cannot read your portfolio.')]);
    const r = await chat(req('How exposed am I?', { wallet: '0x0000000000000000000000000000000000000000' }));
    const tool = m.seen[1].find((x): x is ToolMessage => x instanceof ToolMessage)!;
    expect(read).toBe(false); expect(String(tool.content)).toMatch(/no wallet is registered/i); expect(String(tool.content)).not.toMatch(/NVDA|\$50,000/);
    expect(r.cites).toHaveLength(0); expect(r.unsure).toBe(true); expect(r.unsureReason).toMatch(/No live data/);
  }, 30_000);

  it('live read fails: the tool says why and nothing is answered from data', async () => {
    setLiveReader(async () => { throw new Error('Perps API is unavailable'); });
    const m = script([() => ai('', [{ name: 'get_portfolio', args: {} }]), () => ai('I could not read your accounts just now.')]);
    const r = await chat(req('What do I hold?'));
    const tool = m.seen[1].find((x): x is ToolMessage => x instanceof ToolMessage)!;
    expect(String(tool.content)).toMatch(/could not read your live accounts just now \(Perps API is unavailable\)/); expect(String(tool.content)).not.toMatch(/NVDA|TSLA|AAPL/);
    expect(r.cites).toHaveLength(0); expect(r.unsure).toBe(true);
  }, 30_000);

  it('reads the live accounts fresh on every message, once per message', async () => {
    let reads = 0; setLiveReader(async (w, n) => { reads++; return { snapshot: sampleSnapshot(w, n), note: null }; });
    script([() => ai('', [{ name: 'get_portfolio', args: {} }, { name: 'get_context', args: {} }]), (msgs) => ai(`ok\nSOURCES: ${idOf(msgs, 'Portfolio')}`)]);
    await chat(req('one')); expect(reads).toBe(1);
    script([() => ai('', [{ name: 'get_portfolio', args: {} }]), (msgs) => ai(`ok\nSOURCES: ${idOf(msgs, 'Portfolio')}`)]);
    await chat(req('two')); expect(reads).toBe(2);
  }, 30_000);

  it('passes the live-read note through (no settings saved yet, read with defaults)', async () => {
    setLiveReader(async (w, n) => ({ snapshot: sampleSnapshot(w, n), note: 'No agent settings saved for this wallet yet; read with the defaults.' }));
    script([() => ai('', [{ name: 'get_portfolio', args: {} }]), (msgs) => ai(`ok\nSOURCES: ${idOf(msgs, 'Portfolio')}`)]);
    const r = await chat(req('What do I hold?'));
    expect(r.source).toBe('live'); expect(r.sourceNote).toMatch(/read with the defaults/);
  }, 30_000);

  it('a mock portfolio typed in text still runs when signed out (it uses only the numbers given)', async () => {
    let read = false; setLiveReader(async () => { read = true; throw new Error('should not read'); });
    script([() => ai('', [{ name: 'run_hedging_agent', args: { base: 'mock', mock: { holdings: [{ ticker: 'NVDA', valueUsd: 70_000 }, { ticker: 'AAPL', valueUsd: 30_000 }], events: [{ ticker: 'NVDA', hoursAhead: 24, gapPct: 12 }] } } }]),
      (msgs) => ai(`Tested.\nSOURCES: ${idOf(msgs, 'Test decision')}`)]);
    const r = await chat(req('I hold 70k NVDA and 30k AAPL, NVDA reports tomorrow', { wallet: '0x0000000000000000000000000000000000000000' }));
    expect(read).toBe(false); expect(r.scenarios).toHaveLength(1); expect(r.scenarios[0].kind).toBe('mock');
  }, 90_000);
});

describe('the hedging agent as a tool', () => {
  const CASE1 = { holdings: [{ ticker: 'NVDA', valueUsd: 70_000 }, { ticker: 'AAPL', valueUsd: 20_000 }, { ticker: 'MSFT', valueUsd: 10_000 }], weeklyBudgetUsd: 1000, bnb: { usdc: 12_000, allowanceUsdc: 10_000 }, putChainDepth: { NVDA: 300 }, events: [{ ticker: 'NVDA', hoursAhead: 24, gapPct: 12 }] };

  it('runs a portfolio typed in text (test case 1) as a mock and reports the real decision', async () => {
    script([() => ai('', [{ name: 'run_hedging_agent', args: { base: 'mock', mock: CASE1 } }]),
      (msgs) => ai(`Tested.\nSOURCES: ${idOf(msgs, 'Test decision')}, ${idOf(msgs, 'Test plan')}`)]);
    const r = await chat(req('I hold $100k, 70% NVDA, NVDA reports tomorrow, budget $1,000. What would you do?'));
    expect(r.scenarios).toHaveLength(1); const s = r.scenarios[0];
    expect(s.kind).toBe('mock'); expect(s.decision).toMatch(/Buy \d+ NVDA puts/); expect(s.inputs[0]).toMatch(/\$100,000 portfolio/);
    expect(s.plan?.limitPct).toBe(5); expect(s.limitMet).toBe(true);
    expect(r.cites.map((c) => c.label)).toEqual(['Test decision', 'Test plan']); expect(r.steps[0].label).toMatch(/mock portfolio/);
  }, 90_000);

  it('runs the live portfolio with changed values (what-if)', async () => {
    script([() => ai('', [{ name: 'run_hedging_agent', args: { base: 'current', overrides: { lossLimitPct: 3 } } }]),
      (msgs) => ai(`Tested at 3%.\nSOURCES: ${idOf(msgs, 'Test decision')}`)]);
    const r = await chat(req('What if my loss limit was 3%?'));
    expect(r.scenarios[0].kind).toBe('current'); expect(r.scenarios[0].inputs[0]).toMatch(/loss limit 3%/); expect(r.scenarios[0].decision).not.toBe('No action');
    expect(r.cites[0].value).toMatch(/Buy \d+ NVDA puts/);
  }, 90_000);

  it('gets an error back for an unknown ticker and can fix it', async () => {
    const m = script([() => ai('', [{ name: 'run_hedging_agent', args: { base: 'mock', mock: { holdings: [{ ticker: 'ZZZ', valueUsd: 1000 }] } } }]),
      () => ai('I do not have market data for ZZZ.\nUNSURE: unknown ticker')]);
    const r = await chat(req('hedge $1000 of ZZZ'));
    const toolMsg = m.seen[1].find((x): x is ToolMessage => x instanceof ToolMessage)!;
    expect(String(toolMsg.content)).toMatch(/No market data for ZZZ/); expect(r.scenarios).toHaveLength(0); expect(r.unsure).toBe(true);
  }, 30_000);

  it('rejects leverage above the app maximum and out-of-range values', () => {
    expect(Overrides.safeParse({ maxLeverage: 40 }).success).toBe(false);
    expect(MockPortfolio.safeParse({ holdings: [{ ticker: 'nvda', valueUsd: 5 }] }).success).toBe(false);
  });
  it('applies overrides to a copy and never touches the original', () => {
    const base = sampleSnapshot(WALLET, 'mainnet');
    const { snapshot, applied } = applyOverrides(base, Overrides.parse({ lossLimitPct: 2, events: [{ ticker: 'TSLA', hoursAhead: 6, gapPct: 15 }], deriveFreeUsd: 5000 }));
    expect(base.config.risk.lossTolerancePct).toBe(5); expect(snapshot.config.risk.lossTolerancePct).toBe(2); expect(applied).toHaveLength(3);
  });
  it('builds a mock with the test-input defaults', () => {
    const s = buildMockSnapshot(MockPortfolio.parse({ holdings: [{ ticker: 'TSLA', valueUsd: 20_000 }] }));
    expect(s.config.limits.maxLeverage).toBe(3); expect(s.config.limits.maxCapitalOffBnbUsd).toBe(10_000); expect(s.bsc.usdcUsd).toBe(3000); expect(s.config.risk.lossTolerancePct).toBe(5);
  });
});

describe('approval and activity', () => {
  const pending = { id: 7, status: 'pending', title: 'Buy 73 NVDA puts', why: 'NVDA reports in 18h', created_at: Date.now(), result_message: null };
  it('shows the Approve and Decline cards when the agent checks pending requests', async () => {
    script([() => ai('', [{ name: 'get_pending_requests', args: {} }]), (msgs) => ai(`One request is waiting.\nSOURCES: ${idOf(msgs, 'Pending request #7')}`)]);
    const r = await chat(req('what is waiting for me?', { recorded: { actions: [pending], events: [] } }));
    expect(r.ui.showPending).toBe(true); expect(r.cites[0].value).toMatch(/Buy 73 NVDA puts/);
  }, 30_000);
  it('does not show approval cards when nothing is pending', async () => {
    script([() => ai('', [{ name: 'get_pending_requests', args: {} }]), (msgs) => ai(`Nothing waiting.\nSOURCES: ${idOf(msgs, 'Pending requests')}`)]);
    const r = await chat(req('anything to approve?'));
    expect(r.ui.showPending).toBe(false);
  }, 30_000);
  it('shows the activity list and the mode when asked what the agent has been doing', async () => {
    script([() => ai('', [{ name: 'get_activity', args: {} }]), (msgs) => ai(`Here is what happened.\nSOURCES: ${idOf(msgs, 'Mode')}`)]);
    const r = await chat(req('what have you been doing?', { recorded: { actions: [{ ...pending, status: 'executed' }], events: [{ kind: 'hedge', status: 'done', message: 'Bought 73 puts', created_at: Date.now() }] } }));
    expect(r.ui.showActivity).toBe(true); expect(r.cites[0].value).toMatch(/Ask me first|Autonomous/);
  }, 30_000);
});

describe('figures must come from the data', () => {
  it('reads money and percentages with k and M suffixes', () => { expect(figures('Cost $1,500 or $50k, loss 7.45% and 3 puts').map((f) => f.value)).toEqual([1500, 50000, 7.45]); });
  it('flags a figure that is in no fact, and allows rounding and the user\'s own numbers', () => {
    const src = ['Modelled 99% loss 7.45% of the portfolio', 'Weekly budget about $500', 'What if my limit was 3%?'];
    expect(ungroundedFigures('Loss is 7.5% against 3%, budget $500.', src)).toEqual([]);
    expect(ungroundedFigures('A full hedge costs about $1,500 to $2,000 a week.', src)).toEqual(['$1,500', '$2,000']);
  });
  it('retries once when the model invents a figure, then accepts the grounded rewrite', async () => {
    const m = script([() => ai('', [{ name: 'get_portfolio', args: {} }]),
      (msgs) => ai(`A full hedge costs $87,654 a week.\nSOURCES: ${idOf(msgs, 'Portfolio')}`),
      (msgs) => ai(`I do not have a cost for a full hedge.\nSOURCES: ${idOf(msgs, 'Portfolio')}\nUNSURE: no cost in the data`)]);
    const r = await chat(req('Cost of a perfect hedge?'));
    expect(m.calls()).toBe(3); expect(r.answer).toMatch(/do not have a cost/); expect(r.unsure).toBe(true);
  }, 30_000);
  it('marks the answer unsure when the model keeps inventing figures', async () => {
    script([() => ai('', [{ name: 'get_portfolio', args: {} }]), (msgs) => ai(`It costs $87,654.\nSOURCES: ${idOf(msgs, 'Portfolio')}`)]);
    const r = await chat(req('Cost?'));
    expect(r.unsure).toBe(true); expect(r.unsureReason).toMatch(/\$87,654/);
  }, 30_000);
  it('does not police figures in a plain general-knowledge answer', async () => {
    script([() => ai('A 10% gap against 5x leverage wipes out half the margin.')]);
    const r = await chat(req('why is leverage dangerous?'));
    expect(r.unsure).toBe(false); expect(r.usedTools).toBe(false);
  }, 30_000);
});

describe('reply parsing and no-model fallback', () => {
  it('splits SOURCES and UNSURE lines from the answer', () => {
    expect(parseReply('Answer text.\n`SOURCES: F1, f3, junk`\nUNSURE: a gap')).toEqual({ answer: 'Answer text.', sources: ['F1', 'F3'], unsure: 'a gap' });
  });
  it('gives a plain summary, marked unsure, when no model is configured', async () => {
    resetConfigForTests(loadConfig({ ...process.env, DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off', OPENROUTER_API_KEY: '', APP_API_URL: 'http://127.0.0.1:9', AGENT_API_TOKEN: 'x' }));
    const r = await chat(req('status?'));
    expect(r.usedModel).toBe(false); expect(r.unsure).toBe(true); expect(r.answer).toMatch(/Portfolio/);
  }, 30_000);
});

describe('context and suggestions tools', () => {
  it('reads a short context: mode, data source and what waits, without the whole portfolio', async () => {
    script([() => ai('', [{ name: 'get_context', args: {} }]), (msgs) => ai(`You are in Ask me first mode.\nSOURCES: ${idOf(msgs, 'Mode')}`)]);
    const r = await chat(req('what mode am I in?'));
    expect(r.steps.map((s) => s.tool)).toEqual(['get_context']); expect(r.cites[0].value).toMatch(/Ask me first/);
    expect(r.cites.some((c) => c.label === 'Portfolio')).toBe(false);
  }, 30_000);
  it('works out suggestions by running the agent on the current numbers', async () => {
    script([() => ai('', [{ name: 'get_suggestions', args: {} }]), (msgs) => ai(`Buy the puts.\nSOURCES: ${idOf(msgs, 'Suggestion: the agent would')}`)]);
    const r = await chat(req('what do you suggest?'));
    expect(r.steps.map((s) => s.tool)).toEqual(['get_suggestions']); expect(r.scenarios).toHaveLength(1); expect(r.cites[0].value).toMatch(/Buy \d+ NVDA puts.*Limit MET/);
  }, 90_000);
});

describe('no portfolio figures without a live read', () => {
  it('flags a dollar figure stated with no tool used, after one retry', async () => {
    const m = script([() => ai('You hold $12,345 of NVDA.'), () => ai('You hold $12,345 of NVDA.')]);
    const r = await chat(req('how much NVDA do I hold?'));
    expect(m.calls()).toBe(2); expect(r.usedTools).toBe(false); expect(r.unsure).toBe(true); expect(r.unsureReason).toMatch(/\$12,345/);
  }, 30_000);
  it('lets the retry fix it by reading the live portfolio first', async () => {
    script([() => ai('You hold $12,345 of NVDA.'), () => ai('', [{ name: 'get_portfolio', args: {} }]), (msgs) => ai(`NVDA is $20,000 of your $50,000 portfolio.
SOURCES: ${idOf(msgs, 'NVDA exposure')}, ${idOf(msgs, 'Portfolio')}`)]);
    const r = await chat(req('how much NVDA do I hold?'));
    expect(r.usedTools).toBe(true); expect(r.unsure).toBe(false); expect(r.cites.map((c) => c.label)).toContain('NVDA exposure');
  }, 30_000);
});


describe('hedge card data and venue tickers', () => {
  it('a mock run carries the numbers the card tabs show (holdings, limits) and is a test', async () => {
    script([() => ai('', [{ name: 'run_hedging_agent', args: { base: 'mock', mock: { holdings: [{ ticker: 'NVDA', valueUsd: 70_000 }, { ticker: 'AAPL', valueUsd: 30_000 }], events: [{ ticker: 'NVDA', hoursAhead: 24, gapPct: 12 }] } } }]),
      (msgs) => ai(`Tested.\nSOURCES: ${idOf(msgs, 'Test decision')}`)]);
    const r = await chat(req('Hedge my NVDA, next week looks bearish. 70k NVDA, 30k AAPL'));
    const s = r.scenarios[0]; expect(s.live).toBe(false); expect(s.view).not.toBeNull();
    expect(s.view!.holdings.map((h) => h.ticker)).toEqual(expect.arrayContaining(['NVDA', 'AAPL'])); expect(s.view!.limits.maxPerTradeUsd).toBeGreaterThan(0);
  }, 90_000);

  it('a live run with nothing changed is flagged live and asks the UI to show pending requests', async () => {
    script([() => ai('', [{ name: 'run_hedging_agent', args: { base: 'current' } }]), (msgs) => ai(`ok\nSOURCES: ${idOf(msgs, 'Test decision')}`)]);
    const r = await chat(req('Hedge my portfolio'));
    expect(r.scenarios[0].live).toBe(true); if (r.scenarios[0].plan) expect(r.ui.showPending).toBe(true);
  }, 90_000);

  it('get_venue_tickers reads perps and Derive live and reports exactly what is listed', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u);
      const f = (filterType: string, o: Record<string, string>) => ({ filterType, ...o });
      const sym = (symbol: string) => ({ symbol, status: 'TRADING', baseAsset: symbol.replace('USDT', ''), quoteAsset: 'USDT', pricePrecision: 2, quantityPrecision: 3, filters: [f('PRICE_FILTER', { tickSize: '0.01' }), f('LOT_SIZE', { stepSize: '0.001', minQty: '0.001' }), f('MIN_NOTIONAL', { notional: '5' })] });
      if (url.includes('/fapi/v1/exchangeInfo')) return new Response(JSON.stringify({ symbols: [sym('NVDAUSDT'), sym('ETHUSDT')] }));
      // Derive v3: the live list is get_all_live_instruments (there is no public/get_instruments). Live 2026-11-25 NVDA has options.
      if (url.includes('get_all_live_instruments')) return new Response(JSON.stringify({ result: ['ETH-20261204-1600-P', 'ETH-20261204-1600-C', 'NVDA-20261204-150-P', 'NVDA-20261211-150-P', 'NVDA-20261204-150-C', 'BNB-PERP'] }));
      return real(u, init);
    }) as typeof fetch;
    try {
      clearOptionNames(); clearAsterMarketCache();
      const m = script([() => ai('', [{ name: 'get_venue_tickers', args: { tickers: ['NVDA', 'ETH', 'MSTR'] } }]), (msgs) => ai(`Checked.\nSOURCES: ${idOf(msgs, 'Perps NVDA')}, ${idOf(msgs, 'Derive ETH')}`)]);
      const r = await chat(req('Which tickers can I hedge on perps and options? NVDA, ETH'));
      const facts = toolFacts(m.seen[1]);
      expect(facts.find((f) => f.label === 'Perps NVDA')!.value).toMatch(/listed: NVDAUSDT \(minimum order \$5/); expect(facts.find((f) => f.label === 'Perps MSTR')!.value).toMatch(/no market/); expect(facts.find((f) => f.label === 'Derive ETH')!.value).toMatch(/2 live \(1 puts\)/);
      expect(facts.find((f) => f.label === 'Derive NVDA')!.value).toMatch(/options listed: 3 live \(2 puts\), expiries 2026-12-04, 2026-12-11/);
      expect(facts.find((f) => f.label === 'Derive MSTR')!.value).toMatch(/no live options/);
      expect(r.steps.some((s) => s.tool === 'get_venue_tickers')).toBe(true);
    } finally { globalThis.fetch = real; }
  }, 30_000);
});
