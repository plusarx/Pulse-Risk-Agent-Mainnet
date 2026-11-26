import { createWalletClient, encodeFunctionData, getAddress, http, parseAbi, type Address, type Hex } from 'viem';
import { bsc as bscChain } from 'viem/chains';
import { BSC_USDC, BSC_USDT, ERC20_ABI, PANCAKE_QUOTER_V2, PANCAKE_SMART_ROUTER, QUOTER_V2_ABI, SMART_ROUTER_ABI } from '../../../lib/bsc';
import { config } from '../config';
import type { Snapshot, StepResult } from '../types';
import type { AsterCreds } from './appApi';
import * as aster from './aster';
import * as bsc from './bsc';
import type { SaleLeg } from './funding';
import { SELL_BUFFER } from './funding';
import * as pancake from './pancake';
import * as store from './store';
import { haircutFor } from './integrity';

// Margin top-up BNB wallet -> Aster futures, all on BNB Chain (no bridge).
//  1. gas check (agent BNB) BEFORE anything is pulled
//  2. pull USDT / USDC / allowed bStocks from the user to the agent wallet (existing allowance-based pulls)
//  3. sell bStocks for USDC, then swap all USDC to USDT on PancakeSwap (0.01% pool)
//  4. approve USDT to the AstherusVault and call depositFor(USDT, user, amount, broker 1)
//  5. poll the user's futures balance; if not credited in ~90 s, try the spot -> futures transfer (UNVERIFIED live)
// Every step is recorded under its own idempotency key (store.getStep/saveStep), so a crash and retry resumes.

/** AstherusVault proxy on BNB Chain. */
export const ASTER_VAULT: Address = '0x128463A60784c4D3f46c23Af3f65Ed859Ba87974';
/** broker id seen on 30 of 38 recent BSC deposits. */
export const ASTER_BROKER = 1n;
/**
 * depositFor(currency, account, amount, broker), selector 0xcf4a0c5e, decoded from real deposits: arg1 is the CREDITED
 * account (event topic1). Crediting an account OTHER than the sender (agent pays, user is credited) is decoded but has
 * NOT been seen live yet: UNVERIFIED until the lead's live test.
 */
export const VAULT_ABI = parseAbi(['function depositFor(address currency, address account, uint256 amount, uint256 broker)']);
/** Minimum BNB the agent keeps for a top-up (pulls, swap, approve, deposit: well under 1M gas). Same floor as readiness. */
export const MIN_AGENT_BNB_FOR_TOPUP_WEI = 500_000_000_000_000n; // 0.0005 BNB
export const CREDIT_WAIT_MS = 90_000;
const POLL_MS = 6_000;

export interface AsterFundDeps {
  agentAddress(): Address | null;
  bnbBalance(who: Address): Promise<bigint>;
  pullStable(token: 'usdc' | 'usdt', user: string, amountBase: string): Promise<{ txHash: string }>;
  rawForUi(symbol: string, qty: number): Promise<bigint>;
  pullBstock(symbol: string, user: string, raw: bigint): Promise<{ txHash: string }>;
  sellBstockForUsdc(symbol: string, raw: bigint): Promise<{ txHash: string; usdcOutWei: bigint }>;
  swapUsdcToUsdt(amountWei: bigint): Promise<{ txHash: string; usdtOutWei: bigint }>;
  approveUsdt(spender: Address, amountWei: bigint): Promise<{ txHash: string }>;
  depositFor(account: Address, amountWei: bigint): Promise<{ txHash: string }>;
  futuresUsdt(creds: AsterCreds): Promise<number>;
  spotToFutures(creds: AsterCreds, amountUsdt: string, clientTranId: string): Promise<string>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const wallet = () => createWalletClient({ account: bsc.agentAccount(), chain: bscChain, transport: http(config().BSC_RPC_URL, { timeout: 30_000 }) });

/** USDC -> USDT on PancakeSwap V3 (0.01% stable pool), min-out 0.5% under a fresh quote. Returns USDT actually received. */
export async function swapUsdcToUsdt(amountInWei: bigint, slippageBps = 50): Promise<{ txHash: Hex; usdtOutWei: bigint }> {
  if (!config().live) throw new Error('swapUsdcToUsdt called while not live');
  const c = bsc.publicClient(); const acct = bsc.agentAccount();
  const q = await c.simulateContract({ address: PANCAKE_QUOTER_V2, abi: QUOTER_V2_ABI, functionName: 'quoteExactInputSingle', args: [{ tokenIn: BSC_USDC, tokenOut: BSC_USDT, amountIn: amountInWei, fee: 100, sqrtPriceLimitX96: 0n }] });
  const quoted = q.result[0] as bigint;
  if (quoted <= 0n) throw new Error('no PancakeSwap quote for USDC to USDT');
  const minOut = (quoted * BigInt(10_000 - slippageBps)) / 10_000n;
  const w = wallet();
  const before = (await c.readContract({ address: BSC_USDT, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct.address] })) as bigint;
  const approve = await w.writeContract({ address: BSC_USDC, abi: ERC20_ABI, functionName: 'approve', args: [PANCAKE_SMART_ROUTER, amountInWei] });
  await c.waitForTransactionReceipt({ hash: approve, timeout: 90_000 });
  const swap = encodeFunctionData({ abi: SMART_ROUTER_ABI, functionName: 'exactInputSingle', args: [{ tokenIn: BSC_USDC, tokenOut: BSC_USDT, fee: 100, recipient: getAddress(acct.address), amountIn: amountInWei, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] });
  const hash = await w.writeContract({ address: PANCAKE_SMART_ROUTER, abi: SMART_ROUTER_ABI, functionName: 'multicall', args: [pancake.swapDeadline(), [swap]] });
  const r = await c.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== 'success') throw new Error(`USDC to USDT swap reverted (${hash})`);
  const after = (await c.readContract({ address: BSC_USDT, abi: ERC20_ABI, functionName: 'balanceOf', args: [acct.address] })) as bigint;
  return { txHash: hash, usdtOutWei: after - before };
}

async function approveUsdt(spender: Address, amountWei: bigint): Promise<{ txHash: Hex }> {
  if (!config().live) throw new Error('approve called while not live');
  const hash = await wallet().writeContract({ address: BSC_USDT, abi: ERC20_ABI, functionName: 'approve', args: [spender, amountWei] });
  const r = await bsc.publicClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== 'success') throw new Error(`USDT approve reverted (${hash})`);
  return { txHash: hash };
}

async function depositFor(account: Address, amountWei: bigint): Promise<{ txHash: Hex }> {
  if (!config().live) throw new Error('depositFor called while not live');
  const hash = await wallet().writeContract({ address: ASTER_VAULT, abi: VAULT_ABI, functionName: 'depositFor', args: [BSC_USDT, getAddress(account), amountWei, ASTER_BROKER] });
  const r = await bsc.publicClient().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== 'success') throw new Error(`Aster depositFor reverted (${hash})`);
  return { txHash: hash };
}

export const realAsterFundDeps = (n: Snapshot['network']): AsterFundDeps => ({
  agentAddress: bsc.agentAddress,
  bnbBalance: (who) => bsc.publicClient().getBalance({ address: who }),
  pullStable: bsc.pullStable, rawForUi: bsc.rawForUi, pullBstock: bsc.pullBstock,
  sellBstockForUsdc: (sym, raw) => pancake.sellBstockForUsdc(sym, raw),
  swapUsdcToUsdt: (w) => swapUsdcToUsdt(w), approveUsdt, depositFor,
  futuresUsdt: (c) => aster.futuresUsdt(n, c),
  spotToFutures: (c, amt, id) => aster.spotToFutures(n, c, amt, id),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now(),
});

async function once(key: string, label: string, fn: () => Promise<string | undefined>, out: StepResult[]): Promise<boolean> {
  const done = store.getStep(key);
  if (done?.status === 'done') { out.push({ step: label, status: 'done', detail: 'already done (resumed)', ref: done.ref ?? undefined }); return true; }
  try { const ref = await fn(); store.saveStep(key, 'done', ref); out.push({ step: label, status: 'done', ref }); return true; }
  catch (e) { out.push({ step: label, status: 'failed', detail: e instanceof Error ? e.message : String(e) }); return false; }
}
const refAmount = (key: string): bigint => BigInt((store.getStep(key)?.ref ?? ':0').split(':')[1] || '0');
const usdtText = (wei: bigint) => { const s = (wei / 10n ** 12n).toString().padStart(7, '0'); return `${s.slice(0, -6)}.${s.slice(-6)}`; };

export interface AsterFundPlan { usdcBase: bigint; usdtBase: bigint; sales: SaleLeg[] }

/** Plain step list for a dry run / approval card. */
export function describeAsterFunding(s: Snapshot, p: AsterFundPlan, amountBase: string): string[] {
  const u = (b: bigint) => `$${(Number(b) / 1e6).toFixed(2)}`; const steps: string[] = [];
  if (p.usdtBase > 0n) steps.push(`pull ${u(p.usdtBase)} USDT from the user's BNB wallet via the on-chain allowance`);
  if (p.usdcBase > 0n || (!p.sales.length && p.usdtBase === 0n)) steps.push(`pull ${u(p.usdcBase > 0n ? p.usdcBase : BigInt(amountBase))} USDC from the user's BNB wallet via the on-chain allowance`);
  for (const l of p.sales) steps.push(`pull ~$${((l.usd / (1 - haircutFor(s, l.symbol))) * SELL_BUFFER).toFixed(2)} of ${l.symbol} from the user's BNB wallet via the on-chain allowance, then sell it for USDC on PancakeSwap V3 (1% max slippage; a sale is final)`);
  if (p.usdcBase > 0n || p.sales.length || p.usdtBase === 0n) steps.push('swap the USDC to USDT on PancakeSwap (0.01% pool, 0.5% max slippage)');
  steps.push('deposit the USDT into your perps account on BNB Chain (no bridge), credited to your own wallet', 'wait for the perps account to show the deposit');
  return steps;
}

/**
 * Put USDT on the user's Aster futures account. Returns the USDT (18-dp wei) deposited, or null when a step failed
 * (the failed step is in `out`; nothing after it ran). A sale is final, so there is no rollback.
 */
export async function fundAster(s: Snapshot, k: string, creds: AsterCreds, p: AsterFundPlan, out: StepResult[], d: AsterFundDeps = realAsterFundDeps(s.network)): Promise<bigint | null> {
  const agent = d.agentAddress(); if (!agent) throw new Error('AGENT_BSC_PRIVATE_KEY is not set');
  if (creds.user.toLowerCase() !== s.wallet.toLowerCase()) { out.push({ step: 'check the perps account', status: 'failed', detail: 'the perps account owner is not this wallet. Nothing was pulled.' }); return null; }

  // Gas first: never pull the user's funds onto an agent wallet that cannot finish the move.
  const started = ['pullusdt', 'pull', 'swapusdt', 'approve', 'deposit'].some((x) => store.getStep(`${k}:${x}`)?.status === 'done');
  if (!started) {
    const bnb = await d.bnbBalance(agent);
    if (bnb < MIN_AGENT_BNB_FOR_TOPUP_WEI) {
      out.push({ step: 'check agent gas on BNB Chain', status: 'failed', detail: `the agent wallet ${agent} has ${Number(bnb) / 1e18} BNB; it needs about ${Number(MIN_AGENT_BNB_FOR_TOPUP_WEI) / 1e18} BNB to deposit margin. Nothing was pulled.` });
      return null;
    }
  }

  let usdtWei = 0n; let usdcWei = 0n;
  if (p.usdtBase > 0n) {
    if (!(await once(`${k}:pullusdt`, 'Pull USDT from user wallet', async () => (await d.pullStable('usdt', s.wallet, p.usdtBase.toString())).txHash, out))) return null;
    usdtWei += bsc.baseToBsc(p.usdtBase.toString());
  }
  if (p.usdcBase > 0n) {
    if (!(await once(`${k}:pull`, 'Pull USDC from user wallet', async () => (await d.pullStable('usdc', s.wallet, p.usdcBase.toString())).txHash, out))) return null;
    usdcWei += bsc.baseToBsc(p.usdcBase.toString());
  }
  for (const leg of p.sales) {
    const h = s.bsc.bstocks.find((b) => b.symbol === leg.symbol);
    if (!h || h.qty <= 0 || h.value <= 0) { out.push({ step: `sell ${leg.symbol}`, status: 'failed', detail: `${leg.symbol} is not held` }); return null; }
    const qty = Math.min(h.qty, h.allowanceQty ?? h.qty, (leg.usd / (1 - haircutFor(s, leg.symbol))) * SELL_BUFFER / (h.value / h.qty));
    if (!(qty > 0)) { out.push({ step: `sell ${leg.symbol}`, status: 'failed', detail: 'nothing to sell' }); return null; }
    const raw = await d.rawForUi(leg.symbol, qty);
    if (!(await once(`${k}:${leg.symbol}:pullb`, `Pull ${leg.symbol} from user wallet`, async () => (await d.pullBstock(leg.symbol, s.wallet, raw)).txHash, out))) return null;
    if (!(await once(`${k}:${leg.symbol}:sell`, `Sell ${leg.symbol} for USDC on PancakeSwap (1% max slippage)`, async () => { const r = await d.sellBstockForUsdc(leg.symbol, raw); return `${r.txHash}:${r.usdcOutWei}`; }, out))) return null;
    usdcWei += refAmount(`${k}:${leg.symbol}:sell`);
  }
  if (usdcWei > 0n) {
    if (!(await once(`${k}:swapusdt`, 'Swap USDC to USDT on PancakeSwap (0.01% pool, 0.5% max slippage)', async () => { const r = await d.swapUsdcToUsdt(usdcWei); return `${r.txHash}:${r.usdtOutWei}`; }, out))) return null;
    usdtWei += refAmount(`${k}:swapusdt`);
  }
  if (usdtWei <= 0n) { out.push({ step: 'fund the top-up', status: 'failed', detail: 'nothing to deposit' }); return null; }

  // Balance before the deposit, recorded once so a resumed run compares against the same number.
  if (!store.getStep(`${k}:before`)) { try { store.saveStep(`${k}:before`, 'done', String(await d.futuresUsdt(creds))); } catch { store.saveStep(`${k}:before`, 'done', '0'); } }
  const before = Number(store.getStep(`${k}:before`)?.ref ?? '0') || 0;

  if (!(await once(`${k}:approve`, 'Approve USDT to the perps deposit contract', async () => (await d.approveUsdt(ASTER_VAULT, usdtWei)).txHash, out))) return null;
  if (!(await once(`${k}:deposit`, `Deposit ${usdtText(usdtWei)} USDT into your perps account (BNB Chain, no bridge)`, async () => (await d.depositFor(getAddress(s.wallet), usdtWei)).txHash, out))) return null;

  const want = before + (Number(usdtWei / 10n ** 12n) / 1e6) * 0.999;
  const credited = async (ms: number) => {
    const until = d.now() + ms;
    for (;;) { const b = await d.futuresUsdt(creds).catch(() => before); if (b >= want) return true; if (d.now() >= until) return false; await d.sleep(POLL_MS); }
  };
  if (store.getStep(`${k}:credit`)?.status === 'done') { out.push({ step: 'Wait for the perps account to show the deposit', status: 'done', detail: 'already done (resumed)' }); return usdtWei; }
  if (await credited(CREDIT_WAIT_MS)) { store.saveStep(`${k}:credit`, 'done'); out.push({ step: 'Wait for the perps account to show the deposit', status: 'done' }); return usdtWei; }
  // UNVERIFIED LIVE: a deposit may land on the Aster SPOT wallet; move it to futures with the agent key.
  if (!(await once(`${k}:transfer`, 'Move the deposit from the spot wallet to perps margin', async () => d.spotToFutures(creds, usdtText(usdtWei), `pr${k.replace(/[^A-Za-z0-9]/g, '').slice(-30)}`), out))) return null;
  if (await credited(30_000)) { store.saveStep(`${k}:credit`, 'done'); out.push({ step: 'Wait for the perps account to show the deposit', status: 'done' }); return usdtWei; }
  out.push({ step: 'Wait for the perps account to show the deposit', status: 'failed', detail: `the deposit went through on BNB Chain but the perps balance has not updated yet. Check it in the app before retrying; nothing will be sent twice.` });
  return null;
}
