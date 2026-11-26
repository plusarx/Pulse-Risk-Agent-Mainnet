import { createPublicClient, createWalletClient, getAddress, http, type Address, type Hex } from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { BSC_USDC, ERC20_ABI, UI_MULTIPLIER_ABI } from '../../../lib/bsc';
import { BSC_USDT, BSTOCKS_BSC, bstockBySymbol } from '../../../lib/bstocks';
import { config } from '../config';
import type { BscFunds } from '../types';

// BNB Chain access: balances, the user's allowance to the agent, and the transferFrom pull.
// Chain reads are always real. Sending is only reachable when config().live is true.

let pub: ReturnType<typeof createPublicClient> | null = null;
export const publicClient = () => (pub ??= createPublicClient({ chain: bsc, transport: http(config().BSC_RPC_URL, { timeout: 10_000 }) }));

export function agentAccount() {
  const k = config().AGENT_BSC_PRIVATE_KEY;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error('AGENT_BSC_PRIVATE_KEY is not set');
  return privateKeyToAccount(k as Hex);
}
export const agentAddress = (): Address | null => { try { return agentAccount().address; } catch { return null; } };

const e18 = (v: bigint) => Number(v) / 1e18;

/** USDC base units (6 dp) ↔ BSC stable units (18 dp). Exact integer math. */
export const baseToBsc = (base: string): bigint => BigInt(base) * 10n ** 12n;
export const bscToBase = (wei: bigint): string => (wei / 10n ** 12n).toString();

/** Price of one bStock in USD. Injected so tests and the Pancake tool can supply quotes. */
export type PriceFn = (symbol: string) => Promise<number | null>;

/** `agent` is the allowance spender for USDC, USDT and every bStock (the agent pulls a bStock with transferFrom, then sells it). */
export async function getFunds(user: string, agent: Address | null, symbols: string[], price: PriceFn): Promise<{ funds: BscFunds; problems: string[] }> {
  const c = publicClient(); const u = getAddress(user); const problems: string[] = [];
  const [usdc, usdt, allowance, allowanceUsdt] = await Promise.all([
    c.readContract({ address: BSC_USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [u] }),
    c.readContract({ address: BSC_USDT, abi: ERC20_ABI, functionName: 'balanceOf', args: [u] }),
    agent ? c.readContract({ address: BSC_USDC, abi: ERC20_ABI, functionName: 'allowance', args: [u, agent] }) : Promise.resolve(0n),
    agent ? c.readContract({ address: BSC_USDT, abi: ERC20_ABI, functionName: 'allowance', args: [u, agent] }) : Promise.resolve(0n),
  ]);
  const bstocks: BscFunds['bstocks'] = [];
  for (const symbol of symbols) {
    const t = bstockBySymbol(symbol);
    if (!t) { problems.push(`unknown bStock ${symbol}`); continue; }
    const [raw, mult, allow] = await Promise.all([
      c.readContract({ address: t.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [u] }),
      c.readContract({ address: t.address, abi: UI_MULTIPLIER_ABI, functionName: 'uiMultiplier' }),
      agent ? c.readContract({ address: t.address, abi: ERC20_ABI, functionName: 'allowance', args: [u, agent] }) : Promise.resolve(0n),
    ]);
    const qty = e18((raw * mult) / 10n ** 18n);
    if (qty <= 0) { bstocks.push({ symbol, qty: 0, value: 0, allowanceQty: 0 }); continue; }
    const p = await price(symbol);
    if (p === null) { problems.push(`no price for ${symbol}`); continue; }
    // Allowance (to the agent) is raw token units; scale like the balance so it is comparable with qty.
    bstocks.push({ symbol, qty, value: qty * p, allowanceQty: e18((allow * mult) / 10n ** 18n) });
  }
  // The allowance is capped at what the wallet really holds: that is the true spendable amount.
  const usdcBase = BigInt(bscToBase(usdc));
  const allowBase = BigInt(bscToBase(allowance));
  return { funds: { usdcUsd: e18(usdc), usdtUsd: e18(usdt), bstocks, allowanceUsdcBase: (allowBase < usdcBase || true ? allowBase : usdcBase).toString(), allowanceUsdtBase: bscToBase(allowanceUsdt) }, problems };
}

export { BSTOCKS_BSC };

/** USDC.transferFrom(user, agent, amount). `amountBase` is USDC base units (6 dp). */
export const pullUsdc = (user: string, amountBase: string) => pullStable('usdc', user, amountBase);

/** USDC or USDT .transferFrom(user, agent, amount). Both are 18 dp on BSC; `amountBase` is in 6 dp base units. */
export async function pullStable(token: 'usdc' | 'usdt', user: string, amountBase: string): Promise<{ txHash: Hex }> {
  if (!config().live) throw new Error('pullStable called while not live');
  const acct = agentAccount();
  const w = createWalletClient({ account: acct, chain: bsc, transport: http(config().BSC_RPC_URL) });
  const hash = await w.writeContract({ address: token === 'usdc' ? BSC_USDC : BSC_USDT, abi: [...ERC20_ABI, TRANSFER_FROM] as never, functionName: 'transferFrom', args: [getAddress(user), acct.address, baseToBsc(amountBase)] } as never);
  const rcpt = await publicClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rcpt.status !== 'success') throw new Error(`transferFrom reverted (${hash})`);
  return { txHash: hash };
}

const TRANSFER_FROM = { type: 'function', name: 'transferFrom', stateMutability: 'nonpayable', inputs: [{ name: 'f', type: 'address' }, { name: 't', type: 'address' }, { name: 'v', type: 'uint256' }], outputs: [{ type: 'bool' }] } as const;

/** Raw token units (what transferFrom takes) for a UI quantity of a bStock. BEP-677: raw = ui * 1e18 / uiMultiplier. */
export async function rawForUi(symbol: string, uiQty: number): Promise<bigint> {
  const t = bstockBySymbol(symbol); if (!t) throw new Error(`unknown bStock ${symbol}`);
  const mult = await publicClient().readContract({ address: t.address, abi: UI_MULTIPLIER_ABI, functionName: 'uiMultiplier' });
  const ui18 = BigInt(Math.floor(uiQty * 1e8)) * 10n ** 10n;
  return (ui18 * 10n ** 18n) / mult;
}

/** bStock.transferFrom(user, agent, rawAmount): the agent pulls a bStock the user allowed, then sells it. `rawAmount` is in raw token units. */
export async function pullBstock(symbol: string, user: string, rawAmount: bigint): Promise<{ txHash: Hex }> {
  if (!config().live) throw new Error('pullBstock called while not live');
  const t = bstockBySymbol(symbol); if (!t) throw new Error(`unknown bStock ${symbol}`);
  const acct = agentAccount();
  const w = createWalletClient({ account: acct, chain: bsc, transport: http(config().BSC_RPC_URL) });
  const hash = await w.writeContract({ address: t.address, abi: [...ERC20_ABI, TRANSFER_FROM] as never, functionName: 'transferFrom', args: [getAddress(user), acct.address, rawAmount] } as never);
  const rcpt = await publicClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (rcpt.status !== 'success') throw new Error(`bStock transferFrom reverted (${hash})`);
  return { txHash: hash };
}

/** USDC held by an address, in 18-dp BSC units. */
export async function usdcBalanceWei(who: Address): Promise<bigint> {
  return publicClient().readContract({ address: BSC_USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [who] }) as Promise<bigint>;
}
