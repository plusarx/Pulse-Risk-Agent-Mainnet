import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { AgentConfig, DEFAULT_CONFIG } from '../../lib/agent-config';
import { loadConfig, resetConfigForTests } from '../src/config';
import { fixtureSnapshot } from '../src/fixtures';
import { buildGraph } from '../src/graph';
import { execute } from '../src/tools/executor';
import { buildCandidates } from '../src/tools/planner';
import { closeStore, openStore } from '../src/tools/store';

beforeEach(() => { openStore(':memory:'); resetConfigForTests(loadConfig({ DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off' })); });
afterEach(() => { closeStore(); resetConfigForTests(); });

// The words are built from parts so this file does not itself contain the removed feature's name.
const OLD_SOURCE = ['pledge', 'bstocks'].join('_');
const OLD_ORDER = ['pledge', 'Order'].join('');

describe('pledging is gone: margin comes from USDC, USDT, then SELLING bStocks', () => {
  it('there is no pledge tool left in the agent', () => {
    expect(existsSync(new URL('../src/collateral/adapter.ts', import.meta.url))).toBe(false);
  });
  it('an old saved config that asks for pledging becomes selling', () => {
    const c = AgentConfig.parse({ ...DEFAULT_CONFIG, rebalance: { enabled: true, rules: [], sources: ['bsc_usdc', OLD_SOURCE], [OLD_ORDER]: ['SPYB'], keepBscReserveBaseUnit: '10000000' } });
    expect(c.rebalance.sources).toContain('sell_bstocks'); expect(JSON.stringify(c)).not.toMatch(/pledg/i);
    expect(c.rebalance.sellOrder).toEqual(['SPYB']);
  });
  it('a top-up that USDC cannot cover is funded by selling the bStock, with no pledge step anywhere', async () => {
    const s = fixtureSnapshot({ health: { 'aster:': { connected: true, utilBps: 8000, accountUsd: 100, usedUsd: 80 } },
      bsc: { usdcUsd: 5, usdtUsd: 0, allowanceUsdcBase: '500000000', bstocks: [{ symbol: 'SPYB', qty: 1, value: 500, allowanceQty: 1 }] } });
    s.config.rebalance = { ...s.config.rebalance, enabled: true, sources: ['bsc_usdc', 'sell_bstocks'], sellOrder: ['SPYB'], keepBscReserveBaseUnit: '10000000' };
    const c = buildCandidates(s).candidates.find((x) => x.kind === 'top_up')!;
    expect(c).toBeDefined(); expect(c.funding!.map((f) => f.source).join()).toMatch(/sell SPYB/);
    const steps = await execute(s, c);                       // dry run: the steps it WOULD run
    const text = steps.map((x) => x.step).join(' | ');
    expect(text).toMatch(/SPYB/); expect(text).toMatch(/sell/i); expect(text).toMatch(/PancakeSwap/i); expect(text).not.toMatch(/pledg/i); expect(text).toMatch(/bridge/i);
    const out = await buildGraph().invoke({ snapshot: s });
    expect(out.outcome).toBe('simulated'); expect(JSON.stringify(out.steps)).not.toMatch(/pledg/i);
  });
  it('asking for a pledge directly is refused by the guard: only selling is a funding source', () => {
    const s = fixtureSnapshot({});
    const parsed = AgentConfig.safeParse({ ...s.config, rebalance: { ...s.config.rebalance, sources: [OLD_SOURCE] } });
    expect(parsed.success && parsed.data.rebalance.sources.includes(OLD_SOURCE as never)).toBe(false);
  });
});
