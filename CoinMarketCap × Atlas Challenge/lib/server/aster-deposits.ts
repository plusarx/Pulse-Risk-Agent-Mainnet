import 'server-only';
import { createPublicClient, fallback, http, pad, type Address, type Hex } from 'viem';
import { bsc } from 'viem/chains';
import type { HistoryRow } from '@/lib/order-history';
import { getDb } from './db';

// Perps deposits in the Activity list, WITH their BNB Chain transaction hash.
// Aster trades are matched off-chain and carry no hash (checked live 2026-11-26: no 64-hex value in userTrades, allOrders
// or income). A deposit is a real BSC transaction to the AstherusVault, and Aster logs it in /fapi/v3/income as
// incomeType DEPOSIT (time + amount). This finds the matching vault event on chain (credited account = the user,
// nearest time and amount), so deposits from the funding page AND the agent's depositFor top-ups both get a hash.
// Found hashes are stored, so each deposit is searched on chain once.

export const ASTER_VAULT_BSC: Address = '0x128463A60784c4D3f46c23Af3f65Ed859Ba87974';
/** AstherusVault deposit event (topic1 = credited account, topic2 = token; data = [?, amount, broker]). Read live 2026-11-26. */
export const VAULT_DEPOSIT_TOPIC: Hex = '0x18081cde2fa64894914e1080b98cca17bb6d1acf633e57f6e26ebdb945ad830b';
const TOKEN_DECIMALS: Record<string, number> = {
  '0x55d398326f99059ff775485246999027b3197955': 18, // USDT
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 18, // USDC
};

const client = createPublicClient({
  chain: bsc,
  transport: fallback([
    ...(process.env.BSC_RPC_URL ? [http(process.env.BSC_RPC_URL, { timeout: 10_000 })] : []),
    http('https://bsc-rpc.publicnode.com', { timeout: 10_000 }), http('https://bsc-dataseed.bnb.org', { timeout: 10_000 }),
  ]),
});

export interface IncomeDeposit { tranId: string; asset: string; amount: number; timeMs: number }
export interface VaultLog { txHash: Hex; blockNumber: bigint; timeMs: number; amount: number }

/** Pure: the vault event that matches an Aster deposit — closest amount (within 2%), then closest time (within 30 min). */
export function matchDeposit(d: IncomeDeposit, logs: VaultLog[]): VaultLog | null {
  const ok = logs.filter((l) => Math.abs(l.amount - d.amount) <= Math.max(0.01, d.amount * 0.02) && Math.abs(l.timeMs - d.timeMs) <= 30 * 60_000);
  ok.sort((a, b) => Math.abs(a.amount - d.amount) - Math.abs(b.amount - d.amount) || Math.abs(a.timeMs - d.timeMs) - Math.abs(b.timeMs - d.timeMs));
  return ok[0] ?? null;
}

/** Pure: the vault event's amount in token units (data word 1), or null if the token is not one we know. */
export function vaultLogAmount(token: string, data: Hex): number | null {
  const dec = TOKEN_DECIMALS[token.toLowerCase()]; if (dec === undefined) return null;
  const words = data.slice(2).match(/.{64}/g) ?? [];
  if (words.length < 2) return null;
  return Number(BigInt(`0x${words[1]}`)) / 10 ** dec;
}

let rate: { at: number; secPerBlock: number; head: bigint; headTimeMs: number } | null = null;
async function chainClock() {
  if (rate && Date.now() - rate.at < 5 * 60_000) return rate;
  const head = await client.getBlock();
  const back = await client.getBlock({ blockNumber: head.number - 100_000n });
  rate = { at: Date.now(), secPerBlock: Number(head.timestamp - back.timestamp) / 100_000, head: head.number, headTimeMs: Number(head.timestamp) * 1000 };
  return rate;
}

/** Search the vault events around the deposit time (3 windows of 3,000 blocks, nearest first). */
async function findDepositTx(wallet: Address, d: IncomeDeposit): Promise<Hex | null> {
  const c = await chainClock();
  const est = c.head - BigInt(Math.max(0, Math.round((c.headTimeMs - d.timeMs) / 1000 / c.secPerBlock)));
  for (const [lo, hi] of [[est - 1500n, est + 1500n], [est - 4500n, est - 1501n], [est + 1501n, est + 4500n]] as const) {
    const to = hi > c.head ? c.head : hi; if (lo > to) continue;
    const logs = await client.getLogs({ address: ASTER_VAULT_BSC, fromBlock: lo, toBlock: to, topics: [VAULT_DEPOSIT_TOPIC, pad(wallet.toLowerCase() as Hex)] } as never) as unknown as { transactionHash: Hex; blockNumber: bigint; topics: Hex[]; data: Hex }[];
    const cands: VaultLog[] = [];
    for (const l of logs) {
      const token = `0x${(l.topics[2] ?? '').slice(-40)}`; const amount = vaultLogAmount(token, l.data);
      if (amount === null) continue;
      const blk = await client.getBlock({ blockNumber: l.blockNumber });
      cands.push({ txHash: l.transactionHash, blockNumber: l.blockNumber, timeMs: Number(blk.timestamp) * 1000, amount });
    }
    const m = matchDeposit(d, cands); if (m) return m.txHash;
  }
  return null;
}

interface Row { tran_id: string; wallet: string; network: string; asset: string; amount: string; time: number; tx_hash: string | null; checked_at: number }
function ensureTable() {
  getDb().exec(`CREATE TABLE IF NOT EXISTS perp_deposits (
    tran_id TEXT PRIMARY KEY, wallet TEXT NOT NULL, network TEXT NOT NULL, asset TEXT NOT NULL, amount TEXT NOT NULL,
    time INTEGER NOT NULL, tx_hash TEXT, checked_at INTEGER NOT NULL)`);
}

/** Deposits as Activity rows. `deposits` comes from Aster's income log; hashes are found on chain once, then stored. */
export async function asterDepositRows(network: 'mainnet' | 'testnet', wallet: Address, deposits: IncomeDeposit[]): Promise<HistoryRow[]> {
  ensureTable();
  const db = getDb(); const w = wallet.toLowerCase();
  for (const d of deposits) {
    const have = db.prepare('SELECT * FROM perp_deposits WHERE tran_id = ?').get(d.tranId) as Row | undefined;
    // Re-search a deposit that had no match at most every 10 minutes (the chain search costs RPC calls).
    if (have && (have.tx_hash || Date.now() - have.checked_at < 10 * 60_000)) continue;
    let hash: Hex | null = null;
    if (network === 'mainnet') { try { hash = await findDepositTx(wallet, d); } catch { hash = null; } }
    db.prepare(`INSERT INTO perp_deposits (tran_id, wallet, network, asset, amount, time, tx_hash, checked_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(tran_id) DO UPDATE SET tx_hash = excluded.tx_hash, checked_at = excluded.checked_at`)
      .run(d.tranId, w, network, d.asset, String(d.amount), d.timeMs, hash, Date.now());
  }
  const rows = db.prepare('SELECT * FROM perp_deposits WHERE wallet = ? AND network = ? ORDER BY time DESC LIMIT 50').all(w, network) as unknown as Row[];
  return rows.map((r) => ({
    venue: 'aster' as const, time: r.time, market: `${r.asset} deposit`, side: 'buy' as const, type: 'deposit',
    size: r.amount, filled: r.amount, avgPrice: null, status: 'filled', account: 'Deposit', txHash: r.tx_hash,
  }));
}
