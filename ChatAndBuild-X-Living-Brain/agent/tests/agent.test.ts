import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigForTests } from '../src/config';
import { fixtureSnapshot } from '../src/fixtures';
import { buildGraph } from '../src/graph';
import { setLlmRunner } from '../src/llm/run';
import { buildCandidates } from '../src/tools/planner';
import { checkCandidate } from '../src/tools/guard';
import { closeStore, logMove, openStore } from '../src/tools/store';
import { LLM_NODES, systemPrompt } from '../src/llm/prompts';

const env = (o: Record<string, string> = {}) => resetConfigForTests(loadConfig({ DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off', ...o }));

beforeEach(() => { openStore(':memory:'); env(); });
afterEach(() => { closeStore(); setLlmRunner(); resetConfigForTests(); });

describe('planner + guard', () => {
  it('makes one top-up candidate when utilization is above the trigger', () => {
    const { candidates } = buildCandidates(fixtureSnapshot());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].kind).toBe('top_up');
    expect(BigInt(candidates[0].amountBaseUnit)).toBeGreaterThanOrEqual(6_000_000n);
  });
  it('makes nothing when inside the band', () => {
    const s = fixtureSnapshot({ health: { 'aster:': { connected: true, utilBps: 5000, accountUsd: 100, usedUsd: 50 } } });
    expect(buildCandidates(s).candidates).toHaveLength(0);
  });
  it('guard refuses any move when data quality is bad', () => {
    const s = fixtureSnapshot();
    const c = buildCandidates(s).candidates[0];
    expect(checkCandidate(c, { ...s, dataQuality: ['no price'] })).toMatch(/data quality/);
  });
  it('guard refuses above the allowance and during cooldown and over the 24h cap', () => {
    const s = fixtureSnapshot(); const c = buildCandidates(s).candidates[0];
    expect(checkCandidate(c, { ...s, bsc: { ...s.bsc, allowanceUsdcBase: '1000000' } })).toMatch(/allowance/);
    expect(checkCandidate(c, { ...s, ruleState: { 'aster:': { lastMoveAt: new Date().toISOString() } } })).toMatch(/cooling/);
    expect(checkCandidate(c, { ...s, moved24hBase: { 'aster:': '1999999999' } })).toMatch(/24h/);
  });
  it('guard refuses USDT funding (no allowance check yet) and bStocks the user did not allow', () => {
    const s = fixtureSnapshot(); const c = buildCandidates(s).candidates[0];
    expect(checkCandidate({ ...c, funding: [{ source: 'bsc_usdt', amountUsd: 10 }] }, s)).toMatch(/USDT allowance/);
    expect(checkCandidate({ ...c, funding: [{ source: 'sell NVDAB', amountUsd: 10 }] }, s)).toMatch(/not in the list/);
  });
});

describe('graph (LLM off, dry run)', () => {
  it('simulates the top-up and moves nothing', async () => {
    const out = await buildGraph().invoke({ snapshot: fixtureSnapshot() });
    expect(out.outcome).toBe('simulated');
    expect(out.steps.every((x) => x.status === 'simulated')).toBe(true);
    expect(out.steps.length).toBeGreaterThan(1);
  });
  it('fails closed on bad data and runs no steps', async () => {
    const out = await buildGraph().invoke({ snapshot: fixtureSnapshot({ dataQuality: ['perps account unreadable'] }) });
    expect(out.outcome).toBe('error');
    expect(out.steps).toHaveLength(0);
  });
  it('ends quietly with no candidates', async () => {
    const out = await buildGraph().invoke({ snapshot: fixtureSnapshot({ health: { 'aster:': { connected: true, utilBps: 5000, accountUsd: 100, usedUsd: 50 } } }) });
    expect(out.outcome).toBe('idle');
  });
  it('respects the in-flight lock across runs', async () => {
    const s = fixtureSnapshot();
    const { acquireLock } = await import('../src/tools/store');
    acquireLock(`${s.wallet.toLowerCase()}:${s.network}:aster:`);
    const out = await buildGraph().invoke({ snapshot: s });
    expect(out.outcome).toBe('idle'); // guard filter drops it at plan time
    logMove(s.wallet, s.network, 'aster:', 'in', '1');
  });
});

describe('graph with LLM nodes (fake runner)', () => {
  it('runs analyst → decider → reviewer → execute when all agree', async () => {
    env({ LLM_MODE: 'on', OPENROUTER_API_KEY: 'x' });
    const seen: string[] = [];
    setLlmRunner(async (node, _schema, input) => {
      seen.push(node);
      const i = input as { candidates?: { id: string }[] };
      if (node === 'analyst') return { dataLooksSane: true, concerns: [], summary: 'ok' } as never;
      if (node === 'decider') return { action: 'execute', candidateId: i.candidates![0].id, reason: 'utilization above trigger' } as never;
      if (node === 'reviewer') return { verdict: 'approve', reason: 'fine' } as never;
      return { message: 'Dry run: would add margin.' } as never;
    });
    const out = await buildGraph().invoke({ snapshot: fixtureSnapshot() });
    expect(seen).toEqual(['analyst', 'decider', 'reviewer', 'reporter']);
    expect(out.outcome).toBe('simulated');
    expect(out.message).toBe('Dry run: would add margin.');
  });
  it('a reviewer flag is shown but never stops the action', async () => {
    env({ LLM_MODE: 'on', OPENROUTER_API_KEY: 'x' });
    setLlmRunner(async (node) => {
      if (node === 'analyst') return { dataLooksSane: false, concerns: ['looks odd'], summary: 'ok' } as never;
      if (node === 'decider') return { action: 'skip', reason: 'I would rather wait' } as never;
      if (node === 'reviewer') return { verdict: 'veto', reason: 'amount too large' } as never;
      return { message: 'Done.' } as never;
    });
    const out = await buildGraph().invoke({ snapshot: fixtureSnapshot() });
    expect(out.outcome).toBe('simulated');
    expect(out.chosen?.kind).toBe('top_up');
    expect(out.review?.verdict).toBe('veto');
    expect(out.steps.length).toBeGreaterThan(0);
  });
  it('the model cannot pick or resize: a made-up id or amount changes nothing', async () => {
    env({ LLM_MODE: 'on', OPENROUTER_API_KEY: 'x' });
    setLlmRunner(async (node) => {
      if (node === 'analyst') return { dataLooksSane: true, concerns: [], summary: 'ok' } as never;
      if (node === 'decider') return { action: 'execute', candidateId: 'made-up', reason: 'x' } as never;
      return { verdict: 'approve', reason: 'ok', message: 'ok' } as never;
    });
    const out = await buildGraph().invoke({ snapshot: fixtureSnapshot() });
    expect(out.outcome).toBe('simulated');
    expect(out.chosen?.id).toBe(buildCandidates(fixtureSnapshot()).candidates[0].id);
  });
  it('the same inputs give the same action with or without the model', async () => {
    const off = await buildGraph().invoke({ snapshot: fixtureSnapshot() });
    env({ LLM_MODE: 'on', OPENROUTER_API_KEY: 'x' });
    setLlmRunner(async (node) => (node === 'analyst' ? { dataLooksSane: true, concerns: [], summary: 's' } : node === 'decider' ? { action: 'execute', reason: 'r' } : node === 'reviewer' ? { verdict: 'approve', reason: 'ok' } : { message: 'm' }) as never);
    const on = await buildGraph().invoke({ snapshot: fixtureSnapshot() });
    expect(on.chosen?.id).toBe(off.chosen?.id);
    expect(on.chosen?.amountBaseUnit).toBe(off.chosen?.amountBaseUnit);
  });
  it('a model outage does not block a correct move', async () => {
    env({ LLM_MODE: 'on', OPENROUTER_API_KEY: 'x' });
    setLlmRunner(async () => { throw new Error('boom'); });
    const out = await buildGraph().invoke({ snapshot: fixtureSnapshot() });
    expect(out.outcome).toBe('simulated');
    expect(out.steps.length).toBeGreaterThan(0);
  });
});

describe('prompts', () => {
  it('every LLM node has a system prompt that includes the shared rules', () => {
    for (const n of LLM_NODES) expect(systemPrompt(n)).toContain('Shared rules');
  });
});
