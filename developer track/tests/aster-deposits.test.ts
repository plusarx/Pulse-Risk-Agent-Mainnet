import { describe, expect, it } from 'vitest';
import { matchDeposit, vaultLogAmount, VAULT_DEPOSIT_TOPIC } from '../lib/server/aster-deposits';
import { txUrl } from '../lib/order-history';

// Live 2026-11-26: Aster logged the user's deposit as income DEPOSIT 5.00546047 USDT. Trades carry no hash; deposits are
// BNB Chain transactions to the vault, found by credited account + nearest amount and time.
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const word = (n: bigint) => n.toString(16).padStart(64, '0');
const data = (amountWei: bigint) => `0x${word(0n)}${word(amountWei)}${word(1n)}` as `0x${string}`;
const T = 1795670000000;

describe('vault deposit logs', () => {
  it('reads the amount from data word 1 in token units', () => {
    expect(vaultLogAmount(USDT, data(5_005_460_470_000_000_000n))).toBeCloseTo(5.00546047, 8);
    expect(vaultLogAmount('0x000000000000000000000000000000000000dead', data(1n))).toBeNull();   // unknown token
  });
  it('the event topic is the one read from a live log', () => {
    expect(VAULT_DEPOSIT_TOPIC).toBe('0x18081cde2fa64894914e1080b98cca17bb6d1acf633e57f6e26ebdb945ad830b');
  });
  it('matches the Aster deposit to the nearest-amount, nearest-time vault event', () => {
    const logs = [
      { txHash: '0xaaa' as const, blockNumber: 1n, timeMs: T - 120_000, amount: 20 },
      { txHash: '0xbbb' as const, blockNumber: 2n, timeMs: T - 40_000, amount: 5.00546047 },
      { txHash: '0xccc' as const, blockNumber: 3n, timeMs: T - 50 * 60_000, amount: 5.00546047 },   // too far in time
    ];
    expect(matchDeposit({ tranId: '1', asset: 'USDT', amount: 5.00546047, timeMs: T }, logs)?.txHash).toBe('0xbbb');
    expect(matchDeposit({ tranId: '2', asset: 'USDT', amount: 9, timeMs: T }, logs)).toBeNull();
  });
});

describe('Activity links for perps rows', () => {
  it('a deposit hash links to BscScan; an order (no hash) does not', () => {
    const h = `0x${'ab'.repeat(32)}`;
    expect(txUrl('aster', h)).toBe(`https://bscscan.com/tx/${h}`);
    expect(txUrl('aster', '123456')).toBeNull();
  });
});
