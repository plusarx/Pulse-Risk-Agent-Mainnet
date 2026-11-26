import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SWAP_DEADLINE_SEC, swapDeadline } from '../src/tools/pancake';

describe('PancakeSwap sales and swaps expire (same 5 minutes as the app swap)', () => {
  it('the deadline is 300 seconds after signing', () => {
    expect(SWAP_DEADLINE_SEC).toBe(300);
    expect(swapDeadline(1_700_000_000_000)).toBe(1_700_000_300n);
  });
  it('every agent swap goes through multicall(deadline, [swap]); none calls the router directly', () => {
    const src = readFileSync(new URL('../src/tools/pancake.ts', import.meta.url), 'utf8');
    expect((src.match(/functionName: 'multicall'/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).not.toMatch(/writeContract\(\{ address: PANCAKE_SMART_ROUTER, abi: SMART_ROUTER_ABI, functionName: 'exactInput(Single)?'/);
  });
});
