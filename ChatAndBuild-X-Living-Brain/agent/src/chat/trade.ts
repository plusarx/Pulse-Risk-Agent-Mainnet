import { createHash } from 'node:crypto';
import type { Candidate, Network, Snapshot } from '../types';
import type { ActionPost } from '../tools/appApi';
import * as derive from '../tools/derive';
import { asterSymbol, stepQty } from '../../../lib/aster';
import * as aster from '../tools/aster';
import { payoff, type Payoff } from '../risk/payoff';
import { venueAlternatives } from '../risk/alternatives';

// Positions the user asks for in the chat ("buy that NVDA put", "short 0.07 NVDA perp"). The chat never trades:
// it posts a request with the exact order, payoff and venue comparison, and nothing is sent until the user presses
// Approve. On approval the live agent rebuilds the order from this spec, re-quotes it, and runs it through the same
// guard as every other trade (kill switch, per-trade and daily caps, daily loss stop).

export interface ChatTradeSpec {
  venue: 'aster' | 'derive';
  /** Derive instrument name (NVDA-20261204-133-P, NVDA-PERP) or the perps (Aster) symbol (NVDAUSDT). */
  instrument: string;
  kind: 'perp' | 'put';
  side: 'buy' | 'sell';
  /** Contracts (Derive) or base units (perps). */
  amount: number;
  /** Price the user saw when approving: the ask for a buy, the bid for a sell (per contract / unit). */
  quotedPrice: number;
  /** Underlying ticker, e.g. NVDA. */
  ticker: string;
  /** Perps only: leverage the user asked for, set on the market just before the order (1..market max, within their cap). */
  leverage?: number;
  /** Perps only: the user asked to close/reduce (reduce-only). A buy without it opens a long. */
  reduceOnly?: boolean;
}

export interface LiveQuote { price: number; index: number; notionalUsd: number; costUsd: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PUT = /^([A-Z0-9_]+)-(\d{8})-([0-9_]+)-P$/;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Check the order against the venue right now: listed, active, size within the venue's rules, a live price. */
export async function quoteSpec(n: Network, spec: ChatTradeSpec): Promise<LiveQuote> {
  if (spec.venue === 'derive') {
    const inst = await derive.getInstrument(n, spec.instrument);
    if (!inst.isActive) throw new Error(`${spec.instrument} is not active on Derive`);
    if (spec.amount < inst.minimumAmount) throw new Error(`Derive's minimum for ${spec.instrument} is ${inst.minimumAmount}`);
    const steps = spec.amount / inst.amountStep;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) throw new Error(`Derive trades ${spec.instrument} in steps of ${inst.amountStep}`);
    // Market makers on Derive's stock options pull quotes for moments (often outside US market hours): read the
    // book a few times before giving up (live 2026-11-25: one empty read failed an approved order).
    let t = await derive.getTicker(n, spec.instrument);
    for (let i = 0; i < 3 && !((spec.side === 'buy' ? t.ask : t.bid) > 0); i++) { await sleep(2_000); t = await derive.getTicker(n, spec.instrument); }
    const price = spec.side === 'buy' ? t.ask : t.bid;
    if (!(price > 0)) throw new Error(`Derive had no ${spec.side === 'buy' ? 'seller' : 'buyer'} quoting ${spec.instrument} for 6 seconds (stock-option quotes come and go, most often outside US market hours). Ask again for a fresh quote`);
    const index = t.index || price;
    return { price, index, notionalUsd: r2(spec.amount * (spec.kind === 'put' ? index : price)), costUsd: spec.kind === 'put' ? r2(spec.amount * price) : 0 };
  }
  if (spec.venue !== 'aster') throw new Error('that venue is retired; ask again for a perps order');
  const m = await aster.market(n, spec.ticker);
  const price = await aster.markPrice(n, spec.ticker);
  if (!(price > 0)) throw new Error(`no live price for ${m.symbol}`);
  if (Math.abs(Number(stepQty(spec.amount, m.stepSize)) - spec.amount) > m.stepSize * 1e-6) throw new Error(`the perps venue trades ${m.symbol} in steps of ${m.stepSize}`);
  const q = aster.orderQty(m, spec.amount, price);
  if ('error' in q) throw new Error(q.error);
  return { price, index: price, notionalUsd: r2(spec.amount * price), costUsd: 0 };
}

/** Resolve what the user named into a spec (perps: NVDA / NVDA-PERP / NVDAUSDT → NVDAUSDT; Derive kind from the name). */
export async function specFrom(n: Network, a: { venue: 'aster' | 'derive'; instrument: string; side: 'buy' | 'sell'; amount: number; leverage?: number; reduceOnly?: boolean }): Promise<ChatTradeSpec> {
  const name = a.instrument.trim().toUpperCase();
  if (a.venue === 'derive') {
    const put = PUT.exec(name);
    const perp = /^([A-Z0-9_]+)-PERP$/.exec(name);
    if (!put && !perp) throw new Error('On Derive the chat can buy a put (e.g. NVDA-20261204-133-P) or trade a perp (e.g. NVDA-PERP). Calls and selling options are not supported.');
    if (put && a.side !== 'buy') throw new Error('Selling options is not supported from the chat; only buying protective puts.');
    return { venue: 'derive', instrument: name, kind: put ? 'put' : 'perp', side: a.side, amount: a.amount, quotedPrice: 0, ticker: (put ?? perp)![1] };
  }
  const ticker = name.replace(/-PERP$/, '').replace(/USDT$/, '');
  const mk = (await aster.markets(n)).find((x) => x.ticker === ticker);
  if (!mk) throw new Error(`the perps venue lists no ${ticker} perp`);
  return { venue: 'aster', instrument: asterSymbol(ticker), kind: 'perp', side: a.side, amount: a.amount, quotedPrice: 0, ticker, ...(a.leverage ? { leverage: a.leverage } : {}), ...(a.reduceOnly ? { reduceOnly: true } : {}) };
}

/** The candidate the executor runs, built from the approved spec (never from the planner). */
export function candidateFromSpec(spec: ChatTradeSpec, q: LiveQuote, key: string): Candidate {
  const short = spec.side === 'sell';
  const what = `${spec.side === 'buy' ? 'Buy' : 'Sell'} ${spec.amount} ${spec.instrument}${spec.venue === 'derive' ? ' on Derive' : ' perp'}`;
  return {
    id: `chat:${spec.venue}:${spec.instrument}:${spec.side}:${spec.amount}`, kind: 'hedge', venue: spec.venue, amountBaseUnit: '0', chat: true,
    reason: `You asked in the chat: ${what}`, explain: `${what} at about $${q.price} (${spec.kind === 'put' ? `premium about $${q.costUsd}` : `notional about $${q.notionalUsd}`}).`,
    notionalUsd: q.notionalUsd, idempotencyKey: key,
    hedge: spec.venue === 'derive'
      ? { bstock: `${spec.ticker}B`, market: spec.ticker, deltaToShort: spec.kind === 'put' ? spec.amount : short ? spec.amount : -spec.amount, driftPct: 100, ticker: spec.ticker, venue: 'derive', kind: spec.kind,
        instrument: spec.kind, key: spec.kind === 'put' ? `derive-put:${spec.ticker}` : `derive-perp:${spec.ticker}`, derive: { instrument: spec.instrument } }
      : { bstock: `${spec.ticker}B`, market: spec.ticker, deltaToShort: short ? spec.amount : -spec.amount, driftPct: 100, ticker: spec.ticker, venue: 'aster', kind: 'perp', key: `aster:${spec.ticker}`,
        ...(spec.leverage ? { leverage: spec.leverage } : {}), reduceOnly: !!spec.reduceOnly },
  } as Candidate;
}

/** The request shown in the chat with Approve / Reject (payoff + venue comparison for the user's holding). */
export function chatTradeRequest(s: Snapshot, spec: ChatTradeSpec, q: LiveQuote, now = Date.now()): { post: ActionPost; payoff: Payoff | null } {
  const held = s.bsc.bstocks.filter((b) => b.symbol === `${spec.ticker}B` && b.qty > 0).reduce((a, b) => a + b.value, 0);
  const put = spec.kind === 'put' ? PUT.exec(spec.instrument) : null;
  const holding = held > 0 ? held : q.notionalUsd;
  const po = put ? payoff(spec.ticker, holding, { kind: 'put', contracts: spec.amount, strike: Number(put[3].replace('_', '.')), spot: q.index, premiumUsd: q.costUsd, feesUsd: r2(spec.amount * 0.5) })
    : spec.side === 'sell' ? payoff(spec.ticker, holding, { kind: 'perp', shortUsd: q.notionalUsd, feesUsd: 0 }) : null;
  const chosen = spec.venue === 'derive' ? (spec.kind === 'put' ? 'put' : null) : 'perp';
  const alts = held > 0 ? venueAlternatives(s, spec.ticker, chosen) : [];
  const verb = spec.side === 'buy' ? 'Buy' : 'Sell';
  const lev = spec.venue === 'aster' && spec.leverage ? spec.leverage : null;
  const title = `${spec.reduceOnly ? 'Close ' : ''}${verb} ${spec.amount} ${spec.instrument}${spec.venue === 'derive' ? ' on Derive' : ' perp'}${lev ? ` at ${lev}x` : ''} (you asked in chat)`;
  const key = `act-chat-${createHash('sha256').update(`${s.wallet.toLowerCase()}|${s.network}|${spec.venue}|${spec.instrument}|${spec.side}|${spec.amount}|${Math.floor(now / 600_000)}`).digest('hex').slice(0, 20)}`;
  const post: ActionPost = {
    wallet: s.wallet, network: s.network, kind: 'hedge', venue: spec.venue, origin: 'chat', slot: `chat:${spec.venue}:${spec.instrument}`.slice(0, 60),
    title: title.slice(0, 160),
    why: `You asked for this in the chat. Live quote now: ${spec.side === 'buy' ? 'ask' : 'bid'} $${q.price}${spec.kind === 'put' ? `, premium about $${q.costUsd} plus fees` : `, notional about $${q.notionalUsd}`}. On approval the agent re-quotes it and refuses if the price is more than 25% worse, and your caps and kill switch still apply.`.slice(0, 800),
    helps: (spec.kind === 'put' ? `Caps your ${spec.ticker} loss below the strike and keeps the upside.` : spec.side === 'sell' ? `Offsets moves in your ${spec.ticker} 1:1.` : `Reduces or closes your ${spec.ticker} short.`).slice(0, 500),
    willDo: [...(lev ? [`set ${spec.ticker} leverage to ${lev}x (margin about $${r2(q.notionalUsd / lev)} for this order)`] : []), `place a ${spec.venue === 'derive' ? 'Derive' : 'perps'} market order${spec.venue === 'aster' && spec.reduceOnly ? ' (reduce-only)' : ''}: ${verb.toLowerCase()} ${spec.amount} ${spec.instrument}`, 'check that the resulting position matches the order'],
    detail: { candidateId: `chat:${spec.instrument}`, kind: 'hedge', ruleKey: null, amountBaseUnit: '0', hedgeMarket: spec.ticker, hedgeKey: null, hedgeDelta: null, optionContracts: null, chatTrade: { ...spec, quotedPrice: q.price } },
    ...(po ? { payoff: po } : {}), ...(alts.length ? { alternatives: alts } : {}),
    idempotencyKey: key,
  };
  return { post, payoff: po };
}

/** On approval: the order may not have got more than 25% worse than the price the user saw. */
export function priceStillOk(spec: ChatTradeSpec, nowPrice: number): boolean {
  if (!(spec.quotedPrice > 0) || !(nowPrice > 0)) return false;
  return spec.side === 'buy' ? nowPrice <= spec.quotedPrice * 1.25 : nowPrice >= spec.quotedPrice * 0.75;
}
