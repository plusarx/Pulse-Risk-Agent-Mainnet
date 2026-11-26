# Lighter — endpoint reference for the agent

Date: 2026-11-23

**Tag legend**
- **[V-doc]** verified in the official docs at docs.lighter.xyz. apidocs.lighter.xyz now 301-redirects there; append `.md` to any page for raw markdown, full index at https://docs.lighter.xyz/llms.txt.
- **[V-live]** confirmed with a public GET on 2026-11-23.
- **[V-code]** verified in our code (path given, relative to the parent workspace).
- **[UNVERIFIED]** inferred or not tested.

---

## 0. Read these first

1. **The old testnet host is dead.** `https://testnet.zklighter.elliot.ai` returns a CloudFront 502 ("can't resolve origin") **[V-live]**. The current testnet is `https://api.testnet.lighter.xyz` **[V-doc, V-live]**. Our own testnet compose overrides in `.wt/_build/sa/` still point at the dead host.
2. **The docs list stale testnet contract addresses.** The docs page gives Sepolia ZkLighter `0x5236…e863`, USDC `0x0Bd5…9445` and Faucet `0x51C0…9063`. The live `GET api.testnet.lighter.xyz/api/v1/layer1BasicInfo` returns a different set, listed in §4 **[V-live]**. The testnet `assetDetails` for asset 3 also names the live set's USDC `0xf3E5…41eC`, so use the live set. Both sets have bytecode on Sepolia.
   - Testnet markets now start at 4095 (ETH 4095, BTC 4096, SOL 4097), and `created_at` is about 2026-11-18. That suggests the testnet was reset recently **[UNVERIFIED inference]**.
3. **lighter-go v1.0.6 refuses perp market ids above 254.** Every current testnet perp is above 254. v1.0.13 (released 2026-11-18) widens the limit, so use v1.0.13 or later **[V-code: `lighter-robinhood-plan.md`, follow-up 1]**.

---

## 1. Base URLs and chain ids

| | Mainnet | Testnet |
|---|---|---|
| REST | `https://mainnet.zklighter.elliot.ai` (prefix `/api/v1/`) | `https://api.testnet.lighter.xyz` (prefix `/api/v1/`) |
| WebSocket | `wss://mainnet.zklighter.elliot.ai/stream` (add `?readonly=true` from restricted regions) | `wss://api.testnet.lighter.xyz/stream` |
| L2 signing chain id (passed to `CreateClient`) | **304** | **300** |
| L1 chain | Ethereum (1) | Sepolia (11155111) |
| Explorer API | `https://explorer.elliot.ai/api` | `https://explorerapi.testnet.lighter.xyz/api` |
| Web app | app.lighter.xyz | testnet.app.lighter.xyz |
| Deposit bridge (UDA) | `https://bridge.lighter.xyz` (needs a builder `x-api-key`) | none |

Source: https://docs.lighter.xyz/developers/getting-started/environments **[V-doc]**. Chain ids 304/300 are also in `manager-service/src/lighter/wasm.ts:9-10` **[V-code]**.

- A transaction signed for 304 is rejected on testnet, and the reverse **[V-doc]**.
- Lighter on Robinhood Chain is a separate exchange: `api.rh.lighter.xyz`, chain 466324 (its testnet `api.rh-testnet.lighter.xyz` uses chain 300). Ignore it unless needed.

**General conventions [V-doc, V-code]:**
- Errors come back as **HTTP 200 with `code != 200`**. Always check `code`.
- Auth token: `Authorization: <token>` header, or the `?auth=` query parameter (our code uses the query form, `manager-service/src/lighter/lighter.service.ts:640`). Format is `{expiry}:{account}:{apiKeyIndex}:{hex}`, and a token lasts at most 8 hours.
- An authenticated request is rate-limited per L1 address instead of per IP. Unauthenticated Standard traffic gets 60 requests/min per IP.

---

## 2. REST endpoints

Response fields were checked against the docs' OpenAPI and live mainnet responses. Prices and sizes in responses are decimal strings. Signed transactions use integers scaled by `size_decimals` / `price_decimals` (USDC amounts use 6 decimals).

### Account, balances, margin, positions

**`GET /accountsByL1Address?l1_address=0x…[&cursor=]`** — no auth.
- Returns `{l1_address, sub_accounts[], next_cursor}`.
- Each entry has `index`, `account_type` (0 = master), `l1_address`, `available_balance`, `collateral`, `status`, `account_trading_mode`.
- Returns `code 21100` while the account does not exist yet.
- `available_balance` comes back `""` here. For balances use `/account?by=l1_address`, which returns all of the owner's accounts with balances **[V-code memory, testnet probe]**.
- The response is paginated, so follow `next_cursor`.

**`GET /account?by=index|l1_address&value=…[&active_only=][&cursor=]`** — no auth.
- Returns `{total, accounts[]}`. Each account has:
  - `index`, `account_type`, `l1_address`
  - `collateral`, `available_balance`, `total_asset_value`, `cross_asset_value`
  - `cross_initial_margin_requirement`, `cross_maintenance_margin_requirement`
  - `positions[]`, `assets[]`, `approved_integrators`, `pending_order_count`
- Each `positions[]` entry has `market_id`, `symbol`, `sign` (1 long / -1 short), `position`, `avg_entry_price`, `position_value`, `unrealized_pnl`, `realized_pnl`, `liquidation_price`, `initial_margin_fraction`, `margin_mode` (0 cross / 1 isolated), `allocated_margin`, `total_funding_paid_out`.
- Each `assets[]` entry has `asset_id`, `symbol`, `balance`, `locked_balance`, `margin_balance`, `margin_mode`. **USDC is `asset_id 3`.** [V-live]

**`GET /accountLimits?account_index=`** — auth required.
- Returns `user_tier`, `user_tier_name`, `current_maker_fee_tick`, `current_taker_fee_tick`, `volume_quota_remaining`, `can_create_public_pool`.
- A 200 response is also the documented way to check that an API key is registered.

**`POST /changeAccountTier`** — auth required. Form fields `account_index`, `new_tier`. Weight 3000.

**`GET /positionFunding?account_index=&limit=`** — auth required for main accounts **[V-live: "auth required for main accounts"]**.
- Optional: `market_id`, `side`, `cursor`, `start/end_timestamp`.
- Returns `position_fundings[]` with `timestamp`, `market_id`, `change`, `rate`, `position_size`, `position_side`.

**`GET /pnl?by=index&value=&resolution=1h|1d&start_timestamp=&end_timestamp=&count_back=`** — auth required. Returns `pnl[]` with `trade_pnl`, `inflow`, `outflow`, and more.

**`GET /accountActiveOrders?account_index=[&market_id=]`** — auth required.
- Returns `orders[]` with `order_index`, `client_order_index`, `market_index`, `is_ask`, `price`, `remaining_base_amount`, `type`, `time_in_force`, `reduce_only`, `trigger_price`, `status`.

**`GET /accountInactiveOrders?account_index=&limit=`** — auth required. Same shape as active orders.

**`GET /trades?sort_by=timestamp|trade_id|block_height&limit=[&account_index=&market_id=&cursor=]`**
- Auth is needed for account fills. Returns `trades[]` and `next_cursor`.
- Useful fields: `ask/bid_account_pnl` and `taker/maker_fee`.

### Markets, books, candles, trades, funding

**`GET /orderBooks[?market_id=&filter=all|spot|perp]`** — 246 markets on mainnet today.
- Fields: `symbol`, `market_id`, `market_type`, `status`, `min_base_amount`, `min_quote_amount`, `supported_size_decimals`, `supported_price_decimals`, `taker_fee`, `maker_fee`, `open_interest`.

**`GET /orderBookDetails[?market_id=&filter=]`**
- Returns `order_book_details[]` and `spot_order_book_details[]`.
- Each entry adds **`size_decimals`, `price_decimals`** (use these to scale signed integers), `default_initial_margin_fraction`, `min_initial_margin_fraction`, `maintenance_margin_fraction`, `mark_price`, `index_price`, `last_trade_price`, and daily stats.

**`GET /orderBookOrders?market_id=&limit=`**
- Returns `asks[]` and `bids[]`, each with `price`, `remaining_base_amount`, `owner_account_index`, `order_index`.

**`GET /candles?market_id=&resolution=1m|5m|15m|30m|1h|4h|12h|1d&start_timestamp=&end_timestamp=&count_back=`**
- Timestamps are in seconds.
- Returns `{r, c:[{t (ms), o, h, l, c, v (base), V (quote), i (last trade id)}]}` [V-live].
- `/candlesticks` returns nothing, so use `/candles`.

**`GET /markPriceCandles`** — same query parameters. Returns `c:[{t,o,h,l,c,sc}]`.

**`GET /recentTrades?market_id=&limit=`**
- Returns `trades[]` with `trade_id`, `price`, `size`, `usd_amount`, `is_maker_ask`, `ask_account_id`, `bid_account_id`, `timestamp` (ms).

**`GET /fundings?market_id=&resolution=1h|1d&start_timestamp=&end_timestamp=&count_back=`**
- Returns `fundings[]` with `timestamp`, `value`, `rate`, `direction` (long/short).

**`GET /funding-rates`** — current rates across venues. Returns `funding_rates[]` with `market_id`, `exchange` (lighter, binance, …), `symbol`, `rate`.

**`GET /exchangeStats`**, **`GET /assetDetails[?asset_id=]`**
- `assetDetails` returns `asset_id`, `decimals`, `l1_decimals`, `min_transfer_amount`, `min_withdrawal_amount`, `l1_address`.
- USDC is asset 3: 6 decimals, minimum transfer and withdrawal 1.

### Transactions, nonce, API keys

**`POST /sendTx`** — `application/x-www-form-urlencoded`.
- Fields: `tx_type`, `tx_info` (the signer's JSON string), and optional `price_protection` (default true).
- Returns `{code, tx_hash, predicted_execution_time_ms, volume_quota_remaining}`.
- **200 means accepted, not executed.** Confirm with `/tx` or the `account_tx` WS channel.

**`POST /sendTxBatch`**
- Form fields `tx_types` and `tx_infos`, each a JSON-string array.
- Up to 50 transactions; a larger batch gets error 21514.
- All transactions in a batch must share the same account and API key (21121).

**`GET /tx?by=hash|sequence_index&value=`**
- Returns `status`: 0 failed, 1 pending, 2 executed, 3 pending-final.
- `event_info` is a JSON string. If it contains `code` or `ae`, the transaction failed [V-code `.wt/manager-service-rebal3/src/lighter/lighter.service.ts` `txOutcome`].

**`GET /nextNonce?account_index=&api_key_index=`** — returns `{nonce}`.
- Each API key has its own nonce.
- Use the real nonce with `skipNonce=0`. Timestamp skip-nonces were rejected with 21104 on fresh accounts [V-code `manager-service/src/lighter/lighter.service.ts:686-697`].

**`GET /apikeys?account_index=[&api_key_index=]`**
- `api_key_index=255` lists all keys.
- Returns `api_keys[]` with `api_key_index`, `public_key` (**no 0x prefix**), `nonce`.

**`POST /tokens/create`** — auth required.
- Creates a read-only `ro:` token: `name`, `account_index`, `expiry`, `sub_account_access`.
- Weight 10,000. Read-only tokens are a good fit for the agent's reads.

### Funds movement

**`GET /transferFeeInfo?account_index=&to_account_index=`** — returns `{transfer_fee_usdc}`.
- The docs mark it auth-gated; it returned `0` unauthenticated today [V-live].
- The fee is charged on top of the amount and must match exactly.

**`GET /withdrawalDelay`** — returns `{seconds}`. Live value is 1566 s (about 26 min).

**`GET /fastwithdraw/info?account_index=`** — auth required.
- Returns `to_account_index` (the pool account), `withdraw_limit`, `max_withdrawal_amount`.

**`POST /fastwithdraw`** — `Authorization` header required. Form fields `tx_info` (a signed Transfer with `L1Sig`) and `to_address`.

**`GET /fastbridge/info`** — returns `{fast_bridge_limit}`.

**`POST /createIntentAddress`** — CCTP deposit address (legacy route).
- Form fields `chain_id`, `from_addr`, `amount=0`, `is_external_deposit=true`.
- Returns `{intent_address}`. Weight 3000.

**`GET /deposit/networks`** — mainnet lists 999, 42161, 43114, 5042, 8453; testnet lists 42161, 43114, 8453.

**`GET /deposit/latest?l1_address=`** — returns `status`, `step`, `amount`, `source_chain_id`.

**History (all auth required):**
- `GET /deposit/history?account_index=&l1_address=`
- `GET /withdraw/history?account_index=[&filter=all|pending|claimable]` returns `status`, `l1_tx_hash`, `l1_claim_tx_hash`.
- `GET /transfer/history?account_index=`

**System:**
- `GET /layer1BasicInfo` returns contract addresses.
- `GET /systemConfig` returns integrator fee caps and the pool indexes.

### Transaction types (`tx_type`) [V-doc, data-structures page]

| Type | Number |
|---|---|
| ChangePubKey | 8 |
| CreateSubAccount | 9 |
| Transfer | 12 |
| Withdraw | 13 |
| CreateOrder | 14 |
| CancelOrder | 15 |
| CancelAllOrders | 16 |
| ModifyOrder | 17 |
| UpdateLeverage | 20 |
| CreateGroupedOrders | 28 |
| UpdateMargin | 29 |
| UpdateAccountConfig | 41 |
| ApproveIntegrator | 45 |

### Order enums [V-doc, signing-transactions page]

- **Order type:** 0 limit, 1 market, 2 SL, 3 SL-limit, 4 TP, 5 TP-limit, 6 TWAP.
- **Time in force:** 0 IOC, 1 GTT, 2 post-only.
- **Margin mode:** 0 cross, 1 isolated.
- **Route:** 0 perps, 1 spot.
- **Cancel-all:** `cancelAllMarketIndex` 255 cancels on all markets.

### Rate limits that matter to the agent [V-doc, rate-limits page]

| Action | Limit |
|---|---|
| `L2Withdraw` | 2/min and 3 per 2 h, **per L1 address, shared across sub-accounts** |
| `L2Transfer` | 120/min |
| `L2CreateSubAccount` | 2/min |
| `L2ChangePubKey` | 300/min |
| Fast withdrawal | 10/hour |
| Standard tier, overall | 60 requests/min |
| WS connection | weight 90 |

---

## 3. WebSocket [V-doc https://docs.lighter.xyz/api/websocket]

**Message format**
- Subscribe: `{"type":"subscribe","channel":"order_book/0"}`. Add `"auth":"<token>"` for private channels.
- Unsubscribe uses `"type":"unsubscribe"`.
- Replies: `type: "subscribed/<ch>"` carries the snapshot, then `"update/<ch>"`. The reply channel name uses colons (`order_book:0`).

**Keepalive**
- Send any frame at least every 2 minutes, or the socket is closed.
- `{"type":"ping"}` returns `{"type":"pong"}`.

**Sending transactions over WS**
- Single: `{"type":"jsonapi/sendtx","data":{"id","tx_type","tx_info"}}`
- Batch: `{"type":"jsonapi/sendtxbatch","data":{"id","tx_types","tx_infos"}}`

**Public channels**
- `order_book/{m}`: snapshot, then diffs every 50 ms. Check that `begin_nonce` equals the previous `nonce`.
- `ticker/{m}` (best bid/offer)
- `market_stats/{m}` and `market_stats/all`
- `trade/{m}`
- `candle/{m}/{res}`
- `mark_price_candle/{m}/{res}`
- `height`

**Account channels**
- `account_all/{acct}`: positions, assets, trades and funding per market.
- `user_stats/{acct}`: `collateral`, `portfolio_value`, `leverage`, `available_balance`, `margin_usage`, `buying_power`, plus `cross_stats` and `total_stats`. **This is the best channel for rebalancing.**
- `account_all_positions/{acct}`, `account_all_trades/{acct}`
- `account_market/{m}/{acct}` (auth)
- `account_orders/{m}/{acct}` (auth)
- `account_all_orders/{acct}` (auth)
- `account_tx/{acct}` (auth): whether a transaction executed or was rejected.
- `account_all_assets/{acct}` (auth)
- `notification` (liquidations)

**Our live finding:** `account_all`, `account_all_positions`, `account_all_trades` and `user_stats` are not authenticated at the venue. They serve any account index and ignore `auth`. `account_all_orders` does require auth (20001/20013) [V-code `websocket-engine/src/account-stream/lighter.stream.ts:13-18`].

---

## 4. Deposits

### A. Direct Ethereum deposit (the simplest wallet path) [V-doc deposits page]

- **Mainnet:** ZkLighter `0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7`, USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` [V-live layer1BasicInfo].
- **Function:** `deposit(address _to, uint16 _assetIndex, uint8 _routeType, uint256 _amount)`, payable, selector **0x8a857083**.
  - I confirmed the selector by hashing that signature, so the ABI shape is **[V]**.
  - `_assetIndex` = 3 (USDC), `_routeType` = 0 (perps).
  - `msg.value` = 0 for ERC-20.
- **Flow:** first `USDC.approve(ZkLighter, amount)`, then `deposit`.
- **Minimum:** 1 USDC per deposit per the contract section. The UDA table says $5 for Ethereum. Use at least 5 for the first deposit **[V-doc; exact on-chain minimum UNVERIFIED]**.
- **The first credited deposit creates the account.** There is no sign-up call. It credits in "a few minutes".
- Read-only lookup: `addressToAccountIndex(address)`, selector `0xabf6a038` [V hash].

**Testnet (Sepolia), from live `layer1BasicInfo` [V-live]:**

| Contract | Address |
|---|---|
| ZkLighter | `0x652358Be8bbE20Cb7349ddb8A35dac7c870B4596` |
| L1CoreMessaging | `0x31355E120C97f6B3A888598592128f8074fEE28E` |
| USDC (test) | `0xf3E575A90F325a3A806E3CEC99d0baC5719E41eC` |
| Faucet | `0xD4C71985B89B0505e4487811453AEb6519C78c8A` |

**Testnet faucet:**
- HTTP: `GET {testnet}/api/v1/faucet?l1_address=0x…`. The route exists today; it answers 20001 "invalid param" with no address [V-live].
- On the old testnet, the HTTP faucet created and funded the account (10k), but **only if the address already held Sepolia ETH**. Otherwise it answered "ok" and did nothing [V-code memory and `venue-subaccounts-plan.md`, 2026-11-03; not re-tested on the reset testnet].
- The faucet contract's bytecode calls `deposit` (0x8a857083) internally, so it likely deposits straight into Lighter. Its entry function name is not documented **[UNVERIFIED]**.
- Gas: get Sepolia ETH from a public faucet. Lighter's faucet does not give ETH [V-doc].

### B. CCTP intent address (legacy; what our code uses) [V-doc, V-code]

- `POST /createIntentAddress chain_id=42161&from_addr=<owner>&amount=0&is_external_deposit=true`.
- Then a plain USDC `transfer` on Arbitrum to that address credits the `from_addr` owner's Lighter account. It takes about 15–20 minutes.
- Chains: Arbitrum, Base, Avalanche, Arc, HyperEVM. Minimum is 5 USDC; our code requires more than 6 (`LIGHTER_MIN_DEPOSIT_USDC = 6`).
- Code: `manager-service/src/lighter/lighter.service.ts:1910-1968` (`intentAddressFor`, `createIntentAddress`, `deposit`). The hub path is `HubRouterService.fundVenue`.

### C. Universal Deposit Address via bridge.lighter.xyz / Fun.xyz [V-doc]

- Chains: Ethereum, Arbitrum, Base, Optimism, Polygon, **BNB Smart Chain (56: USDC, USDT, BNB…)**, HyperEVM, Monad, Robinhood, Solana, Tron, Bitcoin.
- Calls:
  - `POST https://bridge.lighter.xyz/v1/uda {walletAddress, market:"perps", asset:"USDC", accountIndex?}` returns `depositAddr` (plus Solana, Tron and BTC addresses).
  - `/v1/uda/quote` and `GET /v1/uda/status/{wallet}`.
- **It needs an `x-api-key` that Lighter issues on request through Discord #support, server-side only.** Minimum is $5 for a new account, $3 on EVM for an existing one.
- **BNB Chain is supported only through this route.** It is not in CCTP and not direct. Mainnet only.

---

## 5. API key registration (the "agent" key)

### Flow [V-doc create-accounts-programmatically; V-code]

1. **The account must exist first.** The first deposit creates it.
   - Poll `accountsByL1Address` until it no longer returns 21100. Take the entry with `account_type == 0` and read its `index`.
   - ChangePubKey on an account with zero collateral fails with 21126 [V-doc errors].
2. Generate the key locally: `GenerateAPIKey()` returns `{privateKey, publicKey}`. The public key is `0x` plus 80 hex characters; it is an ECgFp5/Poseidon key, not secp256k1.
3. `CreateClient("", privateKey, chainId(304|300), apiKeyIndex, accountIndex)`.
   - Key index range is 4–254; 0–3 are reserved for Lighter's apps. We use 4.
   - **Registering a key replaces whatever key is at that index.** Pick a dedicated index for the app.
4. `nonce = GET /nextNonce?account_index=&api_key_index=`. Use the real value with `skipNonce = 0`.
5. `SignChangePubKey(publicKey, 0, nonce, apiKeyIndex, accountIndex)` returns `{txType: 8, txInfo, messageToSign}`.
6. **Your wallet signs `messageToSign` with plain `personal_sign`.** In viem that is `walletClient.signMessage({ message })`.
   - The measured template [V-code `manager-service/scripts/probe-lighter-changepubkey-pin.mjs:37-41`, `manager-service/src/noncustodial/hub/hub-policy.ts:695-707`]:
     ```
     Register Lighter Account\n\npubkey: 0x<80hex>\nnonce: 0x<16hex>\naccount index: 0x<16hex>\napi key index: 0x<16hex>\nOnly sign this message for a trusted client!
     ```
   - Always sign exactly what the signer returns; do not rebuild it.
7. `txInfo = {...JSON.parse(txInfo), L1Sig: sig}`, then `POST /sendTx`.
8. Poll `GET /apikeys?account_index=&api_key_index=` until `public_key` (no 0x) matches.
   - Alternatively, mint `CreateAuthToken(deadline, keyIdx, acct)` and expect `GET /accountLimits` to return 200.

After registration, orders, cancels, leverage, margin, secure withdraw and same-owner transfers need only the API key. There are no more wallet pop-ups.

### Signer library [V-doc, V-live]

- **There is no official npm signer.** The official signer is lighter-go's `wasm/` package compiled to WebAssembly. It works in **Node and the browser**.
- **Prebuilt binary:** the lighter-go GitHub releases ship `lighter-signer-web.wasm`; v1.0.13 is from 2026-11-18. You need `wasm_exec.js` from the **same Go version** that built the wasm. Which Go version built the release asset is **[UNVERIFIED]**, so building it yourself with `GOOS=js GOARCH=wasm go build ./wasm/` is the safe option.
- `elliottech/lighter-ts` is state, WS and math only, and explicitly **not a signer**. npm `lighter-ts-sdk` is third-party (bvvvp009) and unvetted.
- **Rules:**
  - Do all HTTP from JavaScript. The Go HTTP stack inside the wasm cannot dial out, so `CheckClient` and `nonce = -1` fail.
  - Pass `""` as the URL to `CreateClient`.
  - Every function returns `{error?}`, so check it.
  - In Node, `go.run()` keeps the process alive; do not await it.

### Our code (Node, server-side) [V-code]

- `manager-service/src/lighter/wasm.ts`
  - `:9-10` chain ids
  - `:23-55` exact positional signatures of every WASM function we use
  - `:70-94` `ensureLighterWasmLoaded`: requires `wasm_exec.js` and instantiates the 14 MB `assets/lighter-signer.wasm`
  - `:97-105` `ensureLighterClientRegistered`
- `manager-service/src/lighter/lighter.service.ts`
  - `:1005-1188` `provisionCredentials`: the full ChangePubKey flow (`:1104` nonce, `:1105` SignChangePubKey, `:1112-1117` L1 signature via Privy `personal_sign` and `L1Sig`, `:1119` send, `:1124-1135` `/apikeys` poll)
  - `:970-1000` account lookup
  - `:693` nonce
  - `:704-717` `sendTx` (FormData)
  - `:380-416` auth tokens
- Our L1 signer is a Privy wallet rather than a browser wallet. The message and signature format are identical.
- **Can it run in a Next.js API route?** Yes, as long as it uses the **Node runtime (not Edge)**. Load the wasm once per process and keep the globals. Expect a cold start on serverless.
- **Better for a hackathon:** generate the key in the browser and have your wallet sign there, so the private key never leaves the device. Lighter's own guidance is "never ship your own API key to a browser; generate a key per user on their device" [V-doc].
- **Catch for the backend agent:** if it must trade or rebalance, it needs that API private key. So either generate the key server-side (stored in KMS, one per user) and only send `messageToSign` to the browser for your wallet, or register a second key index for the agent. Each key has its own nonce, which is the recommended separation.

---

## 6. Moving margin: withdraw and transfer [V-doc deposits/wasm-signer pages; V-code]

| Operation | Signer call | L1 signature | Destination | Minimum | Speed |
|---|---|---|---|---|---|
| **Secure withdraw** (tx 13) | `SignWithdraw(assetIndex=3, routeType=0, amount(1e6), skipNonce, nonce, keyIdx, acct)` | **No** (no `messageToSign` is returned) | Owner's own L1 address on **Ethereum** only | 1 USDC | about 26 min (`withdrawalDelay`); Lighter usually claims it, otherwise the user calls `withdrawPendingBalance` on ZkLighter |
| **Same-owner transfer** (master ↔ sub, tx 12) | `SignTransfer(toAcct, 3, 0, 0, amount, fee, memo32B, skipNonce, nonce, keyIdx, fromAcct)` | No (`messageToSign` is still returned; ignore it) | Own sub-account | 1 USDC | Instant; fee measured at 0 |
| **Transfer to another owner** | Same call | **Yes**, `personal_sign` | Any Lighter account | 1 USDC | Instant |
| **Fast withdraw** | `fastwithdraw/info` gives the pool `to_account_index`; then `transferFeeInfo`; memo = 20-byte destination + 12 zero bytes; `SignTransfer` to the pool; L1 signature; then `POST /fastwithdraw {tx_info, to_address}` | **Yes** | Any Ethereum address | 4 USDC | Fast, but limited by the pool limit and 10/hour |
| **Create sub-account** (tx 9) | `SignCreateSubAccount(skipNonce, nonce, keyIdx, masterAcct)` | No | n/a | n/a | The new index is not returned; re-read `accountsByL1Address` |
| **Isolated margin** (tx 29) | `SignUpdateMargin(market, usdcAmount, direction 1 add / 0 remove, …)` | No | n/a | n/a | n/a |
| **Leverage** (tx 20) | `SignUpdateLeverage(market, fraction = 10000/leverage, marginMode, …)` | No | n/a | n/a | n/a |

- Transfer `messageToSign` template [V-code `manager-service/src/noncustodial/hub/hub-policy.ts:700`, probe script]:
  ```
  Transfer\n\nnonce: 0x..\nfrom: 0x.. (route ..)\napi key: ..\nto: ..\nasset: ..\namount: ..\nfee: ..\nchainId: 0x..130\nmemo: ..\nOnly sign…
  ```
- **Secure withdraw payload (VERIFIED with the vendored v1.0.13 signer, 2026-11-24):** `SignWithdraw` returns `txType 13`, no `messageToSign`, and `tx_info` fields `FromAccountIndex, ApiKeyIndex, AssetIndex, RouteType, Amount, ExpiredAt, Nonce, Sig`. There is **no destination field**, so a leaked API key can only send funds to the owner. Pinned in `tests/lighter-signer.test.ts`.
- **Withdraw status:** `GET /withdraw/history?account_index=&filter=all&auth=<token>` (the `auth` query param works like the `authorization` header). `status`: `pending` → `claimable` (ready on Ethereum; Lighter normally completes the claim) → `completed`; `failed` / `refunded` = it didn't go. `completed` is the end state for fast withdrawals; secure ones may stop at `claimable` until claimed.
- **This app:** `withdrawLighter` (master only, at most `available_balance`, minimum 1 USDC) and `lighterWithdrawals` in `lib/server/lighter.ts`; route `POST|GET /api/trade/withdraw`; UI on Funding → Lighter / Derive → Ethereum. Not yet sent with real funds.
- **Implication for the agent:** with only the API key, it can move margin between the user's own master and sub-accounts (instant), adjust isolated margin, and secure-withdraw to the user's own Ethereum address. It **cannot** send funds elsewhere without a your wallet signature.
- Each sub-account needs its own key registered. The same public key can be registered on master and sub (testnet-proven 2026-11-03). The secure-withdraw limit (3 per 2 h) is shared across all of an owner's accounts.
- Our code:
  - `manager-service/src/lighter/lighter.service.ts:1981-2000` withdraw; `:2033` and `:2094` leverage and margin.
  - `.wt/manager-service-rebal3/src/lighter/lighter.service.ts:1588` `signCreateSubaccount`, `:1603` `signOwnTransfer` (checks the transfer fee is 0), `:1640` `submitSigned`.
  - Mainnet withdrawals land on Ethereum, and our code then bridges them to Arbitrum with CCTP (`manager-service/src/noncustodial/hub/lighter-bridge.service.ts`).

---

## 7. Integrator / builder fee (only if you attribute orders)

- **Order fields** [V-doc partner-attribution]: `SignCreateOrder` takes `integratorAccountIndex`, `integratorTakerFee` and `integratorMakerFee`.
- **Approval:** the client must first send `ApproveIntegrator` (tx 45):
  - `SignApproveIntegrator(integratorIdx, maxPerpsTaker, maxPerpsMaker, maxSpotTaker, maxSpotMaker, expiryMs, skipNonce, nonce, keyIdx, acct)`.
  - Fee units: 1000 = 10 bps.
  - Mainnet caps from `systemConfig`: perps 1000 (10 bps), spot 10000 [V-live].
  - At most 4 approved integrators per account. Non-zero fees need a Plus or Premium tier.
  - The L1 signature is needed when the integrator has a different owner and any fee is above 0.
  - Message template: `Approve Integrator\n\nnonce: 0x..\naccount index: ..\napi key index: ..\n…\nchainId: ..\nOnly sign…`.
- **Our testnet findings contradict the docs here** [V-code memory, testnet 2026-10-03]:
  - An account that never approved the integrator gets **21149 even at 0 fee**.
  - An all-zero approval acts as a *revoke* and does not enable attribution.
  - A "1-tick" cap with an L1 signature works and lets 0-fee orders carry the code.
  - Approval is **per account index**, so sub-accounts need their own.
- Our integrator index is `728755` (`manager-service/src/lighter/lighter.service.ts:178`); the approval flow is at `:1282-1390`.
- **For a hackathon, simplest is to pass integrator 0/0/0 and skip approval.**

---

## Not verified

- The exact on-chain deposit minimum for the direct Ethereum deposit.
- The entry function of the testnet faucet contract.
- Whether the HTTP faucet still needs Sepolia ETH on the reset testnet.
- Which Go version built the release `lighter-signer-web.wasm`.
- That the new testnet's deposit contract credits accounts end to end; no funded probe was run.
- UDA behaviour; it needs a builder API key we don't have.
