# Lighter — full API reference (mainnet)

Generated 2026-11-23 from Lighter's official OpenAPI spec (shipped with `elliottech/lighter-python`, 91 paths) by `scripts/gen-endpoint-docs.mjs`. **Mainnet only.**

- **REST base:** `https://mainnet.zklighter.elliot.ai` · signing chain id **304** · L1 = Ethereum mainnet.
- **WebSocket:** `wss://mainnet.zklighter.elliot.ai/stream` (see [WebSocket channels](#websocket-channels)).
- **Errors:** domain errors come back with a `code` (e.g. HTTP 400 + `code 21100` = account not found; HTTP 200 + `code != 200` = tx rejected). Always check `code`.
- **Auth:** private reads take `auth` (query) or `Authorization` (header) = a token from the signer's `CreateAuthToken`; writes go through `/api/v1/sendTx` with a signed `tx_info` (tx types: 8 ChangePubKey, 9 CreateSubAccount, 12 Transfer, 13 Withdraw, 14 CreateOrder, 15 CancelOrder, 16 CancelAll, 17 ModifyOrder, 20 UpdateLeverage, 29 UpdateMargin, 45 ApproveIntegrator).
- **Mainnet contracts (Ethereum):** ZkLighter `0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7` — `deposit(address _to, uint16 _assetIndex=3 (USDC), uint8 _routeType=0, uint256 _amount)`; USDC `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`.

## Data points — where each lives

| Data point | Endpoint |
| --- | --- |
| Accounts of an L1 address (master + sub-accounts) | `GET /api/v1/accountsByL1Address`, `GET /api/v1/account?by=l1_address` |
| Balances, collateral, available, margin requirement | `GET /api/v1/account` (`collateral`, `available_balance`, `total_asset_value`, `cross_*_margin_requirement`) |
| Positions, entry, uPnL, liquidation price | `GET /api/v1/account` → `positions[]`; WS `account_all/{idx}` |
| Live margin usage / leverage | WS `user_stats/{idx}` |
| Markets, decimals, margin fractions, mark/index | `GET /api/v1/orderBooks`, `GET /api/v1/orderBookDetails` |
| Order book | `GET /api/v1/orderBookOrders`; WS `order_book/{market}` |
| Candles / mark-price candles | `GET /api/v1/candles`, `GET /api/v1/markPriceCandles` |
| Trades | `GET /api/v1/recentTrades`, `GET /api/v1/trades` |
| Funding | `GET /api/v1/fundings`, `GET /api/v1/funding-rates`, `GET /api/v1/positionFunding` |
| PnL history | `GET /api/v1/pnl` |
| Deposits | Ethereum `ZkLighter.deposit`; `GET /api/v1/deposit/history`, `/deposit/latest`, `/deposit/networks`, `POST /api/v1/createIntentAddress` |
| Withdrawals | `sendTx` type 13 (secure, ~26 min); `POST /api/v1/fastwithdraw` + `/fastwithdraw/info`; `GET /api/v1/withdraw/history`, `/withdrawalDelay` |
| Sub-accounts / transfers | `sendTx` type 9 (create) / 12 (transfer); `GET /api/v1/transfer/history`, `/transferFeeInfo` |
| API keys, nonce | `GET /api/v1/apikeys`, `GET /api/v1/nextNonce` |

## Contents

- [account](#l-account) (29)
- [announcement](#l-announcement) (1)
- [block](#l-block) (3)
- [bridge](#l-bridge) (6)
- [candlestick](#l-candlestick) (4)
- [event](#l-event) (1)
- [funding](#l-funding) (1)
- [info](#l-info) (6)
- [livepoints](#l-livepoints) (1)
- [notification](#l-notification) (1)
- [order](#l-order) (14)
- [portfolio](#l-portfolio) (1)
- [referral](#l-referral) (7)
- [root](#l-root) (2)
- [tokenlist](#l-tokenlist) (1)
- [transaction](#l-transaction) (12)
- [updown](#l-updown) (1)
- [WebSocket channels](#websocket-channels)

<a id="l-account"></a>
## account

### `GET /api/v1/account`

account — Get account by an account's index, or L1 address

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `by` | enum: `index`, `l1_address` (query) | yes |  |
| `value` | string (query) | yes |  |
| `active_only` | boolean (query) |  | Hide markets for which leverage and margin settings are present (meaning the account traded it at least once), but with no active position. |
| `cursor` | string (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `total` | integer (int64) |  |
| `accounts` | object[] |  |
| `accounts[].code` | integer (int32) |  |
| `accounts[].message` | string |  |
| `accounts[].account_type` | integer (uint8) |  |
| `accounts[].account_trading_mode` | integer (uint8) | Classic=0 and Unified=1 |
| `accounts[].index` | integer (int64) |  |
| `accounts[].l1_address` | string |  |
| `accounts[].cancel_all_time` | integer (int64) |  |
| `accounts[].total_order_count` | integer (int64) |  |
| `accounts[].total_isolated_order_count` | integer (int64) |  |
| `accounts[].pending_order_count` | integer (int64) |  |
| `accounts[].available_balance` | string |  |
| `accounts[].status` | integer (uint8) |  |
| `accounts[].collateral` | string |  |
| `accounts[].account_index` | integer (int64) |  |
| `accounts[].name` | string |  |
| `accounts[].description` | string |  |
| `accounts[].can_invite` | boolean (boolean) | Remove After FE uses L1 meta endpoint |
| `accounts[].referral_points_percentage` | string | Remove After FE uses L1 meta endpoint |
| `accounts[].positions` | object[] |  |
| `accounts[].positions[].market_id` | integer (int16) |  |
| `accounts[].positions[].symbol` | string |  |
| `accounts[].positions[].initial_margin_fraction` | string |  |
| `accounts[].positions[].open_order_count` | integer (int64) |  |
| `accounts[].positions[].pending_order_count` | integer (int64) |  |
| `accounts[].positions[].position_tied_order_count` | integer (int64) |  |
| `accounts[].positions[].sign` | integer (int32) |  |
| `accounts[].positions[].position` | string |  |
| `accounts[].positions[].avg_entry_price` | string |  |
| `accounts[].positions[].position_value` | string |  |
| `accounts[].positions[].unrealized_pnl` | string |  |
| `accounts[].positions[].realized_pnl` | string |  |
| `accounts[].positions[].liquidation_price` | string |  |
| `accounts[].positions[].total_funding_paid_out` | string |  |
| `accounts[].positions[].margin_mode` | integer (int32) |  |
| `accounts[].positions[].allocated_margin` | string |  |
| `accounts[].positions[].total_discount` | string |  |
| `accounts[].positions[].margin_set_flag` | integer (int32) |  |
| `accounts[].assets` | object[] |  |
| `accounts[].assets[].symbol` | string |  |
| `accounts[].assets[].asset_id` | integer (int16) |  |
| `accounts[].assets[].balance` | string |  |
| `accounts[].assets[].locked_balance` | string |  |
| `accounts[].assets[].margin_balance` | string |  |
| `accounts[].assets[].margin_mode` | enum: `enabled`, `disabled` |  |
| `accounts[].assets[].multiplier` | string |  |
| `accounts[].total_asset_value` | string |  |
| `accounts[].cross_asset_value` | string |  |
| `accounts[].pool_info` | object |  |
| `accounts[].pool_info.status` | integer (uint8) |  |
| `accounts[].pool_info.operator_fee` | string |  |
| `accounts[].pool_info.min_operator_share_rate` | string |  |
| `accounts[].pool_info.total_shares` | integer (int64) |  |
| `accounts[].pool_info.operator_shares` | integer (int64) |  |
| `accounts[].pool_info.annual_percentage_yield` | number (double) |  |
| `accounts[].pool_info.daily_returns` | object[] |  |
| `accounts[].pool_info.share_prices` | object[] |  |
| `accounts[].pool_info.sharpe_ratio` | number (double) |  |
| `accounts[].pool_info.strategies` | object[] |  |
| `accounts[].shares` | object[] |  |
| `accounts[].shares[].public_pool_index` | integer (int64) |  |
| `accounts[].shares[].shares_amount` | integer (int64) |  |
| `accounts[].shares[].entry_usdc` | string |  |
| `accounts[].shares[].entry_timestamp` | integer (int64) |  |
| `accounts[].shares[].principal_amount` | string |  |
| `accounts[].created_at` | integer (int64) |  |
| `accounts[].transaction_time` | integer (int64) |  |
| `accounts[].pending_unlocks` | object[] |  |
| `accounts[].pending_unlocks[].unlock_timestamp` | integer (int64) |  |
| `accounts[].pending_unlocks[].asset_index` | integer (int16) |  |
| `accounts[].pending_unlocks[].amount` | string |  |
| `accounts[].approved_integrators` | object[] |  |
| `accounts[].approved_integrators[].account_index` | integer (int64) |  |
| `accounts[].approved_integrators[].name` | string |  |
| `accounts[].approved_integrators[].max_perps_taker_fee` | integer (int32) |  |
| `accounts[].approved_integrators[].max_perps_maker_fee` | integer (int32) |  |
| `accounts[].approved_integrators[].max_spot_taker_fee` | integer (int32) |  |
| `accounts[].approved_integrators[].max_spot_maker_fee` | integer (int32) |  |
| `accounts[].approved_integrators[].approval_expiry` | integer (int64) | Timestamp in milliseconds, after which the integrator is no longer approved |
| `accounts[].can_rfq` | boolean (boolean) |  |
| `accounts[].cross_initial_margin_requirement` | string |  |
| `accounts[].cross_maintenance_margin_requirement` | string |  |
| `accounts[].can_rfq_market_ids` | string[] |  |
| `accounts[].metadata` | object |  |
| `accounts[].metadata.color` | string |  |
| `accounts[].agent_enabled` | boolean (boolean) |  |
| `accounts[].bo_positions` | object[] |  |

### `GET /api/v1/accountLimits`

accountLimits — Get account limits. For more details on account types, see this page: https://docs.lighter.xyz/developers/reference/account-types

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `account_index` | integer (int64) (query) | yes |  |
| `authorization` | string (header) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `max_llp_percentage` | integer (int32) |  |
| `user_tier` | string |  |
| `can_create_public_pool` | boolean (boolean) |  |
| `max_llp_amount` | string |  |
| `current_maker_fee_tick` | integer (int32) |  |
| `current_taker_fee_tick` | integer (int32) |  |
| `effective_lit_stakes` | string | Effective staked LIT shares including active leases. |
| `leased_lit` | string | Total actively leased LIT. |
| `user_tier_name` | string |  |
| `user_tier_last_update` | integer (int64) |  |
| `bo_user_tier_name` | string |  |
| `bo_fee_rate` | number (double) | Product of the staking and BO volume multipliers; 0.72 means a 28% discount. |

### `GET /api/v1/accountMetadata`

accountMetadata — Get account metadatas

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `by` | enum: `index`, `l1_address` (query) | yes |  |
| `value` | string (query) | yes |  |
| `cursor` | string (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `account_metadatas` | object[] |  |
| `account_metadatas[].account_index` | integer (int64) |  |
| `account_metadatas[].name` | string |  |
| `account_metadatas[].description` | string |  |
| `account_metadatas[].can_invite` | boolean (boolean) | Remove After FE uses L1 meta endpoint |
| `account_metadatas[].referral_points_percentage` | string | Remove After FE uses L1 meta endpoint |
| `account_metadatas[].created_at` | integer (int64) |  |
| `account_metadatas[].can_rfq` | boolean (boolean) |  |
| `account_metadatas[].can_rfq_market_ids` | string[] |  |
| `account_metadatas[].metadata` | object |  |
| `account_metadatas[].metadata.color` | string |  |
| `account_metadatas[].agent_enabled` | boolean (boolean) |  |
| `next_cursor` | string |  |

### `GET /api/v1/accountsByL1Address`

accountsByL1Address — Returns all accounts associated with the given L1 address

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `l1_address` | string (query) | yes |  |
| `cursor` | string (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `l1_address` | string |  |
| `sub_accounts` | object[] |  |
| `sub_accounts[].code` | integer (int32) |  |
| `sub_accounts[].message` | string |  |
| `sub_accounts[].account_type` | integer (uint8) |  |
| `sub_accounts[].account_trading_mode` | integer (uint8) | Classic=0 and Unified=1 |
| `sub_accounts[].index` | integer (int64) |  |
| `sub_accounts[].l1_address` | string |  |
| `sub_accounts[].cancel_all_time` | integer (int64) |  |
| `sub_accounts[].total_order_count` | integer (int64) |  |
| `sub_accounts[].total_isolated_order_count` | integer (int64) |  |
| `sub_accounts[].pending_order_count` | integer (int64) |  |
| `sub_accounts[].available_balance` | string |  |
| `sub_accounts[].status` | integer (uint8) |  |
| `sub_accounts[].collateral` | string |  |
| `sub_accounts[].transaction_time` | integer (int64) |  |
| `next_cursor` | string |  |

### `GET /api/v1/apikeys`

apikeys — Get account api key. Set `api_key_index` to 255 to retrieve all api keys associated with the account.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `account_index` | integer (int64) (query) | yes |  |
| `api_key_index` | integer (uint8) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `api_keys` | object[] |  |
| `api_keys[].account_index` | integer (int64) |  |
| `api_keys[].api_key_index` | integer (uint8) |  |
| `api_keys[].nonce` | integer (int64) |  |
| `api_keys[].public_key` | string |  |
| `api_keys[].transaction_time` | integer (int64) |  |

### `POST /api/v1/changeAccountTier`

changeAccountTier — Change account tier. You can only perform this action once every 24 hours.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `account_index` | integer (int64) | yes |  |
| `new_tier` | string | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |

### `GET /api/v1/feeTiers`

feeTiers — Get fee tiers. filter=perps\|spot returns the regular user tiers (both market types share them). filter=bo returns BO volume tiers and LIT staking discount tiers; filter=all returns everything. An account's BO multiplier is the BO tier fee_rate times the staking fee_rate, applied to each BO market's maker/taker fee (see /api/v1/events) and then scaled by 1 - trade_price / settlement_cap.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `filter` | enum: `all`, `bo`, `perps`, `spot` (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `user_tiers` | object[] |  |
| `user_tiers[].name` | string |  |
| `user_tiers[].level` | integer (int32) |  |
| `user_tiers[].maker_fee_ticks` | integer (int32) |  |
| `user_tiers[].taker_fee_ticks` | integer (int32) |  |
| `user_tiers[].required_lit_stakes` | integer (int64) |  |
| `user_tiers[].required_volume` | integer (int64) |  |
| `bo_tiers` | object[] |  |
| `bo_tiers[].name` | string |  |
| `bo_tiers[].required_volume` | integer (int64) |  |
| `bo_tiers[].fee_rate` | number (double) |  |
| `staking_tiers` | object[] |  |
| `staking_tiers[].name` | string |  |
| `staking_tiers[].required_lit_stakes` | integer (int64) |  |
| `staking_tiers[].fee_rate` | number (double) |  |

### `GET /api/v1/getMakerOnlyApiKeys`

getMakerOnlyApiKeys — Get maker-only API key indexes

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `api_key_indexes` | integer (int64)[] |  |

### `GET /api/v1/l1Metadata`

l1Metadata — Get L1 metadata

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `l1_address` | string (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `l1_address` | string |  |
| `can_invite` | boolean (boolean) |  |
| `referral_points_percentage` | string |  |
| `referral_program_kickback` | string |  |
| `referral_program_kickback_history` | object[] |  |
| `referral_program_kickback_history[].date` | integer (int64) |  |
| `referral_program_kickback_history[].percentage` | string |  |

### `GET /api/v1/leaderboard`

leaderboard — Get points leaderboard

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `type` | enum: `weekly`, `all`, `competition` (query) | yes |  |
| `l1_address` | string (query) |  |  |
| `competition_id` | string (query) |  |  |
| `auth` | string (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `entries` | object[] |  |
| `entries[].l1_address` | string |  |
| `entries[].points` | number (float) |  |
| `entries[].entry` | integer (int32) |  |
| `entries[].entryId` | integer (int32) |  |
| `entries[].metadata` | string |  |

### `GET /api/v1/leaseOptions`

leaseOptions — Returns available lease duration/rate tiers, sorted by duration descending.

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `options` | object[] |  |
| `options[].duration_days` | integer (int32) | Lease duration in days |
| `options[].annual_rate` | number (double) | Annual rate as a percentage (e.g. 25.0 means 25%) |
| `lit_incentives_account_index` | integer (int64) | Account index that receives the leasing fee |

### `GET /api/v1/leases`

leases — Returns paginated lease entries for an account, most recent first. Supports read-only auth via signature/account_index/timestamp query params.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  | API token authorization |
| `account_index` | integer (int64) (query) | yes | Account index to fetch leases for |
| `cursor` | string (query) |  | Pagination cursor from a previous response |
| `limit` | integer (uint64) (query) |  | Number of results to return (1–100, default 20) |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `leases` | object[] |  |
| `leases[].id` | integer (int64) | Lease ID |
| `leases[].master_account_index` | integer (int64) | Master account index |
| `leases[].lease_amount` | integer (int64) | Leased LIT amount in raw units (1 LIT = 1e8) |
| `leases[].fee_amount` | integer (int64) | Fee paid in raw units |
| `leases[].start` | integer (int64) | Lease start time (Unix milliseconds) |
| `leases[].end` | integer (int64) | Lease end time (Unix milliseconds) |
| `leases[].status` | enum: `waiting_fee`, `leased`, `expired`, `canceled` | Lease status |
| `leases[].error` | string | Error message if lease was canceled |
| `next_cursor` | string | Cursor to pass as the cursor param to fetch the next page. Absent if no more pages. |

### `GET /api/v1/liquidations`

liquidations — Get liquidation infos

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) | yes |  |
| `market_id` | integer (int16) (query) |  |  |
| `cursor` | string (query) |  |  |
| `limit` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `liquidations` | object[] |  |
| `liquidations[].id` | integer (int64) |  |
| `liquidations[].market_id` | integer (int16) |  |
| `liquidations[].type` | enum: `partial`, `deleverage` |  |
| `liquidations[].trade` | object |  |
| `liquidations[].trade.price` | string |  |
| `liquidations[].trade.size` | string |  |
| `liquidations[].trade.taker_fee` | string |  |
| `liquidations[].trade.maker_fee` | string |  |
| `liquidations[].trade.transaction_time` | integer (int64) |  |
| `liquidations[].trade.bid_account_id` | integer (int64) |  |
| `liquidations[].trade.ask_account_id` | integer (int64) |  |
| `liquidations[].info` | object |  |
| `liquidations[].info.positions` | object[] |  |
| `liquidations[].info.risk_info_before` | object |  |
| `liquidations[].info.risk_info_after` | object |  |
| `liquidations[].info.mark_prices` | object |  |
| `liquidations[].info.assets` | object[] |  |
| `liquidations[].info.asset_index_prices` | object |  |
| `liquidations[].executed_at` | integer (int64) |  |
| `next_cursor` | string |  |

### `POST /api/v1/litLease`

litLease — Submit a LIT lease transfer. The server calculates the required fee based on lease_amount and duration_days, then executes the transfer. Fee formula (integer arithmetic): fee = lease_amount × (annual_rate × 100) × duration_days / (360 × 10000).

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  | API token authorization |
| `tx_info` | string | yes | Signed transaction info (JSON with L2 signature, L1 signature, etc.) |
| `lease_amount` | string | yes | Amount of LIT to lease in raw units (1 LIT = 100000000) |
| `duration_days` | integer (int32) | yes | Lease duration in days. Must match one of the available lease options. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `tx_hash` | string |  |

### `GET /api/v1/partnerStats`

partnerStats — Get partner stats. If timestamps are not provided, all-time stats will be returned.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `account_index` | integer (int64) (query) | yes |  |
| `start_timestamp` | integer (int64) (query) |  |  |
| `end_timestamp` | integer (int64) (query) |  |  |
| `period` | string (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `total_fees_earned` | string |  |
| `total_taker_fees_earned` | string |  |
| `total_maker_fees_earned` | string |  |
| `total_volume` | string |  |
| `total_taker_volume` | string |  |
| `total_maker_volume` | string |  |
| `total_trades` | integer (int64) |  |
| `total_taker_trades` | integer (int64) |  |
| `total_maker_trades` | integer (int64) |  |
| `unique_clients` | integer (int64) |  |

### `GET /api/v1/pnl`

pnl — Get account PnL chart

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `by` | enum: `index` (query) | yes |  |
| `value` | string (query) | yes |  |
| `resolution` | enum: `1m`, `5m`, `15m`, `1h`, `4h`, `1d` (query) | yes |  |
| `start_timestamp` | integer (int64) (query) | yes |  |
| `end_timestamp` | integer (int64) (query) | yes |  |
| `count_back` | integer (int64) (query) | yes |  |
| `ignore_transfers` | boolean (boolean) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `resolution` | string |  |
| `pnl` | object[] |  |
| `pnl[].timestamp` | integer (int64) |  |
| `pnl[].trade_pnl` | number (double) |  |
| `pnl[].inflow` | number (double) |  |
| `pnl[].outflow` | number (double) |  |
| `pnl[].pool_pnl` | number (double) |  |
| `pnl[].pool_inflow` | number (double) |  |
| `pnl[].pool_outflow` | number (double) |  |
| `pnl[].pool_total_shares` | number (double) |  |
| `pnl[].spot_inflow` | number (double) |  |
| `pnl[].spot_outflow` | number (double) |  |
| `pnl[].staked_lit` | number (double) |  |
| `pnl[].staking_inflow` | number (double) |  |
| `pnl[].staking_outflow` | number (double) |  |
| `pnl[].staking_pnl` | number (double) |  |
| `pnl[].trade_spot_pnl` | number (double) |  |
| `pnl[].volume` | number (double) |  |

### `GET /api/v1/pnlLeaderboard`

pnlLeaderboard — Get pnl leaderboard

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `time_window` | enum: `24h`, `7d`, `30d`, `all` (query) | yes |  |
| `sort_by` | enum: `pnl`, `roi`, `volume`, `account_value` (query) | yes |  |
| `sort_dir` | enum: `asc`, `desc` (query) | yes |  |
| `limit` | integer (uint8) (query) | yes |  |
| `offset` | integer (int32) (query) | yes |  |
| `search` | string (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `entries` | object[] |  |
| `entries[].rank` | integer (int64) |  |
| `entries[].l1_address` | string |  |
| `entries[].account_value` | number (double) |  |
| `entries[].pnl` | number (double) |  |
| `entries[].roi` | number (double) |  |
| `entries[].volume` | number (double) |  |
| `total` | integer (int64) |  |
| `updated_at` | integer (int64) |  |

### `GET /api/v1/positionFunding`

positionFunding — Get accounts position fundings

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `account_index` | integer (int64) (query) | yes |  |
| `cursor` | string (query) |  |  |
| `limit` | integer (int64) (query) | yes |  |
| `side` | enum: `long`, `short`, `all` (query) |  |  |
| `start_timestamp` | integer (int64) (query) |  |  |
| `end_timestamp` | integer (int64) (query) |  |  |
| `market_ids` | integer (int16)[] (query) |  | comma-separated int64s, e.g. "1,2" |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `position_fundings` | object[] |  |
| `position_fundings[].timestamp` | integer (int64) |  |
| `position_fundings[].market_id` | integer (int16) |  |
| `position_fundings[].funding_id` | integer (int64) |  |
| `position_fundings[].change` | string |  |
| `position_fundings[].discount` | string |  |
| `position_fundings[].rate` | string |  |
| `position_fundings[].position_size` | string |  |
| `position_fundings[].position_side` | enum: `long`, `short` |  |
| `next_cursor` | string |  |

### `GET /api/v1/publicPoolsMetadata`

publicPoolsMetadata — Get public pools metadata. `auth` is required in case you specify an account_index. You will see public pools with an index that starts an n-1 of the one you specify. To see staking pools, use `filter=stake`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `filter` | enum: `all`, `user`, `protocol`, `account_index`, `stake` (query) |  |  |
| `index` | integer (int64) (query) | yes |  |
| `limit` | integer (int64) (query) | yes |  |
| `account_index` | integer (int64) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `public_pools` | object[] |  |
| `public_pools[].code` | integer (int32) |  |
| `public_pools[].message` | string |  |
| `public_pools[].account_index` | integer (int64) |  |
| `public_pools[].account_type` | integer (uint8) |  |
| `public_pools[].name` | string |  |
| `public_pools[].l1_address` | string |  |
| `public_pools[].annual_percentage_yield` | number (double) |  |
| `public_pools[].status` | integer (uint8) |  |
| `public_pools[].operator_fee` | string |  |
| `public_pools[].total_asset_value` | string |  |
| `public_pools[].total_shares` | integer (int64) |  |
| `public_pools[].account_share` | object |  |
| `public_pools[].account_share.public_pool_index` | integer (int64) |  |
| `public_pools[].account_share.shares_amount` | integer (int64) |  |
| `public_pools[].account_share.entry_usdc` | string |  |
| `public_pools[].account_share.entry_timestamp` | integer (int64) |  |
| `public_pools[].account_share.principal_amount` | string |  |
| `public_pools[].assets` | object[] |  |
| `public_pools[].assets[].symbol` | string |  |
| `public_pools[].assets[].asset_id` | integer (int16) |  |
| `public_pools[].assets[].balance` | string |  |
| `public_pools[].assets[].locked_balance` | string |  |
| `public_pools[].assets[].margin_balance` | string |  |
| `public_pools[].assets[].margin_mode` | enum: `enabled`, `disabled` |  |
| `public_pools[].assets[].multiplier` | string |  |
| `public_pools[].created_at` | integer (int64) |  |
| `public_pools[].master_account_index` | integer (int64) |  |
| `public_pools[].sharpe_ratio` | number (double) |  |
| `public_pools[].total_perps_value` | string |  |
| `public_pools[].total_spot_value` | string |  |

### `GET /api/v1/referral/userReferrals`

userReferrals — Get user referrals

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `l1_address` | string (query) | yes |  |
| `cursor` | string (query) |  |  |
| `stats_start_timestamp` | integer (int64) (query) |  |  |
| `stats_end_timestamp` | integer (int64) (query) |  |  |
| `limit` | integer (int64) (query) |  |  |
| `is_eligible` | boolean (boolean) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `cursor` | string |  |
| `referrals` | object[] |  |
| `referrals[].l1_address` | string |  |
| `referrals[].referral_code` | string |  |
| `referrals[].used_at` | integer (int64) |  |
| `referrals[].trade_stats` | object |  |
| `referrals[].trade_stats.count` | integer (int64) |  |
| `referrals[].trade_stats.volume` | string |  |
| `referrals[].trade_stats.web_count` | integer (int64) |  |
| `referrals[].trade_stats.web_volume` | string |  |
| `referrals[].trade_stats.mobile_app_count` | integer (int64) |  |
| `referrals[].trade_stats.mobile_app_volume` | string |  |
| `referrals[].trade_stats.mobile_browser_count` | integer (int64) |  |
| `referrals[].trade_stats.mobile_browser_volume` | string |  |
| `referrals[].trade_stats.maker_fees_paid` | string |  |
| `referrals[].trade_stats.non_free_taker_volume` | string |  |
| `referrals[].trade_stats.non_free_maker_volume` | string |  |
| `referrals[].trade_stats.free_taker_volume` | string |  |
| `referrals[].trade_stats.taker_fees_paid` | string |  |
| `referrals[].trade_stats.free_maker_volume` | string |  |
| `referrals[].tier` | string |  |
| `referrals[].source` | string |  |
| `used_code` | string |  |
| `totals` | object |  |
| `totals.count` | integer (int64) |  |
| `totals.volume` | string |  |
| `totals.free_maker_volume` | string |  |
| `totals.free_taker_volume` | string |  |
| `totals.non_free_maker_volume` | string |  |
| `totals.non_free_taker_volume` | string |  |
| `totals.maker_fees_paid` | string |  |
| `totals.taker_fees_paid` | string |  |
| `totals.total_referrals` | integer (int64) |  |
| `totals.total_premium_referrals` | integer (int64) |  |

### `POST /api/v1/rfq/create`

rfq_create — Create RFQ. Makers have up to 1 minute to answer an RFQ, after which the user has up to 2 minutes to execute the trade. Quotes are not locked. Makers place orders directly into the order book and can dynamically adjust pricing.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `market_index` | integer (int16) | yes |  |
| `base_amount` | string |  |  |
| `quote_amount` | string |  |  |
| `direction` | integer (int16) | yes |  |
| `metadata` | string |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `id` | integer (int64) |  |
| `account_index` | integer (int64) |  |
| `market_index` | integer (int16) |  |
| `direction` | integer (int16) |  |
| `base_amount` | string |  |
| `quote_amount` | string |  |
| `status` | string |  |
| `metadata` | object |  |
| `metadata.requested_est_price` | string |  |
| `metadata.requested_max_slippage` | string |  |
| `metadata.requested_slippage` | string |  |
| `metadata.worst_price` | string |  |
| `metadata.mark_price` | string |  |
| `metadata.requested_est_fill_fraction` | string |  |
| `responses` | object[] |  |
| `responses[].account_index` | integer (int64) |  |
| `responses[].status` | enum: `acknowledged`, `liquidity_provided`, `not_interested` |  |
| `responses[].responded_at` | integer (int64) |  |
| `responses[].updated_at` | integer (int64) |  |
| `created_at` | integer (int64) |  |
| `updated_at` | integer (int64) |  |

### `GET /api/v1/rfq/get`

rfq_get — Get RFQ by ID

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `rfq_id` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `id` | integer (int64) |  |
| `account_index` | integer (int64) |  |
| `market_index` | integer (int16) |  |
| `direction` | integer (int16) |  |
| `base_amount` | string |  |
| `quote_amount` | string |  |
| `status` | string |  |
| `metadata` | object |  |
| `metadata.requested_est_price` | string |  |
| `metadata.requested_max_slippage` | string |  |
| `metadata.requested_slippage` | string |  |
| `metadata.worst_price` | string |  |
| `metadata.mark_price` | string |  |
| `metadata.requested_est_fill_fraction` | string |  |
| `responses` | object[] |  |
| `responses[].account_index` | integer (int64) |  |
| `responses[].status` | enum: `acknowledged`, `liquidity_provided`, `not_interested` |  |
| `responses[].responded_at` | integer (int64) |  |
| `responses[].updated_at` | integer (int64) |  |
| `created_at` | integer (int64) |  |
| `updated_at` | integer (int64) |  |

### `GET /api/v1/rfq/list`

rfq_list — List RFQs

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) |  |  |
| `status` | enum: `opened`, `order_created`, `closed` (query) |  |  |
| `cursor` | string (query) |  |  |
| `limit` | integer (int64) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `rfqs` | object[] |  |
| `rfqs[].id` | integer (int64) |  |
| `rfqs[].account_index` | integer (int64) |  |
| `rfqs[].market_index` | integer (int16) |  |
| `rfqs[].direction` | integer (int16) |  |
| `rfqs[].base_amount` | string |  |
| `rfqs[].quote_amount` | string |  |
| `rfqs[].status` | string |  |
| `rfqs[].metadata` | object |  |
| `rfqs[].metadata.requested_est_price` | string |  |
| `rfqs[].metadata.requested_max_slippage` | string |  |
| `rfqs[].metadata.requested_slippage` | string |  |
| `rfqs[].metadata.worst_price` | string |  |
| `rfqs[].metadata.mark_price` | string |  |
| `rfqs[].metadata.requested_est_fill_fraction` | string |  |
| `rfqs[].responses` | object[] |  |
| `rfqs[].responses[].account_index` | integer (int64) |  |
| `rfqs[].responses[].status` | enum: `acknowledged`, `liquidity_provided`, `not_interested` |  |
| `rfqs[].responses[].responded_at` | integer (int64) |  |
| `rfqs[].responses[].updated_at` | integer (int64) |  |
| `rfqs[].created_at` | integer (int64) |  |
| `rfqs[].updated_at` | integer (int64) |  |
| `next_cursor` | string |  |

### `POST /api/v1/rfq/respond`

rfq_respond — Respond to RFQ. Makers have up to 1 minute to answer an RFQ, after which the user has up to 2 minutes to execute the trade. Quotes are not locked. Makers place orders directly into the order book and can dynamically adjust pricing.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `rfq_id` | integer (int64) | yes |  |
| `status` | enum: `acknowledged`, `liquidity_provided`, `not_interested` | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `id` | integer (int64) |  |
| `account_index` | integer (int64) |  |
| `market_index` | integer (int16) |  |
| `direction` | integer (int16) |  |
| `base_amount` | string |  |
| `quote_amount` | string |  |
| `status` | string |  |
| `metadata` | object |  |
| `metadata.requested_est_price` | string |  |
| `metadata.requested_max_slippage` | string |  |
| `metadata.requested_slippage` | string |  |
| `metadata.worst_price` | string |  |
| `metadata.mark_price` | string |  |
| `metadata.requested_est_fill_fraction` | string |  |
| `responses` | object[] |  |
| `responses[].account_index` | integer (int64) |  |
| `responses[].status` | enum: `acknowledged`, `liquidity_provided`, `not_interested` |  |
| `responses[].responded_at` | integer (int64) |  |
| `responses[].updated_at` | integer (int64) |  |
| `created_at` | integer (int64) |  |
| `updated_at` | integer (int64) |  |

### `POST /api/v1/rfq/update`

rfq_update — Update RFQ status

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `rfq_id` | integer (int64) | yes |  |
| `status` | enum: `order_created`, `closed` | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `id` | integer (int64) |  |
| `account_index` | integer (int64) |  |
| `market_index` | integer (int16) |  |
| `direction` | integer (int16) |  |
| `base_amount` | string |  |
| `quote_amount` | string |  |
| `status` | string |  |
| `metadata` | object |  |
| `metadata.requested_est_price` | string |  |
| `metadata.requested_max_slippage` | string |  |
| `metadata.requested_slippage` | string |  |
| `metadata.worst_price` | string |  |
| `metadata.mark_price` | string |  |
| `metadata.requested_est_fill_fraction` | string |  |
| `responses` | object[] |  |
| `responses[].account_index` | integer (int64) |  |
| `responses[].status` | enum: `acknowledged`, `liquidity_provided`, `not_interested` |  |
| `responses[].responded_at` | integer (int64) |  |
| `responses[].updated_at` | integer (int64) |  |
| `created_at` | integer (int64) |  |
| `updated_at` | integer (int64) |  |

### `POST /api/v1/setMakerOnlyApiKeys`

setMakerOnlyApiKeys — Set maker-only API key indexes. This replaces the current list; pass all indexes you want marked as maker-only. Pass [] to clear all maker-only restrictions.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) | yes |  |
| `api_key_indexes` | string | yes | JSON array string of API key indexes, e.g. "[4,5]". Use [] to clear all maker-only restrictions. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |

### `GET /api/v1/tokens`

tokens — Get read only auth tokens for an account

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `account_index` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `api_tokens` | object[] |  |
| `api_tokens[].token_id` | integer (int64) |  |
| `api_tokens[].api_token` | string |  |
| `api_tokens[].name` | string |  |
| `api_tokens[].account_index` | integer (int64) |  |
| `api_tokens[].expiry` | integer (int64) |  |
| `api_tokens[].sub_account_access` | boolean (boolean) |  |
| `api_tokens[].revoked` | boolean (boolean) |  |
| `api_tokens[].scopes` | string |  |

### `POST /api/v1/tokens/create`

tokens_create — Create an API token for read-only access

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `name` | string | yes |  |
| `account_index` | integer (int64) | yes |  |
| `expiry` | integer (int64) | yes |  |
| `sub_account_access` | boolean (boolean) | yes |  |
| `scopes` | string |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `token_id` | integer (int64) |  |
| `api_token` | string |  |
| `name` | string |  |
| `account_index` | integer (int64) |  |
| `expiry` | integer (int64) |  |
| `sub_account_access` | boolean (boolean) |  |
| `revoked` | boolean (boolean) |  |
| `scopes` | string |  |

### `POST /api/v1/tokens/revoke`

tokens_revoke — Revoke read only auth token for an account

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `token_id` | integer (int64) | yes |  |
| `account_index` | integer (int64) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `token_id` | integer (int64) |  |
| `revoked` | boolean (boolean) |  |

<a id="l-announcement"></a>
## announcement

### `GET /api/v1/announcement`

announcement — Get announcements

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `announcements` | object[] |  |
| `announcements[].title` | string |  |
| `announcements[].content` | string |  |
| `announcements[].created_at` | integer (int64) |  |
| `announcements[].expired_at` | integer (int64) |  |

<a id="l-block"></a>
## block

### `GET /api/v1/block`

block — Get block by its height or commitment

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `by` | enum: `commitment`, `height` (query) | yes |  |
| `value` | string (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `total` | integer (int64) |  |
| `blocks` | object[] |  |
| `blocks[].commitment` | string |  |
| `blocks[].height` | integer (int64) |  |
| `blocks[].state_root` | string |  |
| `blocks[].priority_operations` | integer (int32) |  |
| `blocks[].on_chain_l2_operations` | integer (int32) |  |
| `blocks[].pending_on_chain_operations_pub_data` | string |  |
| `blocks[].committed_tx_hash` | string |  |
| `blocks[].committed_at` | integer (int64) |  |
| `blocks[].verified_tx_hash` | string |  |
| `blocks[].verified_at` | integer (int64) |  |
| `blocks[].txs` | object[] |  |
| `blocks[].txs[].hash` | string |  |
| `blocks[].txs[].type` | integer (uint8) |  |
| `blocks[].txs[].info` | string |  |
| `blocks[].txs[].event_info` | string |  |
| `blocks[].txs[].status` | integer (int64) |  |
| `blocks[].txs[].transaction_index` | integer (int64) |  |
| `blocks[].txs[].l1_address` | string |  |
| `blocks[].txs[].account_index` | integer (int64) |  |
| `blocks[].txs[].nonce` | integer (int64) |  |
| `blocks[].txs[].expire_at` | integer (int64) |  |
| `blocks[].txs[].block_height` | integer (int64) |  |
| `blocks[].txs[].queued_at` | integer (int64) |  |
| `blocks[].txs[].executed_at` | integer (int64) |  |
| `blocks[].txs[].sequence_index` | integer (int64) |  |
| `blocks[].txs[].parent_hash` | string |  |
| `blocks[].txs[].api_key_index` | integer (uint8) |  |
| `blocks[].txs[].transaction_time` | integer (int64) |  |
| `blocks[].status` | integer (int64) |  |
| `blocks[].size` | integer (uin16) |  |

### `GET /api/v1/blocks`

blocks — Get blocks

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `index` | integer (int64) (query) |  |  |
| `limit` | integer (int64) (query) | yes |  |
| `sort` | enum: `asc`, `desc` (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `total` | integer (int64) |  |
| `blocks` | object[] |  |
| `blocks[].commitment` | string |  |
| `blocks[].height` | integer (int64) |  |
| `blocks[].state_root` | string |  |
| `blocks[].priority_operations` | integer (int32) |  |
| `blocks[].on_chain_l2_operations` | integer (int32) |  |
| `blocks[].pending_on_chain_operations_pub_data` | string |  |
| `blocks[].committed_tx_hash` | string |  |
| `blocks[].committed_at` | integer (int64) |  |
| `blocks[].verified_tx_hash` | string |  |
| `blocks[].verified_at` | integer (int64) |  |
| `blocks[].txs` | object[] |  |
| `blocks[].txs[].hash` | string |  |
| `blocks[].txs[].type` | integer (uint8) |  |
| `blocks[].txs[].info` | string |  |
| `blocks[].txs[].event_info` | string |  |
| `blocks[].txs[].status` | integer (int64) |  |
| `blocks[].txs[].transaction_index` | integer (int64) |  |
| `blocks[].txs[].l1_address` | string |  |
| `blocks[].txs[].account_index` | integer (int64) |  |
| `blocks[].txs[].nonce` | integer (int64) |  |
| `blocks[].txs[].expire_at` | integer (int64) |  |
| `blocks[].txs[].block_height` | integer (int64) |  |
| `blocks[].txs[].queued_at` | integer (int64) |  |
| `blocks[].txs[].executed_at` | integer (int64) |  |
| `blocks[].txs[].sequence_index` | integer (int64) |  |
| `blocks[].txs[].parent_hash` | string |  |
| `blocks[].txs[].api_key_index` | integer (uint8) |  |
| `blocks[].txs[].transaction_time` | integer (int64) |  |
| `blocks[].status` | integer (int64) |  |
| `blocks[].size` | integer (uin16) |  |

### `GET /api/v1/currentHeight`

currentHeight — Get current height

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `height` | integer (int64) |  |

<a id="l-bridge"></a>
## bridge

### `POST /api/v1/createIntentAddress`

createIntentAddress — Create a bridge intent address for CCTP bridge

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `chain_id` | string | yes |  |
| `from_addr` | string | yes |  |
| `amount` | string | yes |  |
| `is_external_deposit` | boolean (boolean) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `intent_address` | string |  |

### `GET /api/v1/deposit/latest`

deposit_latest — Get most recent deposit for given l1 address

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `l1_address` | string (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `source` | string |  |
| `source_chain_id` | string |  |
| `fast_bridge_tx_hash` | string |  |
| `batch_claim_tx_hash` | string |  |
| `cctp_burn_tx_hash` | string |  |
| `amount` | string |  |
| `intent_address` | string |  |
| `status` | string |  |
| `step` | string |  |
| `description` | string |  |
| `created_at` | integer (int64) |  |
| `updated_at` | integer (int64) |  |
| `is_external_deposit` | boolean (boolean) |  |
| `is_next_bridge_fast` | boolean (boolean) |  |

### `GET /api/v1/deposit/networks`

deposit_networks — Get networks that support deposits via intent address

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `networks` | object[] |  |
| `networks[].name` | string |  |
| `networks[].chain_id` | string |  |
| `networks[].explorer` | string |  |

### `GET /api/v1/fastbridge/info`

fastbridge_info — Get fast bridge info

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `fast_bridge_limit` | string |  |

### `POST /api/v1/fastwithdraw`

fastwithdraw — Fast withdraw

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `tx_info` | string | yes |  |
| `to_address` | string | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |

### `GET /api/v1/fastwithdraw/info`

fastwithdraw_info — Get fast withdraw info

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `to_account_index` | integer (int64) |  |
| `withdraw_limit` | string |  |
| `max_withdrawal_amount` | string |  |

<a id="l-candlestick"></a>
## candlestick

### `GET /api/v1/candles`

candles — Get candles data. Returns at most 500 candles per call. Zero values are omitted from the response.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `market_id` | integer (int16) (query) | yes |  |
| `resolution` | enum: `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `12h`, `1d` (query) | yes |  |
| `start_timestamp` | integer (int64) (query) | yes |  |
| `end_timestamp` | integer (int64) (query) | yes |  |
| `count_back` | integer (int64) (query) | yes |  |
| `set_timestamp_to_end` | boolean (boolean) (query) |  |  |
| `merge_mark_price` | boolean (boolean) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `r` | string | Resolution |
| `c` | object[] | Array of candles (max 500 per call) |
| `c[].t` | integer (int64) | Timestamp |
| `c[].o` | number (double) | Open price |
| `c[].h` | number (double) | High price |
| `c[].l` | number (double) | Low price |
| `c[].c` | number (double) | Close price |
| `c[].v` | number (double) | Base token volume (volume0) |
| `c[].V` | number (double) | Quote token volume (volume1) |
| `c[].i` | integer (int64) | Last trade ID |
| `c[].C` | number (double) | close_raw |
| `c[].H` | number (double) | high_raw |
| `c[].L` | number (double) | low_raw |
| `c[].O` | number (double) | open_raw |
| `message` | string |  |

### `GET /api/v1/fundings`

fundings — Get fundings. Maximum 750 fundings will be returned per call. `count_back` indicates the number of fundings you would like to be returned, starting from `start_timestamp`, if set to 0, all fundings will be returned.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `market_id` | integer (int16) (query) | yes |  |
| `resolution` | enum: `1h`, `1d` (query) | yes |  |
| `start_timestamp` | integer (int64) (query) | yes |  |
| `end_timestamp` | integer (int64) (query) | yes |  |
| `count_back` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `resolution` | string |  |
| `fundings` | object[] |  |
| `fundings[].timestamp` | integer (int64) |  |
| `fundings[].value` | string |  |
| `fundings[].rate` | string |  |
| `fundings[].direction` | string |  |

### `GET /api/v1/marketPriceCharts`

marketPriceCharts — Get last 24h hourly prices for all markets (mark price for perps, index price for spot)

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `market_ids` | integer (int16)[] (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `resolution` | string |  |
| `price_charts` | object[] |  |
| `price_charts[].market_id` | integer (int16) |  |
| `price_charts[].prices` | string[] |  |

### `GET /api/v1/markPriceCandles`

markPriceCandles — Get mark price candles

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `market_id` | integer (int16) (query) | yes |  |
| `resolution` | enum: `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `12h`, `1d` (query) | yes |  |
| `start_timestamp` | integer (int64) (query) | yes |  |
| `end_timestamp` | integer (int64) (query) | yes |  |
| `count_back` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `r` | string | resolution |
| `c` | object[] | candles |
| `c[].t` | integer (int64) | timestamp |
| `c[].o` | number (double) | open |
| `c[].h` | number (double) | high |
| `c[].l` | number (double) | low |
| `c[].c` | number (double) | close |
| `c[].sc` | integer (int64) | sample_count |

<a id="l-event"></a>
## event

### `GET /api/v1/events`

events — Get events and registered order books, including scheduled events with no books. event_ids and market_ids accept up to 50 comma-separated positive IDs, are mutually exclusive, and use the same filters, sorting and pagination. market_ids returns each related event once with all its order books. Defaults to descending id. start_at sorting uses (start_at, event_id); cursor identifies an existing event and excludes it in the requested direction. tag filters across creators; creator_account_index is an optional additional filter. active=true requires a tradeable outcome; active=false includes scheduled and closed events.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `event_ids` | string (query) |  | comma-separated positive IDs, max 50 |
| `market_ids` | string (query) |  | comma-separated positive IDs, max 50 |
| `creator_account_index` | integer (int64) (query) |  |  |
| `cursor` | integer (int64) (query) |  |  |
| `active` | boolean (boolean) (query) |  | true: at least one outcome still tradeable; false: none |
| `limit` | integer (int64) (query) |  |  |
| `tag` | string (query) |  | series tag; creator filter is optional |
| `event_kind` | enum: `one_off`, `recurrent` (query) |  |  |
| `start_from` | integer (int64) (query) |  | inclusive start_at, Unix milliseconds |
| `start_before` | integer (int64) (query) |  | exclusive start_at, Unix milliseconds |
| `sort` | enum: `id`, `start_at` (query) |  |  |
| `order` | enum: `asc`, `desc` (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `next_cursor` | integer (int64) |  |
| `events` | object[] |  |
| `events[].event_id` | integer (int64) |  |
| `events[].title` | string |  |
| `events[].description` | string |  |
| `events[].creator_account_index` | integer (int64) |  |
| `events[].created_at` | integer (int64) |  |
| `events[].tag` | string |  |
| `events[].event_kind` | enum: `one_off`, `recurrent` |  |
| `events[].recurrence_period_seconds` | integer (int32) |  |
| `events[].start_at` | integer (int64) |  |
| `events[].end_at` | integer (int64) |  |
| `events[].metadata` | object |  |
| `events[].order_books` | object[] |  |
| `events[].order_books[].symbol` | string |  |
| `events[].order_books[].market_id` | integer (int64) |  |
| `events[].order_books[].market_type` | enum: `perp`, `spot`, `binary_options` |  |
| `events[].order_books[].base_asset_id` | integer (int16) |  |
| `events[].order_books[].quote_asset_id` | integer (int16) |  |
| `events[].order_books[].status` | enum: `inactive`, `active`, `in-settlement`, `waiting-for-settlement`, `settled` | waiting-for-settlement and settled are binary options only |
| `events[].order_books[].taker_fee` | string |  |
| `events[].order_books[].is_taker_fee_enabled` | boolean (boolean) |  |
| `events[].order_books[].maker_fee` | string |  |
| `events[].order_books[].is_maker_fee_enabled` | boolean (boolean) |  |
| `events[].order_books[].liquidation_fee` | string |  |
| `events[].order_books[].min_base_amount` | string |  |
| `events[].order_books[].min_quote_amount` | string |  |
| `events[].order_books[].order_quote_limit` | string |  |
| `events[].order_books[].supported_size_decimals` | integer (uint8) |  |
| `events[].order_books[].supported_price_decimals` | integer (uint8) |  |
| `events[].order_books[].supported_quote_decimals` | integer (uint8) |  |
| `events[].order_books[].created_at` | string |  |
| `events[].order_books[].multiplier` | string |  |
| `events[].order_books[].start_timestamp` | integer (int64) |  |
| `events[].order_books[].end_timestamp` | integer (int64) |  |
| `events[].order_books[].open_interest` | string |  |
| `events[].order_books[].outcome` | enum: `0`, `1`, `2` |  |
| `events[].order_books[].operator_account_index` | integer (int64) |  |
| `events[].order_books[].settlement_cap` | integer (int32) |  |
| `events[].order_books[].settlement_type` | enum: `0`, `1` |  |
| `events[].order_books[].settlement_price` | integer (int32) |  |
| `events[].order_books[].default_price` | integer (int32) |  |
| `events[].order_books[].is_frozen` | boolean (boolean) |  |
| `events[].order_books[].size_decimals` | integer (uint8) |  |
| `events[].order_books[].price_decimals` | integer (uint8) |  |
| `events[].order_books[].stats` | object |  |
| `events[].lifetime_quote_token_volume` | number (double) |  |

<a id="l-funding"></a>
## funding

### `GET /api/v1/funding-rates`

funding-rates — Get funding rates across venues. For real-time funding rates, use the market_stats WebSocket channel.

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `funding_rates` | object[] |  |
| `funding_rates[].market_id` | integer (int16) |  |
| `funding_rates[].exchange` | enum: `binance`, `bybit`, `hyperliquid`, `lighter` |  |
| `funding_rates[].symbol` | string |  |
| `funding_rates[].rate` | number (double) |  |

<a id="l-info"></a>
## info

### `GET /api/v1/layer1BasicInfo`

layer1BasicInfo — Get zklighter l1 general info, including contract address and rpc info

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `l1_providers` | object[] |  |
| `l1_providers[].chainId` | integer (int64) |  |
| `l1_providers[].networkId` | integer (int64) |  |
| `l1_providers[].latestBlockNumber` | integer (int64) |  |
| `l1_providers_health` | boolean (boolean) |  |
| `validator_info` | object[] |  |
| `validator_info[].address` | string |  |
| `validator_info[].is_active` | boolean (boolean) |  |
| `contract_addresses` | object[] |  |
| `contract_addresses[].name` | string |  |
| `contract_addresses[].address` | string |  |
| `latest_l1_generic_block` | integer (int64) |  |
| `latest_l1_governance_block` | integer (int64) |  |
| `latest_l1_desert_block` | integer (int64) |  |

### `GET /api/v1/priceOracleInfo`

priceOracleInfo — Get price oracle info (source in use, median exchanges, price cap) for all markets or a single symbol

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `symbol` | string (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `computed_at_ms` | integer (int64) |  |
| `markets` | object[] |  |
| `markets[].symbol` | string |  |
| `markets[].index` | object |  |
| `markets[].index.source` | string |  |
| `markets[].index.using_median` | boolean (boolean) |  |
| `markets[].index.using_internal_price` | boolean (boolean) |  |
| `markets[].index.median_sources` | string[] |  |
| `markets[].index.price_cap_bps` | number (double) |  |
| `markets[].index.price_cap_reference_price` | number (double) | cap bounds: ref * (1 -/+ bps / 10000) |
| `markets[].mark` | object |  |
| `markets[].mark.source` | string |  |
| `markets[].mark.using_median` | boolean (boolean) |  |
| `markets[].mark.using_internal_price` | boolean (boolean) |  |
| `markets[].mark.median_sources` | string[] |  |
| `markets[].mark.price_cap_bps` | number (double) |  |
| `markets[].mark.price_cap_reference_price` | number (double) | cap bounds: ref * (1 -/+ bps / 10000) |

### `GET /api/v1/syntheticSpotInfo`

syntheticSpotInfo — Get synthetic spot info for a symbol. For complete details see: https://docs.lighter.xyz/trading/real-world-assets-rwas/us-equity-indices

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `symbol` | string (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `bps_per_day` | number (double) |  |
| `expiry_time_ms` | integer (int64) |  |
| `spot_close_ms` | integer (int64) |  |
| `source` | string |  |
| `symbol` | string |  |

### `GET /api/v1/systemConfig`

systemConfig — Get system config

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `liquidity_pool_index` | integer (int64) |  |
| `staking_pool_index` | integer (int64) |  |
| `funding_fee_rebate_account_index` | integer (int64) |  |
| `liquidity_pool_cooldown_period` | integer (int64) |  |
| `staking_pool_lockup_period` | integer (int64) |  |
| `max_integrator_perps_maker_fee` | integer (int32) |  |
| `max_integrator_perps_taker_fee` | integer (int32) |  |
| `max_integrator_spot_maker_fee` | integer (int32) |  |
| `max_integrator_spot_taker_fee` | integer (int32) |  |
| `market_maker_incentive_account_index` | integer (int64) |  |
| `fee_collector_account_index` | integer (int64) |  |

### `GET /api/v1/transferFeeInfo`

transferFeeInfo — Transfer fee info

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) | yes |  |
| `to_account_index` | integer (int64) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `transfer_fee_usdc` | integer (int64) |  |

### `GET /api/v1/withdrawalDelay`

withdrawalDelay — Withdrawal delay in seconds

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `seconds` | integer (int64) |  |

<a id="l-livepoints"></a>
## livepoints

### `GET /api/v1/livePoints/total`

livePoints_total — Get RH live points total for an account

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `account_index` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `total_live_points` | number (double) |  |

<a id="l-notification"></a>
## notification

### `POST /api/v1/notification/ack`

notification_ack — Ack notification

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `notif_id` | string | yes |  |
| `account_index` | integer (int64) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |

<a id="l-order"></a>
## order

### `GET /api/v1/accountActiveOrders`

accountActiveOrders — Get account active orders. `auth` can be generated using the SDK.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) | yes |  |
| `market_id` | integer (int16) (query) |  | If not specified, returns active orders for all markets. |
| `market_type` | enum: `all`, `spot`, `perp`, `bo` (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `next_cursor` | string |  |
| `orders` | object[] |  |
| `orders[].order_index` | integer (int64) |  |
| `orders[].client_order_index` | integer (int64) |  |
| `orders[].order_id` | string |  |
| `orders[].client_order_id` | string |  |
| `orders[].market_index` | integer (int16) |  |
| `orders[].owner_account_index` | integer (int64) |  |
| `orders[].initial_base_amount` | string |  |
| `orders[].price` | string |  |
| `orders[].nonce` | integer (int64) |  |
| `orders[].remaining_base_amount` | string |  |
| `orders[].is_ask` | boolean (boolean) |  |
| `orders[].base_size` | integer (int64) |  |
| `orders[].base_price` | integer (int32) |  |
| `orders[].filled_base_amount` | string |  |
| `orders[].filled_quote_amount` | string |  |
| `orders[].side` | string | TODO: remove this |
| `orders[].type` | enum: `limit`, `market`, `stop-loss`, `stop-loss-limit`, `take-profit`, `take-profit-limit`, `twap`, `twap-sub`, `liquidation` |  |
| `orders[].time_in_force` | enum: `good-till-time`, `immediate-or-cancel`, `post-only`, `Unknown` |  |
| `orders[].reduce_only` | boolean (boolean) |  |
| `orders[].trigger_price` | string |  |
| `orders[].order_expiry` | integer (int64) |  |
| `orders[].status` | enum: `in-progress`, `pending`, `open`, `filled`, `canceled`, `canceled-post-only`, `canceled-reduce-only`, `canceled-position-not-allowed`, `canceled-margin-not-allowed`, `canceled-too-much-slippage`, `canceled-not-enough-liquidity`, `canceled-self-trade`, … |  |
| `orders[].trigger_status` | enum: `na`, `ready`, `mark-price`, `twap`, `parent-order` |  |
| `orders[].trigger_time` | integer (int64) |  |
| `orders[].parent_order_index` | integer (int64) |  |
| `orders[].parent_order_id` | string |  |
| `orders[].to_trigger_order_id_0` | string |  |
| `orders[].to_trigger_order_id_1` | string |  |
| `orders[].to_cancel_order_id_0` | string |  |
| `orders[].block_height` | integer (int64) |  |
| `orders[].timestamp` | integer (int64) |  |
| `orders[].created_at` | integer (int64) |  |
| `orders[].updated_at` | integer (int64) |  |
| `orders[].transaction_time` | integer (int64) |  |
| `orders[].integrator_fee_collector_index` | string |  |
| `orders[].integrator_maker_fee` | string |  |
| `orders[].integrator_taker_fee` | string |  |
| `orders[].order_flags` | integer (int64) |  |
| `orders[].order_version` | integer (int64) |  |
| `orders[].market_symbol` | string |  |
| `orders[].market_kind` | enum: `spot`, `bo`, `perps` |  |

### `GET /api/v1/accountInactiveOrders`

accountInactiveOrders — Get account inactive orders. `auth` can be generated using the SDK.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) | yes |  |
| `market_id` | integer (int16) (query) |  |  |
| `ask_filter` | integer (int8) (query) |  |  |
| `between_timestamps` | string (query) |  |  |
| `cursor` | string (query) |  |  |
| `limit` | integer (int64) (query) | yes |  |
| `market_type` | enum: `all`, `spot`, `perp`, `bo` (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `next_cursor` | string |  |
| `orders` | object[] |  |
| `orders[].order_index` | integer (int64) |  |
| `orders[].client_order_index` | integer (int64) |  |
| `orders[].order_id` | string |  |
| `orders[].client_order_id` | string |  |
| `orders[].market_index` | integer (int16) |  |
| `orders[].owner_account_index` | integer (int64) |  |
| `orders[].initial_base_amount` | string |  |
| `orders[].price` | string |  |
| `orders[].nonce` | integer (int64) |  |
| `orders[].remaining_base_amount` | string |  |
| `orders[].is_ask` | boolean (boolean) |  |
| `orders[].base_size` | integer (int64) |  |
| `orders[].base_price` | integer (int32) |  |
| `orders[].filled_base_amount` | string |  |
| `orders[].filled_quote_amount` | string |  |
| `orders[].side` | string | TODO: remove this |
| `orders[].type` | enum: `limit`, `market`, `stop-loss`, `stop-loss-limit`, `take-profit`, `take-profit-limit`, `twap`, `twap-sub`, `liquidation` |  |
| `orders[].time_in_force` | enum: `good-till-time`, `immediate-or-cancel`, `post-only`, `Unknown` |  |
| `orders[].reduce_only` | boolean (boolean) |  |
| `orders[].trigger_price` | string |  |
| `orders[].order_expiry` | integer (int64) |  |
| `orders[].status` | enum: `in-progress`, `pending`, `open`, `filled`, `canceled`, `canceled-post-only`, `canceled-reduce-only`, `canceled-position-not-allowed`, `canceled-margin-not-allowed`, `canceled-too-much-slippage`, `canceled-not-enough-liquidity`, `canceled-self-trade`, … |  |
| `orders[].trigger_status` | enum: `na`, `ready`, `mark-price`, `twap`, `parent-order` |  |
| `orders[].trigger_time` | integer (int64) |  |
| `orders[].parent_order_index` | integer (int64) |  |
| `orders[].parent_order_id` | string |  |
| `orders[].to_trigger_order_id_0` | string |  |
| `orders[].to_trigger_order_id_1` | string |  |
| `orders[].to_cancel_order_id_0` | string |  |
| `orders[].block_height` | integer (int64) |  |
| `orders[].timestamp` | integer (int64) |  |
| `orders[].created_at` | integer (int64) |  |
| `orders[].updated_at` | integer (int64) |  |
| `orders[].transaction_time` | integer (int64) |  |
| `orders[].integrator_fee_collector_index` | string |  |
| `orders[].integrator_maker_fee` | string |  |
| `orders[].integrator_taker_fee` | string |  |
| `orders[].order_flags` | integer (int64) |  |
| `orders[].order_version` | integer (int64) |  |
| `orders[].market_symbol` | string |  |
| `orders[].market_kind` | enum: `spot`, `bo`, `perps` |  |

### `GET /api/v1/accountOrders`

accountOrders — Get account orders by client order indexes. Account index defaults to the authorization token's account. Supports the last 10K active orders (with no time limits), or the last 1K inactive orders (in the last 24 hours).

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) |  |  |
| `client_order_indexes` | string (query) | yes | comma-separated int64s, e.g. "123,456", with a limit of 20. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `next_cursor` | string |  |
| `orders` | object[] |  |
| `orders[].order_index` | integer (int64) |  |
| `orders[].client_order_index` | integer (int64) |  |
| `orders[].order_id` | string |  |
| `orders[].client_order_id` | string |  |
| `orders[].market_index` | integer (int16) |  |
| `orders[].owner_account_index` | integer (int64) |  |
| `orders[].initial_base_amount` | string |  |
| `orders[].price` | string |  |
| `orders[].nonce` | integer (int64) |  |
| `orders[].remaining_base_amount` | string |  |
| `orders[].is_ask` | boolean (boolean) |  |
| `orders[].base_size` | integer (int64) |  |
| `orders[].base_price` | integer (int32) |  |
| `orders[].filled_base_amount` | string |  |
| `orders[].filled_quote_amount` | string |  |
| `orders[].side` | string | TODO: remove this |
| `orders[].type` | enum: `limit`, `market`, `stop-loss`, `stop-loss-limit`, `take-profit`, `take-profit-limit`, `twap`, `twap-sub`, `liquidation` |  |
| `orders[].time_in_force` | enum: `good-till-time`, `immediate-or-cancel`, `post-only`, `Unknown` |  |
| `orders[].reduce_only` | boolean (boolean) |  |
| `orders[].trigger_price` | string |  |
| `orders[].order_expiry` | integer (int64) |  |
| `orders[].status` | enum: `in-progress`, `pending`, `open`, `filled`, `canceled`, `canceled-post-only`, `canceled-reduce-only`, `canceled-position-not-allowed`, `canceled-margin-not-allowed`, `canceled-too-much-slippage`, `canceled-not-enough-liquidity`, `canceled-self-trade`, … |  |
| `orders[].trigger_status` | enum: `na`, `ready`, `mark-price`, `twap`, `parent-order` |  |
| `orders[].trigger_time` | integer (int64) |  |
| `orders[].parent_order_index` | integer (int64) |  |
| `orders[].parent_order_id` | string |  |
| `orders[].to_trigger_order_id_0` | string |  |
| `orders[].to_trigger_order_id_1` | string |  |
| `orders[].to_cancel_order_id_0` | string |  |
| `orders[].block_height` | integer (int64) |  |
| `orders[].timestamp` | integer (int64) |  |
| `orders[].created_at` | integer (int64) |  |
| `orders[].updated_at` | integer (int64) |  |
| `orders[].transaction_time` | integer (int64) |  |
| `orders[].integrator_fee_collector_index` | string |  |
| `orders[].integrator_maker_fee` | string |  |
| `orders[].integrator_taker_fee` | string |  |
| `orders[].order_flags` | integer (int64) |  |
| `orders[].order_version` | integer (int64) |  |
| `orders[].market_symbol` | string |  |
| `orders[].market_kind` | enum: `spot`, `bo`, `perps` |  |

### `GET /api/v1/assetDetails`

assetDetails — Get asset details for a specific asset or all assets

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `asset_id` | integer (int16) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `asset_details` | object[] |  |
| `asset_details[].asset_id` | integer (int16) |  |
| `asset_details[].symbol` | string |  |
| `asset_details[].l1_decimals` | integer (uint8) |  |
| `asset_details[].decimals` | integer (uint8) |  |
| `asset_details[].min_transfer_amount` | string |  |
| `asset_details[].min_withdrawal_amount` | string |  |
| `asset_details[].margin_mode` | enum: `enabled`, `disabled`, `priced_only` |  |
| `asset_details[].index_price` | string |  |
| `asset_details[].l1_address` | string |  |
| `asset_details[].global_supply_cap` | string |  |
| `asset_details[].liquidation_fee` | string |  |
| `asset_details[].liquidation_threshold` | string |  |
| `asset_details[].loan_to_value` | string |  |
| `asset_details[].price_decimals` | integer (uint8) |  |
| `asset_details[].total_supplied` | string |  |
| `asset_details[].user_supply_cap` | string |  |
| `asset_details[].liquidation_factor` | string |  |
| `asset_details[].multiplier` | string |  |

### `GET /api/v1/exchangeMetrics`

exchangeMetrics — Get exchange metrics. When filtering by market, use the market symbol as a value.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `period` | enum: `h`, `d`, `w`, `m`, `q`, `y`, `all` (query) | yes |  |
| `kind` | enum: `volume`, `maker_fee`, `taker_fee`, `liquidation_fee`, `trade_count`, `liquidation_count`, `liquidation_volume`, `inflow`, `outflow`, `transfer_fee`, `withdraw_fee`, `open_interest`, … (query) | yes |  |
| `filter` | enum: `byMarket` (query) |  |  |
| `value` | string (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `metrics` | object[] |  |
| `metrics[].timestamp` | integer (int64) |  |
| `metrics[].data` | number (double) |  |

### `GET /api/v1/exchangeStats`

exchangeStats — Get exchange stats

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `total` | integer (int64) |  |
| `order_book_stats` | object[] |  |
| `order_book_stats[].symbol` | string |  |
| `order_book_stats[].last_trade_price` | number (double) |  |
| `order_book_stats[].daily_trades_count` | integer (int64) |  |
| `order_book_stats[].daily_base_token_volume` | number (double) |  |
| `order_book_stats[].daily_quote_token_volume` | number (double) |  |
| `order_book_stats[].daily_price_change` | number (double) |  |
| `daily_usd_volume` | number (double) |  |
| `daily_trades_count` | integer (int64) |  |

### `GET /api/v1/executeStats`

executeStats — Get execute stats

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `period` | enum: `d`, `w`, `m`, `q`, `y`, `all` (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `period` | enum: `d`, `w`, `m`, `q`, `y`, `all` |  |
| `result` | object[] |  |
| `result[].timestamp` | integer (int64) |  |
| `result[].slippage` | object[] |  |
| `result[].slippage[].exchange` | string |  |
| `result[].slippage[].market` | string |  |
| `result[].slippage[].size_usd` | integer (int64) |  |
| `result[].slippage[].avg_slippage` | number (double) |  |
| `result[].slippage[].data_count` | integer (int64) |  |

### `GET /api/v1/export`

export — Export trades and funding payments, limited to 12 months or 1M trades. END_TS_IN_MS - START_TS_IN_MS should not be larger than 12 months in milliseconds, both timestamps should be greater than or equal to 17 January 2025 00:00:00 UTC (lighter's mainnet genesis)

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) |  |  |
| `market_id` | integer (int16) (query) |  |  |
| `type` | enum: `funding`, `trade` (query) | yes |  |
| `start_timestamp` | integer (int64) (query) |  |  |
| `end_timestamp` | integer (int64) (query) |  |  |
| `side` | enum: `all`, `long`, `short` (query) |  |  |
| `role` | enum: `all`, `maker`, `taker` (query) |  |  |
| `trade_type` | enum: `all`, `trade`, `liquidation`, `deleverage`, `market-settlement` (query) |  |  |
| `aggregate` | boolean (boolean) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `data_url` | string |  |

### `GET /api/v1/export/historicalTrades`

export_historicalTrades — Export global historical trades, updated daily at 8 PM UTC. Requires a one-time 100 LIT L2Transfer to 0x4FD058F25bE85E459ec552cA8e4C696FD1D34125. Returns a presigned S3 URL valid for 1 hour.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  | make required after integ is done |
| `auth` | string (query) |  | made optional to support header auth clients |
| `l1_address` | string (query) | yes |  |
| `date` | string (query) | yes | UTC day, YYYY-MM-DD |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `data_url` | string |  |
| `expires_at` | string |  |

### `GET /api/v1/orderBookDetails`

orderBookDetails — Get order books metadata

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `market_id` | integer (int16) (query) |  |  |
| `filter` | enum: `all`, `spot`, `perp` (query) |  | Filter order books by type |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `order_book_details` | object[] |  |
| `order_book_details[].symbol` | string |  |
| `order_book_details[].market_id` | integer (int16) |  |
| `order_book_details[].market_type` | enum: `perp`, `spot`, `binary_options` |  |
| `order_book_details[].base_asset_id` | integer (int16) |  |
| `order_book_details[].quote_asset_id` | integer (int16) |  |
| `order_book_details[].status` | enum: `inactive`, `active`, `in-settlement`, `waiting-for-settlement`, `settled` |  |
| `order_book_details[].taker_fee` | string |  |
| `order_book_details[].maker_fee` | string |  |
| `order_book_details[].liquidation_fee` | string |  |
| `order_book_details[].min_base_amount` | string |  |
| `order_book_details[].min_quote_amount` | string |  |
| `order_book_details[].supported_size_decimals` | integer (uint8) |  |
| `order_book_details[].supported_price_decimals` | integer (uint8) |  |
| `order_book_details[].supported_quote_decimals` | integer (uint8) |  |
| `order_book_details[].order_quote_limit` | string |  |
| `order_book_details[].size_decimals` | integer (uint8) |  |
| `order_book_details[].price_decimals` | integer (uint8) |  |
| `order_book_details[].quote_multiplier` | integer (int64) |  |
| `order_book_details[].default_initial_margin_fraction` | integer (uin16) |  |
| `order_book_details[].min_initial_margin_fraction` | integer (uin16) |  |
| `order_book_details[].maintenance_margin_fraction` | integer (uin16) |  |
| `order_book_details[].closeout_margin_fraction` | integer (uin16) |  |
| `order_book_details[].last_trade_price` | number (double) |  |
| `order_book_details[].daily_trades_count` | integer (int64) |  |
| `order_book_details[].daily_base_token_volume` | number (double) |  |
| `order_book_details[].daily_quote_token_volume` | number (double) |  |
| `order_book_details[].daily_price_low` | number (double) |  |
| `order_book_details[].daily_price_high` | number (double) |  |
| `order_book_details[].daily_price_change` | number (double) |  |
| `order_book_details[].open_interest` | number (double) |  |
| `order_book_details[].daily_chart` | object |  |
| `order_book_details[].market_config` | object |  |
| `order_book_details[].market_config.market_margin_mode` | integer (int32) |  |
| `order_book_details[].market_config.insurance_fund_account_index` | integer (int64) |  |
| `order_book_details[].market_config.liquidation_mode` | integer (int32) |  |
| `order_book_details[].market_config.force_reduce_only` | boolean (boolean) |  |
| `order_book_details[].market_config.funding_fee_discounts_enabled` | boolean (boolean) |  |
| `order_book_details[].market_config.trading_hours` | string |  |
| `order_book_details[].market_config.hidden` | boolean |  |
| `order_book_details[].market_config.rfq_enabled` | boolean (boolean) |  |
| `order_book_details[].strategy_index` | integer (uint8) |  |
| `order_book_details[].is_maker_fee_enabled` | boolean |  |
| `order_book_details[].is_taker_fee_enabled` | boolean |  |
| `order_book_details[].funding_clamp_small` | string |  |
| `order_book_details[].funding_clamp_big` | string |  |
| `order_book_details[].base_interest_rate` | string |  |
| `order_book_details[].created_at` | string |  |
| `order_book_details[].mark_price` | string |  |
| `order_book_details[].index_price` | string |  |
| `order_book_details[].multiplier` | string |  |
| `order_book_details[].market_flags` | integer (int64) |  |
| `order_book_details[].funding_premium_multiplier` | integer (uin16) |  |
| `order_book_details[].start_timestamp` | integer (int64) |  |
| `order_book_details[].end_timestamp` | integer (int64) |  |
| `order_book_details[].settlement_type` | enum: `0`, `1` |  |
| `order_book_details[].settlement_price` | integer (int32) |  |
| `order_book_details[].settlement_cap` | integer (int32) |  |
| `order_book_details[].outcome` | enum: `0`, `1`, `2` |  |
| `order_book_details[].default_price` | integer (int32) |  |
| `order_book_details[].operator_account_index` | integer (int64) |  |
| `order_book_details[].is_frozen` | boolean |  |
| `spot_order_book_details` | object[] |  |
| `spot_order_book_details[].symbol` | string |  |
| `spot_order_book_details[].market_id` | integer (int16) |  |
| `spot_order_book_details[].market_type` | enum: `perp`, `spot`, `binary_options` |  |
| `spot_order_book_details[].base_asset_id` | integer (int16) |  |
| `spot_order_book_details[].quote_asset_id` | integer (int16) |  |
| `spot_order_book_details[].status` | enum: `inactive`, `active`, `in-settlement`, `waiting-for-settlement`, `settled` |  |
| `spot_order_book_details[].taker_fee` | string |  |
| `spot_order_book_details[].maker_fee` | string |  |
| `spot_order_book_details[].liquidation_fee` | string |  |
| `spot_order_book_details[].min_base_amount` | string |  |
| `spot_order_book_details[].min_quote_amount` | string |  |
| `spot_order_book_details[].order_quote_limit` | string |  |
| `spot_order_book_details[].supported_size_decimals` | integer (uint8) |  |
| `spot_order_book_details[].supported_price_decimals` | integer (uint8) |  |
| `spot_order_book_details[].supported_quote_decimals` | integer (uint8) |  |
| `spot_order_book_details[].size_decimals` | integer (uint8) |  |
| `spot_order_book_details[].price_decimals` | integer (uint8) |  |
| `spot_order_book_details[].last_trade_price` | number (double) |  |
| `spot_order_book_details[].daily_trades_count` | integer (int64) |  |
| `spot_order_book_details[].daily_base_token_volume` | number (double) |  |
| `spot_order_book_details[].daily_quote_token_volume` | number (double) |  |
| `spot_order_book_details[].daily_price_low` | number (double) |  |
| `spot_order_book_details[].daily_price_high` | number (double) |  |
| `spot_order_book_details[].daily_price_change` | number (double) |  |
| `spot_order_book_details[].daily_chart` | object |  |

### `GET /api/v1/orderBookOrders`

orderBookOrders — Get order book orders

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `market_id` | integer (int16) (query) | yes |  |
| `limit` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `total_asks` | integer (int64) |  |
| `asks` | object[] |  |
| `asks[].order_index` | integer (int64) |  |
| `asks[].order_id` | string |  |
| `asks[].owner_account_index` | integer (int64) |  |
| `asks[].initial_base_amount` | string |  |
| `asks[].remaining_base_amount` | string |  |
| `asks[].price` | string |  |
| `asks[].order_expiry` | integer (int64) |  |
| `asks[].transaction_time` | integer (int64) |  |
| `total_bids` | integer (int64) |  |
| `bids` | object[] |  |
| `bids[].order_index` | integer (int64) |  |
| `bids[].order_id` | string |  |
| `bids[].owner_account_index` | integer (int64) |  |
| `bids[].initial_base_amount` | string |  |
| `bids[].remaining_base_amount` | string |  |
| `bids[].price` | string |  |
| `bids[].order_expiry` | integer (int64) |  |
| `bids[].transaction_time` | integer (int64) |  |

### `GET /api/v1/orderBooks`

orderBooks — Get order books metadata.<hr>**Response Description:**<br><br>1) **Taker and maker fees** are in percentage.<br>2) **Min base amount:** The amount of base token that can be traded in a single order.<br>3) **Min quote amount:** The amount of quote token that can be traded in a single order.<br>4) **Supported size decimals:** The number of decimal places that can be used for the size of the order.<br>5) **Supported price decimals:** The number of decimal places that can be used for the price of the order.<br>6) **Supported quote decimals:** Size Decimals + Quote Decimals.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `market_id` | integer (int16) (query) |  |  |
| `filter` | enum: `all`, `spot`, `perp` (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `order_books` | object[] |  |
| `order_books[].symbol` | string |  |
| `order_books[].market_id` | integer (int16) |  |
| `order_books[].market_type` | enum: `perp`, `spot`, `binary_options` |  |
| `order_books[].base_asset_id` | integer (int16) |  |
| `order_books[].quote_asset_id` | integer (int16) |  |
| `order_books[].status` | enum: `inactive`, `active`, `in-settlement`, `waiting-for-settlement`, `settled` |  |
| `order_books[].taker_fee` | string |  |
| `order_books[].maker_fee` | string |  |
| `order_books[].liquidation_fee` | string |  |
| `order_books[].min_base_amount` | string |  |
| `order_books[].min_quote_amount` | string |  |
| `order_books[].supported_size_decimals` | integer (uint8) |  |
| `order_books[].supported_price_decimals` | integer (uint8) |  |
| `order_books[].supported_quote_decimals` | integer (uint8) |  |
| `order_books[].order_quote_limit` | string |  |
| `order_books[].is_maker_fee_enabled` | boolean |  |
| `order_books[].is_taker_fee_enabled` | boolean |  |
| `order_books[].created_at` | string |  |
| `order_books[].multiplier` | string |  |
| `order_books[].start_timestamp` | integer (int64) |  |
| `order_books[].end_timestamp` | integer (int64) |  |
| `order_books[].settlement_type` | enum: `0`, `1` |  |
| `order_books[].settlement_price` | integer (int32) |  |
| `order_books[].settlement_cap` | integer (int32) |  |
| `order_books[].outcome` | enum: `0`, `1`, `2` |  |
| `order_books[].default_price` | integer (int32) |  |
| `order_books[].operator_account_index` | integer (int64) |  |
| `order_books[].is_frozen` | boolean |  |
| `order_books[].open_interest` | string |  |

### `GET /api/v1/recentTrades`

recentTrades — Get recent trades

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `market_id` | integer (int16) (query) | yes |  |
| `limit` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `next_cursor` | string |  |
| `trades` | object[] |  |
| `trades[].trade_id` | integer (int64) |  |
| `trades[].tx_hash` | string |  |
| `trades[].type` | enum: `trade`, `liquidation`, `deleverage`, `market-settlement` |  |
| `trades[].market_id` | integer (int16) |  |
| `trades[].size` | string |  |
| `trades[].price` | string |  |
| `trades[].usd_amount` | string |  |
| `trades[].ask_id` | integer (int64) |  |
| `trades[].bid_id` | integer (int64) |  |
| `trades[].ask_account_id` | integer (int64) |  |
| `trades[].bid_account_id` | integer (int64) |  |
| `trades[].is_maker_ask` | boolean (boolean) |  |
| `trades[].block_height` | integer (int64) |  |
| `trades[].timestamp` | integer (int64) |  |
| `trades[].taker_fee` | integer (int32) |  |
| `trades[].taker_position_size_before` | string |  |
| `trades[].taker_entry_quote_before` | string |  |
| `trades[].taker_initial_margin_fraction_before` | integer (uin16) |  |
| `trades[].taker_position_sign_changed` | boolean (boolean) |  |
| `trades[].maker_fee` | integer (int32) |  |
| `trades[].maker_position_size_before` | string |  |
| `trades[].maker_entry_quote_before` | string |  |
| `trades[].maker_initial_margin_fraction_before` | integer (uin16) |  |
| `trades[].maker_position_sign_changed` | boolean (boolean) |  |
| `trades[].transaction_time` | integer (int64) |  |
| `trades[].bid_account_pnl` | string | Realized PnL for the queried account index, triggered by reducing a short position |
| `trades[].ask_account_pnl` | string | Realized PnL for the queried account index, triggered by reducing a long position, or a spot position |
| `trades[].ask_client_id` | integer (int64) |  |
| `trades[].bid_client_id` | integer (int64) |  |
| `trades[].ask_client_id_str` | string |  |
| `trades[].bid_client_id_str` | string |  |
| `trades[].ask_id_str` | string |  |
| `trades[].bid_id_str` | string |  |
| `trades[].trade_id_str` | string |  |
| `trades[].integrator_maker_fee` | integer (int32) |  |
| `trades[].integrator_maker_fee_collector_index` | integer (int64) |  |
| `trades[].integrator_taker_fee` | integer (int32) |  |
| `trades[].integrator_taker_fee_collector_index` | integer (int64) |  |
| `trades[].taker_allocated_margin_usdc_before` | integer (int64) |  |
| `trades[].taker_allocated_margin_usdc_after` | integer (int64) |  |
| `trades[].maker_allocated_margin_usdc_before` | integer (int64) |  |
| `trades[].maker_allocated_margin_usdc_after` | integer (int64) |  |
| `trades[].bid_order_version` | integer (int64) |  |
| `trades[].ask_order_version` | integer (int64) |  |
| `trades[].market_symbol` | string |  |
| `trades[].market_kind` | enum: `spot`, `bo`, `perps` |  |

### `GET /api/v1/trades`

trades — Get trades for lighter accounts, including sub-accounts and public pools. `auth` is required for master accounts and sub accounts.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `market_id` | integer (int16) (query) |  |  |
| `market_type` | enum: `all`, `spot`, `perp`, `bo` (query) |  |  |
| `account_index` | integer (int64) (query) |  |  |
| `order_index` | integer (int64) (query) |  |  |
| `sort_by` | enum: `block_height`, `timestamp`, `trade_id` (query) | yes |  |
| `sort_dir` | enum: `desc` (query) |  |  |
| `cursor` | string (query) |  |  |
| `from` | integer (int64) (query) |  |  |
| `ask_filter` | integer (int8) (query) |  |  |
| `role` | enum: `all`, `maker`, `taker` (query) |  |  |
| `type` | enum: `all`, `trade`, `liquidation`, `deleverage`, `market-settlement` (query) |  |  |
| `limit` | integer (int64) (query) | yes |  |
| `aggregate` | boolean (boolean) (query) |  |  |
| `skip_ask_order_id` | string (query) |  |  |
| `skip_bid_order_id` | string (query) |  |  |
| `integrator_account_index` | integer (int64) (query) |  |  |
| `order_index_str` | string (query) |  | takes precedence over order_index; for clients that cannot represent uint64 exactly |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `next_cursor` | string |  |
| `trades` | object[] |  |
| `trades[].trade_id` | integer (int64) |  |
| `trades[].tx_hash` | string |  |
| `trades[].type` | enum: `trade`, `liquidation`, `deleverage`, `market-settlement` |  |
| `trades[].market_id` | integer (int16) |  |
| `trades[].size` | string |  |
| `trades[].price` | string |  |
| `trades[].usd_amount` | string |  |
| `trades[].ask_id` | integer (int64) |  |
| `trades[].bid_id` | integer (int64) |  |
| `trades[].ask_account_id` | integer (int64) |  |
| `trades[].bid_account_id` | integer (int64) |  |
| `trades[].is_maker_ask` | boolean (boolean) |  |
| `trades[].block_height` | integer (int64) |  |
| `trades[].timestamp` | integer (int64) |  |
| `trades[].taker_fee` | integer (int32) |  |
| `trades[].taker_position_size_before` | string |  |
| `trades[].taker_entry_quote_before` | string |  |
| `trades[].taker_initial_margin_fraction_before` | integer (uin16) |  |
| `trades[].taker_position_sign_changed` | boolean (boolean) |  |
| `trades[].maker_fee` | integer (int32) |  |
| `trades[].maker_position_size_before` | string |  |
| `trades[].maker_entry_quote_before` | string |  |
| `trades[].maker_initial_margin_fraction_before` | integer (uin16) |  |
| `trades[].maker_position_sign_changed` | boolean (boolean) |  |
| `trades[].transaction_time` | integer (int64) |  |
| `trades[].bid_account_pnl` | string | Realized PnL for the queried account index, triggered by reducing a short position |
| `trades[].ask_account_pnl` | string | Realized PnL for the queried account index, triggered by reducing a long position, or a spot position |
| `trades[].ask_client_id` | integer (int64) |  |
| `trades[].bid_client_id` | integer (int64) |  |
| `trades[].ask_client_id_str` | string |  |
| `trades[].bid_client_id_str` | string |  |
| `trades[].ask_id_str` | string |  |
| `trades[].bid_id_str` | string |  |
| `trades[].trade_id_str` | string |  |
| `trades[].integrator_maker_fee` | integer (int32) |  |
| `trades[].integrator_maker_fee_collector_index` | integer (int64) |  |
| `trades[].integrator_taker_fee` | integer (int32) |  |
| `trades[].integrator_taker_fee_collector_index` | integer (int64) |  |
| `trades[].taker_allocated_margin_usdc_before` | integer (int64) |  |
| `trades[].taker_allocated_margin_usdc_after` | integer (int64) |  |
| `trades[].maker_allocated_margin_usdc_before` | integer (int64) |  |
| `trades[].maker_allocated_margin_usdc_after` | integer (int64) |  |
| `trades[].bid_order_version` | integer (int64) |  |
| `trades[].ask_order_version` | integer (int64) |  |
| `trades[].market_symbol` | string |  |
| `trades[].market_kind` | enum: `spot`, `bo`, `perps` |  |

<a id="l-portfolio"></a>
## portfolio

### `GET /api/v1/portfolio/boPnl`

portfolio_boPnl — Get binary-options realized PnL for an authenticated account, grouped by event and ordered newest event first. cursor is an exclusive event id; event_id returns a single event. Every outcome the account has traded is reported, including markets still open or unsettled, so an entry never disappears as the account trades. Per outcome, total_pnl is all realized PnL so far including settlement, and settlement_pnl is null until the market settles with a position to settle, then the string 0.000000 for an actual zero-PnL settlement. An event's total_pnl is the sum of its listed outcomes. Missing display metadata uses zero/empty values.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  | make required after integ is done |
| `auth` | string (query) |  | made optional to support header auth clients |
| `account_index` | integer (int64) (query) | yes |  |
| `event_id` | integer (int64) (query) |  |  |
| `cursor` | integer (int64) (query) |  |  |
| `limit` | integer (int64) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `events` | object[] |  |
| `events[].event_id` | integer (int64) |  |
| `events[].event_title` | string |  |
| `events[].event_description` | string |  |
| `events[].total_pnl` | string |  |
| `events[].outcomes` | object[] |  |
| `events[].outcomes[].market_id` | integer (int64) |  |
| `events[].outcomes[].symbol` | string |  |
| `events[].outcomes[].outcome` | enum: `0`, `1`, `2` |  |
| `events[].outcomes[].end_timestamp` | integer (int64) |  |
| `events[].outcomes[].settlement_pnl` | string |  |
| `events[].outcomes[].last_trade_id` | integer (int64) |  |
| `events[].outcomes[].total_pnl` | string |  |
| `next_cursor` | integer (int64) |  |

<a id="l-referral"></a>
## referral

### `POST /api/v1/referral/create`

referral_create — Create referral code

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `account_index` | integer (int64) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `referral_code` | string |  |

### `GET /api/v1/referral/get`

referral_get — Get referral code

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `account_index` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `referral_code` | string |  |

### `POST /api/v1/referral/kickback/update`

referral_kickback_update — Update kickback percentage for referral rewards (allowed once per day)

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `account_index` | integer (int64) | yes |  |
| `kickback_percentage` | number (double) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `success` | boolean (boolean) |  |

### `GET /api/v1/referral/points`

referral_points — Get referral points

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `referrals` | object[] |  |
| `referrals[].l1_address` | string |  |
| `referrals[].total_points` | number (float) |  |
| `referrals[].week_points` | number (float) |  |
| `referrals[].total_reward_points` | number (float) |  |
| `referrals[].week_reward_points` | number (float) |  |
| `referrals[].reward_point_multiplier` | string |  |
| `user_total_points` | number (float) |  |
| `user_last_week_points` | number (float) |  |
| `user_total_referral_reward_points` | number (float) |  |
| `user_last_week_referral_reward_points` | number (float) |  |
| `reward_point_multiplier` | string |  |

### `GET /api/v1/referral/stats`

referral_stats — Get trade stats summed across a referrer's referred users

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `auth` | string (query) |  |  |
| `l1_address` | string (query) | yes |  |
| `is_eligible` | boolean (boolean) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `stats` | object[] |  |
| `stats[].start_timestamp` | integer (int64) |  |
| `stats[].end_timestamp` | integer (int64) |  |
| `stats[].trade_stats` | object |  |
| `stats[].trade_stats.count` | integer (int64) |  |
| `stats[].trade_stats.volume` | string |  |
| `stats[].trade_stats.web_count` | integer (int64) |  |
| `stats[].trade_stats.web_volume` | string |  |
| `stats[].trade_stats.mobile_app_count` | integer (int64) |  |
| `stats[].trade_stats.mobile_app_volume` | string |  |
| `stats[].trade_stats.mobile_browser_count` | integer (int64) |  |
| `stats[].trade_stats.mobile_browser_volume` | string |  |
| `stats[].trade_stats.maker_fees_paid` | string |  |
| `stats[].trade_stats.non_free_taker_volume` | string |  |
| `stats[].trade_stats.non_free_maker_volume` | string |  |
| `stats[].trade_stats.free_taker_volume` | string |  |
| `stats[].trade_stats.taker_fees_paid` | string |  |
| `stats[].trade_stats.free_maker_volume` | string |  |

### `POST /api/v1/referral/update`

referral_update — Update referral code (allowed once per account)

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `account_index` | integer (int64) | yes |  |
| `new_referral_code` | string | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `success` | boolean (boolean) |  |

### `POST /api/v1/referral/use`

referral_use — Use a referral code. You can change this at a later time.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `l1_address` | string | yes |  |
| `referral_code` | string | yes |  |
| `discord` | string |  |  |
| `telegram` | string |  |  |
| `x` | string |  |  |
| `signature` | string |  |  |
| `source` | string |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |

<a id="l-root"></a>
## root

### `GET /`

status — Get status of zklighter

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `status` | integer (int32) |  |
| `network_id` | integer (int32) |  |
| `timestamp` | integer (int64) |  |

### `GET /info`

info — Get info of zklighter

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `contract_address` | string |  |

<a id="l-tokenlist"></a>
## tokenlist

### `GET /api/v1/tokenlist`

tokenlist — Get token list and their metadata

**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `tokens` | object[] |  |
| `tokens[].symbol` | string |  |
| `tokens[].name` | string |  |
| `tokens[].logo` | string |  |
| `tokens[].logo_extension` | enum: `svg`, `png` |  |
| `tokens[].description_key` | string |  |
| `tokens[].gecko_id` | string |  |
| `tokens[].paprika_id` | string |  |
| `tokens[].market` | enum: `SPOT`, `PERPS` |  |
| `tokens[].asset_type` | enum: `CRYPTO`, `RWA` |  |
| `tokens[].categories` | string[] |  |
| `tokens[].is_allowed_mainnet` | boolean (boolean) |  |
| `tokens[].is_asset_allowed_mainnet` | boolean (boolean) |  |
| `tokens[].default_order_book_group_by` | integer (int64) |  |
| `tokens[].backend_symbol` | string |  |

<a id="l-transaction"></a>
## transaction

### `GET /api/v1/accountTxs`

accountTxs — Get transactions of a specific account

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `index` | integer (int64) (query) |  |  |
| `limit` | integer (int64) (query) | yes |  |
| `by` | enum: `account_index` (query) | yes |  |
| `value` | string (query) | yes |  |
| `authorization` | string (header) |  |  |
| `types` | integer (uint8)[] (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `txs` | object[] |  |
| `txs[].hash` | string |  |
| `txs[].type` | integer (uint8) |  |
| `txs[].info` | string |  |
| `txs[].event_info` | string |  |
| `txs[].status` | integer (int64) |  |
| `txs[].transaction_index` | integer (int64) |  |
| `txs[].l1_address` | string |  |
| `txs[].account_index` | integer (int64) |  |
| `txs[].nonce` | integer (int64) |  |
| `txs[].expire_at` | integer (int64) |  |
| `txs[].block_height` | integer (int64) |  |
| `txs[].queued_at` | integer (int64) |  |
| `txs[].executed_at` | integer (int64) |  |
| `txs[].sequence_index` | integer (int64) |  |
| `txs[].parent_hash` | string |  |
| `txs[].api_key_index` | integer (uint8) |  |
| `txs[].transaction_time` | integer (int64) |  |

### `GET /api/v1/blockTxs`

blockTxs — Get transactions in a block

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `by` | enum: `block_height`, `block_commitment` (query) | yes |  |
| `value` | string (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `txs` | object[] |  |
| `txs[].hash` | string |  |
| `txs[].type` | integer (uint8) |  |
| `txs[].info` | string |  |
| `txs[].event_info` | string |  |
| `txs[].status` | integer (int64) |  |
| `txs[].transaction_index` | integer (int64) |  |
| `txs[].l1_address` | string |  |
| `txs[].account_index` | integer (int64) |  |
| `txs[].nonce` | integer (int64) |  |
| `txs[].expire_at` | integer (int64) |  |
| `txs[].block_height` | integer (int64) |  |
| `txs[].queued_at` | integer (int64) |  |
| `txs[].executed_at` | integer (int64) |  |
| `txs[].sequence_index` | integer (int64) |  |
| `txs[].parent_hash` | string |  |
| `txs[].api_key_index` | integer (uint8) |  |
| `txs[].transaction_time` | integer (int64) |  |

### `GET /api/v1/deposit/history`

deposit_history — Get deposit history

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) | yes |  |
| `l1_address` | string (query) | yes |  |
| `cursor` | string (query) |  |  |
| `filter` | enum: `all`, `pending`, `claimable` (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `deposits` | object[] |  |
| `deposits[].id` | string |  |
| `deposits[].amount` | string |  |
| `deposits[].timestamp` | integer (int64) |  |
| `deposits[].status` | enum: `failed`, `pending`, `completed`, `claimable` |  |
| `deposits[].l1_tx_hash` | string |  |
| `deposits[].asset_id` | integer (int16) |  |
| `cursor` | string |  |

### `GET /api/v1/nextNonce`

nextNonce — Get next nonce for a specific account and api key

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `account_index` | integer (int64) (query) | yes |  |
| `api_key_index` | integer (uint8) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `nonce` | integer (int64) |  |

### `POST /api/v1/sendTx`

sendTx — You need to sign the transaction body before sending it to the server. More details can be found here: https://docs.lighter.xyz/developers/integration-guides/signing-transactions

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `tx_type` | integer (uint8) | yes |  |
| `tx_info` | string | yes |  |
| `price_protection` | boolean (boolean) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `tx_hash` | string |  |
| `predicted_execution_time_ms` | integer (int64) |  |
| `volume_quota_remaining` | integer (int64) |  |

### `POST /api/v1/sendTxBatch`

sendTxBatch — You need to sign the transaction body before sending it to the server. More details can be found here: https://docs.lighter.xyz/developers/integration-guides/signing-transactions

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `tx_types` | string | yes |  |
| `tx_infos` | string | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `tx_hash` | string[] |  |
| `predicted_execution_time_ms` | integer (int64) |  |
| `volume_quota_remaining` | integer (int64) |  |

### `POST /api/v1/setAccountMetadata`

setAccountMetadata — Set account metadata

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `master_account_index` | integer (int64) | yes |  |
| `target_account_index` | integer (int64) | yes |  |
| `api_key_index` | integer (uint8) | yes |  |
| `metadata` | string | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |

### `GET /api/v1/transfer/history`

transfer_history — Get transfer history. To fetch an account index, you will need to `auth` the request, unless it's a public pool.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) |  |  |
| `account_index` | integer (int64) (query) | yes |  |
| `cursor` | string (query) |  |  |
| `type` | enum: `all`, `L2Transfer`, `L2MintShares`, `L2BurnShares`, `L2StakeAssets`, `L2UnstakeAssets`, `L2CreatePublicPool`, `L2CreateStakingPool`, `L1BurnShares`, `L1UnstakeAssets`, `ReferralProgramPayout`[] (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `transfers` | object[] |  |
| `transfers[].id` | string |  |
| `transfers[].amount` | string |  |
| `transfers[].timestamp` | integer (int64) |  |
| `transfers[].type` | enum: `L2TransferInflow`, `L2TransferOutflow`, `L2BurnSharesInflow`, `L2BurnSharesOutflow`, `L2MintSharesInflow`, `L2MintSharesOutflow`, `L2SelfTransfer`, `L2StakeAssetInflow`, `L2StakeAssetOutflow`, `L2UnstakeAssetInflow`, `L2UnstakeAssetOutflow`, `L2ForceBurnSharesInflow`, … |  |
| `transfers[].from_l1_address` | string |  |
| `transfers[].to_l1_address` | string |  |
| `transfers[].from_account_index` | integer (int64) |  |
| `transfers[].to_account_index` | integer (int64) |  |
| `transfers[].tx_hash` | string |  |
| `transfers[].asset_id` | integer (int16) |  |
| `transfers[].fee` | string |  |
| `transfers[].from_route` | enum: `spot`, `perps` |  |
| `transfers[].to_route` | enum: `spot`, `perps` |  |
| `cursor` | string |  |

### `GET /api/v1/tx`

tx — Get transaction by hash or sequence index

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `by` | enum: `hash`, `sequence_index` (query) | yes |  |
| `value` | string (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `hash` | string |  |
| `type` | integer (uint8) |  |
| `info` | string |  |
| `event_info` | string |  |
| `status` | integer (int64) |  |
| `transaction_index` | integer (int64) |  |
| `l1_address` | string |  |
| `account_index` | integer (int64) |  |
| `nonce` | integer (int64) |  |
| `expire_at` | integer (int64) |  |
| `block_height` | integer (int64) |  |
| `queued_at` | integer (int64) |  |
| `executed_at` | integer (int64) |  |
| `sequence_index` | integer (int64) |  |
| `parent_hash` | string |  |
| `api_key_index` | integer (uint8) |  |
| `transaction_time` | integer (int64) |  |
| `committed_at` | integer (int64) |  |
| `verified_at` | integer (int64) |  |

### `GET /api/v1/txFromL1TxHash`

txFromL1TxHash — Get L1 transaction by L1 transaction hash

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `hash` | string (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `hash` | string |  |
| `type` | integer (uint8) |  |
| `info` | string |  |
| `event_info` | string |  |
| `status` | integer (int64) |  |
| `transaction_index` | integer (int64) |  |
| `l1_address` | string |  |
| `account_index` | integer (int64) |  |
| `nonce` | integer (int64) |  |
| `expire_at` | integer (int64) |  |
| `block_height` | integer (int64) |  |
| `queued_at` | integer (int64) |  |
| `executed_at` | integer (int64) |  |
| `sequence_index` | integer (int64) |  |
| `parent_hash` | string |  |
| `api_key_index` | integer (uint8) |  |
| `transaction_time` | integer (int64) |  |
| `committed_at` | integer (int64) |  |
| `verified_at` | integer (int64) |  |

### `GET /api/v1/txs`

txs — Get transactions which are already packed into blocks

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `index` | integer (int64) (query) |  |  |
| `limit` | integer (int64) (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `txs` | object[] |  |
| `txs[].hash` | string |  |
| `txs[].type` | integer (uint8) |  |
| `txs[].info` | string |  |
| `txs[].event_info` | string |  |
| `txs[].status` | integer (int64) |  |
| `txs[].transaction_index` | integer (int64) |  |
| `txs[].l1_address` | string |  |
| `txs[].account_index` | integer (int64) |  |
| `txs[].nonce` | integer (int64) |  |
| `txs[].expire_at` | integer (int64) |  |
| `txs[].block_height` | integer (int64) |  |
| `txs[].queued_at` | integer (int64) |  |
| `txs[].executed_at` | integer (int64) |  |
| `txs[].sequence_index` | integer (int64) |  |
| `txs[].parent_hash` | string |  |
| `txs[].api_key_index` | integer (uint8) |  |
| `txs[].transaction_time` | integer (int64) |  |

### `GET /api/v1/withdraw/history`

withdraw_history — Get withdraw history. Secure withdrawals are only set to `claimable` when ready. You should only expect the `completed` status on fast withdrawals via Arbitrum.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `authorization` | string (header) | yes |  |
| `account_index` | integer (int64) (query) | yes |  |
| `cursor` | string (query) |  |  |
| `filter` | enum: `all`, `pending`, `claimable` (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `withdraws` | object[] |  |
| `withdraws[].id` | string |  |
| `withdraws[].amount` | string |  |
| `withdraws[].timestamp` | integer (int64) |  |
| `withdraws[].status` | enum: `failed`, `pending`, `claimable`, `refunded`, `completed` |  |
| `withdraws[].type` | enum: `secure`, `fast` |  |
| `withdraws[].l1_tx_hash` | string |  |
| `withdraws[].asset_id` | integer (int16) |  |
| `cursor` | string |  |

<a id="l-updown"></a>
## updown

### `GET /api/v1/upDownCandles`

upDownCandles — Get the OHLC candles (1s = the exact price observations, or 30s) of an up/down market series (symbol + duration, e.g. btc/5m) in a bounded time range (at most 24h), oldest first. Pass next_cursor as start_timestamp to page forward; live candles are on the up_down_candle/<symbol>/<duration>/<resolution> websocket channel.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `symbol` | string (query) | yes | market series: underlying (case-insensitive) ... |
| `duration` | string (query) | yes | ... and market duration, e.g. 30s or 5m |
| `resolution` | enum: `1s`, `30s` (query) |  | 1s candles are the observations themselves |
| `start_timestamp` | integer (int64) (query) | yes | inclusive bucket start, seconds |
| `end_timestamp` | integer (int64) (query) | yes | inclusive, seconds; at most 24h after start_timestamp |
| `limit` | integer (int64) (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `code` | integer (int32) |  |
| `message` | string |  |
| `candles` | object[] | ascending by timestamp |
| `candles[].symbol` | string |  |
| `candles[].duration` | string |  |
| `candles[].resolution` | string |  |
| `candles[].timestamp` | integer (int64) | bucket start, unix seconds |
| `candles[].open` | string | exact provider prices, decimal strings |
| `candles[].high` | string |  |
| `candles[].low` | string |  |
| `candles[].close` | string |  |
| `candles[].provider` | string | provider feed of the last observation of the candle |
| `candles[].feed_id` | string |  |
| `next_cursor` | integer (int64) | start_timestamp of the next page; 0 when the range is exhausted |

<a id="websocket-channels"></a>
## WebSocket channels

Connect `wss://mainnet.zklighter.elliot.ai/stream`; subscribe `{"type":"subscribe","channel":"order_book/1"}` (add `"auth":"<token>"` for private channels); replies arrive as `subscribed/<ch>` then `update/<ch>` with the channel written with colons (`order_book:1`). Keep-alive: any frame at least every 2 min (`{"type":"ping"}`). Send txs over WS with `{"type":"jsonapi/sendtx","data":{…}}`. Field shapes: see the Types section of [docs.lighter.xyz/api/websocket](https://docs.lighter.xyz/api/websocket).

| Channel | Subscribe with | Auth | What it streams |
| --- | --- | --- | --- |
| Order Book | `order_book/{MARKET_INDEX}` |  | The order book channel sends the new ask and bid orders for the given market in batches, every 50ms. While the nonce is tied to Lighter's matching engine, the offset is tied to the API servers; hence, you can expect the offset to change drastically on reconnection if you're routed to a different se… |
| Best Bid and Offer (BBO) | `ticker/{MARKET_INDEX}` |  | Updates are triggered on every nonce update for a given market's order book. |
| Market Stats | `market_stats/{MARKET_INDEX}` |  | `market_stats` and `spot_market_stats` exclude binary options. Use [Binary options market stats](#binary-options-market-stats) for those markets. |
| Binary Options Market Stats |  |  | Subscribe to `bo_market_stats/{MARKET_INDEX}` for one market or `bo_market_stats/all` for all binary options markets. The all-market response contains a `bo_market_stats` object keyed by market ID; a single-market response contains one stats object. The all-market stream also includes old, settled… |
| Trade | `trade/{MARKET_INDEX}` |  | The trade channel sends the new trade data for the given market. |
| Candlesticks | `candle/{MARKET_INDEX}/{resolution}` |  | Real-time candlestick (OHLCV) updates via WebSocket. Subscribe to any market and resolution to receive live candle data as trades occur. Supported resolutions: `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `12h`, `1d`. The candles\[] array allows up to 2 candles to be sent in a single update when a candle… |
| Up/Down Candlesticks |  |  | Subscribe to `up_down_candle/{SYMBOL}/{DURATION}/{RESOLUTION}` for the underlying price of an Up/Down series, for example `up_down_candle/eth/15m/1s`. Resolutions are `1s` and `30s`. The initial snapshot contains up to 300 candles. See [Binary options WebSocket](https://docs.lighter.xyz/developers/… |
| Mark Price Candlesticks | `mark_price_candle/{MARKET_INDEX}/{resolution}` |  | Real-time mark price candlestick (OHLC) updates via WebSocket. Subscribe to any market and resolution to receive live candle data as mark price samples arrive. Supported resolutions: `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `12h`, `1d`. The candles\[] array allows up to 2 candles to be sent in a singl… |
| Account All | `account_all/{ACCOUNT_ID}` |  | Binary options positions appear separately in `bo_positions` (also in `account_all_positions`); `account_market` uses the singular `bo_position`. See [Binary options positions](https://docs.lighter.xyz/developers/binary-options/positions-and-settlement). |
| Account Market | `account_market/{MARKET_ID}/{ACCOUNT_ID}` | token | The account market channel sends specific account market data for a market. If `{MARKET_ID}` is a perpetual market, `assets` will return `null`, if `{MARKET_ID}` is a spot market, `funding_history` will return `null`. |
| Account Stats | `user_stats/{ACCOUNT_ID}` |  | The account stats channel sends account stats data for the specific account. |
| Account Tx | `account_tx/{ACCOUNT_ID}` | token | This channel sends transactions related to a specific account. |
| Account All Orders | `account_all_orders/{ACCOUNT_ID}` | token | The account all orders channel sends data about all the orders of an account. |
| Height | `height` |  | Blockchain height updates |
| Pool data | `pool_data/{ACCOUNT_ID}` | token | Provides data about pool activities: trades, orders, positions, shares and funding histories. |
| Pool info | `pool_info/{ACCOUNT_ID}` | token | Provides information about pools. |
| Notification | `notification/{ACCOUNT_ID}` | token | Provides notifications received by an account. Notifications can be of three kinds: liquidation, deleverage, or announcement. Each kind has a different content structure. |
| Account Orders | `account_orders/{MARKET_INDEX}/{ACCOUNT_ID}` | token | The account orders channel sends data about the orders of an account on a certain market. |
| Account All Trades | `account_all_trades/{ACCOUNT_ID}` |  | The account all trades channel sends data about all the trades of an account. |
| Account All Positions | `account_all_positions/{ACCOUNT_ID}` |  | The account all positions channel sends data about all the positions of an account. |
| Spot Market Stats | `spot_market_stats/{MARKET_INDEX}` |  | The spot market stats channel sends the market stat data for the given spot market. |
| Account All Assets | `account_all_assets/{ACCOUNT_ID}` | token | The account all assets channel sends specific account market data for all spot markets for a specific account. `balance` is in coin terms, not USDC (unless asset\_index=3, in which case they coincide). |
| Average Entry Prices | `account_spot_avg_entry_prices/{ACCOUNT_ID}` | token | Updates on the `account_spot_avg_entry_prices` channel are triggered whenever an event occurs for a given spot asset. Each event is accounted for as a buy or sell executed at the index price. Events include trades, deposits, withdrawals, transfers, and staking. The `last_trade_id` field confirms th… |
| Request for Quote (RFQ) | `rfq` | token | This channel allows you to receive all currently open RFQs, followed by live updates as new ones arrive. RFQ responses are hidden if you're not the requester, so you will only see the market and its size. API endpoints to create, respond, update, get, and list RFQs are available [here](https://docs… |
| Live points (Lighter on Robinhood Chain only) | `live_points/{ACCOUNT_ID}` | token | This channel returns the total live points accrued to an account index. Updates are triggered as the total changes. You can confirm you have the latest value by fetching [livePoints/total](https://docs.lighter.xyz/api/points) via REST. |
