# Derive v3 — full API reference (mainnet)

Generated 2026-11-23 from Derive's own OpenAPI spec (Derive v3 API 0.2.0, 147 methods) by `scripts/gen-endpoint-docs.mjs`. **Mainnet only.**

- **REST:** `POST https://api.derive.xyz/v3/{method}` with flat JSON params. Errors: `{error:{code,message,data}}`.
- **WebSocket:** `wss://api.derive.xyz/v3/ws`, frame `{id, method, params}`; `subscribe` with `{channels:[…]}`.
- **Private auth:** headers `X-DeriveWallet`, `X-DeriveTimestamp` (ms), `X-DeriveSignature` (= personal_sign of the timestamp by the owner or a session key). WebSocket: `public/login`.
- **Greeks:** in every ticker (`public/get_ticker`, `public/get_tickers`, `ticker_slim.*` channel) under `option_pricing`, and per position in `private/get_positions` / `private/get_subaccount`. See [Greeks & data points](#greeks-and-data-points).

## Contents

- [Market Data](#market-data) (16)
- [Account](#account) (1)
- [Chat](#chat) (6)
- [History](#history) (8)
- [Liquidations](#liquidations) (4)
- [Maker Scoring](#maker-scoring) (2)
- [Market Maker Protection](#market-maker-protection) (3)
- [Onchain Actions](#onchain-actions) (6)
- [Orderbook](#orderbook) (18)
- [Other](#other) (3)
- [Referrals](#referrals) (2)
- [RFQ](#rfq) (28)
- [Session Keys](#session-keys) (5)
- [Subaccounts](#subaccounts) (10)
- [System](#system) (5)
- [Transfers & Withdrawals](#transfers-withdrawals) (10)
- [Vault Curators](#vault-curators) (9)
- [Vault Shareholders](#vault-shareholders) (11)
- [WebSocket channels](#websocket-channels)

<a id="greeks-and-data-points"></a>
## Greeks & data points — where each lives

| Data point | Method / channel | Field |
| --- | --- | --- |
| Delta, gamma, vega, theta, rho (option) | `public/get_ticker`, `public/get_tickers` (needs `expiry_date` for options), `ticker_slim.{instrument}.{ms}` | `option_pricing.d` `g` `v` `t` `r` |
| Mark IV, bid IV, ask IV | same | `option_pricing.i`, `bi`, `ai` |
| Option mark / forward / discount factor | same | `option_pricing.m`, `f`, `df` |
| Mark, index, best bid/ask + sizes | same | `M`, `I`, `b`/`B`, `a`/`A` |
| Funding rate (perp) | same; history `public/get_funding_rate_history` | `f` |
| Price band (order limits) | same | `minp`, `maxp` |
| 24h stats, open interest | same | `stats.{c,v,p,oi,h,l,n,pr}` |
| Position greeks | `private/get_positions`, `private/get_subaccount` | `delta`, `gamma`, `vega`, `theta`, `liquidation_price` |
| Margin (IM / MM headroom) | `private/get_subaccount`, `private/get_margin`, `public/get_margin` (simulation) | `initial_margin`, `maintenance_margin` |
| Collateral balances | `private/get_subaccount`, `private/get_collaterals` | `collaterals[]` |
| Candles | `public/get_tradingview_chart_data` | OHLC + volume |
| Index history | `public/get_index_chart_data` |  |
| Settlement prices | `public/get_option_settlement_prices`, `private/get_option_settlement_history` |  |
| Deposits / withdrawals | `private/get_deposit_history`, `private/get_withdrawal_history`, `public/get_pending_deposits`, `private/withdraw` |  |
| Subaccounts | `public/get_subaccounts`, `private/get_account`, `private/get_all_portfolios`, `private/transfer_spot` |  |

<a id="market-data"></a>
## Market Data

### `public/get_all_currencies`

Returns detailed metadata for every configured currency, including supported instrument types, risk managers, spot price and 24h-ago price, SRM/portfolio margin collateral discounts, lending borrow/supply APYs, open-interest caps and utilization per manager, and protocol asset addresses. Currencies that exist but have no configured assets are omitted. Public endpoint, no authentication required.

**Auth:** public · **Rate class:** `non_matching`

**Params**

_none_

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `[].currency` | string |  |
| `[].managers` | object[] | Managers risk-pricing this currency, one entry per universe where at least one manager covers it. |
| `[].managers[].pm` | integer | PMRM2 manager id risking this currency in the universe. |
| `[].managers[].risk_universe_id` | integer (uint32) |  |
| `[].managers[].risk_universe_name` | string | Display name of the universe (uppercase, e.g. "PRIME"); absent until set by the exchange. |
| `[].managers[].sm` | integer | SRM manager id risking this currency in the universe. |
| `[].market_type` | enum: `ALL`, `SRM_BASE_ONLY`, `SRM_OPTION_ONLY`, `SRM_PERP_ONLY`, `CASH` | Which instrument/collateral classes the currency is enabled for. |
| `[].option` | object | The option asset for this currency, if one is registered. |
| `[].option.address` | string | EIP-55 checksummed protocol asset address. |
| `[].option.name` | string | Registered asset name (e.g. "ETH-OPTION", "ETH-PERP"). |
| `[].option.universes` | object[] |  |
| `[].option.universes[].oi` | object |  |
| `[].option.universes[].risk_universe_id` | integer (uint32) |  |
| `[].option.universes[].risk_universe_name` | string | Display name of the universe (uppercase, e.g. "PRIME"); absent until set by the exchange. |
| `[].option.universes[].srm_perp_margin_requirements` | object | Absent on an option asset, and where no SRM in this universe prices the currency. |
| `[].perp` | object | The perp asset for this currency, if one is registered. |
| `[].perp.address` | string | EIP-55 checksummed protocol asset address. |
| `[].perp.name` | string | Registered asset name (e.g. "ETH-OPTION", "ETH-PERP"). |
| `[].perp.universes` | object[] |  |
| `[].perp.universes[].oi` | object |  |
| `[].perp.universes[].risk_universe_id` | integer (uint32) |  |
| `[].perp.universes[].risk_universe_name` | string | Display name of the universe (uppercase, e.g. "PRIME"); absent until set by the exchange. |
| `[].perp.universes[].srm_perp_margin_requirements` | object | Absent on an option asset, and where no SRM in this universe prices the currency. |
| `[].spot` | object[] | Every spot asset registered to this currency (e.g. lending "USDC" and non-lending "USDC-NL"). |
| `[].spot[].address` | string | EIP-55 checksummed protocol asset address. |
| `[].spot[].erc20` | object |  |
| `[].spot[].erc20.decimals` | integer (uint8) |  |
| `[].spot[].erc20.underlying_erc20` | string | On-chain ERC20 token deposited into the spot asset (informational). |
| `[].spot[].min_deposit_usd` | string |  |
| `[].spot[].name` | string | Registered asset name (e.g. "USDC", "USDC-NL"). |
| `[].spot[].universes` | object[] |  |
| `[].spot[].universes[].lending` | object | Lending stats; null if the asset has no pool in this universe. |
| `[].spot[].universes[].oi` | object | Spot supply OI cap + current supply (for a lending asset, the current supply is the pool's total supplied collateral). |
| `[].spot[].universes[].pm2_im_discount` | string | PMRM2 collateral haircut ("0" if not collateralized). |
| `[].spot[].universes[].pm2_mm_discount` | string |  |
| `[].spot[].universes[].risk_universe_id` | integer (uint32) |  |
| `[].spot[].universes[].srm_im_discount` | string | SRM collateral discount (cash asset "1"; non-collateral "0"). |
| `[].spot[].universes[].srm_mm_discount` | string |  |
| `[].spot_price` | string |  |
| `[].spot_price_24h` | string |  |

### `public/get_all_instruments`

Returns a paginated, name-descending list of full instrument definitions filtered by `instrument_type`, optional `currency` and optional `risk_universe_id`, with `page`/`page_size` (max 1000) controls and pagination metadata. For options, `expired` selects the listing: `false` returns live options, `true` returns only expired options. An option enters the expired listing up to a minute before it expires, so it does not drop out of both listings at expiry. Perps and spot ignore `expired`. An empty listing returns `instrument_not_found`; a page past the end returns the last page. An option's `settlement_price` here can lag settlement by a few minutes; `public/get_instrument` returns it at once. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string |  |  |
| `expired` | boolean | yes |  |
| `instrument_type` | enum: `option`, `perp`, `erc20` | yes | Asset type of the instrument: `"option"`, `"perp"`, or `"erc20"`. |
| `page` | integer |  |  |
| `page_size` | integer |  |  |
| `risk_universe_id` | integer |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `instruments` | object[] |  |
| `instruments[].amount_step` | string |  |
| `instruments[].base_asset_address` | string | The traded asset's contract address — word 0 (`asset`) of the order action `data`. Use this (not `erc20_details`) when signing an order. |
| `instruments[].base_asset_sub_id` | string | The traded asset's sub-id — word 1 (`subId`) of the order action `data`. Decimal string; `"0"` for perps and spot. |
| `instruments[].base_currency` | string |  |
| `instruments[].base_fee` | string |  |
| `instruments[].erc20_details` | object |  |
| `instruments[].erc20_details.borrow_index` | string |  |
| `instruments[].erc20_details.decimals` | integer (uint8) |  |
| `instruments[].erc20_details.supply_index` | string |  |
| `instruments[].erc20_details.underlying_erc20_address` | string |  |
| `instruments[].fifo_min_allocation` | string |  |
| `instruments[].instrument_name` | string |  |
| `instruments[].instrument_type` | enum: `option`, `perp`, `erc20` | Asset type of the instrument: `"option"`, `"perp"`, or `"erc20"`. |
| `instruments[].is_active` | boolean |  |
| `instruments[].maker_fee_rate` | string |  |
| `instruments[].mark_price_fee_rate_cap` | string |  |
| `instruments[].maximum_amount` | string |  |
| `instruments[].minimum_amount` | string |  |
| `instruments[].option_details` | object |  |
| `instruments[].option_details.expiry` | integer (uint64) |  |
| `instruments[].option_details.index` | string |  |
| `instruments[].option_details.option_type` | string |  |
| `instruments[].option_details.settlement_price` | string |  |
| `instruments[].option_details.strike` | string |  |
| `instruments[].perp_details` | object |  |
| `instruments[].perp_details.aggregate_funding` | string |  |
| `instruments[].perp_details.funding_rate` | string |  |
| `instruments[].perp_details.index` | string |  |
| `instruments[].perp_details.max_rate_per_hour` | string |  |
| `instruments[].perp_details.min_rate_per_hour` | string |  |
| `instruments[].perp_details.srm_perp_margin_requirements` | object | Null when no SRM in the instrument's risk universe prices its currency. |
| `instruments[].pro_rata_amount_step` | string |  |
| `instruments[].pro_rata_fraction` | string |  |
| `instruments[].quote_currency` | string |  |
| `instruments[].risk_universe_id` | integer (uint32) | Only subaccounts in this risk universe can trade the instrument. |
| `instruments[].scheduled_activation` | integer (int64) |  |
| `instruments[].scheduled_deactivation` | integer (int64) |  |
| `instruments[].taker_fee_rate` | string |  |
| `instruments[].tick_size` | string |  |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |

### `public/get_all_live_instruments`

Returns a sorted list of the names of every currently live instrument (active and within its scheduled activation window). Takes no parameters and returns names only, not full definitions. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

_none_

**Result**

_none_

### `public/get_currency`

Returns the full detail record for one currency named by the required `currency` parameter: supported instrument types, risk managers, current and 24h spot price, margin collateral discounts, lending APYs and totals, per-manager open-interest caps and current OI, and protocol asset addresses. Returns a not-found error for unknown currencies. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `currency` | string |  |
| `managers` | object[] | Managers risk-pricing this currency, one entry per universe where at least one manager covers it. |
| `managers[].pm` | integer | PMRM2 manager id risking this currency in the universe. |
| `managers[].risk_universe_id` | integer (uint32) |  |
| `managers[].risk_universe_name` | string | Display name of the universe (uppercase, e.g. "PRIME"); absent until set by the exchange. |
| `managers[].sm` | integer | SRM manager id risking this currency in the universe. |
| `market_type` | enum: `ALL`, `SRM_BASE_ONLY`, `SRM_OPTION_ONLY`, `SRM_PERP_ONLY`, `CASH` | Which instrument/collateral classes the currency is enabled for. |
| `option` | object | The option asset for this currency, if one is registered. |
| `option.address` | string | EIP-55 checksummed protocol asset address. |
| `option.name` | string | Registered asset name (e.g. "ETH-OPTION", "ETH-PERP"). |
| `option.universes` | object[] |  |
| `option.universes[].oi` | object |  |
| `option.universes[].risk_universe_id` | integer (uint32) |  |
| `option.universes[].risk_universe_name` | string | Display name of the universe (uppercase, e.g. "PRIME"); absent until set by the exchange. |
| `option.universes[].srm_perp_margin_requirements` | object | Absent on an option asset, and where no SRM in this universe prices the currency. |
| `perp` | object | The perp asset for this currency, if one is registered. |
| `perp.address` | string | EIP-55 checksummed protocol asset address. |
| `perp.name` | string | Registered asset name (e.g. "ETH-OPTION", "ETH-PERP"). |
| `perp.universes` | object[] |  |
| `perp.universes[].oi` | object |  |
| `perp.universes[].risk_universe_id` | integer (uint32) |  |
| `perp.universes[].risk_universe_name` | string | Display name of the universe (uppercase, e.g. "PRIME"); absent until set by the exchange. |
| `perp.universes[].srm_perp_margin_requirements` | object | Absent on an option asset, and where no SRM in this universe prices the currency. |
| `spot` | object[] | Every spot asset registered to this currency (e.g. lending "USDC" and non-lending "USDC-NL"). |
| `spot[].address` | string | EIP-55 checksummed protocol asset address. |
| `spot[].erc20` | object |  |
| `spot[].erc20.decimals` | integer (uint8) |  |
| `spot[].erc20.underlying_erc20` | string | On-chain ERC20 token deposited into the spot asset (informational). |
| `spot[].min_deposit_usd` | string |  |
| `spot[].name` | string | Registered asset name (e.g. "USDC", "USDC-NL"). |
| `spot[].universes` | object[] |  |
| `spot[].universes[].lending` | object | Lending stats; null if the asset has no pool in this universe. |
| `spot[].universes[].oi` | object | Spot supply OI cap + current supply (for a lending asset, the current supply is the pool's total supplied collateral). |
| `spot[].universes[].pm2_im_discount` | string | PMRM2 collateral haircut ("0" if not collateralized). |
| `spot[].universes[].pm2_mm_discount` | string |  |
| `spot[].universes[].risk_universe_id` | integer (uint32) |  |
| `spot[].universes[].srm_im_discount` | string | SRM collateral discount (cash asset "1"; non-collateral "0"). |
| `spot[].universes[].srm_mm_discount` | string |  |
| `spot_price` | string |  |
| `spot_price_24h` | string |  |

### `public/get_funding_rate_history`

Returns funding-rate OHLC candles for a perpetual instrument (`instrument_name`) over an optional `start_timestamp`/`end_timestamp` window (UTC milliseconds) at a `period` granularity (defaults to 1h; 60s up to 1w supported). Each candle carries open/high/low/close per-hour rates plus a `funding_rate` mirroring the close. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `end_timestamp` | integer |  |  |
| `instrument_name` | string | yes |  |
| `period` | integer |  |  |
| `start_timestamp` | integer |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `funding_rate_history` | object[] |  |
| `funding_rate_history[].close` | string |  |
| `funding_rate_history[].currency` | string |  |
| `funding_rate_history[].funding_rate` | string |  |
| `funding_rate_history[].high` | string |  |
| `funding_rate_history[].low` | string |  |
| `funding_rate_history[].open` | string |  |
| `funding_rate_history[].risk_universe_id` | integer (uint32) |  |
| `funding_rate_history[].timestamp` | integer (int64) |  |

### `public/get_index_chart_data`

Returns spot index OHLC candles for a `currency` between required `start_timestamp` and `end_timestamp` (UTC seconds) at the given `period` granularity (1m up to 1w). Each candle includes open/high/low/close and a `price` mirroring the close. The requested range is clamped to a maximum number of buckets. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string | yes |  |
| `end_timestamp` | integer (uint64) | yes |  |
| `period` | integer (uint64) | yes |  |
| `start_timestamp` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `[].close_price` | string |  |
| `[].high_price` | string |  |
| `[].low_price` | string |  |
| `[].open_price` | string |  |
| `[].price` | string |  |
| `[].timestamp` | integer (int64) |  |
| `[].timestamp_bucket` | integer (int64) |  |

### `public/get_instrument`

Returns the full public definition of one instrument named by `instrument_name`: type, activation window and active status, tick size, min/max/step amounts, maker/taker/base fee rates, pro-rata matching parameters, base/quote currencies, and type-specific details (option, perp, or spot). Expired options remain queryable by `instrument_name`. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `instrument_name` | string | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `amount_step` | string |  |
| `base_asset_address` | string | The traded asset's contract address — word 0 (`asset`) of the order action `data`. Use this (not `erc20_details`) when signing an order. |
| `base_asset_sub_id` | string | The traded asset's sub-id — word 1 (`subId`) of the order action `data`. Decimal string; `"0"` for perps and spot. |
| `base_currency` | string |  |
| `base_fee` | string |  |
| `erc20_details` | object |  |
| `erc20_details.borrow_index` | string |  |
| `erc20_details.decimals` | integer (uint8) |  |
| `erc20_details.supply_index` | string |  |
| `erc20_details.underlying_erc20_address` | string |  |
| `fifo_min_allocation` | string |  |
| `instrument_name` | string |  |
| `instrument_type` | enum: `option`, `perp`, `erc20` | Asset type of the instrument: `"option"`, `"perp"`, or `"erc20"`. |
| `is_active` | boolean |  |
| `maker_fee_rate` | string |  |
| `mark_price_fee_rate_cap` | string |  |
| `maximum_amount` | string |  |
| `minimum_amount` | string |  |
| `option_details` | object |  |
| `option_details.expiry` | integer (uint64) |  |
| `option_details.index` | string |  |
| `option_details.option_type` | string |  |
| `option_details.settlement_price` | string |  |
| `option_details.strike` | string |  |
| `perp_details` | object |  |
| `perp_details.aggregate_funding` | string |  |
| `perp_details.funding_rate` | string |  |
| `perp_details.index` | string |  |
| `perp_details.max_rate_per_hour` | string |  |
| `perp_details.min_rate_per_hour` | string |  |
| `perp_details.srm_perp_margin_requirements` | object | Null when no SRM in the instrument's risk universe prices its currency. |
| `perp_details.srm_perp_margin_requirements.im_perp_req` | string | Initial margin rate, as a fraction of perp notional. |
| `perp_details.srm_perp_margin_requirements.max_leverage` | string | `1 / im_perp_req`, rounded to 2 decimals. A zero `im_perp_req` scales the perp market out. It reports `"0"` here, not unbounded leverage. |
| `perp_details.srm_perp_margin_requirements.mm_perp_req` | string | Maintenance margin rate, as a fraction of perp notional. |
| `pro_rata_amount_step` | string |  |
| `pro_rata_fraction` | string |  |
| `quote_currency` | string |  |
| `risk_universe_id` | integer (uint32) | Only subaccounts in this risk universe can trade the instrument. |
| `scheduled_activation` | integer (int64) |  |
| `scheduled_deactivation` | integer (int64) |  |
| `taker_fee_rate` | string |  |
| `tick_size` | string |  |

### `public/get_interest_rate_history`

Returns lending borrow/supply APY OHLC candles for a `currency`'s pool over an optional time window (UTC milliseconds) at a `period` of 1h or larger (defaults to 1h; sub-hour periods are rejected). An optional `risk_universe_id` restricts to one pool; otherwise every universe's candles are returned, each tagged and carrying pool total supply/borrow. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string | yes |  |
| `end_timestamp` | integer |  |  |
| `period` | integer |  |  |
| `risk_universe_id` | integer |  | Restrict to one risk universe's pool. Omit to return every universe's candles for the currency (each candle is tagged with its universe). |
| `start_timestamp` | integer |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `interest_rate_history` | object[] |  |
| `interest_rate_history[].borrow_apy` | object | Open, high, low, and close for one series, each a decimal string. |
| `interest_rate_history[].borrow_apy.close` | string |  |
| `interest_rate_history[].borrow_apy.high` | string |  |
| `interest_rate_history[].borrow_apy.low` | string |  |
| `interest_rate_history[].borrow_apy.open` | string |  |
| `interest_rate_history[].risk_universe_id` | integer (uint32) |  |
| `interest_rate_history[].supply_apy` | object | Open, high, low, and close for one series, each a decimal string. |
| `interest_rate_history[].supply_apy.close` | string |  |
| `interest_rate_history[].supply_apy.high` | string |  |
| `interest_rate_history[].supply_apy.low` | string |  |
| `interest_rate_history[].supply_apy.open` | string |  |
| `interest_rate_history[].timestamp` | integer (int64) |  |
| `interest_rate_history[].total_borrow` | string |  |
| `interest_rate_history[].total_supply` | string |  |

### `public/get_latest_signed_feeds`

Returns the most recent oracle-signed feed data — spot, forward, volatility (SVI), rate, perp, and perpetual funding-rate feeds — each with signer addresses and signatures for on-chain submission. Optional `currency` and `expiry` filters narrow the result (use `expiry` 0 for the non-expiry feeds: spot, perp and funding); both default to all. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string |  | Currency filter, (defaults to all currencies) |
| `expiry` | integer |  | Expiry filter for options and forward data (defaults to all expiries). Use `0` to get data only for spot and perpetuals. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `funding_data` | object | currency -> latest funding-rate feed data |
| `fwd_data` | object | currency -> expiry -> latest forward feed data |
| `perp_data` | object | currency -> feed type -> latest perp feed data |
| `rate_data` | object | currency -> expiry -> latest rate feed data |
| `spot_data` | object | currency -> latest spot feed data |
| `vol_data` | object | currency -> expiry -> latest vol feed data |

### `public/get_option_settlement_prices`

Returns the settlement price for each settled option expiry of a `currency`, with the expiry date (YYYYMMDD), unix expiry timestamp, and price. Only already-settled expiries are returned. Unknown currencies return a not-found error. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `expiries` | object[] |  |
| `expiries[].expiry_date` | string | Expiry date in `YYYYMMDD` format. |
| `expiries[].price` | string | Settlement price. Only settled expiries are returned, so never null. |
| `expiries[].utc_expiry_sec` | integer (uint64) | UTC timestamp of expiry, unix seconds. |

### `public/get_perp_impact_twap`

Returns TWAPs of the perp mid, ask impact and bid impact prices minus spot for a `currency` between `start_time` and `end_time` (unix seconds).

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string | yes |  |
| `end_time` | integer (int64) | yes |  |
| `start_time` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `ask_impact_diff_twap` | string |  |
| `bid_impact_diff_twap` | string |  |
| `currency` | string |  |
| `mid_price_diff_twap` | string |  |

### `public/get_risk_universes`

Returns every risk universe (the isolated risk-containment boundaries trades never cross), each with its display name and description, its managers — at most one Standard (`SM`) and one Portfolio (`PM2`), each listing the derivative instruments it risk-prices and the collateral assets it accepts with their margin discounts and deposit metadata — and its Security Module. The one call that answers which universe and manager to choose: pick a universe, pick a manager in it, and pass its `manager_id` when depositing to a new subaccount (the accepted collateral entries carry the `asset` address for the deposit). The no-margin fallback universe (id 0) is included; it custodies dead-lettered deposits and lists no tradeable instruments. Public endpoint, no authentication required.

**Auth:** public · **Rate class:** `non_matching`

**Params**

_none_

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `[].description` | string | Short description of the universe; null until set by the exchange. |
| `[].managers` | object[] | The universe's managers (at most one Standard and one Portfolio), each with the instruments it risk-prices and the collaterals it accepts. |
| `[].managers[].collaterals` | object[] | Assets this manager accepts as deposit collateral. |
| `[].managers[].collaterals[].address` | string | EIP-55 checksummed protocol asset address — the `asset` argument when depositing. |
| `[].managers[].collaterals[].erc20` | object |  |
| `[].managers[].collaterals[].im_discount` | string | Initial-margin credit for the asset under this manager. |
| `[].managers[].collaterals[].min_deposit_usd` | string |  |
| `[].managers[].collaterals[].mm_discount` | string | Maintenance-margin credit for the asset under this manager. |
| `[].managers[].collaterals[].name` | string | Registered asset name (e.g. "USDC"). |
| `[].managers[].instruments` | string[] | Live derivative asset names tradeable under this manager, sorted (e.g. "BTC-OPTION", "BTC-PERP"). An option entry names the family — fetch its individual listings via `public/get_all_instruments`. |
| `[].managers[].manager_id` | integer (uint32) | Pass this as `manager_id` when depositing to a new subaccount. |
| `[].managers[].margin_type` | enum: `SM`, `PM2` | Margin model applied by a manager: `SM` (standard, cross-collateral) or `PM2` (portfolio, scenario-based netting). |
| `[].name` | string | Display name (e.g. "PRIME"), always uppercase; null until set by the exchange. |
| `[].risk_universe_id` | integer (uint32) |  |
| `[].security_module` | object | The universe's Security Module: the subaccount whose funds absorb insolvent losses before any socialization within the universe. |
| `[].security_module.cash_asset` | string | EIP-55 checksummed address of the universe's cash asset. |
| `[].security_module.cash_currency` | string | Currency of the cash asset (e.g. "USDC"). |
| `[].security_module.subaccount_id` | integer (uint64) |  |

### `public/get_ticker`

Returns the latest ticker snapshot for a single instrument named by `instrument_name`. The payload matches the data of a `ticker_slim.{instrument}.{interval}` subscription update (mark/index prices, best bid/ask, sizes, greeks, and related fields). Returns an error if no ticker is available. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `instrument_name` | string | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `A` | string | Amount of contracts / tokens available at the best ask price. |
| `B` | string | Amount of contracts / tokens available at the best bid price. |
| `I` | string | Index price. |
| `M` | string | Mark price. |
| `a` | string | Best ask price. |
| `b` | string | Best bid price. |
| `f` | string | Current hourly funding rate (perpetuals only; `null` otherwise). |
| `maxp` | string | Maximum price at which an aggressive buyer can be matched. Any portion of a market order that would execute above this price is cancelled. A limit buy order with limit price above this value is treated as post only (i.e. it is rejected if it would cross any e… |
| `minp` | string | Minimum price at which an aggressive seller can be matched. Any portion of a market order that would execute below this price is cancelled. A limit sell order with limit price below this value is treated as post only (i.e. it is rejected if it would cross any… |
| `option_pricing` | object | Option greeks and implied vols (options only; `null` otherwise). |
| `option_pricing.ai` | string | Implied volatility of the current best ask. |
| `option_pricing.bi` | string | Implied volatility of the current best bid. |
| `option_pricing.d` | string | Delta of the option. |
| `option_pricing.df` | string | Discount factor used to calculate the option premium. |
| `option_pricing.f` | string | Forward price used to calculate the option premium. |
| `option_pricing.g` | string | Gamma of the option. |
| `option_pricing.i` | string | Implied volatility of the option. |
| `option_pricing.m` | string | Mark price of the option. |
| `option_pricing.r` | string | Rho of the option. |
| `option_pricing.t` | string | Theta of the option. |
| `option_pricing.v` | string | Vega of the option. |
| `stats` | object | Trailing 24-hour trading statistics. |
| `stats.c` | string (decimal) | Number of contracts traded during last 24 hours |
| `stats.h` | string (decimal) | Highest trade price during last 24h |
| `stats.l` | string (decimal) | Lowest trade price during last 24h |
| `stats.n` | integer (uint64) | Number of trades during last 24h |
| `stats.oi` | string (decimal) | Current total open interest |
| `stats.p` | string (decimal) | Options: 24hr percent change in premium; Perps: 24hr percent change in mark price |
| `stats.pr` | string (decimal) | Premium volume traded during last 24 hours |
| `stats.v` | string (decimal) | Notional volume traded during last 24 hours |
| `t` | integer (int64) | Snapshot creation timestamp, in milliseconds since the Unix epoch. |

### `public/get_tickers`

Returns a map of instrument name to latest ticker snapshot for an `instrument_type`. Options require both `currency` and an 8-digit `expiry_date` (YYYYMMDD); perps and spot accept an optional `currency` (omit to fetch all currencies) and reject `expiry_date`. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string |  |  |
| `expiry_date` | integer |  |  |
| `instrument_type` | enum: `option`, `perp`, `erc20` | yes | Asset type of the instrument: `"option"`, `"perp"`, or `"erc20"`. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `tickers` | object |  |

### `public/get_trade_history`

Returns paginated, anonymized trades with optional filters: `trade_id` (a UUID, which overrides all other filters), `instrument_name`, `instrument_type` (erc20/option/perp), `currency`, `subaccount_id`, `batch_status` (a batch-status name; unset returns trades in every batch state), and `from_timestamp`/`to_timestamp`. Without `trade_id`, `subaccount_id` or `instrument_name`, or whenever `batch_status` is set, the window is limited to the 30 days ending at `to_timestamp` (or now). Each trade is enriched with its settlement status and transaction hash. A block trade does not show who traded it: `wallet` is the zero address, and `subaccount_id`, `realized_pnl` and `realized_pnl_excl_fees` are 0. The `subaccount_id` filter does not return block trades. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` |  |  |
| `currency` | string |  |  |
| `from_timestamp` | integer |  |  |
| `instrument_name` | string |  |  |
| `instrument_type` | enum: `option`, `perp`, `erc20` |  |  |
| `page` | integer |  |  |
| `page_size` | integer |  |  |
| `subaccount_id` | integer |  |  |
| `to_timestamp` | integer |  |  |
| `trade_id` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `trades` | object[] |  |
| `trades[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` |  |
| `trades[].block_trade_id` | string | Optional UUID v4 string |
| `trades[].direction` | enum: `buy`, `sell` |  |
| `trades[].expected_rebate` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].index_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].instrument_name` | string |  |
| `trades[].liquidity_role` | enum: `maker`, `taker` |  |
| `trades[].mark_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].quote_id` | string | Optional UUID v4 string |
| `trades[].realized_pnl` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].realized_pnl_excl_fees` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].rfq_id` | string | Optional UUID v4 string |
| `trades[].subaccount_id` | integer (int64) |  |
| `trades[].timestamp` | integer (int64) |  |
| `trades[].trade_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].trade_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].trade_id` | string |  |
| `trades[].trade_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].tx_hash` | string |  |
| `trades[].wallet` | string |  |

### `public/get_tradingview_chart_data`

Returns traded-price OHLCV candles for an `instrument_name` between required `start_timestamp` and `end_timestamp` (UTC seconds) at the given `period` (1m up to 1w), aggregated from executed trade history. Each candle includes open/high/low/close prices plus USD and contract volume, formatted for charting. Public endpoint.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `end_timestamp` | integer (uint64) | yes |  |
| `instrument_name` | string | yes |  |
| `period` | integer (uint64) | yes |  |
| `start_timestamp` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `[].close_price` | string |  |
| `[].high_price` | string |  |
| `[].low_price` | string |  |
| `[].open_price` | string |  |
| `[].timestamp` | integer (int64) |  |
| `[].timestamp_bucket` | integer (int64) |  |
| `[].volume_contracts` | string |  |
| `[].volume_usd` | string |  |

<a id="account"></a>
## Account

### `private/get_account`

Returns account-level information for a given wallet address: the list of its subaccount IDs, WebSocket rate limits (matching, non-matching, perp, and option messages per second) and any per-endpoint overrides, cancel-on-disconnect and RFQ-maker flags, the account creation timestamp, and a fee_info block with fee discounts and per-instrument maker/taker fee overrides expressed as decimals. Returns an account-not-found error if the wallet has never been registered.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `cancel_on_disconnect` | boolean |  |
| `creation_timestamp_sec` | integer |  |
| `fallback_subaccount_id` | integer (uint64) | Subaccount that receives deposits whose requested destination is unusable — unknown manager id, or the per-wallet subaccount cap already reached. Allocated with the account, and always in the fallback risk universe (id 0). |
| `fee_info` | object |  |
| `fee_info.base_fee_discount` | string |  |
| `fee_info.option_maker_fee` | string |  |
| `fee_info.option_taker_fee` | string |  |
| `fee_info.perp_maker_fee` | string |  |
| `fee_info.perp_taker_fee` | string |  |
| `fee_info.rfq_maker_discount` | string |  |
| `fee_info.rfq_taker_discount` | string |  |
| `fee_info.spot_maker_fee` | string |  |
| `fee_info.spot_taker_fee` | string |  |
| `is_rfq_maker` | boolean |  |
| `per_endpoint_tps` | object |  |
| `referral_code` | string |  |
| `subaccount_ids` | integer (uint64)[] |  |
| `wallet` | string |  |
| `websocket_matching_tps` | integer (uint16) |  |
| `websocket_non_matching_tps` | integer (uint16) |  |
| `websocket_option_tps` | integer (uint16) |  |
| `websocket_perp_tps` | integer (uint16) |  |
| `whitelisted_recipients` | string[] | Recipients that session keys may withdraw or transfer ERC-20s to. The owner and `Admin`-scoped session keys bypass this list. |

<a id="chat"></a>
## Chat

### `private/get_chat_rooms`

Returns the caller's chat access, concierge DND preference and username. tier is the best fee tier the wallet holds across options, perps and spot, where 0 is the best and null means no fee tier; RFQ discount tiers do not count. banned reports a chat ban. rooms lists the rooms the wallet may join: general is open to every wallet that is not banned, and fee_tier also needs a fee tier. Rooms are unavailable while the account is disabled, so rooms is then empty. concierge_unlocked reports whether the wallet may message the concierge: it needs a message from the concierge first, and a fee tier does not count. concierge_dnd reports whether the user prefers not to receive direct messages from the team. A ban or a disabled account does not close the concierge. username is the name rooms show in place of the wallet's address, such as greenpanda123. It is assigned the first time the wallet calls…

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | The session's wallet. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `banned` | boolean | A banned wallet joins no room. The ban does not close the concierge. |
| `concierge_dnd` | boolean | The user prefers not to receive direct messages from the team. |
| `concierge_unlocked` | boolean | The wallet may message the concierge: the concierge has messaged it. A fee tier does not count. |
| `rooms` | enum: `general`, `fee_tier`[] | Rooms the wallet may join. |
| `tier` | integer | Best fee tier the wallet holds, 0 being the best. `null` while untiered. |
| `username` | string | The wallet's name in every room. Assigned on first use; never changes. |

### `private/get_concierge_messages`

Returns the caller's conversation with the concierge, newest first, without messages removed by moderators. sender tells the caller's messages (user) from the concierge's (concierge). from_timestamp and to_timestamp (ms, both inclusive) bound the creation time, and page_size (default 100, at most 1000) caps the page. Without from_timestamp, the window is the 30 days before to_timestamp, or before now. To page back, pass the oldest creation_timestamp received as to_timestamp and de-duplicate by message_id. To look back more than 30 days from to_timestamp, also pass from_timestamp. Messages are deleted 90 days after they are sent. seen_until is the caller's mark from private/mark_concierge_seen, or null if the caller has set none. A concierge message created after seen_until is unread. Every wallet can read its conversation, including wallets without a fee tier and banned wallets.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `from_timestamp` | integer |  | Oldest creation timestamp to include, in ms. Defaults to 30 days before the earlier of `to_timestamp` and now. Messages are deleted 90 days after they are sent. |
| `page_size` | integer (uint) |  | Messages to return, newest first: 1 to 1000. |
| `to_timestamp` | integer (int64) |  | Newest creation timestamp to include, in ms. |
| `wallet` | string | yes | The session's wallet. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `messages` | object[] | Newest first. |
| `messages[].creation_timestamp` | integer (int64) |  |
| `messages[].message_id` | string (uuid) | UUID v4 string |
| `messages[].sender` | enum: `user`, `concierge` | The side of a concierge conversation that sent a message. |
| `messages[].text` | string |  |
| `messages[].wallet` | string | The user's wallet, whichever side sent the message. |
| `seen_until` | integer | The caller has seen every message created at or before this time, in ms. `null` if the caller marked none seen. |

### `private/get_room_messages`

Returns a chat room's history, newest first, without messages removed by moderators. Each message shows its sender's username, never a wallet address. The caller must be allowed to join the room (see private/get_chat_rooms): a banned wallet gets chat_banned (15000), a wallet whose account is disabled gets account_disabled (16001), and a wallet without a fee tier gets chat_room_not_allowed (15001) for fee_tier. from_timestamp and to_timestamp (ms, both inclusive) bound the creation time, and page_size (default 100, at most 1000) caps the page. Without from_timestamp, the window is the 30 days before to_timestamp, or before now. To page back, pass the oldest creation_timestamp received as to_timestamp and de-duplicate by message_id. To look back more than 30 days from to_timestamp, also pass from_timestamp. Messages are deleted 90 days after they are sent.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `from_timestamp` | integer |  | Oldest creation timestamp to include, in ms. Defaults to 30 days before the earlier of `to_timestamp` and now. Messages are deleted 90 days after they are sent. |
| `page_size` | integer (uint) |  | Messages to return, newest first: 1 to 1000. |
| `room` | enum: `general`, `fee_tier` | yes | Every wallet not banned from chat may join `general`; `fee_tier` also needs a fee tier. |
| `to_timestamp` | integer (int64) |  | Newest creation timestamp to include, in ms. |
| `wallet` | string | yes | The session's wallet. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `messages` | object[] | Newest first. |
| `messages[].creation_timestamp` | integer (int64) |  |
| `messages[].message_id` | string (uuid) | UUID v4 string |
| `messages[].room` | enum: `general`, `fee_tier` | Every wallet not banned from chat may join `general`; `fee_tier` also needs a fee tier. |
| `messages[].text` | string |  |
| `messages[].username` | string |  |

### `private/mark_concierge_seen`

Marks the caller's conversation with the concierge as seen up to seen_until, a creation timestamp in ms. While the conversation is on screen, call it with the creation_timestamp of the newest message shown, and call it again, debounced, as newer messages arrive. Messages created at or before the mark count as seen, and the concierge can see how far the caller has read. The mark never moves back: a seen_until at or before the current mark changes nothing. The mark is set to the creation_timestamp of the newest message created at or before both seen_until and now, leaving out messages removed by moderators, and the response returns that value. If there is no such message, nothing is marked and the response's seen_until is null. Reading the conversation with private/get_concierge_messages marks nothing. Requires the account-info scope.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `seen_until` | integer (int64) | yes | The creation_timestamp of the newest message on screen, in ms. |
| `wallet` | string | yes | The session's wallet. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `seen_until` | integer | The creation_timestamp of the newest message created at or before both the requested seen_until and now. `null` when there is no such message. |

### `private/send_concierge_message`

Sends a plain-text message, not blank and at most 500 characters, to the concierge and returns it. Each wallet has one private conversation with the concierge: the caller's messages and the concierge's replies arrive live on the {wallet}.concierge channel. The text must not contain control characters other than newlines, or bidi override characters (U+202A to U+202E and U+2066 to U+2069). The concierge is open only to wallets the concierge has messaged, with or without a fee tier; other wallets get concierge_locked (15002). A ban from chat rooms or a disabled account does not close the concierge. Requires the account-info scope.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `text` | string | yes | Plain text: at most 500 characters, not blank, without control characters other than newlines or bidi override characters. |
| `wallet` | string | yes | The session's wallet. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `creation_timestamp` | integer (int64) |  |
| `message_id` | string (uuid) | UUID v4 string |
| `sender` | enum: `user`, `concierge` | The side of a concierge conversation that sent a message. |
| `text` | string |  |
| `wallet` | string | The user's wallet, whichever side sent the message. |

### `private/send_room_message`

Posts a plain-text message, not blank and at most 500 characters, to a chat room and returns it; chat.{room} subscribers receive it live. The message shows the caller's username (see private/get_chat_rooms), never its wallet address. The text must not contain control characters other than newlines, or bidi override characters (U+202A to U+202E and U+2066 to U+2069). The caller must be allowed to join the room: general is open to every wallet that is not banned, and fee_tier also needs a fee tier. A banned wallet gets chat_banned (15000); a wallet whose account is disabled gets account_disabled (16001); a wallet without a fee tier gets chat_room_not_allowed (15001) for fee_tier. Profanity and slurs in the text are masked with asterisks (for example s***) before the message is stored, so the returned message, the chat.{room} event and the room history all carry the masked text. Numbers, a…

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `room` | enum: `general`, `fee_tier` | yes | Every wallet not banned from chat may join `general`; `fee_tier` also needs a fee tier. |
| `text` | string | yes | Plain text: at most 500 characters, not blank, without control characters other than newlines or bidi override characters. |
| `wallet` | string | yes | The session's wallet. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `creation_timestamp` | integer (int64) |  |
| `message_id` | string (uuid) | UUID v4 string |
| `room` | enum: `general`, `fee_tier` | Every wallet not banned from chat may join `general`; `fee_tier` also needs a fee tier. |
| `text` | string |  |
| `username` | string |  |

<a id="history"></a>
## History

### `private/get_deposit_history`

Returns settled deposits for a single subaccount or an entire wallet (specify exactly one), optionally bounded by a start/end timestamp window. Each entry reports the deposited amount as a decimal, the fee routed to the security module (the net credited amount is amount minus fee), and the resolved settlement batch and status. A deposit that could not reach its target is credited to the wallet's fallback subaccount instead: it reports `is_fallback: true` and the rejection that caused it in `fallback_error_code`, `fallback_error_message` and `fallback_error_data`.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `end_timestamp` | integer |  | End of the window, unix milliseconds (default: unbounded / now). |
| `start_timestamp` | integer |  | Start of the window, unix milliseconds (default 0). |
| `subaccount_id` | integer |  |  |
| `wallet` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `deposits` | object[] |  |
| `deposits[].action_id` | integer |  |
| `deposits[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `deposits[].asset` | string |  |
| `deposits[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Batch lifecycle status — the single source of lifecycle truth for every operation in the batch (individual ops carry no status of their own). Each stage has a healthy variant and a corresponding `...Error` variant meaning that stage failed. Serialized as the… |
| `deposits[].batch_uuid` | string |  |
| `deposits[].bridge_origin` | object | Absent for a plain L1 deposit, a bridge sent outside Derive's own quotes, or a sweep that credited several bridges at once. |
| `deposits[].bridge_origin.rail` | string | Bridge protocol: `lifi`, `layerzero` or `ccip`. |
| `deposits[].bridge_origin.source_address` | string | Their wallet on that chain, lower-cased; absent when the rail gave none. |
| `deposits[].bridge_origin.source_chain_id` | integer (uint64) | Chain the user sent from. |
| `deposits[].bridge_origin.source_tx_hash` | string | Their transaction on that chain. |
| `deposits[].fallback_error_code` | integer | Error code for the deposit's failure to reach its target subaccount. |
| `deposits[].fallback_error_data` | string | Null for an internal error, whose text stays internal. |
| `deposits[].fallback_error_message` | string | Null for an internal error, whose text stays internal. |
| `deposits[].fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `deposits[].is_fallback` | boolean | The deposit could not reach its target, so it was credited to the wallet's fallback subaccount instead. |
| `deposits[].l1_sender` | string | Who sent those funds on L1: the depositor's wallet, an exchange, or a bridge's relayer. Absent exactly when `l1_tx_hash` is. |
| `deposits[].l1_tx_hash` | string | The L1 transaction that moved the funds into the escrow. Absent when no tracked L1 row backs the deposit, or when one action credited several transfers at once. |
| `deposits[].new_subaccount` | boolean |  |
| `deposits[].operation_id` | string |  |
| `deposits[].subaccount_id` | integer (uint64) |  |
| `deposits[].timestamp` | integer (uint64) | Unix milliseconds. |
| `deposits[].tx_hash` | string | The settlement batch's commit, `null` until the batch settles. Not the deposit's own L1 transaction: that is `l1_tx_hash`. |
| `deposits[].wallet` | string |  |

### `private/get_erc20_transfer_history`

Returns settled spot (ERC-20) transfers involving a single subaccount or an entire wallet (specify exactly one), optionally bounded by a start/end timestamp window. Each entry reports the transfer amount and fee as decimals along with direction — the sender sees the gross amount plus fee, the receiver sees the net credit — plus the resolved settlement batch and status.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `end_timestamp` | integer |  | End of the window, unix milliseconds (default: unbounded / now). |
| `start_timestamp` | integer |  | Start of the window, unix milliseconds (default 0). |
| `subaccount_id` | integer |  |  |
| `wallet` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `transfers` | object[] |  |
| `transfers[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `transfers[].asset` | string |  |
| `transfers[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Batch lifecycle status — the single source of lifecycle truth for every operation in the batch (individual ops carry no status of their own). Each stage has a healthy variant and a corresponding `...Error` variant meaning that stage failed. Serialized as the… |
| `transfers[].batch_uuid` | string |  |
| `transfers[].fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `transfers[].from_subaccount_id` | integer (uint64) |  |
| `transfers[].from_wallet` | string |  |
| `transfers[].is_outgoing` | boolean |  |
| `transfers[].operation_id` | string |  |
| `transfers[].timestamp` | integer (uint64) | Unix milliseconds. |
| `transfers[].to_subaccount_id` | integer (uint64) |  |
| `transfers[].to_wallet` | string |  |
| `transfers[].tx_hash` | string |  |

### `private/get_funding_history`

Returns a paginated history of perpetual funding (settlement) events for a single subaccount or an entire wallet (specify exactly one), optionally bounded by a start/end timestamp window and filtered by perpetual instrument name. The response includes the funding events with their instrument name and settled amounts, plus pagination info with total count and page count.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `end_timestamp` | integer |  |  |
| `instrument_name` | string |  |  |
| `page` | integer |  |  |
| `page_size` | integer |  |  |
| `start_timestamp` | integer |  |  |
| `subaccount_id` | integer |  |  |
| `wallet` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `events` | object[] |  |
| `events[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Batch lifecycle status — the single source of lifecycle truth for every operation in the batch (individual ops carry no status of their own). Each stage has a healthy variant and a corresponding `...Error` variant meaning that stage failed. Serialized as the… |
| `events[].batch_uuid` | string | UUID of the settlement batch; a settlement in a reverted or errored batch reflects that status. |
| `events[].funding` | string |  |
| `events[].instrument_name` | string |  |
| `events[].pnl` | string |  |
| `events[].subaccount_id` | integer (uint64) |  |
| `events[].timestamp` | integer (int64) |  |
| `events[].tx_hash` | string |  |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |

### `private/get_interest_history`

Returns realized interest settlements per subaccount, for a single subaccount or an entire wallet (specify exactly one), optionally bounded by a start/end timestamp window. Each entry gives the asset the interest settled on and the settled interest as a decimal, where a negative value was paid (borrowed) and a positive value was received (supplied).

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `end_timestamp` | integer |  | End of the window, unix milliseconds (default: now / unbounded). |
| `start_timestamp` | integer |  | Start of the window, unix milliseconds (default 0). |
| `subaccount_id` | integer |  |  |
| `wallet` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `events` | object[] |  |
| `events[].asset` | string | Name of the asset the interest settled on (e.g. `"USDC"`); null if the asset is not in the asset config table. |
| `events[].interest` | string |  |
| `events[].subaccount_id` | integer (uint64) |  |
| `events[].timestamp` | integer (int64) |  |

### `private/get_option_settlement_history`

Returns option settlement (expiry) events for a single subaccount or an entire wallet (specify exactly one). Each settlement includes the reconstructed option instrument name, the settled amount and value for that expired position, and the realized settlement PnL against the position's cost basis, with and without trading fees.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `subaccount_id` | integer |  |  |
| `wallet` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `settlements` | object[] |  |
| `settlements[].amount` | string (decimal) | Settled balance (negative = short, positive = long). |
| `settlements[].expiry` | integer (uint64) | Expiry of the option, unix seconds. |
| `settlements[].instrument_name` | string |  |
| `settlements[].option_settlement_pnl` | string | USD profit or loss from the settlement: settlement value minus the position's average cost including fees times amount. `null` when no closing balance row exists for the settlement (settled before balance history was recorded). |
| `settlements[].option_settlement_pnl_excl_fees` | string | Same as `option_settlement_pnl` but against the average price excluding fees. |
| `settlements[].settlement_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `settlements[].settlement_value` | string (decimal) | Crystallized cash value = intrinsic value * amount. |
| `settlements[].subaccount_id` | integer (uint64) |  |

### `private/get_order_history`

Returns a paginated history of orders for a single subaccount or for an entire wallet (specify exactly one), optionally bounded by a from/to timestamp window. Only orders in a terminal state (filled, cancelled, expired) are recorded here, one record per order. Trigger and algo orders appear once they terminate, carrying their accumulated filled amount; while they are still live — including partially executed algo orders and trigger orders that have not yet fired — read them from get_trigger_orders and get_algo_orders instead. Each page includes the order records plus pagination info with the total count and number of pages.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `from_timestamp` | integer |  |  |
| `page` | integer |  |  |
| `page_size` | integer |  |  |
| `subaccount_id` | integer |  |  |
| `to_timestamp` | integer |  |  |
| `wallet` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `orders` | object[] |  |
| `orders[].algo_duration_sec` | integer |  |
| `orders[].algo_num_slices` | integer |  |
| `orders[].algo_slices_completed` | integer |  |
| `orders[].algo_type` | enum: `twap` |  |
| `orders[].amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `orders[].creation_timestamp` | integer (int64) |  |
| `orders[].direction` | enum: `buy`, `sell` |  |
| `orders[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].instrument_name` | string |  |
| `orders[].is_transfer` | boolean |  |
| `orders[].label` | string |  |
| `orders[].last_update_timestamp` | integer (int64) |  |
| `orders[].limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].mmp` | boolean |  |
| `orders[].nonce` | string |  |
| `orders[].order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].order_id` | string |  |
| `orders[].order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `orders[].order_type` | enum: `limit`, `market` |  |
| `orders[].quote_id` | string | Optional UUID v4 string |
| `orders[].replaced_order_id` | string | Optional UUID v4 string |
| `orders[].signature` | string |  |
| `orders[].signature_expiry_sec` | integer (int64) |  |
| `orders[].signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `orders[].signer` | string |  |
| `orders[].subaccount_id` | integer (int64) |  |
| `orders[].time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `orders[].trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `orders[].trigger_price_type` | enum: `mark`, `index` |  |
| `orders[].trigger_reject_message` | string |  |
| `orders[].trigger_type` | enum: `stoploss`, `takeprofit` |  |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `subaccount_id` | integer (int64) |  |

### `private/get_trade_history`

Returns a paginated history of executed trades for a single subaccount or an entire wallet (specify exactly one), with optional filters for a time window, order id, instrument name, or quote id. The response includes the trade records and pagination info with total count and page count.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `from_timestamp` | integer |  |  |
| `instrument_name` | string |  |  |
| `order_id` | string |  |  |
| `page` | integer |  |  |
| `page_size` | integer |  |  |
| `quote_id` | string |  |  |
| `subaccount_id` | integer |  |  |
| `to_timestamp` | integer |  |  |
| `wallet` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `subaccount_id` | integer (int64) |  |
| `trades` | object[] |  |
| `trades[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` |  |
| `trades[].block_trade_id` | string | Optional UUID v4 string |
| `trades[].direction` | enum: `buy`, `sell` |  |
| `trades[].expected_rebate` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].index_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].instrument_name` | string |  |
| `trades[].is_transfer` | boolean |  |
| `trades[].label` | string |  |
| `trades[].liquidity_role` | enum: `maker`, `taker` |  |
| `trades[].mark_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].op_uuid` | string |  |
| `trades[].order_id` | string |  |
| `trades[].quote_id` | string | Optional UUID v4 string |
| `trades[].realized_pnl` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].realized_pnl_excl_fees` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].rfq_id` | string | Optional UUID v4 string |
| `trades[].subaccount_id` | integer (int64) |  |
| `trades[].timestamp` | integer (int64) |  |
| `trades[].trade_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].trade_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].trade_id` | string |  |
| `trades[].trade_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].tx_hash` | string |  |

### `private/get_withdrawal_history`

Returns settled withdrawals for a single subaccount or an entire wallet (specify exactly one), optionally bounded by a start/end timestamp window. Each entry reports the withdrawn amount as a decimal, the fee routed to the security module (the net amount sent to the recipient is amount minus fee), and the resolved settlement batch and status.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `end_timestamp` | integer |  | End of the window, unix milliseconds (default: unbounded / now). |
| `start_timestamp` | integer |  | Start of the window, unix milliseconds (default 0). |
| `subaccount_id` | integer |  |  |
| `wallet` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `withdrawals` | object[] |  |
| `withdrawals[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `withdrawals[].asset` | string |  |
| `withdrawals[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Batch lifecycle status — the single source of lifecycle truth for every operation in the batch (individual ops carry no status of their own). Each stage has a healthy variant and a corresponding `...Error` variant meaning that stage failed. Serialized as the… |
| `withdrawals[].batch_uuid` | string |  |
| `withdrawals[].erc20_address` | string |  |
| `withdrawals[].fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `withdrawals[].forward` | object | Present when `recipient` is a withdraw address: the forward to its home chain. |
| `withdrawals[].forward.amount_forwarded` | string | This withdrawal's share of what sent forwards carried. OFT dust stays at the withdraw address for the next forward, so slightly less may arrive. |
| `withdrawals[].forward.chain_id` | integer (uint64) | The destination chain. Solana is 101 (devnet 103). |
| `withdrawals[].forward.destination_tx` | string |  |
| `withdrawals[].forward.forward_tx` | string | The latest Ethereum `processWithdrawal` (or owner `recover`) tx that carried it. |
| `withdrawals[].forward.hold_reason` | string | `no_route`, `route_unavailable`, `external_only` or `dust`; set only when `held`. |
| `withdrawals[].forward.message_id` | string | LayerZero guid or CCIP message id. |
| `withdrawals[].forward.rail` | string | `layerzero` or `ccip`; none before a forward is sent and for a recovery. |
| `withdrawals[].forward.recipient` | string | Who it forwards to: base58 on Solana, checksummed on EVM. |
| `withdrawals[].forward.status` | enum: `delivered` \| enum: `awaiting_payout` \| enum: `pending` \| enum: `held` \| enum: `in_flight` \| enum: `failed` \| enum: `recovered` | Where a forward is, in lifecycle order. A withdrawal paid in parts shows its least advanced part. |
| `withdrawals[].operation_id` | string |  |
| `withdrawals[].recipient` | string |  |
| `withdrawals[].subaccount_id` | integer (uint64) |  |
| `withdrawals[].timestamp` | integer (uint64) | Unix milliseconds. |
| `withdrawals[].tx_hash` | string |  |
| `withdrawals[].wallet` | string |  |

<a id="liquidations"></a>
## Liquidations

### `private/liquidate`

Bids on an open liquidation auction. Names the bidder's own subaccount, the account being auctioned, the fraction of it to absorb as a whole percent (a multiple of 0.01), and a signed limit price. The limit is compared against the discounted price of the whole remaining account — the quote's estimated_bid_price — not against the cash the bid actually moves, and it is negative for an insolvent auction where the security module pays the bidder. The realized fill is capped at the auction's current maximum proportion, so it can land below the requested percent. Quote the auction first with public/get_live_auctions or the auctions.watch channel: both the price and the fraction on offer move with wall-clock and with the account's mark.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `liquidate_subaccount_id` | integer (uint64) | yes | Subaccount being liquidated. |
| `nonce` | string | yes |  |
| `percent_of_acc` | string (decimal) | yes | Fraction of the account to liquidate (`"1.0"` = 100%), decimal string or JSON number. Must be a whole percent, i.e. a multiple of `"0.01"`. |
| `price_limit` | string (decimal) | yes | Max total cash paid for the filled portion; negative is a minimum payout in insolvent auctions. `"0"` opts out. Decimal string or JSON number. |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `subaccount_id` | integer (uint64) | yes | Bidder subaccount. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `op_uuid` | string |  |
| `operation_id` | integer (uint64) |  |

### `public/get_liquidation_history`

Returns a paginated history of liquidation auctions, newest first, for a single subaccount or across all of them, optionally bounded by a start/end timestamp window over the auction start. Each entry gives the auctioned subaccount, whether the auction was solvent or insolvent, the fee charged at start, the start and end timestamps, and the bids that filled it with the fraction of the account each absorbed and the cash it moved.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `end_timestamp` | integer |  | End of the window, unix milliseconds (default: unbounded). |
| `page` | integer |  | Page number, 1-based (default 1). |
| `page_size` | integer |  | Results per page (default 100, max 1000). |
| `start_timestamp` | integer |  | Start of the window, unix milliseconds (default 0). |
| `subaccount_id` | integer |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `auctions` | object[] |  |
| `auctions[].auction_id` | string | `{subaccount_id}-{start_time_sec}` — see the module docs. |
| `auctions[].auction_type` | enum: `solvent`, `insolvent` | Which phase of the auction this entry describes. |
| `auctions[].bids` | object[] |  |
| `auctions[].bids[].amounts_liquidated` | object | Change in each of the liquidated account's balances from this bid, keyed by instrument name: a long position taken reads negative, a short one positive. Includes the slice of the account's cash; the bid's own price is `cash_received`, not an entry here. The b… |
| `auctions[].bids[].bidder_id` | integer (uint64) | The subaccount that won this slice. |
| `auctions[].bids[].cash_received` | string | Cash the liquidated account received for the slice: what the bidder paid in the solvent phase, and negative in the insolvent phase, where the security module pays the bidder instead. |
| `auctions[].bids[].discount_pnl` | string | Always "0" — see the module TODO. |
| `auctions[].bids[].operation_id` | string | Stable uuid of the bid operation: the `op_uuid` `private/liquidate` returned to the bidder. |
| `auctions[].bids[].percent_liquidated` | string | Fraction of the account this bid took; "1" is the whole account. |
| `auctions[].bids[].positions_realized_pnl` | object | Always empty — see the module TODO. |
| `auctions[].bids[].positions_realized_pnl_excl_fees` | object | Always empty — see the module TODO. |
| `auctions[].bids[].realized_pnl` | string | Always "0" — see the module TODO. |
| `auctions[].bids[].realized_pnl_excl_fees` | string | Always "0" — see the module TODO. |
| `auctions[].bids[].risk_universe_id` | integer (uint32) | Risk universe of both parties; a bid must come from the liquidatee's. |
| `auctions[].bids[].timestamp` | integer (uint64) | When the sequencer applied the bid, unix ms. |
| `auctions[].bids[].tx_hash` | string | Settling L1 transaction; empty until the bid's batch settles. |
| `auctions[].bids[].unit_price` | string | Price the bid filled at for the whole account; `cash_received` is this times `percent_liquidated`. Negative in the insolvent phase. |
| `auctions[].end_timestamp` | integer | When the auction ended, unix ms; `null` while still live. |
| `auctions[].fee` | string | Liquidation fee charged at auction start; "0" for a phase opened by conversion to insolvent. |
| `auctions[].risk_universe_id` | integer (uint32) | Risk universe of the liquidated subaccount. |
| `auctions[].start_timestamp` | integer (uint64) | Auction/phase clock start, unix ms. |
| `auctions[].subaccount_id` | integer (uint64) | The liquidated (auctioned) subaccount. |
| `auctions[].tx_hash` | string | Settling L1 transaction of the op that opened the auction; empty until that batch settles. |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |

### `public/get_live_auctions`

Returns every liquidation auction open right now, each priced for a maximal bid at the moment of the response: the cash a bid would cost, the largest fraction of the account it could take, the account's mark-to-market value, the expected discount profit, and the balances on offer. Takes no parameters. This is the polling counterpart to the auctions.watch channel and carries the same values; both a solvent auction's price and the fraction on offer move with wall-clock and with the account's mark, so a quote is only good for the instant it was taken.

**Auth:** public · **Rate class:** `non_matching`

**Params**

_none_

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `auctions` | object[] |  |
| `auctions[].currency` | string | Only set when the auctioned account is not on standard margin. |
| `auctions[].estimated_bid_price` | string | Discounted mark value of the whole account, not scaled by the bid percent. Negative for an insolvent auction, where the bidder is paid. |
| `auctions[].estimated_discount_pnl` | string | Profit relative to `estimated_mtm` if the bid fills at `estimated_percent_bid` and `estimated_bid_price`. |
| `auctions[].estimated_mtm` | string | Undiscounted mark value of the whole account, net of cash already paid in by earlier bidders. |
| `auctions[].estimated_percent_bid` | string | The largest fraction of the account a bid can take right now. |
| `auctions[].margin_type` | string | Bid from an account on the same margin type to avoid unsupported-currency and max-account-size errors. |
| `auctions[].min_price_limit` | string | Cash required to buy `estimated_percent_bid` of the account — the `price_limit` to pass to `private/liquidate`. Scale it down in proportion if bidding less. |
| `auctions[].risk_universe_id` | integer (uint32) | Risk universe of the auctioned account. A bid from a subaccount in any other universe is rejected. |
| `auctions[].subaccount_balances` | object | Balance per asset name. A bid acquires `estimated_percent_bid` of each. |
| `auctions[].subaccount_id` | integer (uint64) |  |
| `auctions[].timestamp` | integer (int64) | Milliseconds since epoch at which this quote was priced. |

### `public/margin_watch`

Calculates the mark-to-market value and initial/maintenance margin for a given subaccount, with per-position and per-collateral breakdowns, computed from live feed data at request time. Margins use the subaccount's manager's params. Set is_delayed_liquidation to get them under the subaccount's delayed-liquidation override instead; the request is rejected for a subaccount without one. has_delayed_liquidation reports whether the subaccount has one. A maintenance margin below zero means the subaccount is flagged for liquidation.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `is_delayed_liquidation` | boolean |  | `true` returns margins under the subaccount's delayed-liquidation override. Rejected for a subaccount without one. |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `collaterals` | object[] |  |
| `collaterals[].amount` | string |  |
| `collaterals[].amount_step` | string |  |
| `collaterals[].asset_name` | string |  |
| `collaterals[].asset_type` | string |  |
| `collaterals[].average_price` | string |  |
| `collaterals[].average_price_excl_fees` | string |  |
| `collaterals[].creation_timestamp` | integer (int64) |  |
| `collaterals[].cumulative_interest` | string |  |
| `collaterals[].currency` | string |  |
| `collaterals[].delta` | string |  |
| `collaterals[].delta_currency` | string |  |
| `collaterals[].initial_margin` | string |  |
| `collaterals[].maintenance_margin` | string |  |
| `collaterals[].mark_price` | string |  |
| `collaterals[].mark_value` | string |  |
| `collaterals[].open_orders_margin` | string |  |
| `collaterals[].pending_interest` | string |  |
| `collaterals[].realized_pnl` | string |  |
| `collaterals[].realized_pnl_excl_fees` | string |  |
| `collaterals[].total_fees` | string |  |
| `collaterals[].unrealized_pnl` | string |  |
| `collaterals[].unrealized_pnl_excl_fees` | string |  |
| `currency` | string[] |  |
| `has_delayed_liquidation` | boolean | `true` when the subaccount has a delayed-liquidation override. |
| `initial_margin` | string |  |
| `is_delayed_liquidation` | boolean | `true` when the margins above use the delayed-liquidation override. |
| `maintenance_margin` | string | Below zero the subaccount is flagged for liquidation. |
| `margin_type` | string |  |
| `positions` | object[] |  |
| `positions[].amount` | string |  |
| `positions[].amount_step` | string |  |
| `positions[].average_price` | string |  |
| `positions[].average_price_excl_fees` | string |  |
| `positions[].creation_timestamp` | integer (int64) |  |
| `positions[].cumulative_funding` | string |  |
| `positions[].delta` | string |  |
| `positions[].gamma` | string |  |
| `positions[].index_price` | string |  |
| `positions[].initial_margin` | string |  |
| `positions[].instrument_name` | string |  |
| `positions[].instrument_type` | enum: `option`, `perp`, `erc20` | Asset type of the instrument: `"option"`, `"perp"`, or `"erc20"`. |
| `positions[].leverage` | string |  |
| `positions[].liquidation_price` | string |  |
| `positions[].maintenance_margin` | string |  |
| `positions[].mark_price` | string |  |
| `positions[].mark_value` | string |  |
| `positions[].net_settlements` | string |  |
| `positions[].open_orders_margin` | string | Uses the same params as `initial_margin`: the manager's, even for a subaccount with a delayed-liquidation override, unless `public/margin_watch` asks for the override. |
| `positions[].pending_funding` | string |  |
| `positions[].realized_pnl` | string |  |
| `positions[].realized_pnl_excl_fees` | string |  |
| `positions[].theta` | string |  |
| `positions[].total_fees` | string |  |
| `positions[].unrealized_pnl` | string |  |
| `positions[].unrealized_pnl_excl_fees` | string |  |
| `positions[].vega` | string |  |
| `regular_margin_flagged_sec` | integer | Unix seconds at which a subaccount with a delayed-liquidation override was first seen below its manager's maintenance margin. Its grace period before liquidation counts from here. Null otherwise. |
| `risk_universe_id` | integer (uint32) |  |
| `subaccount_id` | integer (uint64) |  |
| `subaccount_value` | string |  |
| `valuation_timestamp` | integer (int64) | Unix seconds at which margin and MtM were computed. |

<a id="maker-scoring"></a>
## Maker Scoring

### `public/get_maker_program_scores`

Returns the wallet-level score breakdown for one maker-program epoch, including square-rooted coverage and quality components, traded-volume multiplier, holder boost, volume, and epoch totals.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `epoch_start_timestamp` | integer (int64) | yes |  |
| `program_name` | string | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `program` | object |  |
| `program.asset_types` | string[] |  |
| `program.currencies` | string[] |  |
| `program.end_timestamp` | integer (int64) |  |
| `program.min_notional` | string |  |
| `program.name` | string |  |
| `program.rewards` | object |  |
| `program.start_timestamp` | integer (int64) |  |
| `scores` | object[] |  |
| `scores[].coverage_score` | string |  |
| `scores[].holder_boost` | string |  |
| `scores[].quality_score` | string |  |
| `scores[].total_score` | string |  |
| `scores[].volume` | string |  |
| `scores[].volume_multiplier` | string |  |
| `scores[].wallet` | string |  |
| `total_score` | string |  |
| `total_volume` | string |  |

### `public/get_maker_programs`

Returns every maker-program epoch, including historical epochs, with its asset and currency scope, minimum eligible notional, timestamps, and reward-token amounts. Takes no parameters.

**Auth:** public · **Rate class:** `non_matching`

**Params**

_none_

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `[].asset_types` | string[] |  |
| `[].currencies` | string[] |  |
| `[].end_timestamp` | integer (int64) |  |
| `[].min_notional` | string |  |
| `[].name` | string |  |
| `[].rewards` | object |  |
| `[].start_timestamp` | integer (int64) |  |

<a id="market-maker-protection"></a>
## Market Maker Protection

### `private/get_mmp_config`

Returns the market maker protection (MMP) settings for a subaccount, optionally filtered to a single currency. Each entry reports the amount and delta limits (as decimal strings), the rolling interval and freeze duration (in milliseconds), and the current freeze state, including whether MMP is currently frozen and the timestamp at which it unfreezes.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string |  |  |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `[].currency` | string |  |
| `[].is_frozen` | boolean |  |
| `[].mmp_amount_limit` | string |  |
| `[].mmp_delta_limit` | string |  |
| `[].mmp_frozen_time` | integer (uint64) |  |
| `[].mmp_interval` | integer (uint64) |  |
| `[].mmp_unfreeze_time` | integer (int64) |  |
| `[].subaccount_id` | integer (uint64) |  |

### `private/reset_mmp`

Clears an active market maker protection freeze and resets the rolling MMP window for a subaccount, optionally scoped to a single currency. Use this to resume quoting after MMP has frozen a subaccount. Requires a trading-scoped session key and returns "ok" on success.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string |  |  |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

_none_

### `private/set_mmp_config`

Creates or fully replaces the market maker protection settings for a subaccount and currency. Accepts an amount limit and delta limit (as decimals) plus the rolling interval and freeze duration in milliseconds; omitted limits default to zero. Requires a trading-scoped session key and echoes the applied configuration back.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string | yes |  |
| `mmp_amount_limit` | string (decimal) |  | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp_delta_limit` | string (decimal) |  | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp_frozen_time` | integer (uint64) | yes |  |
| `mmp_interval` | integer (uint64) | yes |  |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `currency` | string |  |
| `mmp_amount_limit` | string |  |
| `mmp_delta_limit` | string |  |
| `mmp_frozen_time` | integer (uint64) |  |
| `mmp_interval` | integer (uint64) |  |
| `subaccount_id` | integer (uint64) |  |

<a id="onchain-actions"></a>
## Onchain Actions

### `private/get_withdraw_addresses`

Lists the account's withdraw addresses from private/register_withdraw_address: its EVM ones (their recipient is the wallet) and every withdraw address on its whitelisted_recipients. Each entry gives the destination chain id, the address kind (evm or solana), the recipient as registered and whether it is whitelisted, which session keys need before they can withdraw to it. A Solana address that was registered but never whitelisted is not listed.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `withdraw_addresses` | object[] | The account's EVM withdraw addresses (their recipient is the wallet) and every withdraw address on its `whitelisted_recipients`, oldest first. |
| `withdraw_addresses[].address_kind` | enum: `evm`, `solana` |  |
| `withdraw_addresses[].chain_id` | integer (uint64) | Destination chain. Solana is 101 (devnet 103). |
| `withdraw_addresses[].recipient` | string | `0x` bytes32 the factory forwards to. |
| `withdraw_addresses[].recipient_display` | string | The recipient as registered: checksummed on EVM, base58 on Solana. |
| `withdraw_addresses[].whitelisted` | boolean | On the account's `whitelisted_recipients`, so session keys may withdraw to it. |
| `withdraw_addresses[].withdraw_address` | string |  |

### `private/register_bridge_deposit`

Reports a bridge into one of the caller's deposit addresses the moment its source transaction is sent, so public/get_pending_deposits shows it as `bridging` at once with the expected amount, before the bridge's own API reports it. Rails: `lifi`, `layerzero` and `ccip`. Takes the rail, the source chain and transaction, the rail's transfer id (Li.Fi: the quote's transactionId, optional; LayerZero: the message guid; CCIP: the messageId), the deposit address, the source and delivered tokens and the expected amount. Idempotent per bridge. Display only: nothing is credited from it, and a registration its rail never confirms expires.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `bridge_token` | string | yes | The ERC20 the bridge delivers on the destination chain. |
| `bridge_token_decimals` | integer (uint8) | yes | `bridge_token`'s decimals. |
| `deposit_address` | string | yes | One of the wallet's escrows, from `public/register_deposit_address`. |
| `expected_amount` | string | yes | What will arrive, in `bridge_token`'s native units, as a decimal string (Li.Fi: `estimate.toAmount`; LayerZero: `amountReceivedLD`; CCIP: the amount sent). |
| `provider_transfer_id` | string |  | The provider's own id for the transfer, kept if the source transaction is sped up or replaced. Li.Fi: the quote's `transactionId`, optional. LayerZero: the message `guid`; CCIP: the `messageId`. Both required. |
| `rail` | string | yes | Bridge protocol: `lifi`, `layerzero` or `ccip`. |
| `source_chain_id` | integer (uint64) | yes | EVM chain the bridge was sent from. |
| `source_token` | string | yes | The ERC20 sent on the source chain; the zero address for the chain's gas token. |
| `source_tx_hash` | string | yes | The bridge transaction on that chain. |
| `tool` | string |  | The route the provider chose (Li.Fi: the quote's `tool`). Internal only. |
| `wallet` | string | yes | The session's wallet. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `bridge_id` | string | Unique with `rail`; changes if a registered source tx is replaced, so key on `provider_transfer_id` when present. |
| `bridge_status` | string | `registered` (reported by the client, not yet confirmed by its rail) `submitted` (in flight) `delivered` (landed on the destination chain) `matched` (joined to the L1 deposit) `failed` (the bridge refunded or could not fill — nothing reached the escrow) `expi… |
| `delivered_at_ms` | integer |  |
| `deposit_address` | string | The escrow the bridge delivers to. |
| `expected_amount` | string | Quoted amount expected to land, in `token` units (estimated until quoted); `receiving_amount` once delivered. |
| `expires_at_ms` | integer (int64) | When a still-`registered` or `submitted` bridge will be marked `expired`. |
| `provider_transfer_id` | string | The provider's own id for the bridge (Li.Fi: the quote's `transactionId`; LayerZero: the message `guid`; CCIP: the `messageId`), stable through its lifecycle. |
| `rail` | string | Bridge protocol: `lifi`, `layerzero` or `ccip`. |
| `receiving_amount` | string | What actually arrived, native units, as a decimal string. |
| `receiving_token` | string |  |
| `receiving_tx_hash` | string | The bridge's delivery transaction on the destination chain. |
| `source_address` | string | Their wallet on that chain, lower-cased; absent when the rail gave none. |
| `source_chain_id` | integer (uint64) | Chain the user sent from. |
| `source_tx_hash` | string | Their transaction on that chain. |
| `substatus` | string | The rail's detail, or `TOKEN_MISMATCH` when the escrow cannot credit the token. |
| `token` | string | The ERC20 expected to land in the escrow. |

### `private/register_withdraw_address`

Returns the Ethereum withdraw address that forwards a withdrawal of a forwarded token to a recipient on its home chain, and records it so the forwarder watches it. Takes the wallet, the destination chain id (a key of the route file's withdraw_forwarding section; Solana is 101, devnet 103) and the recipient. On an EVM chain the recipient must be the account wallet; on Solana it must be a base58 wallet address, which is screened. Repeated calls return the same address; new registrations are rate limited per rolling window. Withdraw to the returned address with private/withdraw. Session keys without unbounded Admin scope must first add it with private/update_whitelisted_recipients.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `chain_id` | integer (uint64) | yes | Destination chain: a key of the route file's `withdraw_forwarding` section. Solana is 101 (devnet 103); every other chain is EVM. |
| `recipient` | string | yes | Destination address. On an EVM chain it must be `wallet`. On Solana, a base58 wallet address (not a token or program-derived account). |
| `wallet` | string | yes | The account wallet. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `chain_id` | integer (uint64) |  |
| `recipient` | string | `0x` bytes32 the factory forwards to. |
| `recipient_display` | string | `recipient` normalised: checksummed on EVM, base58 on Solana. |
| `routes` | object[] | The tokens this address forwards. |
| `routes[].bridge_type` | string | `native-oft`, `oft` or `ccip`. |
| `routes[].symbol` | string |  |
| `routes[].token` | string | Ethereum token to withdraw. |
| `withdraw_address` | string | Withdraw a forwarded token to this Ethereum address to send it on to `recipient` on `chain_id`. |

### `public/get_onchain_action_history`

Returns the lifecycle of onchain actions submitted via `OnchainActionManager.sol`. Public endpoint. Onchain actions are either applied directly or with a `fallback` flag. Each onchain action is affected by the `fallback` flag uniquely: - Deposits: sequencer moved the deposit into the `fallback_subaccount` - SetSessionKey: no-op - Admin actions: no-op The onchain action can have several states: - `applied`: action was successfully applied by the sequencer - `applied_with_fallback`: action was applied by the sequencer with fallback=true - `instant_fallback`: action failed its initial attempt, will be re-submitted with fallback=true - `retry_then_fallback`: action failed its initial attempt, will be re-submitted with fallback=false until the retry budget is exceeded, then re-submitted with fallback=true - `never_escalate`: action failed its initial attempt but will retry until successful,…

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `action_type` | integer |  | On-chain `actionType` id. |
| `end_timestamp` | integer |  |  |
| `page` | integer |  |  |
| `page_size` | integer |  |  |
| `start_timestamp` | integer |  |  |
| `wallet` | string |  | L1 sender of the action (any hex casing). |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `actions` | object[] |  |
| `actions[].acc` | string | Rolling accumulator from the ActionQueued event, 0x-hex. |
| `actions[].action_id` | integer (uint64) |  |
| `actions[].action_type` | integer (uint64) |  |
| `actions[].action_type_label` | string |  |
| `actions[].block_number` | integer (uint64) |  |
| `actions[].data` | string | Raw action calldata, 0x-hex. |
| `actions[].error_code` | integer | Most recent submit rejection; null if the action never failed. Kept on applied/fallback rows as the reason the action struggled. |
| `actions[].error_data` | string | The rejection's specifics, e.g. the wallet and cap it hit. Null for an internal error, whose text stays internal as on every other endpoint. |
| `actions[].error_message` | string |  |
| `actions[].fallback_at` | integer | Unix ms the action was escalated with `fallback=true`; null if never escalated. |
| `actions[].first_failed_at` | integer | Unix ms of the first failed submit; null if the action never failed. |
| `actions[].l1_sender` | string |  |
| `actions[].last_failed_at` | integer | Unix ms of the most recent failed submit; null if never failed. |
| `actions[].op_uuid` | string | Operation uuid assigned by the sequencer; null until applied. |
| `actions[].queue` | string | Onchain queue: 'public' or 'admin'. |
| `actions[].skip_reason` | string | The rendered rejection behind `skip_reason_code`, e.g. the risk-gate error or the owning wallet on 'sender_not_owner'. |
| `actions[].skip_reason_code` | string | Why the protocol consumed an L1 escape-hatch withdrawal without moving funds: 'undecodable_payload' \| 'unknown_subaccount' \| 'sender_not_owner' \| 'rejected'. Null for every other action, and for a withdrawal that paid out. Distinct from `error_code`/`error… |
| `actions[].status` | string | Sequencer applied states: 'applied' \| 'applied_with_fallback' Failed States: 'instant_fallback' \| 'retry_then_fallback' \| 'never_escalate' |
| `actions[].tx_hash` | string |  |
| `actions[].updated_at` | integer (int64) | Unix ms of the latest state change. |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |

### `public/get_pending_deposits`

Returns deposits queued on L1 but not yet applied by the sequencer, indexed for a wallet and keyed by (tx_hash, log_index). Once a deposit is applied it moves to private/get_deposit_history; this endpoint covers the window in between. Public because a first-time depositor has no account (and thus no session key) until their deposit is applied. A deposit below the asset's minimum is donated to the security module and credits nothing: its entry reports `below_min_deposit: true`.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | Wallet the pending deposits credit. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `pending_deposits` | object[] | L1 deposits, plus every bridge in flight or settled inside [`BRIDGE_HISTORY_WINDOW_MS`], each exactly once. |
| `pending_deposits[].action_id` | integer | Per-queue id assigned by the `OnchainActionManager`. Absent while `bridging`. |
| `pending_deposits[].action_type` | string | `Deposit` (existing subaccount) or `DepositToNewSubaccount` |
| `pending_deposits[].amount` | string | Amount in the asset's native ERC-20 units, as a decimal string. While `bridging`, the estimated `bridge_to_l1.expected_amount` until the bridge delivers, then what it delivered. |
| `pending_deposits[].asset` | string |  |
| `pending_deposits[].below_min_deposit` | boolean | Below the asset's minimum deposit: the whole amount went to the security module and nothing was credited. |
| `pending_deposits[].block_number` | integer |  |
| `pending_deposits[].bridge_to_l1` | object | Where a bridged deposit came from; absent for a plain L1 deposit or a bridge sent without Derive's integrator code. |
| `pending_deposits[].bridge_to_l1.bridge_id` | string | Unique with `rail`; changes if a registered source tx is replaced, so key on `provider_transfer_id` when present. |
| `pending_deposits[].bridge_to_l1.bridge_status` | string | `registered` (reported by the client, not yet confirmed by its rail) `submitted` (in flight) `delivered` (landed on the destination chain) `matched` (joined to the L1 deposit) `failed` (the bridge refunded or could not fill — nothing reached the escrow) `expi… |
| `pending_deposits[].bridge_to_l1.delivered_at_ms` | integer |  |
| `pending_deposits[].bridge_to_l1.deposit_address` | string | The escrow the bridge delivers to. |
| `pending_deposits[].bridge_to_l1.expected_amount` | string | Quoted amount expected to land, in `token` units (estimated until quoted); `receiving_amount` once delivered. |
| `pending_deposits[].bridge_to_l1.expires_at_ms` | integer (int64) | When a still-`registered` or `submitted` bridge will be marked `expired`. |
| `pending_deposits[].bridge_to_l1.provider_transfer_id` | string | The provider's own id for the bridge (Li.Fi: the quote's `transactionId`; LayerZero: the message `guid`; CCIP: the `messageId`), stable through its lifecycle. |
| `pending_deposits[].bridge_to_l1.rail` | string | Bridge protocol: `lifi`, `layerzero` or `ccip`. |
| `pending_deposits[].bridge_to_l1.receiving_amount` | string | What actually arrived, native units, as a decimal string. |
| `pending_deposits[].bridge_to_l1.receiving_token` | string |  |
| `pending_deposits[].bridge_to_l1.receiving_tx_hash` | string | The bridge's delivery transaction on the destination chain. |
| `pending_deposits[].bridge_to_l1.source_address` | string | Their wallet on that chain, lower-cased; absent when the rail gave none. |
| `pending_deposits[].bridge_to_l1.source_chain_id` | integer (uint64) | Chain the user sent from. |
| `pending_deposits[].bridge_to_l1.source_tx_hash` | string | Their transaction on that chain. |
| `pending_deposits[].bridge_to_l1.substatus` | string | The rail's detail, or `TOKEN_MISMATCH` when the escrow cannot credit the token. |
| `pending_deposits[].bridge_to_l1.token` | string | The ERC20 expected to land in the escrow. |
| `pending_deposits[].deposit_type` | string | `standard` or `direct`. |
| `pending_deposits[].log_index` | integer |  |
| `pending_deposits[].manager_id` | integer (uint32) | Manager of the new subaccount; `0` for existing-subaccount deposits. |
| `pending_deposits[].status` | string | `bridging` (a bridge not yet recorded on L1; its detail is `bridge_to_l1.bridge_status`) `detected` (transfer seen at the tip, pre-confirmation) `pending` (escrow swept, awaiting confirmation) `confirmed` (sweep tx past the confirmation range) `reverted` (the… |
| `pending_deposits[].subaccount_id` | integer (int64) | Credited subaccount; `0` for new-subaccount deposits. |
| `pending_deposits[].timestamp` | integer (int64) | Milliseconds when the tracker first picked up the deposit - approximates the block timestamp of `block_number`. Shared by all of a deposit's entries. While `bridging`, the bridge's source transaction time. |
| `pending_deposits[].tx_hash` | string | The L1 deposit. Absent while `bridging`: key a bridging entry on `bridge_to_l1` (see `bridge_id`), since it gains `tx_hash`/`log_index` once the sweeper records the deposit. |
| `pending_deposits[].updated_at_ms` | integer (int64) |  |
| `wallet` | string |  |

### `public/register_deposit_address`

A pre-requisite before using the `standard` deposit method as opposed to `direct` contract calls. Returns the deterministic on-chain deposit address for a wallet and records it so incoming deposits are watched and credited. Pass the wallet and optionally an existing subaccount id; when creating a new subaccount (subaccount omitted or 0) a non-zero manager_id is required. Repeated calls return the same cached address and keep it alive, while new registrations are rate limited per rolling window; unused addresses are dropped after 7 days.

**Auth:** public · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `manager_id` | integer |  | Manager the deposit routes under. Required (non-zero) when creating a new subaccount (`subaccount_id` omitted or 0); must be 0 or omitted for an existing subaccount — it salts the deposit address, so a nonzero value would mint a distinct escrow for the same d… |
| `subaccount_id` | integer (int64) |  |  |
| `wallet` | string | yes | Wallet address to watch for deposits. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `deposit_address` | string |  |
| `manager_id` | integer |  |
| `subaccount_id` | integer |  |
| `wallet` | string |  |

<a id="orderbook"></a>
## Orderbook

### `private/cancel`

Cancels one resting order identified by order_id, subaccount_id and instrument_name. Requires any trade scope on the session; returns the cancelled order with its final status.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `instrument_name` | string | yes |  |
| `order_id` | string (uuid) | yes | UUID v4 string |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `algo_duration_sec` | integer |  |
| `algo_num_slices` | integer |  |
| `algo_slices_completed` | integer |  |
| `algo_type` | enum: `twap` |  |
| `amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `creation_timestamp` | integer (int64) |  |
| `direction` | enum: `buy`, `sell` |  |
| `extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `instrument_name` | string |  |
| `is_transfer` | boolean |  |
| `label` | string |  |
| `last_update_timestamp` | integer (int64) |  |
| `limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp` | boolean |  |
| `nonce` | string |  |
| `order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order_id` | string |  |
| `order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `order_type` | enum: `limit`, `market` |  |
| `quote_id` | string | Optional UUID v4 string |
| `replaced_order_id` | string | Optional UUID v4 string |
| `signature` | string |  |
| `signature_expiry_sec` | integer (int64) |  |
| `signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `signer` | string |  |
| `subaccount_id` | integer (int64) |  |
| `time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `trigger_price_type` | enum: `mark`, `index` |  |
| `trigger_reject_message` | string |  |
| `trigger_type` | enum: `stoploss`, `takeprofit` |  |

### `private/cancel_algo_order`

Cancels a single active algo order identified by order_id and subaccount_id, stopping any further child-order execution. Requires any trade scope; returns the cancelled order.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `order_id` | string (uuid) | yes | UUID v4 string |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `algo_duration_sec` | integer |  |
| `algo_num_slices` | integer |  |
| `algo_slices_completed` | integer |  |
| `algo_type` | enum: `twap` |  |
| `amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `creation_timestamp` | integer (int64) |  |
| `direction` | enum: `buy`, `sell` |  |
| `extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `instrument_name` | string |  |
| `is_transfer` | boolean |  |
| `label` | string |  |
| `last_update_timestamp` | integer (int64) |  |
| `limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp` | boolean |  |
| `nonce` | string |  |
| `order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order_id` | string |  |
| `order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `order_type` | enum: `limit`, `market` |  |
| `quote_id` | string | Optional UUID v4 string |
| `replaced_order_id` | string | Optional UUID v4 string |
| `signature` | string |  |
| `signature_expiry_sec` | integer (int64) |  |
| `signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `signer` | string |  |
| `subaccount_id` | integer (int64) |  |
| `time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `trigger_price_type` | enum: `mark`, `index` |  |
| `trigger_reject_message` | string |  |
| `trigger_type` | enum: `stoploss`, `takeprofit` |  |

### `private/cancel_all`

Cancels every open order on the given subaccount. Optional cancel_trigger_orders and cancel_algo_orders flags additionally clear the subaccount's trigger and algo orders in the same call. Requires any trade scope; returns "ok" on success.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `cancel_algo_orders` | boolean |  |  |
| `cancel_trigger_orders` | boolean |  |  |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

_none_

### `private/cancel_all_algo_orders`

Cancels every active algo order on the given subaccount. Requires any trade scope; returns "ok" on success.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

_none_

### `private/cancel_all_trigger_orders`

Cancels every pending trigger order on the given subaccount. Requires any trade scope; returns "ok" on success.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

_none_

### `private/cancel_by_instrument`

Cancels every open order for a subaccount on a single instrument. Requires any trade scope; returns the number of orders cancelled.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `instrument_name` | string | yes |  |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `cancelled_orders` | integer (int64) |  |

### `private/cancel_by_label`

Cancels a subaccount's open orders that carry the given client label, optionally scoped to a single instrument_name. When an instrument is supplied the call is acknowledged with the number of orders cancelled; without one it runs as a bulk fire-and-forget cancel and returns a -1 sentinel count. Requires any trade scope.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `custom`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `instrument_name` | string |  |  |
| `label` | string | yes |  |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `cancelled_orders` | integer (int64) |  |

### `private/cancel_by_nonce`

Cancels a single order identified by its signing nonce, instrument_name and subaccount_id. The owning wallet is taken from the authenticated session rather than the request. Requires any trade scope; returns the cancelled order.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `instrument_name` | string | yes |  |
| `nonce` | string | yes |  |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `cancelled_orders` | integer (int64) |  |

### `private/cancel_trigger_order`

Cancels a single pending trigger order identified by order_id and subaccount_id. Requires any trade scope; returns the cancelled order.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `order_id` | string (uuid) | yes | UUID v4 string |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `algo_duration_sec` | integer |  |
| `algo_num_slices` | integer |  |
| `algo_slices_completed` | integer |  |
| `algo_type` | enum: `twap` |  |
| `amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `creation_timestamp` | integer (int64) |  |
| `direction` | enum: `buy`, `sell` |  |
| `extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `instrument_name` | string |  |
| `is_transfer` | boolean |  |
| `label` | string |  |
| `last_update_timestamp` | integer (int64) |  |
| `limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp` | boolean |  |
| `nonce` | string |  |
| `order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order_id` | string |  |
| `order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `order_type` | enum: `limit`, `market` |  |
| `quote_id` | string | Optional UUID v4 string |
| `replaced_order_id` | string | Optional UUID v4 string |
| `signature` | string |  |
| `signature_expiry_sec` | integer (int64) |  |
| `signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `signer` | string |  |
| `subaccount_id` | integer (int64) |  |
| `time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `trigger_price_type` | enum: `mark`, `index` |  |
| `trigger_reject_message` | string |  |
| `trigger_type` | enum: `stoploss`, `takeprofit` |  |

### `private/get_algo_orders`

Returns all active algo orders (e.g. time-sliced execution orders) for the given subaccount as a flat list. Read-only query.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `[].algo_duration_sec` | integer |  |
| `[].algo_num_slices` | integer |  |
| `[].algo_slices_completed` | integer |  |
| `[].algo_type` | enum: `twap` |  |
| `[].amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `[].creation_timestamp` | integer (int64) |  |
| `[].direction` | enum: `buy`, `sell` |  |
| `[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].instrument_name` | string |  |
| `[].is_transfer` | boolean |  |
| `[].label` | string |  |
| `[].last_update_timestamp` | integer (int64) |  |
| `[].limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].mmp` | boolean |  |
| `[].nonce` | string |  |
| `[].order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].order_id` | string |  |
| `[].order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `[].order_type` | enum: `limit`, `market` |  |
| `[].quote_id` | string | Optional UUID v4 string |
| `[].replaced_order_id` | string | Optional UUID v4 string |
| `[].signature` | string |  |
| `[].signature_expiry_sec` | integer (int64) |  |
| `[].signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `[].signer` | string |  |
| `[].subaccount_id` | integer (int64) |  |
| `[].time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `[].trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `[].trigger_price_type` | enum: `mark`, `index` |  |
| `[].trigger_reject_message` | string |  |
| `[].trigger_type` | enum: `stoploss`, `takeprofit` |  |

### `private/get_open_orders`

Returns all currently open orders for the given subaccount, including each order's instrument, direction, prices, amounts and status. Only orders resting on the order book are returned: pending trigger orders that have not yet fired are available from get_trigger_orders, and active algo orders from get_algo_orders. Once a trigger order fires, the resulting order appears here if it rests on the book rather than filling immediately; algo orders execute as IOC slices and so never rest here. Read-only query.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `orders` | object[] |  |
| `orders[].algo_duration_sec` | integer |  |
| `orders[].algo_num_slices` | integer |  |
| `orders[].algo_slices_completed` | integer |  |
| `orders[].algo_type` | enum: `twap` |  |
| `orders[].amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `orders[].creation_timestamp` | integer (int64) |  |
| `orders[].direction` | enum: `buy`, `sell` |  |
| `orders[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].instrument_name` | string |  |
| `orders[].is_transfer` | boolean |  |
| `orders[].label` | string |  |
| `orders[].last_update_timestamp` | integer (int64) |  |
| `orders[].limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].mmp` | boolean |  |
| `orders[].nonce` | string |  |
| `orders[].order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].order_id` | string |  |
| `orders[].order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `orders[].order_type` | enum: `limit`, `market` |  |
| `orders[].quote_id` | string | Optional UUID v4 string |
| `orders[].replaced_order_id` | string | Optional UUID v4 string |
| `orders[].signature` | string |  |
| `orders[].signature_expiry_sec` | integer (int64) |  |
| `orders[].signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `orders[].signer` | string |  |
| `orders[].subaccount_id` | integer (int64) |  |
| `orders[].time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `orders[].trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `orders[].trigger_price_type` | enum: `mark`, `index` |  |
| `orders[].trigger_reject_message` | string |  |
| `orders[].trigger_type` | enum: `stoploss`, `takeprofit` |  |
| `subaccount_id` | integer (int64) |  |

### `private/get_order`

Returns one order (active or completed) by order_id and subaccount_id; the subaccount filter enforces ownership. Returns the order or an order-does-not-exist error.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `order_id` | string (uuid) | yes | UUID v4 string |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `algo_duration_sec` | integer |  |
| `algo_num_slices` | integer |  |
| `algo_slices_completed` | integer |  |
| `algo_type` | enum: `twap` |  |
| `amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `creation_timestamp` | integer (int64) |  |
| `direction` | enum: `buy`, `sell` |  |
| `extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `instrument_name` | string |  |
| `is_transfer` | boolean |  |
| `label` | string |  |
| `last_update_timestamp` | integer (int64) |  |
| `limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp` | boolean |  |
| `nonce` | string |  |
| `order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order_id` | string |  |
| `order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `order_type` | enum: `limit`, `market` |  |
| `quote_id` | string | Optional UUID v4 string |
| `replaced_order_id` | string | Optional UUID v4 string |
| `signature` | string |  |
| `signature_expiry_sec` | integer (int64) |  |
| `signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `signer` | string |  |
| `subaccount_id` | integer (int64) |  |
| `time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `trigger_price_type` | enum: `mark`, `index` |  |
| `trigger_reject_message` | string |  |
| `trigger_type` | enum: `stoploss`, `takeprofit` |  |

### `private/get_trigger_orders`

Returns all pending trigger (conditional) orders for the given subaccount that have not yet fired. Read-only query.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `orders` | object[] |  |
| `orders[].algo_duration_sec` | integer |  |
| `orders[].algo_num_slices` | integer |  |
| `orders[].algo_slices_completed` | integer |  |
| `orders[].algo_type` | enum: `twap` |  |
| `orders[].amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `orders[].creation_timestamp` | integer (int64) |  |
| `orders[].direction` | enum: `buy`, `sell` |  |
| `orders[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].instrument_name` | string |  |
| `orders[].is_transfer` | boolean |  |
| `orders[].label` | string |  |
| `orders[].last_update_timestamp` | integer (int64) |  |
| `orders[].limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].mmp` | boolean |  |
| `orders[].nonce` | string |  |
| `orders[].order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `orders[].order_id` | string |  |
| `orders[].order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `orders[].order_type` | enum: `limit`, `market` |  |
| `orders[].quote_id` | string | Optional UUID v4 string |
| `orders[].replaced_order_id` | string | Optional UUID v4 string |
| `orders[].signature` | string |  |
| `orders[].signature_expiry_sec` | integer (int64) |  |
| `orders[].signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `orders[].signer` | string |  |
| `orders[].subaccount_id` | integer (int64) |  |
| `orders[].time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `orders[].trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `orders[].trigger_price_type` | enum: `mark`, `index` |  |
| `orders[].trigger_reject_message` | string |  |
| `orders[].trigger_type` | enum: `stoploss`, `takeprofit` |  |
| `subaccount_id` | integer (int64) |  |

### `private/order`

Submits a signed limit or market order for a subaccount, specifying instrument, direction, amount, limit price and max fee, plus optional flags like time-in-force, reduce-only, post-only and MMP. The same endpoint also creates trigger orders (via trigger_type/trigger_price) and algo orders (via algo_type), though the two cannot be combined in one request. Requires a signed order payload and Orderbook trade scope for the instrument's asset; returns the created order with its assigned id and current status.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `algo_duration_sec` | integer |  |  |
| `algo_num_slices` | integer |  |  |
| `algo_type` | enum: `twap` |  |  |
| `amount` | string (decimal) | yes | Order amount in units of the base, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `client` | string |  |  |
| `direction` | enum: `buy`, `sell` | yes |  |
| `extra_fee` | string |  | Optional builder fee for the whole order, in USDC, as a decimal string or JSON number. Each fill pays its pro-rata share. Defaults to zero. |
| `instrument_name` | string | yes |  |
| `is_atomic_signing` | boolean |  |  |
| `label` | string |  |  |
| `limit_price` | string (decimal) | yes | Limit price in quote currency, as a decimal string (e.g. `"3100.5"`) or a JSON number. |
| `max_fee` | string (decimal) | yes | Max fee per unit of volume in quote currency, as a decimal string or a JSON number. |
| `mmp` | boolean |  | Tags the order for market maker protection. Only tagged orders are cancelled by cancel on disconnect. |
| `nonce` | string | yes |  |
| `order_type` | enum: `limit`, `market` |  |  |
| `reduce_only` | boolean |  |  |
| `referral_code` | string |  |  |
| `reject_post_only` | boolean |  |  |
| `reject_timestamp` | integer |  |  |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (int64) | yes |  |
| `signer` | string | yes |  |
| `subaccount_id` | integer (int64) | yes |  |
| `time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |  |
| `trigger_price` | string |  | Trigger price as a decimal string or JSON number; omit for non-trigger orders. |
| `trigger_price_type` | enum: `mark`, `index` |  |  |
| `trigger_type` | enum: `stoploss`, `takeprofit` |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `order` | object |  |
| `order.algo_duration_sec` | integer |  |
| `order.algo_num_slices` | integer |  |
| `order.algo_slices_completed` | integer |  |
| `order.algo_type` | enum: `twap` |  |
| `order.amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `order.creation_timestamp` | integer (int64) |  |
| `order.direction` | enum: `buy`, `sell` |  |
| `order.extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.instrument_name` | string |  |
| `order.is_transfer` | boolean |  |
| `order.label` | string |  |
| `order.last_update_timestamp` | integer (int64) |  |
| `order.limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.mmp` | boolean |  |
| `order.nonce` | string |  |
| `order.order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.order_id` | string |  |
| `order.order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `order.order_type` | enum: `limit`, `market` |  |
| `order.quote_id` | string | Optional UUID v4 string |
| `order.replaced_order_id` | string | Optional UUID v4 string |
| `order.signature` | string |  |
| `order.signature_expiry_sec` | integer (int64) |  |
| `order.signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `order.signer` | string |  |
| `order.subaccount_id` | integer (int64) |  |
| `order.time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `order.trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `order.trigger_price_type` | enum: `mark`, `index` |  |
| `order.trigger_reject_message` | string |  |
| `order.trigger_type` | enum: `stoploss`, `takeprofit` |  |
| `trades` | object[] |  |
| `trades[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Settlement batch status; `null` if processed by sequencer. |
| `trades[].block_trade_id` | string | Optional UUID v4 string |
| `trades[].direction` | enum: `buy`, `sell` |  |
| `trades[].expected_rebate` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].index_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].instrument_name` | string |  |
| `trades[].is_transfer` | boolean |  |
| `trades[].label` | string |  |
| `trades[].liquidity_role` | enum: `maker`, `taker` |  |
| `trades[].mark_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].op_uuid` | string |  |
| `trades[].order_id` | string |  |
| `trades[].quote_id` | string | Optional UUID v4 string |
| `trades[].realized_pnl` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].realized_pnl_excl_fees` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].rfq_id` | string | Optional UUID v4 string |
| `trades[].subaccount_id` | integer (int64) |  |
| `trades[].timestamp` | integer (int64) |  |
| `trades[].trade_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].trade_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].trade_id` | string |  |
| `trades[].trade_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].tx_hash` | string |  |

### `private/order_debug`

Takes the same params as private/order and rebuilds the order Action without executing anything, returning the EIP-712 encoded_data, encoded_data_hashed, action_hash, typed_data_hash, domain_separator, action_typehash, module, owner and expected_signer, plus the decoded order action data. Byte-compare these against your local computation to find why a signature is rejected. Requires a logged-in session; no trade scope needed.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `algo_duration_sec` | integer |  |  |
| `algo_num_slices` | integer |  |  |
| `algo_type` | enum: `twap` |  |  |
| `amount` | string (decimal) | yes | Order amount in units of the base, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `client` | string |  |  |
| `direction` | enum: `buy`, `sell` | yes |  |
| `extra_fee` | string |  | Optional builder fee for the whole order, in USDC, as a decimal string or JSON number. Each fill pays its pro-rata share. Defaults to zero. |
| `instrument_name` | string | yes |  |
| `is_atomic_signing` | boolean |  |  |
| `label` | string |  |  |
| `limit_price` | string (decimal) | yes | Limit price in quote currency, as a decimal string (e.g. `"3100.5"`) or a JSON number. |
| `max_fee` | string (decimal) | yes | Max fee per unit of volume in quote currency, as a decimal string or a JSON number. |
| `mmp` | boolean |  | Tags the order for market maker protection. Only tagged orders are cancelled by cancel on disconnect. |
| `nonce` | string | yes |  |
| `order_type` | enum: `limit`, `market` |  |  |
| `reduce_only` | boolean |  |  |
| `referral_code` | string |  |  |
| `reject_post_only` | boolean |  |  |
| `reject_timestamp` | integer |  |  |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (int64) | yes |  |
| `signer` | string | yes |  |
| `subaccount_id` | integer (int64) | yes |  |
| `time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |  |
| `trigger_price` | string |  | Trigger price as a decimal string or JSON number; omit for non-trigger orders. |
| `trigger_price_type` | enum: `mark`, `index` |  |  |
| `trigger_type` | enum: `stoploss`, `takeprofit` |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `action_hash` | string | EIP-712 struct hash of the `Action`: `keccak256(abi.encode(action_typehash, …, encoded_data_hashed, …))`. |
| `action_typehash` | string | `ACTION_TYPEHASH` — keccak of the `Action` struct type string; invariant across deployments. |
| `domain_separator` | string | EIP-712 domain separator of the Matching contract for this deployment. |
| `encoded_data` | string | ABI-encoded, module-specific action payload (the `data` bytes), 0x-hex. |
| `encoded_data_hashed` | string | `keccak256(encoded_data)` — the value packed into the struct hash. |
| `expected_signer` | string | The signer the signature is checked against. |
| `input_data` | object | The `Action` envelope a debug route rebuilt from the request inputs, plus its decoded action data — i.e. what the signature commits to. |
| `input_data.data` | object |  |
| `input_data.data.asset_address` | string |  |
| `input_data.data.asset_sub_id` | string |  |
| `input_data.data.desired_amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `input_data.data.is_bid` | boolean |  |
| `input_data.data.limit_price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `input_data.data.recipient_id` | integer (uint64) |  |
| `input_data.data.worst_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `input_data.expiry` | integer (uint64) |  |
| `input_data.module` | string |  |
| `input_data.nonce` | string |  |
| `input_data.owner` | string |  |
| `input_data.signer` | string |  |
| `input_data.subaccount_id` | integer (uint64) |  |
| `module` | string | Per-action module contract address bound into the signed struct. |
| `owner` | string | Wallet that owns the subaccount the action applies to. |
| `recovered_signer` | string | null on the debug routes (no signature is checked there); on a signature-mismatch error this is the address actually recovered. |
| `typed_data_hash` | string | Final EIP-712 digest the client signs: `keccak256(0x1901 \|\| domain_separator \|\| action_hash)`. |

### `private/order_quote`

Dry-run pricing helper that estimates the outcome of a prospective order without placing it, returning projected fill price and amount, fees, pre/post initial margin, realized PnL, resulting order status and (where relevant) liquidation price and max tradable amount. All monetary values are returned as decimal strings. The private variant requires account-level authentication.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `amount` | string (decimal) | yes | Order amount in units of the base, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `client` | string |  |  |
| `direction` | enum: `buy`, `sell` | yes | Order direction |
| `extra_fee` | string |  | Optional builder fee for the whole order, in USDC, as a decimal string or JSON number. Each fill pays its pro-rata share. Defaults to zero. |
| `instrument_name` | string | yes | Instrument name |
| `is_atomic_signing` | boolean |  |  |
| `label` | string |  |  |
| `limit_price` | string (decimal) | yes | Limit price in quote currency, as a decimal string or a JSON number. |
| `max_fee` | string (decimal) | yes | Max fee per unit of volume in quote currency, as a decimal string or a JSON number. |
| `mmp` | boolean |  |  |
| `nonce` | string | yes | Nonce. |
| `order_type` | enum: `limit`, `market` |  |  |
| `reduce_only` | boolean |  |  |
| `referral_code` | string |  |  |
| `reject_post_only` | boolean |  |  |
| `reject_timestamp` | integer (int64) |  |  |
| `signature` | string | yes | Ethereum signature of the order. |
| `signature_expiry_sec` | integer (int64) | yes | Signature expiry (unix seconds). |
| `signer` | string | yes | Owner wallet or session key that signed the order. |
| `subaccount_id` | integer (int64) | yes | Subaccount ID |
| `time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |  |
| `trigger_price` | string |  | Trigger price as a decimal string or JSON number; omit for non-trigger orders. |
| `trigger_price_type` | enum: `mark`, `index` |  |  |
| `trigger_type` | enum: `stoploss`, `takeprofit` |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `estimated_fee` | string |  |
| `estimated_fill_amount` | string |  |
| `estimated_fill_price` | string |  |
| `estimated_order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `estimated_realized_pnl` | string |  |
| `estimated_realized_pnl_excl_fees` | string |  |
| `invalid_reason` | string |  |
| `is_valid` | boolean |  |
| `max_amount` | string |  |
| `post_initial_margin` | string |  |
| `post_liquidation_price` | string |  |
| `pre_initial_margin` | string |  |
| `suggested_max_fee` | string |  |

### `private/replace`

Atomically cancels a resting order (identified by order_id_to_cancel or nonce_to_cancel) and submits a replacement order in a single request. The payload is a full new-order specification plus the cancel target and an optional expected_filled_amount guard. Requires a signed order payload and Orderbook trade scope; returns both the cancelled and the newly created order.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `algo_duration_sec` | integer |  |  |
| `algo_num_slices` | integer |  |  |
| `algo_type` | enum: `twap` |  |  |
| `amount` | string (decimal) | yes | Order amount in units of the base, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `client` | string |  |  |
| `direction` | enum: `buy`, `sell` | yes |  |
| `expected_filled_amount` | string |  | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `extra_fee` | string |  | Optional builder fee for the whole order, in USDC, as a decimal string or JSON number. Each fill pays its pro-rata share. Defaults to zero. |
| `instrument_name` | string | yes |  |
| `is_atomic_signing` | boolean |  |  |
| `label` | string |  |  |
| `limit_price` | string (decimal) | yes | Limit price in quote currency, as a decimal string (e.g. `"3100.5"`) or a JSON number. |
| `max_fee` | string (decimal) | yes | Max fee per unit of volume in quote currency, as a decimal string or a JSON number. |
| `mmp` | boolean |  | Tags the order for market maker protection. Only tagged orders are cancelled by cancel on disconnect. |
| `nonce` | string | yes |  |
| `nonce_to_cancel` | string |  |  |
| `order_id_to_cancel` | string |  | Optional UUID v4 string |
| `order_type` | enum: `limit`, `market` |  |  |
| `reduce_only` | boolean |  |  |
| `referral_code` | string |  |  |
| `reject_post_only` | boolean |  |  |
| `reject_timestamp` | integer |  |  |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (int64) | yes |  |
| `signer` | string | yes |  |
| `subaccount_id` | integer (int64) | yes |  |
| `time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |  |
| `trigger_price` | string |  | Trigger price as a decimal string or JSON number; omit for non-trigger orders. |
| `trigger_price_type` | enum: `mark`, `index` |  |  |
| `trigger_type` | enum: `stoploss`, `takeprofit` |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `cancelled_order` | object |  |
| `cancelled_order.algo_duration_sec` | integer |  |
| `cancelled_order.algo_num_slices` | integer |  |
| `cancelled_order.algo_slices_completed` | integer |  |
| `cancelled_order.algo_type` | enum: `twap` |  |
| `cancelled_order.amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_order.average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_order.cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `cancelled_order.creation_timestamp` | integer (int64) |  |
| `cancelled_order.direction` | enum: `buy`, `sell` |  |
| `cancelled_order.extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_order.filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_order.instrument_name` | string |  |
| `cancelled_order.is_transfer` | boolean |  |
| `cancelled_order.label` | string |  |
| `cancelled_order.last_update_timestamp` | integer (int64) |  |
| `cancelled_order.limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_order.max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_order.mmp` | boolean |  |
| `cancelled_order.nonce` | string |  |
| `cancelled_order.order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_order.order_id` | string |  |
| `cancelled_order.order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `cancelled_order.order_type` | enum: `limit`, `market` |  |
| `cancelled_order.quote_id` | string | Optional UUID v4 string |
| `cancelled_order.replaced_order_id` | string | Optional UUID v4 string |
| `cancelled_order.signature` | string |  |
| `cancelled_order.signature_expiry_sec` | integer (int64) |  |
| `cancelled_order.signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `cancelled_order.signer` | string |  |
| `cancelled_order.subaccount_id` | integer (int64) |  |
| `cancelled_order.time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `cancelled_order.trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `cancelled_order.trigger_price_type` | enum: `mark`, `index` |  |
| `cancelled_order.trigger_reject_message` | string |  |
| `cancelled_order.trigger_type` | enum: `stoploss`, `takeprofit` |  |
| `create_order_error` | object |  |
| `create_order_error.code` | integer (int64) |  |
| `create_order_error.data` | string |  |
| `create_order_error.message` | string |  |
| `order` | object |  |
| `order.algo_duration_sec` | integer |  |
| `order.algo_num_slices` | integer |  |
| `order.algo_slices_completed` | integer |  |
| `order.algo_type` | enum: `twap` |  |
| `order.amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `order.creation_timestamp` | integer (int64) |  |
| `order.direction` | enum: `buy`, `sell` |  |
| `order.extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.instrument_name` | string |  |
| `order.is_transfer` | boolean |  |
| `order.label` | string |  |
| `order.last_update_timestamp` | integer (int64) |  |
| `order.limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.mmp` | boolean |  |
| `order.nonce` | string |  |
| `order.order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order.order_id` | string |  |
| `order.order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `order.order_type` | enum: `limit`, `market` |  |
| `order.quote_id` | string | Optional UUID v4 string |
| `order.replaced_order_id` | string | Optional UUID v4 string |
| `order.signature` | string |  |
| `order.signature_expiry_sec` | integer (int64) |  |
| `order.signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `order.signer` | string |  |
| `order.subaccount_id` | integer (int64) |  |
| `order.time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `order.trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `order.trigger_price_type` | enum: `mark`, `index` |  |
| `order.trigger_reject_message` | string |  |
| `order.trigger_type` | enum: `stoploss`, `takeprofit` |  |
| `trades` | array |  |

### `public/order_quote`

Public dry-run variant of order_quote that estimates fill price, fees, margin impact, projected order status and realized PnL for a prospective order without placing it, returning all values as decimal strings. Unlike private/order_quote it bypasses session scope checks, so it can be used to preview costs without account authentication.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `amount` | string (decimal) | yes | Order amount in units of the base, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `client` | string |  |  |
| `direction` | enum: `buy`, `sell` | yes | Order direction |
| `extra_fee` | string |  | Optional builder fee for the whole order, in USDC, as a decimal string or JSON number. Each fill pays its pro-rata share. Defaults to zero. |
| `instrument_name` | string | yes | Instrument name |
| `is_atomic_signing` | boolean |  |  |
| `label` | string |  |  |
| `limit_price` | string (decimal) | yes | Limit price in quote currency, as a decimal string or a JSON number. |
| `max_fee` | string (decimal) | yes | Max fee per unit of volume in quote currency, as a decimal string or a JSON number. |
| `mmp` | boolean |  |  |
| `nonce` | string | yes | Nonce. |
| `order_type` | enum: `limit`, `market` |  |  |
| `reduce_only` | boolean |  |  |
| `referral_code` | string |  |  |
| `reject_post_only` | boolean |  |  |
| `reject_timestamp` | integer (int64) |  |  |
| `signature` | string | yes | Ethereum signature of the order. |
| `signature_expiry_sec` | integer (int64) | yes | Signature expiry (unix seconds). |
| `signer` | string | yes | Owner wallet or session key that signed the order. |
| `subaccount_id` | integer (int64) | yes | Subaccount ID |
| `time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |  |
| `trigger_price` | string |  | Trigger price as a decimal string or JSON number; omit for non-trigger orders. |
| `trigger_price_type` | enum: `mark`, `index` |  |  |
| `trigger_type` | enum: `stoploss`, `takeprofit` |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `estimated_fee` | string |  |
| `estimated_fill_amount` | string |  |
| `estimated_fill_price` | string |  |
| `estimated_order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `estimated_realized_pnl` | string |  |
| `estimated_realized_pnl_excl_fees` | string |  |
| `invalid_reason` | string |  |
| `is_valid` | boolean |  |
| `max_amount` | string |  |
| `post_initial_margin` | string |  |
| `post_liquidation_price` | string |  |
| `pre_initial_margin` | string |  |
| `suggested_max_fee` | string |  |

<a id="other"></a>
## Other

### `private/get_collaterals`



**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `collaterals` | object[] |  |
| `collaterals[].amount` | string |  |
| `collaterals[].amount_step` | string |  |
| `collaterals[].asset_name` | string |  |
| `collaterals[].asset_type` | string |  |
| `collaterals[].average_price` | string |  |
| `collaterals[].average_price_excl_fees` | string |  |
| `collaterals[].creation_timestamp` | integer (int64) |  |
| `collaterals[].cumulative_interest` | string |  |
| `collaterals[].currency` | string |  |
| `collaterals[].delta` | string |  |
| `collaterals[].delta_currency` | string |  |
| `collaterals[].initial_margin` | string |  |
| `collaterals[].maintenance_margin` | string |  |
| `collaterals[].mark_price` | string |  |
| `collaterals[].mark_value` | string |  |
| `collaterals[].open_orders_margin` | string |  |
| `collaterals[].pending_interest` | string |  |
| `collaterals[].realized_pnl` | string |  |
| `collaterals[].realized_pnl_excl_fees` | string |  |
| `collaterals[].total_fees` | string |  |
| `collaterals[].unrealized_pnl` | string |  |
| `collaterals[].unrealized_pnl_excl_fees` | string |  |
| `subaccount_id` | integer (uint64) |  |

### `private/get_subaccount_value_history`



**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `end_timestamp` | integer |  |  |
| `page` | integer |  |  |
| `page_size` | integer |  |  |
| `period` | integer |  |  |
| `start_timestamp` | integer |  |  |
| `subaccount_id` | integer |  |  |
| `wallet` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `subaccount_value_history` | object[] |  |
| `subaccount_value_history[].currency` | string | The manager's currencies, comma-joined; empty if it has none listed. |
| `subaccount_value_history[].initial_margin` | string (decimal) | Initial margin at the sample, positive meaning healthy. |
| `subaccount_value_history[].maintenance_margin` | string (decimal) | Maintenance margin at the sample, positive meaning healthy. |
| `subaccount_value_history[].margin_type` | string | Manager's margin model — "SM" or "PM2". |
| `subaccount_value_history[].subaccount_id` | integer (uint64) |  |
| `subaccount_value_history[].subaccount_value` | string (decimal) | Mark-to-market value, e12 fixed point on the wire as a decimal string. |
| `subaccount_value_history[].timestamp` | integer (int64) | The instant this sample is as-of, unix milliseconds. |

### `private/set_concierge_dnd`



**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | yes |  |
| `wallet` | string | yes | The session's wallet. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `concierge_dnd` | boolean |  |

<a id="referrals"></a>
## Referrals

### `public/get_all_referral_codes`

Returns every registered referral code along with the owner's wallet address and, when configured, the wallet that receives referral rewards. Takes no parameters.

**Auth:** public · **Rate class:** `non_matching`

**Params**

_none_

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `[].receiving_wallet` | string |  |
| `[].referral_code` | string |  |
| `[].wallet` | string |  |

### `public/get_referral_performance`

Returns broker-program referral performance for a referral code, identified either by the code itself or by the referrer's wallet, over a requested time window (start_ms to end_ms, capped at 28 days). The response includes total notional volume, referred fees, fee rewards, builder fees collected, the applicable fee-share percentage, and a per-role/currency/instrument-type breakdown, all as decimal strings.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `end_ms` | integer (int64) | yes | End timestamp in UTC milliseconds. |
| `referral_code` | string |  | (Optional) referral code. |
| `start_ms` | integer (int64) | yes | Start timestamp in UTC milliseconds. |
| `wallet` | string |  | (Optional) wallet of the referrer. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `fee_share_percentage` | string |  |
| `referral_code` | string |  |
| `rewards` | object | Performance by liquidity role / currency / instrument type. |
| `stdrv_balance` | string |  |
| `total_builder_fee_collected` | string |  |
| `total_fee_rewards` | string |  |
| `total_notional_volume` | string |  |
| `total_referred_fees` | string |  |

<a id="rfq"></a>
## RFQ

### `private/accept_block_proposal`

Accepts a block proposal and executes its block trade at once. The caller signs the taker side of private/execute_block_trade for its own subaccount, over the legs and prices of the proposal, in the opposite direction to the proposal's direction. Send proposal_id with the signed fields subaccount_id, nonce, signer, max_fee, signature_expiry_sec and signature. The params have no legs or direction: the exchange uses those of the proposal, so a side signed over other terms fails the signature check. The first valid accept wins. The block trade executes at the prices of the proposal, with no broker fee. Returns the proposal with status executed and its block_trade_id. A failed accept leaves the proposal open, unless the maker side can no longer execute. The proposal is then cancelled, and the accept fails with block_proposal_not_open (11118). The error of a failed accept has no details, so…

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `max_fee` | string (decimal) | yes | Highest total fee this side pays, in USD. |
| `nonce` | string | yes |  |
| `proposal_id` | string (uuid) | yes | UUID v4 string |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (int64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `block_trade_id` | string | The block trade, once the proposal executes. |
| `creation_timestamp` | integer (int64) |  |
| `currency` | string |  |
| `direction` | enum: `buy`, `sell` | The maker's direction. The taker trades the opposite. |
| `expires_at_sec` | integer (int64) | The last second (UTC) at which the proposal can be accepted. |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `listed` | boolean | Whether the proposal is on the public list. |
| `proposal_id` | string (uuid) | UUID v4 string |
| `risk_universe_id` | integer (uint32) |  |
| `status` | enum: `open`, `executing`, `executed`, `expired` \| enum: `cancelled` \| enum: `declined` |  |

### `private/cancel_batch_quotes`

Cancels all open quotes on a subaccount that match the supplied filters (any combination of quote_id, rfq_id, label, and nonce, applied together) in a single atomic operation. Omitting the optional filters targets all of the subaccount's open quotes. Returns the list of cancelled quote ids. Requires an RFQ trade scope.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `label` | string |  |  |
| `nonce` | string |  |  |
| `quote_id` | string |  | Optional UUID v4 string |
| `rfq_id` | string |  | Optional UUID v4 string |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `cancelled_ids` | string (uuid)[] |  |

### `private/cancel_batch_rfqs`

Cancels all open RFQs on a subaccount that match the supplied filters (any combination of rfq_id, label, and nonce, applied together), cascade-cancelling their quotes. Omitting the optional filters targets all of the subaccount's open RFQs. Returns the set of cancelled RFQs. Requires an RFQ trade scope.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `label` | string |  |  |
| `nonce` | string |  |  |
| `rfq_id` | string |  | Optional UUID v4 string |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `cancelled_ids` | string (uuid)[] |  |

### `private/cancel_block_proposal`

Ends an open block proposal and returns it. When the maker calls it, the status becomes cancelled. When the recipient_wallet of the proposal calls it, the status becomes declined. Only an open proposal can be cancelled or declined. After a successful call, the proposal can never execute. Fails with block_proposal_not_found (11117) if no proposal has that id, or if the caller is neither its maker nor its recipient. Fails with block_proposal_not_open (11118) if the proposal is not open, for example because it has executed or an accept is in progress. Requires the block_trade off-chain scope.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `proposal_id` | string (uuid) | yes | UUID v4 string |
| `wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `block_trade_id` | string | The block trade, once the proposal executes. |
| `creation_timestamp` | integer (int64) |  |
| `currency` | string |  |
| `direction` | enum: `buy`, `sell` | The maker's direction. The taker trades the opposite. |
| `expires_at_sec` | integer (int64) | The last second (UTC) at which the proposal can be accepted. |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `listed` | boolean | Whether the proposal is on the public list. |
| `maker_wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `proposal_id` | string (uuid) | UUID v4 string |
| `recipient_wallet` | string | The only wallet that can accept the proposal. Null if any wallet can. |
| `risk_universe_id` | integer (uint32) |  |
| `status` | enum: `open`, `executing`, `executed`, `expired` \| enum: `cancelled` \| enum: `declined` |  |

### `private/cancel_quote`

Cancels one open quote owned by the subaccount, identified by quote_id (optionally further constrained by rfq_id, label, or nonce). Returns the cancelled quote, or a quote-not-found error if it does not exist or is no longer open. Requires an RFQ trade scope.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `label` | string |  |  |
| `nonce` | string |  |  |
| `quote_id` | string (uuid) | yes | UUID v4 string |
| `rfq_id` | string |  | Optional UUID v4 string |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Settlement batch status (only for executed quotes). |
| `cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `creation_timestamp` | integer (int64) |  |
| `direction` | enum: `buy`, `sell` |  |
| `extra_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `is_transfer` | boolean |  |
| `label` | string |  |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs_hash` | string |  |
| `liquidity_role` | enum: `maker`, `taker` |  |
| `max_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp` | boolean |  |
| `nonce` | string |  |
| `quote_id` | string (uuid) | UUID v4 string |
| `rfq_id` | string (uuid) | UUID v4 string |
| `signature_expiry_sec` | integer (int64) |  |
| `status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `subaccount_id` | integer (int64) |  |
| `tx_hash` | string | Blockchain transaction hash (only for executed quotes). |

### `private/cancel_rfq`

Cancels one open RFQ owned by the given subaccount and cascade-cancels any quotes makers have submitted against it, notifying those makers. Identify the RFQ by its rfq_id. Returns "ok" on success. Requires an RFQ trade scope.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `rfq_id` | string (uuid) | yes | UUID v4 string |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

_none_

### `private/execute_block_trade`

Settles a block trade: a multi-leg trade that two parties agree off the platform, directly or through a broker. Each party signs its own side. The maker side signs the same payload as an RFQ quote and the taker side signs the same payload as an RFQ execution, over the same priced legs. Anyone who holds both signed sides can submit them, and the submitter needs no access to either subaccount. A submitter can add a broker fee to each side with extra_fee and referral_code, up to that side's signed max_fee. The trade settles at the signed prices in one atomic step. The total cost must be inside the currency's RFQ price band for both sides, as within_price_band in private/simulate_block_trade and private/verify_block_trade reports. Each leg must be at least 100 times its instrument's minimum_amount. Returns the block_trade_id and the trades of each side. Fails with block_trade_outside_price_…

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `maker_params` | object | yes | One party's side of a block trade, signed by that party. |
| `maker_params.client` | string |  |  |
| `maker_params.direction` | enum: `buy`, `sell` | yes |  |
| `maker_params.extra_fee` | string (decimal) |  | Broker fee for this side, in USD, paid to the owner of `referral_code`. It is not signed. The side's `max_fee` caps the total fee. |
| `maker_params.label` | string |  |  |
| `maker_params.legs` | object[] | yes |  |
| `maker_params.max_fee` | string (decimal) | yes | Highest total fee this side pays, in USD, including `extra_fee`. |
| `maker_params.nonce` | string | yes |  |
| `maker_params.referral_code` | string |  |  |
| `maker_params.signature` | string | yes |  |
| `maker_params.signature_expiry_sec` | integer (int64) | yes |  |
| `maker_params.signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `maker_params.subaccount_id` | integer (int64) | yes |  |
| `taker_params` | object | yes | One party's side of a block trade, signed by that party. |
| `taker_params.client` | string |  |  |
| `taker_params.direction` | enum: `buy`, `sell` | yes |  |
| `taker_params.extra_fee` | string (decimal) |  | Broker fee for this side, in USD, paid to the owner of `referral_code`. It is not signed. The side's `max_fee` caps the total fee. |
| `taker_params.label` | string |  |  |
| `taker_params.legs` | object[] | yes |  |
| `taker_params.max_fee` | string (decimal) | yes | Highest total fee this side pays, in USD, including `extra_fee`. |
| `taker_params.nonce` | string | yes |  |
| `taker_params.referral_code` | string |  |  |
| `taker_params.signature` | string | yes |  |
| `taker_params.signature_expiry_sec` | integer (int64) | yes |  |
| `taker_params.signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `taker_params.subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `block_trade_id` | string (uuid) | UUID v4 string |
| `maker_trades` | object[] |  |
| `maker_trades[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Settlement batch status; `null` if processed by sequencer. |
| `maker_trades[].block_trade_id` | string | Optional UUID v4 string |
| `maker_trades[].direction` | enum: `buy`, `sell` |  |
| `maker_trades[].expected_rebate` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_trades[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_trades[].index_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_trades[].instrument_name` | string |  |
| `maker_trades[].is_transfer` | boolean |  |
| `maker_trades[].label` | string |  |
| `maker_trades[].liquidity_role` | enum: `maker`, `taker` |  |
| `maker_trades[].mark_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_trades[].op_uuid` | string |  |
| `maker_trades[].order_id` | string |  |
| `maker_trades[].quote_id` | string | Optional UUID v4 string |
| `maker_trades[].realized_pnl` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_trades[].realized_pnl_excl_fees` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_trades[].rfq_id` | string | Optional UUID v4 string |
| `maker_trades[].subaccount_id` | integer (int64) |  |
| `maker_trades[].timestamp` | integer (int64) |  |
| `maker_trades[].trade_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_trades[].trade_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_trades[].trade_id` | string |  |
| `maker_trades[].trade_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_trades[].tx_hash` | string |  |
| `taker_trades` | object[] |  |
| `taker_trades[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Settlement batch status; `null` if processed by sequencer. |
| `taker_trades[].block_trade_id` | string | Optional UUID v4 string |
| `taker_trades[].direction` | enum: `buy`, `sell` |  |
| `taker_trades[].expected_rebate` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_trades[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_trades[].index_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_trades[].instrument_name` | string |  |
| `taker_trades[].is_transfer` | boolean |  |
| `taker_trades[].label` | string |  |
| `taker_trades[].liquidity_role` | enum: `maker`, `taker` |  |
| `taker_trades[].mark_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_trades[].op_uuid` | string |  |
| `taker_trades[].order_id` | string |  |
| `taker_trades[].quote_id` | string | Optional UUID v4 string |
| `taker_trades[].realized_pnl` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_trades[].realized_pnl_excl_fees` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_trades[].rfq_id` | string | Optional UUID v4 string |
| `taker_trades[].subaccount_id` | integer (int64) |  |
| `taker_trades[].timestamp` | integer (int64) |  |
| `taker_trades[].trade_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_trades[].trade_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_trades[].trade_id` | string |  |
| `taker_trades[].trade_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_trades[].tx_hash` | string |  |

### `private/execute_quote`

Taker-side call that accepts a specific maker quote and settles the trade atomically. You reference the rfq_id and quote_id and supply the taker's priced legs, direction, max fee, and EIP-712 signature (signer, signature, nonce, expiry), with an optional taker-protection flag. It does not check the RFQ's max_total_cost or min_total_cost. The signature is verified and the taker fill, maker quote, and RFQ are updated together in one atomic step. Requires trade scope for every instrument in the legs.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `client` | string |  |  |
| `direction` | enum: `buy`, `sell` | yes |  |
| `enable_taker_protection` | boolean |  | If true, reject the execution with `QuoteTakerCostTooHigh` when the orderbook fills the same legs at a lower total cost. The check is skipped when the orderbook cannot fill every leg in full. The RFQ's `max_total_cost` and `min_total_cost` are not checked her… |
| `label` | string |  |  |
| `legs` | object[] | yes |  |
| `legs[].amount` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` | yes |  |
| `legs[].instrument_name` | string | yes |  |
| `legs[].price` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `max_fee` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `nonce` | string | yes |  |
| `quote_id` | string (uuid) | yes | UUID v4 string |
| `referral_code` | string |  |  |
| `rfq_id` | string (uuid) | yes | UUID v4 string |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (int64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `creation_timestamp` | integer (int64) |  |
| `direction` | enum: `buy`, `sell` |  |
| `extra_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `is_transfer` | boolean |  |
| `label` | string |  |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs_hash` | string |  |
| `liquidity_role` | enum: `maker`, `taker` |  |
| `max_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp` | boolean |  |
| `nonce` | string |  |
| `quote_id` | string (uuid) | UUID v4 string |
| `rfq_filled_pct` | string (decimal) | Cumulative fraction of the RFQ filled after this execution, as a decimal string (e.g. `"0.5"` = 50% filled). |
| `rfq_id` | string (uuid) | UUID v4 string |
| `signature_expiry_sec` | integer (int64) |  |
| `status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `subaccount_id` | integer (int64) |  |

### `private/get_block_proposals`

Returns the block proposals that the wallet made or received as recipient_wallet: the open ones and those that ended recently, most recently updated first. Each proposal shows maker_wallet, recipient_wallet, the maker's direction and the priced legs. The taker trades the opposite direction. status is open, executing (an accept is in progress), executed (block_trade_id identifies the block trade), cancelled (by the maker), declined (by the recipient) or expired. A proposal can be accepted until expires_at_sec (UTC seconds). Requires the block_trade off-chain scope.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `proposals` | object[] |  |
| `proposals[].block_trade_id` | string | The block trade, once the proposal executes. |
| `proposals[].creation_timestamp` | integer (int64) |  |
| `proposals[].currency` | string |  |
| `proposals[].direction` | enum: `buy`, `sell` | The maker's direction. The taker trades the opposite. |
| `proposals[].expires_at_sec` | integer (int64) | The last second (UTC) at which the proposal can be accepted. |
| `proposals[].last_update_timestamp` | integer (int64) |  |
| `proposals[].legs` | object[] |  |
| `proposals[].legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `proposals[].legs[].direction` | enum: `buy`, `sell` |  |
| `proposals[].legs[].instrument_name` | string |  |
| `proposals[].legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `proposals[].listed` | boolean | Whether the proposal is on the public list. |
| `proposals[].maker_wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `proposals[].proposal_id` | string (uuid) | UUID v4 string |
| `proposals[].recipient_wallet` | string | The only wallet that can accept the proposal. Null if any wallet can. |
| `proposals[].risk_universe_id` | integer (uint32) |  |
| `proposals[].status` | enum: `open`, `executing`, `executed`, `expired` \| enum: `cancelled` \| enum: `declined` |  |

### `private/get_block_trade`

Returns the caller's side of one block trade, by block_trade_id, for a wallet or one of its subaccounts: the block's time, the caller's liquidity role and the caller's trades, one per leg, in the private/get_trade_history shape with their batch status and tx_hash. Fails with a block-trade-not-found error if no trade of the wallet or subaccount has that id. A session key restricted to some subaccounts sees only their blocks.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `block_trade_id` | string (uuid) | yes | The `block_trade_id` of the block's trades. |
| `subaccount_id` | integer |  |  |
| `wallet` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `block_trade_id` | string (uuid) | UUID v4 string |
| `liquidity_role` | enum: `maker`, `taker` |  |
| `timestamp` | integer (int64) |  |
| `trades` | object[] | One trade per leg. |
| `trades[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` |  |
| `trades[].block_trade_id` | string | Optional UUID v4 string |
| `trades[].direction` | enum: `buy`, `sell` |  |
| `trades[].expected_rebate` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].index_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].instrument_name` | string |  |
| `trades[].is_transfer` | boolean |  |
| `trades[].label` | string |  |
| `trades[].liquidity_role` | enum: `maker`, `taker` |  |
| `trades[].mark_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].op_uuid` | string |  |
| `trades[].order_id` | string |  |
| `trades[].quote_id` | string | Optional UUID v4 string |
| `trades[].realized_pnl` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].realized_pnl_excl_fees` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].rfq_id` | string | Optional UUID v4 string |
| `trades[].subaccount_id` | integer (int64) |  |
| `trades[].timestamp` | integer (int64) |  |
| `trades[].trade_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].trade_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].trade_id` | string |  |
| `trades[].trade_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trades[].tx_hash` | string |  |

### `private/get_block_trades`

Returns a paginated history of the caller's block trades for a wallet or one of its subaccounts, newest first. Pages count blocks, not trades. Each block has its time, the caller's liquidity role and the caller's trades, one per leg, in the private/get_trade_history shape. Optional filters: a time window, an instrument name and a direction. A block matches the instrument filter if it has a trade in that instrument, and the direction filter if any of the caller's trades has that direction. A matching block returns all of its trades. A session key restricted to some subaccounts sees only their blocks.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `direction` | enum: `buy`, `sell` |  | Returns the blocks in which any of the caller's trades has this direction. |
| `from_timestamp` | integer |  |  |
| `instrument_name` | string |  | Returns the blocks with a trade in this instrument. |
| `page` | integer |  |  |
| `page_size` | integer |  |  |
| `subaccount_id` | integer |  |  |
| `to_timestamp` | integer |  |  |
| `wallet` | string |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `block_trades` | object[] |  |
| `block_trades[].block_trade_id` | string (uuid) | UUID v4 string |
| `block_trades[].liquidity_role` | enum: `maker`, `taker` |  |
| `block_trades[].timestamp` | integer (int64) |  |
| `block_trades[].trades` | object[] | One trade per leg. |
| `block_trades[].trades[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` |  |
| `block_trades[].trades[].block_trade_id` | string | Optional UUID v4 string |
| `block_trades[].trades[].direction` | enum: `buy`, `sell` |  |
| `block_trades[].trades[].expected_rebate` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `block_trades[].trades[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `block_trades[].trades[].index_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `block_trades[].trades[].instrument_name` | string |  |
| `block_trades[].trades[].is_transfer` | boolean |  |
| `block_trades[].trades[].label` | string |  |
| `block_trades[].trades[].liquidity_role` | enum: `maker`, `taker` |  |
| `block_trades[].trades[].mark_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `block_trades[].trades[].op_uuid` | string |  |
| `block_trades[].trades[].order_id` | string |  |
| `block_trades[].trades[].quote_id` | string | Optional UUID v4 string |
| `block_trades[].trades[].realized_pnl` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `block_trades[].trades[].realized_pnl_excl_fees` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `block_trades[].trades[].rfq_id` | string | Optional UUID v4 string |
| `block_trades[].trades[].subaccount_id` | integer (int64) |  |
| `block_trades[].trades[].timestamp` | integer (int64) |  |
| `block_trades[].trades[].trade_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `block_trades[].trades[].trade_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `block_trades[].trades[].trade_id` | string |  |
| `block_trades[].trades[].trade_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `block_trades[].trades[].tx_hash` | string |  |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |

### `private/get_maker_rfq_history`

Maker-side history of RFQs the subaccount was eligible to quote, i.e. RFQs open to all makers or naming the maker's wallet as a counterparty, including ones the maker never quoted. Returns filled, cancelled and expired RFQs only; use private/poll_rfqs for open ones. Supports filtering by rfq_id, status, an originating RFQ subaccount, and an RFQ creation-time window, with pagination. Without from_timestamp, the window covers the 30 days before to_timestamp (or before now). Newest RFQs first. Returns the same public RFQ view as private/poll_rfqs, with fill rates unset. An RFQ appears here a few seconds after it leaves private/poll_rfqs.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `from_timestamp` | integer |  | Start of the RFQ creation-time window, in ms. Defaults to 30 days before the earlier of `to_timestamp` and now. |
| `page` | integer (uint64) |  |  |
| `page_size` | integer (uint64) |  |  |
| `rfq_id` | string |  |  |
| `rfq_subaccount_id` | integer |  | Only RFQs sent from this taker subaccount. |
| `status` | enum: `open`, `filled`, `cancelled`, `expired` |  | `filled`, `cancelled` or `expired`. Omit for all three. |
| `subaccount_id` | integer (int64) | yes |  |
| `to_timestamp` | integer (int64) |  | End of the RFQ creation-time window, in ms. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `rfqs` | object[] |  |
| `rfqs[].cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `rfqs[].creation_timestamp` | integer (int64) |  |
| `rfqs[].fill_rate` | string | Lifetime taker fill rate as a decimal string; null until the wallet has enough lifetime RFQs for the rate to be meaningful. |
| `rfqs[].filled_direction` | enum: `buy`, `sell` |  |
| `rfqs[].filled_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `rfqs[].last_update_timestamp` | integer (int64) |  |
| `rfqs[].legs` | object[] |  |
| `rfqs[].legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `rfqs[].legs[].direction` | enum: `buy`, `sell` |  |
| `rfqs[].legs[].instrument_name` | string |  |
| `rfqs[].partial_fill_step` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `rfqs[].recent_fill_rate` | string | Decayed-recent taker fill rate as a decimal string; null until enough recent RFQ activity has accumulated for the rate to be meaningful. |
| `rfqs[].rfq_id` | string (uuid) | UUID v4 string |
| `rfqs[].status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `rfqs[].subaccount_id` | integer (int64) |  |
| `rfqs[].total_cost` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `rfqs[].valid_until` | integer (int64) |  |
| `rfqs[].wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

### `private/get_quotes`

Returns a paginated, merged view of a subaccount's quotes, combining currently open quotes with the archived history of filled, cancelled, and expired ones. Supports filtering by quote_id, rfq_id, status, and a from/to timestamp window, with page and page_size controls. Each entry includes priced legs, direction, fees, liquidity role, and fill percentage.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `from_timestamp` | integer (int64) |  |  |
| `page` | integer (uint64) |  |  |
| `page_size` | integer (uint64) |  |  |
| `quote_id` | string |  |  |
| `rfq_id` | string |  |  |
| `status` | string |  |  |
| `subaccount_id` | integer (int64) | yes |  |
| `to_timestamp` | integer (int64) |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `quotes` | object[] |  |
| `quotes[].batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Settlement batch status (only for executed quotes). |
| `quotes[].cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `quotes[].creation_timestamp` | integer (int64) |  |
| `quotes[].direction` | enum: `buy`, `sell` |  |
| `quotes[].extra_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quotes[].fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quotes[].fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quotes[].is_transfer` | boolean |  |
| `quotes[].label` | string |  |
| `quotes[].last_update_timestamp` | integer (int64) |  |
| `quotes[].legs` | object[] |  |
| `quotes[].legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quotes[].legs[].direction` | enum: `buy`, `sell` |  |
| `quotes[].legs[].instrument_name` | string |  |
| `quotes[].legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quotes[].legs_hash` | string |  |
| `quotes[].liquidity_role` | enum: `maker`, `taker` |  |
| `quotes[].max_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quotes[].mmp` | boolean |  |
| `quotes[].nonce` | string |  |
| `quotes[].quote_id` | string (uuid) | UUID v4 string |
| `quotes[].rfq_id` | string (uuid) | UUID v4 string |
| `quotes[].signature_expiry_sec` | integer (int64) |  |
| `quotes[].status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `quotes[].subaccount_id` | integer (int64) |  |
| `quotes[].tx_hash` | string | Blockchain transaction hash (only for executed quotes). |

### `private/get_rfqs`

Returns a paginated, merged view of a subaccount's RFQs, combining currently open RFQs with the archived history of filled, cancelled, and expired ones. Supports filtering by rfq_id, status, and a from/to timestamp window, with page and page_size controls. Each entry includes legs, status, timestamps, cost bounds, and fill percentage.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `from_timestamp` | integer (int64) |  |  |
| `page` | integer (uint64) |  |  |
| `page_size` | integer (uint64) |  |  |
| `rfq_id` | string |  |  |
| `status` | string |  |  |
| `subaccount_id` | integer (int64) | yes |  |
| `to_timestamp` | integer (int64) |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `rfqs` | object[] |  |
| `rfqs[].ask_total_cost` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `rfqs[].bid_total_cost` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `rfqs[].cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `rfqs[].counterparties` | array |  |
| `rfqs[].creation_timestamp` | integer (int64) |  |
| `rfqs[].filled_direction` | enum: `buy`, `sell` |  |
| `rfqs[].filled_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `rfqs[].label` | string |  |
| `rfqs[].last_update_timestamp` | integer (int64) |  |
| `rfqs[].legs` | object[] |  |
| `rfqs[].legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `rfqs[].legs[].direction` | enum: `buy`, `sell` |  |
| `rfqs[].legs[].instrument_name` | string |  |
| `rfqs[].mark_total_cost` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `rfqs[].max_total_cost` | string | The `max_total_cost` sent with the RFQ, as a decimal string, or null. It filters the best quote only. See `private/send_rfq`. |
| `rfqs[].min_total_cost` | string | The `min_total_cost` sent with the RFQ, as a decimal string, or null. It filters the best quote only. See `private/send_rfq`. |
| `rfqs[].partial_fill_step` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `rfqs[].rfq_id` | string (uuid) | UUID v4 string |
| `rfqs[].status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `rfqs[].subaccount_id` | integer (int64) |  |
| `rfqs[].total_cost` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `rfqs[].valid_until` | integer (int64) |  |
| `rfqs[].wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

### `private/invalidate_block_trade_signature`

Invalidates a signed block-trade side of the given subaccount, identified by its nonce, so that private/execute_block_trade rejects it. The nonce can be at most one hour ahead of the server clock. Fails with a non-unique-nonce error if the side has already executed or its execution is in progress. In rare cases an invalidated side can still execute until its window ends: five minutes after its nonce time, or 59 minutes for a side sent as a block proposal. Returns "ok" on success. Requires the block_trade off-chain scope.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `nonce` | string | yes | The `nonce` of the signed side. |
| `subaccount_id` | integer (uint64) | yes | The subaccount of the signed side. |

**Result**

_none_

### `private/poll_quotes`

Taker-side call that lists the maker quotes received against RFQs owned by the subaccount. Supports filtering by quote_id, rfq_id, status, and a timestamp window, with pagination. Returns public quote views (including the maker's wallet) without any signing material.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `from_timestamp` | integer (int64) |  |  |
| `page` | integer (uint64) |  |  |
| `page_size` | integer (uint64) |  |  |
| `quote_id` | string |  |  |
| `rfq_id` | string |  |  |
| `status` | string |  |  |
| `subaccount_id` | integer (int64) | yes |  |
| `to_timestamp` | integer (int64) |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `quotes` | object[] |  |
| `quotes[].cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `quotes[].creation_timestamp` | integer (int64) |  |
| `quotes[].direction` | enum: `buy`, `sell` |  |
| `quotes[].fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quotes[].last_update_timestamp` | integer (int64) |  |
| `quotes[].legs` | object[] |  |
| `quotes[].legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quotes[].legs[].direction` | enum: `buy`, `sell` |  |
| `quotes[].legs[].instrument_name` | string |  |
| `quotes[].legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quotes[].legs_hash` | string |  |
| `quotes[].liquidity_role` | enum: `maker`, `taker` |  |
| `quotes[].quote_id` | string (uuid) | UUID v4 string |
| `quotes[].rfq_id` | string (uuid) | UUID v4 string |
| `quotes[].status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `quotes[].subaccount_id` | integer (int64) |  |
| `quotes[].wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

### `private/poll_rfqs`

Maker-side call that lists the RFQs a subaccount is eligible to quote, i.e. RFQs that are open to all makers or that name the maker's wallet as a counterparty. Supports filtering by rfq_id, status, an originating RFQ subaccount, and a timestamp window, with pagination. Returns public RFQ views without taker-private signing material.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `from_timestamp` | integer (int64) |  |  |
| `page` | integer (uint64) |  |  |
| `page_size` | integer (uint64) |  |  |
| `rfq_id` | string |  |  |
| `rfq_subaccount_id` | integer |  |  |
| `status` | string |  |  |
| `subaccount_id` | integer (int64) | yes |  |
| `to_timestamp` | integer (int64) |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `rfqs` | object[] |  |
| `rfqs[].cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `rfqs[].creation_timestamp` | integer (int64) |  |
| `rfqs[].fill_rate` | string | Lifetime taker fill rate as a decimal string; null until the wallet has enough lifetime RFQs for the rate to be meaningful. |
| `rfqs[].filled_direction` | enum: `buy`, `sell` |  |
| `rfqs[].filled_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `rfqs[].last_update_timestamp` | integer (int64) |  |
| `rfqs[].legs` | object[] |  |
| `rfqs[].legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `rfqs[].legs[].direction` | enum: `buy`, `sell` |  |
| `rfqs[].legs[].instrument_name` | string |  |
| `rfqs[].partial_fill_step` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `rfqs[].recent_fill_rate` | string | Decayed-recent taker fill rate as a decimal string; null until enough recent RFQ activity has accumulated for the rate to be meaningful. |
| `rfqs[].rfq_id` | string (uuid) | UUID v4 string |
| `rfqs[].status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `rfqs[].subaccount_id` | integer (int64) |  |
| `rfqs[].total_cost` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `rfqs[].valid_until` | integer (int64) |  |
| `rfqs[].wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

### `private/replace_quote`

Maker-side call that atomically cancels an existing quote and submits a new signed quote for the same RFQ in one operation. You provide the new priced legs, direction, max fee, and EIP-712 signature, plus the quote to cancel (by quote_id or nonce_to_cancel). Returns the cancellation result together with the newly created quote. Requires trade scope for every instrument quoted.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `client` | string |  |  |
| `direction` | enum: `buy`, `sell` | yes |  |
| `extra_fee` | string (decimal) |  | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `label` | string |  |  |
| `legs` | object[] | yes |  |
| `legs[].amount` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` | yes |  |
| `legs[].instrument_name` | string | yes |  |
| `legs[].price` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `max_fee` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp` | boolean |  |  |
| `nonce` | string | yes |  |
| `nonce_to_cancel` | string |  |  |
| `quote_id_to_cancel` | string |  | Optional UUID v4 string |
| `referral_code` | string |  |  |
| `rfq_id` | string (uuid) | yes | UUID v4 string |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (int64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `cancelled_quote` | object |  |
| `cancelled_quote.batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Settlement batch status (only for executed quotes). |
| `cancelled_quote.cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `cancelled_quote.creation_timestamp` | integer (int64) |  |
| `cancelled_quote.direction` | enum: `buy`, `sell` |  |
| `cancelled_quote.extra_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_quote.fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_quote.fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_quote.is_transfer` | boolean |  |
| `cancelled_quote.label` | string |  |
| `cancelled_quote.last_update_timestamp` | integer (int64) |  |
| `cancelled_quote.legs` | object[] |  |
| `cancelled_quote.legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_quote.legs[].direction` | enum: `buy`, `sell` |  |
| `cancelled_quote.legs[].instrument_name` | string |  |
| `cancelled_quote.legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_quote.legs_hash` | string |  |
| `cancelled_quote.liquidity_role` | enum: `maker`, `taker` |  |
| `cancelled_quote.max_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancelled_quote.mmp` | boolean |  |
| `cancelled_quote.nonce` | string |  |
| `cancelled_quote.quote_id` | string (uuid) | UUID v4 string |
| `cancelled_quote.rfq_id` | string (uuid) | UUID v4 string |
| `cancelled_quote.signature_expiry_sec` | integer (int64) |  |
| `cancelled_quote.status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `cancelled_quote.subaccount_id` | integer (int64) |  |
| `cancelled_quote.tx_hash` | string | Blockchain transaction hash (only for executed quotes). |
| `create_quote_error` | object |  |
| `create_quote_error.code` | integer (int64) |  |
| `create_quote_error.data` | string |  |
| `create_quote_error.message` | string |  |
| `quote` | object |  |
| `quote.batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Settlement batch status (only for executed quotes). |
| `quote.cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `quote.creation_timestamp` | integer (int64) |  |
| `quote.direction` | enum: `buy`, `sell` |  |
| `quote.extra_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quote.fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quote.fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quote.is_transfer` | boolean |  |
| `quote.label` | string |  |
| `quote.last_update_timestamp` | integer (int64) |  |
| `quote.legs` | object[] |  |
| `quote.legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quote.legs[].direction` | enum: `buy`, `sell` |  |
| `quote.legs[].instrument_name` | string |  |
| `quote.legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quote.legs_hash` | string |  |
| `quote.liquidity_role` | enum: `maker`, `taker` |  |
| `quote.max_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `quote.mmp` | boolean |  |
| `quote.nonce` | string |  |
| `quote.quote_id` | string (uuid) | UUID v4 string |
| `quote.rfq_id` | string (uuid) | UUID v4 string |
| `quote.signature_expiry_sec` | integer (int64) |  |
| `quote.status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `quote.subaccount_id` | integer (int64) |  |
| `quote.tx_hash` | string | Blockchain transaction hash (only for executed quotes). |

### `private/rfq_get_best_quote`

Taker-side dry run that evaluates a prospective RFQ (its legs and intended direction) without creating anything. Returns the best available maker quote if one exists. It returns no quote when the best quote breaks the RFQ's max_total_cost or min_total_cost. The response also includes the expected fee, validity, projected liquidation prices, and realized-PnL estimate for taking it.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `client` | string |  |  |
| `direction` | enum: `buy`, `sell` |  |  |
| `extra_fee` | string (decimal) |  | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs` | object[] |  |  |
| `legs[].amount` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` | yes |  |
| `legs[].instrument_name` | string | yes |  |
| `rfq_id` | string |  | RFQ ID to get best quote for. If not provided, will return estimates based on mark prices. |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `best_quote` | object |  |
| `best_quote.cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `best_quote.creation_timestamp` | integer (int64) |  |
| `best_quote.direction` | enum: `buy`, `sell` |  |
| `best_quote.fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `best_quote.last_update_timestamp` | integer (int64) |  |
| `best_quote.legs` | object[] |  |
| `best_quote.legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `best_quote.legs[].direction` | enum: `buy`, `sell` |  |
| `best_quote.legs[].instrument_name` | string |  |
| `best_quote.legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `best_quote.legs_hash` | string |  |
| `best_quote.liquidity_role` | enum: `maker`, `taker` |  |
| `best_quote.quote_id` | string (uuid) | UUID v4 string |
| `best_quote.rfq_id` | string (uuid) | UUID v4 string |
| `best_quote.status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `best_quote.subaccount_id` | integer (int64) |  |
| `best_quote.wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `direction` | enum: `buy`, `sell` |  |
| `down_liquidation_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `estimated_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `estimated_realized_pnl` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `estimated_realized_pnl_excl_fees` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `estimated_total_cost` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `filled_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `invalid_reason` | string |  |
| `is_valid` | boolean |  |
| `orderbook_total_cost` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `post_initial_margin` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `post_liquidation_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `pre_initial_margin` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `suggested_max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `up_liquidation_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |

### `private/send_block_proposal`

Posts the caller's signed maker side of a block trade as a block proposal, for a taker to accept with private/accept_block_proposal. The side is signed as the maker side of private/execute_block_trade. The exchange keeps the signature, and no other user can see it. With recipient_wallet, only that wallet can see and accept the proposal. With listed true, the proposal is on the public list that public/get_block_proposals returns, and anyone can accept it. With neither, anyone who has the proposal_id can read and accept the proposal, so share the id only with the intended counterparty. A listed proposal cannot have a recipient_wallet. The proposal can be accepted while the signed side can execute: until 60 seconds before its signature_expiry_sec, or 59 minutes after its nonce time, whichever is first. The response gives that time as expires_at_sec. So the signed signature_expiry_sec sets…

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `direction` | enum: `buy`, `sell` | yes |  |
| `legs` | object[] | yes |  |
| `legs[].amount` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` | yes |  |
| `legs[].instrument_name` | string | yes |  |
| `legs[].price` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `listed` | boolean |  | Whether the proposal is on the public list. |
| `max_fee` | string (decimal) | yes | Highest total fee this side pays, in USD. |
| `nonce` | string | yes |  |
| `recipient_wallet` | string |  | The only wallet that can see and accept the proposal. Not allowed with `listed`. |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (int64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `block_trade_id` | string | The block trade, once the proposal executes. |
| `creation_timestamp` | integer (int64) |  |
| `currency` | string |  |
| `direction` | enum: `buy`, `sell` | The maker's direction. The taker trades the opposite. |
| `expires_at_sec` | integer (int64) | The last second (UTC) at which the proposal can be accepted. |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `listed` | boolean | Whether the proposal is on the public list. |
| `maker_wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `proposal_id` | string (uuid) | UUID v4 string |
| `recipient_wallet` | string | The only wallet that can accept the proposal. Null if any wallet can. |
| `risk_universe_id` | integer (uint32) |  |
| `status` | enum: `open`, `executing`, `executed`, `expired` \| enum: `cancelled` \| enum: `declined` |  |

### `private/send_quote`

Maker-side call that submits a priced, signed quote in response to an existing RFQ. You provide the priced legs, direction, max fee, an EIP-712 signature (signer, signature, nonce, expiry), and optional label or MMP flag. The quote's signature is verified and validated against the referenced RFQ before it is stored. Returns the created quote. Requires trade scope for every instrument quoted.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `endpoint`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `client` | string |  |  |
| `direction` | enum: `buy`, `sell` | yes |  |
| `extra_fee` | string (decimal) |  | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `label` | string |  |  |
| `legs` | object[] | yes |  |
| `legs[].amount` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` | yes |  |
| `legs[].instrument_name` | string | yes |  |
| `legs[].price` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `max_fee` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp` | boolean |  |  |
| `nonce` | string | yes |  |
| `referral_code` | string |  |  |
| `rfq_id` | string (uuid) | yes | UUID v4 string |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (int64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Settlement batch status (only for executed quotes). |
| `cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `creation_timestamp` | integer (int64) |  |
| `direction` | enum: `buy`, `sell` |  |
| `extra_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `is_transfer` | boolean |  |
| `label` | string |  |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs_hash` | string |  |
| `liquidity_role` | enum: `maker`, `taker` |  |
| `max_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp` | boolean |  |
| `nonce` | string |  |
| `quote_id` | string (uuid) | UUID v4 string |
| `rfq_id` | string (uuid) | UUID v4 string |
| `signature_expiry_sec` | integer (int64) |  |
| `status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `subaccount_id` | integer (int64) |  |
| `tx_hash` | string | Blockchain transaction hash (only for executed quotes). |

### `private/send_rfq`

Taker-side call that opens a new RFQ for a multi-leg structure on a subaccount, inviting makers to quote it. You supply the legs (instrument, amount, and direction per leg) plus optional min/max total cost limits that filter only the best quote, a partial-fill step, a label, and a list of specific counterparties to restrict who can see it. Returns the created RFQ including its assigned id and validity window. Requires trade scope for every instrument in the legs.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `client` | string |  |  |
| `counterparties` | array |  |  |
| `extra_fee` | string (decimal) |  | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `label` | string |  |  |
| `legs` | object[] | yes |  |
| `legs[].amount` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` | yes |  |
| `legs[].instrument_name` | string | yes |  |
| `max_total_cost` | string |  | Highest total cost you accept when you execute as buyer (`direction: buy`). Optional decimal string (e.g. `"500"`) or JSON number. Total cost is in USD for the full RFQ size, from your side of the trade. A positive cost means you pay. A negative cost means yo… |
| `min_total_cost` | string |  | Highest total cost you accept when you execute as seller (`direction: sell`). Optional decimal string (e.g. `"-180"`) or JSON number. It uses the same sign as `max_total_cost`, so a sale that pays you has a negative cost. To set the smallest amount you will r… |
| `partial_fill_step` | string (decimal) |  | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `referral_code` | string |  |  |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `ask_total_cost` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `bid_total_cost` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `counterparties` | array |  |
| `creation_timestamp` | integer (int64) |  |
| `filled_direction` | enum: `buy`, `sell` |  |
| `filled_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `label` | string |  |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `mark_total_cost` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `max_total_cost` | string | The `max_total_cost` sent with the RFQ, as a decimal string, or null. It filters the best quote only. See `private/send_rfq`. |
| `min_total_cost` | string | The `min_total_cost` sent with the RFQ, as a decimal string, or null. It filters the best quote only. See `private/send_rfq`. |
| `partial_fill_step` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `rfq_id` | string (uuid) | UUID v4 string |
| `status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `subaccount_id` | integer (int64) |  |
| `total_cost` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `valid_until` | integer (int64) |  |
| `wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

### `private/simulate_block_trade`

Estimates one side of a block trade for the caller's subaccount before it is signed. Takes the side's direction, the agreed priced legs and an optional extra_fee. Returns the total fee the side would pay, extra_fee included, its initial margin before and after the trade, and within_price_band, which is whether the total cost is inside the currency's RFQ price band for both sides, or null if the currency has no band. Also returns price_band_min_total_cost and price_band_max_total_cost, the lowest and highest total cost at which this side is inside the band. Fails with invalid_amount (11012) if a leg is smaller than 100 times its instrument's minimum_amount. A side without enough margin returns is_valid false and the reason, not an error. Requires the block_trade off-chain scope.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `direction` | enum: `buy`, `sell` | yes | This side's direction. The taker side trades opposite the maker side. |
| `extra_fee` | string (decimal) |  | Broker fee for this side, in USD. |
| `legs` | object[] | yes | The agreed priced legs, the same on both sides. |
| `legs[].amount` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` | yes |  |
| `legs[].instrument_name` | string | yes |  |
| `legs[].price` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `estimated_fee` | string (decimal) | The side's total fee, `extra_fee` included. |
| `expires_at_sec` | integer | The last second at which the signed side can execute. Null for an unsigned side. |
| `invalid_reason` | string |  |
| `is_valid` | boolean | False if the side does not have enough margin for its trade and fees, or if the trade takes the subaccount over its maximum asset count. |
| `post_initial_margin` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `pre_initial_margin` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `price_band_max_total_cost` | string | The highest total cost at which this side is within the RFQ price band, as a decimal string. Null if the currency has no band. |
| `price_band_min_total_cost` | string | The lowest total cost at which this side is within the RFQ price band, as a decimal string. A negative cost means the side receives. Null if the currency has no band. |
| `within_price_band` | boolean | Whether both sides are within the currency's RFQ price band. Null if it has no band. |

### `private/verify_block_trade`

Checks one signed side of a block trade for the caller's subaccount, as private/execute_block_trade would check it now: its signature, nonce and signature lifetime. Takes the signed side in the private/execute_block_trade shape and its role, maker or taker. Returns the total fee the side would pay, its initial margin before and after the trade, expires_at_sec, the last second at which the side can execute, and within_price_band, which is whether the total cost is inside the currency's RFQ price band for both sides, or null if the currency has no band. Also returns price_band_min_total_cost and price_band_max_total_cost, the lowest and highest total cost at which this side is inside the band. Fails with invalid_amount (11012) if a leg is smaller than 100 times its instrument's minimum_amount. A side without enough margin returns is_valid false and the reason, not an error. The side stays…

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `client` | string |  |  |
| `direction` | enum: `buy`, `sell` | yes |  |
| `extra_fee` | string (decimal) |  | Broker fee for this side, in USD, paid to the owner of `referral_code`. It is not signed. The side's `max_fee` caps the total fee. |
| `label` | string |  |  |
| `legs` | object[] | yes |  |
| `legs[].amount` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` | yes |  |
| `legs[].instrument_name` | string | yes |  |
| `legs[].price` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `max_fee` | string (decimal) | yes | Highest total fee this side pays, in USD, including `extra_fee`. |
| `nonce` | string | yes |  |
| `referral_code` | string |  |  |
| `role` | enum: `maker`, `taker` | yes | The payload this side signed: `maker` (a quote) or `taker` (an execution). |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (int64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (int64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `estimated_fee` | string (decimal) | The side's total fee, `extra_fee` included. |
| `expires_at_sec` | integer | The last second at which the signed side can execute. Null for an unsigned side. |
| `invalid_reason` | string |  |
| `is_valid` | boolean | False if the side does not have enough margin for its trade and fees, or if the trade takes the subaccount over its maximum asset count. |
| `post_initial_margin` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `pre_initial_margin` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `price_band_max_total_cost` | string | The highest total cost at which this side is within the RFQ price band, as a decimal string. Null if the currency has no band. |
| `price_band_min_total_cost` | string | The lowest total cost at which this side is within the RFQ price band, as a decimal string. A negative cost means the side receives. Null if the currency has no band. |
| `within_price_band` | boolean | Whether both sides are within the currency's RFQ price band. Null if it has no band. |

### `public/execute_quote_debug`

Public signing-preview helper that returns the taker's EIP-712 encoding artifacts (encoded data and hashes) plus the maker-side encoded legs and legs hash for a quote execution a client is about to sign. It does not verify signatures, persist anything, or execute the trade; use it to construct and check the exact payload before calling private/execute_quote.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `direction` | enum: `buy`, `sell` | yes |  |
| `legs` | object[] | yes |  |
| `legs[].amount` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` | yes |  |
| `legs[].instrument_name` | string | yes |  |
| `legs[].price` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `max_fee` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `nonce` | string | yes |  |
| `quote_id` | string (uuid) | yes | UUID v4 string |
| `rfq_id` | string (uuid) | yes | UUID v4 string |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (int64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `action_hash` | string |  |
| `encoded_data` | string |  |
| `encoded_data_hashed` | string |  |
| `encoded_legs` | string |  |
| `legs_hash` | string |  |
| `typed_data_hash` | string |  |

### `public/get_block_proposal`

Returns one block proposal by its proposal_id, listed or not, in the public/get_block_proposals shape. It never shows a wallet, a subaccount or a signature. A proposal stays readable for some time after it ends, with its final status. A proposal with a recipient_wallet is not returned: its maker and its recipient read it with private/get_block_proposals. Fails with block_proposal_not_found (11117) if no proposal has that id, or if the proposal has a recipient_wallet.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `proposal_id` | string (uuid) | yes | UUID v4 string |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `block_trade_id` | string | The block trade, once the proposal executes. |
| `creation_timestamp` | integer (int64) |  |
| `currency` | string |  |
| `direction` | enum: `buy`, `sell` | The maker's direction. The taker trades the opposite. |
| `expires_at_sec` | integer (int64) | The last second (UTC) at which the proposal can be accepted. |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `listed` | boolean | Whether the proposal is on the public list. |
| `proposal_id` | string (uuid) | UUID v4 string |
| `risk_universe_id` | integer (uint32) |  |
| `status` | enum: `open`, `executing`, `executed`, `expired` \| enum: `cancelled` \| enum: `declined` |  |

### `public/get_block_proposals`

Returns the listed block proposals: those that have not ended, then those that ended recently. Each group has the most recently updated first. Pass currency to return the proposals of one currency. Each proposal shows the maker's direction, the priced legs, its status and expires_at_sec. It never shows a wallet, a subaccount or a signature. Accept an open proposal with private/accept_block_proposal.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `currency` | string |  | Returns only the proposals of this currency (e.g. `ETH`). |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `proposals` | object[] |  |
| `proposals[].block_trade_id` | string | The block trade, once the proposal executes. |
| `proposals[].creation_timestamp` | integer (int64) |  |
| `proposals[].currency` | string |  |
| `proposals[].direction` | enum: `buy`, `sell` | The maker's direction. The taker trades the opposite. |
| `proposals[].expires_at_sec` | integer (int64) | The last second (UTC) at which the proposal can be accepted. |
| `proposals[].last_update_timestamp` | integer (int64) |  |
| `proposals[].legs` | object[] |  |
| `proposals[].legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `proposals[].legs[].direction` | enum: `buy`, `sell` |  |
| `proposals[].legs[].instrument_name` | string |  |
| `proposals[].legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `proposals[].listed` | boolean | Whether the proposal is on the public list. |
| `proposals[].proposal_id` | string (uuid) | UUID v4 string |
| `proposals[].risk_universe_id` | integer (uint32) |  |
| `proposals[].status` | enum: `open`, `executing`, `executed`, `expired` \| enum: `cancelled` \| enum: `declined` |  |

### `public/send_quote_debug`

Public signing-preview helper that returns the EIP-712 encoding artifacts (encoded data, its hash, the action hash, and the typed-data hash) for a maker quote a client is about to sign. It does not verify signatures, persist anything, or place a quote; use it to construct and check the exact payload to sign before calling private/send_quote.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `direction` | enum: `buy`, `sell` | yes |  |
| `legs` | object[] | yes |  |
| `legs[].amount` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` | yes |  |
| `legs[].instrument_name` | string | yes |  |
| `legs[].price` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `max_fee` | string (decimal) | yes | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `nonce` | string | yes |  |
| `rfq_id` | string (uuid) | yes | UUID v4 string |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (int64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `action_hash` | string |  |
| `encoded_data` | string |  |
| `encoded_data_hashed` | string |  |
| `typed_data_hash` | string |  |

<a id="session-keys"></a>
## Session Keys

### `private/edit_session_key`

Updates an existing session key's label, IP allowlist, and/or off-chain scopes for a given wallet; it cannot change on-chain (protocol) scopes, for which you must re-register with private/set_session_key. Editing only the label needs account-info permission, while changing the IP allowlist or off-chain scopes requires admin/owner authorization. Returns the updated session key details.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `ip_whitelist` | array |  |  |
| `label` | string |  | Send `null` to clear the label; omit the field to leave it unchanged. |
| `offchain_scopes` | array |  |  |
| `public_session_key` | string | yes |  |
| `wallet` | string | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `expiry_sec` | integer (uint64) |  |
| `ip_whitelist` | string[] |  |
| `label` | string |  |
| `offchain_scopes` | string[] | Off-chain scopes (read-tier capabilities). |
| `protocol_scopes` | string[] | Protocol-level (on-chain authority) scopes. |
| `public_session_key` | string |  |
| `registered_sec` | integer (uint64) |  |
| `subaccount_ids` | integer (uint64)[] | Subaccounts this key may act on. An empty stored value means "all subaccounts" and is expanded to the wallet's current subaccount list. |

### `private/session_keys`

Returns every session key registered to the given wallet, including expired and not-yet-activated keys, each with its public address, scopes, expiry, label, IP allowlist, and permitted subaccounts.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `public_session_keys` | object[] |  |
| `public_session_keys[].expiry_sec` | integer (uint64) |  |
| `public_session_keys[].ip_whitelist` | string[] |  |
| `public_session_keys[].label` | string |  |
| `public_session_keys[].offchain_scopes` | string[] | Off-chain scopes (read-tier capabilities). |
| `public_session_keys[].protocol_scopes` | string[] | Protocol-level (on-chain authority) scopes. |
| `public_session_keys[].public_session_key` | string |  |
| `public_session_keys[].registered_sec` | integer (uint64) |  |
| `public_session_keys[].subaccount_ids` | integer (uint64)[] | Subaccounts this key may act on. An empty stored value means "all subaccounts" and is expanded to the wallet's current subaccount list. |

### `private/set_session_key`

Authorizes a new session key for a wallet from a signed action, granting it a set of on-chain (protocol) scopes and off-chain scopes with an expiry, an optional label, an optional IP allowlist, and an optional list of subaccounts it may act on (defaults to all of the wallet's subaccounts). Send the signed action fields (nonce, signer, signature, signature expiry, and module) alongside the requested scopes; the endpoint returns the registered key's public address and its granted scopes, expiry, allowlist, label, and subaccounts.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `expiry_sec` | integer (uint64) | yes |  |
| `ip_whitelist` | array |  |  |
| `label` | string |  |  |
| `nonce` | string | yes |  |
| `offchain_scopes` | string[] | yes | Off-chain scopes which are validated in backend only |
| `protocol_scopes` | string[] | yes | Scopes granted to the session key, validated by the protocol. Each is a string like `"trade:orderbook:all"`. |
| `public_session_key` | string | yes | Session key address being authorized. |
| `signature` | string | yes | 0x-prefixed hex, 65-byte r\|\|s\|\|v. |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `subaccount_ids` | array |  |  |
| `wallet` | string | yes | Wallet the session key is being registered for. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `expiry_sec` | integer (uint64) |  |
| `ip_whitelist` | string[] |  |
| `label` | string |  |
| `offchain_scopes` | string[] |  |
| `protocol_scopes` | string[] |  |
| `public_session_key` | string |  |
| `subaccount_ids` | integer (uint64)[] | Subaccounts the key may act on. Empty/omitted request (all subaccounts) is expanded to the wallet's current subaccount list. |

### `private/set_session_key_debug`

Takes the same params as private/set_session_key and rebuilds the session-key Action without executing anything, returning the EIP-712 encoded_data, encoded_data_hashed, action_hash, typed_data_hash, domain_separator, action_typehash, module, owner and expected_signer, plus the decoded session key, expiry, protocol scopes and subaccounts. Byte-compare these against your local computation to find why a signature is rejected. Requires a logged-in session.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `expiry_sec` | integer (uint64) | yes |  |
| `ip_whitelist` | array |  |  |
| `label` | string |  |  |
| `nonce` | string | yes |  |
| `offchain_scopes` | string[] | yes | Off-chain scopes which are validated in backend only |
| `protocol_scopes` | string[] | yes | Scopes granted to the session key, validated by the protocol. Each is a string like `"trade:orderbook:all"`. |
| `public_session_key` | string | yes | Session key address being authorized. |
| `signature` | string | yes | 0x-prefixed hex, 65-byte r\|\|s\|\|v. |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `subaccount_ids` | array |  |  |
| `wallet` | string | yes | Wallet the session key is being registered for. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `action_hash` | string | EIP-712 struct hash of the `Action`: `keccak256(abi.encode(action_typehash, …, encoded_data_hashed, …))`. |
| `action_typehash` | string | `ACTION_TYPEHASH` — keccak of the `Action` struct type string; invariant across deployments. |
| `domain_separator` | string | EIP-712 domain separator of the Matching contract for this deployment. |
| `encoded_data` | string | ABI-encoded, module-specific action payload (the `data` bytes), 0x-hex. |
| `encoded_data_hashed` | string | `keccak256(encoded_data)` — the value packed into the struct hash. |
| `expected_signer` | string | The signer the signature is checked against. |
| `input_data` | object | The `Action` envelope a debug route rebuilt from the request inputs, plus its decoded action data — i.e. what the signature commits to. |
| `input_data.data` | object |  |
| `input_data.data.expiry_sec` | integer (uint64) |  |
| `input_data.data.scopes` | string[] | Protocol scope wire strings (e.g. `"trade:orderbook:all"`). |
| `input_data.data.session_key` | string |  |
| `input_data.data.subaccounts` | integer (uint64)[] |  |
| `input_data.expiry` | integer (uint64) |  |
| `input_data.module` | string |  |
| `input_data.nonce` | string |  |
| `input_data.owner` | string |  |
| `input_data.signer` | string |  |
| `input_data.subaccount_id` | integer (uint64) |  |
| `module` | string | Per-action module contract address bound into the signed struct. |
| `owner` | string | Wallet that owns the subaccount the action applies to. |
| `recovered_signer` | string | null on the debug routes (no signature is checked there); on a signature-mismatch error this is the address actually recovered. |
| `typed_data_hash` | string | Final EIP-712 digest the client signs: `keccak256(0x1901 \|\| domain_separator \|\| action_hash)`. |

### `public/get_wallets_from_session_key`

Public lookup that returns the wallet addresses a given session key is registered to, sorted by expiry, with expired keys omitted. An optional scope filter narrows results to keys holding that off-chain scope; returns an error if no matching, unexpired keys exist.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `public_session_key` | string | yes |  |
| `scope` | enum: `account_info` \| enum: `block_trade` |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `wallets` | string[] |  |

<a id="subaccounts"></a>
## Subaccounts

### `private/change_subaccount_label`

Updates the human-readable label for a subaccount. The label must be at most 16 characters, otherwise an invalid-params error is returned. Requires a signed session key with account-info scope; on success it echoes back the subaccount ID and the new label.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `label` | string | yes |  |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `label` | string |  |
| `subaccount_id` | integer (uint64) |  |

### `private/delete_subaccount`

Permanently deletes one of the caller's subaccounts via a signed action. The subaccount must be fully wound down: no balances or debt, no open orders, RFQs, or quotes, not a vault, not under auction, and not the wallet's fallback subaccount. Deletion never moves value; subaccount ids are never reused. This is an owner-or-admin operation (session keys need the admin scope).

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `nonce` | string | yes |  |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `op_uuid` | string |  |
| `operation_id` | integer (uint64) |  |

### `private/get_all_portfolios`

Returns the complete portfolio (same shape as get_subaccount) for every subaccount owned by the given wallet, including valuations, margin figures, open orders, positions, and collaterals. If an individual subaccount's portfolio cannot be built, it is returned as a placeholder entry with failed_to_fetch set to true rather than failing the whole request.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `[].collaterals` | object[] |  |
| `[].collaterals[].amount` | string |  |
| `[].collaterals[].amount_step` | string |  |
| `[].collaterals[].asset_name` | string |  |
| `[].collaterals[].asset_type` | string |  |
| `[].collaterals[].average_price` | string |  |
| `[].collaterals[].average_price_excl_fees` | string |  |
| `[].collaterals[].creation_timestamp` | integer (int64) |  |
| `[].collaterals[].cumulative_interest` | string |  |
| `[].collaterals[].currency` | string |  |
| `[].collaterals[].delta` | string |  |
| `[].collaterals[].delta_currency` | string |  |
| `[].collaterals[].initial_margin` | string |  |
| `[].collaterals[].maintenance_margin` | string |  |
| `[].collaterals[].mark_price` | string |  |
| `[].collaterals[].mark_value` | string |  |
| `[].collaterals[].open_orders_margin` | string |  |
| `[].collaterals[].pending_interest` | string |  |
| `[].collaterals[].realized_pnl` | string |  |
| `[].collaterals[].realized_pnl_excl_fees` | string |  |
| `[].collaterals[].total_fees` | string |  |
| `[].collaterals[].unrealized_pnl` | string |  |
| `[].collaterals[].unrealized_pnl_excl_fees` | string |  |
| `[].collaterals_initial_margin` | string |  |
| `[].collaterals_maintenance_margin` | string |  |
| `[].collaterals_value` | string |  |
| `[].currency` | string[] |  |
| `[].failed_to_fetch` | boolean | `true` if this subaccount's portfolio could not be loaded; such subaccounts are returned as placeholders by `get_all_portfolios`. |
| `[].initial_margin` | string |  |
| `[].is_under_liquidation` | boolean |  |
| `[].label` | string |  |
| `[].maintenance_margin` | string |  |
| `[].manager_id` | integer (uint32) |  |
| `[].margin_type` | string |  |
| `[].mm_credits` | string | MM credit from universe loss-socialization events: the socialized USDC debit lands on cash in full, and `debit × (1 − write_down)` is added back to maintenance margin while the 6-hour write-down runs. Events this subaccount has not yet realized contribute the… |
| `[].open_orders` | object[] |  |
| `[].open_orders[].algo_duration_sec` | integer |  |
| `[].open_orders[].algo_num_slices` | integer |  |
| `[].open_orders[].algo_slices_completed` | integer |  |
| `[].open_orders[].algo_type` | enum: `twap` |  |
| `[].open_orders[].amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].open_orders[].average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].open_orders[].cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `[].open_orders[].creation_timestamp` | integer (int64) |  |
| `[].open_orders[].direction` | enum: `buy`, `sell` |  |
| `[].open_orders[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].open_orders[].filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].open_orders[].instrument_name` | string |  |
| `[].open_orders[].is_transfer` | boolean |  |
| `[].open_orders[].label` | string |  |
| `[].open_orders[].last_update_timestamp` | integer (int64) |  |
| `[].open_orders[].limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].open_orders[].max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].open_orders[].mmp` | boolean |  |
| `[].open_orders[].nonce` | string |  |
| `[].open_orders[].order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `[].open_orders[].order_id` | string |  |
| `[].open_orders[].order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `[].open_orders[].order_type` | enum: `limit`, `market` |  |
| `[].open_orders[].quote_id` | string | Optional UUID v4 string |
| `[].open_orders[].replaced_order_id` | string | Optional UUID v4 string |
| `[].open_orders[].signature` | string |  |
| `[].open_orders[].signature_expiry_sec` | integer (int64) |  |
| `[].open_orders[].signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `[].open_orders[].signer` | string |  |
| `[].open_orders[].subaccount_id` | integer (int64) |  |
| `[].open_orders[].time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `[].open_orders[].trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `[].open_orders[].trigger_price_type` | enum: `mark`, `index` |  |
| `[].open_orders[].trigger_reject_message` | string |  |
| `[].open_orders[].trigger_type` | enum: `stoploss`, `takeprofit` |  |
| `[].open_orders_margin` | string | Uses the manager's params, as `initial_margin` does, even for a subaccount with a delayed-liquidation override. Order checks use the override, so the two can differ. This is rare: an override usually loosens maintenance margin only, and this is an initial-mar… |
| `[].positions` | object[] |  |
| `[].positions[].amount` | string |  |
| `[].positions[].amount_step` | string |  |
| `[].positions[].average_price` | string |  |
| `[].positions[].average_price_excl_fees` | string |  |
| `[].positions[].creation_timestamp` | integer (int64) |  |
| `[].positions[].cumulative_funding` | string |  |
| `[].positions[].delta` | string |  |
| `[].positions[].gamma` | string |  |
| `[].positions[].index_price` | string |  |
| `[].positions[].initial_margin` | string |  |
| `[].positions[].instrument_name` | string |  |
| `[].positions[].instrument_type` | enum: `option`, `perp`, `erc20` | Asset type of the instrument: `"option"`, `"perp"`, or `"erc20"`. |
| `[].positions[].leverage` | string |  |
| `[].positions[].liquidation_price` | string |  |
| `[].positions[].maintenance_margin` | string |  |
| `[].positions[].mark_price` | string |  |
| `[].positions[].mark_value` | string |  |

### `private/get_margin`

Calculates net initial and maintenance margin for a subaccount before and after an optional simulated state change (position and/or collateral deltas), and whether that change would pass the margin requirement. Values are net margin — mark-to-market value minus the requirement — so positive means healthy. Does not take open-order margin into account. Margins use the subaccount's manager's params. Set is_delayed_liquidation to use its delayed-liquidation override instead, as order checks do; the request is rejected for a subaccount without one.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `is_delayed_liquidation` | boolean |  | `true` margins under the subaccount's delayed-liquidation override, as order checks do. Rejected for a subaccount without one. |
| `simulated_collateral_changes` | array |  | Optional collateral deltas to simulate deposits / withdrawals / spot trades. |
| `simulated_position_changes` | array |  | Optional position deltas to simulate perp / option trades. |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `is_valid_trade` | boolean | `true` when post-change initial margin passes, or the change is risk-reducing while maintenance margin stays healthy. |
| `post_initial_margin` | string |  |
| `post_maintenance_margin` | string |  |
| `pre_initial_margin` | string |  |
| `pre_maintenance_margin` | string |  |
| `subaccount_id` | integer (uint64) | `0` for the public simulated-portfolio variant. |

### `private/get_positions`

Returns the subaccount ID and the list of its active positions, including size, mark price, average price, unrealized and realized PnL, and Greeks where applicable, valued against live feed data at request time. A lighter alternative to get_subaccount when only positions are needed.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `positions` | object[] |  |
| `positions[].amount` | string |  |
| `positions[].amount_step` | string |  |
| `positions[].average_price` | string |  |
| `positions[].average_price_excl_fees` | string |  |
| `positions[].creation_timestamp` | integer (int64) |  |
| `positions[].cumulative_funding` | string |  |
| `positions[].delta` | string |  |
| `positions[].gamma` | string |  |
| `positions[].index_price` | string |  |
| `positions[].initial_margin` | string |  |
| `positions[].instrument_name` | string |  |
| `positions[].instrument_type` | enum: `option`, `perp`, `erc20` | Asset type of the instrument: `"option"`, `"perp"`, or `"erc20"`. |
| `positions[].leverage` | string |  |
| `positions[].liquidation_price` | string |  |
| `positions[].maintenance_margin` | string |  |
| `positions[].mark_price` | string |  |
| `positions[].mark_value` | string |  |
| `positions[].net_settlements` | string |  |
| `positions[].open_orders_margin` | string | Uses the same params as `initial_margin`: the manager's, even for a subaccount with a delayed-liquidation override, unless `public/margin_watch` asks for the override. |
| `positions[].pending_funding` | string |  |
| `positions[].realized_pnl` | string |  |
| `positions[].realized_pnl_excl_fees` | string |  |
| `positions[].theta` | string |  |
| `positions[].total_fees` | string |  |
| `positions[].unrealized_pnl` | string |  |
| `positions[].unrealized_pnl_excl_fees` | string |  |
| `positions[].vega` | string |  |
| `subaccount_id` | integer (uint64) |  |

### `private/get_subaccount`

Returns the complete portfolio for a single subaccount: its label, manager and risk-universe identifiers, margin type and liquidation status, aggregate valuation and margin figures (positions, collaterals, initial and maintenance margin, open-order margin) as decimal strings, plus the full lists of open orders, positions, and collateral balances. Margin, mark price, and Greek values are computed from live feed data at request time.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `collaterals` | object[] |  |
| `collaterals[].amount` | string |  |
| `collaterals[].amount_step` | string |  |
| `collaterals[].asset_name` | string |  |
| `collaterals[].asset_type` | string |  |
| `collaterals[].average_price` | string |  |
| `collaterals[].average_price_excl_fees` | string |  |
| `collaterals[].creation_timestamp` | integer (int64) |  |
| `collaterals[].cumulative_interest` | string |  |
| `collaterals[].currency` | string |  |
| `collaterals[].delta` | string |  |
| `collaterals[].delta_currency` | string |  |
| `collaterals[].initial_margin` | string |  |
| `collaterals[].maintenance_margin` | string |  |
| `collaterals[].mark_price` | string |  |
| `collaterals[].mark_value` | string |  |
| `collaterals[].open_orders_margin` | string |  |
| `collaterals[].pending_interest` | string |  |
| `collaterals[].realized_pnl` | string |  |
| `collaterals[].realized_pnl_excl_fees` | string |  |
| `collaterals[].total_fees` | string |  |
| `collaterals[].unrealized_pnl` | string |  |
| `collaterals[].unrealized_pnl_excl_fees` | string |  |
| `collaterals_initial_margin` | string |  |
| `collaterals_maintenance_margin` | string |  |
| `collaterals_value` | string |  |
| `currency` | string[] |  |
| `failed_to_fetch` | boolean | `true` if this subaccount's portfolio could not be loaded; such subaccounts are returned as placeholders by `get_all_portfolios`. |
| `initial_margin` | string |  |
| `is_under_liquidation` | boolean |  |
| `label` | string |  |
| `maintenance_margin` | string |  |
| `manager_id` | integer (uint32) |  |
| `margin_type` | string |  |
| `mm_credits` | string | MM credit from universe loss-socialization events: the socialized USDC debit lands on cash in full, and `debit × (1 − write_down)` is added back to maintenance margin while the 6-hour write-down runs. Events this subaccount has not yet realized contribute the… |
| `open_orders` | object[] |  |
| `open_orders[].algo_duration_sec` | integer |  |
| `open_orders[].algo_num_slices` | integer |  |
| `open_orders[].algo_slices_completed` | integer |  |
| `open_orders[].algo_type` | enum: `twap` |  |
| `open_orders[].amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `open_orders[].average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `open_orders[].cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `open_orders[].creation_timestamp` | integer (int64) |  |
| `open_orders[].direction` | enum: `buy`, `sell` |  |
| `open_orders[].extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `open_orders[].filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `open_orders[].instrument_name` | string |  |
| `open_orders[].is_transfer` | boolean |  |
| `open_orders[].label` | string |  |
| `open_orders[].last_update_timestamp` | integer (int64) |  |
| `open_orders[].limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `open_orders[].max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `open_orders[].mmp` | boolean |  |
| `open_orders[].nonce` | string |  |
| `open_orders[].order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `open_orders[].order_id` | string |  |
| `open_orders[].order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `open_orders[].order_type` | enum: `limit`, `market` |  |
| `open_orders[].quote_id` | string | Optional UUID v4 string |
| `open_orders[].replaced_order_id` | string | Optional UUID v4 string |
| `open_orders[].signature` | string |  |
| `open_orders[].signature_expiry_sec` | integer (int64) |  |
| `open_orders[].signed_limit_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `open_orders[].signer` | string |  |
| `open_orders[].subaccount_id` | integer (int64) |  |
| `open_orders[].time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `open_orders[].trigger_price` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `open_orders[].trigger_price_type` | enum: `mark`, `index` |  |
| `open_orders[].trigger_reject_message` | string |  |
| `open_orders[].trigger_type` | enum: `stoploss`, `takeprofit` |  |
| `open_orders_margin` | string | Uses the manager's params, as `initial_margin` does, even for a subaccount with a delayed-liquidation override. Order checks use the override, so the two can differ. This is rare: an override usually loosens maintenance margin only, and this is an initial-mar… |
| `positions` | object[] |  |
| `positions[].amount` | string |  |
| `positions[].amount_step` | string |  |
| `positions[].average_price` | string |  |
| `positions[].average_price_excl_fees` | string |  |
| `positions[].creation_timestamp` | integer (int64) |  |
| `positions[].cumulative_funding` | string |  |
| `positions[].delta` | string |  |
| `positions[].gamma` | string |  |
| `positions[].index_price` | string |  |
| `positions[].initial_margin` | string |  |
| `positions[].instrument_name` | string |  |
| `positions[].instrument_type` | enum: `option`, `perp`, `erc20` | Asset type of the instrument: `"option"`, `"perp"`, or `"erc20"`. |
| `positions[].leverage` | string |  |
| `positions[].liquidation_price` | string |  |
| `positions[].maintenance_margin` | string |  |
| `positions[].mark_price` | string |  |
| `positions[].mark_value` | string |  |

### `private/get_subaccounts`

Returns the wallet address and the sorted list of subaccount IDs owned by that wallet. Yields an empty list if the wallet has no subaccounts.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `subaccount_ids` | integer (uint64)[] |  |
| `wallet` | string |  |

### `public/get_margin`

Calculates net initial and maintenance margin for a fully simulated portfolio under a chosen margin type (SM or PM2; market selects the currency a PM2 manager must cover), optionally with a further simulated state change layered on top. Values are net margin — mark-to-market value minus the requirement — so positive means healthy. Does not take open-order margin into account.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `margin_type` | string | yes | `SM` (standard margin) or `PM2` (portfolio margin). |
| `market` | string |  | Currency the manager must cover; required for PM2. |
| `simulated_collateral_changes` | array |  | Optional collateral deltas to simulate deposits / withdrawals / spot trades. |
| `simulated_collaterals` | object[] | yes | Collaterals of the simulated portfolio. |
| `simulated_collaterals[].amount` | string (decimal) | yes | Collateral amount to simulate, as a decimal string or JSON number. |
| `simulated_collaterals[].asset_name` | string | yes | Collateral ERC20 asset name (e.g. ETH, USDC, WSTETH). |
| `simulated_position_changes` | array |  | Optional position deltas to simulate perp / option trades. |
| `simulated_positions` | object[] | yes | Positions of the simulated portfolio. |
| `simulated_positions[].amount` | string (decimal) | yes | Position amount to simulate, as a decimal string or JSON number. |
| `simulated_positions[].entry_price` | string |  | Perps only: entry price to simulate against; mark price when omitted. |
| `simulated_positions[].instrument_name` | string | yes | Perp or option instrument name. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `is_valid_trade` | boolean | `true` when post-change initial margin passes, or the change is risk-reducing while maintenance margin stays healthy. |
| `post_initial_margin` | string |  |
| `post_maintenance_margin` | string |  |
| `pre_initial_margin` | string |  |
| `pre_maintenance_margin` | string |  |
| `subaccount_id` | integer (uint64) | `0` for the public simulated-portfolio variant. |

### `public/get_subaccounts`

Returns the wallet address and the sorted list of all subaccount IDs owned by that wallet. Yields an empty list if the wallet has no subaccounts. Public endpoint, no authentication required.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `subaccount_ids` | integer (uint64)[] |  |
| `wallet` | string |  |

### `public/get_wallet`

Returns the wallet address that owns `subaccount_id`; the reverse of `public/get_subaccounts`. Returns a subaccount-not-found error if the subaccount does not exist. The result can be up to 60 seconds old. Public endpoint, no authentication required.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `subaccount_id` | integer (uint64) |  |
| `wallet` | string |  |

<a id="system"></a>
## System

### `public/decode_action`

Runs a hex-encoded Action.data payload through the exchange's own ABI decoder and returns either the decoded fields or the exact reason the bytes were rejected, naming the 32-byte word and the field that broke. Reach for this first when a request fails signature verification (14014): every other route encodes Action.data server-side, so a client whose encoder emits a bad word never sees a decode error - the hashes simply disagree. This is the only route a client's own bytes reach the decoder. Needs no auth and executes nothing.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `action_type` | enum: `order`, `rfq_maker`, `rfq_taker`, `transfer`, `external_transfer`, `withdrawal`, `liquidation`, `set_session_key`, `update_whitelisted_recipients`, `delete_subaccount`, `vault_deposit`, `vault_withdraw`, … | yes | Which action codec to run the bytes through. A module address is not enough on its own: the RFQ module signs two different layouts, and the vault module signs seven. |
| `encoded_data` | string | yes | ABI-encoded action data (the `Action.data` bytes), 0x-prefixed hex. Same value the `*_debug` routes return as `encoded_data`. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `action_type` | enum: `order`, `rfq_maker`, `rfq_taker`, `transfer`, `external_transfer`, `withdrawal`, `liquidation`, `set_session_key`, `update_whitelisted_recipients`, `delete_subaccount`, `vault_deposit`, `vault_withdraw`, … | Which action codec to run the bytes through. A module address is not enough on its own: the RFQ module signs two different layouts, and the vault module signs seven. |
| `decoded` | any | The decoded fields. Decimal values are at the protocol's 1e12 scale — the wire carries 1e18, and the codec rejects anything that does not convert exactly. |

### `public/get_live_incidents`

Returns every incident the exchange operators have declared and not yet resolved, each with its label, message, severity (low, medium or high), whether it was raised manually or by an automated monitor, and when it was raised. Takes no parameters. A resolved incident disappears from this list.

**Auth:** public · **Rate class:** `non_matching`

**Params**

_none_

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `incidents` | object[] | List of ongoing incidents |
| `incidents[].creation_timestamp_sec` | integer (int64) | Timestamp of incident in UTC sec |
| `incidents[].label` | string | Incident label |
| `incidents[].message` | string | Incident message |
| `incidents[].monitor_type` | enum: `manual`, `auto` | Incident trigger type |
| `incidents[].severity` | enum: `low`, `medium`, `high` | Incident severity |

### `public/get_time`

Returns the current server time in milliseconds since the UNIX epoch. Takes no parameters and requires no authentication. Use it to align the timestamps and nonces bound into signed actions with the server clock.

**Auth:** public · **Rate class:** `non_matching`

**Params**

_none_

**Result**

_none_

### `public/get_transaction`

Looks up the settlement lifecycle of a previously submitted operation by its operation UUID (op_uuid). Returns the operation's serialized data along with its batch status, settlement transaction hash, and any error log; the status is null until the operation has been picked up for settlement.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `op_uuid` | string | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `data` | string |  |
| `error_log` | string |  |
| `status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` |  |
| `transaction_hash` | string |  |

### `public/getRateLimits`

Returns the caller's current remaining rate-limit allowances for the active connection, broken out into matching-request, non-matching-request, and per-endpoint buckets. On WebSocket connections it also includes the remaining connection allowance.

**Auth:** public · **Rate class:** `non_matching`

**Params**

_none_

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `remaining_connections` | object | Remaining WebSocket connection allowance for this account, present only on WebSocket connections. |
| `remaining_connections.consumedPoints` | integer (int64) | Total consumed points. |
| `remaining_connections.isFirstInDuration` | boolean | Whether it's the first request in this duration window. |
| `remaining_connections.msBeforeNext` | integer (uint64) | Milliseconds before the next request is allowed (0 if none). |
| `remaining_connections.remainingPoints` | integer (int64) | Number of remaining points (tokens). |
| `remaining_matching` | object |  |
| `remaining_matching.consumedPoints` | integer (int64) | Total consumed points. |
| `remaining_matching.isFirstInDuration` | boolean | Whether it's the first request in this duration window. |
| `remaining_matching.msBeforeNext` | integer (uint64) | Milliseconds before the next request is allowed (0 if none). |
| `remaining_matching.remainingPoints` | integer (int64) | Number of remaining points (tokens). |
| `remaining_non_matching` | object |  |
| `remaining_non_matching.consumedPoints` | integer (int64) | Total consumed points. |
| `remaining_non_matching.isFirstInDuration` | boolean | Whether it's the first request in this duration window. |
| `remaining_non_matching.msBeforeNext` | integer (uint64) | Milliseconds before the next request is allowed (0 if none). |
| `remaining_non_matching.remainingPoints` | integer (int64) | Number of remaining points (tokens). |
| `remaining_per_endpoint` | object |  |

<a id="transfers-withdrawals"></a>
## Transfers & Withdrawals

### `private/transfer_positions`

Atomically transfers one or more derivative positions between a maker and a taker subaccount using matched, signed transfer quotes. Each side supplies its subaccount, signer, nonce, signature, expiry, max fee, direction, and priced legs (instrument, amount, price); the two quotes must mirror each other. Requires a session key with transfer permission and returns the resulting operation details.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `maker_params` | object | yes | Action info that needs to be signed by quoter or RFQ executor for a transfer. The quoter signs the legs hash + max fee; the executor signs the same legs hash + their own max fee. |
| `maker_params.direction` | enum: `buy`, `sell` | yes |  |
| `maker_params.legs` | object[] | yes |  |
| `maker_params.max_fee` | string (decimal) | yes | Maximum fee the signer authorises, in USD, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `maker_params.nonce` | string | yes |  |
| `maker_params.signature` | string | yes |  |
| `maker_params.signature_expiry_sec` | integer (int64) | yes |  |
| `maker_params.signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `maker_params.subaccount_id` | integer (int64) | yes |  |
| `taker_params` | object | yes | Action info that needs to be signed by quoter or RFQ executor for a transfer. The quoter signs the legs hash + max fee; the executor signs the same legs hash + their own max fee. |
| `taker_params.direction` | enum: `buy`, `sell` | yes |  |
| `taker_params.legs` | object[] | yes |  |
| `taker_params.max_fee` | string (decimal) | yes | Maximum fee the signer authorises, in USD, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `taker_params.nonce` | string | yes |  |
| `taker_params.signature` | string | yes |  |
| `taker_params.signature_expiry_sec` | integer (int64) | yes |  |
| `taker_params.signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `taker_params.subaccount_id` | integer (int64) | yes |  |
| `wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `maker_quote` | object |  |
| `maker_quote.batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Settlement batch status (only for executed quotes). |
| `maker_quote.cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `maker_quote.creation_timestamp` | integer (int64) |  |
| `maker_quote.direction` | enum: `buy`, `sell` |  |
| `maker_quote.extra_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_quote.fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_quote.fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_quote.is_transfer` | boolean |  |
| `maker_quote.label` | string |  |
| `maker_quote.last_update_timestamp` | integer (int64) |  |
| `maker_quote.legs` | object[] |  |
| `maker_quote.legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_quote.legs[].direction` | enum: `buy`, `sell` |  |
| `maker_quote.legs[].instrument_name` | string |  |
| `maker_quote.legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_quote.legs_hash` | string |  |
| `maker_quote.liquidity_role` | enum: `maker`, `taker` |  |
| `maker_quote.max_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `maker_quote.mmp` | boolean |  |
| `maker_quote.nonce` | string |  |
| `maker_quote.quote_id` | string (uuid) | UUID v4 string |
| `maker_quote.rfq_id` | string (uuid) | UUID v4 string |
| `maker_quote.signature_expiry_sec` | integer (int64) |  |
| `maker_quote.status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `maker_quote.subaccount_id` | integer (int64) |  |
| `maker_quote.tx_hash` | string | Blockchain transaction hash (only for executed quotes). |
| `taker_quote` | object |  |
| `taker_quote.batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Settlement batch status (only for executed quotes). |
| `taker_quote.cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `taker_quote.creation_timestamp` | integer (int64) |  |
| `taker_quote.direction` | enum: `buy`, `sell` |  |
| `taker_quote.extra_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_quote.fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_quote.fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_quote.is_transfer` | boolean |  |
| `taker_quote.label` | string |  |
| `taker_quote.last_update_timestamp` | integer (int64) |  |
| `taker_quote.legs` | object[] |  |
| `taker_quote.legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_quote.legs[].direction` | enum: `buy`, `sell` |  |
| `taker_quote.legs[].instrument_name` | string |  |
| `taker_quote.legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_quote.legs_hash` | string |  |
| `taker_quote.liquidity_role` | enum: `maker`, `taker` |  |
| `taker_quote.max_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `taker_quote.mmp` | boolean |  |
| `taker_quote.nonce` | string |  |
| `taker_quote.quote_id` | string (uuid) | UUID v4 string |
| `taker_quote.rfq_id` | string (uuid) | UUID v4 string |
| `taker_quote.signature_expiry_sec` | integer (int64) |  |
| `taker_quote.status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `taker_quote.subaccount_id` | integer (int64) |  |
| `taker_quote.tx_hash` | string | Blockchain transaction hash (only for executed quotes). |

### `private/transfer_positions_debug`

Takes the same params as private/transfer_positions and rebuilds both the maker and taker Actions without executing anything, returning for each side the EIP-712 encoded_data, encoded_data_hashed, action_hash, typed_data_hash, domain_separator, action_typehash, module, owner and expected_signer, plus the decoded action data (the maker's priced legs, and the taker's order_hash committing to them). Byte-compare these against your local computation to find why a signature is rejected. Requires a logged-in session; no transfer scope needed.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `maker_params` | object | yes | Action info that needs to be signed by quoter or RFQ executor for a transfer. The quoter signs the legs hash + max fee; the executor signs the same legs hash + their own max fee. |
| `maker_params.direction` | enum: `buy`, `sell` | yes |  |
| `maker_params.legs` | object[] | yes |  |
| `maker_params.max_fee` | string (decimal) | yes | Maximum fee the signer authorises, in USD, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `maker_params.nonce` | string | yes |  |
| `maker_params.signature` | string | yes |  |
| `maker_params.signature_expiry_sec` | integer (int64) | yes |  |
| `maker_params.signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `maker_params.subaccount_id` | integer (int64) | yes |  |
| `taker_params` | object | yes | Action info that needs to be signed by quoter or RFQ executor for a transfer. The quoter signs the legs hash + max fee; the executor signs the same legs hash + their own max fee. |
| `taker_params.direction` | enum: `buy`, `sell` | yes |  |
| `taker_params.legs` | object[] | yes |  |
| `taker_params.max_fee` | string (decimal) | yes | Maximum fee the signer authorises, in USD, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `taker_params.nonce` | string | yes |  |
| `taker_params.signature` | string | yes |  |
| `taker_params.signature_expiry_sec` | integer (int64) | yes |  |
| `taker_params.signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `taker_params.subaccount_id` | integer (int64) | yes |  |
| `wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `maker_result` | object | Debug-route payload for one rebuilt action: the EIP-712 hashes plus the action input fields. |
| `maker_result.action_hash` | string | EIP-712 struct hash of the `Action`: `keccak256(abi.encode(action_typehash, …, encoded_data_hashed, …))`. |
| `maker_result.action_typehash` | string | `ACTION_TYPEHASH` — keccak of the `Action` struct type string; invariant across deployments. |
| `maker_result.domain_separator` | string | EIP-712 domain separator of the Matching contract for this deployment. |
| `maker_result.encoded_data` | string | ABI-encoded, module-specific action payload (the `data` bytes), 0x-hex. |
| `maker_result.encoded_data_hashed` | string | `keccak256(encoded_data)` — the value packed into the struct hash. |
| `maker_result.expected_signer` | string | The signer the signature is checked against. |
| `maker_result.input_data` | object | The `Action` envelope a debug route rebuilt from the request inputs, plus its decoded action data — i.e. what the signature commits to. |
| `maker_result.input_data.data` | object |  |
| `maker_result.input_data.expiry` | integer (uint64) |  |
| `maker_result.input_data.module` | string |  |
| `maker_result.input_data.nonce` | string |  |
| `maker_result.input_data.owner` | string |  |
| `maker_result.input_data.signer` | string |  |
| `maker_result.input_data.subaccount_id` | integer (uint64) |  |
| `maker_result.module` | string | Per-action module contract address bound into the signed struct. |
| `maker_result.owner` | string | Wallet that owns the subaccount the action applies to. |
| `maker_result.recovered_signer` | string | null on the debug routes (no signature is checked there); on a signature-mismatch error this is the address actually recovered. |
| `maker_result.typed_data_hash` | string | Final EIP-712 digest the client signs: `keccak256(0x1901 \|\| domain_separator \|\| action_hash)`. |
| `taker_result` | object | Debug-route payload for one rebuilt action: the EIP-712 hashes plus the action input fields. |
| `taker_result.action_hash` | string | EIP-712 struct hash of the `Action`: `keccak256(abi.encode(action_typehash, …, encoded_data_hashed, …))`. |
| `taker_result.action_typehash` | string | `ACTION_TYPEHASH` — keccak of the `Action` struct type string; invariant across deployments. |
| `taker_result.domain_separator` | string | EIP-712 domain separator of the Matching contract for this deployment. |
| `taker_result.encoded_data` | string | ABI-encoded, module-specific action payload (the `data` bytes), 0x-hex. |
| `taker_result.encoded_data_hashed` | string | `keccak256(encoded_data)` — the value packed into the struct hash. |
| `taker_result.expected_signer` | string | The signer the signature is checked against. |
| `taker_result.input_data` | object | The `Action` envelope a debug route rebuilt from the request inputs, plus its decoded action data — i.e. what the signature commits to. |
| `taker_result.input_data.data` | object |  |
| `taker_result.input_data.expiry` | integer (uint64) |  |
| `taker_result.input_data.module` | string |  |
| `taker_result.input_data.nonce` | string |  |
| `taker_result.input_data.owner` | string |  |
| `taker_result.input_data.signer` | string |  |
| `taker_result.input_data.subaccount_id` | integer (uint64) |  |
| `taker_result.module` | string | Per-action module contract address bound into the signed struct. |
| `taker_result.owner` | string | Wallet that owns the subaccount the action applies to. |
| `taker_result.recovered_signer` | string | null on the debug routes (no signature is checked there); on a signature-mismatch error this is the address actually recovered. |
| `taker_result.typed_data_hash` | string | Final EIP-712 digest the client signs: `keccak256(0x1901 \|\| domain_separator \|\| action_hash)`. |

### `private/transfer_spot`

Submits a signed transfer of a single spot asset from one subaccount to another subaccount you own. You specify the source and destination subaccounts (or set new_subaccount_manager to create a new destination subaccount under a manager), the asset and its sub_id, the amount, a nonce, signer, signature with expiry, and the maximum USD sequencer fee. Requires a session key with a transfer permission and returns the operation id and uuid.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `amount` | string (decimal) | yes | Transfer amount in units of the asset, as a decimal string (e.g. `"1.5"`) or JSON number. |
| `asset_name` | string | yes |  |
| `max_fee_usd` | string (decimal) | yes | Maximum sequencer fee the signer authorises, in USD, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `new_subaccount_manager` | integer (uint32) | yes | Non-zero → create a new sender-owned subaccount under this manager id. |
| `nonce` | string | yes |  |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `sub_id` | integer (uint128) | yes |  |
| `subaccount_id` | integer (uint64) | yes |  |
| `to_subaccount_id` | integer (uint64) | yes | Existing destination subaccount. Ignored when `new_subaccount_manager != 0`. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `op_uuid` | string |  |
| `operation_id` | integer (uint64) |  |

### `private/transfer_spot_debug`

Takes the same params as private/transfer_spot and rebuilds the transfer Action without executing anything, returning the EIP-712 encoded_data, encoded_data_hashed, action_hash, typed_data_hash, domain_separator, action_typehash, module, owner and expected_signer, plus the decoded transfer action data. Byte-compare these against your local computation to find why a signature is rejected. Requires a logged-in session; no transfer scope needed.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `amount` | string (decimal) | yes | Transfer amount in units of the asset, as a decimal string (e.g. `"1.5"`) or JSON number. |
| `asset_name` | string | yes |  |
| `max_fee_usd` | string (decimal) | yes | Maximum sequencer fee the signer authorises, in USD, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `new_subaccount_manager` | integer (uint32) | yes | Non-zero → create a new sender-owned subaccount under this manager id. |
| `nonce` | string | yes |  |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `sub_id` | integer (uint128) | yes |  |
| `subaccount_id` | integer (uint64) | yes |  |
| `to_subaccount_id` | integer (uint64) | yes | Existing destination subaccount. Ignored when `new_subaccount_manager != 0`. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `action_hash` | string | EIP-712 struct hash of the `Action`: `keccak256(abi.encode(action_typehash, …, encoded_data_hashed, …))`. |
| `action_typehash` | string | `ACTION_TYPEHASH` — keccak of the `Action` struct type string; invariant across deployments. |
| `domain_separator` | string | EIP-712 domain separator of the Matching contract for this deployment. |
| `encoded_data` | string | ABI-encoded, module-specific action payload (the `data` bytes), 0x-hex. |
| `encoded_data_hashed` | string | `keccak256(encoded_data)` — the value packed into the struct hash. |
| `expected_signer` | string | The signer the signature is checked against. |
| `input_data` | object | The `Action` envelope a debug route rebuilt from the request inputs, plus its decoded action data — i.e. what the signature commits to. |
| `input_data.data` | object |  |
| `input_data.data.amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `input_data.data.asset` | string |  |
| `input_data.data.max_fee_usd` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `input_data.data.new_subaccount_manager` | integer (uint32) |  |
| `input_data.data.sub_id` | string |  |
| `input_data.data.to_subaccount_id` | integer (uint64) |  |
| `input_data.expiry` | integer (uint64) |  |
| `input_data.module` | string |  |
| `input_data.nonce` | string |  |
| `input_data.owner` | string |  |
| `input_data.signer` | string |  |
| `input_data.subaccount_id` | integer (uint64) |  |
| `module` | string | Per-action module contract address bound into the signed struct. |
| `owner` | string | Wallet that owns the subaccount the action applies to. |
| `recovered_signer` | string | null on the debug routes (no signature is checked there); on a signature-mismatch error this is the address actually recovered. |
| `typed_data_hash` | string | Final EIP-712 digest the client signs: `keccak256(0x1901 \|\| domain_separator \|\| action_hash)`. |

### `private/transfer_spot_external`

Submits a signed transfer of a single spot asset to a subaccount belonging to a different owner. Alongside the standard transfer fields (asset, sub_id, amount, nonce, signer, signature, expiry, max USD fee) you give the recipient's wallet address and either an existing destination subaccount or 0 to create a new one under new_subaccount_manager; the max fee must cover both the transfer and any subaccount-creation cost. Requires a session key permitted to transfer to a different owner and returns the operation id and uuid.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `amount` | string (decimal) | yes | Transfer amount in units of the asset, as a decimal string (e.g. `"1.5"`) or JSON number. |
| `asset_name` | string | yes |  |
| `max_fee_usd` | string (decimal) | yes | Maximum sequencer fee the signer authorises, in USD, as a decimal string (e.g. `"1.5"`) or a JSON number. Must cover both the transfer fee and any subaccount-creation fee. |
| `new_subaccount_manager` | integer (uint32) | yes | Manager id for the new subaccount when `to_subaccount_id == 0`. |
| `nonce` | string | yes |  |
| `recipient_address` | string | yes | Owner of the destination account/subaccount. Must not be the sender's own wallet; use `private/transfer_spot` for that. |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `sub_id` | integer (uint128) | yes |  |
| `subaccount_id` | integer (uint64) | yes |  |
| `to_subaccount_id` | integer (uint64) | yes | Recipient's existing destination subaccount. `0` → create a new subaccount for `recipient_address` under `new_subaccount_manager`. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `op_uuid` | string |  |
| `operation_id` | integer (uint64) |  |

### `private/transfer_spot_external_debug`

Takes the same params as private/transfer_spot_external and rebuilds the external transfer Action without executing anything, returning the EIP-712 encoded_data, encoded_data_hashed, action_hash, typed_data_hash, domain_separator, action_typehash, module, owner and expected_signer, plus the decoded transfer action data including the recipient address. Byte-compare these against your local computation to find why a signature is rejected. Requires a logged-in session; no transfer scope needed.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `amount` | string (decimal) | yes | Transfer amount in units of the asset, as a decimal string (e.g. `"1.5"`) or JSON number. |
| `asset_name` | string | yes |  |
| `max_fee_usd` | string (decimal) | yes | Maximum sequencer fee the signer authorises, in USD, as a decimal string (e.g. `"1.5"`) or a JSON number. Must cover both the transfer fee and any subaccount-creation fee. |
| `new_subaccount_manager` | integer (uint32) | yes | Manager id for the new subaccount when `to_subaccount_id == 0`. |
| `nonce` | string | yes |  |
| `recipient_address` | string | yes | Owner of the destination account/subaccount. Must not be the sender's own wallet; use `private/transfer_spot` for that. |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `sub_id` | integer (uint128) | yes |  |
| `subaccount_id` | integer (uint64) | yes |  |
| `to_subaccount_id` | integer (uint64) | yes | Recipient's existing destination subaccount. `0` → create a new subaccount for `recipient_address` under `new_subaccount_manager`. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `action_hash` | string | EIP-712 struct hash of the `Action`: `keccak256(abi.encode(action_typehash, …, encoded_data_hashed, …))`. |
| `action_typehash` | string | `ACTION_TYPEHASH` — keccak of the `Action` struct type string; invariant across deployments. |
| `domain_separator` | string | EIP-712 domain separator of the Matching contract for this deployment. |
| `encoded_data` | string | ABI-encoded, module-specific action payload (the `data` bytes), 0x-hex. |
| `encoded_data_hashed` | string | `keccak256(encoded_data)` — the value packed into the struct hash. |
| `expected_signer` | string | The signer the signature is checked against. |
| `input_data` | object | The `Action` envelope a debug route rebuilt from the request inputs, plus its decoded action data — i.e. what the signature commits to. |
| `input_data.data` | object |  |
| `input_data.data.amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `input_data.data.asset` | string |  |
| `input_data.data.max_fee_usd` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `input_data.data.new_subaccount_manager` | integer (uint32) |  |
| `input_data.data.recipient_address` | string |  |
| `input_data.data.sub_id` | string |  |
| `input_data.data.to_subaccount_id` | integer (uint64) |  |
| `input_data.expiry` | integer (uint64) |  |
| `input_data.module` | string |  |
| `input_data.nonce` | string |  |
| `input_data.owner` | string |  |
| `input_data.signer` | string |  |
| `input_data.subaccount_id` | integer (uint64) |  |
| `module` | string | Per-action module contract address bound into the signed struct. |
| `owner` | string | Wallet that owns the subaccount the action applies to. |
| `recovered_signer` | string | null on the debug routes (no signature is checked there); on a signature-mismatch error this is the address actually recovered. |
| `typed_data_hash` | string | Final EIP-712 digest the client signs: `keccak256(0x1901 \|\| domain_separator \|\| action_hash)`. |

### `private/update_whitelisted_recipients`

Adds and/or removes recipient wallet addresses on an account's transfer whitelist via a signed, wallet-level action. Provide the owner wallet, signer, nonce, signature with expiry, and the add and remove address lists. This is an owner-or-admin operation (session keys need the admin scope); it returns the operation id, uuid, and the full whitelist after the update is applied.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `add` | string[] | yes | Recipient wallet addresses to add to the whitelist. |
| `nonce` | string | yes |  |
| `remove` | string[] | yes | Recipient wallet addresses to remove from the whitelist. |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `wallet` | string | yes | Wallet whose whitelist is being updated; becomes the action owner. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `op_uuid` | string |  |
| `operation_id` | integer (uint64) |  |
| `whitelisted_recipients` | string[] | The account's whitelisted recipients after the update was applied. |

### `private/update_whitelisted_recipients_debug`

Takes the same params as private/update_whitelisted_recipients and rebuilds the whitelist Action without executing anything, returning the EIP-712 encoded_data, encoded_data_hashed, action_hash, typed_data_hash, domain_separator, action_typehash, module, owner and expected_signer, plus the decoded add and remove address lists. Byte-compare these against your local computation to find why a signature is rejected. Requires a logged-in session.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `add` | string[] | yes | Recipient wallet addresses to add to the whitelist. |
| `nonce` | string | yes |  |
| `remove` | string[] | yes | Recipient wallet addresses to remove from the whitelist. |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `wallet` | string | yes | Wallet whose whitelist is being updated; becomes the action owner. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `action_hash` | string | EIP-712 struct hash of the `Action`: `keccak256(abi.encode(action_typehash, …, encoded_data_hashed, …))`. |
| `action_typehash` | string | `ACTION_TYPEHASH` — keccak of the `Action` struct type string; invariant across deployments. |
| `domain_separator` | string | EIP-712 domain separator of the Matching contract for this deployment. |
| `encoded_data` | string | ABI-encoded, module-specific action payload (the `data` bytes), 0x-hex. |
| `encoded_data_hashed` | string | `keccak256(encoded_data)` — the value packed into the struct hash. |
| `expected_signer` | string | The signer the signature is checked against. |
| `input_data` | object | The `Action` envelope a debug route rebuilt from the request inputs, plus its decoded action data — i.e. what the signature commits to. |
| `input_data.data` | object |  |
| `input_data.data.add` | string[] |  |
| `input_data.data.remove` | string[] |  |
| `input_data.expiry` | integer (uint64) |  |
| `input_data.module` | string |  |
| `input_data.nonce` | string |  |
| `input_data.owner` | string |  |
| `input_data.signer` | string |  |
| `input_data.subaccount_id` | integer (uint64) |  |
| `module` | string | Per-action module contract address bound into the signed struct. |
| `owner` | string | Wallet that owns the subaccount the action applies to. |
| `recovered_signer` | string | null on the debug routes (no signature is checked there); on a signature-mismatch error this is the address actually recovered. |
| `typed_data_hash` | string | Final EIP-712 digest the client signs: `keccak256(0x1901 \|\| domain_separator \|\| action_hash)`. |

### `private/withdraw`

Submits a signed request to withdraw a spot asset out of a subaccount. You provide the subaccount id, asset name, amount in underlying units, a nonce, the signer, an EIP-712 signature with its expiry, and the maximum sequencer fee (in USD) you authorise; setting force_batch controls whether the withdrawal is batched. Requires a session key with withdraw permission, and returns the accepted operation id and its uuid for tracking.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `amount_in_underlying` | string | yes |  |
| `asset_name` | string | yes |  |
| `force_batch` | boolean | yes |  |
| `max_fee_usd` | string (decimal) | yes | Maximum sequencer fee the signer authorises, in USD, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `nonce` | string | yes |  |
| `recipient` | string |  | L1 address the funds are paid out to. Defaults to the subaccount's owner wallet when omitted. Owners and all-subaccount admin keys may withdraw to any recipient. All other session keys may only withdraw to: - owner wallet, or - address in `whitelisted_recipie… |
| `signature` | string | yes |  |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `op_uuid` | string |  |
| `operation_id` | integer (uint64) |  |

### `public/withdraw_debug`

Dry-run helper that returns the EIP-712 typed data and hashes that would be computed for the given withdrawal parameters, so clients can verify their own signing and hashing before submitting. Takes the same inputs as private/withdraw (subaccount, signer, nonce, amount, max fee, expiry, asset) but performs no state change and needs no signature.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `amount_in_underlying` | string | yes |  |
| `asset_name` | string | yes |  |
| `force_batch` | boolean | yes |  |
| `max_fee_usd` | string (decimal) | yes | Maximum sequencer fee the signer authorises, in USD, as a decimal string (e.g. `"1.5"`) or a JSON number. |
| `nonce` | string | yes |  |
| `recipient` | string |  | L1 address the funds are paid out to. Defaults to the subaccount's owner wallet when omitted — matching what `private/withdraw` reconstructs. |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes |  |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

_none_

<a id="vault-curators"></a>
## Vault Curators

### `private/burn_vault_shares`

Curator-only endpoint that settles a pending withdraw request by signing a burn approval at a quoted share price (USD per share). Takes the request id and the user's withdraw-action hash, burns the shares, and returns the settlement result. Requires the curator mint-and-burn permission.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `nonce` | string | yes |  |
| `request_id` | object | yes | Composite vault request id: `(vault_subaccount_id, wallet, vault_nonce)` Useful as a stable dedup key across off-chain and on-chain vault events. |
| `request_id.vault_nonce` | string | yes |  |
| `request_id.vault_subaccount_id` | integer (uint64) | yes |  |
| `request_id.wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `share_price` | string (decimal) | yes | Quoted share price in USD per share, as a decimal string (e.g. `"1"`). |
| `signature` | string | yes | 0x-prefixed hex of the 65-byte EOA signature. |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes | The subaccount the action is signed on; which subaccount applies depends on the specific method — see that method's reference. |
| `withdraw_hash` | string | yes | 0x-prefixed hex of the 32-byte user withdraw-action hash. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `op_uuid` | string |  |
| `operation_id` | integer (uint64) |  |

### `private/create_vault`

Registers a new vault on-chain from a signed action; the signing wallet becomes the vault's curator and seeds the initial deposit from its funding subaccount. Inputs set the deposit asset, initial deposit amount, initial share price, management/performance fee rates (in basis points), max slippage, redemption cooldown, an optional benchmark asset for the high-water mark, and the max sequencer fee authorized. Requires the vault curator-create permission.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `benchmark_asset` | string |  | Spot asset to denominate the high-water mark in. Omit (or null) for the feed-less USD default; set it to charge performance fees only on outperformance measured against that asset. |
| `cooldown_sec` | integer (uint64) | yes |  |
| `deposit_spot_asset` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `initial_deposit` | string (decimal) | yes | Initial deposit in the vault's deposit asset, as a USD decimal string (e.g. `"15000"`). |
| `initial_share_price_usd` | string (decimal) | yes | Initial share price the vault is seeded at, in USD, as a decimal string (e.g. `"1"` or `"100"`). Must lie within the protocol's permitted range. |
| `management_fee_bps` | integer (uint64) | yes |  |
| `manager_id` | integer (uint64) | yes |  |
| `max_fee_usd` | string (decimal) | yes | Maximum sequencer fee the signer authorises, in USD, as a decimal string (e.g. `"1.5"`). |
| `max_slippage_bps` | integer (uint64) | yes |  |
| `nonce` | string | yes |  |
| `performance_fee_bps` | integer (uint64) | yes |  |
| `signature` | string | yes | 0x-prefixed hex of the 65-byte EOA signature. |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes | The subaccount the action is signed on; which subaccount applies depends on the specific method — see that method's reference. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `op_uuid` | string |  |
| `operation_id` | integer (uint64) |  |

### `private/force_burn`

Curator-signed endpoint that builds an on-chain action to forcibly redeem a given holder's entire share balance at the current mark-to-market share price. Inputs are the vault subaccount the curator signs on, the EIP-712 envelope (nonce, signer, signature, expiry), and the holder's wallet address. Requires the curator mint-and-burn permission; the protocol re-verifies the curator signature.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `holder` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `nonce` | string | yes |  |
| `signature` | string | yes | 0x-prefixed hex of the 65-byte EOA signature. |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes | The subaccount the action is signed on; which subaccount applies depends on the specific method — see that method's reference. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `op_uuid` | string |  |
| `operation_id` | integer (uint64) |  |

### `private/get_curated_vaults`

Returns the subaccount ids of the vaults curated by the given wallet. The wallet parameter must match the authenticated connection. Read-only.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | The curator wallet (0x hex). |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `subaccount_ids` | integer (uint64)[] |  |

### `private/get_live_burn_requests`

Curator-only endpoint that returns a FIFO page of a vault's pending withdraw (burn) requests. Inputs are the vault subaccount and a page limit. Requires the curator mint-and-burn permission.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `limit` | integer (uint64) | yes |  |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `requests` | object[] |  |
| `requests[].creation_timestamp_ms` | integer (uint64) |  |
| `requests[].id` | object | Composite vault request id: `(vault_subaccount_id, wallet, vault_nonce)` Useful as a stable dedup key across off-chain and on-chain vault events. |
| `requests[].id.vault_nonce` | string |  |
| `requests[].id.vault_subaccount_id` | integer (uint64) |  |
| `requests[].id.wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `requests[].signed_action` | object | An Action bundled with its ECDSA signature (65 bytes: r\|\|s\|\|v). |
| `requests[].signed_action.action` | object | EIP-712 typed-data Action struct that you sign; its fields are defined below. |
| `requests[].signed_action.signature` | integer (uint8)[] | 65-byte ECDSA signature (r\|\|s\|\|v). |
| `requests[].subaccount_id` | integer (uint64) |  |
| `requests[].user_action_hash` | string | 0x-prefixed hex of the 32-byte user-action hash the curator commits to. |
| `requests[].wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `total` | integer (uint64) |  |

### `private/get_live_mint_requests`

Curator-only endpoint that returns a FIFO page of a vault's pending deposit (mint) requests. Inputs are the vault subaccount and a page limit. Requires the curator mint-and-burn permission.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `limit` | integer (uint64) | yes |  |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `requests` | object[] |  |
| `requests[].creation_timestamp_ms` | integer (uint64) |  |
| `requests[].id` | object | Composite vault request id: `(vault_subaccount_id, wallet, vault_nonce)` Useful as a stable dedup key across off-chain and on-chain vault events. |
| `requests[].id.vault_nonce` | string |  |
| `requests[].id.vault_subaccount_id` | integer (uint64) |  |
| `requests[].id.wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `requests[].signed_action` | object | An Action bundled with its ECDSA signature (65 bytes: r\|\|s\|\|v). |
| `requests[].signed_action.action` | object | EIP-712 typed-data Action struct that you sign; its fields are defined below. |
| `requests[].signed_action.signature` | integer (uint8)[] | 65-byte ECDSA signature (r\|\|s\|\|v). |
| `requests[].subaccount_id` | integer (uint64) |  |
| `requests[].user_action_hash` | string | 0x-prefixed hex of the 32-byte user-action hash the curator commits to. |
| `requests[].wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `total` | integer (uint64) |  |

### `private/mint_vault_shares`

Curator-only endpoint that settles a pending deposit request by signing a mint approval at a quoted share price (USD per share). Takes the request id and the user's deposit-action hash, mints the corresponding shares, and returns the settlement result. Requires the curator mint-and-burn permission.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `deposit_hash` | string | yes | 0x-prefixed hex of the 32-byte user deposit-action hash. |
| `nonce` | string | yes |  |
| `request_id` | object | yes | Composite vault request id: `(vault_subaccount_id, wallet, vault_nonce)` Useful as a stable dedup key across off-chain and on-chain vault events. |
| `request_id.vault_nonce` | string | yes |  |
| `request_id.vault_subaccount_id` | integer (uint64) | yes |  |
| `request_id.wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `share_price` | string (decimal) | yes | Quoted share price in USD per share, as a decimal string (e.g. `"1.02"`). |
| `signature` | string | yes | 0x-prefixed hex of the 65-byte EOA signature. |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes | The subaccount the action is signed on; which subaccount applies depends on the specific method — see that method's reference. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `op_uuid` | string |  |
| `operation_id` | integer (uint64) |  |

### `private/reject_deposit_request`

Curator-only endpoint that removes a queued deposit request off-chain (no on-chain settlement), recording the rejection with an optional short reason. Takes the request id and returns an acknowledgement. Requires the curator mint-and-burn permission.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `reason` | string |  | Optional human-readable reason for the rejection. |
| `request_id` | object | yes | Composite vault request id: `(vault_subaccount_id, wallet, vault_nonce)` Useful as a stable dedup key across off-chain and on-chain vault events. |
| `request_id.vault_nonce` | string | yes |  |
| `request_id.vault_subaccount_id` | integer (uint64) | yes |  |
| `request_id.wallet` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes | The vault's subaccount ID; the caller must be the vault's curator. |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `request_id` | object | Composite vault request id: `(vault_subaccount_id, wallet, vault_nonce)` Useful as a stable dedup key across off-chain and on-chain vault events. |
| `request_id.vault_nonce` | string |  |
| `request_id.vault_subaccount_id` | integer (uint64) |  |
| `request_id.wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

### `private/update_vault_info`

Applies an off-chain patch to a vault the caller curates, updating any of its display name, description, advisory mark-to-market cap (a USD decimal), or whitelist-only flag. Only the fields supplied are changed. The caller must own the vault's subaccount (i.e. be its curator); description length is capped.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `description` | string |  |  |
| `mtm_cap` | string |  | Advisory mark-to-market cap in USD, as a decimal string (e.g. `"1000"`). Send `null` to remove the cap; omit the field to leave it unchanged. |
| `name` | string |  |  |
| `subaccount_id` | integer (uint64) | yes | The vault's subaccount ID; the caller must be the vault's curator. |
| `whitelist_only` | boolean |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `status` | string |  |

<a id="vault-shareholders"></a>
## Vault Shareholders

### `private/cancel_all_vault_requests`

Submits a signed cancel action that drains all of the caller's pending deposit and withdraw requests for a given vault and posts the corresponding on-chain operation. Input is the vault subaccount; any subaccount the caller owns may sign. Requires the user-cancel permission.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `nonce` | string | yes |  |
| `signature` | string | yes | 0x-prefixed hex of the 65-byte EOA signature. |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes | The subaccount the action is signed on; which subaccount applies depends on the specific method — see that method's reference. |
| `vault_subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `cancelled_request_ids` | object[] |  |
| `cancelled_request_ids[].vault_nonce` | string |  |
| `cancelled_request_ids[].vault_subaccount_id` | integer (uint64) |  |
| `cancelled_request_ids[].wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `op_uuid` | string |  |
| `operation_id` | integer (uint64) |  |

### `private/get_live_vault_requests`

Returns the caller's currently-pending vault deposit and withdraw requests, read live from the vault queue. Not paginated (the live queue is bounded); settled and terminal history is served by get_vault_request_history. The wallet parameter must match the authenticated connection.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | The shareholder wallet (0x hex). |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `requests` | object[] |  |
| `requests[].creation_timestamp_ms` | integer (uint64) |  |
| `requests[].id` | object | Composite vault request id: `(vault_subaccount_id, wallet, vault_nonce)` Useful as a stable dedup key across off-chain and on-chain vault events. |
| `requests[].id.vault_nonce` | string |  |
| `requests[].id.vault_subaccount_id` | integer (uint64) |  |
| `requests[].id.wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `requests[].signed_action` | object | An Action bundled with its ECDSA signature (65 bytes: r\|\|s\|\|v). |
| `requests[].signed_action.action` | object | EIP-712 typed-data Action struct that you sign; its fields are defined below. |
| `requests[].signed_action.signature` | integer (uint8)[] | 65-byte ECDSA signature (r\|\|s\|\|v). |
| `requests[].subaccount_id` | integer (uint64) |  |
| `requests[].user_action_hash` | string | 0x-prefixed hex of the 32-byte user-action hash the curator commits to. |
| `requests[].wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `total` | integer (uint64) |  |

### `private/get_shareholder_vaults`

Returns the subaccount ids of the vaults in which the given wallet holds shares. The wallet parameter must match the authenticated connection. Read-only.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | The shareholder wallet (0x hex). |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `subaccount_ids` | integer (uint64)[] |  |

### `private/get_vault_request_history`

Returns the caller's full vault action history (deposits, withdrawals, force-withdrawals, and cancels) across every status — enqueued, requested, applied, cancelled, rejected, or expired — with one row per action at its latest state. Paginated by page and page_size; monetary amounts, prices, and share counts are decimal strings. The wallet parameter must match the authenticated connection.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `page` | integer |  |  |
| `page_size` | integer |  |  |
| `wallet` | string | yes | The shareholder wallet (0x hex). |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `actions` | object[] |  |
| `actions[].after_shares` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `actions[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `actions[].before_shares` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `actions[].creation_timestamp_ms` | integer (int64) | Timestamp the request was created (ms). |
| `actions[].entry_price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `actions[].error_reason` | string |  |
| `actions[].event_ts` | integer (int64) | Timestamp of this event (ms). |
| `actions[].event_type` | string | "vault_deposit" \| "vault_withdraw" \| "vault_force_withdraw" \| "vault_cancel". |
| `actions[].exit_price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `actions[].operation_id` | integer (uint64) |  |
| `actions[].operation_uuid` | string |  |
| `actions[].share_price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `actions[].shares_delta` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `actions[].shares_requested` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `actions[].status` | string | While the action is in the queue, can be one of the following: "enqueued" \| "sequencer_applied" \| "user_cancel" \| "curator_reject" \| "protocol_reject" \| "expired". Once action is applied in the protocol, the status takes on `BatchStatus` values: "Batchin… |
| `actions[].user_action_hash` | string |  |
| `actions[].vault_nonce` | string |  |
| `actions[].vault_subaccount_id` | integer (uint64) |  |
| `actions[].wallet` | string |  |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `wallet` | string |  |

### `private/get_vault_shares`

Returns the caller's share balance for every vault it holds shares in, each paired with the full enriched vault row (the same shape as public/get_vault). The wallet parameter must match the authenticated connection. Read-only.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes | The shareholder wallet (0x hex). |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `vaults` | object[] |  |
| `vaults[].shares` | string (decimal) | Shares the caller holds. Same units as `vault.protocol.total_shares`. |
| `vaults[].vault` | object |  |
| `vaults[].vault.benchmark_price` | string | USD spot price of the HWM benchmark asset (`1.0` for feed-less USD vaults). null when a configured benchmark has no resolvable price. |
| `vaults[].vault.curator` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `vaults[].vault.curator_shares` | string (decimal) | Shares held by the curator (the vault subaccount's owner) — their skin-in-the-game. Same units as `protocol.total_shares`. |
| `vaults[].vault.description` | string |  |
| `vaults[].vault.mtm_cap` | string | Optional non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `vaults[].vault.name` | string |  |
| `vaults[].vault.nav_benchmark` | string | Live NAV expressed in the HWM benchmark asset's units. null when the vault couldn't be priced or its configured benchmark has no spot price. |
| `vaults[].vault.nav_usd` | string | Live mark-to-market NAV (USD) — signed, so an insolvent vault surfaces as a negative value. null only when the vault couldn't be priced (e.g. missing data). Divide by `protocol.total_shares` for the pre-fee share price. |
| `vaults[].vault.protocol` | object |  |
| `vaults[].vault.simulated_share_price_usd` | string | Live share price (USD/share) as if curator fees were settled now — the price a depositor/withdrawer faces. null when unpriceable or the vault is insolvent (a fee settlement on negative NAV is meaningless). |
| `vaults[].vault.whitelist_only` | boolean |  |

### `private/request_vault_deposit`

Submits a signed deposit action from the user's source subaccount and enqueues it in the vault's pending-deposit queue for the curator to settle. Inputs are the target vault subaccount, the deposit asset, and the amount as a decimal string. Returns an acknowledgement with the queued request; requires the user-deposit permission.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `amount` | string (decimal) | yes | Deposit amount in the vault's deposit asset, as a decimal string (e.g. `"1"`). |
| `deposit_spot_asset` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `nonce` | string | yes |  |
| `signature` | string | yes | 0x-prefixed hex of the 65-byte EOA signature. |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes | The subaccount the action is signed on; which subaccount applies depends on the specific method — see that method's reference. |
| `vault_subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `request_id` | object | Composite vault request id: `(vault_subaccount_id, wallet, vault_nonce)` Useful as a stable dedup key across off-chain and on-chain vault events. |
| `request_id.vault_nonce` | string |  |
| `request_id.vault_subaccount_id` | integer (uint64) |  |
| `request_id.wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

### `private/request_vault_withdraw`

Submits a signed withdraw action that enqueues a request to burn a given number of vault shares and redeem the proceeds to the user's subaccount. Inputs are the vault subaccount and the share quantity to burn (decimal string). Returns an acknowledgement with the queued request; requires the user-withdraw permission.

**Auth:** private (X-Derive* headers / WebSocket login) · **Rate class:** `proven`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `nonce` | string | yes |  |
| `shares_to_burn` | string (decimal) | yes | Number of vault shares to burn, as a decimal string. |
| `signature` | string | yes | 0x-prefixed hex of the 65-byte EOA signature. |
| `signature_expiry_sec` | integer (uint64) | yes |  |
| `signer` | string | yes | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `subaccount_id` | integer (uint64) | yes | The subaccount the action is signed on; which subaccount applies depends on the specific method — see that method's reference. |
| `vault_subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `request_id` | object | Composite vault request id: `(vault_subaccount_id, wallet, vault_nonce)` Useful as a stable dedup key across off-chain and on-chain vault events. |
| `request_id.vault_nonce` | string |  |
| `request_id.vault_subaccount_id` | integer (uint64) |  |
| `request_id.wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

### `public/get_vault`

Returns the full vault record — on-chain state plus curator metadata — for one vault subaccount id. Unauthenticated and read-only.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `benchmark_price` | string | USD spot price of the HWM benchmark asset (`1.0` for feed-less USD vaults). null when a configured benchmark has no resolvable price. |
| `curator` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `curator_shares` | string (decimal) | Shares held by the curator (the vault subaccount's owner) — their skin-in-the-game. Same units as `protocol.total_shares`. |
| `description` | string |  |
| `mtm_cap` | string | Optional non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `name` | string |  |
| `nav_benchmark` | string | Live NAV expressed in the HWM benchmark asset's units. null when the vault couldn't be priced or its configured benchmark has no spot price. |
| `nav_usd` | string | Live mark-to-market NAV (USD) — signed, so an insolvent vault surfaces as a negative value. null only when the vault couldn't be priced (e.g. missing data). Divide by `protocol.total_shares` for the pre-fee share price. |
| `protocol` | object |  |
| `protocol.closed` | boolean |  |
| `protocol.config` | object | Configuration for a vault subaccount's deposit/withdrawal controls. Every field is immutable after vault creation. Mutable, informational settings (descriptions, an advisory TVL cap) live in off-chain vault state, not here. |
| `protocol.config.benchmark_asset` | string | Spot asset the high-water mark is denominated in. null is the feed-less default: the HWM is a constant USD unit (reads no feed, so a deposit-asset depeg cannot manufacture a performance fee). An address denominates the HWM in that spot asset's units — perform… |
| `protocol.config.cooldown_sec` | integer (uint64) | Min seconds between a holder's last deposit and their withdrawal. |
| `protocol.config.deposit_spot_asset` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `protocol.config.management_fee_bps` | integer (uint16) |  |
| `protocol.config.max_slippage_bps` | integer (uint16) | Max deviation of the curator's quoted share price from the mtm-derived price, both sides. Bounded at creation by the protocol-wide maximum slippage limit. |
| `protocol.config.performance_fee_bps` | integer (uint16) |  |
| `protocol.global_hwm` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `protocol.last_fee_settled_at_sec` | integer (uint64) |  |
| `protocol.protocol_fee_share_bps` | integer (uint16) |  |
| `protocol.subaccount_id` | integer (uint64) |  |
| `protocol.total_shares` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `simulated_share_price_usd` | string | Live share price (USD/share) as if curator fees were settled now — the price a depositor/withdrawer faces. null when unpriceable or the vault is insolvent (a fee settlement on negative NAV is meaningless). |
| `whitelist_only` | boolean |  |

### `public/get_vault_action_history`

Returns a vault's finalized deposit, withdrawal, fee-accrual, and cancel events — including NAV, share price, high-water mark, and the fee-share split across management, performance, curator, and protocol — at the vault level (per-holder position details are omitted). Inputs are the vault subaccount, an optional event_type filter, and pagination. Amounts and prices are decimal strings. Unauthenticated.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `event_type` | string |  | Optional: "vault_deposit" \| "vault_withdraw" \| "vault_fee_accrual". |
| `page` | integer |  |  |
| `page_size` | integer |  |  |
| `subaccount_id` | integer (uint64) | yes |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `events` | object[] |  |
| `events[].curator_shares_minted` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `events[].event_ts` | integer (int64) | Timestamp of this event (ms). |
| `events[].event_type` | string | "vault_deposit" \| "vault_withdraw" \| "vault_force_withdraw". |
| `events[].holder` | string |  |
| `events[].management_shares_minted` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `events[].nav` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `events[].new_high_water_mark` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `events[].old_high_water_mark` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `events[].operation_uuid` | string |  |
| `events[].performance_shares_minted` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `events[].protocol_shares_minted` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `events[].share_price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `events[].shares_delta` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `events[].status` | string | While the action is in the queue, one of: "enqueued" \| "sequencer_applied" \| "user_cancel" \| "curator_reject" \| "protocol_reject" \| "expired". Once the action is in the protocol, the status takes on `BatchStatus` values: "Batching" \| "Executing" \| "Da"… |
| `events[].subaccount_id` | integer (uint64) |  |
| `events[].total_shares` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `subaccount_id` | integer (uint64) |  |

### `public/get_vault_performance_history`

Returns a time series of a vault's mark-to-market performance (NAV, share price, total and curator shares, high-water mark, optional benchmark) sampled hourly and downsampled to the requested resolution (1h, 8h, 24h, or 1wk). Supports optional from/to unix-second bounds and a limit (newest first, default 1000, capped at 10000). Values are decimal strings, with live prices nullable. Unauthenticated.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `from` | integer |  | Optional inclusive lower bound (unix seconds). |
| `limit` | integer |  | Max points to return, newest first (default 1000, capped at 10000). |
| `resolution` | enum: `1h`, `8h`, `24h`, `1wk` | yes | Quantization of the hourly samples, requested by the caller. |
| `subaccount_id` | integer (uint64) | yes |  |
| `to` | integer |  | Optional exclusive upper bound (unix seconds). |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `points` | object[] |  |
| `points[].benchmark_price` | string | Optional non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `points[].curator_shares` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `points[].global_hwm` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `points[].nav` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `points[].nav_benchmark` | string | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `points[].share_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `points[].total_shares` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `points[].ts` | integer (int64) |  |
| `resolution` | enum: `1h`, `8h`, `24h`, `1wk` | Quantization of the hourly samples, requested by the caller. |
| `subaccount_id` | integer (uint64) |  |

### `public/get_vaults`

Returns every vault in the system, each paired with its subaccount id, paginated by page and page_size. Unauthenticated and read-only.

**Auth:** public · **Rate class:** `non_matching`

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `page` | integer (uint) |  |  |
| `page_size` | integer (uint) |  |  |

**Result**

| Field | Type | Description |
| --- | --- | --- |
| `pagination` | object | Response envelope for paginated RPCs. |
| `pagination.count` | integer (uint64) |  |
| `pagination.num_pages` | integer (uint64) |  |
| `vaults` | object[] |  |
| `vaults[].benchmark_price` | string | USD spot price of the HWM benchmark asset (`1.0` for feed-less USD vaults). null when a configured benchmark has no resolvable price. |
| `vaults[].curator` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `vaults[].curator_shares` | string (decimal) | Shares held by the curator (the vault subaccount's owner) — their skin-in-the-game. Same units as `protocol.total_shares`. |
| `vaults[].description` | string |  |
| `vaults[].mtm_cap` | string | Optional non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `vaults[].name` | string |  |
| `vaults[].nav_benchmark` | string | Live NAV expressed in the HWM benchmark asset's units. null when the vault couldn't be priced or its configured benchmark has no spot price. |
| `vaults[].nav_usd` | string | Live mark-to-market NAV (USD) — signed, so an insolvent vault surfaces as a negative value. null only when the vault couldn't be priced (e.g. missing data). Divide by `protocol.total_shares` for the pre-fee share price. |
| `vaults[].protocol` | object |  |
| `vaults[].protocol.closed` | boolean |  |
| `vaults[].protocol.config` | object | Configuration for a vault subaccount's deposit/withdrawal controls. Every field is immutable after vault creation. Mutable, informational settings (descriptions, an advisory TVL cap) live in off-chain vault state, not here. |
| `vaults[].protocol.global_hwm` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `vaults[].protocol.last_fee_settled_at_sec` | integer (uint64) |  |
| `vaults[].protocol.protocol_fee_share_bps` | integer (uint16) |  |
| `vaults[].protocol.subaccount_id` | integer (uint64) |  |
| `vaults[].protocol.total_shares` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `vaults[].simulated_share_price_usd` | string | Live share price (USD/share) as if curator fees were settled now — the price a depositor/withdrawer faces. null when unpriceable or the vault is insolvent (a fee settlement on negative NAV is meaningless). |
| `vaults[].whitelist_only` | boolean |  |

<a id="websocket-channels"></a>
## WebSocket channels

### `auctions.watch`

Public channel that streams the live state of all ongoing liquidation and insolvency auctions across the exchange. Takes no parameters.

| Field | Type | Description |
| --- | --- | --- |
| `details` | object |  |
| `details.currency` | string |  |
| `details.estimated_bid_price` | string |  |
| `details.estimated_discount_pnl` | string |  |
| `details.estimated_mtm` | string |  |
| `details.estimated_percent_bid` | string |  |
| `details.margin_type` | string |  |
| `details.min_price_limit` | string |  |
| `details.risk_universe_id` | integer (uint32) | Risk universe of the auctioned account. A bid from a subaccount in any other universe is rejected. |
| `details.subaccount_balances` | object | Balance per asset name, as a decimal string. |
| `details.subaccount_balances.{key}` | string |  |
| `state` | enum: `ongoing`, `ended` |  |
| `subaccount_id` | integer (int64) |  |
| `timestamp` | integer (int64) |  |

### `block_proposals`

Public channel that streams the listed block proposals. It sends a proposal when it is sent and when it ends: executed, cancelled or expired. It also sends it with status executing if the outcome of an accept is not known. An accept that fails and leaves the proposal open sends no event. Each event carries the whole proposal, in the public/get_block_proposals shape, and never shows a wallet, a subaccount or a signature. Takes no parameters.

| Field | Type | Description |
| --- | --- | --- |
| `block_trade_id` | string (uuid) | The block trade, once the proposal executes. |
| `creation_timestamp` | integer (int64) |  |
| `currency` | string |  |
| `direction` | enum: `buy`, `sell` | The maker's direction. The taker trades the opposite. |
| `expires_at_sec` | integer (int64) | The last second (UTC) at which the proposal can be accepted. |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `listed` | boolean | Whether the proposal is on the public list. |
| `proposal_id` | string (uuid) | UUID v4 string |
| `risk_universe_id` | integer (uint32) |  |
| `status` | enum: `open`, `executing`, `executed`, `expired` \| enum: `cancelled` \| enum: `declined` |  |

### `chat.{room}`

Private channel (requires authentication) that streams a chat room live, where {room} is general or fee_tier. Every wallet that is not banned from chat may subscribe to general; fee_tier also needs a fee tier (see private/get_chat_rooms). Rooms are unavailable while the account is disabled. Each message shows its sender's username, never a wallet address. Each event is either a new message (event message) or the id of a message a moderator removed (event deleted).

| Field | Type | Description |
| --- | --- | --- |
| `creation_timestamp` | integer (int64) |  |
| `event` | enum: `message` |  |
| `message_id` | string (uuid) | UUID v4 string |
| `room` | enum: `general`, `fee_tier` | Every wallet not banned from chat may join `general`; `fee_tier` also needs a fee tier. |
| `text` | string |  |
| `username` | string |  |

### `margin.watch`

Public channel that streams margin and mark-to-market state for all accounts, letting you monitor collateralization and liquidation risk across the exchange. Takes no parameters.

| Field | Type | Description |
| --- | --- | --- |
| `collaterals` | any[] |  |
| `currency` | string |  |
| `initial_margin` | string |  |
| `maintenance_margin` | string |  |
| `margin_type` | string |  |
| `positions` | any[] |  |
| `subaccount_id` | integer (int64) |  |
| `subaccount_value` | string |  |
| `valuation_timestamp` | integer (int64) |  |

### `orderbook.{instrument_name}.{group}.{depth}`

Public channel that periodically publishes aggregated bids and asks for a single instrument, where {instrument_name} is the market (e.g. ETH-PERP), {group} is the price-level aggregation size (1, 10, or 100), and {depth} is the number of levels returned per side (1, 10, 20, or 100).

| Field | Type | Description |
| --- | --- | --- |
| `asks` | string[][] |  |
| `bids` | string[][] |  |
| `instrument_name` | string |  |
| `publish_id` | integer (uint64) |  |
| `timestamp` | integer (int64) |  |

### `spot_feed.{currency}`

Public channel that streams the spot price feed for a given underlying, where {currency} selects the asset (e.g. ETH or BTC).

| Field | Type | Description |
| --- | --- | --- |
| `feeds` | object |  |
| `feeds.{key}` | object |  |
| `feeds.{key}.confidence` | string |  |
| `feeds.{key}.confidence_prev_daily` | string |  |
| `feeds.{key}.price` | string |  |
| `feeds.{key}.price_prev_daily` | string |  |
| `feeds.{key}.timestamp_prev_daily` | integer (int64) |  |
| `timestamp` | integer (int64) |  |

### `{subaccount_id}.balances`

Private channel (requires authentication) that streams balance and position updates for one of your subaccounts, where {subaccount_id} is the numeric subaccount identifier.

| Field | Type | Description |
| --- | --- | --- |
| `name` | string |  |
| `new_balance` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `previous_balance` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `update_type` | enum: `trade`, `asset_deposit`, `asset_withdrawal`, `transfer`, `subaccount_deposit`, `subaccount_withdrawal`, `liquidation`, `liquidator`, `onchain_drift_fix`, `perp_settlement`, `option_settlement`, `interest_accrual`, … |  |

### `{subaccount_id}.best.quotes`

Private channel (requires authentication) that streams best-quote updates relevant to your subaccount, where {subaccount_id} is the numeric subaccount identifier.

| Field | Type | Description |
| --- | --- | --- |
| `error` | object |  |
| `error.code` | integer (int64) |  |
| `error.data` | string |  |
| `error.message` | string |  |
| `result` | object |  |
| `result.best_quote` | object |  |
| `result.best_quote.cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `result.best_quote.creation_timestamp` | integer (int64) |  |
| `result.best_quote.direction` | enum: `buy`, `sell` |  |
| `result.best_quote.fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `result.best_quote.last_update_timestamp` | integer (int64) |  |
| `result.best_quote.legs` | object[] |  |
| `result.best_quote.legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `result.best_quote.legs[].direction` | enum: `buy`, `sell` |  |
| `result.best_quote.legs[].instrument_name` | string |  |
| `result.best_quote.legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `result.best_quote.legs_hash` | string |  |
| `result.best_quote.liquidity_role` | enum: `maker`, `taker` |  |
| `result.best_quote.quote_id` | string (uuid) | UUID v4 string |
| `result.best_quote.rfq_id` | string (uuid) | UUID v4 string |
| `result.best_quote.status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `result.best_quote.subaccount_id` | integer (int64) |  |
| `result.best_quote.wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `result.direction` | enum: `buy`, `sell` |  |
| `result.down_liquidation_price` | string (decimal) | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `result.estimated_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `result.estimated_realized_pnl` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `result.estimated_realized_pnl_excl_fees` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `result.estimated_total_cost` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `result.filled_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `result.invalid_reason` | string |  |
| `result.is_valid` | boolean |  |
| `result.orderbook_total_cost` | string (decimal) | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `result.post_initial_margin` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `result.post_liquidation_price` | string (decimal) | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `result.pre_initial_margin` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `result.suggested_max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `result.up_liquidation_price` | string (decimal) | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `rfq_id` | string (uuid) | UUID v4 string |

### `{subaccount_id}.orders`

Private channel (requires authentication) that streams live order updates (opens, fills, cancels, and status changes) for your subaccount, where {subaccount_id} is the numeric subaccount identifier.

| Field | Type | Description |
| --- | --- | --- |
| `algo_duration_sec` | integer (int32) |  |
| `algo_num_slices` | integer (int32) |  |
| `algo_slices_completed` | integer (int32) |  |
| `algo_type` | enum: `twap` |  |
| `amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `average_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `cancel_reason` | enum: ``, `user_request`, `mmp_trigger`, `insufficient_margin`, `signed_max_fee_too_low`, `cancel_on_disconnect`, `ioc_or_market_partial_fill`, `session_key_deregistered`, `subaccount_withdrawn`, `compliance`, `trigger_failed`, `validation_failed`, … |  |
| `creation_timestamp` | integer (int64) |  |
| `direction` | enum: `buy`, `sell` |  |
| `extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `filled_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `instrument_name` | string |  |
| `is_transfer` | boolean |  |
| `label` | string |  |
| `last_update_timestamp` | integer (int64) |  |
| `limit_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `max_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp` | boolean |  |
| `nonce` | string |  |
| `order_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `order_id` | string |  |
| `order_status` | enum: `open`, `filled`, `rejected`, `cancelled`, `expired`, `untriggered`, `algo_active` |  |
| `order_type` | enum: `limit`, `market` |  |
| `quote_id` | string (uuid) | Optional UUID v4 string |
| `replaced_order_id` | string (uuid) | Optional UUID v4 string |
| `signature` | string |  |
| `signature_expiry_sec` | integer (int64) |  |
| `signed_limit_price` | string (decimal) | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `signer` | string |  |
| `subaccount_id` | integer (int64) |  |
| `time_in_force` | enum: `gtc`, `post_only`, `fok`, `ioc` |  |
| `trigger_price` | string (decimal) | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `trigger_price_type` | enum: `mark`, `index` |  |
| `trigger_reject_message` | string |  |
| `trigger_type` | enum: `stoploss`, `takeprofit` |  |

### `{subaccount_id}.quotes`

Private channel (requires authentication) that streams updates to your RFQ quotes for a subaccount, where {subaccount_id} is the numeric subaccount identifier.

| Field | Type | Description |
| --- | --- | --- |
| `batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` |  |
| `cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `creation_timestamp` | integer (int64) |  |
| `direction` | enum: `buy`, `sell` |  |
| `extra_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `fill_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `is_transfer` | boolean |  |
| `label` | string |  |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs_hash` | string |  |
| `liquidity_role` | enum: `maker`, `taker` |  |
| `max_fee` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `mmp` | boolean |  |
| `nonce` | string |  |
| `quote_id` | string (uuid) | UUID v4 string |
| `rfq_id` | string (uuid) | UUID v4 string |
| `signature` | string |  |
| `signature_expiry_sec` | integer (int64) |  |
| `signer` | string |  |
| `status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `subaccount_id` | integer (int64) |  |
| `tx_hash` | string |  |

### `{subaccount_id}.trades`

Private channel (requires authentication) that streams your subaccount's own trade fills as they occur, where {subaccount_id} is the numeric subaccount identifier.

| Field | Type | Description |
| --- | --- | --- |
| `batch_status` | enum: `Batching`, `Executing`, `Da`, `Proving`, `Settling`, `Settled`, `BatchingError`, `ExecutingError`, `DaError`, `ProvingError`, `SettlingError`, `SettledError` | Settlement batch status; `null` if processed by sequencer. |
| `block_trade_id` | string (uuid) | Optional UUID v4 string |
| `direction` | enum: `buy`, `sell` |  |
| `expected_rebate` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `extra_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `index_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `instrument_name` | string |  |
| `is_transfer` | boolean |  |
| `label` | string |  |
| `liquidity_role` | enum: `maker`, `taker` |  |
| `mark_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `op_uuid` | string |  |
| `order_id` | string |  |
| `quote_id` | string (uuid) | Optional UUID v4 string |
| `realized_pnl` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `realized_pnl_excl_fees` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `rfq_id` | string (uuid) | Optional UUID v4 string |
| `subaccount_id` | integer (int64) |  |
| `timestamp` | integer (int64) |  |
| `trade_amount` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trade_fee` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `trade_id` | string |  |
| `trade_price` | string (decimal) | Decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `tx_hash` | string |  |

### `ticker_slim.{instrument_name}.{interval}`

Public channel that streams a lightweight ticker (prices and key stats) for an instrument, where {instrument_name} is the market and {interval} is the update cadence in milliseconds (100 or 1000).

| Field | Type | Description |
| --- | --- | --- |
| `instrument_ticker` | object |  |
| `instrument_ticker.A` | string | Amount of contracts / tokens available at the best ask price. |
| `instrument_ticker.B` | string | Amount of contracts / tokens available at the best bid price. |
| `instrument_ticker.I` | string | Index price. |
| `instrument_ticker.M` | string | Mark price. |
| `instrument_ticker.a` | string | Best ask price. |
| `instrument_ticker.b` | string | Best bid price. |
| `instrument_ticker.f` | string | Current hourly funding rate (perpetuals only; `null` otherwise). |
| `instrument_ticker.maxp` | string | Maximum price at which an aggressive buyer can be matched. Any portion of a market order that would execute above this price is cancelled. A limit buy order with limit price above this value is treated as post only (i.e. it is rejected if it would cross any e… |
| `instrument_ticker.minp` | string | Minimum price at which an aggressive seller can be matched. Any portion of a market order that would execute below this price is cancelled. A limit sell order with limit price below this value is treated as post only (i.e. it is rejected if it would cross any… |
| `instrument_ticker.option_pricing` | object | Option greeks and implied vols (options only; `null` otherwise). |
| `instrument_ticker.option_pricing.ai` | string | Implied volatility of the current best ask. |
| `instrument_ticker.option_pricing.bi` | string | Implied volatility of the current best bid. |
| `instrument_ticker.option_pricing.d` | string | Delta of the option. |
| `instrument_ticker.option_pricing.df` | string | Discount factor used to calculate the option premium. |
| `instrument_ticker.option_pricing.f` | string | Forward price used to calculate the option premium. |
| `instrument_ticker.option_pricing.g` | string | Gamma of the option. |
| `instrument_ticker.option_pricing.i` | string | Implied volatility of the option. |
| `instrument_ticker.option_pricing.m` | string | Mark price of the option. |
| `instrument_ticker.option_pricing.r` | string | Rho of the option. |
| `instrument_ticker.option_pricing.t` | string | Theta of the option. |
| `instrument_ticker.option_pricing.v` | string | Vega of the option. |
| `instrument_ticker.stats` | object | Trailing 24-hour trading statistics. |
| `instrument_ticker.stats.c` | string (decimal) | Number of contracts traded during last 24 hours |
| `instrument_ticker.stats.h` | string (decimal) | Highest trade price during last 24h |
| `instrument_ticker.stats.l` | string (decimal) | Lowest trade price during last 24h |
| `instrument_ticker.stats.n` | integer (uint64) | Number of trades during last 24h |
| `instrument_ticker.stats.oi` | string (decimal) | Current total open interest |
| `instrument_ticker.stats.p` | string (decimal) | Options: 24hr percent change in premium; Perps: 24hr percent change in mark price |
| `instrument_ticker.stats.pr` | string (decimal) | Premium volume traded during last 24 hours |
| `instrument_ticker.stats.v` | string (decimal) | Notional volume traded during last 24 hours |
| `instrument_ticker.t` | integer (int64) | Snapshot creation timestamp, in milliseconds since the Unix epoch. |
| `timestamp` | integer (int64) |  |

### `trades.{instrument_name}`

Public channel that streams the public trade tape for a single instrument, where {instrument_name} is the market whose fills you want to follow.

| Field | Type | Description |
| --- | --- | --- |
| `block_trade_id` | string |  |
| `direction` | enum: `buy`, `sell` |  |
| `expected_rebate` | string |  |
| `extra_fee` | string |  |
| `index_price` | string |  |
| `instrument_name` | string |  |
| `liquidity_role` | enum: `maker`, `taker` |  |
| `mark_price` | string |  |
| `quote_id` | string |  |
| `realized_pnl` | string |  |
| `realized_pnl_excl_fees` | string |  |
| `rfq_id` | string |  |
| `subaccount_id` | integer (int64) |  |
| `timestamp` | integer (int64) |  |
| `trade_amount` | string |  |
| `trade_fee` | string |  |
| `trade_id` | string |  |
| `trade_price` | string |  |
| `wallet` | string |  |

### `trades.{instrument_type}.{currency}`

Public channel that streams public trades filtered by market category, where {instrument_type} is the kind of instrument (erc20, option, or perp) and {currency} is the underlying asset (e.g. ETH or BTC).

| Field | Type | Description |
| --- | --- | --- |
| `block_trade_id` | string |  |
| `direction` | enum: `buy`, `sell` |  |
| `expected_rebate` | string |  |
| `extra_fee` | string |  |
| `index_price` | string |  |
| `instrument_name` | string |  |
| `liquidity_role` | enum: `maker`, `taker` |  |
| `mark_price` | string |  |
| `quote_id` | string |  |
| `realized_pnl` | string |  |
| `realized_pnl_excl_fees` | string |  |
| `rfq_id` | string |  |
| `subaccount_id` | integer (int64) |  |
| `timestamp` | integer (int64) |  |
| `trade_amount` | string |  |
| `trade_fee` | string |  |
| `trade_id` | string |  |
| `trade_price` | string |  |
| `wallet` | string |  |

### `{wallet}.block_proposals`

Private channel (requires authentication) that streams the block proposals that you made or received as recipient_wallet, where {wallet} is your wallet address in EIP-55 checksummed form. The server does not normalize the case of the channel name, so a subscription with any other casing receives nothing. The maker and the recipient of a proposal receive it when it is sent and when it ends: executed, cancelled, declined or expired. They also receive it with status executing if the outcome of an accept is not known. An accept that fails and leaves the proposal open sends no event. Each event carries the whole proposal, in the private/get_block_proposals shape.

| Field | Type | Description |
| --- | --- | --- |
| `block_trade_id` | string (uuid) | The block trade, once the proposal executes. |
| `creation_timestamp` | integer (int64) |  |
| `currency` | string |  |
| `direction` | enum: `buy`, `sell` | The maker's direction. The taker trades the opposite. |
| `expires_at_sec` | integer (int64) | The last second (UTC) at which the proposal can be accepted. |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `legs[].price` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `listed` | boolean | Whether the proposal is on the public list. |
| `maker_wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |
| `proposal_id` | string (uuid) | UUID v4 string |
| `recipient_wallet` | string | The only wallet that can accept the proposal. Null if any wallet can. |
| `risk_universe_id` | integer (uint32) |  |
| `status` | enum: `open`, `executing`, `executed`, `expired` \| enum: `cancelled` \| enum: `declined` |  |

### `{wallet}.concierge`

Private channel (requires authentication) that streams your conversation with the concierge, where {wallet} is your wallet address in EIP-55 checksummed form. The server does not normalize the case of the channel name, so a subscription with any other casing receives nothing. Each event is either a new message, yours or the concierge's (event message), or the id of a message a moderator removed (event deleted).

| Field | Type | Description |
| --- | --- | --- |
| `creation_timestamp` | integer (int64) |  |
| `event` | enum: `message` |  |
| `message_id` | string (uuid) | UUID v4 string |
| `sender` | enum: `user`, `concierge` | The side of a concierge conversation that sent a message. |
| `text` | string |  |
| `wallet` | string | The user's wallet, whichever side sent the message. |

### `{wallet}.rfqs`

Private channel (requires authentication) that streams RFQ (request-for-quote) updates for all subaccounts under a wallet, where {wallet} is your wallet address.

| Field | Type | Description |
| --- | --- | --- |
| `cancel_reason` | enum: ``, `user_request`, `insufficient_margin`, `signed_max_fee_too_low`, `mmp_trigger`, `cancel_on_disconnect`, `session_key_deregistered`, `subaccount_withdrawn`, `rfq_no_longer_open`, `compliance`, `validation_failed` |  |
| `creation_timestamp` | integer (int64) |  |
| `fill_rate` | string (decimal) | Lifetime taker fill rate as a decimal string; null until the wallet has enough lifetime RFQs for the rate to be meaningful. |
| `filled_direction` | enum: `buy`, `sell` |  |
| `filled_pct` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `last_update_timestamp` | integer (int64) |  |
| `legs` | object[] |  |
| `legs[].amount` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `legs[].direction` | enum: `buy`, `sell` |  |
| `legs[].instrument_name` | string |  |
| `partial_fill_step` | string (decimal) | Non-negative decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits; a string or JSON number is accepted |
| `recent_fill_rate` | string (decimal) | Decayed-recent taker fill rate as a decimal string; null until enough recent RFQ activity has accumulated for the rate to be meaningful. |
| `rfq_id` | string (uuid) | UUID v4 string |
| `status` | enum: `open`, `filled`, `cancelled`, `expired` |  |
| `subaccount_id` | integer (int64) |  |
| `total_cost` | string (decimal) | Optional decimal string of the human value (e.g. `"1.5"`), up to 12 fractional digits, or null; a string or JSON number is accepted |
| `valid_until` | integer (int64) |  |
| `wallet` | string | 20-byte Ethereum address as a 0x-prefixed lowercase hex string. |

