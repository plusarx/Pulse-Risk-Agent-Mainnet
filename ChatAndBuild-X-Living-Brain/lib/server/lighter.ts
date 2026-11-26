import 'server-only';
import { readFile } from 'node:fs/promises';
import { runInThisContext } from 'node:vm';
import path from 'node:path';
import { getAddress, type Address } from 'viem';
import type { VenueNetwork } from '@/lib/network';
import { LIGHTER, LIGHTER_API_KEY_INDEX, LIGHTER_USDC_ASSET } from '@/lib/venues';
import { scaleDecimal } from '@/lib/decimal';
import { getDb } from './db';
import { decryptSecret, encryptSecret } from './crypto';
import { promotePending, readPending, writePending, type PendingRow } from './keystore';
import type { HistoryRow } from '@/lib/order-history';

// Lighter L2 txs are signed with an ECgFp5/Poseidon key. There is no JS implementation, so we
// run Lighter's official Go signer (lighter-go v1.0.13, ./wasm) compiled to WebAssembly.
// Built from source: see vendor/lighter/README.md. All HTTP is done here in JS — the Go HTTP
// stack inside the wasm can't dial out, so nonces are always passed explicitly (never -1).

type SignOut = { txType?: number; txInfo?: string; txHash?: string; messageToSign?: string; error?: string };
interface Signer {
  GenerateAPIKey(): { privateKey?: string; publicKey?: string; error?: string };
  CreateClient(url: string, pk: string, chainId: number, apiKeyIndex: number, accountIndex: number): { error?: string };
  SignChangePubKey(pub: string, skipNonce: number, nonce: number, keyIdx: number, acct: number): SignOut;
  SignCreateOrder(...a: number[]): SignOut;
  SignCancelOrder(marketIndex: number, orderIndex: number, skipNonce: number, nonce: number, keyIdx: number, acct: number): SignOut;
  SignCreateSubAccount(skipNonce: number, nonce: number, keyIdx: number, acct: number): SignOut;
  SignTransfer(toAccountIndex: number, assetIndex: number, fromRouteType: number, toRouteType: number, amount: number, usdcFee: number, memo: string, skipNonce: number, nonce: number, keyIdx: number, acct: number): SignOut;
  /** Secure withdraw (tx 13): no destination field, so it can only pay the account's own L1 owner. */
  SignWithdraw(assetIndex: number, routeType: number, amount: number, skipNonce: number, nonce: number, keyIdx: number, acct: number): SignOut;
  CreateAuthToken(deadline: number, keyIdx: number, acct: number): { authToken?: string; error?: string };
}

let signerP: Promise<Signer> | null = null;
function signer(): Promise<Signer> {
  signerP ??= (async () => {
    const dir = process.env.LIGHTER_WASM_DIR || path.join(process.cwd(), 'vendor', 'lighter');
    // Evaluate Go's wasm_exec.js shim directly (it defines globalThis.Go). A plain require() here is
    // rewritten by the Next.js server bundler and fails at runtime with "Cannot find module".
    const shim = path.join(dir, 'wasm_exec.js');
    runInThisContext(await readFile(shim, 'utf8'), { filename: shim });
    const g = globalThis as unknown as { Go: new () => { importObject: WebAssembly.Imports; run(i: WebAssembly.Instance): Promise<void> } };
    const go = new g.Go();
    const mod = await WebAssembly.compile(new Uint8Array(await readFile(path.join(dir, 'lighter-signer.wasm'))));
    const instance = await WebAssembly.instantiate(mod, go.importObject);
    void go.run(instance).catch((e: unknown) => console.error('[lighter] wasm runtime exited', e));
    const s = globalThis as unknown as Signer;
    if (typeof s.CreateClient !== 'function') throw new Error('Lighter signer did not register');
    return s;
  })();
  signerP.catch(() => { signerP = null; });
  return signerP;
}

/** Health probe: loads the signer and generates a throwaway key (nothing is stored or returned). */
export async function lighterSignerHealthy(): Promise<boolean> {
  const s = await signer();
  return !!s.GenerateAPIKey().publicKey;
}

// ── REST ──────────────────────────────────────────────────────────────────────
interface LighterResp { code?: number; message?: string }

export async function lighterGet<T>(n: VenueNetwork, p: string, params: Record<string, string | number> = {}): Promise<T & LighterResp> {
  const u = new URL(`${LIGHTER[n].rest}/api/v1/${p}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetch(u, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  const text = await r.text();
  let j: T & LighterResp;
  try { j = JSON.parse(text) as T & LighterResp; } catch {
    // Not JSON (e.g. "404 page not found" / gateway HTML): the venue API itself is down, not our request.
    throw new Error(`Lighter ${n} API is unavailable right now (HTTP ${r.status}). Try again shortly.`);
  }
  // Lighter reports domain errors (e.g. 21100 account not found) as HTTP 400 with a code — return
  // those to the caller to interpret; only transport-level failures throw.
  if (!r.ok && typeof j.code !== 'number') throw new Error(`lighter ${p} HTTP ${r.status}: ${j.message ?? ''}`);
  return j;
}

async function sendTx(n: VenueNetwork, txType: number, txInfo: string): Promise<{ tx_hash: string }> {
  const body = new URLSearchParams({ tx_type: String(txType), tx_info: txInfo, price_protection: 'true' });
  const r = await fetch(`${LIGHTER[n].rest}/api/v1/sendTx`, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
  const j = (await r.json().catch(() => ({}))) as { code?: number; message?: string; tx_hash?: string };
  // Lighter returns HTTP 200 with code != 200 on rejection.
  if (!r.ok || j.code !== 200 || !j.tx_hash) throw new Error(`lighter sendTx rejected: ${j.code ?? r.status} ${j.message ?? ''}`.trim());
  return { tx_hash: j.tx_hash };
}

async function nextNonce(n: VenueNetwork, acct: number, keyIdx: number): Promise<number> {
  const j = await lighterGet<{ nonce: number }>(n, 'nextNonce', { account_index: acct, api_key_index: keyIdx });
  if (typeof j.nonce !== 'number') throw new Error(`lighter nextNonce: ${j.message ?? 'no nonce'}`);
  return j.nonce;
}

export interface LighterSubAccount { index: number; account_type: number; l1_address: string; collateral?: string }

/** Master account index for an L1 address, or null if no deposit has created one yet (code 21100). */
export async function findLighterAccount(n: VenueNetwork, l1: Address): Promise<number | null> {
  const j = await lighterGet<{ sub_accounts?: LighterSubAccount[] }>(n, 'accountsByL1Address', { l1_address: l1 });
  if (j.code === 21100 || !j.sub_accounts?.length) return null;
  const master = j.sub_accounts.find((a) => a.account_type === 0) ?? j.sub_accounts[0];
  return master.index;
}

export interface LighterPosition { market_id: number; symbol: string; sign: number; position: string; avg_entry_price: string; position_value: string; unrealized_pnl: string; liquidation_price: string; initial_margin_fraction: string; margin_mode: number; allocated_margin: string }
export interface LighterAccount { index: number; l1_address: string; collateral: string; available_balance: string; total_asset_value: string; cross_asset_value: string; cross_initial_margin_requirement?: string; cross_maintenance_margin_requirement?: string; positions: LighterPosition[] }

export async function getLighterAccount(n: VenueNetwork, index: number): Promise<LighterAccount | null> {
  const j = await lighterGet<{ accounts?: LighterAccount[] }>(n, 'account', { by: 'index', value: index });
  return j.accounts?.[0] ?? null;
}

// ── Agent key storage ────────────────────────────────────────────────────────
const aad = (wallet: string, n: VenueNetwork) => `lighter|${n}|${wallet.toLowerCase()}`;

interface KeyRow { account_ref: string; key_ref: string; public_key: string; enc_secret: string; status: string; meta: string | null }
function keyRow(wallet: string, n: VenueNetwork): KeyRow | undefined {
  return getDb().prepare("SELECT account_ref, key_ref, public_key, enc_secret, status, meta FROM agent_keys WHERE wallet = ? AND venue = 'lighter' AND network = ?")
    .get(wallet.toLowerCase(), n) as KeyRow | undefined;
}

interface KeyMeta { registeredTx?: string; subs?: number[]; pendingSub?: { index: number; txType: number; txInfo: string } }
const metaOf = (row: KeyRow): KeyMeta => (row.meta ? (JSON.parse(row.meta) as KeyMeta) : {});

/**
 * Signer client for one of the wallet's Lighter accounts. The SAME agent key is registered on the master
 * and on each sub-account the user enabled (Lighter allows one public key on several accounts), so a
 * sub-account just needs its index in meta.subs.
 */
async function clientFor(n: VenueNetwork, wallet: string, accountIndex?: number): Promise<{ s: Signer; acct: number; keyIdx: number; master: number }> {
  const row = keyRow(wallet, n);
  if (!row || row.status !== 'active') throw new Error('No active Lighter agent key — register one on the Agent keys page');
  const master = Number(row.account_ref); const keyIdx = Number(row.key_ref);
  const acct = accountIndex ?? master;
  if (acct !== master && !(metaOf(row).subs ?? []).includes(acct)) {
    throw new Error(`The agent key isn't registered on Lighter sub-account #${acct} yet — enable it under Perps → Sub-accounts`);
  }
  const s = await signer();
  const res = s.CreateClient('', decryptSecret(row.enc_secret, aad(wallet, n)), LIGHTER[n].chainId, keyIdx, acct);
  if (res?.error) throw new Error(`lighter CreateClient: ${res.error}`);
  return { s, acct, keyIdx, master };
}

function setMeta(wallet: string, n: VenueNetwork, meta: KeyMeta) {
  getDb().prepare("UPDATE agent_keys SET meta = ? WHERE wallet = ? AND venue = 'lighter' AND network = ?").run(JSON.stringify(meta), wallet.toLowerCase(), n);
}

/**
 * Step 1 of agent registration: generate the API key server-side (it never leaves the server),
 * sign the ChangePubKey L2 tx, and return the exact message MetaMask must personal_sign.
 */
export async function prepareLighterKey(n: VenueNetwork, wallet: Address): Promise<{ accountIndex: number; messageToSign: string; publicKey: string }> {
  const acct = await findLighterAccount(n, wallet);
  if (acct === null) throw new Error('No Lighter account for this wallet yet — deposit first (the first deposit creates the account)');
  const s = await signer();
  const k = s.GenerateAPIKey();
  if (!k.privateKey || !k.publicKey) throw new Error(`lighter GenerateAPIKey: ${k.error ?? 'empty'}`);
  const keyIdx = LIGHTER_API_KEY_INDEX;
  const c = s.CreateClient('', k.privateKey, LIGHTER[n].chainId, keyIdx, acct);
  if (c?.error) throw new Error(`lighter CreateClient: ${c.error}`);
  const nonce = await nextNonce(n, acct, keyIdx);
  const tx = s.SignChangePubKey(k.publicKey, 0, nonce, keyIdx, acct);
  if (tx.error || !tx.txInfo || !tx.messageToSign) throw new Error(`lighter SignChangePubKey: ${tx.error ?? 'empty'}`);
  // Pending only: the current working key stays active until Lighter confirms this one.
  writePending(wallet, 'lighter', n, {
    account_ref: String(acct), key_ref: String(keyIdx), public_key: k.publicKey, enc_secret: encryptSecret(k.privateKey, aad(wallet, n)),
    scope: 'trade,transfer,withdraw-to-owner', expires_at: null, meta: JSON.stringify({ txType: tx.txType, txInfo: tx.txInfo }),
  });
  return { accountIndex: acct, messageToSign: tx.messageToSign, publicKey: k.publicKey };
}

async function pendingKeyIsLive(n: VenueNetwork, p: PendingRow): Promise<boolean> {
  const j = await lighterGet<{ api_keys?: { public_key: string }[] }>(n, 'apikeys', { account_index: Number(p.account_ref), api_key_index: Number(p.key_ref) }).catch(() => null);
  const want = p.public_key.replace(/^0x/, '').toLowerCase();
  return !!j?.api_keys?.some((k) => k.public_key.replace(/^0x/, '').toLowerCase() === want);
}

/** Step 2: attach the owner's L1 signature, submit ChangePubKey, and wait until the key is live. */
export async function finalizeLighterKey(n: VenueNetwork, wallet: Address, l1Sig: `0x${string}`): Promise<{ accountIndex: number; apiKeyIndex: number; txHash: string }> {
  const p = readPending(wallet, 'lighter', n);
  if (!p || !p.meta) throw new Error('No pending Lighter registration — start again');
  const meta = JSON.parse(p.meta) as { txType: number; txInfo: string };
  const { tx_hash } = await sendTx(n, meta.txType, JSON.stringify({ ...JSON.parse(meta.txInfo), L1Sig: l1Sig }));
  writePending(wallet, 'lighter', n, { ...p, meta: JSON.stringify({ ...meta, submittedTx: tx_hash }) });
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1_500));
    if (await pendingKeyIsLive(n, p)) {
      // A new master key replaces index 4 on the master only; sub-accounts must be re-enabled with it.
      promotePending(wallet, 'lighter', n, { meta: JSON.stringify({ registeredTx: tx_hash }) });
      return { accountIndex: Number(p.account_ref), apiKeyIndex: Number(p.key_ref), txHash: tx_hash };
    }
  }
  throw new Error(`ChangePubKey submitted (${tx_hash}) but not visible yet — it is picked up automatically when you reload`);
}

/**
 * A submitted Lighter ChangePubKey replaces the old key AT THE VENUE even if our confirmation timed out.
 * On reload, promote the pending key if Lighter now shows it (otherwise the stored key would be stale).
 */
export async function reconcileLighterPending(n: VenueNetwork, wallet: Address): Promise<void> {
  const p = readPending(wallet, 'lighter', n);
  if (!p?.meta || !(JSON.parse(p.meta) as { submittedTx?: string }).submittedTx) return;
  if (await pendingKeyIsLive(n, p)) promotePending(wallet, 'lighter', n, { meta: JSON.stringify({ registeredTx: (JSON.parse(p.meta) as { submittedTx: string }).submittedTx }) });
}

// ── Sub-accounts ─────────────────────────────────────────────────────────────

export interface LighterAccountSummary { index: number; isMaster: boolean; collateral: string; available: string; equity: string; agent: 'active' | 'pending' | 'none' }

/** Every Lighter account the wallet owns (master first), with balances and whether the agent key is on it. */
export async function listLighterAccounts(n: VenueNetwork, wallet: Address): Promise<LighterAccountSummary[]> {
  const j = await lighterGet<{ accounts?: (LighterAccount & { account_type: number })[] }>(n, 'account', { by: 'l1_address', value: getAddress(wallet) });
  if (j.code === 21100 || !j.accounts?.length) return [];
  const row = keyRow(wallet, n);
  const meta = row ? metaOf(row) : {};
  const master = row ? Number(row.account_ref) : j.accounts.find((a) => a.account_type === 0)?.index;
  return j.accounts.map((a) => ({
    index: a.index, isMaster: a.account_type === 0, collateral: a.collateral, available: a.available_balance, equity: a.total_asset_value || a.collateral,
    agent: row?.status !== 'active' ? 'none' as const : a.index === master || (meta.subs ?? []).includes(a.index) ? 'active' as const : meta.pendingSub?.index === a.index ? 'pending' as const : 'none' as const,
  })).sort((x, y) => Number(y.isMaster) - Number(x.isMaster) || x.index - y.index);
}

/** Create a sub-account (signed by the master's agent key, no L1 signature). Returns the new index once it appears. */
export async function createLighterSubaccount(n: VenueNetwork, wallet: Address): Promise<{ txHash: string; index: number | null }> {
  const before = new Set((await listLighterAccounts(n, wallet)).map((a) => a.index));
  const { s, keyIdx, master } = await clientFor(n, wallet);
  const nonce = await nextNonce(n, master, keyIdx);
  const tx = s.SignCreateSubAccount(0, nonce, keyIdx, master);
  if (tx.error || !tx.txInfo || tx.txType === undefined) throw new Error(`lighter SignCreateSubAccount: ${tx.error ?? 'empty'}`);
  const { tx_hash } = await sendTx(n, tx.txType, tx.txInfo);
  // The new index isn't returned — re-read the account list until it shows up.
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1_500));
    const now = await listLighterAccounts(n, wallet).catch(() => []);
    const fresh = now.find((a) => !before.has(a.index));
    if (fresh) return { txHash: tx_hash, index: fresh.index };
  }
  return { txHash: tx_hash, index: null };
}

/**
 * Move USDC between two of the wallet's OWN Lighter accounts (instant; fee measured 0). Signed by the
 * source account's agent key; same-owner transfers need no L1 signature. Refuses any other destination.
 */
export async function transferLighter(n: VenueNetwork, wallet: Address, from: number, to: number, amount: string): Promise<{ txHash: string }> {
  if (from === to) throw new Error('source and destination are the same');
  const mine = await listLighterAccounts(n, wallet);
  const src = mine.find((a) => a.index === from);
  if (!src) throw new Error(`Lighter account #${from} is not yours`);
  if (!mine.some((a) => a.index === to)) throw new Error(`Lighter account #${to} is not yours`);
  const units = scaleDecimal(amount, 6);
  if (units < 1_000_000n) throw new Error('Lighter transfers are at least 1 USDC');
  if (Number(src.available) < Number(amount)) throw new Error(`#${from} has only ${src.available} USDC available`);
  const { s, acct, keyIdx } = await clientFor(n, wallet, from);
  const { token } = await authTokenFor(s, acct, keyIdx);
  const fee = await lighterGet<{ transfer_fee_usdc?: number }>(n, 'transferFeeInfo', { account_index: acct, to_account_index: to, auth: token }).catch(() => ({ transfer_fee_usdc: 0 }));
  const nonce = await nextNonce(n, acct, keyIdx);
  const tx = s.SignTransfer(to, LIGHTER_USDC_ASSET, 0, 0, Number(units), Number(fee.transfer_fee_usdc ?? 0), `0x${'00'.repeat(32)}`, 0, nonce, keyIdx, acct);
  if (tx.error || !tx.txInfo || tx.txType === undefined) throw new Error(`lighter SignTransfer: ${tx.error ?? 'empty'}`);
  const { tx_hash } = await sendTx(n, tx.txType, tx.txInfo);
  return { txHash: tx_hash };
}

/** Lighter's own floor for a USDC withdrawal (assetDetails `min_withdrawal_amount`). */
export const LIGHTER_WITHDRAW_MIN_USD = 1;

/**
 * Secure withdrawal from the MASTER account to the wallet itself on Ethereum (~26 min). Signed by the agent
 * key alone: SignWithdraw has no destination field, so Lighter can only pay the account's L1 owner.
 * Sub-account funds are moved to the master first (transferLighter), which keeps one payout path.
 */
export async function withdrawLighter(n: VenueNetwork, wallet: Address, amount: string): Promise<{ txHash: string; recipient: Address }> {
  if (!/^\d+(\.\d{1,6})?$/.test(amount) || Number(amount) < LIGHTER_WITHDRAW_MIN_USD) throw new Error(`Withdraw at least ${LIGHTER_WITHDRAW_MIN_USD} USDC (≤ 6 decimals)`);
  const { s, acct, keyIdx, master } = await clientFor(n, wallet);
  const mine = await listLighterAccounts(n, wallet);
  const src = mine.find((a) => a.index === master);
  if (!src) throw new Error('Lighter main account not found for this wallet');
  if (Number(src.available) < Number(amount)) throw new Error(`Only ${Number(src.available).toFixed(2)} USDC is free in Main #${master}; close positions, move funds from a sub-account, or withdraw less`);
  const nonce = await nextNonce(n, acct, keyIdx);
  const tx = s.SignWithdraw(LIGHTER_USDC_ASSET, 0, Number(scaleDecimal(amount, 6)), 0, nonce, keyIdx, acct);
  if (tx.error || !tx.txInfo || tx.txType === undefined) throw new Error(`lighter SignWithdraw: ${tx.error ?? 'empty'}`);
  if (tx.txType !== 13) throw new Error(`lighter SignWithdraw returned tx type ${tx.txType}, expected 13`);
  const { tx_hash } = await sendTx(n, tx.txType, tx.txInfo);
  return { txHash: tx_hash, recipient: getAddress(wallet) };
}

/** The master account's withdrawals, newest first. `claimable` = ready on Ethereum; Lighter normally completes it. */
export async function lighterWithdrawals(n: VenueNetwork, wallet: Address): Promise<{ venue: 'lighter'; account: string; amount: string; fee: null; status: string; done: boolean; failed: boolean; timestamp: number; txHash: string | null }[]> {
  const { s, acct, keyIdx } = await clientFor(n, wallet);
  const { token } = await authTokenFor(s, acct, keyIdx);
  const j = await lighterGet<{ withdraws?: { amount: string; status: string; timestamp: number; l1_tx_hash?: string }[] }>(n, 'withdraw/history', { account_index: acct, filter: 'all', auth: token });
  if (typeof j.code === 'number' && j.code !== 200 && !j.withdraws) throw new Error(`lighter withdraw/history: ${j.message ?? j.code}`);
  return (j.withdraws ?? []).map((w) => ({
    venue: 'lighter' as const, account: `Main #${acct}`, amount: w.amount, fee: null, status: w.status,
    done: w.status === 'completed', failed: w.status === 'failed' || w.status === 'refunded',
    // Lighter timestamps are ms on some routes and s on others; normalise to ms.
    timestamp: w.timestamp < 1e12 ? w.timestamp * 1000 : w.timestamp, txHash: w.l1_tx_hash || null,
  })).sort((a, b) => b.timestamp - a.timestamp);
}

/** Register the existing agent key on a sub-account: returns the message MetaMask must personal_sign. */
export async function prepareLighterSubKey(n: VenueNetwork, wallet: Address, subIndex: number): Promise<{ messageToSign: string }> {
  const row = keyRow(wallet, n);
  if (!row || row.status !== 'active') throw new Error('Register the Lighter agent on your main account first');
  const mine = await listLighterAccounts(n, wallet);
  const sub = mine.find((a) => a.index === subIndex);
  if (!sub || sub.isMaster) throw new Error(`#${subIndex} is not one of your Lighter sub-accounts`);
  const s = await signer();
  const keyIdx = Number(row.key_ref);
  const c = s.CreateClient('', decryptSecret(row.enc_secret, aad(wallet, n)), LIGHTER[n].chainId, keyIdx, subIndex);
  if (c?.error) throw new Error(`lighter CreateClient: ${c.error}`);
  const nonce = await nextNonce(n, subIndex, keyIdx);
  const tx = s.SignChangePubKey(row.public_key, 0, nonce, keyIdx, subIndex);
  if (tx.error || !tx.txInfo || !tx.messageToSign || tx.txType === undefined) throw new Error(`lighter SignChangePubKey: ${tx.error ?? 'empty'}`);
  setMeta(wallet, n, { ...metaOf(row), pendingSub: { index: subIndex, txType: tx.txType, txInfo: tx.txInfo } });
  return { messageToSign: tx.messageToSign };
}

export async function finalizeLighterSubKey(n: VenueNetwork, wallet: Address, l1Sig: `0x${string}`): Promise<{ index: number; txHash: string }> {
  const row = keyRow(wallet, n);
  const meta = row ? metaOf(row) : {};
  if (!row || !meta.pendingSub) throw new Error('No pending sub-account registration — start again');
  const { index, txType, txInfo } = meta.pendingSub;
  const { tx_hash } = await sendTx(n, txType, JSON.stringify({ ...JSON.parse(txInfo), L1Sig: l1Sig }));
  const want = row.public_key.replace(/^0x/, '').toLowerCase();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1_500));
    const j = await lighterGet<{ api_keys?: { public_key: string }[] }>(n, 'apikeys', { account_index: index, api_key_index: Number(row.key_ref) }).catch(() => null);
    if (j?.api_keys?.some((k) => k.public_key.replace(/^0x/, '').toLowerCase() === want)) {
      setMeta(wallet, n, { registeredTx: meta.registeredTx, subs: [...new Set([...(meta.subs ?? []), index])] });
      return { index, txHash: tx_hash };
    }
  }
  throw new Error(`Registration submitted (${tx_hash}) but not visible yet — refresh in a moment`);
}

async function authTokenFor(s: Signer, acct: number, keyIdx: number) {
  const t = s.CreateAuthToken(Math.floor(Date.now() / 1000) + 600, keyIdx, acct);
  if (!t.authToken) throw new Error(`lighter CreateAuthToken: ${t.error ?? 'empty'}`);
  return { token: t.authToken };
}

// ── Orders (signed by the agent key; no MetaMask popup) ──────────────────────
export interface LighterMarket { market_id: number; symbol: string; size_decimals: number; price_decimals: number; min_base_amount: string; last_trade_price: number; status?: string }

export async function lighterMarket(n: VenueNetwork, marketId: number): Promise<LighterMarket> {
  const j = await lighterGet<{ order_book_details?: LighterMarket[] }>(n, 'orderBookDetails', { market_id: marketId });
  const m = j.order_book_details?.[0];
  if (!m) throw new Error(`unknown Lighter market ${marketId}`);
  return m;
}

export interface LighterOrderReq { marketId: number; side: 'buy' | 'sell'; size: string; price: string; type: 'limit' | 'market'; reduceOnly?: boolean; postOnly?: boolean; /** Defaults to the master account. */ accountIndex?: number }

export async function placeLighterOrder(n: VenueNetwork, wallet: Address, o: LighterOrderReq): Promise<{ txHash: string; clientOrderIndex: number }> {
  const m = await lighterMarket(n, o.marketId);
  const base = scaleDecimal(o.size, m.size_decimals);
  const price = scaleDecimal(o.price, m.price_decimals);
  if (base <= 0n) throw new Error('size rounds to zero for this market');
  if (base < scaleDecimal(m.min_base_amount, m.size_decimals)) throw new Error(`size below market minimum ${m.min_base_amount}`);
  if (price <= 0n || price > 0xffffffffn) throw new Error('price out of range');
  const { s, acct, keyIdx } = await clientFor(n, wallet, o.accountIndex);
  const nonce = await nextNonce(n, acct, keyIdx);
  const clientOrderIndex = Date.now() % 2 ** 47;
  const isMarket = o.type === 'market';
  const tif = isMarket ? 0 /* IOC */ : o.postOnly ? 2 : 1 /* GTT */;
  const expiry = isMarket ? 0 : -1; // -1 → signer default (28 days)
  const tx = s.SignCreateOrder(
    o.marketId, clientOrderIndex, Number(base), Number(price), o.side === 'sell' ? 1 : 0, isMarket ? 1 : 0, tif,
    o.reduceOnly ? 1 : 0, 0, expiry, 0, 0, 0, 0, 0, 0, nonce, keyIdx, acct,
  );
  if (tx.error || !tx.txInfo || tx.txType === undefined) throw new Error(`lighter SignCreateOrder: ${tx.error ?? 'empty'}`);
  const { tx_hash } = await sendTx(n, tx.txType, tx.txInfo);
  return { txHash: tx_hash, clientOrderIndex };
}

export async function cancelLighterOrder(n: VenueNetwork, wallet: Address, marketId: number, orderIndex: number, accountIndex?: number): Promise<{ txHash: string }> {
  const { s, acct, keyIdx } = await clientFor(n, wallet, accountIndex);
  const nonce = await nextNonce(n, acct, keyIdx);
  const tx = s.SignCancelOrder(marketId, orderIndex, 0, nonce, keyIdx, acct);
  if (tx.error || !tx.txInfo || tx.txType === undefined) throw new Error(`lighter SignCancelOrder: ${tx.error ?? 'empty'}`);
  const { tx_hash } = await sendTx(n, tx.txType, tx.txInfo);
  return { txHash: tx_hash };
}

/** Short-lived auth token for private reads (active orders). */
export async function lighterAuthToken(n: VenueNetwork, wallet: Address, accountIndex?: number): Promise<{ token: string; acct: number }> {
  const { s, acct, keyIdx } = await clientFor(n, wallet, accountIndex);
  const t = s.CreateAuthToken(Math.floor(Date.now() / 1000) + 600, keyIdx, acct);
  if (!t.authToken) throw new Error(`lighter CreateAuthToken: ${t.error ?? 'empty'}`);
  return { token: t.authToken, acct };
}

export interface LighterOrderView { order_index: number; client_order_index: number; market_index: number; is_ask: boolean; price: string; initial_base_amount: string; remaining_base_amount: string; type: string; status: string; reduce_only: boolean }

/** Finished (filled or canceled) orders across every Lighter account the agent key is on, newest first. */
export async function lighterOrderHistory(n: VenueNetwork, wallet: Address, limit = 50): Promise<HistoryRow[]> {
  const row = keyRow(wallet, n);
  if (!row || row.status !== 'active') return [];
  const accts = [Number(row.account_ref), ...(metaOf(row).subs ?? [])];
  const out: HistoryRow[] = [];
  for (const a of accts.slice(0, 6)) {
    const { token, acct } = await lighterAuthToken(n, wallet, a);
    const j = await lighterGet<{ orders?: (LighterOrderView & { order_id?: string; market_symbol?: string; filled_base_amount: string; filled_quote_amount: string; timestamp: number })[] }>(
      n, 'accountInactiveOrders', { account_index: acct, limit, auth: token });
    // Transaction hash per order: Lighter puts it on each fill (trades API); a missing read just leaves it empty.
    const hashOf = new Map<string, string>();
    try {
      const t = await lighterGet<{ trades?: { tx_hash?: string; bid_id_str?: string; ask_id_str?: string; bid_account_id?: number; ask_account_id?: number }[] }>(
        n, 'trades', { account_index: acct, sort_by: 'timestamp', limit: 100, auth: token });
      for (const tr of t.trades ?? []) {
        if (!tr.tx_hash) continue;
        const mine = tr.bid_account_id === acct ? tr.bid_id_str : tr.ask_account_id === acct ? tr.ask_id_str : undefined;
        if (mine && !hashOf.has(mine)) hashOf.set(mine, tr.tx_hash);
      }
    } catch { /* no hashes this time */ }
    for (const o of j.orders ?? []) {
      const filled = Number(o.filled_base_amount);
      out.push({
        venue: 'lighter', time: o.timestamp < 1e12 ? o.timestamp * 1000 : o.timestamp, market: o.market_symbol ? `${o.market_symbol}-PERP` : `market ${o.market_index}`,
        side: o.is_ask ? 'sell' : 'buy', type: o.type, size: o.initial_base_amount, filled: o.filled_base_amount,
        avgPrice: filled > 0 ? (Number(o.filled_quote_amount) / filled).toString() : null,
        status: o.status, account: a === Number(row.account_ref) ? `Main #${a}` : `Sub #${a}`, txHash: hashOf.get(String(o.order_id ?? (o as { order_index?: number }).order_index)) ?? null,
      });
    }
  }
  return out.sort((x, y) => y.time - x.time).slice(0, limit);
}

/** What happened to one order, found by its client order index. `pending` = not on the book or in history yet. */
export interface LighterOrderOutcome {
  state: 'pending' | 'open' | 'filled' | 'partial' | 'canceled';
  /** Lighter's status string, e.g. 'canceled-margin-not-allowed'. */
  status: string | null;
  size: string | null; filled: string | null; avgPrice: string | null;
}

export async function lighterOrderOutcome(n: VenueNetwork, wallet: Address, marketId: number, clientOrderIndex: number, accountIndex?: number): Promise<LighterOrderOutcome> {
  const { token, acct } = await lighterAuthToken(n, wallet, accountIndex);
  const active = await lighterGet<{ orders?: LighterOrderView[] }>(n, 'accountActiveOrders', { account_index: acct, market_id: marketId, auth: token });
  const open = active.orders?.find((o) => Number(o.client_order_index) === clientOrderIndex);
  if (open) {
    const filled = (Number(open.initial_base_amount) - Number(open.remaining_base_amount)).toString();
    return { state: 'open', status: open.status, size: open.initial_base_amount, filled, avgPrice: null };
  }
  const done = await lighterGet<{ orders?: (LighterOrderView & { filled_base_amount: string; filled_quote_amount: string })[] }>(
    n, 'accountInactiveOrders', { account_index: acct, market_id: marketId, limit: 20, auth: token });
  const o = done.orders?.find((x) => Number(x.client_order_index) === clientOrderIndex);
  if (!o) return { state: 'pending', status: null, size: null, filled: null, avgPrice: null };
  const filled = Number(o.filled_base_amount);
  const avgPrice = filled > 0 ? (Number(o.filled_quote_amount) / filled).toString() : null;
  const state = o.status === 'filled' ? 'filled' : filled > 0 ? 'partial' : 'canceled';
  return { state, status: o.status, size: o.initial_base_amount, filled: o.filled_base_amount, avgPrice };
}

export async function getLighterActiveOrders(n: VenueNetwork, wallet: Address, extraMarketIds: number[] = [], accountIndex?: number): Promise<LighterOrderView[]> {
  const { token, acct } = await lighterAuthToken(n, wallet, accountIndex);
  const acctInfo = await getLighterAccount(n, acct);
  // accountActiveOrders is per market: query the markets with a position plus the one being viewed.
  const ids = new Set<number>([...(acctInfo?.positions ?? []).map((p) => p.market_id), ...extraMarketIds]);
  const out: LighterOrderView[] = [];
  for (const id of [...ids].slice(0, 10)) {
    const j = await lighterGet<{ orders?: LighterOrderView[] }>(n, 'accountActiveOrders', { account_index: acct, market_id: id, auth: token });
    out.push(...(j.orders ?? []));
  }
  return out;
}
