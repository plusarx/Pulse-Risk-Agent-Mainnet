import { describe, expect, it } from 'vitest';
import { StatusIn } from '../../lib/agent-status';
import { fixtureSnapshot } from '../src/fixtures';
import { buildLastRun, buildStatus } from '../src/status';

const out = (o: Partial<Parameters<typeof buildLastRun>[1] & object>) => ({ outcome: 'idle', chosen: null, candidates: [], rejected: [], ...o }) as Parameters<typeof buildLastRun>[1];

describe('latest run posted every tick', () => {
  it('ask-first: an awaiting hedge says it waits for the user', () => {
    const s = fixtureSnapshot({ health: {} });
    const r = buildLastRun(s, out({ outcome: 'awaiting', chosen: { kind: 'hedge', ruleKey: 'k', amountBaseUnit: '0', hedge: { market: 'XAU', deltaToShort: 5 } } as never, candidates: [{ explain: 'Sell 5 XAU' }] }), 0, false);
    expect(r.decision).toBe('Sell (short) 5 XAU');
    expect(r.next).toMatch(/waiting for your Approve/);
    expect(r.live).toBe(false);
  });
  it('autonomous dry run says nothing was sent; autonomous done says it ran', () => {
    const s = fixtureSnapshot({ health: {} });
    expect(buildLastRun(s, out({ outcome: 'simulated' }), 0, false).next).toMatch(/dry-run/);
    expect(buildLastRun(s, out({ outcome: 'done' }), 0, true).next).toMatch(/ran this on its own/);
  });
  it('an approved request that ran is reported, and idle says no action', () => {
    const s = fixtureSnapshot({ health: {} });
    expect(buildLastRun(s, null, 2, true).decision).toBe('Ran 2 requests you approved');
    expect(buildLastRun(s, out({}), 0, true).decision).toBe('No action');
  });
  it('the status that carries it still passes the app schema', () => {
    const s = fixtureSnapshot({ health: {} });
    const st = buildStatus(s, { run: buildLastRun(s, out({ outcome: 'awaiting', chosen: { kind: 'hedge', ruleKey: 'k', amountBaseUnit: '0', hedge: { market: 'XAU', deltaToShort: -3 } } as never }), 0, false) });
    expect(StatusIn.safeParse(st).success).toBe(true);
    expect(st.lastRun?.feed.bnbUsdc).toBeTypeOf('number');
  });
});
