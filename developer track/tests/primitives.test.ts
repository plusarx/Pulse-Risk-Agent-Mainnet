import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, keccak256, toBytes } from 'viem';
import { floorToStep, scaleDecimal, unscale } from '@/lib/decimal';
import { buildPath, minOut } from '@/lib/swap-path';
import { ACTION_TYPEHASH, actionDigest, domainSeparator, encodeSetSessionKeyData, encodeTradeData, encodeTransferData, nextNonce, universeFor } from '@/lib/derive-codec';
import { DERIVE } from '@/lib/venues';
import { BSC_USDC, BSC_USDT } from '@/lib/bsc';
import { safeParseUnits } from '@/lib/format';

describe('decimal', () => {
  it('scales without float error', () => {
    expect(scaleDecimal('0.1', 18)).toBe(100000000000000000n);
    expect(scaleDecimal('61432.15', 1)).toBe(614321n); // truncates, never rounds up
    expect(unscale(1234500n, 6)).toBe('1.2345');
  });
  it('floors to step', () => {
    expect(floorToStep('1.237', '0.01')).toBe('1.23');
    expect(floorToStep('2069.97', '0.1')).toBe('2069.9');
  });
  it('rejects junk', () => { expect(() => scaleDecimal('1e5', 6)).toThrow(); expect(safeParseUnits('abc', 18)).toBeNull(); });
});

describe('swap path', () => {
  const NVDAB = '0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436';
  it('routes USDC through USDT at the 0.01% hop', () => {
    const p = buildPath('buy', 'USDC', NVDAB, 2500).toLowerCase();
    expect(p.startsWith(BSC_USDC.toLowerCase())).toBe(true);
    expect(p).toContain(BSC_USDT.slice(2).toLowerCase());
    expect(p.endsWith(NVDAB.slice(2).toLowerCase())).toBe(true);
    expect(p.length).toBe(2 + (20 + 3 + 20 + 3 + 20) * 2);
  });
  it('computes minOut with integer math', () => {
    expect(minOut(1_000_000n, 50)).toBe(995_000n);
    expect(() => minOut(1n, -1)).toThrow();
  });
});

describe('derive codec', () => {
  it('typehash matches the documented constant', () => {
    expect(ACTION_TYPEHASH).toBe('0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17');
  });
  it('domain separators match the live-verified constants on both networks', () => {
    expect(domainSeparator('mainnet')).toBe(DERIVE.mainnet.domainSeparator);
    expect(domainSeparator('testnet')).toBe(DERIVE.testnet.domainSeparator);
  });
  it('refuses dangerous session-key scopes', () => {
    const k = '0x0000000000000000000000000000000000000001';
    expect(() => encodeSetSessionKeyData(k, 1, [0])).toThrow();
    expect(() => encodeSetSessionKeyData(k, 1, [15])).toThrow();
    expect(() => encodeSetSessionKeyData(k, 1, [2, 1, 12, 13])).not.toThrow();
  });
  it('encodes trade data at 1e18', () => {
    const d = encodeTradeData({ asset: '0x0000000000000000000000000000000000000002', subId: '0', limitPrice: '2069.9', amount: '0.01', maxFee: '1.5', recipientId: 7, isBid: true });
    const [, , px, amt, fee, rid, bid] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'int256' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }], d);
    expect(px).toBe(2069900000000000000000n); expect(amt).toBe(10000000000000000n); expect(fee).toBe(1500000000000000000n); expect(rid).toBe(7n); expect(bid).toBe(true);
  });
  it('encodes transfer_spot data (create-subaccount form) at 1e18', () => {
    const d = encodeTransferData({ toSubaccountId: 0, newSubaccountManager: 2, asset: '0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b', amount: '10', maxFeeUsd: '2' });
    const [to, mgr, asset, sub, amt, fee] = decodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], d);
    expect([to, mgr, sub]).toEqual([0n, 2n, 0n]); expect(asset).toBe('0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b');
    expect(amt).toBe(10n * 10n ** 18n); expect(fee).toBe(2n * 10n ** 18n);
    expect(() => encodeTransferData({ toSubaccountId: 0, newSubaccountManager: 2, asset: '0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b', amount: '0', maxFeeUsd: '2' })).toThrow();
  });
  it('maps currencies to risk universes', () => {
    const us = [{ id: 1, name: 'PRIME', managers: [{ managerId: 1, marginType: 'SM' }], families: ['ETH-OPTION', 'ETH-PERP'] },
      { id: 2, name: 'MIDCAP', managers: [{ managerId: 2, marginType: 'SM' }], families: ['HYPE-OPTION', 'HYPE-PERP'] }];
    expect(universeFor(us, 'HYPE')?.name).toBe('MIDCAP'); expect(universeFor(us, 'ETH')?.id).toBe(1); expect(universeFor(us, 'NVDA')).toBeUndefined();
  });
  it('nonces are ns-scale and strictly increasing', () => {
    const a = BigInt(nextNonce()); const b = BigInt(nextNonce());
    expect(b > a).toBe(true); expect(a.toString().length).toBeGreaterThanOrEqual(19);
  });
  it('digest is deterministic', () => {
    const f = { subaccountId: 1, nonce: '1', module: '0x0000000000000000000000000000000000000003' as const, data: '0x' as const, expirySec: 1, owner: '0x0000000000000000000000000000000000000004' as const, signer: '0x0000000000000000000000000000000000000004' as const };
    expect(actionDigest(f, 'mainnet')).toBe(actionDigest(f, 'mainnet'));
    expect(actionDigest(f, 'mainnet')).not.toBe(actionDigest(f, 'testnet'));
    expect(keccak256(toBytes('x'))).toMatch(/^0x/);
  });
});
