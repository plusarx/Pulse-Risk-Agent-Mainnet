import { DEFAULT_CONFIG, type AgentConfig } from '../../lib/agent-config';
import { defaultRule } from '../../lib/risk-rules';
import type { Snapshot } from './types';

export const WALLET = '0x1111111111111111111111111111111111111111';

/** A made-up wallet whose perps (Aster) account is at 82% utilization (trigger 70%) with $500 USDC on BNB. */
export function fixtureSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  const rule = { ...defaultRule('aster'), triggerBps: 7000, targetBps: 4500, maxPerMoveBaseUnit: '500000000', dailyCapBaseUnit: '2000000000', minMoveBaseUnit: '6000000', cooldownSec: 600 };
  const config: AgentConfig = structuredClone({ ...DEFAULT_CONFIG, mode: 'autonomous', rebalance: { ...DEFAULT_CONFIG.rebalance, enabled: true, rules: [rule], sources: ['bsc_usdc'], keepBscReserveBaseUnit: '10000000' } } as AgentConfig);
  return {
    wallet: WALLET, network: 'testnet', takenAt: new Date().toISOString(), config, ruleState: {},
    health: { 'aster:': { connected: true, utilBps: 8200, accountUsd: 100, usedUsd: 82 } },
    perpPositions: {}, bsc: { usdcUsd: 500, usdtUsd: 0, bstocks: [], allowanceUsdcBase: '300000000' },
    dataQuality: [], moved24hBase: { 'aster:': '0' }, ...over,
  };
}
