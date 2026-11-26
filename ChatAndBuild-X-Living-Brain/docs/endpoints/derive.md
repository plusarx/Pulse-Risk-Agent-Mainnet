# Derive v3 — endpoint reference for the agent

Researched 2026-11-23 against `docs.derive.xyz` (openapi "Derive v3 API 0.2.0"), live calls on both networks, and our own code.
Tags: **VERIFIED-doc** (docs page) · **VERIFIED-live** (curled 2026-11-23) · **VERIFIED-ours** (our code / testnet notes) · **UNVERIFIED**.

## 0. Read first

1. **v2 is dead; v3 is live on both networks.** `api.lyra.finance` → 521. Auth headers are `X-Derive*` (not `X-Lyra*`). Deposits are on Ethereum L1 (no `private/deposit`). No smart-contract wallets — the MetaMask EOA *is* the account. (VERIFIED-live)
2. **REST is CORS-blocked from browsers** (only `app.derive.xyz` is allowed). Call REST from a server. This app proxies public methods at `POST /api/derive/<method>?network=`. WebSocket works from any origin. (VERIFIED-live)
3. **Docs vs live disagreements — trust live:**

| Topic | Docs | Live / our tests |
|---|---|---|
| `withdraw.amount_in_underlying` | native units | **human decimal** (`"3"` = 3 USDC). Sending native units asks for 1e6× too much. (VERIFIED-live `withdraw_debug`) |
| Min deposit | $10 | `min_deposit_usd: "5"` (read `get_risk_universes` live). **Below the minimum the deposit is donated and lost.** |
| Min order signature expiry | 10 s | testnet refuses < 1920 s (`11011`); max 7,776,000 s |
| Session-key revoke | expiry 0 | API needs expiry ≥ now+300 s |
| Session key withdrawing to owner | always allowed | our testnet run got `11033` until the owner was whitelisted → **whitelist the owner at onboarding** (this app does) |

4. **Deposits are Ethereum-only** (mainnet chainId 1, testnet Sepolia 11155111). No BNB Chain route. Relay does **not** support Derive (chain 957 unsupported) → BSC → Relay → Ethereum USDC → Derive deposit.
5. **Trade with a session key**, not MetaMask — every order is its own EIP-712 signature.

## 1. URLs, chains

| | Mainnet | Testnet |
|---|---|---|
| REST (`POST {base}/{method}`, flat JSON params) | `https://api.derive.xyz/v3` | `https://testnet.api.derive.xyz/v3` |
| WebSocket | `wss://api.derive.xyz/v3/ws` | `wss://testnet.api.derive.xyz/v3/ws` |
| EIP-712 chainId | `1` | `11155111` |

Errors: `{error:{code,message,data}}`. `transaction_id` is now `op_uuid`; `batch_status`: Batching → Executing → Da → Proving → Settling → Settled.

### Contracts (VERIFIED-doc)

| Contract | Mainnet | Testnet (Sepolia) |
|---|---|---|
| ACTION_MANAGER | `0xE366CcA474968e33b777E13905829A3b800CFAD3` | `0xd3625eCf97E5554C62A48Ac1c9284C9dCeFceB68` |
| WITHDRAWAL_OUTBOX | `0x7c743D79C9C595cE332314503d84cBBb4E85FA63` | `0xFbB62CE2BbFdFdc8a60DDC22115aC29cf91B4566` |
| USDC protocol asset (deposit `asset`) | `0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b` | same |
| USDC ERC-20 (approve + send) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` (6 dp) | mock `0x73Efab09362052D26FB93A730Be4F8a5EdC833af` (6 dp, public `mint`) |

## 2. Account model

- Wallet = MetaMask EOA (`owner`, `X-DeriveWallet`). Subaccount = numeric id holding collateral + positions; one manager (margin type) each.
- Managers (identical ids on both nets): PRIME (BTC/ETH) SM=1 / PM2=5 · MIDCAP (HYPE) 2/6 · ALT (SOL, XRP, BNB-PERP…) 3/7 · **RWA (NVDA, US100, US500, WTI, XAUT) 4/8**. Trades never cross universes.
- **No create-account call.** The first credited L1 deposit creates the account + subaccount (and a non-trading fallback subaccount, manager 0). Before that, `private/*` returns `14000 Account not found`.
- Instrument names: `ETH-PERP`, `ETH-20261124-1700-C` (`<CCY>-<YYYYMMDD>-<STRIKE>-<C|P>`).

## 3. Session key ("agent")

### Auth headers
`X-DeriveWallet: <owner>`, `X-DeriveTimestamp: <ms>`, `X-DeriveSignature: personal_sign(<ms as decimal string>)`. The signer may be the owner or a registered session key; `wallet` is always the owner. Session-key header signatures have no freshness window. WS: `public/login {wallet,timestamp,signature}`; max 4 WS per IP.

### Action signing (all state changes)
- Domain `{name:"Matching", version:"1.0", chainId, verifyingContract: 0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD}`
  - DOMAIN_SEPARATOR mainnet `0xda616dfabb88681b08e1592820a41d55ddc62d68de110e327ae99d734506fe19`, testnet `0x24d674cd5f2b9d564691c51e9d88f649b99246a2244dd74ce27b96578d773e85` (asserted in `tests/primitives.test.ts`)
- `Action(uint256 subaccountId,uint256 nonce,address module,bytes data,uint256 expiry,address owner,address signer)`, typehash `0x4d7a9f27…af17`
- digest = `keccak256(0x1901 ‖ DOMAIN_SEPARATOR ‖ keccak(abi.encode(TYPEHASH, subaccountId, nonce, module, keccak(data), expiry, owner, signer)))`
- **Nonce = UTC nanoseconds** (`ms*1e6 + 6-digit random`), string. Withdraw/transfer/session-key/whitelist: ±1 h and strictly increasing. Orders: −120 d…+1 h.
- Implementation: `lib/derive-codec.ts` (ported from `manager-service/src/derive/v3/codec.ts`).

| Module | Address (both nets) |
|---|---|
| TRADE | `0xB8D20c2B7a1Ad2EE33Bc50eF10876eD3035b5e7b` |
| TRANSFER | `0x01259207A40925b794C8ac320456F7F6c8FE2636` |
| WITHDRAW | `0x9d0E8f5b25384C7310CB8C6aE32C8fbeb645d083` |
| WHITELISTED_RECIPIENT | `0xB86D6DE1b76c9839e4BA860848CD98A1dABd6B54` |
| SET_SESSION_KEY | `0xe330CF64ff6EbF41699aad344Cb21d78db1D2bb6` |
| RFQ | `0x9371352CCef6f5b36EfDFE90942fFE622Ab77F1D` |

| Action | `data` (numbers ×1e18 unless noted) |
|---|---|
| Order | `abi(address base_asset_address, uint sub_id, int limit_price, int amount, uint max_fee, uint recipient_id=subaccount_id, bool is_bid)` |
| Set session key | `abi(address key, uint expiry, uint[] scopeCodes, uint[] subaccountIds)` |
| Whitelist | `abi(address[] add, address[] remove)` |
| Withdraw | `abi(address protocolAsset, uint maxFeeUsdE18, address recipient, uint amount (6 dp!), bool forceBatch)` |
| Transfer (spot) | `abi(uint toSubaccountId, uint newSubaccountManager, address asset, uint subId, uint amountE18, uint maxFeeUsdE18)` |

Debug a `14014`: `public/decode_action`, `public/withdraw_debug`, `private/order_debug`, `private/transfer_spot_debug`, `private/set_session_key_debug`.

### Registering the agent — what this app does (`lib/server/derive.ts`)
1. Server generates a secp256k1 session key (stored AES-GCM encrypted).
2. MetaMask (switched to chain 1 / 11155111) signs: the `SET_SESSION_KEY` action (`subaccountId 0`), the `WHITELISTED_RECIPIENT` action adding the owner, and `personal_sign(timestamp)`.
3. Server calls `private/set_session_key` then `private/update_whitelisted_recipients`, then reads back `private/session_keys` and **refuses** if any dangerous scope is present.

```json
{"wallet":OWNER,"public_session_key":AGENT,"expiry_sec":N,"subaccount_ids":null,"nonce":"…","signer":OWNER,
 "signature":"0x…","signature_expiry_sec":N,"protocol_scopes":["trade:all","withdraw","transfer:existing_subaccount","transfer:new_subaccount"],
 "offchain_scopes":["account_info"],"label":"pulse-risk-agent","ip_whitelist":[]}
```

Scope codes: 0 admin · 1 withdraw · 2 trade:all · 3–6 trade:orderbook:* · 7–10 trade:rfq:* · 11 transfer:all · 12 transfer:existing_subaccount · 13 transfer:new_subaccount · 14 transfer:different_owner_subaccount · 15 set_session_key · 16 liquidate · 17–22 vault:*. **Never grant 0, 11, 14, 15** (`encodeSetSessionKeyData` throws on them). Expiry: min now+300 s; we use 30 days. Revoke = re-register with expiry ≈ now+301 s.

## 4. JSON-RPC methods

Rate classes: `matching` (order/replace/cancel*), `proven` (~1 TPS per wallet: transfer_spot, withdraw, set_session_key, whitelist), else ~5 TPS. Per **wallet**, shared across keys.

### Market data (public)
| Method | Key params | Notes |
|---|---|---|
| `public/get_all_currencies` | — | currencies, managers, spot collateral incl. `min_deposit_usd` |
| `public/get_risk_universes` | — | managers per universe, collaterals, `min_deposit_usd` |
| `public/get_all_instruments` | `instrument_type` (option/perp/erc20), `expired`, `currency`, `page_size`≤1000 | filter `is_active:false` (scheduled listings) |
| `public/get_instrument` | `instrument_name` | `tick_size`, `amount_step`, `minimum_amount`, `base_fee`, `taker_fee_rate`, `base_asset_address`, `base_asset_sub_id` |
| `public/get_ticker` / `get_tickers` | `instrument_name` / `instrument_type, currency, expiry_date` (YYYYMMDD, required for options) | slim keys: `b/B a/A` best bid/ask px/size, `M` mark, `I` index, `f` funding, `minp/maxp` price band, `option_pricing{d,g,v,t,i,bi,ai,m,f}` |
| `public/get_tradingview_chart_data` | `instrument_name, period (s), start_timestamp, end_timestamp (s)` | candles |
| `public/get_trade_history` | `instrument_name`… | trades |
| `public/get_margin` | `margin_type, simulated_collaterals, simulated_positions` | margin sim before an account exists |
| `public/order_quote` | full order params | `estimated_fill_price`, `suggested_max_fee`, `post_liquidation_price` |
| `public/get_time` | — | server ms |

### WebSocket
`{"id":1,"method":"subscribe","params":{"channels":[…]}}` → pushes `{"method":"subscription","params":{"channel","data"}}`.
Public: `orderbook.{inst}.{1|10|100}.{1|10|20|100}`, `ticker_slim.{inst}.{100|1000}`, `trades.{inst}`. Private (after login): `{subaccount_id}.orders|trades|balances`.

### Account (private, X-Derive* headers)
| Method | Key params | Notes |
|---|---|---|
| `private/get_account` | `wallet` | `subaccount_ids`, `fallback_subaccount_id`, `whitelisted_recipients` |
| `public/get_subaccounts` | `wallet` | works before login |
| **`private/get_subaccount`** | `subaccount_id` | whole snapshot: `initial_margin` (**= excess headroom, not a requirement**), `maintenance_margin`, `collaterals_value`, `positions[]`, `open_orders[]`, `is_under_liquidation` |
| `private/get_positions` | `subaccount_id` | per-position IM/MM, liq price, greeks |
| `private/get_margin` | `subaccount_id, simulated_collateral_changes` | **rebalancer "how much can I pull" check** (simulate −USDC, read `is_valid_trade`) — UNVERIFIED as a sizing method |

### Orders (session key, TRADE module)
`private/order`: `instrument_name, direction, amount, limit_price, max_fee, nonce, signer, signature, signature_expiry_sec, subaccount_id`, optional `order_type, time_in_force (gtc|post_only|ioc|fok), reduce_only, label, trigger_type/trigger_price, algo_type:"twap"`.
- Round `limit_price` to `tick_size` and `amount` to `amount_step` **before** signing.
- `max_fee` is **per unit**: `(base_fee/amount + taker_fee_rate*max(index,price))*3`.
- `signature_expiry_sec` **is the order's expiry**.
- Market orders still need a worst `limit_price` inside `[minp,maxp]`.

Also: `private/replace`, `private/cancel {subaccount_id, instrument_name, order_id}`, `private/cancel_all`, `private/get_open_orders`, `private/get_order_history`, `private/get_trade_history`.

### Collateral movement (session key)
| Method | Params | Scope |
|---|---|---|
| `private/transfer_spot` | `subaccount_id, to_subaccount_id (0=new), new_subaccount_manager, asset_name:"USDC", sub_id:0, amount (human), max_fee_usd, nonce, signer, signature, signature_expiry_sec` | transfer:existing/new_subaccount |
| `private/withdraw` | `subaccount_id, asset_name:"USDC", amount_in_underlying (**human**), force_batch:false, max_fee_usd, recipient? (omit = owner), nonce, signer, signature, signature_expiry_sec` | withdraw |
| `private/get_deposit_history` / `get_withdrawal_history` | `wallet` or `subaccount_id` | `batch_status`, `tx_hash` |
| `public/get_transaction` | `op_uuid` | status |
| `public/get_pending_deposits`, `public/get_onchain_action_history` | `wallet` | deposit tracking |

## 5. Deposits (Ethereum / Sepolia)
1. `USDC.approve(ACTION_MANAGER, amount)`
2. `ACTION_MANAGER.depositToNewSubaccount(address asset=0x57B0…f02b, uint256 amount (6 dp), uint32 managerId, address owner)`
3. Credited in ~1.5–2 min. Poll `public/get_onchain_action_history`. **Each call opens a new subaccount** → consolidate with `transfer_spot`.
Alternative: `public/register_deposit_address {wallet, subaccount_id}` then plain USDC transfer (top-up; mainnet returned `-32603` in Oct — UNVERIFIED now).

## 6. Withdrawals (what the rebalancer needs)
- Check headroom (`get_subaccount.initial_margin`), then `private/withdraw` → owner's **Ethereum** address. No claim, no gas. Testnet took ~14 min, fee ~$1. Errors: `11030` fee ≥ amount, `11031` rounds to zero, `11033` recipient not whitelisted.
- **Signed data (VERIFIED against mainnet `public/withdraw_debug`, 2026-11-24):** module WITHDRAW `0x9d0E…d083`, data = `abi(address 0x57B0…f02b, uint maxFeeUsd×1e18, address recipient, uint amount×1e6, bool forceBatch=false)`. Our `encodeWithdrawData` output, action hash and typed-data hash all equal Derive's (`LIVE=1 npx vitest run tests/withdraw.test.ts`). Passing `recipient` = owner explicitly and omitting it encode the same; this app passes it explicitly.
- **Request:** `{subaccount_id, asset_name: "USDC", amount_in_underlying: "<human decimal>", recipient: <owner>, max_fee_usd: "3", force_batch: false, nonce, signer, signature, signature_expiry_sec}`. We cap the fee at $3 and send at least $5, so a fee spike is refused instead of eating the amount.
- **Status:** `private/get_withdrawal_history {wallet, start_timestamp}` → `batch_status` goes `Batching → Executing → Da → Proving → Settling → Settled`; any `…Error` = failed. `amount` and `fee` are human decimals (net received = amount − fee).
- **No direct route to BNB Chain.** Derive's withdraw addresses (`private/register_withdraw_address`, the `forward` object) forward bridged tokens to their home chain; USDC's home is Ethereum, so it always pays out there.
- **This app:** `withdrawDerive`, `deriveWithdrawals` (`lib/server/derive.ts`), route `POST|GET /api/trade/withdraw`, UI on Funding → Lighter / Derive → Ethereum.
- Between own subaccounts: `private/transfer_spot` (~1/s).
- Back to BNB: Relay Ethereum USDC → BSC USDC (see relay.md).

## 7. Our code index
- Signing: `manager-service/src/derive/v3/constants.ts`, `codec.ts`; `algo-engine/src/adapters/derive/sign.rs`, `order.rs`
- Flows: `manager-service/src/derive/v3/onboarding-plan.ts`, `hub-deposit-gateway.ts`, `exit-engine.ts`, `account-engine.ts`
- This app: `lib/derive-codec.ts`, `lib/server/derive.ts`
- Testnet findings: `derive-v3-testnet/FINDINGS.md`

## Not verified
Mainnet direct deposit / session-key registration with funds; a real mainnet withdraw (signing is verified via `withdraw_debug`, but no funds have been sent); mainnet `register_deposit_address`; whether a withdraw-scoped key can pay the owner without whitelisting; MetaMask chainId enforcement on typed data; PM2 USDC treatment.
