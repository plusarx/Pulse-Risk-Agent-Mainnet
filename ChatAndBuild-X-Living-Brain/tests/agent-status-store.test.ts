import { beforeAll, describe, expect, it } from 'vitest';
import { StatusIn } from '../lib/agent-status';

const W = '0xFfa4Bcc5576995865B083224aD49da28B6a02c7A';
const S = {
  wallet: W, network: 'testnet', mode: 'confirm', modeNote: null, killSwitch: false, paused: null,
  portfolioUsd: 10_000, hedgedPct: 60, requiredHedgePct: 55, varPct: 4.2, limitPct: 5, window: 'day',
  coverage: { directPct: 60, proxyPct: 20, nonePct: 20 },
  tickers: [{ ticker: 'NVDA', bstock: 'NVDAB', usd: 5000, hedgedPct: 60, bucket: 'direct', excluded: false }],
  nextEvent: { ticker: 'NVDA', kind: 'earnings', at: '2026-11-25T20:00:00.000Z', inHours: 18 },
  lastNewsScanAt: null, newsFlags: [],
  limitsUsed: { notionalTodayUsd: 0, maxNotionalPerDayUsd: 20000, lossTodayUsd: 0, dailyLossCapUsd: 1000, capitalOffBnbUsd: 0, maxCapitalOffBnbUsd: 10000, autonomyExpiresAt: null },
  monitored: ['Lighter equity perps'], notMonitored: ['Off-hours gaps'], alerts: [], takenAt: '2026-11-24T10:00:00.000Z',
};

let store: typeof import('../lib/server/agent-status');
beforeAll(async () => { process.env.DB_PATH = ':memory:'; store = await import('../lib/server/agent-status'); });

describe('agent status store', () => {
  it('returns null before the agent reports', () => {
    expect(store.readStatus(W, 'testnet')).toBeNull();
  });
  it('writes and reads back a snapshot', () => {
    store.writeStatus(S as never);
    const r = store.readStatus(W, 'testnet')!;
    expect(r.status.portfolioUsd).toBe(10_000);
    expect(r.updated_at).toBeGreaterThan(0);
    expect(store.readStatus(W, 'mainnet')).toBeNull();
  });
  it('lowercases the wallet and replaces the previous snapshot', () => {
    store.writeStatus({ ...S, mode: 'autonomous', portfolioUsd: 12_345 } as never);
    expect(store.readStatus(W.toLowerCase(), 'testnet')!.status).toMatchObject({ mode: 'autonomous', portfolioUsd: 12_345 });
    expect(store.readStatus(W.toUpperCase().replace('0X', '0x'), 'testnet')).not.toBeNull();
  });
});

describe('StatusIn schema', () => {
  it('accepts a valid payload', () => { expect(StatusIn.safeParse(S).success).toBe(true); });
  it('rejects a bad wallet, mode, bucket and takenAt', () => {
    expect(StatusIn.safeParse({ ...S, wallet: '0x123' }).success).toBe(false);
    expect(StatusIn.safeParse({ ...S, mode: 'yolo' }).success).toBe(false);
    expect(StatusIn.safeParse({ ...S, tickers: [{ ...S.tickers[0], bucket: 'maybe' }] }).success).toBe(false);
    expect(StatusIn.safeParse({ ...S, takenAt: 'yesterday' }).success).toBe(false);
  });
  it('rejects a missing required field', () => {
    const { killSwitch: _k, ...rest } = S; void _k;
    expect(StatusIn.safeParse(rest).success).toBe(false);
  });
});
