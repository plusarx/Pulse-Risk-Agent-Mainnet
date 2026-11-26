import { createPublicClient, createWalletClient, getAddress, http, parseAbi, type Address, type Hex } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { BSC_USDC } from '../../../lib/bsc';
import { DERIVE, DERIVE_USDC_ASSET, ETH_USDC, RELAY_API } from '../../../lib/venues';
import { DERIVE_ACTION_MANAGER_ABI } from '../../../lib/l1';
import { config } from '../config';
import type { Network } from '../types';
import type { DeriveCreds } from './appApi';
import { authHeaders, listSubaccounts, rpc, transferSpot } from './derive';
import { baseToBsc } from './bsc';
import { executeSteps, getStatusDetail, validateQuote, type QuoteReq, type RelayStatusDetail } from './relay';

// Derive deposit leg of a top-up (docs/AGENT_BUILD.md 4.2 steps 4-7):
//   BSC USDC --Relay--> agent's Ethereum address --ActionManager.depositToNewSubaccount(owner = USER)--> new subaccount --transfer_spot--> rule subaccount.
// Everything that sends is gated by config().live. Nothing here has been run against the live venues.

/** Below Derive's live minimum ($5) a deposit is lost; keep a margin. */
export const DERIVE_DEPOSIT_MIN_BASE = 7_000_000n;
const ERC20 = parseAbi(['function approve(address spender, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address owner, address spender) view returns (uint256)']);

export type StepName = 'bridge' | 'bridge_wait' | 'deposit' | 'credit' | 'consolidate';
export interface StepResult { step: StepName; status: 'done' | 'failed'; detail?: string; ref?: string }

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export interface PollOpts { sleep?: (ms: number) => Promise<void>; attempts?: number; intervalMs?: number }

// ── Ethereum access (injectable) ───────────────────────────────────────────────
export interface EthIo {
  address: Address;
  usdcBalance(): Promise<bigint>;
  /** Sends approve(spender, amount) and resolves once mined. */
  approve(spender: Address, amount: bigint): Promise<Hex>;
  /** Sends depositToNewSubaccount and resolves once mined. Throws if it reverts. */
  deposit(a: { manager: Address; asset: Address; amount: bigint; managerId: number; owner: Address }): Promise<Hex>;
}

/** The agent's Ethereum key: AGENT_ETH_PRIVATE_KEY if set (read from the environment, not config.ts), else the BSC key. */
export function ethAccount() {
  const k = process.env.AGENT_ETH_PRIVATE_KEY || config().AGENT_BSC_PRIVATE_KEY;
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) throw new Error('AGENT_ETH_PRIVATE_KEY / AGENT_BSC_PRIVATE_KEY is not set');
  return privateKeyToAccount(k as Hex);
}
export const agentEthAddress = (): Address | null => { try { return ethAccount().address; } catch { return null; } };

/** The agent's ETH on Ethereum (gas for the Derive deposit). */
export async function agentEthBalance(n: Network): Promise<bigint> {
  const url = config().ETH_RPC_URL; if (!url) throw new Error('ETH_RPC_URL is not set');
  const pub = createPublicClient({ chain: n === 'mainnet' ? mainnet : sepolia, transport: http(url, { timeout: 15_000 }) });
  return pub.getBalance({ address: ethAccount().address });
}

export function viemEth(n: Network): EthIo {
  const url = config().ETH_RPC_URL;
  if (!url) throw new Error('ETH_RPC_URL is not set');
  const chain = n === 'mainnet' ? mainnet : sepolia;
  const account = ethAccount();
  const pub = createPublicClient({ chain, transport: http(url, { timeout: 15_000 }) });
  const wal = createWalletClient({ account, chain, transport: http(url, { timeout: 15_000 }) });
  const usdc = DERIVE[n].usdc as Address;
  const mined = async (hash: Hex) => { const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 }); if (r.status !== 'success') throw new Error(`Ethereum tx reverted (${hash})`); return hash; };
  return {
    address: account.address,
    usdcBalance: () => pub.readContract({ address: usdc, abi: ERC20, functionName: 'balanceOf', args: [account.address] }) as Promise<bigint>,
    approve: async (spender, amount) => mined(await wal.writeContract({ address: usdc, abi: ERC20, functionName: 'approve', args: [spender, amount] })),
    deposit: async (a) => mined(await wal.writeContract({ address: a.manager, abi: DERIVE_ACTION_MANAGER_ABI, functionName: 'depositToNewSubaccount', args: [a.asset, a.amount, a.managerId, a.owner] })),
  };
}

// ── 1. Relay: BSC USDC -> Ethereum USDC ────────────────────────────────────────
interface RelayResp { steps?: never; [k: string]: unknown }

export async function getEthQuote(depositor: Address, recipient: Address, amountWei: bigint): Promise<Parameters<typeof validateQuote>[0]> {
  const c = config();
  const res = await fetch(`${RELAY_API}/quote/v2`, {
    method: 'POST', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', ...(c.RELAY_API_KEY ? { 'x-api-key': c.RELAY_API_KEY } : {}) },
    body: JSON.stringify({ user: depositor, recipient, originChainId: 56, destinationChainId: 1, originCurrency: BSC_USDC, destinationCurrency: ETH_USDC,
      amount: amountWei.toString(), tradeType: 'EXACT_INPUT', slippageTolerance: '50', refundTo: depositor }),
  });
  const j = (await res.json().catch(() => ({}))) as Parameters<typeof validateQuote>[0] & RelayResp;
  if (!res.ok || !j.steps) throw new Error(`Relay: ${(j as { message?: string }).message ?? (j as { errorCode?: string }).errorCode ?? res.status}`);
  return j;
}

export interface BridgeArgs { depositor: Address; recipient: Address; amountBase: string }
export interface BridgeResult { requestId: string; txHashes: Hex[]; minOutBase: string }
export interface BridgeDeps { getQuote?: typeof getEthQuote; execute?: typeof executeSteps }

/** Validate (relay.ts validateQuote + destination checks) THEN send. `recipient` must be the agent's own Ethereum address. */
export async function bridgeToEthereum(a: BridgeArgs, deps: BridgeDeps = {}): Promise<BridgeResult> {
  if (!/^\d+$/.test(a.amountBase) || BigInt(a.amountBase) < DERIVE_DEPOSIT_MIN_BASE) throw new Error('bridge amount must be at least 7 USDC (base units)');
  const depositor = getAddress(a.depositor); const recipient = getAddress(a.recipient);
  const amountWei = baseToBsc(a.amountBase);
  const q = await (deps.getQuote ?? getEthQuote)(depositor, recipient, amountWei);
  // Same checks as app/api/relay/quote/route.ts: chain 56, no native value, approve -> Relay router and <= amount,
  // depositErc20(depositor, BSC USDC, amount), quote recipient echo.
  const req: QuoteReq = { depositor, recipientAccountIndex: recipient, amountWei };
  const v = validateQuote(q, req);
  const out = (q as { details?: { currencyOut?: { currency?: { chainId?: number; address?: string } } } }).details?.currencyOut?.currency;
  if (out?.chainId !== undefined && out.chainId !== 1) throw new Error('Relay quote destination chain is not Ethereum');
  if (out?.address && out.address.toLowerCase() !== ETH_USDC.toLowerCase()) throw new Error('Relay quote output token is not Ethereum USDC');
  const { txHashes } = await (deps.execute ?? executeSteps)(v);
  return { requestId: v.requestId, txHashes, minOutBase: v.minOut };
}

/** Poll Relay until the request is final. Throws with the refund details on refund/failure. */
export async function waitForBridge(requestId: string, o: PollOpts & { status?: (id: string) => Promise<RelayStatusDetail> } = {}): Promise<void> {
  const sleep = o.sleep ?? sleepReal; const status = o.status ?? getStatusDetail;
  for (let i = 0; i < (o.attempts ?? 60); i++) {
    const s = await status(requestId);
    if (s.status === 'success') return;
    if (s.status === 'refund') throw new Error(`Relay refunded ${requestId}${s.refundAmountBase ? ` amount ${s.refundAmountBase}` : ''}${s.refundTxHash ? ` tx ${s.refundTxHash}` : ''}`);
    if (s.status === 'failed') throw new Error(`Relay request ${requestId} failed`);
    await sleep(o.intervalMs ?? 10_000);
  }
  throw new Error(`Relay request ${requestId} still pending (ambiguous): do not re-send, check status`);
}

// ── 2. Deposit on Ethereum ─────────────────────────────────────────────────────
export interface DepositArgs { n: Network; owner: Address; amountBase: string; managerId: number; eth?: EthIo }

/** USDC.approve(ActionManager, amount) then depositToNewSubaccount(asset, amount, managerId, owner = USER). Returns the deposit tx hash. */
export async function depositToNewSubaccount(a: DepositArgs): Promise<{ txHash: Hex; approveTxHash: Hex }> {
  if (!/^\d+$/.test(a.amountBase)) throw new Error('amount must be an integer base-unit string');
  const amount = BigInt(a.amountBase);
  if (amount < DERIVE_DEPOSIT_MIN_BASE) throw new Error('Derive deposit below 7 USDC refused: under Derive\'s $5 minimum the deposit is lost');
  if (!config().live) throw new Error('Derive deposit called while not live');
  const eth = a.eth ?? viemEth(a.n);
  const bal = await eth.usdcBalance();
  if (bal < amount) throw new Error(`agent holds only ${bal} base units of USDC on Ethereum, need ${amount}`);
  const manager = DERIVE[a.n].actionManager as Address;
  const approveTxHash = await eth.approve(manager, amount);
  const txHash = await eth.deposit({ manager, asset: DERIVE_USDC_ASSET, amount, managerId: a.managerId, owner: getAddress(a.owner) });
  return { txHash, approveTxHash };
}

// ── 3. Wait for the credit ─────────────────────────────────────────────────────
export interface CreditArgs extends PollOpts {
  n: Network; wallet: Address; creds: DeriveCreds; txHash: string;
  /** Subaccount ids that existed before the deposit (and the rule's own). Anything else non-fallback is the new one. */
  knownIds?: number[];
}

export async function waitForCredit(a: CreditArgs): Promise<{ subaccountId: number }> {
  const sleep = a.sleep ?? sleepReal; const owner = getAddress(a.wallet);
  let applied = false;
  for (let i = 0; i < (a.attempts ?? 40); i++) {
    const h = await rpc<{ actions?: { tx_hash?: string; status?: string }[] }>(a.n, 'public/get_onchain_action_history', { wallet: owner }, {});
    const hit = (h.actions ?? []).find((x) => x.tx_hash?.toLowerCase() === a.txHash.toLowerCase());
    if (hit?.status === 'applied') { applied = true; break; }
    if (hit && hit.status === 'applied_with_fallback') throw new Error(`deposit ${a.txHash} was applied to the fallback subaccount; needs manual recovery`);
    await sleep(a.intervalMs ?? 10_000);
  }
  if (!applied) throw new Error(`deposit ${a.txHash} not credited yet (ambiguous): do not deposit again`);
  const acct = await rpc<{ subaccount_ids: number[]; fallback_subaccount_id?: number | null }>(a.n, 'private/get_account', { wallet: owner }, await authHeaders(owner, a.creds));
  const known = new Set(a.knownIds ?? []);
  const fresh = acct.subaccount_ids.filter((id) => id !== acct.fallback_subaccount_id && !known.has(id) && id !== a.creds.subaccountId).sort((x, y) => y - x);
  if (!fresh.length) throw new Error('deposit credited but no new subaccount found');
  return { subaccountId: fresh[0] };
}

// ── 4. Consolidate ─────────────────────────────────────────────────────────────
/** transfer_spot the new subaccount's whole USDC balance (floored to 6 dp) into the rule's subaccount. */
export async function consolidate(a: { n: Network; wallet: Address; creds: DeriveCreds; fromSubaccountId: number; toSubaccountId: number }): Promise<{ opUuid: string | null; amountUsd: string }> {
  const src = (await listSubaccounts(a.n, a.wallet, a.creds)).find((s) => s.subaccount_id === a.fromSubaccountId);
  if (!src) throw new Error(`subaccount ${a.fromSubaccountId} is not yours`);
  const held = src.collaterals.find((c) => c.asset_name === 'USDC')?.amount ?? '0';
  const amountUsd = held.replace(/^(\d+)(?:\.(\d{0,6}))?\d*$/, (_m, i: string, f?: string) => (f ? `${i}.${f}` : i));
  if (!(Number(amountUsd) > 0)) throw new Error(`subaccount ${a.fromSubaccountId} holds no USDC to consolidate`);
  const { opUuid } = await transferSpot(a.n, a.wallet, a.creds, a.fromSubaccountId, a.toSubaccountId, amountUsd);
  return { opUuid, amountUsd };
}

// ── Orchestrator ───────────────────────────────────────────────────────────────
export interface FundArgs {
  n: Network;
  /** The USER's wallet: owner of the Derive account and recipient of nothing else. */
  wallet: Address;
  creds: DeriveCreds;
  /** USDC base units (6 dp) to move. */
  amountBase: string;
  /** Manager of the rule's subaccount (PRIME 1, MIDCAP 2, ALT 3, RWA 4). The new subaccount is created under it. */
  managerId: number;
  /** The rule's subaccount; the funds end up here. */
  targetSubaccountId: number;
  agentBsc: Address;
  /** One idempotency key per top-up. Each step uses `${key}:${step}`. */
  key: string;
  /** Return true (or the stored ref string) if the step already finished. */
  isDone: (stepKey: string) => boolean | string | undefined | Promise<boolean | string | undefined>;
  markDone: (stepKey: string, ref?: string) => void | Promise<void>;
  deps?: {
    bridge?: typeof bridgeToEthereum; waitBridge?: typeof waitForBridge; deposit?: typeof depositToNewSubaccount;
    credit?: typeof waitForCredit; consolidate?: typeof consolidate; eth?: EthIo; poll?: PollOpts;
  };
}

/** Runs bridge -> bridge_wait -> deposit -> credit -> consolidate. Stops at the first failure. Safe to re-run: finished steps are skipped. */
export async function fundDeriveSubaccount(a: FundArgs): Promise<StepResult[]> {
  const out: StepResult[] = []; const d = a.deps ?? {};
  const k = (s: StepName) => `${a.key}:${s}`;
  const prior = async (s: StepName) => { const v = await a.isDone(k(s)); return v ? (typeof v === 'string' ? v : '') : null; };
  const run = async (step: StepName, fn: () => Promise<{ ref?: string; detail?: string }>): Promise<string | null> => {
    const done = await prior(step);
    if (done !== null) { out.push({ step, status: 'done', detail: 'already done, skipped', ref: done || undefined }); return done; }
    try {
      const r = await fn();
      await a.markDone(k(step), r.ref);
      out.push({ step, status: 'done', detail: r.detail, ref: r.ref });
      return r.ref ?? '';
    } catch (e) {
      out.push({ step, status: 'failed', detail: e instanceof Error ? e.message : String(e) });
      return null;
    }
  };
  let eth: EthIo | undefined = d.eth;
  const ethIo = () => (eth ??= viemEth(a.n));
  const known = new Set<number>([a.creds.subaccountId, a.targetSubaccountId]);

  const reqId = await run('bridge', async () => {
    const agentEth = ethIo().address;
    const r = await (d.bridge ?? bridgeToEthereum)({ depositor: a.agentBsc, recipient: agentEth, amountBase: a.amountBase });
    return { ref: r.requestId, detail: `relay ${r.requestId}, min out ${r.minOutBase}` };
  });
  if (reqId === null) return out;
  if (await run('bridge_wait', async () => { await (d.waitBridge ?? waitForBridge)(reqId, d.poll); return { detail: 'USDC on Ethereum' }; }) === null) return out;

  const depositRef = await run('deposit', async () => {
    // Deposit what actually arrived, never more than requested.
    const bal = await ethIo().usdcBalance();
    const req = BigInt(a.amountBase);
    const amt = bal < req ? bal : req;
    try { for (const s of await listSubaccounts(a.n, a.wallet, a.creds)) known.add(s.subaccount_id); } catch { /* best effort: waitForCredit also excludes the fallback and known ids */ }
    const r = await (d.deposit ?? depositToNewSubaccount)({ n: a.n, owner: a.wallet, amountBase: amt.toString(), managerId: a.managerId, eth: ethIo() });
    return { ref: r.txHash, detail: `deposited ${amt} base units` };
  });
  if (depositRef === null) return out;
  if (!depositRef) { out.push({ step: 'credit', status: 'failed', detail: 'deposit is marked done but has no tx hash ref; cannot track the credit' }); return out; }

  const newSub = await run('credit', async () => {
    const r = await (d.credit ?? waitForCredit)({ n: a.n, wallet: a.wallet, creds: a.creds, txHash: depositRef, knownIds: [...known], ...d.poll });
    return { ref: String(r.subaccountId), detail: `new subaccount ${r.subaccountId}` };
  });
  if (newSub === null) return out;
  if (!newSub) { out.push({ step: 'consolidate', status: 'failed', detail: 'credit is marked done but has no subaccount ref' }); return out; }

  await run('consolidate', async () => {
    const r = await (d.consolidate ?? consolidate)({ n: a.n, wallet: a.wallet, creds: a.creds, fromSubaccountId: Number(newSub), toSubaccountId: a.targetSubaccountId });
    return { ref: r.opUuid ?? undefined, detail: `moved ${r.amountUsd} USDC to subaccount ${a.targetSubaccountId}` };
  });
  return out;
}
