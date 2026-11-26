// Local end-to-end check of the backend against a running server (npm start). Uses a throwaway key.
// Usage: node tests/e2e-api.mjs   (reads AGENT_API_TOKEN from .env.local; nothing is sent on chain)
import { readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const B = process.env.BASE ?? 'http://localhost:3100';
// Lighter checks can target mainnet while Lighter testnet is down: LIGHTER_NET=mainnet node tests/e2e-api.mjs
const LN = process.env.LIGHTER_NET ?? 'testnet';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const acct = privateKeyToAccount(generatePrivateKey());
let cookie = '';
const req = async (path, init = {}) => {
  const r = await fetch(B + path, { ...init, headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) } });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
};
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) failed++; };
const post = (body, headers = {}) => ({ method: 'POST', body: JSON.stringify(body), headers });

const n1 = await req('/api/auth/nonce', post({ address: acct.address }));
const badSig = await acct.signMessage({ message: 'something else' });
check('bad signature rejected', (await req('/api/auth/verify', post({ address: acct.address, signature: badSig }))).status === 401);
const replay = await req('/api/auth/verify', post({ address: acct.address, signature: await acct.signMessage({ message: n1.body.message }) }));
check('nonce is single-use', replay.status === 401);
const n2 = await req('/api/auth/nonce', post({ address: acct.address }));
const v = await req('/api/auth/verify', post({ address: acct.address, signature: await acct.signMessage({ message: n2.body.message }) }));
check('sign-in', v.status === 200 && v.body.address === acct.address);
check('me', (await req('/api/auth/me')).body.address === acct.address);

const cfg = (await req('/api/agent/config?network=testnet')).body.config;
cfg.rebalance.enabled = true;
cfg.hedge.legs.push({ bstock: 'NVDAB', venue: 'lighter', market: 'NVDA', marketId: 110, hedgeRatio: 1 });
const rule = {
  venue: 'lighter', accountRef: '', accountLabel: null, mode: 'utilization', triggerBps: 7000, targetBps: 4500, triggerBaseUnit: null, targetBaseUnit: null, topUpOnce: true,
  releaseOn: true, releaseLevelBps: 2500, releaseLevelBaseUnit: null, releaseForSec: 1800, releaseTargetBps: null, releaseTargetBaseUnit: null, releaseOnce: false,
  maxPerMoveBaseUnit: '500000000', dailyCapBaseUnit: '2000000000', minMoveBaseUnit: '6000000', cooldownSec: 600, enabled: true,
};
cfg.rebalance.rules = [rule];
const saved = await req('/api/agent/config?network=testnet', { method: 'PUT', body: JSON.stringify(cfg) });
check('save config with a rule', saved.status === 200 && saved.body.config.rebalance.rules.length === 1, saved.body?.error ?? '');
const bad = structuredClone(cfg);
bad.rebalance.rules[0].targetBps = 9000;
const rej = await req('/api/agent/config?network=testnet', { method: 'PUT', body: JSON.stringify(bad) });
check('invalid rule rejected with reason', rej.status === 400 && /target must be below/.test(rej.body.error), rej.body.error);
const dup = structuredClone(cfg); dup.rebalance.rules.push(rule);
check('duplicate account rule rejected', (await req('/api/agent/config?network=testnet', { method: 'PUT', body: JSON.stringify(dup) })).status === 400);
const lowMin = structuredClone(cfg); lowMin.rebalance.rules[0].minMoveBaseUnit = '1000000';
check('below-venue-floor minimum rejected', (await req('/api/agent/config?network=testnet', { method: 'PUT', body: JSON.stringify(lowMin) })).status === 400);

const lp = await req('/api/agent/register/lighter', post({ network: LN, step: 'prepare' }));
check('lighter prepare without account fails cleanly', lp.status === 400 && /deposit first/i.test(lp.body.error), lp.body.error);
const dp = await req('/api/agent/register/derive', post({ network: 'testnet', step: 'prepare' }));
check('derive prepare without account fails cleanly', dp.status === 400 && /deposit first/i.test(dp.body.error), dp.body.error);
const order = await req('/api/trade/lighter', post({ network: LN, action: 'order', marketId: LN === 'testnet' ? 4095 : 1, side: 'buy', type: 'market', size: '0.01', price: '1' }, { 'idempotency-key': 'test-1234' }));
check('order without agent key refused', order.status === 400 && /agent key/i.test(order.body.error), order.body.error);
check('order without idempotency key refused', (await req('/api/trade/lighter', post({}))).status === 400);
// Withdraw path: validation and key checks only (this wallet has no funds or keys, so nothing can move).
const W = (body, headers = { 'idempotency-key': `wd-${Date.now()}` }) => req('/api/trade/withdraw', post({ network: LN, ...body }, headers));
check('withdraw without idempotency key refused', (await W({ venue: 'lighter', amount: '5' }, {})).status === 400);
check('withdraw bad amount refused', /USDC decimal/.test((await W({ venue: 'lighter', amount: '5.1234567' })).body.error));
check('withdraw unknown venue refused', /venue must be/.test((await W({ venue: 'evil', amount: '5' })).body.error));
check('derive withdraw needs a subaccount', /subaccountId required/.test((await W({ venue: 'derive', amount: '5' })).body.error));
check('derive withdraw below minimum refused', /at least 5 USDC/.test((await W({ venue: 'derive', amount: '2', subaccountId: 1 })).body.error ?? ''));
const lw = await W({ venue: 'lighter', amount: '5' });
check('lighter withdraw without agent key refused', lw.status === 400 && /agent key/i.test(lw.body.error), lw.body.error);
const wh = await req(`/api/trade/withdraw?network=${LN}&venue=lighter`);
check('withdraw history without agent key refused', wh.status === 400 && /agent key/i.test(wh.body.error), wh.body.error);
const da = await req('/api/trade/derive-account?network=testnet');
const la = await req(`/api/trade/lighter-accounts?network=${LN}`);
check('lighter account list (none yet)', la.status === 200 && Array.isArray(la.body.accounts) && la.body.accounts.length === 0, JSON.stringify(la.body).slice(0, 100));
const lc = await req('/api/trade/lighter-accounts', post({ network: LN, action: 'create' }, { 'idempotency-key': 'test-create-1' }));
check('create sub-account needs agent key', lc.status === 400 && /agent key/i.test(lc.body.error), lc.body.error);
const lm = await req('/api/trade/lighter-accounts', post({ network: LN, action: 'move', from: 1, to: 2, amount: '5' }, { 'idempotency-key': 'test-move-1' }));
check('move refuses accounts you do not own', lm.status === 400 && /not yours/.test(lm.body.error), lm.body.error);
check('derive account state', da.body.state === 'no_account', JSON.stringify(da.body));

// Relay quotes (mainnet, quote only)
const q = await req('/api/relay/quote', post({ route: 'bsc_to_eth', amount: '25000000000000000000' }));
check('relay quote validated', q.status === 200 && q.body.steps.length >= 1 && q.body.steps.every((s) => s.chainId === 56),
  `out=${q.body?.amountOut} min=${q.body?.minOut} fee=$${q.body?.feeUsd} steps=${q.body?.steps?.map((s) => s.id)} ${q.body?.error ?? ''}`);
const ql = await req('/api/relay/quote', post({ route: 'bsc_to_lighter', amount: '25000000000000000000' }));
check('relay to lighter needs an account', ql.status === 400, ql.body?.error);

// Agent service API
const A = { authorization: `Bearer ${env.AGENT_API_TOKEN}` };
check('agent wrong token 401', (await req('/api/agent/v1/wallets?network=testnet', { headers: { authorization: 'Bearer nope-nope-nope-nope-nope-nope' } })).status === 401);
const w = await req('/api/agent/v1/wallets?network=testnet', { headers: A });
check('agent lists wallet', w.body.wallets.some((x) => x.wallet === acct.address.toLowerCase() && x.config.hedge.legs.length === 1));
const ev = { wallet: acct.address, network: 'testnet', kind: 'rebalance', venue: 'lighter', status: 'done', message: 'test top-up $10', idempotencyKey: 'evt-abcdef-1' };
check('agent posts event', (await req('/api/agent/v1/events', post(ev, A))).body.duplicate === false);
check('event idempotent', (await req('/api/agent/v1/events', post(ev, A))).body.duplicate === true);
check('user sees event', (await req('/api/agent/events?network=testnet')).body.events.length === 1);
const st = await req('/api/agent/v1/rule-state', post({ wallet: acct.address, network: 'testnet', ruleKey: 'lighter:', topUpDoneAt: new Date().toISOString(), lastOutcome: 'topped-up', lastOutcomeMsg: 'Topped up $25 from BNB USDC' }, A));
check('agent writes rule state', st.status === 200 && !!st.body.state.topUpDoneAt && !!st.body.state.lastOutcomeAt, JSON.stringify(st.body).slice(0, 120));
check('agent rule state rejects bad key', (await req('/api/agent/v1/rule-state', post({ wallet: acct.address, network: 'testnet', ruleKey: 'evil' }, A))).status === 400);
check('user sees rule state', !!(await req('/api/agent/rule-state?network=testnet')).body.states['lighter:']?.topUpDoneAt);
const re = await req('/api/agent/rule-state', post({ network: 'testnet', ruleKey: 'lighter:', action: 'rearm' }));
check('user re-arms (clears done, keeps outcome)', re.status === 200 && re.body.state.topUpDoneAt === null && re.body.state.lastOutcome === 'topped-up');
check('agent config exposes rules', (await req(`/api/agent/v1/config?wallet=${acct.address}&network=testnet`, { headers: A })).body.config.rebalance.rules[0].triggerBps === 7000);
check('credentials 404 without key', (await req(`/api/agent/v1/credentials?wallet=${acct.address.toLowerCase()}&venue=lighter&network=testnet`, { headers: A })).status === 404);
await req('/api/auth/logout', { method: 'POST' });
check('logout', (await req('/api/agent/keys')).status === 401);

console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exitCode = failed ? 1 : 0;
