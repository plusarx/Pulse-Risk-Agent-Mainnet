import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, resetConfigForTests } from '../src/config';
import { fixtureSnapshot } from '../src/fixtures';
import { managerFor, moveProblems, moveRequest, type ChatMoveSpec } from '../src/chat/move';
import { planSweep } from '../src/tools/fallbackSweep';
import { memoryActions, setActionsBackend } from '../src/tools/appApi';
import { clearMovedForTests, runApproved } from '../src/tools/approved';
import { closeStore, openStore } from '../src/tools/store';
import type { SubaccountView } from '../src/tools/derive';
import { ActionIn } from '../../lib/agent-action';

const h = vi.hoisted(() => ({ subs: [] as unknown[], transfer: vi.fn(async () => ({ opUuid: 'op-1' })) }));
vi.mock('../src/tools/derive', async (orig) => ({ ...(await orig<typeof import('../src/tools/derive')>()), listSubaccounts: async () => h.subs, transferSpot: h.transfer }));
vi.mock('../src/tools/appApi', async (orig) => ({ ...(await orig<typeof import('../src/tools/appApi')>()), getDeriveCreds: async () => ({ subaccountId: 122955, sessionPrivateKey: '0x01', expiresAt: 0 }) }));

const sub = (id: number, o: Partial<SubaccountView> = {}): SubaccountView => ({
  subaccount_id: id, manager_id: 1, is_under_liquidation: false, initial_margin: '0', collaterals_value: '0', collaterals: [], positions: [], isFallback: false, universeId: 1, universeName: 'PRIME', ...o,
} as SubaccountView);
// Live 2026-11-26 shapes: $7 in the fallback (Derive reports initial_margin 0 there), PRIME is the key's subaccount, RWA empty.
const FALLBACK = sub(122954, { isFallback: true, manager_id: 0, universeName: null, collaterals_value: '7', collaterals: [{ asset_name: 'USDC', amount: '7' }] });
const PRIME = sub(122955, { manager_id: 1, universeName: 'PRIME', initial_margin: '0.96', collaterals_value: '0.96', collaterals: [{ asset_name: 'USDC', amount: '0.96' }] });
const RWA = sub(122958, { manager_id: 4, universeName: 'RWA' });
const UNIVERSES = [{ id: 1, name: 'PRIME', managers: [{ managerId: 1, marginType: 'SM' }, { managerId: 2, marginType: 'PM2' }] }, { id: 3, name: 'RWA', managers: [{ managerId: 4, marginType: 'SM' }] }];
const LIM = { killSwitch: false, maxNotionalPerTradeUsd: 5_000 };

describe('fallback sweep plan', () => {
  it('moves the whole fallback balance to the key\'s main subaccount', () => {
    expect(planSweep([FALLBACK, PRIME, RWA], 122955)).toMatchObject({ fromId: 122954, toId: 122955, amountUsd: '7.00', fromLabel: 'fallback subaccount #122954 (cannot trade)', toLabel: 'PRIME subaccount #122955' });
  });
  it('nothing to do: under $1, no fallback, or main unknown', () => {
    expect(planSweep([{ ...FALLBACK, collaterals: [{ asset_name: 'USDC', amount: '0.4' }] }, PRIME], 122955)).toBeNull();
    expect(planSweep([PRIME, RWA], 122955)).toBeNull();
    expect(planSweep([FALLBACK, PRIME], null)).toBeNull();
  });
  it('its request is valid for the app and marked as the agent\'s own', () => {
    const p = moveRequest(fixtureSnapshot(), planSweep([FALLBACK, PRIME], 122955)!, Date.now(), { origin: 'rule', why: 'USDC is sitting in your fallback.' });
    expect(ActionIn.safeParse(p).success).toBe(true); expect(p.origin).toBe('rule'); expect(p.title).not.toMatch(/you asked in chat/);
  });
});

describe('enabling a Derive subaccount', () => {
  it('finds the SM manager of a universe by name; unknown names list what exists', () => {
    expect(managerFor(UNIVERSES, 'rwa')).toEqual({ managerId: 4, name: 'RWA' });
    expect(managerFor(UNIVERSES, 'PRIME universe')).toEqual({ managerId: 1, name: 'PRIME' });
    expect(() => managerFor(UNIVERSES, 'FX')).toThrow(/no "FX" risk universe. It has: PRIME, RWA/);
  });
  const enable = (o: Partial<ChatMoveSpec> = {}): ChatMoveSpec => ({ venue: 'derive', fromId: 122954, toId: 0, newManager: 4, fromLabel: 'fallback', toLabel: 'new RWA subaccount', amountUsd: '7.00', ...o });
  it('allowed from the fallback into a universe you do not have yet', () => {
    expect(moveProblems([FALLBACK, PRIME], enable(), LIM)).toEqual([]);
  });
  it('refused when you already have it (move into it instead), or without a manager', () => {
    expect(moveProblems([FALLBACK, PRIME, RWA], enable(), LIM).join()).toMatch(/already have that subaccount \(#122958\); move funds into it instead/);
    expect(moveProblems([FALLBACK, PRIME], enable({ newManager: 0 }), LIM).join()).toMatch(/no Derive manager/);
  });
  it('the request reads as enabling, and is valid for the app', () => {
    const p = moveRequest(fixtureSnapshot(), enable());
    expect(ActionIn.safeParse(p).success).toBe(true);
    expect(p.title).toBe('Enable new RWA subaccount on Derive, funded with $7.00 USDC from fallback (you asked in chat)');
  });
});

describe('approved enable runs one transfer that creates the subaccount', () => {
  beforeEach(() => { openStore(':memory:'); h.subs = [FALLBACK, PRIME]; h.transfer.mockClear(); clearMovedForTests(); resetConfigForTests(loadConfig({ DRY_RUN: 'false', ALLOW_LIVE: 'yes-i-understand', POST_EVENTS: 'false', LLM_MODE: 'off' })); });
  afterEach(() => { closeStore(); setActionsBackend(); resetConfigForTests(); });
  it('to = 0 with the universe manager; once', async () => {
    const m = memoryActions(); setActionsBackend(m.backend);
    const s = fixtureSnapshot(); s.config.limits = { ...s.config.limits, killSwitch: false, maxNotionalPerTradeUsd: 5_000 };
    await m.backend.create(moveRequest(s, { venue: 'derive', fromId: 122954, toId: 0, newManager: 4, fromLabel: 'fallback', toLabel: 'new RWA subaccount', amountUsd: '7.00' })); m.approve(m.rows[0].id);
    await runApproved(s); await runApproved(s);
    expect(h.transfer).toHaveBeenCalledTimes(1);
    expect(h.transfer.mock.calls[0].slice(3)).toEqual([122954, 0, '7.00', 4]);
    expect(m.rows[0].status).toBe('executed');
  });
});
