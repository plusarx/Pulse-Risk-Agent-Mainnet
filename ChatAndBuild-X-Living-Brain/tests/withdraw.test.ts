import { describe, expect, it } from 'vitest';
import { hashTypedData } from 'viem';
import { actionDigest, actionHash, actionTypedData, encodeWithdrawData } from '@/lib/derive-codec';
import { DERIVE_MODULES, DERIVE_USDC_ASSET } from '@/lib/venues';

describe('Derive withdraw encoding', () => {
  it('matches the encoded_data Derive public/withdraw_debug returned (mainnet, 2026-11-24)', () => {
    // withdraw_debug { amount_in_underlying: "10.5", max_fee_usd: "3", recipient: 0x2222…, force_batch: false }
    const derive = '0x00000000000000000000000057b03e14d409adc7fab6cfc44b5886cad2d5f02b00000000000000000000000000000000000000000000000029a2241af62c000000000000000000000000000022222222222222222222222222222222222222220000000000000000000000000000000000000000000000000000000000a037a00000000000000000000000000000000000000000000000000000000000000000';
    expect(encodeWithdrawData({ asset: DERIVE_USDC_ASSET, maxFeeUsd: '3', recipient: '0x2222222222222222222222222222222222222222', amount: '10.5' })).toBe(derive);
  });

  it('puts the amount in USDC 6-decimal units, not 1e18', () => {
    const data = encodeWithdrawData({ asset: DERIVE_USDC_ASSET, maxFeeUsd: '3', recipient: '0x2222222222222222222222222222222222222222', amount: '1' });
    expect(BigInt(`0x${data.slice(2 + 64 * 3, 2 + 64 * 4)}`)).toBe(1_000_000n);
  });

  it('refuses zero', () => {
    expect(() => encodeWithdrawData({ asset: DERIVE_USDC_ASSET, maxFeeUsd: '3', recipient: '0x2222222222222222222222222222222222222222', amount: '0' })).toThrow();
  });

  it('typed data the session key signs hashes to the same digest as our manual EIP-712', () => {
    const f = { subaccountId: 7, nonce: '1764000000000000001', module: DERIVE_MODULES.WITHDRAW, expirySec: 1764003600,
      owner: '0x2222222222222222222222222222222222222222' as const, signer: '0x1111111111111111111111111111111111111111' as const,
      data: encodeWithdrawData({ asset: DERIVE_USDC_ASSET, maxFeeUsd: '3', recipient: '0x2222222222222222222222222222222222222222', amount: '10.5' }) };
    const td = actionTypedData(f, 'mainnet');
    const viemDigest = hashTypedData({ ...td, message: { ...td.message, subaccountId: 7n, nonce: BigInt(f.nonce), expiry: BigInt(f.expirySec) } });
    expect(viemDigest).toBe(actionDigest(f, 'mainnet'));
    expect(actionHash(f)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

// Live oracle: our full action hash vs Derive's own, for a real (public) mainnet subaccount. Moves nothing.
// Run with: LIVE=1 npx vitest run tests/withdraw.test.ts
describe.skipIf(!process.env.LIVE)('Derive withdraw_debug oracle (live mainnet)', () => {
  it('action hash and typed-data hash match Derive', async () => {
    const D = 'https://api.derive.xyz/v3';
    const post = async (m: string, p: object) => (await (await fetch(`${D}/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) })).json()) as { result: Record<string, unknown> & { trades?: { subaccount_id: number }[] } };
    const sub = (await post('public/get_trade_history', { instrument_name: 'ETH-PERP', page_size: 1 })).result.trades![0].subaccount_id;
    const signer = '0x1111111111111111111111111111111111111111' as const;
    const nonce = `${Date.now()}000001`; const expirySec = Math.floor(Date.now() / 1000) + 600;
    const dbg = (await post('public/withdraw_debug', { subaccount_id: sub, signer, nonce, amount_in_underlying: '10.5', max_fee_usd: '3', signature_expiry_sec: expirySec, asset_name: 'USDC', force_batch: false })).result as Record<string, string>;
    const owner = dbg.owner as `0x${string}`; // the subaccount's owner; recipient defaults to it, as our code pins
    const f = { subaccountId: sub, nonce, module: DERIVE_MODULES.WITHDRAW, expirySec, owner, signer,
      data: encodeWithdrawData({ asset: DERIVE_USDC_ASSET, maxFeeUsd: '3', recipient: owner, amount: '10.5' }) };
    expect(f.data).toBe(dbg.encoded_data);
    expect(actionHash(f)).toBe(dbg.action_hash);
    expect(actionDigest(f, 'mainnet')).toBe(dbg.typed_data_hash);
  }, 30_000);
});
