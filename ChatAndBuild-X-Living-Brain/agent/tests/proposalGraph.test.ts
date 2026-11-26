import { beforeAll, describe, expect, it } from 'vitest';
import { buildProposalGraph, setProposalSubmitter } from '../src/graph/proposal';
import { setLlmRunner } from '../src/llm/run';

const market = { vol1h: 0.041, latencySec: 18, leverage: 12, utilNow: 0.55, equityUsd: 10_000, usedUsd: 5_500, bnbStablesUsd: 0, bstocksAfterHaircutUsd: 7_000 };
const input = (m = market) => ({ wallet: '0x1111111111111111111111111111111111111111', network: 'testnet' as const, account: { venue: 'aster' as const, accountRef: '', equityUsd: 10_000, usedUsd: 5_500, positions: [{ symbol: 'ETH', valueUsd: 66_000 }] }, market: m });

describe('proposal graph', () => {
  beforeAll(() => { setProposalSubmitter(null); setLlmRunner(async () => ({ structural_risk: 'risk text', reasoning: 'why text' }) as never); });
  it('fits the spec scenario and keeps code-set numbers', async () => {
    const out = await buildProposalGraph().invoke({ input: input() });
    expect(out.status).toBe('dry');
    expect(out.proposal!.proposed_rule).toMatchObject({ top_up_trigger: 0.69, restore_target: 0.52, release_trigger: 0.32, primary_source: 'bstocks_bnb' });
    expect(out.proposal!.reasoning).toBe('why text');
  });
  it('fails closed on missing volatility', async () => {
    const out = await buildProposalGraph().invoke({ input: input({ ...market, vol1h: NaN }) });
    expect(out.status).toBe('error');
    expect(out.proposal).toBeNull();
  });
});
