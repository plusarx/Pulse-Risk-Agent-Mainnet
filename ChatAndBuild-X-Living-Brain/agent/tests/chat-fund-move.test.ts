import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigForTests } from '../src/config';
import { fixtureSnapshot } from '../src/fixtures';
import { fundCandidate, fundRequest, resolveRule, toBase, type ChatFundSpec } from '../src/chat/fund';
import { memoryActions, setActionsBackend } from '../src/tools/appApi';
import { runApproved } from '../src/tools/approved';
import { checkCandidate } from '../src/tools/guard';
import { closeStore, openStore } from '../src/tools/store';
import { defaultRule } from '../../lib/risk-rules';

const spec = (o: Partial<ChatFundSpec> = {}): ChatFundSpec => ({ direction: 'add', ruleKey: 'aster:', venue: 'aster', amountBaseUnit: toBase(50), amountUsd: '50.00', label: 'perps account', ...o });
/** The same wallet with a Derive subaccount rule too ($100 value, $82 used: $18 free). */
const withDerive = () => { const s = fixtureSnapshot(); s.config.rebalance.rules.push({ ...defaultRule('derive', '42'), minMoveBaseUnit: '7000000' }); s.health['derive:42'] = { connected: true, utilBps: 8200, accountUsd: 100, usedUsd: 82 }; s.moved24hBase['derive:42'] = '0'; return s; };
const dspec = (o: Partial<ChatFundSpec> = {}): ChatFundSpec => spec({ ruleKey: 'derive:42', venue: 'derive', label: 'Derive account #42', ...o });

describe('which account the user means', () => {
  const rules = [defaultRule('aster'), { ...defaultRule('derive'), accountRef: '123' }];
  it('resolves the perps account (one per wallet) and a Derive account by number', () => {
    expect(resolveRule(rules, 'aster', 'main').accountRef).toBe(''); expect(resolveRule(rules, 'aster').accountRef).toBe('');
    expect(resolveRule(rules, 'derive', '#123').accountRef).toBe('123'); expect(resolveRule(rules, 'derive').accountRef).toBe('123');
  });
  it('never guesses: an account that is not set up lists the ones that are', () => {
    expect(() => resolveRule(rules, 'aster', '9')).toThrow(/not one of your set-up accounts.*perps account/);
    expect(() => resolveRule(rules.slice(0, 1), 'derive')).toThrow(/no Derive account set up on the Risk page/);
    expect(() => resolveRule([{ ...defaultRule('derive'), accountRef: '1' }, { ...defaultRule('derive'), accountRef: '2' }], 'derive')).toThrow(/Tell me which account/);
  });
  it('converts dollars to exact base units without rounding up', () => { expect(toBase(50)).toBe('50000000'); expect(toBase(12.349)).toBe('12340000'); });
});

describe('building the move from the approved spec', () => {
  beforeEach(() => { openStore(':memory:'); resetConfigForTests(loadConfig({ DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off' })); });
  afterEach(() => { closeStore(); resetConfigForTests(); });
  const s = () => fixtureSnapshot();
  it('add: funded from BNB USDC, exact amount, goes through the guard', () => {
    const { c, problem } = fundCandidate(s(), spec(), 'k'); expect(problem).toBeNull(); expect(c!.kind).toBe('top_up'); expect(c!.amountBaseUnit).toBe('50000000');
    expect(c!.funding).toEqual([{ source: 'bsc_usdc', amountUsd: 50 }]); expect(c!.chat).toBe(true); expect(checkCandidate(c!, s())).toBeNull();
  });
  it('add: refuses when the allowed BNB cash is short, and never sells bStocks', () => {
    const snap = s(); snap.bsc.bstocks = [{ symbol: 'NVDAB', qty: 100, value: 20000, allowanceQty: 100 }];
    expect(fundCandidate(snap, spec({ amountBaseUnit: toBase(400), amountUsd: '400.00' }), 'k').problem).toMatch(/short by .*does not sell your bStocks/);
  });
  it('add: refuses under the minimum move; the guard refuses over the per-move cap and during the kill switch', () => {
    expect(fundCandidate(s(), spec({ amountBaseUnit: toBase(2), amountUsd: '2.00' }), 'k').problem).toMatch(/minimum/);
    const snap = s(); snap.bsc.usdcUsd = 5000; snap.bsc.allowanceUsdcBase = '5000000000';
    const big = fundCandidate(snap, spec({ amountBaseUnit: toBase(900), amountUsd: '900.00' }), 'k'); expect(big.c).not.toBeNull(); expect(checkCandidate(big.c!, snap)).toMatch(/per-move cap/);
    const ks = s(); ks.config.limits.killSwitch = true; expect(checkCandidate(fundCandidate(ks, spec(), 'k').c!, ks)).toMatch(/kill switch/);
  });
  it('withdraw from perps is refused: the agent key cannot withdraw, the user signs it in the app', () => {
    const r = fundCandidate(s(), spec({ direction: 'withdraw', amountBaseUnit: toBase(10), amountUsd: '10.00' }), 'k');
    expect(r.c).toBeNull(); expect(r.problem).toMatch(/need your wallet signature in the app/);
  });
  it('withdraw (options): only the free margin, and it says it lands on Ethereum', () => {
    expect(fundCandidate(withDerive(), dspec({ direction: 'withdraw', amountBaseUnit: toBase(50), amountUsd: '50.00' }), 'k').problem).toMatch(/only \$18.00 is free/);
    const { c } = fundCandidate(withDerive(), dspec({ direction: 'withdraw', amountBaseUnit: toBase(10), amountUsd: '10.00' }), 'k'); expect(c!.kind).toBe('release'); expect(c!.explain).toMatch(/Ethereum wallet/);
  });
  it('a request is a pending ask with plain steps, in either direction', () => {
    const snap = s(); const a = fundCandidate(snap, spec(), 'k').c!; const post = fundRequest(snap, spec(), a);
    expect(post.origin).toBe('chat'); expect(post.kind).toBe('top_up'); expect(post.title).toMatch(/Add \$50.00 to perps account/); expect(post.willDo.join(' ')).toMatch(/pull \$50.00 of USDC from your BNB wallet.*deposit it into perps account on BNB Chain \(no bridge\)/);
    const d = withDerive(); const w = fundCandidate(d, dspec({ direction: 'withdraw', amountBaseUnit: toBase(10), amountUsd: '10.00' }), 'k').c!;
    expect(fundRequest(d, dspec({ direction: 'withdraw', amountBaseUnit: toBase(10), amountUsd: '10.00' }), w).willDo.join(' ')).toMatch(/lands on Ethereum, not BNB Chain/);
  });
});

describe('approval gate', () => {
  beforeEach(() => { openStore(':memory:'); resetConfigForTests(loadConfig({ DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off' })); });
  afterEach(() => { closeStore(); setActionsBackend(); resetConfigForTests(); });
  it('nothing runs while pending; once approved it runs exactly the asked amount (dry run here)', async () => {
    const m = memoryActions(); setActionsBackend(m.backend); const snap = fixtureSnapshot();
    await m.backend.create(fundRequest(snap, spec(), fundCandidate(snap, spec(), 'k').c!));
    expect(await runApproved(snap)).toBe(0); expect(m.rows[0].status).toBe('pending');
    m.approve(m.rows[0].id); await runApproved(snap);
    expect(m.rows[0].status).toBe('executed'); expect(m.rows[0].result_message).toMatch(/Dry run, no money moved/);
  });
  it('refuses at approval time if balances changed under it', async () => {
    const m = memoryActions(); setActionsBackend(m.backend); const snap = fixtureSnapshot();
    await m.backend.create(fundRequest(snap, spec(), fundCandidate(snap, spec(), 'k').c!)); m.approve(m.rows[0].id);
    const later = fixtureSnapshot(); later.bsc.usdcUsd = 12; await runApproved(later);
    expect(m.rows[0].status).toBe('failed'); expect(m.rows[0].result_message).toMatch(/short by.*Nothing was moved/);
  });
  it('the kill switch stops an approved move', async () => {
    const m = memoryActions(); setActionsBackend(m.backend); const snap = fixtureSnapshot();
    await m.backend.create(fundRequest(snap, spec(), fundCandidate(snap, spec(), 'k').c!)); m.approve(m.rows[0].id);
    const ks = fixtureSnapshot(); ks.config.limits.killSwitch = true; await runApproved(ks);
    expect(m.rows[0].status).toBe('failed'); expect(m.rows[0].result_message).toMatch(/kill switch.*Nothing was moved/);
  });
});
