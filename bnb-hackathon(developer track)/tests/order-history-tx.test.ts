import { describe, expect, it } from 'vitest';
import { settlementLabel, shortHash, txUrl } from '../lib/order-history';

// Explorer routes checked live 2026-11-25 against a real NVDA fill (Lighter) and the Derive chain explorer.
const LIGHTER_HASH = '10d6a8229a653f7ad8ae873305b9f259b3561839dad405b45f23a1615a7fda81441746acbbee5f7b';

describe('txUrl: each venue links to its own explorer', () => {
  it('bStocks → BscScan', () => {
    expect(txUrl('bstocks', '0xabc')).toBe('https://bscscan.com/tx/0xabc');
  });
  it('Lighter → Lighter explorer (mainnet and testnet)', () => {
    expect(txUrl('lighter', LIGHTER_HASH)).toBe(`https://app.lighter.xyz/explorer/logs/${LIGHTER_HASH}`);
    expect(txUrl('lighter', LIGHTER_HASH, 'testnet')).toBe(`https://testnet.app.lighter.xyz/explorer/logs/${LIGHTER_HASH}`);
  });
  it('Derive → Derive chain explorer, 0x added; no link on testnet', () => {
    expect(txUrl('derive', 'deadbeef')).toBe('https://explorer.derive.xyz/tx/0xdeadbeef');
    expect(txUrl('derive', '0xdeadbeef')).toBe('https://explorer.derive.xyz/tx/0xdeadbeef');
    expect(txUrl('derive', '0xdeadbeef', 'testnet')).toBeNull();
  });
  it('shortHash keeps the start and end', () => {
    expect(shortHash(LIGHTER_HASH)).toBe('10d6a822…ee5f7b');
  });
});

// Live 2026-11-26: filled ETH-20261126-1700-C trades came back with batch_status "Proving" and tx_hash null.
describe('settlementLabel: the stage shown until the on-chain hash exists', () => {
  it('reads Derive batch statuses in plain words', () => {
    expect(settlementLabel('Proving')).toBe('proving on-chain');
    expect(settlementLabel('Pending')).toBe('queued to settle');
    expect(settlementLabel('Settled')).toBe('settled');
    expect(settlementLabel('Reverted')).toBe('settlement failed');
    expect(settlementLabel(null)).toBe('settling');
  });
});
