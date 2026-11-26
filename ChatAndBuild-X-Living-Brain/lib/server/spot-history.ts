import 'server-only';
import { createPublicClient, decodeEventLog, fallback, formatUnits, getAddress, http, parseAbiItem, type Address, type Hex } from 'viem';
import { bsc } from 'viem/chains';
import { BSC_USDC, BSC_USDT, PANCAKE_SMART_ROUTER, UI_MULTIPLIER_ABI } from '@/lib/bsc';
import { bstockByAddress } from '@/lib/bstocks';
import type { HistoryRow } from '@/lib/order-history';
import { getDb } from './db';

// bStock swaps have no venue order history (PancakeSwap is just a contract), so the app records each swap it sends.
// The browser sends only the tx hash; everything stored is read from the chain: the tx must be the signed-in
// wallet's own successful call to the PancakeSwap router, and the amounts come from its ERC-20 Transfer logs.

const client = createPublicClient({
  chain: bsc,
  transport: fallback([
    ...(process.env.BSC_RPC_URL ? [http(process.env.BSC_RPC_URL, { timeout: 10_000 })] : []),
    http('https://bsc-rpc.publicnode.com', { timeout: 10_000 }), http('https://bsc-dataseed.bnb.org', { timeout: 10_000 }),
  ]),
});

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const STABLES: Record<string, string> = { [BSC_USDC.toLowerCase()]: 'USDC', [BSC_USDT.toLowerCase()]: 'USDT' };

export interface Leg { token: Address; from: Address; to: Address; value: bigint }

/**
 * Pure: turn the wallet's transfers in one swap into a trade. Buy = stable out, bStock in; sell = bStock out, stable in.
 * Returns null when the transfers are not a single bStock-for-stable swap by this wallet.
 */
export function classifySwap(wallet: Address, legs: Leg[]): { side: 'buy' | 'sell'; bstock: Address; bstockRaw: bigint; stable: string; stableRaw: bigint } | null {
  const w = wallet.toLowerCase();
  const mine = legs.filter((l) => l.from.toLowerCase() === w || l.to.toLowerCase() === w);
  const sum = (pred: (l: Leg) => boolean) => mine.filter(pred).reduce((a, l) => a + l.value, 0n);
  const bTokens = [...new Set(mine.map((l) => l.token.toLowerCase()).filter((t) => bstockByAddress(t)))];
  const sTokens = [...new Set(mine.map((l) => l.token.toLowerCase()).filter((t) => STABLES[t]))];
  if (bTokens.length !== 1 || sTokens.length !== 1) return null;
  const [b] = bTokens; const [s] = sTokens;
  const bIn = sum((l) => l.token.toLowerCase() === b && l.to.toLowerCase() === w); const bOut = sum((l) => l.token.toLowerCase() === b && l.from.toLowerCase() === w);
  const sIn = sum((l) => l.token.toLowerCase() === s && l.to.toLowerCase() === w); const sOut = sum((l) => l.token.toLowerCase() === s && l.from.toLowerCase() === w);
  if (bIn > 0n && sOut > 0n && bOut === 0n) return { side: 'buy', bstock: getAddress(b), bstockRaw: bIn, stable: STABLES[s], stableRaw: sOut };
  if (bOut > 0n && sIn > 0n && bIn === 0n) return { side: 'sell', bstock: getAddress(b), bstockRaw: bOut, stable: STABLES[s], stableRaw: sIn };
  return null;
}

export async function recordSpotTrade(wallet: Address, txHash: Hex): Promise<HistoryRow> {
  const existing = getDb().prepare('SELECT * FROM spot_trades WHERE tx_hash = ?').get(txHash.toLowerCase()) as SpotRow | undefined;
  if (existing) {
    if (existing.wallet !== wallet.toLowerCase()) throw new Error('that transaction belongs to another wallet');
    return toRow(existing);
  }
  const [tx, rcpt] = await Promise.all([client.getTransaction({ hash: txHash }), client.getTransactionReceipt({ hash: txHash })]);
  if (getAddress(tx.from) !== getAddress(wallet)) throw new Error('that transaction was not sent by your wallet');
  if (!tx.to || getAddress(tx.to) !== getAddress(PANCAKE_SMART_ROUTER)) throw new Error('that transaction is not a PancakeSwap swap');
  if (rcpt.status !== 'success') throw new Error('that transaction failed on chain');
  const legs: Leg[] = [];
  for (const log of rcpt.logs) {
    try {
      const ev = decodeEventLog({ abi: [TRANSFER], data: log.data, topics: log.topics });
      legs.push({ token: log.address, from: ev.args.from, to: ev.args.to, value: ev.args.value });
    } catch { /* not a Transfer */ }
  }
  const s = classifySwap(wallet, legs);
  if (!s) throw new Error('could not read a bStock swap from that transaction');
  const token = bstockByAddress(s.bstock)!;
  // BEP-677: balances are raw; the user-facing quantity is raw × uiMultiplier ÷ 1e18.
  const mult = (await client.readContract({ address: s.bstock, abi: UI_MULTIPLIER_ABI, functionName: 'uiMultiplier', blockNumber: rcpt.blockNumber })) as bigint;
  const qty = formatUnits((s.bstockRaw * mult) / 10n ** 18n, 18);
  const block = await client.getBlock({ blockNumber: rcpt.blockNumber });
  const row: SpotRow = {
    tx_hash: txHash.toLowerCase(), wallet: wallet.toLowerCase(), symbol: token.symbol, side: s.side, bstock_qty: qty,
    stable_amount: formatUnits(s.stableRaw, 18), stable_symbol: s.stable, block_time: Number(block.timestamp) * 1000, created_at: Date.now(),
  };
  getDb().prepare('INSERT OR IGNORE INTO spot_trades (tx_hash, wallet, symbol, side, bstock_qty, stable_amount, stable_symbol, block_time, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(row.tx_hash, row.wallet, row.symbol, row.side, row.bstock_qty, row.stable_amount, row.stable_symbol, row.block_time, row.created_at);
  return toRow(row);
}

interface SpotRow { tx_hash: string; wallet: string; symbol: string; side: string; bstock_qty: string; stable_amount: string; stable_symbol: string; block_time: number; created_at: number }

function toRow(r: SpotRow): HistoryRow {
  const qty = Number(r.bstock_qty);
  return {
    venue: 'bstocks', time: r.block_time, market: r.symbol, side: r.side as 'buy' | 'sell', type: 'swap', size: r.bstock_qty, filled: r.bstock_qty,
    avgPrice: qty > 0 ? (Number(r.stable_amount) / qty).toString() : null, status: 'filled', account: r.stable_symbol, txHash: r.tx_hash,
  };
}

export function spotHistory(wallet: Address, limit = 50): HistoryRow[] {
  const rows = getDb().prepare('SELECT * FROM spot_trades WHERE wallet = ? ORDER BY block_time DESC LIMIT ?').all(wallet.toLowerCase(), limit) as unknown as SpotRow[];
  return rows.map(toRow);
}
