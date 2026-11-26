import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverAddress, verifyMessage, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { actionDigest, encodeWithdrawData } from '../../lib/derive-codec';
import { DERIVE_MODULES, DERIVE_USDC_ASSET } from '../../lib/venues';
import { loadConfig, resetConfigForTests } from '../src/config';
import { authHeaders, hedgePositions, placeOrder, withdrawToOwner, withdrawals, transferSpot } from '../src/tools/derive';

// Every Derive call is a mocked fetch. Nothing touches a network.

const session = privateKeyToAccount('0x1111111111111111111111111111111111111111111111111111111111111111');
const owner = privateKeyToAccount('0x2222222222222222222222222222222222222222222222222222222222222222').address;
const creds = { subaccountId: 1, sessionKeyAddress: session.address, sessionPrivateKey: '0x1111111111111111111111111111111111111111111111111111111111111111', expiresAt: null };
const live = () => resetConfigForTests(loadConfig({ DRY_RUN: 'false', ALLOW_LIVE: 'yes-i-understand' }));
const dry = () => resetConfigForTests(loadConfig({}));

interface Sub { subaccount_id: number; manager_id: number; initial_margin: string; collaterals_value: string; is_under_liquidation?: boolean; usdc?: string; positions?: { instrument_name: string; amount: string }[] }
let subs: Sub[]; let inst: Record<string, string | boolean | number>; let ticker: Record<string, string>;
let sent: { method: string; body: Record<string, unknown>; headers: Record<string, string> }[];

beforeEach(() => {
  sent = [];
  subs = [
    { subaccount_id: 1, manager_id: 1, initial_margin: '50', collaterals_value: '100', usdc: '100', positions: [] },
    { subaccount_id: 2, manager_id: 0, initial_margin: '0', collaterals_value: '0', usdc: '0' },
  ];
  inst = { instrument_name: 'ETH-PERP', base_asset_address: '0x3333333333333333333333333333333333333333', base_asset_sub_id: '0', tick_size: '0.1', amount_step: '0.01', minimum_amount: '0.1', base_fee: '0.1', taker_fee_rate: '0.0005', is_active: true, risk_universe_id: 1 };
  ticker = { b: '100', a: '101', I: '100.5', M: '100.5', minp: '90', maxp: '103' };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string; headers: Record<string, string> }) => {
    const method = String(url).split('/v3/')[1];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    sent.push({ method, body, headers: init.headers });
    const ok = (result: unknown) => ({ ok: true, status: 200, json: async () => ({ result }) });
    switch (method) {
      case 'public/get_instrument': return ok(inst);
      case 'public/get_ticker': return ok(ticker);
      case 'public/get_risk_universes': return ok([{ risk_universe_id: 1, name: 'PRIME', managers: [{ manager_id: 1, margin_type: 'SM', instruments: ['ETH-PERP'] }] }]);
      case 'private/get_account': return ok({ subaccount_ids: subs.map((s) => s.subaccount_id), fallback_subaccount_id: 2 });
      case 'private/get_subaccount': { const s = subs.find((x) => x.subaccount_id === body.subaccount_id)!; return ok({ ...s, is_under_liquidation: !!s.is_under_liquidation, collaterals: [{ asset_name: 'USDC', amount: s.usdc ?? '0' }], positions: s.positions ?? [] }); }
      case 'private/order': return ok({ order: { order_id: 'o1', order_status: 'filled', filled_amount: '1.23', average_price: '101' } });
      case 'private/withdraw': return ok({ op_uuid: 'op-w' });
      case 'private/transfer_spot': return ok({ op_uuid: 'op-t' });
      case 'private/get_withdrawal_history': return ok({ withdrawals: [{ amount: '10', fee: '1', batch_status: 'Settled', subaccount_id: 1, timestamp: 5, tx_hash: '0xabc' }, { amount: '6', fee: '1', batch_status: 'SubmitError', subaccount_id: 1, timestamp: 9 }] });
      default: throw new Error(`unmocked ${method}`);
    }
  }));
  live();
});
afterEach(() => { vi.unstubAllGlobals(); dry(); });

describe('header signing', () => {
  it('signs the timestamp with the session key and names the owner wallet', async () => {
    const h = await authHeaders(owner.toLowerCase(), creds);
    expect(h['X-DeriveWallet']).toBe(owner);
    expect(await verifyMessage({ address: session.address, message: h['X-DeriveTimestamp'], signature: h['X-DeriveSignature'] as Hex })).toBe(true);
  });
});

describe('placeOrder', () => {
  const order = (o: Partial<Parameters<typeof placeOrder>[3]> = {}) => placeOrder('mainnet', owner, creds, { instrument: 'ETH-PERP', side: 'buy', amount: '1.234', type: 'market', ...o });
  const body = () => sent.find((s) => s.method === 'private/order')!.body;

  it('floors the amount to the step and routes to the universe subaccount (not the fallback)', async () => {
    const r = await order();
    expect(r).toEqual({ orderId: 'o1', status: 'filled', filled: 1.23, avgPrice: 101 });
    expect(body().amount).toBe('1.23');
    expect(body().subaccount_id).toBe(1);
    expect(body().time_in_force).toBe('ioc');
  });
  it('refuses below the minimum amount with a clear error and sends nothing', async () => {
    await expect(order({ amount: '0.057' })).rejects.toThrow(/below minimum 0\.1/);
    expect(sent.some((s) => s.method === 'private/order')).toBe(false);
  });
  it('market buy: 2% through the ask, clamped to maxp', async () => {
    await order();
    expect(body().limit_price).toBe('103'); // 101 * 1.02 = 103.02 > maxp 103
  });
  it('market sell: 2% through the bid, clamped to minp', async () => {
    await order({ side: 'sell' });
    expect(Number(body().limit_price)).toBeCloseTo(98, 5); // 100 * 0.98, inside the band
    ticker.minp = '99';
    await order({ side: 'sell' });
    expect(sent.filter((s) => s.method === 'private/order')[1].body.limit_price).toBe('99');
  });
  it('signature expiry is at least 2400 s ahead for IOC', async () => {
    await order();
    expect(Number(body().signature_expiry_sec)).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) + 2_390);
  });
  it('refuses an inactive instrument', async () => { inst.is_active = false; await expect(order()).rejects.toThrow(/not active/); });
  it('throws when not live and makes no call', async () => {
    dry();
    await expect(order()).rejects.toThrow('called while not live');
    expect(sent).toHaveLength(0);
  });
});

describe('withdrawToOwner', () => {
  it('signs a withdraw whose signed data pays only the owner, and sends the owner as recipient', async () => {
    const r = await withdrawToOwner('mainnet', owner, creds, 1, '10.5');
    expect(r).toEqual({ opUuid: 'op-w', recipient: owner });
    const b = sent.find((s) => s.method === 'private/withdraw')!.body;
    expect(b.recipient).toBe(owner);
    expect(b.max_fee_usd).toBe('3');
    const f = { subaccountId: 1, nonce: String(b.nonce), module: DERIVE_MODULES.WITHDRAW, expirySec: Number(b.signature_expiry_sec), owner, signer: session.address,
      data: encodeWithdrawData({ asset: DERIVE_USDC_ASSET, maxFeeUsd: '3', recipient: owner, amount: '10.5' }) };
    expect(await recoverAddress({ hash: actionDigest(f, 'mainnet'), signature: b.signature as Hex })).toBe(session.address);
    // a different recipient would not verify
    const other = { ...f, data: encodeWithdrawData({ asset: DERIVE_USDC_ASSET, maxFeeUsd: '3', recipient: '0x4444444444444444444444444444444444444444', amount: '10.5' }) };
    expect(await recoverAddress({ hash: actionDigest(other, 'mainnet'), signature: b.signature as Hex })).not.toBe(session.address);
  });
  it('refuses below the 5 USDC minimum', async () => {
    await expect(withdrawToOwner('mainnet', owner, creds, 1, '4.99')).rejects.toThrow(/at least 5/);
    expect(sent).toHaveLength(0);
  });
  it('refuses more than the free margin', async () => {
    await expect(withdrawToOwner('mainnet', owner, creds, 1, '60')).rejects.toThrow(/free in subaccount 1/);
    expect(sent.some((s) => s.method === 'private/withdraw')).toBe(false);
  });
  it('refuses more than the USDC held, a foreign subaccount, and a liquidating one', async () => {
    subs[0].initial_margin = '500';
    await expect(withdrawToOwner('mainnet', owner, creds, 1, '150')).rejects.toThrow(/holds only/);
    await expect(withdrawToOwner('mainnet', owner, creds, 99, '10')).rejects.toThrow(/not yours/);
    subs[0].is_under_liquidation = true;
    await expect(withdrawToOwner('mainnet', owner, creds, 1, '10')).rejects.toThrow(/liquidat/);
  });
  it('throws when not live', async () => {
    dry();
    await expect(withdrawToOwner('mainnet', owner, creds, 1, '10')).rejects.toThrow('called while not live');
    expect(sent).toHaveLength(0);
  });
});

describe('transferSpot and reads', () => {
  it('transfers between own subaccounts only', async () => {
    subs.push({ subaccount_id: 3, manager_id: 1, initial_margin: '0', collaterals_value: '10', usdc: '10' });
    expect(await transferSpot('mainnet', owner, creds, 3, 1, '10')).toEqual({ opUuid: 'op-t' });
    await expect(transferSpot('mainnet', owner, creds, 3, 77, '10')).rejects.toThrow(/not yours/);
    await expect(transferSpot('mainnet', owner, creds, 3, 1, '11')).rejects.toThrow(/holds only/);
    dry();
    await expect(transferSpot('mainnet', owner, creds, 3, 1, '10')).rejects.toThrow('called while not live');
  });
  it('withdrawals reads without the live gate', async () => {
    dry();
    const w = await withdrawals('mainnet', owner, creds);
    expect(w.map((x) => [x.done, x.failed])).toEqual([[false, true], [true, false]]);
  });
  it('hedgePositions sums signed perps and only long puts', async () => {
    subs[0].positions = [{ instrument_name: 'NVDA-PERP', amount: '-2' }, { instrument_name: 'NVDA-20261218-145-P', amount: '3' }, { instrument_name: 'NVDA-20261218-150-P', amount: '-1' }, { instrument_name: 'NVDA-20261218-150-C', amount: '5' }];
    subs.push({ subaccount_id: 3, manager_id: 1, initial_margin: '0', collaterals_value: '0', positions: [{ instrument_name: 'NVDA-PERP', amount: '-0.5' }, { instrument_name: 'NVDA-20261218-160-P', amount: '1' }] });
    expect(await hedgePositions('mainnet', owner, creds)).toEqual({ 'derive-perp:NVDA': -2.5, 'derive-put:NVDA': 4 });
  });
});
