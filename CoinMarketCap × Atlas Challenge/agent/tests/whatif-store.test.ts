import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig, resetConfigForTests } from '../src/config';
import { runWhatIf, withScratchStore } from '../src/chat/whatif';
import { sampleSnapshot } from '../src/chat/sample';
import * as store from '../src/tools/store';

// Regression: a what-if used to close the chat's shared store, so the next live read failed with "store not opened"
// (seen live 2026-11-25 after asking the chat for a hedge recommendation). Live reads now run in withScratchStore.
describe('what-if never breaks the next live read', () => {
  beforeEach(() => resetConfigForTests(loadConfig({ ...process.env, DRY_RUN: 'true', POST_EVENTS: 'false', LLM_MODE: 'off', APP_API_URL: 'http://127.0.0.1:9', AGENT_API_TOKEN: 'x' })));
  const W = '0x1111111111111111111111111111111111111111';
  const read = () => withScratchStore(async () => [store.notional24h(W, 'mainnet'), store.moved24h(W, 'mainnet', 'aster:')]);

  it('a live read after a what-if works', async () => {
    await expect(read()).resolves.toBeDefined();
    await runWhatIf(sampleSnapshot(W, 'mainnet'));
    await expect(read()).resolves.toBeDefined();
  }, 60_000);

  it('what-ifs and reads interleaved (as concurrent chat messages would) all work', async () => {
    const all = await Promise.all([runWhatIf(sampleSnapshot(W, 'mainnet')), read(), runWhatIf(sampleSnapshot(W, 'mainnet')), read()]);
    expect(all).toHaveLength(4);
    await expect(read()).resolves.toBeDefined();
  }, 60_000);
});
