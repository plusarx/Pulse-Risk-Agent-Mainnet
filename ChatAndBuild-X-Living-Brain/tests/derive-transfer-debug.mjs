// Checks our transfer_spot signing against Derive's private/transfer_spot_debug (computes hashes, moves NOTHING).
// Usage: node tests/derive-transfer-debug.mjs <wallet> [network=testnet]   (server must be running; reads .env.local)
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, getAddress, keccak256, concat, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const wallet = getAddress(process.argv[2]);
const network = process.argv[3] ?? 'testnet';
const D = network === 'testnet' ? 'https://testnet.api.derive.xyz/v3' : 'https://api.derive.xyz/v3';
const CHAIN = network === 'testnet' ? 11155111n : 1n;
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const cred = await (await fetch(`http://localhost:3100/api/agent/v1/credentials?wallet=${wallet.toLowerCase()}&venue=derive&network=${network}`, { headers: { authorization: `Bearer ${env.AGENT_API_TOKEN}` } })).json();
const key = privateKeyToAccount(cred.sessionPrivateKey);
const headers = async () => { const ts = String(Date.now()); return { 'content-type': 'application/json', 'X-DeriveWallet': wallet, 'X-DeriveTimestamp': ts, 'X-DeriveSignature': await key.signMessage({ message: ts }) }; };

const TRANSFER = '0x01259207A40925b794C8ac320456F7F6c8FE2636';
const ASSET = '0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b';
const from = cred.subaccountId; const nonce = (BigInt(Date.now()) * 1_000_000n + 123456n).toString(); const expiry = Math.floor(Date.now() / 1000) + 600;
const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [0n, 2n, ASSET, 0n, 10n * 10n ** 18n, 2n * 10n ** 18n]);
const domain = { name: 'Matching', version: '1.0', chainId: Number(CHAIN), verifyingContract: '0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD' };
const types = { Action: [{ name: 'subaccountId', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'module', type: 'address' }, { name: 'data', type: 'bytes' }, { name: 'expiry', type: 'uint256' }, { name: 'owner', type: 'address' }, { name: 'signer', type: 'address' }] };
const message = { subaccountId: BigInt(from), nonce: BigInt(nonce), module: TRANSFER, data, expiry: BigInt(expiry), owner: wallet, signer: key.address };
const signature = await key.signTypedData({ domain, types, primaryType: 'Action', message });
const TYPEHASH = keccak256(toBytes('Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)'));
const ourActionHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }],
  [TYPEHASH, BigInt(from), BigInt(nonce), TRANSFER, keccak256(data), BigInt(expiry), wallet, key.address]));

const body = { subaccount_id: from, to_subaccount_id: 0, new_subaccount_manager: 2, asset_name: 'USDC', sub_id: 0, amount: '10', max_fee_usd: '2', nonce, signer: key.address, signature, signature_expiry_sec: expiry };
const r = await (await fetch(`${D}/private/transfer_spot_debug`, { method: 'POST', headers: await headers(), body: JSON.stringify(body) })).json();
if (r.error) { console.log('debug endpoint error:', JSON.stringify(r.error)); process.exit(1); }
const res = r.result;
console.log('derive keys:', Object.keys(res));
const flat = JSON.stringify(res).toLowerCase();
console.log('encoded data matches  :', flat.includes(data.slice(2).toLowerCase()));
console.log('action hash matches   :', flat.includes(ourActionHash.slice(2).toLowerCase()));
void concat;
