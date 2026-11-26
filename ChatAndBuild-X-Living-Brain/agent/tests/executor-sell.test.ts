import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Live-path test with every venue and chain call faked: a bStock is pulled from the user, sold for USDC on PancakeSwap,
// swapped to USDT and deposited into the user's perps (Aster) account on BNB Chain (no bridge). A failed step stops
// the move. Nothing touches a network.

vi.mock('../src/tools/appApi', async () => {
  const real = await vi.importActual<typeof import('../src/tools/appApi')>('../src/tools/appApi');
  return { ...real, getAsterCreds: async () => ({ venue: 'aster', network: 'testnet', wallet: WALLET_ADDR, user: WALLET_ADDR, agentAddress: '0x2222222222222222222222222222222222222222', agentPrivateKey: 'x', expiresAt: null }), getDeriveCreds: async () => { throw new Error('unused'); } };
});
const WALLET_ADDR = '0x1111111111111111111111111111111111111111';

import { loadConfig, resetConfigForTests } from '../src/config';
import { fixtureSnapshot } from '../src/fixtures';
import type { AsterFundDeps } from '../src/tools/asterDeposit';
import { ASTER_VAULT } from '../src/tools/asterDeposit';
import { execute, setAsterFundDepsForTests } from '../src/tools/executor';
import { buildCandidates } from '../src/tools/planner';
import { closeStore, openStore } from '../src/tools/store';

const calls: string[] = [];
let sellFails = false; let depositFails = false; let credits = true; let bnb = 10n ** 16n;
let futures = 0; let deposited: { account: string; amountWei: bigint } | null = null; let swappedWei = 0n;

const deps: AsterFundDeps = {
  agentAddress: () => '0x00000000000000000000000000000000000000aa',
  bnbBalance: async () => bnb,
  pullStable: async (t) => { calls.push(`pull:${t}`); return { txHash: '0xpull' }; },
  rawForUi: async (_s, q) => BigInt(Math.floor(q * 1e8)) * 10n ** 10n,
  pullBstock: async (sym) => { calls.push(`pullBstock:${sym}`); return { txHash: '0xpullb' }; },
  sellBstockForUsdc: async (sym) => { if (sellFails) throw new Error('sale reverted'); calls.push(`sell:${sym}`); return { txHash: '0xsell', usdcOutWei: 82n * 10n ** 18n }; },
  swapUsdcToUsdt: async (w) => { calls.push('swap'); swappedWei = w; return { txHash: '0xswap', usdtOutWei: w - 10n ** 16n }; },
  approveUsdt: async (spender) => { calls.push(`approve:${spender}`); return { txHash: '0xappr' }; },
  depositFor: async (account, amountWei) => { if (depositFails) throw new Error('depositFor reverted'); calls.push('deposit'); deposited = { account, amountWei }; if (credits) futures += Number(amountWei / 10n ** 12n) / 1e6; return { txHash: '0xdep' }; },
  futuresUsdt: async () => futures,
  spotToFutures: async () => { calls.push('spotToFutures'); return 'tran1'; },
  sleep: async () => undefined,
  now: (() => { let t = 0; return () => (t += 7_000); })(),
};

const snap = () => {
  const s = fixtureSnapshot({ bsc: { usdcUsd: 0, usdtUsd: 0, bstocks: [{ symbol: 'SPYB', qty: 1, value: 500, allowanceQty: 1 }], allowanceUsdcBase: '0' } });
  s.config.rebalance.sources = ['sell_bstocks']; s.config.rebalance.sellOrder = ['SPYB'];
  return s;
};

beforeEach(() => {
  openStore(':memory:'); calls.length = 0; sellFails = false; depositFails = false; credits = true; bnb = 10n ** 16n; futures = 0; deposited = null; swappedWei = 0n;
  resetConfigForTests(loadConfig({ DRY_RUN: 'false', ALLOW_LIVE: 'yes-i-understand', POST_EVENTS: 'false', LLM_MODE: 'off' }));
  setAsterFundDepsForTests(deps);
});
afterEach(() => { closeStore(); resetConfigForTests(); setAsterFundDepsForTests(); });

describe('sell then deposit to perps (live path, mocked venues)', () => {
  it('pulls the bStock, sells it, swaps the USDC to USDT and deposits it for the user (no bridge)', async () => {
    const s = snap(); const c = buildCandidates(s).candidates[0];
    const steps = await execute(s, c);
    expect(steps.every((x) => x.status === 'done')).toBe(true);
    expect(calls).toEqual(['pullBstock:SPYB', 'sell:SPYB', 'swap', `approve:${ASTER_VAULT}`, 'deposit']);
    expect(swappedWei).toBe(82n * 10n ** 18n);
    expect(deposited).toEqual({ account: WALLET_ADDR, amountWei: 82n * 10n ** 18n - 10n ** 16n });   // credited to the USER, USDT 18 dp
  });

  it('a failed sale stops the move: nothing is deposited', async () => {
    sellFails = true;
    const s = snap(); const c = buildCandidates(s).candidates[0];
    const steps = await execute(s, c);
    expect(steps.some((x) => /^Sell SPYB/.test(x.step) && x.status === 'failed')).toBe(true);
    expect(calls).not.toContain('deposit'); expect(calls).not.toContain('swap');
  });

  it('a failed deposit is reported and there is no rollback of the sale', async () => {
    depositFails = true;
    const s = snap(); const c = buildCandidates(s).candidates[0];
    const steps = await execute(s, c);
    expect(steps.some((x) => /^Deposit .* USDT into your perps account/.test(x.step) && x.status === 'failed')).toBe(true);
    expect(calls).toEqual(['pullBstock:SPYB', 'sell:SPYB', 'swap', `approve:${ASTER_VAULT}`]);
  });

  it('a rerun after a crash resumes instead of selling or depositing twice', async () => {
    const s = snap(); const c = buildCandidates(s).candidates[0];
    await execute(s, c); await execute(s, c);
    expect(calls.filter((x) => x === 'sell:SPYB')).toHaveLength(1);
    expect(calls.filter((x) => x === 'pullBstock:SPYB')).toHaveLength(1);
    expect(calls.filter((x) => x === 'deposit')).toHaveLength(1);
  });

  it('a deposit that does not show up on perps tries the spot-to-perps transfer once, then fails without resending', async () => {
    credits = false;
    const s = snap(); const c = buildCandidates(s).candidates[0];
    const steps = await execute(s, c);
    expect(calls.filter((x) => x === 'spotToFutures')).toHaveLength(1);
    expect(steps.find((x) => x.status === 'failed')?.detail).toMatch(/has not updated yet.*nothing will be sent twice/);
    await execute(s, c);
    expect(calls.filter((x) => x === 'deposit')).toHaveLength(1);
    expect(calls.filter((x) => x === 'spotToFutures')).toHaveLength(1);
  });

  it('no BNB for gas: refuses before pulling anything', async () => {
    bnb = 0n;
    const s = snap(); const c = buildCandidates(s).candidates[0];
    const steps = await execute(s, c);
    expect(steps[0]).toMatchObject({ step: 'check agent gas on BNB Chain', status: 'failed' });
    expect(steps[0].detail).toMatch(/Nothing was pulled/); expect(calls).toEqual([]);
  });

  it('USDT is deposited as is (no swap); USDC is swapped', async () => {
    // 90% used of $100 -> restore to 45% = exactly $100.00 (whole cents, so no USDC remainder is left to pull)
    const s = fixtureSnapshot({ health: { 'aster:': { connected: true, utilBps: 9000, accountUsd: 100, usedUsd: 90 } }, bsc: { usdcUsd: 0, usdtUsd: 500, bstocks: [], allowanceUsdcBase: '0', allowanceUsdtBase: '500000000' } });
    s.config.rebalance.sources = ['bsc_usdt'];
    const c = buildCandidates(s).candidates[0];
    const steps = await execute(s, c);
    expect(steps.every((x) => x.status === 'done')).toBe(true);
    expect(calls).toEqual(['pull:usdt', `approve:${ASTER_VAULT}`, 'deposit']);
    expect(deposited!.amountWei).toBe(BigInt(c.amountBaseUnit) * 10n ** 12n);
  });

  it('a perps release never tries to withdraw: the agent key cannot', async () => {
    const s = fixtureSnapshot({ health: { 'aster:': { connected: true, utilBps: 1000, accountUsd: 200, usedUsd: 20 } }, ruleState: { 'aster:': { releaseBelowSince: new Date(Date.now() - 7_200_000).toISOString() } } });
    s.config.rebalance.rules[0] = { ...s.config.rebalance.rules[0], releaseOn: true, releaseLevelBps: 2500, releaseForSec: 1800 };
    const p = buildCandidates(s);
    expect(p.candidates.filter((x) => x.kind === 'release')).toEqual([]);
    expect(p.rejected.find((r) => r.kind === 'release')).toMatchObject({ severity: 'error' });
    expect(p.rejected.find((r) => r.kind === 'release')!.reason).toMatch(/withdrawals from perps need your wallet signature in the app/);
  });
});
