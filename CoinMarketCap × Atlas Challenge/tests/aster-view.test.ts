import { describe, expect, it } from 'vitest';
import { decodeFunctionData, erc20Abi } from 'viem';
import {
  ASTER_DEPOSIT_TOKEN, ASTER_VAULT_ABI, ASTER_VAULT_BSC, asterDepositSteps, asterOutcome, emptyAsterView, mapAsterAccount, mapAsterHistory,
  withdrawActionTypedData, withdrawFee,
} from '../lib/aster-view';
import { statusLabel, txUrl } from '../lib/order-history';
import type { AsterOrder } from '../lib/aster';

const order = (o: Partial<AsterOrder>): AsterOrder => ({ orderId: 1, symbol: 'NVDAUSDT', side: 'SELL', type: 'MARKET', status: 'FILLED', price: '0', avgPrice: '180.5', origQty: '0.1', executedQty: '0.1', time: 1000, ...o });

describe('aster account view', () => {
  it('maps balances, positions (flat ones dropped) and leverage', () => {
    const v = mapAsterAccount({ totalWalletBalance: '100', totalMarginBalance: '98', availableBalance: '49' },
      [{ symbol: 'NVDAUSDT', positionAmt: '-0.5', entryPrice: '180', markPrice: '182', unRealizedProfit: '-1', liquidationPrice: '300', leverage: '10', notional: '-91' },
       { symbol: 'TSLAUSDT', positionAmt: '0', entryPrice: '0', markPrice: '400', unRealizedProfit: '0', liquidationPrice: '0', leverage: '5', notional: '0' }],
      [order({ status: 'NEW', type: 'LIMIT', price: '200' })], 123);
    expect(v.state).toBe('ok');
    expect(v.usedPct).toBeCloseTo(50, 6);
    expect(v.positions).toHaveLength(1);
    expect(v.positions[0]).toMatchObject({ ticker: 'NVDA', side: 'short', size: '0.5', notional: 91, liqPrice: 300 });
    expect(v.leverage).toEqual({ NVDAUSDT: 10, TSLAUSDT: 5 });
    expect(v.openOrders[0]).toMatchObject({ orderId: '1', side: 'sell', type: 'limit' });
  });
  it('-5050 "no deposit yet" is a state with zero balances, not an error', () => {
    expect(emptyAsterView('no_deposit', 5)).toMatchObject({ state: 'no_deposit', equity: 0, available: 0, positions: [], agentExpiresAt: 5 });
    expect(emptyAsterView('needs_agent').equity).toBeNull();
  });
});

describe('aster history', () => {
  it('maps orders to rows with no tx hash and the order id as reference', () => {
    const rows = mapAsterHistory([order({ orderId: 7, time: 1 }), order({ orderId: 8, status: 'CANCELED', executedQty: '0', time: 2 }), order({ orderId: 7, time: 1 })]);
    expect(rows.map((r) => r.orderId)).toEqual(['8', '7']);
    expect(rows[1]).toMatchObject({ venue: 'aster', market: 'NVDA-PERP', side: 'sell', status: 'filled', avgPrice: '180.5', txHash: null });
    expect(statusLabel(rows[0])).toEqual({ text: 'Canceled', tone: 'down' });
    expect(txUrl('aster', 'x')).toBeNull();
  });
  it('outcome', () => {
    expect(asterOutcome(undefined).state).toBe('pending');
    expect(asterOutcome(order({ status: 'CANCELED', executedQty: '0.05' })).state).toBe('partial');
    expect(asterOutcome(order({ status: 'NEW' })).state).toBe('open');
  });
});

describe('aster deposit calldata', () => {
  it('approves only when short, then deposit(USDT, amount, broker 1)', () => {
    const amt = 10n * 10n ** 18n;
    const [ap, dep] = asterDepositSteps(amt, 0n);
    expect(ap.to).toBe(ASTER_DEPOSIT_TOKEN);
    expect(decodeFunctionData({ abi: erc20Abi, data: ap.data }).args).toEqual([ASTER_VAULT_BSC, amt]);
    expect(dep.to).toBe(ASTER_VAULT_BSC);
    expect(dep.data.slice(0, 10)).toBe('0x0efe6a8b');
    expect(decodeFunctionData({ abi: ASTER_VAULT_ABI, data: dep.data }).args).toEqual([ASTER_DEPOSIT_TOKEN, amt, 1n]);
    expect(asterDepositSteps(amt, amt)).toHaveLength(1);
  });
});

describe('aster withdraw', () => {
  it('typed data: domain Aster, destination chain, spaced field names', () => {
    const td = withdrawActionTypedData(56, '0x1111111111111111111111111111111111111111', 'USDT', '10', '0.60', '1', 'Mainnet');
    expect(td.domain).toMatchObject({ name: 'Aster', chainId: 56 });
    expect(td.message['destination Chain']).toBe('BSC');
    expect(td.types.Action.map((f) => f.name)).toContain('aster chain');
  });
  it('fee: buffered, floored, rounded up to 2dp', () => {
    expect(withdrawFee(0, 'USDT', 56)).toBe('0.60');
    expect(withdrawFee(1.001, 'USDT', 56)).toBe('1.11');
  });
});
