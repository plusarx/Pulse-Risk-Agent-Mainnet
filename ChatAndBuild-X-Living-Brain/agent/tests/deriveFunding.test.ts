import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { BSC_USDC } from '../../lib/bsc';
import { loadConfig, resetConfigForTests } from '../src/config';
import { bridgeToEthereum, depositToNewSubaccount, fundDeriveSubaccount, waitForBridge, waitForCredit, type EthIo } from '../src/tools/deriveFunding';
import { getStatusDetail } from '../src/tools/relay';

const ROUTER = '0x4cd00e387622c35bddb9b4c962c136462338bc31';
const AGENT_BSC = '0x00000000000000000000000000000000000000aa' as Address;
const AGENT_ETH = '0x00000000000000000000000000000000000000bb' as Address;
const USER = '0x2222222222222222222222222222222222222222' as Address;
const AMOUNT_BASE = '10000000'; // 10 USDC
const WEI = 10n * 10n ** 18n;
const live = () => resetConfigForTests(loadConfig({ DRY_RUN: 'false', ALLOW_LIVE: 'yes-i-understand' }));
beforeEach(live);
afterEach(() => { resetConfigForTests(loadConfig({})); vi.unstubAllGlobals(); });

const approveData = (spender: string, amt: bigint) => encodeFunctionData({ abi: parseAbi(['function approve(address spender, uint256 amount)']), functionName: 'approve', args: [spender as Address, amt] });
const depositData = (depositor: Address, amt: bigint) => encodeFunctionData({ abi: parseAbi(['function depositErc20(address depositor, address token, uint256 amount, bytes32 id)']), functionName: 'depositErc20', args: [depositor, BSC_USDC, amt, `0x${'00'.repeat(32)}`] });

function quote(over: { router?: string; value?: string; recipient?: string; depositor?: Address; chain?: number; outChain?: number } = {}) {
  return {
    steps: [
      { id: 'approve', kind: 'transaction', requestId: 'req1', items: [{ data: { to: BSC_USDC, data: approveData(over.router ?? ROUTER, WEI), value: over.value ?? '0', chainId: over.chain ?? 56 } }] },
      { id: 'deposit', kind: 'transaction', requestId: 'req1', items: [{ data: { to: over.router ?? ROUTER, data: depositData(over.depositor ?? AGENT_BSC, WEI), value: '0', chainId: 56 } }] },
    ],
    details: { recipient: over.recipient ?? AGENT_ETH, currencyOut: { amount: '9900000', minimumAmount: '9800000', currency: { chainId: over.outChain ?? 1 } } },
  } as never;
}
const bridge = (q: unknown, execute = vi.fn(async () => ({ txHashes: ['0xb1' as Hex] }))) =>
  ({ execute, run: () => bridgeToEthereum({ depositor: AGENT_BSC, recipient: AGENT_ETH, amountBase: AMOUNT_BASE }, { getQuote: async () => q as never, execute }) });

describe('bridgeToEthereum quote validation', () => {
  it('accepts a correct quote and executes it', async () => {
    const b = bridge(quote());
    expect(await b.run()).toEqual({ requestId: 'req1', txHashes: ['0xb1'], minOutBase: '9800000' });
    expect(b.execute).toHaveBeenCalledOnce();
  });
  it.each([
    ['wrong recipient', { recipient: '0x9999999999999999999999999999999999999999' }, /recipient mismatch/],
    ['wrong router', { router: '0x1234567890123456789012345678901234567890' }, /spender|unexpected contract/],
    ['native value', { value: '1' }, /native value/],
    ['wrong origin chain', { chain: 1 }, /unexpected chain/],
    ['wrong depositor', { depositor: '0x00000000000000000000000000000000000000cc' as Address }, /calldata mismatch/],
    ['wrong destination chain', { outChain: 8453 }, /not Ethereum/],
  ])('rejects %s and never executes', async (_n, over, re) => {
    const b = bridge(quote(over));
    await expect(b.run()).rejects.toThrow(re);
    expect(b.execute).not.toHaveBeenCalled();
  });
  it('refuses below 7 USDC', async () => {
    await expect(bridgeToEthereum({ depositor: AGENT_BSC, recipient: AGENT_ETH, amountBase: '6999999' }, { getQuote: async () => quote(), execute: async () => ({ txHashes: [] }) })).rejects.toThrow(/at least 7/);
  });
});

function fakeEth(balance = 10_000_000n) {
  const log: string[] = [];
  const eth: EthIo = {
    address: AGENT_ETH, usdcBalance: async () => balance,
    approve: async (s, a) => { log.push(`approve:${s}:${a}`); return '0xap' as Hex; },
    deposit: async (a) => { log.push(`deposit:${a.amount}:${a.managerId}:${a.owner}`); return '0xdep' as Hex; },
  };
  return { eth, log };
}

describe('depositToNewSubaccount', () => {
  it('refuses below 7 USDC before touching the chain, even when live', async () => {
    const { eth, log } = fakeEth();
    await expect(depositToNewSubaccount({ n: 'mainnet', owner: USER, amountBase: '6999999', managerId: 1, eth })).rejects.toThrow(/below 7 USDC/);
    expect(log).toEqual([]);
  });
  it('approves the ActionManager then deposits for the USER as owner', async () => {
    const { eth, log } = fakeEth();
    const r = await depositToNewSubaccount({ n: 'mainnet', owner: USER, amountBase: '7000000', managerId: 4, eth });
    expect(r.txHash).toBe('0xdep');
    expect(log).toEqual([`approve:0xE366CcA474968e33b777E13905829A3b800CFAD3:7000000`, `deposit:7000000:4:${USER}`]);
  });
  it('refuses when the agent holds less than the amount', async () => {
    const { eth, log } = fakeEth(5_000_000n);
    await expect(depositToNewSubaccount({ n: 'mainnet', owner: USER, amountBase: '7000000', managerId: 1, eth })).rejects.toThrow(/holds only/);
    expect(log).toEqual([]);
  });
  it('throws when not live', async () => {
    resetConfigForTests(loadConfig({}));
    const { eth, log } = fakeEth();
    await expect(depositToNewSubaccount({ n: 'mainnet', owner: USER, amountBase: '7000000', managerId: 1, eth })).rejects.toThrow('called while not live');
    expect(log).toEqual([]);
  });
});

describe('waitForBridge / waitForCredit', () => {
  const fast = { sleep: async () => {}, attempts: 3 };
  it('reports a refund with its amount', async () => {
    await expect(waitForBridge('r', { ...fast, status: async () => ({ status: 'refund', refundAmountBase: '123', refundTxHash: '0xr' }) })).rejects.toThrow(/refunded r amount 123 tx 0xr/);
  });
  it('treats a timeout as ambiguous', async () => {
    await expect(waitForBridge('r', { ...fast, status: async () => ({ status: 'pending' }) })).rejects.toThrow(/do not re-send/);
  });
  it('finds the new subaccount after the action is applied, skipping fallback and known ids', async () => {
    let polls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const m = String(url).split('/v3/')[1];
      if (m === 'public/get_onchain_action_history') { polls++; return { ok: true, status: 200, json: async () => ({ result: { actions: [{ tx_hash: '0xDEP', status: polls < 2 ? 'instant_fallback' : 'applied' }] } }) }; }
      return { ok: true, status: 200, json: async () => ({ result: { subaccount_ids: [1, 2, 9], fallback_subaccount_id: 2 } }) };
    }));
    const creds = { subaccountId: 1, sessionKeyAddress: AGENT_ETH, sessionPrivateKey: `0x${'11'.repeat(32)}`, expiresAt: null };
    expect(await waitForCredit({ n: 'mainnet', wallet: USER, creds, txHash: '0xdep', ...fast })).toEqual({ subaccountId: 9 });
  });
});

describe('fundDeriveSubaccount orchestrator', () => {
  const creds = { subaccountId: 1, sessionKeyAddress: AGENT_ETH, sessionPrivateKey: `0x${'11'.repeat(32)}`, expiresAt: null };
  function setup(preDone: Record<string, string | boolean> = {}, fail?: string) {
    const done = new Map<string, string | boolean>(Object.entries(preDone)); const ran: string[] = [];
    const { eth } = fakeEth();
    // listSubaccounts (best effort inside the deposit step) is not mocked: it fails on the dry fetch and is ignored.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network'); }));
    const args = {
      n: 'mainnet' as const, wallet: USER, creds, amountBase: AMOUNT_BASE, managerId: 1, targetSubaccountId: 5, agentBsc: AGENT_BSC, key: 'k1',
      isDone: (s: string) => done.get(s), markDone: (s: string, ref?: string) => { done.set(s, ref ?? true); },
      deps: {
        eth,
        bridge: async () => { ran.push('bridge'); if (fail === 'bridge') throw new Error('boom'); return { requestId: 'req1', txHashes: [], minOutBase: '1' }; },
        waitBridge: async (id: string) => { ran.push(`wait:${id}`); },
        deposit: async () => { ran.push('deposit'); return { txHash: '0xdep' as Hex, approveTxHash: '0xap' as Hex }; },
        credit: async (a: { txHash: string }) => { ran.push(`credit:${a.txHash}`); return { subaccountId: 9 }; },
        consolidate: async (a: { fromSubaccountId: number; toSubaccountId: number }) => { ran.push(`consolidate:${a.fromSubaccountId}->${a.toSubaccountId}`); return { opUuid: 'op1', amountUsd: '9.9' }; },
      },
    };
    return { args, ran, done };
  }

  it('runs every step in order and records them', async () => {
    const { args, ran, done } = setup();
    const r = await fundDeriveSubaccount(args);
    expect(r.map((x) => [x.step, x.status])).toEqual([['bridge', 'done'], ['bridge_wait', 'done'], ['deposit', 'done'], ['credit', 'done'], ['consolidate', 'done']]);
    expect(ran).toEqual(['bridge', 'wait:req1', 'deposit', 'credit:0xdep', 'consolidate:9->5']);
    expect(done.get('k1:credit')).toBe('9');
  });
  it('resumes: skips finished steps and feeds their refs forward', async () => {
    const { args, ran } = setup({ 'k1:bridge': 'req1', 'k1:bridge_wait': true, 'k1:deposit': '0xdep0' });
    const r = await fundDeriveSubaccount(args);
    expect(ran).toEqual(['credit:0xdep0', 'consolidate:9->5']);
    expect(r.slice(0, 3).every((x) => x.status === 'done' && /skipped/.test(x.detail ?? ''))).toBe(true);
  });
  it('a re-run after everything finished does nothing', async () => {
    const { args, ran } = setup({ 'k1:bridge': 'r', 'k1:bridge_wait': true, 'k1:deposit': '0xd', 'k1:credit': '9', 'k1:consolidate': 'op' });
    await fundDeriveSubaccount(args);
    expect(ran).toEqual([]);
  });
  it('stops at the first failure, reports it, and marks nothing after it', async () => {
    const { args, ran, done } = setup({}, 'bridge');
    const r = await fundDeriveSubaccount(args);
    expect(r).toEqual([{ step: 'bridge', status: 'failed', detail: 'boom' }]);
    expect(ran).toEqual(['bridge']);
    expect(done.size).toBe(0);
  });
});

describe('getStatusDetail', () => {
  const stub = (j: unknown) => vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => j })));
  it('reads refund amount and tx hash when Relay names them', async () => {
    stub({ status: 'refund', refund: { amount: '9500000000000000000', txHash: `0x${'ab'.repeat(32)}` } });
    expect(await getStatusDetail('r')).toEqual({ status: 'refund', refundAmountBase: '9500000000000000000', refundTxHash: `0x${'ab'.repeat(32)}` });
  });
  it('reads details.refundCurrency.amount and refunds[0]', async () => {
    stub({ status: 'refund', details: { refundCurrency: { amount: '42' } }, refunds: [{ txHash: `0x${'cd'.repeat(32)}` }] });
    expect(await getStatusDetail('r')).toMatchObject({ refundAmountBase: '42', refundTxHash: `0x${'cd'.repeat(32)}` });
  });
  it('leaves fields undefined when the shape has none, and ignores junk', async () => {
    stub({ status: 'refund', inTxHashes: ['0x1'], txHashes: ['0x2'], refund: { amount: 'abc', txHash: 'nope' } });
    expect(await getStatusDetail('r')).toEqual({ status: 'refund', refundAmountBase: undefined, refundTxHash: undefined });
  });
  it('maps other statuses', async () => {
    stub({ status: 'success' }); expect(await getStatusDetail('r')).toEqual({ status: 'success' });
    stub({ status: 'failure' }); expect((await getStatusDetail('r')).status).toBe('failed');
    stub({ status: 'waiting' }); expect((await getStatusDetail('r')).status).toBe('pending');
  });
});
