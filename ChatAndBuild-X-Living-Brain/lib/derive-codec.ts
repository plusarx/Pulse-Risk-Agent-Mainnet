import { concat, encodeAbiParameters, getAddress, keccak256, toBytes, type Address, type Hex } from 'viem';
import { DERIVE, DERIVE_MATCHING } from './venues';
import type { VenueNetwork } from './network';
import { scaleDecimal } from './decimal';

// Derive v3 action signing — ported from manager-service/src/derive/v3/codec.ts and
// algo-engine/src/adapters/derive/sign.rs (both oracle-checked against Derive's *_debug endpoints).

export const ACTION_TYPEHASH = keccak256(toBytes('Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)'));

export interface ActionFields { subaccountId: number; nonce: string; module: Address; data: Hex; expirySec: number; owner: Address; signer: Address }

export function domainSeparator(n: VenueNetwork): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
    [keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
      keccak256(toBytes('Matching')), keccak256(toBytes('1.0')), BigInt(DERIVE[n].chainId), DERIVE_MATCHING],
  ));
}

export function actionHash(f: ActionFields): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }],
    [ACTION_TYPEHASH, BigInt(f.subaccountId), BigInt(f.nonce), getAddress(f.module), keccak256(f.data), BigInt(f.expirySec), getAddress(f.owner), getAddress(f.signer)],
  ));
}

export function actionDigest(f: ActionFields, n: VenueNetwork): Hex {
  return keccak256(concat(['0x1901', domainSeparator(n), actionHash(f)]));
}

/** EIP-712 typed data for MetaMask (viem/wagmi adds EIP712Domain itself). bigints as strings for JSON. */
export function actionTypedData(f: ActionFields, n: VenueNetwork) {
  return {
    domain: { name: 'Matching', version: '1.0', chainId: DERIVE[n].chainId, verifyingContract: DERIVE_MATCHING },
    types: { Action: [
      { name: 'subaccountId', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'module', type: 'address' },
      { name: 'data', type: 'bytes' }, { name: 'expiry', type: 'uint256' }, { name: 'owner', type: 'address' }, { name: 'signer', type: 'address' },
    ] },
    primaryType: 'Action' as const,
    message: { subaccountId: String(f.subaccountId), nonce: f.nonce, module: getAddress(f.module), data: f.data, expiry: String(f.expirySec), owner: getAddress(f.owner), signer: getAddress(f.signer) },
  };
}

export function encodeSetSessionKeyData(key: Address, expirySec: number, scopes: readonly number[], subaccountIds: readonly number[] = []): Hex {
  // Custody guard: never sign admin(0), set_session_key(15), transfer:all(11), different_owner(14).
  for (const s of scopes) if ([0, 11, 14, 15].includes(s)) throw new Error(`refusing to sign dangerous scope ${s}`);
  return encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint256[]' }, { type: 'uint256[]' }],
    [getAddress(key), BigInt(expirySec), scopes.map(BigInt), subaccountIds.map(BigInt)]);
}

export function encodeWhitelistData(add: readonly Address[], remove: readonly Address[] = []): Hex {
  return encodeAbiParameters([{ type: 'address[]' }, { type: 'address[]' }], [add.map((a) => getAddress(a)), remove.map((a) => getAddress(a))]);
}

/** TradeModuleData: (asset, subId, limitPrice, amount, maxFee, recipientId, isBid). Decimals ×1e18. */
export function encodeTradeData(f: { asset: Address; subId: string; limitPrice: string; amount: string; maxFee: string; recipientId: number; isBid: boolean }): Hex {
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'int256' }, { type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }],
    [getAddress(f.asset), BigInt(f.subId), scaleDecimal(f.limitPrice, 18), scaleDecimal(f.amount, 18), scaleDecimal(f.maxFee, 18), BigInt(f.recipientId), f.isBid],
  );
}

let lastNonce = 0n;
/** v3 nonce: UTC nanoseconds (ms × 1e6 + 6-digit suffix), strictly increasing per process. */
export function nextNonce(nowMs = Date.now()): string {
  let c = BigInt(Math.floor(nowMs)) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000));
  if (c <= lastNonce) c = lastNonce + 1n;
  lastNonce = c;
  return c.toString();
}

/** TransferModuleData: (toSubaccountId, newSubaccountManager, asset (protocol USDC), subId, amount×1e18, maxFeeUsd×1e18). */
export function encodeTransferData(f: { toSubaccountId: number; newSubaccountManager: number; asset: Address; amount: string; maxFeeUsd: string }): Hex {
  const amount = scaleDecimal(f.amount, 18);
  if (amount <= 0n) throw new Error('transfer amount must be positive');
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [BigInt(f.toSubaccountId), BigInt(f.newSubaccountManager), getAddress(f.asset), 0n, amount, scaleDecimal(f.maxFeeUsd, 18)],
  );
}

/**
 * WithdrawalData: (asset (protocol USDC), maxFeeUsd×1e18, recipient, amount in the ERC-20's own decimals
 * (USDC = 6, NOT 1e18), forceBatch). Checked against Derive's public/withdraw_debug `encoded_data`.
 */
export function encodeWithdrawData(f: { asset: Address; maxFeeUsd: string; recipient: Address; amount: string; forceBatch?: boolean }): Hex {
  const amount = scaleDecimal(f.amount, 6);
  if (amount <= 0n) throw new Error('withdraw amount must be positive');
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'bool' }],
    [getAddress(f.asset), scaleDecimal(f.maxFeeUsd, 18), getAddress(f.recipient), amount, f.forceBatch ?? false],
  );
}

export interface DeriveUniverse { id: number; name: string; managers: { managerId: number; marginType: string }[]; families: string[] }

/** Which universe trades a currency's options/perps, from get_risk_universes `instruments` families ("HYPE-OPTION"). */
export function universeFor(universes: DeriveUniverse[], currency: string, kind: 'OPTION' | 'PERP' = 'OPTION'): DeriveUniverse | undefined {
  return universes.find((u) => u.families.includes(`${currency}-${kind}`));
}
