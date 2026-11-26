import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, resetConfigForTests } from '../src/config';
import { fixtureSnapshot } from '../src/fixtures';
import { moveProblems, moveRequest, resolveSub, type ChatMoveSpec } from '../src/chat/move';
import { memoryActions, setActionsBackend } from '../src/tools/appApi';
import { clearMovedForTests, runApproved } from '../src/tools/approved';
import { closeStore, openStore } from '../src/tools/store';
import type { SubaccountView } from '../src/tools/derive';

const h = vi.hoisted(() => ({ subs: [] as unknown[], transfer: vi.fn(async () => ({ opUuid: 'op-1' })) }));
vi.mock('../src/tools/derive', async (orig) => ({ ...(await orig<typeof import('../src/tools/derive')>()), listSubaccounts: async () => h.subs, transferSpot: h.transfer }));
vi.mock('../src/tools/appApi', async (orig) => ({ ...(await orig<typeof import('../src/tools/appApi')>()), getDeriveCreds: async () => ({ sessionPrivateKey: '0x01', expiresAt: 0 }) }));

const sub = (id: number, o: Partial<SubaccountView> = {}): SubaccountView => ({
  subaccount_id: id, manager_id: 1, is_under_liquidation: false, initial_margin: '500', collaterals_value: '600', collaterals: [{ asset_name: 'USDC', amount: '600' }], positions: [],
  isFallback: false, universeId: 1, universeName: 'RWA', ...o,
} as SubaccountView);
// #10 is the FALLBACK (catches mis-routed deposits, cannot trade). Live 2026-11-26 the chat called it "main account" and
// moved $7 into it; "main" now means the subaccount the agent key was registered for (PRIME #30 here).
const FALLBACK = sub(10, { isFallback: true, universeName: null, manager_id: 0 });
const MAIN_ID = 30;
const NVDA = sub(20, { universeName: 'RWA', positions: [{ instrument_name: 'NVDA-20261204-133-P', amount: '5' }] });
const PRIME = sub(30, { universeName: 'PRIME' });
const LIM = { killSwitch: false, maxNotionalPerTradeUsd: 50_000 };
const spec = (o: Partial<ChatMoveSpec> = {}): ChatMoveSpec => ({ venue: 'derive', fromId: 20, toId: 30, fromLabel: 'RWA subaccount #20', toLabel: 'PRIME subaccount #30', amountUsd: '200.00', ...o });

describe('resolving what the user called an account', () => {
  const subs = [FALLBACK, NVDA, PRIME];
  it('understands main, a universe, a held ticker and an id', () => {
    expect(resolveSub(subs, 'main', MAIN_ID).subaccount_id).toBe(30); expect(resolveSub(subs, 'my main account', MAIN_ID).subaccount_id).toBe(30);
    expect(resolveSub(subs, 'fallback').subaccount_id).toBe(10);
    expect(() => resolveSub(subs, 'main')).toThrow(/could not tell which one is your main account/);          // no key subaccount known: ask, never guess the fallback
    expect(resolveSub(subs, 'PRIME').subaccount_id).toBe(30); expect(resolveSub(subs, 'NVDA account').subaccount_id).toBe(20); expect(resolveSub(subs, '#30').subaccount_id).toBe(30);
  });
  it('never guesses: an unknown or ambiguous name lists the real accounts', () => {
    expect(() => resolveSub(subs, 'TSLA')).toThrow(/Your Derive subaccounts: fallback subaccount #10 \(cannot trade\)/);
    expect(() => resolveSub(subs, '999')).toThrow(/not one of your Derive subaccounts/);
    expect(() => resolveSub([FALLBACK, NVDA, sub(21, { universeName: 'RWA' })], 'RWA')).toThrow(/More than one/);
  });
});

describe('checks on a margin move', () => {
  const subs = [FALLBACK, NVDA, PRIME];
  it('allows a normal move', () => expect(moveProblems(subs, spec(), LIM)).toEqual([]));
  it('refuses: kill switch, same account, not yours, too small, over cap, more than the free margin or the balance', () => {
    expect(moveProblems(subs, spec(), { ...LIM, killSwitch: true }).join()).toMatch(/kill switch/);
    expect(moveProblems(subs, spec({ toId: 20 }), LIM).join()).toMatch(/same account/);
    expect(moveProblems(subs, spec({ toId: 10 }), LIM).join()).toMatch(/fallback subaccount: it cannot trade/);   // never park margin in the fallback
    expect(moveProblems(subs, spec({ fromId: 10, toId: 30, amountUsd: '7.00' }), LIM)).toEqual([]);                    // but money can come OUT of it
    // Live shape: Derive reports initial_margin 0 for the fallback even with USDC in it.
    const liveFallback = sub(10, { isFallback: true, universeName: null, manager_id: 0, initial_margin: '0', collaterals_value: '7', collaterals: [{ asset_name: 'USDC', amount: '7' }] });
    expect(moveProblems([liveFallback, NVDA, PRIME], spec({ fromId: 10, toId: 30, amountUsd: '7.00' }), LIM)).toEqual([]);
    expect(moveProblems(subs, spec({ toId: 77 }), LIM).join()).toMatch(/#77 is not yours/);
    expect(moveProblems(subs, spec({ amountUsd: '0.50' }), LIM).join()).toMatch(/at least 1 USDC/);
    expect(moveProblems(subs, spec({ amountUsd: '200.00' }), { ...LIM, maxNotionalPerTradeUsd: 100 }).join()).toMatch(/per-move cap/);
    expect(moveProblems(subs, spec({ amountUsd: '550.00' }), LIM).join()).toMatch(/only 500.00 USDC is free/);
    expect(moveProblems(subs, spec({ amountUsd: '700.00' }), LIM).join()).toMatch(/holds only 600.00 USDC/);
    expect(moveProblems([FALLBACK, { ...NVDA, is_under_liquidation: true }], spec(), LIM).join()).toMatch(/being liquidated/);
  });
});

describe('a margin move asked in chat runs only after approval, and exactly as approved', () => {
  beforeEach(() => { openStore(':memory:'); h.subs = [FALLBACK, NVDA, PRIME]; h.transfer.mockClear(); clearMovedForTests(); resetConfigForTests(loadConfig({ DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off' })); });
  afterEach(() => { closeStore(); setActionsBackend(); resetConfigForTests(); });
  const snap = () => { const s = fixtureSnapshot(); s.config.limits = { ...s.config.limits, killSwitch: false, maxNotionalPerTradeUsd: 50_000 }; return s; };

  it('the request is pending and explains what it will do', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    const post = moveRequest(snap(), spec());
    await m.backend.create(post);
    expect(m.rows[0].status).toBe('pending'); expect(post.origin).toBe('chat'); expect(post.title).toMatch(/Move \$200.00 USDC margin on Derive/);
    expect(post.willDo.join(' ')).toMatch(/transfer exactly 200.00 USDC/);
    expect(await runApproved(snap())).toBe(0); expect(h.transfer).not.toHaveBeenCalled();
  });

  it('dry run: approved, nothing is sent, and it says so', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    await m.backend.create(moveRequest(snap(), spec())); m.approve(m.rows[0].id);
    await runApproved(snap());
    expect(m.rows[0].status).toBe('executed'); expect(m.rows[0].result_message).toMatch(/Dry run, no money moved/); expect(h.transfer).not.toHaveBeenCalled();
  });

  it('live: sends exactly the approved amount between exactly the approved accounts, once', async () => {
    resetConfigForTests(loadConfig({ DRY_RUN: 'false', ALLOW_LIVE: 'yes-i-understand', POST_EVENTS: 'false', LLM_MODE: 'off' }));
    const m = memoryActions(); setActionsBackend(m.backend);
    await m.backend.create(moveRequest(snap(), spec())); m.approve(m.rows[0].id);
    await runApproved(snap());
    expect(h.transfer).toHaveBeenCalledTimes(1);
    expect(h.transfer.mock.calls[0].slice(3)).toEqual([20, 30, '200.00', 0]);   // 0 = no new subaccount, a plain move
    expect(m.rows[0].status).toBe('executed'); expect(m.rows[0].result_message).toMatch(/Moved 200.00 USDC from RWA subaccount #20 to PRIME subaccount #30/);
  });

  it('refuses at approval time if the balance changed or the kill switch is on, and moves nothing', async () => {
    resetConfigForTests(loadConfig({ DRY_RUN: 'false', ALLOW_LIVE: 'yes-i-understand', POST_EVENTS: 'false', LLM_MODE: 'off' }));
    const m = memoryActions(); setActionsBackend(m.backend);
    await m.backend.create(moveRequest(snap(), spec())); m.approve(m.rows[0].id);
    h.subs = [FALLBACK, { ...NVDA, initial_margin: '50' }, PRIME];
    await runApproved(snap());
    expect(m.rows[0].status).toBe('failed'); expect(m.rows[0].result_message).toMatch(/only 50.00 USDC is free.*Nothing was moved/); expect(h.transfer).not.toHaveBeenCalled();

    await m.backend.create(moveRequest(snap(), spec({ amountUsd: '10.00' }))); m.approve(m.rows[1].id);
    h.subs = [FALLBACK, NVDA, PRIME]; const ks = snap(); ks.config.limits.killSwitch = true;
    await runApproved(ks);
    expect(m.rows[1].status).toBe('failed'); expect(m.rows[1].result_message).toMatch(/kill switch/); expect(h.transfer).not.toHaveBeenCalled();
  });
});
