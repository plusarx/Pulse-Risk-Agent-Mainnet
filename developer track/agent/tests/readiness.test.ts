import { describe, expect, it } from 'vitest';
import { defaultRule } from '../../lib/risk-rules';
import { fixtureSnapshot } from '../src/fixtures';
import { readinessAlerts, type ReadinessEnv } from '../src/readiness';
import { buildStatus } from '../src/status';

const ok: ReadinessEnv = { live: true, agentBsc: '0x000000000000000000000000000000000000aBcD', agentBnbWei: 10n ** 16n, agentEthWei: 10n ** 16n };
const funded = () => { const s = fixtureSnapshot(); s.bsc.allowanceUsdcBase = '100000000'; return s; };

describe('readiness alerts: what stops Auto mode from acting, each with its fix', () => {
  it('nothing to say when everything is in place', () => {
    expect(readinessAlerts(funded(), ok)).toEqual([]);
  });
  it('dry run in Auto mode', () => {
    expect(readinessAlerts(funded(), { ...ok, live: false })[0]).toMatch(/Auto mode is on, but the agent is in dry run.*DRY_RUN=false/);
  });
  it('agent BNB gas low, and missing agent wallet', () => {
    expect(readinessAlerts(funded(), { ...ok, agentBnbWei: 0n }).join()).toMatch(/0\.00000 BNB.*Send a little BNB/);
    expect(readinessAlerts(funded(), { ...ok, agentBsc: null }).join()).toMatch(/no BNB Chain wallet/);
  });
  it('an unreadable balance raises no alert', () => {
    expect(readinessAlerts(funded(), { ...ok, agentBnbWei: null, agentEthWei: null })).toEqual([]);
  });
  it('no budget for top-ups', () => {
    const s = funded(); s.bsc.allowanceUsdcBase = '0';
    expect(readinessAlerts(s, ok).join()).toMatch(/No budget for top-ups.*\$6\.00/);
  });
  it('Derive rule: ETH gas and the $8 minimum', () => {
    const s = funded(); s.config.rebalance.rules.push({ ...defaultRule('derive'), enabled: true, minMoveBaseUnit: '5000000' });
    const a = readinessAlerts(s, { ...ok, agentEthWei: 0n }).join('\n');
    expect(a).toMatch(/ETH there and needs about 0\.0003 ETH/);
    expect(a).toMatch(/minimum move under \$8\.00/);
  });
  it('a hedge below the perps venue\'s $5 minimum order', () => {
    const s = funded(); s.config.hedge.enabled = true;
    s.config.hedge.legs = [{ bstock: 'NVDAB', venue: 'aster', kind: 'perp', market: 'NVDA', hedgeRatio: 1 }] as typeof s.config.hedge.legs;
    s.bsc.bstocks = [{ symbol: 'NVDAB', qty: 0.03, value: 4 }];
    expect(readinessAlerts(s, ok).join()).toMatch(/NVDA: your NVDAB is \$4\.00.*\$5\.00 minimum/);
  });
  it('a missing venue account', () => {
    const s = funded(); s.venueProblems = { aster: 'no API key registered' };
    expect(readinessAlerts(s, ok).join()).toMatch(/Perps: no API key registered\. Register it/);
  });
  it('quiet when the agent has nothing to do', () => {
    const s = funded(); s.config.rebalance.enabled = false; s.config.hedge.enabled = false;
    expect(readinessAlerts(s, { ...ok, live: false, agentBnbWei: 0n })).toEqual([]);
  });
  it('reaches the status the app shows', () => {
    expect(buildStatus(funded(), { readiness: { ...ok, live: false } }).alerts.join()).toMatch(/Needs your attention: Auto mode is on/);
  });
});
