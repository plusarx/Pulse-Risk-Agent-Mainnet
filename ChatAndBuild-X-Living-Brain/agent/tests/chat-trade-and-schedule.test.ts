import { describe, expect, it } from 'vitest';
import { AgentConfig, DEFAULT_CONFIG } from '../../lib/agent-config';
import { candidateFromSpec, chatTradeRequest, priceStillOk, specFrom, type ChatTradeSpec } from '../src/chat/trade';
import { checkCandidate } from '../src/tools/guard';
import { fixtureSnapshot } from '../src/fixtures';
import { dueReason } from '../src/index';
import { ActionIn } from '../../lib/agent-action';

const put: ChatTradeSpec = { venue: 'derive', instrument: 'NVDA-20261204-133-P', kind: 'put', side: 'buy', amount: 1, quotedPrice: 3.13, ticker: 'NVDA' };
const quote = { price: 3.13, index: 147.65, notionalUsd: 147.65, costUsd: 3.13 };

describe('chat trades: exact order, never chosen by the planner', () => {
  it('reads a Derive put and a Derive perp; refuses selling options and calls', async () => {
    expect(await specFrom('mainnet', { venue: 'derive', instrument: 'nvda-20261204-133-p', side: 'buy', amount: 1 })).toMatchObject({ kind: 'put', ticker: 'NVDA', instrument: 'NVDA-20261204-133-P' });
    expect(await specFrom('mainnet', { venue: 'derive', instrument: 'NVDA-PERP', side: 'sell', amount: 0.1 })).toMatchObject({ kind: 'perp', ticker: 'NVDA' });
    await expect(specFrom('mainnet', { venue: 'derive', instrument: 'NVDA-20261204-133-P', side: 'sell', amount: 1 })).rejects.toThrow(/Selling options is not supported/);
    await expect(specFrom('mainnet', { venue: 'derive', instrument: 'NVDA-20261204-160-C', side: 'buy', amount: 1 })).rejects.toThrow(/Calls and selling options are not supported/);
  });
  it('the put becomes a Derive buy of that exact instrument', () => {
    const c = candidateFromSpec(put, quote, 'chat-15');
    expect(c).toMatchObject({ chat: true, venue: 'derive', notionalUsd: 147.65, idempotencyKey: 'chat-15' });
    expect(c.hedge).toMatchObject({ kind: 'put', deltaToShort: 1, key: 'derive-put:NVDA', derive: { instrument: 'NVDA-20261204-133-P' } });
  });
  it('a perps short sells (deltaToShort > 0), a buy covers', () => {
    const l: ChatTradeSpec = { venue: 'aster', instrument: 'NVDAUSDT', kind: 'perp', side: 'sell', amount: 0.07, quotedPrice: 150, ticker: 'NVDA' };
    expect(candidateFromSpec(l, { price: 150, index: 150, notionalUsd: 10.5, costUsd: 0 }, 'k').hedge).toMatchObject({ deltaToShort: 0.07, venue: 'aster', key: 'aster:NVDA' });
    expect(candidateFromSpec({ ...l, side: 'buy' }, { price: 150, index: 150, notionalUsd: 10.5, costUsd: 0 }, 'k').hedge!.deltaToShort).toBe(-0.07);
  });
  it('on approval the price may be at most 25% worse than quoted', () => {
    expect(priceStillOk(put, 3.9)).toBe(true);
    expect(priceStillOk(put, 3.95)).toBe(false);
    expect(priceStillOk({ ...put, side: 'sell', kind: 'perp' }, 2.4)).toBe(true);
    expect(priceStillOk({ ...put, side: 'sell', kind: 'perp' }, 2.3)).toBe(false);
  });
  it('the request is valid for the app, carries the payoff, and marks origin chat', () => {
    const s = fixtureSnapshot(); s.bsc.bstocks = [{ symbol: 'NVDAB', qty: 0.0694, value: 10.26 }];
    const { post, payoff } = chatTradeRequest(s, put, quote);
    expect(ActionIn.safeParse(post).success).toBe(true);
    expect(post.origin).toBe('chat');
    expect(payoff?.hedgeLabel).toBe('1 NVDA put at strike 133 on Derive');
    expect((post.detail as { chatTrade: ChatTradeSpec }).chatTrade.quotedPrice).toBe(3.13);
  });
  it('the guard lets an approved chat trade through without a saved leg, but the kill switch and caps still block it', () => {
    const s = fixtureSnapshot(); s.config.hedge.enabled = false; s.config.hedge.legs = [];
    const c = candidateFromSpec(put, quote, 'k');
    expect(checkCandidate(c, s)).toBeNull();
    s.config.limits.killSwitch = true;
    expect(checkCandidate(c, s)).toMatch(/kill switch/);
    s.config.limits.killSwitch = false; s.config.limits.maxNotionalPerTradeUsd = 100;
    expect(checkCandidate(c, s)).toMatch(/above your max notional per trade/);
    expect(checkCandidate({ ...c, chat: false }, { ...s, config: { ...s.config, limits: { ...s.config.limits, maxNotionalPerTradeUsd: 5000 } } })).toMatch(/not on your allowlist|hedging is off/);   // the same order without the chat flag is refused
  });
});

describe('check schedule: every 30 s, or only on Run now', () => {
  const T = 30_000; const now = 1_000_000;
  it('automatic: due after 30 s', () => {
    expect(dueReason({ schedule: { auto: true, runNowAt: null } }, now - 31_000, T, false, now)).toBe('scheduled');
    expect(dueReason({ schedule: { auto: true, runNowAt: null } }, now - 10_000, T, false, now)).toBeNull();
  });
  it('manual: never on its own; Run now runs once', () => {
    expect(dueReason({ schedule: { auto: false, runNowAt: null } }, now - 999_000, T, false, now)).toBeNull();
    expect(dueReason({ schedule: { auto: false, runNowAt: now - 1_000 } }, now - 5_000, T, false, now)).toBe('run-now');
    expect(dueReason({ schedule: { auto: false, runNowAt: now - 5_000 } }, now - 1_000, T, false, now)).toBeNull();   // already handled
  });
  it('an approved request runs within seconds even with checks off', () => {
    expect(dueReason({ schedule: { auto: false, runNowAt: null } }, now - 1_000, T, true, now)).toBe('approved');
  });
  it('saved settings from before this change default to automatic', () => {
    const { schedule, ...old } = DEFAULT_CONFIG; void schedule;
    expect(AgentConfig.parse(old).schedule).toEqual({ auto: true, runNowAt: null });
  });
});
