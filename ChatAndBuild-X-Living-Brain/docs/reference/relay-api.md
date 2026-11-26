# Relay — full API reference (mainnet)

Generated 2026-11-23 from Relay's OpenAPI spec (62 paths) by `scripts/gen-endpoint-docs.mjs`. **Mainnet only:** base `https://api.relay.link`.

- Used for BNB Chain ↔ Lighter (chain `3586256`, currency `"0"`, recipient = Lighter account index) and BNB Chain ↔ Ethereum USDC (for Derive). Derive Chain is not supported.
- Core flow: `POST /quote/v2` → execute `steps[].items[].data` → poll `GET /intents/status/v3?requestId=`.

## Contents

- [`POST /kyc/sessions`](#r-post-kyc-sessions)
- [`GET /kyc/status`](#r-get-kyc-status)
- [`GET /app-fees/{wallet}/balances`](#r-get-app-fees-wallet-balances)
- [`POST /app-fees/{wallet}/claim`](#r-post-app-fees-wallet-claim)
- [`GET /app-fees/{wallet}/claims`](#r-get-app-fees-wallet-claims)
- [`GET /balance/{wallet}/events`](#r-get-balance-wallet-events)
- [`GET /chains`](#r-get-chains)
- [`GET /chains/liquidity`](#r-get-chains-liquidity)
- [`GET /chains/health`](#r-get-chains-health)
- [`GET /config`](#r-get-config)
- [`GET /config/v2`](#r-get-config-v2)
- [`GET /deposit-addresses/v1`](#r-get-deposit-addresses-v1)
- [`GET /deposit-addresses/v2`](#r-get-deposit-addresses-v2)
- [`POST /deposit-addresses/{depositAddressId}/disable/v2`](#r-post-deposit-addresses-depositaddressid-disable-v2)
- [`POST /deposit-addresses/{depositAddressId}/update/v2`](#r-post-deposit-addresses-depositaddressid-update-v2)
- [`POST /execute/permits`](#r-post-execute-permits)
- [`POST /execute/permits/v2`](#r-post-execute-permits-v2)
- [`POST /quote`](#r-post-quote)
- [`POST /quote/v2`](#r-post-quote-v2)
- [`POST /quote/v3`](#r-post-quote-v3)
- [`POST /price`](#r-post-price)
- [`POST /execute`](#r-post-execute)
- [`POST /fast-fill`](#r-post-fast-fill)
- [`GET /lives`](#r-get-lives)
- [`GET /intents/status`](#r-get-intents-status)
- [`GET /intents/status/v2`](#r-get-intents-status-v2)
- [`GET /intents/status/v3`](#r-get-intents-status-v3)
- [`POST /orders`](#r-post-orders)
- [`GET /orders`](#r-get-orders)
- [`POST /orders/{orderId}/signature`](#r-post-orders-orderid-signature)
- [`POST /orders/{orderId}/cancel`](#r-post-orders-orderid-cancel)
- [`GET /requests/v2`](#r-get-requests-v2)
- [`GET /requests/v3`](#r-get-requests-v3)
- [`POST /requests/metadata`](#r-post-requests-metadata)
- [`GET /published-requests`](#r-get-published-requests)
- [`POST /requests/exports`](#r-post-requests-exports)
- [`GET /requests/exports/{id}/download`](#r-get-requests-exports-id-download)
- [`POST /transactions/index`](#r-post-transactions-index)
- [`POST /transactions/single`](#r-post-transactions-single)
- [`POST /transactions/deposit-address/reindex`](#r-post-transactions-deposit-address-reindex)
- [`GET /swap-sources`](#r-get-swap-sources)
- [`GET /loadforge.txt`](#r-get-loadforge-txt)
- [`POST /currencies/v1`](#r-post-currencies-v1)
- [`POST /currencies/v2`](#r-post-currencies-v2)
- [`GET /currencies/token/price`](#r-get-currencies-token-price)
- [`GET /currencies/token/price/v2`](#r-get-currencies-token-price-v2)
- [`GET /currencies/trending`](#r-get-currencies-trending)
- [`GET /chains/{chainId}/currencies/{address}`](#r-get-chains-chainid-currencies-address)
- [`GET /chains/{chainId}/currencies/{address}/chart`](#r-get-chains-chainid-currencies-address-chart)
- [`GET /currencies/classifications`](#r-get-currencies-classifications)
- [`POST /provision/chain`](#r-post-provision-chain)
- [`GET /sanctioned/{address}`](#r-get-sanctioned-address)
- [`POST /wallets/screen`](#r-post-wallets-screen)
- [`POST /wallets/screen/override`](#r-post-wallets-screen-override)
- [`GET /wallets/screen/info`](#r-get-wallets-screen-info)
- [`POST /withdrawals/attest-deposit`](#r-post-withdrawals-attest-deposit)
- [`POST /withdrawals/request`](#r-post-withdrawals-request)
- [`GET /withdrawals/status`](#r-get-withdrawals-status)
- [`GET /withdrawals/balances`](#r-get-withdrawals-balances)
- [`POST /access-tokens`](#r-post-access-tokens)
- [`GET /metrics/usage`](#r-get-metrics-usage)
- [`GET /protocol/executions/{id}`](#r-get-protocol-executions-id)
- [`POST /protocol/transfers`](#r-post-protocol-transfers)

<a id="r-post-kyc-sessions"></a>
### `POST /kyc/sessions`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `orderId` | string |  |  |
| `withdrawer` | object |  |  |
| `withdrawer.chainId` | integer | yes |  |
| `withdrawer.address` | string | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `orderId` | string |  |
| `withdrawer` | object |  |
| `withdrawer.chainId` | integer |  |
| `withdrawer.address` | string |  |
| `kyc` | object |  |
| `kyc.status` | enum: `required`, `pending`, `approved`, `resubmission_required`, `rejected` |  |
| `session` | object |  |
| `session.token` | string |  |
| `session.sdk` | object |  |

<a id="r-get-kyc-status"></a>
### `GET /kyc/status`



**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `orderId` | string |  |
| `withdrawer` | object |  |
| `withdrawer.chainId` | integer |  |
| `withdrawer.address` | string |  |
| `kyc` | object |  |
| `kyc.status` | enum: `required`, `pending`, `approved`, `resubmission_required`, `rejected` |  |

<a id="r-get-app-fees-wallet-balances"></a>
### `GET /app-fees/{wallet}/balances`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string (path) | yes | Wallet to get the app fees for |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `balances` | object[] | An array of app fee balances across multiple currencies |
| `balances[].currency` | object |  |
| `balances[].amount` | string |  |
| `balances[].amountFormatted` | string |  |
| `balances[].amountUsd` | string |  |
| `balances[].minimumAmount` | string |  |
| `totalBalanceUsd` | number | Total app fee balance in USD across all currencies. |
| `outstandingFastFillBalanceUsd` | number | Outstanding fast fill balance in USD that has not yet settled. This amount is deducted from the available collateral for new fast fills and claims. |
| `availableBalanceUsd` | number | Total balance minus outstanding fast fill balance. The effective collateral available for new fast fills and claims. |

<a id="r-post-app-fees-wallet-claim"></a>
### `POST /app-fees/{wallet}/claim`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |
| `wallet` | string (path) | yes |  |
| `chainId` | number | yes | Chain id of the currency to claim |
| `currency` | string | yes | Currency to claim |
| `amount` | string |  | Amount to claim |
| `recipient` | string | yes | The recipient of the claimed funds |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `steps` | object[] | An array of steps detailing what needs to be done to claim |
| `steps[].id` | string | Unique identifier tied to the step |
| `steps[].action` | string | A call to action for the step |
| `steps[].description` | string | A short description of the step and what it entails |
| `steps[].kind` | string | The kind of step, for claims this will be `signature` |
| `steps[].items` | object[] | For claims, we'll always have a single `signature` step |

<a id="r-get-app-fees-wallet-claims"></a>
### `GET /app-fees/{wallet}/claims`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `limit` | integer (query) |  | Number of claims to return |
| `continuation` | string (query) |  | Pagination continuation token |
| `wallet` | string (path) | yes | Wallet address to retrieve claim history for |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `claims` | object[] | An array of past app fee claim transactions |
| `claims[].claimId` | string |  |
| `claims[].wallet` | string |  |
| `claims[].recipient` | string |  |
| `claims[].currency` | object |  |
| `claims[].txHash` | string |  |
| `claims[].status` | string |  |
| `claims[].createdAt` | string |  |
| `continuation` | string |  |

<a id="r-get-balance-wallet-events"></a>
### `GET /balance/{wallet}/events`

Balance movements for one wallet: fee sponsorship, fixed-rate settlement, fee credits, deposits and withdrawals. A wallet linked to your integrator returns its full ledger with running balances; any other wallet returns the events your integrator caused on it, plus deposits and settled withdrawals, which are public on-chain. For current balances rather than history, use /app-fees/:wallet/balances.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `requestId` | string (query) |  | Return only events belonging to this request. |
| `requestIds` | string (query) |  | Comma-separated request ids, at most 20 per call. Use a type and time range instead for a reconciliation sweep. |
| `type` | string (query) |  | Comma-separated event types to filter by. Events matching any of the given types are returned. Omit for all. Supported values: fee-credit, fee-sponsorship-payment, fee-sponsorship-refund, gasless-refund, balance-withdraw, balance-deposit, gas-sponsorship-paym… |
| `chainId` | number (query) |  | Restrict to one chain. |
| `currency` | string (query) |  | Restrict to one currency. Pair with `chainId` for non-EVM currencies. |
| `startTimestamp` | number (query) |  | Only events created at or after this unix timestamp, in seconds. |
| `endTimestamp` | number (query) |  | Only events created at or before this unix timestamp, in seconds. |
| `limit` | number (query) |  | Maximum number of events to return per page. |
| `continuation` | string (query) |  | Pagination cursor returned by a previous response. Pass it back to fetch the next page. |
| `wallet` | string (path) | yes | Wallet address. A wallet linked to your integrator returns its full ledger; any other returns the events your integrator caused on it, plus deposits and settled withdrawals, which are public on-chain. |
| `x-api-key` | string (header) |  | API key. Required. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `wallet` | string |  |
| `events` | object[] |  |
| `events[].id` | string | Event identifier. Also the pagination cursor value. |
| `events[].type` | enum: `fee-credit`, `fee-sponsorship-payment`, `fee-sponsorship-refund`, `gasless-refund`, `balance-withdraw`, `balance-deposit`, `gas-sponsorship-payment`, `fixed-rate-credit`, `fixed-rate-debit`, `fixed-bps-pnl`, `fast-fill-hold`, `fast-fill-release`, … |  |
| `events[].requestId` | string | The request this event belongs to. Null for events that are not request-scoped, such as deposits and withdrawals. |
| `events[].wallet` | string |  |
| `events[].delta` | object | Signed change to the balance. Negative amounts are debits. |
| `events[].balanceAfter` | object | Balance after this event. Returned only for a wallet linked to your integrator, where the whole ledger is visible and the running balance reconciles. |
| `events[].details` | object | Type-specific context. Present only where the event carries it; absent on rows written before the field existed. |
| `events[].createdAt` | string |  |
| `continuation` | string |  |

<a id="r-get-chains"></a>
### `GET /chains`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `includeChains` | string (query) |  |  |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `chains` | object[] | An array of supported chains |
| `chains[].id` | number |  |
| `chains[].name` | string |  |
| `chains[].displayName` | string |  |
| `chains[].httpRpcUrl` | string |  |
| `chains[].wsRpcUrl` | string |  |
| `chains[].explorerUrl` | string |  |
| `chains[].explorerName` | string |  |
| `chains[].explorerPaths` | object |  |
| `chains[].depositEnabled` | boolean | If the network supports depositing to this chain, e.g. allows this chain to be set as the destination chain |
| `chains[].depositAddressEnabled` | boolean | If any token on this chain can be a deposit-address input. Routes still require a quote. |
| `chains[].tokenSupport` | enum: `All`, `Limited` |  |
| `chains[].disabled` | boolean | If relaying to and from this chain is disabled |
| `chains[].partialDisableLimit` | number | The value limit at which the chain is partially disabled, if 0, the chain is not partially disabled. i.e, 1000000000000000000 to designate 1 ETH max withdrawal/deposit |
| `chains[].blockProductionLagging` | boolean | If the chain is experiencing issues where blocks are lagging behind or not being produced |
| `chains[].currency` | object |  |
| `chains[].withdrawalFee` | number | The fee in bps for withdrawing from this chain |
| `chains[].depositFee` | number | The fee in bps for depositing to this chain |
| `chains[].surgeEnabled` | boolean | If the chain has surge pricing enabled |
| `chains[].featuredTokens` | object[] | An array of featured erc20 currencies |
| `chains[].erc20Currencies` | object[] | An array of erc20 currencies that the solver accepts directly as input |
| `chains[].solverCurrencies` | object[] | An array of all currencies that the solver accepts directly as input, including native currency if applicable |
| `chains[].iconUrl` | string | The URL to the chain icon |
| `chains[].logoUrl` | string | The URL to the chain logo |
| `chains[].brandColor` | string | Brand color code |
| `chains[].contracts` | object | Relay contract addresses |
| `chains[].vmType` | enum: `bvm`, `evm`, `svm`, `tvm`, `tonvm`, `hypevm`, `lvm`, `xrpvm`, `hederavm`, `atlasvm` | The type of VM the chain runs on |
| `chains[].explorerQueryParams` | object |  |
| `chains[].baseChainId` | number | The chain id which the chain rolls up to. This is always set as Ethereum for L1 chains |
| `chains[].statusMessage` | string | If applicable, a status message for the chain |
| `chains[].solverAddresses` | string[] | An array of solver addresses in use on the chain, including active multi-EOA and VM-specific service signer addresses. |
| `chains[].tags` | string[] |  |
| `chains[].protocol` | object |  |

<a id="r-get-chains-liquidity"></a>
### `GET /chains/liquidity`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `chainId` | number (query) | yes |  |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `liquidity` | object[] | Available solver balances per configured currency on the requested chain. |
| `liquidity[].chainId` | number |  |
| `liquidity[].currencyId` | string |  |
| `liquidity[].symbol` | string |  |
| `liquidity[].address` | string |  |
| `liquidity[].decimals` | number |  |
| `liquidity[].balance` | string | Main EOA solver balance in the currency's smallest unit (e.g. wei for ETH) |
| `liquidity[].amountUsd` | string | Solver balance expressed in USD |

<a id="r-get-chains-health"></a>
### `GET /chains/health`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `chainId` | string (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `healthy` | boolean | A boolean indicating if the chain is healthy (true) or not (false) |

<a id="r-get-config"></a>
### `GET /config`

 **(deprecated)**

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `originChainId` | string (query) | yes |  |
| `destinationChainId` | string (query) | yes |  |
| `user` | string (query) |  | User address, when supplied returns user balance and max bridge amount |
| `currency` | string (query) |  | Restricts the user balance and capacity to a particular currency when supplied with a currency address. Defaults to native currency |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `enabled` | boolean |  |
| `user` | object |  |
| `user.balance` | string | Balance on the origin chain in the native or supplied currency |
| `user.maxBridgeAmount` | string | Maximum amount that the user can bridge after fees in the native or supplied currency |
| `solver` | object |  |
| `solver.address` | string |  |
| `solver.balance` | string | Balance of the solver on the destination chain. Denoted in wei |
| `solver.capacityPerRequest` | string | How much of the given currency is available to be bridged per bridge request. Denoted in wei |
| `supportsExternalLiquidity` | boolean | Deprecated: canonical plus bridging has been removed, so this is always false |
| `deprecation` | object |  |
| `deprecation.message` | string |  |
| `deprecation.deprecatedAt` | string |  |
| `deprecation.throttledFrom` | string |  |
| `deprecation.sunsetAt` | string |  |
| `deprecation.successor` | string |  |
| `deprecation.migrationGuide` | string |  |

<a id="r-get-config-v2"></a>
### `GET /config/v2`

 **(deprecated)**

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `originChainId` | string (query) | yes |  |
| `destinationChainId` | string (query) | yes |  |
| `user` | string (query) |  | User address, when supplied returns user balance and max bridge amount |
| `currency` | enum: `btc`, `kbtc`, `cirbtc`, `cgt`, `dai`, `eth`, `pop`, `tg7`, `tia`, `usdc`, `usdc.e`, `usdt`, … (query) |  | Restricts the user balance and capacity to a particular currency when supplied with a currency id. Defaults to the native currency of the destination chain. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `enabled` | boolean |  |
| `user` | object |  |
| `user.balance` | string | Balance on the origin chain in the native or supplied currency |
| `user.maxBridgeAmount` | string | Maximum amount that the user can bridge after fees in the native or supplied currency |
| `fee` | string | Total fee in the native or supplied currency for the bridge operation |
| `solver` | object |  |
| `solver.address` | string |  |
| `solver.balance` | string | Balance of the solver on the destination chain. Denoted in wei |
| `solver.capacityPerRequest` | string | How much of the given currency is available to be bridged per bridge request. Denoted in wei |
| `supportsExternalLiquidity` | boolean | Deprecated: canonical plus bridging has been removed, so this is always false |
| `deprecation` | object |  |
| `deprecation.message` | string |  |
| `deprecation.deprecatedAt` | string |  |
| `deprecation.throttledFrom` | string |  |
| `deprecation.sunsetAt` | string |  |
| `deprecation.successor` | string |  |
| `deprecation.migrationGuide` | string |  |

<a id="r-get-deposit-addresses-v1"></a>
### `GET /deposit-addresses/v1`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `address` | string (query) |  | The deposit address to look up. Provide either `address` or `requestId`. |
| `requestId` | string (query) |  | The original requestId the deposit address was created for. Provide either `address` or `requestId`. |
| `x-api-key` | string (header) |  | API key for authentication. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `depositAddress` | string | The deposit address. |
| `type` | enum: `open`, `strict` | The deposit address type. |
| `requestId` | string | The original requestId the deposit address was created for. |
| `chainId` | number | The chain the deposit address was created on. |
| `createdAt` | string | ISO 8601 timestamp of when the deposit address was created. |
| `currency` | string | Origin currency id from the originating quote request. Null when the quote request is unavailable. |
| `refundTo` | string | Refund address from the originating quote request. Null when unset or the quote request is unavailable. |

<a id="r-get-deposit-addresses-v2"></a>
### `GET /deposit-addresses/v2`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `address` | string (query) |  |  |
| `depositAddressId` | string (query) |  |  |
| `pageSize` | integer (query) |  |  |
| `pageToken` | string (query) |  |  |
| `x-api-key` | string (header) |  | API key for authentication. |
| `x-dev-portal-key` | string (header) |  | Developer portal key for authentication. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `data` | object |  |
| `data.depositAddress` | object |  |
| `data.deposits` | object[] |  |
| `data.sweeps` | object[] |  |
| `data.fills` | object[] |  |
| `data.refunds` | object[] |  |
| `data.recoveryCases` | object[] |  |
| `data.nextPageToken` | string |  |
| `timestamp` | string |  |

<a id="r-post-deposit-addresses-depositaddressid-disable-v2"></a>
### `POST /deposit-addresses/{depositAddressId}/disable/v2`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `depositAddressId` | string (path) | yes |  |
| `x-api-key` | string (header) |  | API key for authentication. |
| `x-dev-portal-key` | string (header) |  | Developer portal key for authentication. |

**Response**

_none_

<a id="r-post-deposit-addresses-depositaddressid-update-v2"></a>
### `POST /deposit-addresses/{depositAddressId}/update/v2`

Update a Deposit Address V2 that the caller's integrator owns. Omitted fields keep their current value. New pricing applies to deposits quoted after the update. A first deposit that matches the original quote keeps that quote until it expires.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `depositAddressId` | string (path) | yes |  |
| `x-api-key` | string (header) |  | API key for authentication. |
| `x-dev-portal-key` | string (header) |  | Developer portal key for authentication. It cannot change pricing. |
| `isEnabled` | boolean |  | Whether the address accepts new deposits. A one-time address cannot be enabled after it receives a deposit. |
| `fixedRate` | string |  | Fixed rate as 'input:output', for example '1:1'. Use null to remove it. Only the API key that created the address can change it. |
| `subsidizeFees` | boolean |  | Whether the API key's sponsoring wallet pays the fees. Only the API key that created the address can change it. |
| `sponsoredFeeComponents` | enum: `execution`, `swap`, `relay`, `app`, `rent`[] |  | Fee components to sponsor. Requires subsidizeFees: true. If omitted, the address keeps its current components. |
| `maxSubsidizationAmount` | string |  | The max subsidization amount in USDC decimal format, e.g 1000000 = $1. Use null to remove the cap. Requires subsidizeFees: true. If omitted, the address keeps its current cap. |

**Response**

_none_

<a id="r-post-execute-permits"></a>
### `POST /execute/permits`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `signature` | string (query) | yes | The permit signature. |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |
| `kind` | string | yes | The kind of signature. This value is returned in the quote API steps body field. e.g eip3009, permit2 or multicall-authorization (the extra EIP-712 signature of the approval proxy 3.1+ EIP-3009 flow, to be posted before the eip3009 signature) |
| `requestId` | string | yes | The requestId of the quote this permit signature applies to. Returned in the quote API steps body field. |
| `api` | enum: `bridge`, `swap`, `user-swap` |  | The API value returned from the quote API steps body field. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `message` | string |  |
| `steps` | object[] |  |
| `steps[].id` | string |  |
| `steps[].action` | string |  |
| `steps[].description` | string |  |
| `steps[].kind` | string |  |
| `steps[].items` | object[] |  |

<a id="r-post-execute-permits-v2"></a>
### `POST /execute/permits/v2`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `signature` | string (query) | yes | The permit signature. |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |
| `kind` | string | yes | The kind of signature. This value is returned in the quote API steps body field. e.g eip3009, permit2 or multicall-authorization (the extra EIP-712 signature of the approval proxy 3.1+ EIP-3009 flow, to be posted before the eip3009 signature) |
| `requestId` | string | yes | The requestId of the quote this permit signature applies to. Returned in the quote API steps body field. |
| `api` | enum: `bridge`, `swap`, `user-swap` |  | The API value returned from the quote API steps body field. Required for permit2 and eip3009; optional for other kinds. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `message` | string |  |
| `steps` | object[] |  |
| `steps[].id` | string | Step kind identifier; IDs may repeat. Execute steps in array order. |
| `steps[].action` | string |  |
| `steps[].description` | string |  |
| `steps[].kind` | string |  |
| `steps[].status` | string |  |
| `steps[].data` | object |  |
| `steps[].depositAddress` | object |  |
| `steps[].depositAddressId` | string |  |
| `steps[].check` | object |  |

<a id="r-post-quote"></a>
### `POST /quote`

This endpoint is deprecated. Use /quote/v2 instead. **(deprecated)**

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |
| `user` | string | yes | Address that is depositing funds on the origin chain and submitting transactions or signatures |
| `recipient` | string |  | Address that is receiving the funds on the destination chain, if not specified then this will default to the user address |
| `originChainId` | number | yes |  |
| `destinationChainId` | number | yes |  |
| `originCurrency` | string | yes |  |
| `destinationCurrency` | string | yes |  |
| `amount` | string | yes | Amount to swap as the base amount (can be switched to exact input/output using the dedicated flag), denoted in the smallest unit of the specified currency (e.g., wei for ETH) |
| `tradeType` | enum: `EXACT_INPUT`, `EXACT_OUTPUT`, `EXPECTED_OUTPUT` | yes | Whether to use the amount as the output or the input for the basis of the swap |
| `txs` | object[] |  |  |
| `txs[].to` | string |  |  |
| `txs[].value` | string |  |  |
| `txs[].data` | string |  |  |
| `txs[].originalTxValue` | string |  |  |
| `txsGasLimit` | number |  | Total gas limit for the destination chain call transactions |
| `authorizationList` | object[] |  | Authorization list for EIP-7702 transactions to be executed on destination chain |
| `authorizationList[].chainId` | number | yes |  |
| `authorizationList[].address` | string | yes |  |
| `authorizationList[].nonce` | number | yes |  |
| `authorizationList[].yParity` | number | yes |  |
| `authorizationList[].r` | string | yes |  |
| `authorizationList[].s` | string | yes |  |
| `additionalData` | object |  | Additional data needed for specific routes |
| `additionalData.userPublicKey` | string |  | If the request originates from Bitcoin and the user is a P2SH address, the public key is needed to be able to generate the transaction data |
| `referrer` | string |  |  |
| `referrerAddress` | string |  |  |
| `refundTo` | string |  | Address to send the refund to in the case of failure, if not specified then the recipient address or user address is used |
| `recoveryAddress` | string |  | Origin-chain address used for deposit-address fund recovery. Requires useDepositAddress=true. |
| `refundOnOrigin` | boolean |  | Always refund on the origin chain in case of any issues |
| `topupGas` | boolean |  | If set, the destination fill will include a gas topup to the recipient (only supported for EVM chains if the requested currency is not the gas currency on the destination chain) |
| `topupGasAmount` | string |  | The destination gas topup amount in USD decimal format, e.g 100000 = $1. topupGas is required to be enabled. Defaults to 2000000 ($2) |
| `enableTrueExactOutput` | boolean |  | Enabling will send any swap surplus when doing exact output operations to the solver EOA, otherwise it will be swept to the recipient |
| `explicitDeposit` | boolean |  | Enable this to avoid direct transfers to the depository (only relevant for EVM and v2 protocol flow) |
| `useExternalLiquidity` | boolean |  | Deprecated: canonical+ bridging has been removed and this flag is ignored |
| `useFallbacks` | boolean |  | Deprecated: fallback routes have been removed and this flag is ignored |
| `usePermit` | boolean |  | Enable this to use permit (eip3009) when bridging, only works on supported currency such as usdc |
| `permitExpiry` | number |  | How long the permit remains valid, in seconds: an integer from 60 to 86399, or 0 for the default of 600 (10 minutes), which also applies when omitted. Use at least 120, since some permits take several minutes to land. |
| `useMulticallAuthorization` | boolean |  | Opt into the two signature EIP-3009 permit flow of approval proxy 3.1+. The authorize step then starts with a MulticallAuthorization signature item (posted to /execute/permits with kind multicall-authorization, no status check) followed by the EIP-3009 author… |
| `includeProtocolData` | boolean |  | Return protocol data for on-chain intent validation. This includes protocol.v2.orderSignature and may increase quote latency. |
| `swapContractsVersion` | enum: `v3`, `v3.2` |  | Require exact swap contracts on each EVM leg, overriding the App pin. v3 means 3.0. Unavailable versions and incompatible permit flows return 400 instead of falling back. Only supported for swap execution kinds. |
| `useDepositAddress` | boolean |  | Use a deposit address when calldata cannot be sent with the origin transaction. In /quote/v2, creation follows the requested trade type. |
| `strict` | boolean |  | Makes the deposit address one-time use. On /quote/v2, EXACT_OUTPUT addresses are always one-time use. |
| `slippageTolerance` | string |  | Slippage tolerance for the swap, if not specified then the slippage tolerance is automatically calculated to avoid front-running. This value is in basis points (1/100th of a percent), e.g. 50 for 0.5% slippage. Must be 0–10000 bps. |
| `latePaymentSlippageTolerance` | string |  | Slippage tolerance for destination gas in the event that the deposit occurs after the order deadline, and more gas is required for the solver to execute the destination transaction. Must be 0–10000 bps. |
| `appFees` | object[] |  |  |
| `appFees[].recipient` | string |  | Address that will receive the app fee |
| `appFees[].fee` | string |  | App fees to be charged for execution in basis points, e.g. 100 = 1% |
| `gasLimitForDepositSpecifiedTxs` | number |  | If the request involves specifying transactions to be executed during the deposit transaction, an explicit gas limit must be set when requesting the quote |
| `forceSolverExecution` | boolean |  | Force executing swap requests via the solver (by default, same-chain swap requests are self-executed) |
| `subsidizeFees` | boolean |  | If the sponsor should pay for the fees associated with the request. Includes gas topup amounts. |
| `sponsoredFeeComponents` | enum: `execution`, `swap`, `relay`, `app`, `rent`[] |  | The fee components to sponsor for swap execution kinds. Requires subsidizeFees=true. Defaults to execution, swap, relay, and app when omitted; rent remains user-paid unless explicitly selected. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | string | A unique identifier for the quote |
| `warnings` | object[] | Present when a request parameter was accepted but not applied to the quote, omitted otherwise. The only code today is FIXED_RATE_NOT_APPLIED; more codes may be added. |
| `warnings[].code` | enum: `FIXED_RATE_NOT_APPLIED` |  |
| `warnings[].message` | string |  |
| `steps` | object[] | An array of steps detailing what needs to be done to complete the bridge or swap. Each step contains a single item, either a signature or a transaction |
| `steps[].id` | enum: `deposit`, `approve`, `authorize`, `authorize1`, `authorize2`, `swap`, `send` | Unique identifier tied to the step |
| `steps[].action` | string | A call to action for the step |
| `steps[].description` | string | A short description of the step and what it entails |
| `steps[].kind` | string | The kind of step, can either be a transaction or a signature. Transaction steps require submitting a transaction while signature steps require submitting a signature |
| `steps[].requestId` | string | A unique identifier for this step, tying all related transactions together |
| `steps[].depositAddress` | string | The deposit address for the bridge request |
| `steps[].depositAddressId` | string | The Deposit Address service resource identifier |
| `steps[].items` | object[] | The item to execute for this step. A step always contains exactly one item, matching the kind of the step (transaction or signature). |
| `fees` | object |  |
| `fees.gas` | object | Origin chain gas fee |
| `fees.relayer` | object | Combination of the relayerGas and relayerService to give you the full relayer fee |
| `fees.relayerGas` | object | Destination chain gas fee |
| `fees.relayerService` | object | Fees paid to the relay solver, note that this value can be negative (which represents network rewards for moving in a direction that optimizes liquidity distribution) |
| `fees.app` | object | Fees paid to the app. Currency will be the same as the relayer fee currency. This needs to be claimed later by the app owner and is not immediately distributed to the app |
| `fees.subsidized` | object | The amount of fees for the request that are subsidized by the request sponsor. Does not include deposit origin gas unless it is a permit based deposit. |
| `feeSponsorship` | object | Granular fee sponsorship details derived from the solver's internal sponsorship resolution. |
| `feeSponsorship.quoted` | object | The quote-time sponsorship expectation for the request. |
| `feeSponsorship.actual` | object | The post-solve sponsorship outcome recorded for the request. |
| `details` | object | A summary of the swap and what the user should expect to happen given an input |
| `details.operation` | string | The operation that will be performed, possible options are send, swap, wrap, unwrap, bridge |
| `details.sender` | string | The address that deposited the funds |
| `details.recipient` | string | The address that will be receiving the swap output |
| `details.currencyIn` | object |  |
| `details.currencyOut` | object |  |
| `details.refundCurrency` | object |  |
| `details.currencyGasTopup` | object |  |
| `details.totalImpact` | object | The difference between the input and output values, including fees |
| `details.swapImpact` | object | The impact of the swap, not factoring in fees |
| `details.expandedPriceImpact` | object |  |
| `details.rate` | string | The swap rate which is equal to 1 input unit in the output unit, e.g. 1 USDC -> x ETH. This value can fluctuate based on gas and fees. |
| `details.slippageTolerance` | object |  |
| `details.timeEstimate` | number | Estimated swap time in seconds |
| `details.userBalance` | string | The user's balance in the given currency on the origin chain |
| `details.isFixedRate` | boolean | Whether the rate for the quote is fixed or dynamic (swap on origin/destination). Always true when operation is send. It does not report whether a requested fixedRate was applied; warnings does. |
| `details.fixedRateFee` | object | The USD cost of the fixed rate vs market rate. Positive means the fixed rate is worse than market (user pays premium), negative means better (user benefits). Only present for fixed rate quotes. |
| `details.route` | object |  |
| `protocol` | object | Protocol information for the quote |
| `protocol.v2` | object |  |

<a id="r-post-quote-v2"></a>
### `POST /quote/v2`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |
| `user` | string | yes | Address that is depositing funds on the origin chain and submitting transactions or signatures |
| `recipient` | string |  | Address that is receiving the funds on the destination chain, if not specified then this will default to the user address |
| `originChainId` | number | yes |  |
| `destinationChainId` | number | yes |  |
| `originCurrency` | string | yes |  |
| `destinationCurrency` | string | yes |  |
| `amount` | string | yes | Amount to swap as the base amount (can be switched to exact input/output using the dedicated flag), denoted in the smallest unit of the specified currency (e.g., wei for ETH) |
| `tradeType` | enum: `EXACT_INPUT`, `EXACT_OUTPUT`, `EXPECTED_OUTPUT` | yes | Whether to use the amount as the output or the input for the basis of the swap |
| `txs` | object[] |  |  |
| `txs[].to` | string |  |  |
| `txs[].value` | string |  |  |
| `txs[].data` | string |  |  |
| `txs[].originalTxValue` | string |  |  |
| `txsGasLimit` | number |  | Total gas limit for the destination chain call transactions |
| `authorizationList` | object[] |  | Authorization list for EIP-7702 transactions to be executed on destination chain |
| `authorizationList[].chainId` | number | yes |  |
| `authorizationList[].address` | string | yes |  |
| `authorizationList[].nonce` | number | yes |  |
| `authorizationList[].yParity` | number | yes |  |
| `authorizationList[].r` | string | yes |  |
| `authorizationList[].s` | string | yes |  |
| `additionalData` | object |  | Additional data needed for specific routes |
| `additionalData.userPublicKey` | string |  | If the request originates from Bitcoin and the user is a P2SH address, the public key is needed to be able to generate the transaction data |
| `referrer` | string |  |  |
| `referrerAddress` | string |  |  |
| `refundTo` | string |  | Address to send the refund to in the case of failure, if not specified then the recipient address or user address is used |
| `recoveryAddress` | string |  | Origin-chain address used for deposit-address fund recovery. Requires useDepositAddress=true. |
| `refundOnOrigin` | boolean |  | Always refund on the origin chain in case of any issues |
| `topupGas` | boolean |  | If set, the destination fill will include a gas topup to the recipient (only supported for EVM chains if the requested currency is not the gas currency on the destination chain) |
| `topupGasAmount` | string |  | The destination gas topup amount in USD decimal format, e.g 100000 = $1. topupGas is required to be enabled. Defaults to 2000000 ($2) |
| `enableTrueExactOutput` | boolean |  | Enabling will send any swap surplus when doing exact output operations to the solver EOA, otherwise it will be swept to the recipient |
| `explicitDeposit` | boolean |  | Enable this to avoid direct transfers to the depository (only relevant for EVM and v2 protocol flow) |
| `useExternalLiquidity` | boolean |  | Deprecated: canonical+ bridging has been removed and this flag is ignored |
| `useFallbacks` | boolean |  | Deprecated: fallback routes have been removed and this flag is ignored |
| `usePermit` | boolean |  | Enable this to use permit (eip3009) when bridging, only works on supported currency such as usdc |
| `permitExpiry` | number |  | How long the permit remains valid, in seconds: an integer from 60 to 86399, or 0 for the default of 600 (10 minutes), which also applies when omitted. Use at least 120, since some permits take several minutes to land. |
| `useMulticallAuthorization` | boolean |  | Opt into the two signature EIP-3009 permit flow of approval proxy 3.1+. The authorize step then starts with a MulticallAuthorization signature item (posted to /execute/permits with kind multicall-authorization, no status check) followed by the EIP-3009 author… |
| `includeProtocolData` | boolean |  | Return protocol data for on-chain intent validation. This includes protocol.v2.orderSignature and may increase quote latency. |
| `swapContractsVersion` | enum: `v3`, `v3.2` |  | Require exact swap contracts on each EVM leg, overriding the App pin. v3 means 3.0. Unavailable versions and incompatible permit flows return 400 instead of falling back. Only supported for swap execution kinds. |
| `useDepositAddress` | boolean |  | Use a deposit address when calldata cannot be sent with the origin transaction. In /quote/v2, creation follows the requested trade type. |
| `strict` | boolean |  | Makes the deposit address one-time use. On /quote/v2, EXACT_OUTPUT addresses are always one-time use. |
| `slippageTolerance` | string |  | Slippage tolerance for the swap, if not specified then the slippage tolerance is automatically calculated to avoid front-running. This value is in basis points (1/100th of a percent), e.g. 50 for 0.5% slippage. Must be 0–10000 bps. |
| `latePaymentSlippageTolerance` | string |  | Slippage tolerance for destination gas in the event that the deposit occurs after the order deadline, and more gas is required for the solver to execute the destination transaction. Must be 0–10000 bps. |
| `appFees` | object[] |  |  |
| `appFees[].recipient` | string |  | Address that will receive the app fee |
| `appFees[].fee` | string |  | App fees to be charged for execution in basis points, e.g. 100 = 1% |
| `gasLimitForDepositSpecifiedTxs` | number |  | If the request involves specifying transactions to be executed during the deposit transaction, an explicit gas limit must be set when requesting the quote |
| `forceSolverExecution` | boolean |  | Force executing swap requests via the solver (by default, same-chain swap requests are self-executed) |
| `subsidizeFees` | boolean |  | If the sponsor should pay for the fees associated with the request. Includes gas topup amounts. |
| `sponsoredFeeComponents` | enum: `execution`, `swap`, `relay`, `app`, `rent`[] |  | The fee components to sponsor for swap execution kinds. Requires subsidizeFees=true. Defaults to execution, swap, relay, and app when omitted; rent remains user-paid unless explicitly selected. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | string | A unique identifier for the quote |
| `warnings` | object[] | Present when a request parameter was accepted but not applied to the quote, omitted otherwise. The only code today is FIXED_RATE_NOT_APPLIED; more codes may be added. |
| `warnings[].code` | enum: `FIXED_RATE_NOT_APPLIED` |  |
| `warnings[].message` | string |  |
| `steps` | object[] | An array of steps detailing what needs to be done to complete the bridge or swap. Each step contains a single item, either a signature or a transaction |
| `steps[].id` | enum: `deposit`, `approve`, `authorize`, `authorize1`, `authorize2`, `swap`, `send` | Unique identifier tied to the step |
| `steps[].action` | string | A call to action for the step |
| `steps[].description` | string | A short description of the step and what it entails |
| `steps[].kind` | string | The kind of step, can either be a transaction or a signature. Transaction steps require submitting a transaction while signature steps require submitting a signature |
| `steps[].requestId` | string | A unique identifier for this step, tying all related transactions together |
| `steps[].depositAddress` | string | The deposit address for the bridge request |
| `steps[].depositAddressId` | string | The Deposit Address service resource identifier |
| `steps[].items` | object[] | The item to execute for this step. A step always contains exactly one item, matching the kind of the step (transaction or signature). |
| `fees` | object |  |
| `fees.gas` | object | Origin chain gas fee |
| `fees.relayer` | object | Combination of the relayerGas and relayerService to give you the full relayer fee |
| `fees.relayerGas` | object | Destination chain gas fee |
| `fees.relayerService` | object | Fees paid to the relay solver, note that this value can be negative (which represents network rewards for moving in a direction that optimizes liquidity distribution) |
| `fees.app` | object | Fees paid to the app. Currency will be the same as the relayer fee currency. This needs to be claimed later by the app owner and is not immediately distributed to the app |
| `fees.subsidized` | object | The amount of fees for the request that are subsidized by the request sponsor. Does not include deposit origin gas unless it is a permit based deposit. |
| `feeSponsorship` | object | Granular fee sponsorship details derived from the solver's internal sponsorship resolution. |
| `feeSponsorship.quoted` | object | The quote-time sponsorship expectation for the request. |
| `feeSponsorship.actual` | object | The post-solve sponsorship outcome recorded for the request. |
| `details` | object | A summary of the swap and what the user should expect to happen given an input |
| `details.operation` | string | The operation that will be performed, possible options are send, swap, wrap, unwrap, bridge |
| `details.sender` | string | The address that deposited the funds |
| `details.recipient` | string | The address that will be receiving the swap output |
| `details.currencyIn` | object |  |
| `details.currencyOut` | object |  |
| `details.refundCurrency` | object |  |
| `details.currencyGasTopup` | object |  |
| `details.totalImpact` | object | The difference between the input and output values, including fees |
| `details.swapImpact` | object | The impact of the swap, not factoring in fees |
| `details.expandedPriceImpact` | object |  |
| `details.rate` | string | The swap rate which is equal to 1 input unit in the output unit, e.g. 1 USDC -> x ETH. This value can fluctuate based on gas and fees. |
| `details.slippageTolerance` | object |  |
| `details.timeEstimate` | number | Estimated swap time in seconds |
| `details.userBalance` | string | The user's balance in the given currency on the origin chain |
| `details.isFixedRate` | boolean | Whether the rate for the quote is fixed or dynamic (swap on origin/destination). Always true when operation is send. It does not report whether a requested fixedRate was applied; warnings does. |
| `details.fixedRateFee` | object | The USD cost of the fixed rate vs market rate. Positive means the fixed rate is worse than market (user pays premium), negative means better (user benefits). Only present for fixed rate quotes. |
| `details.route` | object |  |
| `protocol` | object | Protocol information for the quote |
| `protocol.v2` | object |  |

<a id="r-post-quote-v3"></a>
### `POST /quote/v3`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) |  | API key. Alternatively, authenticate with an API session bearer token. |
| `authorization` | string (header) |  | API session bearer token. |
| `user` | string | yes | Address that is depositing funds on the origin chain and submitting transactions or signatures |
| `recipient` | string |  | Address that is receiving the funds on the destination chain, if not specified then this will default to the user address |
| `originChainId` | number | yes |  |
| `destinationChainId` | number | yes |  |
| `originCurrency` | string | yes |  |
| `destinationCurrency` | string | yes |  |
| `preferredSolverFillCurrency` | string |  | Preferred solver fill currency address on the destination chain. Falls back to default routing when the preference is not routeable. |
| `preferredSolverDepositCurrency` | string |  | Preferred solver deposit currency address on the origin chain. Falls back to default routing when the preference is not routeable. |
| `amount` | string | yes | Amount to swap as the base amount (can be switched to exact input/output using the dedicated flag), denoted in the smallest unit of the specified currency (e.g., wei for ETH) |
| `tradeType` | enum: `EXACT_INPUT`, `EXACT_OUTPUT`, `EXPECTED_OUTPUT` | yes | Whether to use the amount as the output or the input for the basis of the swap |
| `txs` | object[] |  |  |
| `txs[].to` | string | yes |  |
| `txs[].value` | string | yes |  |
| `txs[].data` | string | yes |  |
| `txs[].originalTxValue` | string |  |  |
| `txsGasLimit` | number |  | Total gas limit for the destination chain call transactions |
| `authorizationList` | object[] |  | Authorization list for EIP-7702 transactions to be executed on destination chain |
| `authorizationList[].chainId` | number | yes |  |
| `authorizationList[].address` | string | yes |  |
| `authorizationList[].nonce` | number | yes |  |
| `authorizationList[].yParity` | number | yes |  |
| `authorizationList[].r` | string | yes |  |
| `authorizationList[].s` | string | yes |  |
| `additionalData` | object |  | Additional data needed for specific routes |
| `additionalData.userPublicKey` | string |  | If the request originates from Bitcoin and the user is a P2SH address, the public key is needed to be able to generate the transaction data |
| `referrer` | string |  |  |
| `referrerAddress` | string |  |  |
| `refundTo` | string |  | Address to send the refund to in the case of failure, if not specified then the recipient address or user address is used |
| `recoveryAddress` | string |  | Origin-chain address used for deposit-address fund recovery. Requires useDepositAddress=true. |
| `refundOnOrigin` | boolean |  | Always refund on the origin chain in case of any issues |
| `topupGas` | boolean |  | If set, the destination fill will include a gas topup to the recipient (only supported for EVM chains if the requested currency is not the gas currency on the destination chain) |
| `topupGasAmount` | string |  | The destination gas topup amount in USD with 6 decimal places, e.g. 100000 = $0.10 and 1000000 = $1. Ignored unless topupGas is true. Defaults to 2000000 ($2). |
| `enableTrueExactOutput` | boolean |  | Enabling will send any swap surplus when doing exact output operations to the solver EOA, otherwise it will be swept to the recipient |
| `explicitDeposit` | boolean |  | Enable this to avoid direct transfers to the depository (only relevant for EVM and v2 protocol flow) |
| `usePermit` | boolean |  | Enable this to use permit (eip3009) when bridging, only works on supported currency such as usdc |
| `permitExpiry` | number |  | How long the permit remains valid, in seconds: an integer from 60 to 86399, or 0 for the default of 600 (10 minutes), which also applies when omitted. Use at least 120, since some permits take several minutes to land. |
| `useMulticallAuthorization` | boolean |  | Opt into the two signature EIP-3009 permit flow of approval proxy 3.1+. The authorize step then starts with a MulticallAuthorization signature item (posted to /execute/permits with kind multicall-authorization, no status check) followed by the EIP-3009 author… |
| `includeProtocolData` | boolean |  | Return protocol data for on-chain intent validation. This includes protocol.v2.orderSignature and may increase quote latency. |
| `swapContractsVersion` | enum: `v3`, `v3.2` |  | Require exact swap contracts on each EVM leg, overriding the App pin. v3 means 3.0. Unavailable versions and incompatible permit flows return 400 instead of falling back. Only supported for swap execution kinds. |
| `useDepositAddress` | boolean |  | Use a deposit address when calldata cannot be sent with the origin transaction. In /quote/v2, creation follows the requested trade type. |
| `strict` | boolean |  | Makes the deposit address one-time use. On /quote/v2, EXACT_OUTPUT addresses are always one-time use. |
| `slippageTolerance` | string |  | Slippage tolerance for the swap, if not specified then the slippage tolerance is automatically calculated to avoid front-running. This value is in basis points (1/100th of a percent), e.g. 50 for 0.5% slippage. Must be 0–10000 bps. |
| `latePaymentSlippageTolerance` | string |  | Slippage tolerance for destination gas in the event that the deposit occurs after the order deadline, and more gas is required for the solver to execute the destination transaction. Must be 0–10000 bps. |
| `appFees` | object[] |  |  |
| `appFees[].recipient` | string |  | Address that will receive the app fee |
| `appFees[].fee` | string | yes | App fees to be charged for execution in basis points, e.g. 100 = 1% |
| `gasLimitForDepositSpecifiedTxs` | number |  | If the request involves specifying transactions to be executed during the deposit transaction, an explicit gas limit must be set when requesting the quote |
| `forceSolverExecution` | boolean |  | Force executing swap requests via the solver (by default, same-chain swap requests are self-executed) |
| `subsidizeFees` | boolean |  | If the sponsor should pay for the fees associated with the request. Includes gas topup amounts. |
| `sponsoredFeeComponents` | enum: `execution`, `swap`, `platform`, `app`, `rent`[] |  | The fee components to sponsor for swap execution kinds. Requires subsidizeFees=true. Defaults to execution, swap, platform, and app when omitted; rent remains user-paid unless explicitly selected. Use platform, not the legacy relay name. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `requestId` | string |  |
| `warnings` | object[] | Present when a requested fixedRate was not applied, omitted otherwise. More warning codes may be added. |
| `warnings[].code` | enum: `FIXED_RATE_NOT_APPLIED` |  |
| `warnings[].message` | string |  |
| `steps` | object[] |  |
| `steps[].id` | string | Step kind identifier; IDs may repeat. Execute steps in array order. |
| `steps[].action` | string |  |
| `steps[].description` | string |  |
| `steps[].kind` | string |  |
| `steps[].status` | string |  |
| `steps[].data` | any |  |
| `steps[].depositAddress` | object |  |
| `steps[].depositAddressId` | string |  |
| `steps[].check` | object |  |
| `fees` | object |  |
| `fees.swap` | object | Cost to execute a swap or bridge depending on available liquidity. Negative USD values represent costs; positive USD values represent network rewards for improving liquidity distribution. |
| `fees.execution` | object | Fees paid to cover transaction execution costs |
| `fees.platform` | object | Fees paid to the protocol |
| `fees.app` | object | Fees paid to the app. Currency will be the same as the relayer fee currency. This needs to be claimed later by the app owner and is not immediately distributed to the app |
| `fees.sponsored` | object | Fees paid by a sponsor for this request |
| `fees.currency` | object |  |
| `originGas` | object | Estimated origin gas paid separately by the wallet, including required approvals. Omitted when the amount is zero or the solver pays origin gas through execution fees. |
| `originGas.currency` | object |  |
| `originGas.amount` | string |  |
| `originGas.amountFormatted` | string |  |
| `originGas.amountUsd` | string |  |
| `originGas.minimumAmount` | string |  |
| `feeSponsorship` | object | Granular fee sponsorship details derived from the solver's internal sponsorship resolution. |
| `feeSponsorship.quoted` | object | The quote-time sponsorship expectation for the request. |
| `feeSponsorship.actual` | object | The post-solve sponsorship outcome recorded for the request. |
| `feeSponsorship.currency` | object | The currency in which all sponsorship amounts are denominated. Shared across all nested amount objects. |
| `details` | object | A summary of the swap and what the user should expect to happen given an input |
| `details.operation` | string | The operation that will be performed, possible options are send, swap, wrap, unwrap, bridge |
| `details.sender` | string | The address that deposited the funds |
| `details.recipient` | string | The address that will be receiving the swap output |
| `details.currencyIn` | object |  |
| `details.currencyOut` | object |  |
| `details.refundCurrency` | object |  |
| `details.currencyGasTopup` | object |  |
| `details.totalImpact` | object | The difference between the input and output values, including fees |
| `details.swapImpact` | object | The impact of the swap, not factoring in fees |
| `details.rate` | string | The swap rate which is equal to 1 input unit in the output unit, e.g. 1 USDC -> x ETH. This value can fluctuate based on gas and fees. |
| `details.slippageTolerance` | object |  |
| `details.timeEstimate` | number | Estimated swap time in seconds |
| `details.userBalance` | string | The user's balance in the given currency on the origin chain |
| `details.isFixedRate` | boolean | Whether the rate for the quote is fixed or dynamic (swap on origin/destination). Always true for sends. It does not report whether a requested fixedRate was applied; warnings does. |
| `details.fixedRateFee` | object | The USD cost of the fixed rate vs market rate. Positive means the fixed rate is worse than market (user pays premium), negative means better (user benefits). Only present for fixed rate quotes. |
| `details.route` | object |  |
| `protocol` | object | Protocol information for the quote |
| `protocol.v2` | object |  |

<a id="r-post-price"></a>
### `POST /price`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `user` | string | yes | Address that is depositing funds on the origin chain and submitting transactions or signatures |
| `recipient` | string |  | Address that is receiving the funds on the destination chain, if not specified then this will default to the user address |
| `originChainId` | number | yes |  |
| `destinationChainId` | number | yes |  |
| `originCurrency` | string | yes |  |
| `destinationCurrency` | string | yes |  |
| `amount` | string | yes | Amount to swap as the base amount (can be switched to exact input/output using the dedicated flag), denoted in the smallest unit of the specified currency (e.g., wei for ETH) |
| `tradeType` | enum: `EXACT_INPUT`, `EXACT_OUTPUT`, `EXPECTED_OUTPUT` | yes | Whether to use the amount as the output or the input for the basis of the swap |
| `txs` | object[] |  |  |
| `txs[].to` | string |  |  |
| `txs[].value` | string |  |  |
| `txs[].data` | string |  |  |
| `referrer` | string |  |  |
| `refundTo` | string |  | Address to send the refund to in the case of failure, if not specified then the recipient address or user address is used |
| `refundOnOrigin` | boolean |  | Always refund on the origin chain in case of any issues |
| `useExternalLiquidity` | boolean |  | Deprecated: canonical+ bridging has been removed and this flag is ignored |
| `useFallbacks` | boolean |  | Deprecated: fallback routes have been removed and this flag is ignored |
| `usePermit` | boolean |  | Enable this to use permit (eip3009) when bridging, only works on supported currency such as usdc |
| `useDepositAddress` | boolean |  | Enable this to use a deposit address when bridging, in scenarios where calldata cannot be sent alongside the transaction. only works on native currency bridges. |
| `slippageTolerance` | string |  | Slippage tolerance for the swap, if not specified then the slippage tolerance is automatically calculated to avoid front-running. This value is in basis points (1/100th of a percent), e.g. 50 for 0.5% slippage. Must be 0–10000 bps. |
| `appFees` | object[] |  |  |
| `appFees[].recipient` | string |  | Address that will receive the app fee |
| `appFees[].fee` | string |  | App fees to be charged for execution in basis points, e.g. 100 = 1% |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `fees` | object |  |
| `fees.gas` | object | Origin chain gas fee |
| `fees.relayer` | object | Combination of the relayerGas and relayerService to give you the full relayer fee |
| `fees.relayerGas` | object | Destination chain gas fee |
| `fees.relayerService` | object | Fees paid to the relay solver, note that this value can be negative (which represents network rewards for moving in a direction that optimizes liquidity distribution) |
| `fees.app` | object | Fees paid to the app. Currency will be the same as the relayer fee currency. This needs to be claimed later by the app owner and is not immediately distributed to the app |
| `fees.subsidized` | object | The amount of fees for the request that are subsidized by the request sponsor. Does not include deposit origin gas unless it is a permit based deposit. |
| `details` | object | A summary of the swap and what the user should expect to happen given an input |
| `details.operation` | string | The operation that will be performed, possible options are send, swap, wrap, unwrap, bridge |
| `details.sender` | string | The address that deposited the funds |
| `details.recipient` | string | The address that will be receiving the swap output |
| `details.currencyIn` | object |  |
| `details.currencyOut` | object |  |
| `details.totalImpact` | object | The difference between the input and output values, including fees |
| `details.swapImpact` | object | The impact of the swap, not factoring in fees |
| `details.rate` | string | The swap rate which is equal to 1 input unit in the output unit, e.g. 1 USDC -> x ETH. This value can fluctuate based on gas and fees. |
| `details.slippageTolerance` | object |  |
| `details.timeEstimate` | number | Estimated swap time in seconds |
| `details.userBalance` | string | The user's balance in the given currency on the origin chain |

<a id="r-post-execute"></a>
### `POST /execute`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) | yes | Required API key for authentication. Contact the team for getting an API Key |
| `executionKind` | enum: `rawCalls` | yes | The kind of gasless transaction to execute. Currently supported: rawCalls |
| `data` | object | yes | Raw call parameters for the gasless transaction |
| `data.chainId` | integer | yes | Chain ID of the EVM network |
| `data.to` | string | yes | Address of the contract to call |
| `data.data` | string | yes | Encoded function call data |
| `data.value` | string | yes | ETH value to send with the call (in wei) |
| `data.authorizationList` | object[] |  | Authorization list for EIP-7702 transactions to be executed on destination chain |
| `executionOptions` | object | yes | Options related to gas fee sponsorship, app referrer and destination calls |
| `executionOptions.referrer` | string |  | The referrer of the app which is executing the gasless transaction |
| `executionOptions.subsidizeFees` | boolean | yes | If the app should pay for the fees associated with the request |
| `executionOptions.destinationChainExecutionData` | object |  | Destination execution data for the gasless transaction |
| `requestId` | string |  | The request ID of the gasless transaction to execute |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `message` | string |  |
| `requestId` | string |  |

<a id="r-post-fast-fill"></a>
### `POST /fast-fill`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) | yes | Required API key for authentication. Contact the team for getting an API Key |
| `requestId` | string | yes | The request ID of the request that needs to be fast filled |
| `solverInputCurrencyAmount` | string |  | Optional solver input amount observed on origin, in raw base units. For an EXACT_INPUT or EXPECTED_OUTPUT quote with an origin swap it must be between the quote's minimum amount and the quoted amount; otherwise it must equal the quoted amount. Omit to use the… |
| `maxFillAmountUsd` | number |  | Optional per-request USD limit. If the computed fill value exceeds this amount, the request is rejected. Must be lower than or equal to the app's available USDC balance. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `message` | string |  |

<a id="r-get-lives"></a>
### `GET /lives`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `withReport` | string (query) |  |  |
| `skipPostgres` | string (query) |  |  |
| `skipRedis` | string (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `status` | string |  |
| `report` | object |  |
| `report.version` | string |  |

<a id="r-get-intents-status"></a>
### `GET /intents/status`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `requestId` | string (query) |  | A unique id representing the execution in the Relay system. You can obtain this id from the requests api or the check object within the step items. |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `status` | enum: `failure`, `fallback`, `pending`, `received`, `success` | Note that fallback is returned in the case of a refund |
| `details` | string |  |
| `inTxHashes` | string[] | Incoming transaction hashes |
| `txHashes` | string[] | Outgoing transaction hashes |
| `time` | number | The last timestamp the data was updated |
| `originChainId` | number |  |
| `destinationChainId` | number |  |

<a id="r-get-intents-status-v2"></a>
### `GET /intents/status/v2`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `requestId` | string (query) |  | A unique id representing the execution in the Relay system. You can obtain this id from the requests api or the check object within the step items. |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `status` | enum: `refund`, `waiting`, `depositing`, `failure`, `pending`, `success` |  |
| `details` | string |  |
| `inTxHashes` | string[] | Incoming transaction hashes |
| `txHashes` | string[] | Outgoing transaction hashes |
| `time` | number | The last timestamp the data was updated |
| `originChainId` | number |  |
| `destinationChainId` | number |  |
| `quoteCreatedAt` | number | The timestamp when the quote request was created |

<a id="r-get-intents-status-v3"></a>
### `GET /intents/status/v3`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `requestId` | string (query) |  | A unique id representing the execution in the Relay system. You can obtain this id from the requests api or the check object within the step items. |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `status` | enum: `refund`, `waiting`, `depositing`, `failure`, `pending`, `submitted`, `success` |  |
| `details` | string |  |
| `inTxHashes` | string[] | Incoming transaction hashes |
| `txHashes` | string[] | Outgoing transaction hashes |
| `updatedAt` | number | The last timestamp the data was updated |
| `originChainId` | number |  |
| `destinationChainId` | number |  |
| `quoteCreatedAt` | number | The timestamp when the quote request was created |
| `failReason` | enum: `UNKNOWN`, `SLIPPAGE`, `AMOUNT_TOO_LOW_TO_REFUND`, `DEPOSIT_ADDRESS_MISMATCH`, `DEPOSIT_CHAIN_MISMATCH`, `INCORRECT_DEPOSIT_CURRENCY`, `DOUBLE_SPEND`, `SOLVER_CAPACITY_EXCEEDED`, `SOLVER_BALANCE_TOO_LOW`, `DEPOSITED_AMOUNT_TOO_LOW_TO_FILL`, `NEGATIVE_NEW_AMOUNT_AFTER_FEES`, `NO_QUOTES`, … |  |
| `refundFailReason` | enum: `AMOUNT_TOO_LOW_TO_REFUND`, `NEGATIVE_NEW_AMOUNT_AFTER_FEES`, `SWAP_CURRENCY_NOT_ON_ORIGIN`, `REFUND_RECIPIENT_IS_VASP`, `REFUND_RECIPIENT_IS_BLOCKED`, `MANUAL_REFUND_REQUIRED` |  |
| `revertReason` | string | Raw contract output for debugging only; do not show it to end users. The decoded revert reason when a failed or refunded request reverted on chain or in simulation: the Error(string) message, Panic(0x..) code, known custom error name, or 4-byte selector of an… |

<a id="r-post-orders"></a>
### `POST /orders`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) |  | API key for authentication. |
| `idempotency-key` | string (header) |  | Makes a retried create safe: the same key and body return the first order, the same key with another body is rejected. Scoped to the integrator |
| `type` | enum: `limit` | yes |  |
| `user` | string | yes | Funds the order on the origin chain and signs it |
| `recipient` | string |  | Receives the output; defaults to user |
| `refundTo` | string |  | Receives refunds on the origin chain; defaults to user |
| `side` | enum: `buy`, `sell` | yes |  |
| `targetCurrency` | string | yes | Currency to buy or sell |
| `targetChainId` | number | yes |  |
| `settlementCurrency` | string | yes | An accepted stablecoin |
| `settlementChainId` | number | yes |  |
| `targetPrice` | string | yes | USD per unit of targetCurrency, all-in. Sell: minimum net proceeds per unit. Buy: maximum total cost per unit |
| `amount` | string | yes | Base units of the currency spent: targetCurrency for a sell, settlementCurrency for a buy |
| `expiresAt` | string (date-time) | yes | RFC 3339 time at which the order expires; at least 15 minutes and at most 7 days from now |
| `appFees` | object[] |  |  |
| `appFees[].recipient` | string | yes |  |
| `appFees[].fee` | string | yes |  |
| `subsidizeFees` | boolean |  |  |
| `sponsoredFeeComponents` | enum: `execution`, `swap`, `relay`, `app`, `rent`[] |  | Requires subsidizeFees; defaults to all but rent |
| `maxSubsidizationAmount` | string |  |  |
| `subsidizationBps` | integer |  |  |
| `clientOrderId` | string |  | The integrator's own id for the order; an integrator can use each id once |
| `forceFailure` | boolean |  | Testing only: every fill fails after the order's funds are pulled, so Relay holds them until the order is cancelled or expires |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `order` | object |  |
| `order.id` | string |  |
| `order.clientOrderId` | string | The id the integrator gave the order at create; null when it gave none |
| `order.orderHash` | string | EIP-712 hash of the order the user signs |
| `order.type` | enum: `limit` |  |
| `order.status` | enum: `pending`, `open`, `processing`, `requires_action`, `closed` |  |
| `order.outcome` | enum: `filled`, `cancelled`, `expired` | How a closed order ended; null until the order closes. `cancelled` and `expired` also cover an order whose funds were pulled and sent back, which `refundedAmount` shows. An order whose funds can be neither delivered nor sent back does not close: it stays `req… |
| `order.cancellationReason` | enum: `requested`, `access_revoked` | Who cancelled the order: `requested` by its owner, `access_revoked` when its app lost access to limit orders; null unless the outcome is `cancelled` |
| `order.requiredAction` | enum: `compliance_review`, `manual_refund` | What Relay has to do before the order can close: `compliance_review` of a wallet check that stopped its fill, or a `manual_refund` of funds whose refund could not be sent; null unless the status is `requires_action` |
| `order.user` | string |  |
| `order.recipient` | string |  |
| `order.refundTo` | string |  |
| `order.side` | enum: `buy`, `sell` |  |
| `order.targetCurrency` | string |  |
| `order.targetChainId` | number |  |
| `order.settlementCurrency` | string |  |
| `order.settlementChainId` | number |  |
| `order.targetPrice` | string |  |
| `order.originChainId` | number |  |
| `order.originCurrency` | string |  |
| `order.destinationChainId` | number |  |
| `order.destinationCurrency` | string |  |
| `order.amount` | string |  |
| `order.appFees` | object[] |  |
| `order.subsidizeFees` | boolean |  |
| `order.sponsoredFeeComponents` | enum: `execution`, `swap`, `relay`, `app`, `rent`[] |  |
| `order.maxSubsidizationAmount` | string |  |
| `order.subsidizationBps` | number |  |
| `order.fees` | object |  |
| `order.createdAt` | string |  |
| `order.updatedAt` | string |  |
| `order.expiresAt` | string |  |
| `order.closedAt` | string |  |
| `order.requestIds` | string[] | The requests that moved the order's funds |
| `order.filledAmount` | string | Base units of the destination currency delivered to the recipient |
| `order.refundedAmount` | string | Base units refunded, in the currency the order's funds were held in when the refund was sent: the origin currency, or the currency an origin swap converted it to |
| `order.withdrawnAmount` | string | Base units withdrawn by the owner, in the currency the order's funds were held in |
| `order.steps` | object[] | What the owner still has to sign or send for the order, in order; empty when nothing is asked of the owner |
| `order.latestPriceCheck` | object | The latest check of the order's price; null until the order is checked for the first time |
| `order.closestPriceCheck` | object | The check whose all-in price came closest to `targetPrice`: the one with the best all-in price so far, the highest for a sell and the lowest for a buy, and the latest of several at that price. Once a check reached `targetPrice` this is the check furthest past… |

<a id="r-get-orders"></a>
### `GET /orders`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `orderId` | string (query) |  |  |
| `appId` | string (query) |  | Only the orders created by this app of the integrator |
| `user` | string (query) |  |  |
| `status` | string (query) |  | Comma-separated order statuses |
| `originChainId` | number (query) |  |  |
| `destinationChainId` | number (query) |  |  |
| `limit` | number (query) |  |  |
| `continuation` | string (query) |  |  |
| `startTimestamp` | number (query) |  | Unix seconds; filters on the sortBy field |
| `endTimestamp` | number (query) |  | Unix seconds; filters on the sortBy field |
| `sortBy` | enum: `createdAt`, `updatedAt` (query) |  |  |
| `sortDirection` | enum: `asc`, `desc` (query) |  |  |
| `x-api-key` | string (header) |  | API key for authentication. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `orders` | object[] |  |
| `orders[].id` | string |  |
| `orders[].clientOrderId` | string | The id the integrator gave the order at create; null when it gave none |
| `orders[].orderHash` | string | EIP-712 hash of the order the user signs |
| `orders[].type` | enum: `limit` |  |
| `orders[].status` | enum: `pending`, `open`, `processing`, `requires_action`, `closed` |  |
| `orders[].outcome` | enum: `filled`, `cancelled`, `expired` | How a closed order ended; null until the order closes. `cancelled` and `expired` also cover an order whose funds were pulled and sent back, which `refundedAmount` shows. An order whose funds can be neither delivered nor sent back does not close: it stays `req… |
| `orders[].cancellationReason` | enum: `requested`, `access_revoked` | Who cancelled the order: `requested` by its owner, `access_revoked` when its app lost access to limit orders; null unless the outcome is `cancelled` |
| `orders[].requiredAction` | enum: `compliance_review`, `manual_refund` | What Relay has to do before the order can close: `compliance_review` of a wallet check that stopped its fill, or a `manual_refund` of funds whose refund could not be sent; null unless the status is `requires_action` |
| `orders[].user` | string |  |
| `orders[].recipient` | string |  |
| `orders[].refundTo` | string |  |
| `orders[].side` | enum: `buy`, `sell` |  |
| `orders[].targetCurrency` | string |  |
| `orders[].targetChainId` | number |  |
| `orders[].settlementCurrency` | string |  |
| `orders[].settlementChainId` | number |  |
| `orders[].targetPrice` | string |  |
| `orders[].originChainId` | number |  |
| `orders[].originCurrency` | string |  |
| `orders[].destinationChainId` | number |  |
| `orders[].destinationCurrency` | string |  |
| `orders[].amount` | string |  |
| `orders[].appFees` | object[] |  |
| `orders[].subsidizeFees` | boolean |  |
| `orders[].sponsoredFeeComponents` | enum: `execution`, `swap`, `relay`, `app`, `rent`[] |  |
| `orders[].maxSubsidizationAmount` | string |  |
| `orders[].subsidizationBps` | number |  |
| `orders[].fees` | object |  |
| `orders[].createdAt` | string |  |
| `orders[].updatedAt` | string |  |
| `orders[].expiresAt` | string |  |
| `orders[].closedAt` | string |  |
| `orders[].requestIds` | string[] | The requests that moved the order's funds |
| `orders[].filledAmount` | string | Base units of the destination currency delivered to the recipient |
| `orders[].refundedAmount` | string | Base units refunded, in the currency the order's funds were held in when the refund was sent: the origin currency, or the currency an origin swap converted it to |
| `orders[].withdrawnAmount` | string | Base units withdrawn by the owner, in the currency the order's funds were held in |
| `orders[].steps` | object[] | What the owner still has to sign or send for the order, in order; empty when nothing is asked of the owner |
| `orders[].latestPriceCheck` | object | The latest check of the order's price; null until the order is checked for the first time |
| `orders[].closestPriceCheck` | object | The check whose all-in price came closest to `targetPrice`: the one with the best all-in price so far, the highest for a sell and the lowest for a buy, and the latest of several at that price. Once a check reached `targetPrice` this is the check furthest past… |
| `continuation` | string |  |
| `status` | enum: `waiting`, `success`, `failure` | Only with `orderId`, for the `check` of the `authorize` step: `waiting` until the order is signed, `success` once it is, `failure` when it closed unsigned |
| `txHashes` | string[] | Only with `orderId`. Always empty: signing an order sends no transaction |

<a id="r-post-orders-orderid-signature"></a>
### `POST /orders/{orderId}/signature`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `signature` | string (query) |  | The permit signature, where every step `post` takes it. Required unless the body carries it |
| `orderId` | string (path) | yes |  |
| `x-api-key` | string (header) |  | API key for authentication. |
| `signature` | string |  | The permit signature, read only when the query carries none. Required when the query has no signature |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `order` | object |  |
| `order.id` | string |  |
| `order.clientOrderId` | string | The id the integrator gave the order at create; null when it gave none |
| `order.orderHash` | string | EIP-712 hash of the order the user signs |
| `order.type` | enum: `limit` |  |
| `order.status` | enum: `pending`, `open`, `processing`, `requires_action`, `closed` |  |
| `order.outcome` | enum: `filled`, `cancelled`, `expired` | How a closed order ended; null until the order closes. `cancelled` and `expired` also cover an order whose funds were pulled and sent back, which `refundedAmount` shows. An order whose funds can be neither delivered nor sent back does not close: it stays `req… |
| `order.cancellationReason` | enum: `requested`, `access_revoked` | Who cancelled the order: `requested` by its owner, `access_revoked` when its app lost access to limit orders; null unless the outcome is `cancelled` |
| `order.requiredAction` | enum: `compliance_review`, `manual_refund` | What Relay has to do before the order can close: `compliance_review` of a wallet check that stopped its fill, or a `manual_refund` of funds whose refund could not be sent; null unless the status is `requires_action` |
| `order.user` | string |  |
| `order.recipient` | string |  |
| `order.refundTo` | string |  |
| `order.side` | enum: `buy`, `sell` |  |
| `order.targetCurrency` | string |  |
| `order.targetChainId` | number |  |
| `order.settlementCurrency` | string |  |
| `order.settlementChainId` | number |  |
| `order.targetPrice` | string |  |
| `order.originChainId` | number |  |
| `order.originCurrency` | string |  |
| `order.destinationChainId` | number |  |
| `order.destinationCurrency` | string |  |
| `order.amount` | string |  |
| `order.appFees` | object[] |  |
| `order.subsidizeFees` | boolean |  |
| `order.sponsoredFeeComponents` | enum: `execution`, `swap`, `relay`, `app`, `rent`[] |  |
| `order.maxSubsidizationAmount` | string |  |
| `order.subsidizationBps` | number |  |
| `order.fees` | object |  |
| `order.createdAt` | string |  |
| `order.updatedAt` | string |  |
| `order.expiresAt` | string |  |
| `order.closedAt` | string |  |
| `order.requestIds` | string[] | The requests that moved the order's funds |
| `order.filledAmount` | string | Base units of the destination currency delivered to the recipient |
| `order.refundedAmount` | string | Base units refunded, in the currency the order's funds were held in when the refund was sent: the origin currency, or the currency an origin swap converted it to |
| `order.withdrawnAmount` | string | Base units withdrawn by the owner, in the currency the order's funds were held in |
| `order.steps` | object[] | What the owner still has to sign or send for the order, in order; empty when nothing is asked of the owner |
| `order.latestPriceCheck` | object | The latest check of the order's price; null until the order is checked for the first time |
| `order.closestPriceCheck` | object | The check whose all-in price came closest to `targetPrice`: the one with the best all-in price so far, the highest for a sell and the lowest for a buy, and the latest of several at that price. Once a check reached `targetPrice` this is the check furthest past… |

<a id="r-post-orders-orderid-cancel"></a>
### `POST /orders/{orderId}/cancel`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `orderId` | string (path) | yes |  |
| `x-api-key` | string (header) |  | API key for authentication. |
| `onchain` | boolean |  | Also return the transaction that invalidates the order's Permit2 nonce |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `order` | object |  |
| `order.id` | string |  |
| `order.clientOrderId` | string | The id the integrator gave the order at create; null when it gave none |
| `order.orderHash` | string | EIP-712 hash of the order the user signs |
| `order.type` | enum: `limit` |  |
| `order.status` | enum: `pending`, `open`, `processing`, `requires_action`, `closed` |  |
| `order.outcome` | enum: `filled`, `cancelled`, `expired` | How a closed order ended; null until the order closes. `cancelled` and `expired` also cover an order whose funds were pulled and sent back, which `refundedAmount` shows. An order whose funds can be neither delivered nor sent back does not close: it stays `req… |
| `order.cancellationReason` | enum: `requested`, `access_revoked` | Who cancelled the order: `requested` by its owner, `access_revoked` when its app lost access to limit orders; null unless the outcome is `cancelled` |
| `order.requiredAction` | enum: `compliance_review`, `manual_refund` | What Relay has to do before the order can close: `compliance_review` of a wallet check that stopped its fill, or a `manual_refund` of funds whose refund could not be sent; null unless the status is `requires_action` |
| `order.user` | string |  |
| `order.recipient` | string |  |
| `order.refundTo` | string |  |
| `order.side` | enum: `buy`, `sell` |  |
| `order.targetCurrency` | string |  |
| `order.targetChainId` | number |  |
| `order.settlementCurrency` | string |  |
| `order.settlementChainId` | number |  |
| `order.targetPrice` | string |  |
| `order.originChainId` | number |  |
| `order.originCurrency` | string |  |
| `order.destinationChainId` | number |  |
| `order.destinationCurrency` | string |  |
| `order.amount` | string |  |
| `order.appFees` | object[] |  |
| `order.subsidizeFees` | boolean |  |
| `order.sponsoredFeeComponents` | enum: `execution`, `swap`, `relay`, `app`, `rent`[] |  |
| `order.maxSubsidizationAmount` | string |  |
| `order.subsidizationBps` | number |  |
| `order.fees` | object |  |
| `order.createdAt` | string |  |
| `order.updatedAt` | string |  |
| `order.expiresAt` | string |  |
| `order.closedAt` | string |  |
| `order.requestIds` | string[] | The requests that moved the order's funds |
| `order.filledAmount` | string | Base units of the destination currency delivered to the recipient |
| `order.refundedAmount` | string | Base units refunded, in the currency the order's funds were held in when the refund was sent: the origin currency, or the currency an origin swap converted it to |
| `order.withdrawnAmount` | string | Base units withdrawn by the owner, in the currency the order's funds were held in |
| `order.steps` | object[] | What the owner still has to sign or send for the order, in order; empty when nothing is asked of the owner |
| `order.latestPriceCheck` | object | The latest check of the order's price; null until the order is checked for the first time |
| `order.closestPriceCheck` | object | The check whose all-in price came closest to `targetPrice`: the one with the best all-in price so far, the highest for a sell and the lowest for a buy, and the latest of several at that price. Once a check reached `targetPrice` this is the check furthest past… |

<a id="r-get-requests-v2"></a>
### `GET /requests/v2`

 **(deprecated)**

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `limit` | number (query) |  | Maximum number of requests to return per page. |
| `continuation` | string (query) |  | Pagination cursor returned by a previous response. Pass it back to fetch the next page. |
| `user` | string (query) |  | Filter requests where this address is the sender or recipient. |
| `hash` | string (query) |  | Filter requests by an origin or destination transaction hash. |
| `originChainId` | number (query) |  | Filter requests where this is the origin chain. |
| `destinationChainId` | number (query) |  | Filter requests where this is the destination chain. Non-terminal requests are only returned to the API key that created them, or to a dev-portal key of the same integrator. |
| `privateChainsToInclude` | string (query) |  | Comma-separated list of private chain UUIDs to include in the results. |
| `id` | string (query) |  | Filter by `requestId` — the Relay-level intent identifier returned by the quote api. Used for status polling, webhooks, and most other API endpoints. |
| `orderId` | string (query) |  | Filter by `orderId` — the protocol-level deposit identifier passed as `bytes32 id` to the Relay Depository when funds are deposited, and emitted in the deposit event. |
| `includeOrderData` | boolean (query) |  | When true, include `orderData`; public non-terminal requests omit it entirely. |
| `startTimestamp` | number (query) |  | Filter requests created at or after this Unix timestamp (seconds). |
| `endTimestamp` | number (query) |  | Filter requests created at or before this Unix timestamp (seconds). |
| `startBlock` | number (query) |  | Filter requests by origin-chain block number (inclusive lower bound). |
| `endBlock` | number (query) |  | Filter requests by origin-chain block number (inclusive upper bound). |
| `chainId` | string (query) |  | Get all requests for a single chain in either direction. Setting originChainId and/or destinationChainId will override this parameter. Non-terminal requests are only returned to the API key that created them, or to a dev-portal key of the same integrator. |
| `referrer` | string (query) |  | Filter requests by the `referrer` value supplied at quote time. |
| `depositAddress` | string (query) |  | Filter requests by deposit address. Returns all requests associated with this deposit address. |
| `includeChildRequests` | boolean (query) |  | When filtering by id or depositAddress, also return child transactions (e.g. duplicates, retries, refunds) linked to the original request. |
| `includeAuthenticatedData` | boolean (query) |  | When true, include fields available only to the authenticating integrator for their own requests. |
| `status` | enum: `success`, `failure`, `refund`, `pending`, `depositing` (query) |  | Filter requests by status. |
| `apiKey` | string (query) |  | Filter requests by the API key that created them. |
| `sortBy` | enum: `createdAt`, `updatedAt` (query) |  | Field to sort by. |
| `sortDirection` | enum: `asc`, `desc` (query) |  | Sort direction. |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `requests` | object[] |  |
| `requests[].id` | string | The `requestId` — the Relay-level intent identifier used across the API for status polling, webhooks, and most other endpoints. Distinct from `protocol.orderId`, which is the protocol-level deposit identifier extractable from on-chain data. |
| `requests[].status` | enum: `refund`, `waiting`, `depositing`, `failure`, `pending`, `success` | Note that fallback is returned in the case of a refund |
| `requests[].user` | string | The address that initiated the request. |
| `requests[].recipient` | string | The address that receives the destination output. |
| `requests[].depositAddress` | object |  |
| `requests[].data` | object |  |
| `requests[].protocol` | object |  |
| `requests[].orderData` | any |  |
| `requests[].referrer` | string |  |
| `requests[].moonpayId` | string |  |
| `requests[].createdAt` | string |  |
| `requests[].updatedAt` | string |  |
| `continuation` | string |  |
| `deprecation` | object |  |
| `deprecation.message` | string |  |
| `deprecation.deprecatedAt` | string |  |
| `deprecation.throttledFrom` | string |  |
| `deprecation.sunsetAt` | string |  |
| `deprecation.successor` | string |  |
| `deprecation.migrationGuide` | string |  |

<a id="r-get-requests-v3"></a>
### `GET /requests/v3`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `limit` | number (query) |  | Maximum number of requests to return per page. |
| `continuation` | string (query) |  | Pagination cursor returned by a previous response. Pass it back to fetch the next page. |
| `includeTotal` | boolean (query) |  | When true, also compute and return the total count of requests matching these filters (ignores limit/continuation). Adds latency — omit unless the total is needed. |
| `user` | string (query) |  | Filter requests by wallet address — matches requests where this address is the sender or the deposit-address depositor. |
| `term` | string (query) |  | Broad term search across request ID, wallet, deposit address, and all transaction hashes (deposit, fill, refund, failed, and chain entry transaction IDs). Use `id`, `depositTxHash`, `fillTxHash`, or `refundTxHash` for targeted single-field lookups. |
| `id` | string (query) |  | Filter by requestId — the Relay-level intent identifier returned by the quote API. |
| `orderId` | string (query) |  | Filter by protocol-level orderId. |
| `depositTxHash` | string (query) |  | Filter by deposit transaction hash. |
| `fillTxHash` | string (query) |  | Filter by fill transaction hash. |
| `refundTxHash` | string (query) |  | Filter by refund transaction hash. |
| `originChainId` | number (query) |  | Filter requests where this is the origin chain. |
| `destinationChainId` | number (query) |  | Filter requests where this is the destination chain. Requests are limited to the caller’s integrator and requests without an API key. |
| `chainId` | number (query) |  | Get all requests for a single chain in either direction. Overridden by originChainId / destinationChainId. Requests are limited to the caller’s integrator and requests without an API key. |
| `privateChainsToInclude` | string (query) |  | Comma-separated list of private chain UUIDs to include in results. |
| `depositAddress` | string (query) |  | Filter requests associated with this deposit address. |
| `recipient` | string (query) |  | Filter requests where this address is the recipient. |
| `status` | enum: `success`, `failure`, `refund`, `pending`, `depositing` (query) |  | Filter requests by status. |
| `failReason` | enum: `UNKNOWN`, `SLIPPAGE`, `AMOUNT_TOO_LOW_TO_REFUND`, `DEPOSIT_ADDRESS_MISMATCH`, `DEPOSIT_CHAIN_MISMATCH`, `INCORRECT_DEPOSIT_CURRENCY`, `DOUBLE_SPEND`, `SOLVER_CAPACITY_EXCEEDED`, `SOLVER_BALANCE_TOO_LOW`, `DEPOSITED_AMOUNT_TOO_LOW_TO_FILL`, `NEGATIVE_NEW_AMOUNT_AFTER_FEES`, `NO_QUOTES`, … (query) |  | Filter requests by failure reason. Only returns requests that failed with this specific reason. |
| `refundFailReason` | enum: `AMOUNT_TOO_LOW_TO_REFUND`, `NEGATIVE_NEW_AMOUNT_AFTER_FEES`, `SWAP_CURRENCY_NOT_ON_ORIGIN`, `REFUND_RECIPIENT_IS_VASP`, `REFUND_RECIPIENT_IS_BLOCKED`, `MANUAL_REFUND_REQUIRED` (query) |  | Filter requests by refund failure reason. |
| `apiKey` | string (query) |  | Filter requests by API key. Accepts a single value or a comma-separated list (OR matching). Maximum 50 values across apiKey and apiKeyId. |
| `appId` | string (query) |  | Filter by App IDs (app_id_<uuid>, comma-separated, maximum 50) owned by your integrator. Matches indexed App attribution across current and revoked keys. |
| `apiKeyId` | string (query) |  | Filter by API key IDs (lowercase key_id_<uuid>, comma-separated), owned by your integrator. OR matching with apiKey; maximum 50 values combined. |
| `requestType` | string (query) |  | Filter requests by requestType (case-insensitive). Supported values: Bridge, Crosschain Swap, Same-chain Swap, Send, Wrap, Unwrap, Call. |
| `referrer` | string (query) |  | Filter requests by the exact `referrer` value supplied at quote time. Without `apiKeyId` or `apiKey`, returns only matching public keyless requests. Every supplied key must belong to the authenticating integrator. Includes matching requests for the selected k… |
| `currencyInChainId` | number (query) |  | Filter by origin currency chain ID. |
| `currencyOutChainId` | number (query) |  | Filter by destination currency chain ID. Requests are limited to the caller’s integrator and requests without an API key. |
| `currencyInAddress` | string (query) |  | Filter by origin currency contract address. |
| `currencyOutAddress` | string (query) |  | Filter by destination currency contract address. Requests are limited to the caller’s integrator and requests without an API key. |
| `currencyInSymbol` | string (query) |  | Filter by origin currency symbol (e.g. USDC). Case-insensitive; matches across all chains. |
| `currencyOutSymbol` | string (query) |  | Filter by destination currency symbol (e.g. USDC). Case-insensitive; matches across all chains. Requests are limited to the caller’s integrator and requests without an API key. |
| `sortBy` | enum: `createdAt`, `updatedAt`, `amountUsd` (query) |  | Field to sort by. |
| `sortDirection` | enum: `asc`, `desc` (query) |  | Sort direction (default: desc for time fields, asc for amountUsd). |
| `startTimestamp` | number (query) |  | Filter requests with createdAt ≥ this Unix timestamp (seconds). Applied to updatedAt instead when sortBy=updatedAt. |
| `endTimestamp` | number (query) |  | Filter requests with createdAt ≤ this Unix timestamp (seconds). Applied to updatedAt instead when sortBy=updatedAt. |
| `startBlock` | number (query) |  | Filter by chain entry block number (inclusive lower bound). When originChainId is also set, scoped to origin-chain entries only. |
| `endBlock` | number (query) |  | Filter by chain entry block number (inclusive upper bound). When originChainId is also set, scoped to origin-chain entries only. |
| `amountUsdMin` | number (query) |  | Filter requests with currencyIn.amountUsd ≥ this value. |
| `amountUsdMax` | number (query) |  | Filter requests with currencyIn.amountUsd ≤ this value. |
| `appFeesAmountUsdMin` | number (query) |  | Filter requests with total app fees USD ≥ this value. |
| `appFeesAmountUsdMax` | number (query) |  | Filter requests with total app fees USD ≤ this value. |
| `fillTimeMin` | number (query) |  | Filter requests with fill time ≥ this value (seconds). |
| `fillTimeMax` | number (query) |  | Filter requests with fill time ≤ this value (seconds). |
| `features` | string (query) |  | Comma-separated feature flags to filter by. Requests must have at least one of the specified features. Supported values: gasless_execution, gasless_swap, fast_fill, gas_top_up, fixed_rate, app_fees, deposit_address, fee_sponsorship. |
| `includePendingRequests` | boolean (query) |  | When true, include pending requests permitted by your access scope and pending transactions for your own requests. Defaults to false. Does not enable authenticated fields or change access permissions; terminal requests remain eligible without this flag. |
| `includeAuthenticatedData` | boolean (query) |  | When true, include fields available only to the authenticating integrator for their own requests. |
| `includeChildRequests` | boolean (query) |  | Only effective when `id` is also provided. When true, returns the parent request AND any child requests. When false or omitted, only the exact `request_id` match is returned. |
| `filters` | string (query) |  | JSON-encoded array of filter-group objects. Fields within each group are AND'd; groups are OR'd. Prefix a key with 'not:' to negate it (must_not). Values can be a scalar or an array (OR semantics within the field). Example: [{"depositAddress":"0xabc","originC… |
| `x-api-key` | string (header) | yes | API key for authentication. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `requests` | object[] |  |
| `requests[].id` | string |  |
| `requests[].status` | enum: `refund`, `waiting`, `depositing`, `failure`, `pending`, `submitted`, `success` |  |
| `requests[].user` | string |  |
| `requests[].recipient` | string |  |
| `requests[].sender` | string |  |
| `requests[].refundTo` | string | The address refunds are sent to for deposit-address transactions. Null when not specified. |
| `requests[].supersededByRequestId` | string | Regenerated requestId that now owns the sweep/fill for a superseded deposit-address request. Currently only set for Bitcoin (BVM) deposit-address requests. |
| `requests[].duplicateDeposits` | object | Persisted duplicate-deposit refund relationships, or null when none are recorded. Links can exist before a refund completes; check each linked request's status for its outcome. |
| `requests[].depositAddress` | object |  |
| `requests[].data` | object |  |
| `requests[].protocol` | object |  |
| `requests[].requestType` | string |  |
| `requests[].features` | enum: `gasless_execution`, `gasless_swap`, `fast_fill`, `gas_top_up`, `fixed_rate`, `app_fees`, `deposit_address`, `fee_sponsorship`[] |  |
| `requests[].createdAt` | string |  |
| `requests[].updatedAt` | string |  |
| `continuation` | string |  |
| `total` | number | Total count of requests matching the given filters. Only present when `includeTotal` was true. |

<a id="r-post-requests-metadata"></a>
### `POST /requests/metadata`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) |  | API key of the integrator that created the request. Required. |
| `requestId` | string | yes |  |
| `additionalMetadata` | object | yes |  |
| `additionalMetadata.moonPayId` | string | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `message` | string |  |

<a id="r-get-published-requests"></a>
### `GET /published-requests`

List published requests across integrators

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `term` | string (query) |  |  |
| `id` | string (query) |  |  |
| `orderId` | string (query) |  |  |
| `depositTxHash` | string (query) |  |  |
| `fillTxHash` | string (query) |  |  |
| `refundTxHash` | string (query) |  |  |
| `user` | string (query) |  |  |
| `recipient` | string (query) |  |  |
| `originChainId` | number (query) |  |  |
| `destinationChainId` | number (query) |  |  |
| `status` | enum: `success`, `failure`, `refund`, `pending`, `depositing` (query) |  |  |
| `currencyInChainId` | number (query) |  |  |
| `currencyOutChainId` | number (query) |  |  |
| `currencyInAddress` | string (query) |  |  |
| `currencyOutAddress` | string (query) |  |  |
| `currencyInSymbol` | string (query) |  |  |
| `currencyOutSymbol` | string (query) |  |  |
| `chainId` | number (query) |  |  |
| `privateChainsToInclude` | string (query) |  |  |
| `startTimestamp` | number (query) |  |  |
| `endTimestamp` | number (query) |  |  |
| `startBlock` | number (query) |  |  |
| `endBlock` | number (query) |  |  |
| `filters` | string (query) |  | JSON array of OR groups. Fields within a group are ANDed. Supports not: prefixes, arrays, and null checks for public identity, status, chain, and currency filters. |
| `sortBy` | enum: `createdAt`, `updatedAt` (query) |  |  |
| `sortDirection` | enum: `asc`, `desc` (query) |  |  |
| `includeTotal` | boolean (query) |  |  |
| `limit` | number (query) |  |  |
| `continuation` | string (query) |  |  |
| `x-api-key` | string (header) |  | Required API key. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `requests` | object[] |  |
| `requests[].id` | string |  |
| `requests[].status` | enum: `success`, `failure`, `refund` |  |
| `requests[].user` | string |  |
| `requests[].recipient` | string |  |
| `requests[].sender` | string |  |
| `requests[].createdAt` | string |  |
| `requests[].updatedAt` | string |  |
| `requests[].data` | object |  |
| `requests[].protocol` | object |  |
| `continuation` | string |  |
| `total` | number |  |

<a id="r-post-requests-exports"></a>
### `POST /requests/exports`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-dev-portal-key` | string (header) | yes |  |
| `columns` | enum: `status`, `requestId`, `description`, `origin`, `destination`, `senderRecipient`, `timestamp`, `refund`, `failedReason`, `refundReason`, `revShareUsd`, `appFeesUsd`[] |  |  |
| `requesterId` | string | yes |  |
| `deliveryContext` | string | yes |  |
| `exportId` | string | yes |  |
| `filters` | object | yes |  |
| `filters.user` | string |  | Filter requests by wallet address — matches requests where this address is the sender or the deposit-address depositor. |
| `filters.term` | string |  | Broad term search across request ID, wallet, deposit address, and all transaction hashes (deposit, fill, refund, failed, and chain entry transaction IDs). Use `id`, `depositTxHash`, `fillTxHash`, or `refundTxHash` for targeted single-field lookups. |
| `filters.id` | string |  | Filter by requestId — the Relay-level intent identifier returned by the quote API. |
| `filters.orderId` | string |  | Filter by protocol-level orderId. |
| `filters.depositTxHash` | string |  | Filter by deposit transaction hash. |
| `filters.fillTxHash` | string |  | Filter by fill transaction hash. |
| `filters.refundTxHash` | string |  | Filter by refund transaction hash. |
| `filters.originChainId` | number |  | Filter requests where this is the origin chain. |
| `filters.destinationChainId` | number |  | Filter requests where this is the destination chain. Requests are limited to the caller’s integrator and requests without an API key. |
| `filters.chainId` | number |  | Get all requests for a single chain in either direction. Overridden by originChainId / destinationChainId. Requests are limited to the caller’s integrator and requests without an API key. |
| `filters.privateChainsToInclude` | string |  | Comma-separated list of private chain UUIDs to include in results. |
| `filters.depositAddress` | string |  | Filter requests associated with this deposit address. |
| `filters.recipient` | string |  | Filter requests where this address is the recipient. |
| `filters.status` | enum: `success`, `failure`, `refund` |  |  |
| `filters.failReason` | enum: `UNKNOWN`, `SLIPPAGE`, `AMOUNT_TOO_LOW_TO_REFUND`, `DEPOSIT_ADDRESS_MISMATCH`, `DEPOSIT_CHAIN_MISMATCH`, `INCORRECT_DEPOSIT_CURRENCY`, `DOUBLE_SPEND`, `SOLVER_CAPACITY_EXCEEDED`, `SOLVER_BALANCE_TOO_LOW`, `DEPOSITED_AMOUNT_TOO_LOW_TO_FILL`, `NEGATIVE_NEW_AMOUNT_AFTER_FEES`, `NO_QUOTES`, … |  | Filter requests by failure reason. Only returns requests that failed with this specific reason. |
| `filters.refundFailReason` | enum: `AMOUNT_TOO_LOW_TO_REFUND`, `NEGATIVE_NEW_AMOUNT_AFTER_FEES`, `SWAP_CURRENCY_NOT_ON_ORIGIN`, `REFUND_RECIPIENT_IS_VASP`, `REFUND_RECIPIENT_IS_BLOCKED`, `MANUAL_REFUND_REQUIRED` |  | Filter requests by refund failure reason. |
| `filters.apiKey` | string |  | Filter requests by API key. Accepts a single value or a comma-separated list (OR matching). Maximum 50 values across apiKey and apiKeyId. |
| `filters.appId` | string |  | Filter by App IDs (app_id_<uuid>, comma-separated, maximum 50) owned by your integrator. Matches indexed App attribution across current and revoked keys. |
| `filters.apiKeyId` | string |  | Filter by API key IDs (lowercase key_id_<uuid>, comma-separated), owned by your integrator. OR matching with apiKey; maximum 50 values combined. |
| `filters.requestType` | string |  | Filter requests by requestType (case-insensitive). Supported values: Bridge, Crosschain Swap, Same-chain Swap, Send, Wrap, Unwrap, Call. |
| `filters.referrer` | string |  | Filter requests by the exact `referrer` value supplied at quote time. Without `apiKeyId` or `apiKey`, returns only matching public keyless requests. Every supplied key must belong to the authenticating integrator. Includes matching requests for the selected k… |
| `filters.currencyInChainId` | number |  | Filter by origin currency chain ID. |
| `filters.currencyOutChainId` | number |  | Filter by destination currency chain ID. Requests are limited to the caller’s integrator and requests without an API key. |
| `filters.currencyInAddress` | string |  | Filter by origin currency contract address. |
| `filters.currencyOutAddress` | string |  | Filter by destination currency contract address. Requests are limited to the caller’s integrator and requests without an API key. |
| `filters.currencyInSymbol` | string |  | Filter by origin currency symbol (e.g. USDC). Case-insensitive; matches across all chains. |
| `filters.currencyOutSymbol` | string |  | Filter by destination currency symbol (e.g. USDC). Case-insensitive; matches across all chains. Requests are limited to the caller’s integrator and requests without an API key. |
| `filters.sortBy` | enum: `createdAt`, `updatedAt`, `amountUsd` |  |  |
| `filters.sortDirection` | enum: `asc`, `desc` |  | Sort direction (default: desc for time fields, asc for amountUsd). |
| `filters.startTimestamp` | number |  | Filter requests with createdAt ≥ this Unix timestamp (seconds). Applied to updatedAt instead when sortBy=updatedAt. |
| `filters.endTimestamp` | number |  | Filter requests with createdAt ≤ this Unix timestamp (seconds). Applied to updatedAt instead when sortBy=updatedAt. |
| `filters.startBlock` | number |  | Filter by chain entry block number (inclusive lower bound). When originChainId is also set, scoped to origin-chain entries only. |
| `filters.endBlock` | number |  | Filter by chain entry block number (inclusive upper bound). When originChainId is also set, scoped to origin-chain entries only. |
| `filters.amountUsdMin` | number |  | Filter requests with currencyIn.amountUsd ≥ this value. |
| `filters.amountUsdMax` | number |  | Filter requests with currencyIn.amountUsd ≤ this value. |
| `filters.appFeesAmountUsdMin` | number |  | Filter requests with total app fees USD ≥ this value. |
| `filters.appFeesAmountUsdMax` | number |  | Filter requests with total app fees USD ≤ this value. |
| `filters.fillTimeMin` | number |  | Filter requests with fill time ≥ this value (seconds). |
| `filters.fillTimeMax` | number |  | Filter requests with fill time ≤ this value (seconds). |
| `filters.features` | string |  | Comma-separated feature flags to filter by. Requests must have at least one of the specified features. Supported values: gasless_execution, gasless_swap, fast_fill, gas_top_up, fixed_rate, app_fees, deposit_address, fee_sponsorship. |
| `filters.includeChildRequests` | boolean |  | Only effective when `id` is also provided. When true, returns the parent request AND any child requests. When false or omitted, only the exact `request_id` match is returned. |
| `filters.filters` | string |  | JSON-encoded array of filter-group objects. Fields within each group are AND'd; groups are OR'd. Prefix a key with 'not:' to negate it (must_not). Values can be a scalar or an array (OR semantics within the field). Example: [{"depositAddress":"0xabc","originC… |
| `filters.apiKeyIds` | string[] |  |  |
| `filters.appIds` | string[] |  |  |

**Response**

_none_

<a id="r-get-requests-exports-id-download"></a>
### `GET /requests/exports/{id}/download`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `token` | string (query) | yes |  |
| `id` | string (path) | yes |  |

**Response**

_none_

<a id="r-post-transactions-index"></a>
### `POST /transactions/index`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |
| `chainId` | string | yes |  |
| `txHash` | string | yes |  |
| `requestId` | string |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `message` | string |  |

<a id="r-post-transactions-single"></a>
### `POST /transactions/single`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |
| `requestId` | string | yes |  |
| `chainId` | string | yes |  |
| `tx` | string | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `message` | string |  |

<a id="r-post-transactions-deposit-address-reindex"></a>
### `POST /transactions/deposit-address/reindex`

Re-checks the balances of a previously-registered deposit address and queues a withdrawal for any currency with a non-zero balance. Useful when funds were sent to a deposit address but the normal indexer flow did not pick them up. For a Deposit Address V2 address, queues a search for recent deposit transactions instead, at most once per hour for each currency.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |
| `chainId` | number | yes | Chain ID the deposit address was originally registered on. |
| `depositAddress` | string | yes | The deposit address to reindex. |
| `sweep` | boolean |  | Deprecated. No longer supported on this endpoint. |
| `targetChainId` | number |  | Chain ID to reindex on, when different from `chainId`. Use this if funds landed on a chain other than the one the deposit address was registered on. Defaults to `chainId`. |
| `currency` | string |  | Address of a specific currency to reindex. Defaults to checking every depositable currency on the chain. |
| `txHash` | string |  | Deposit Address V2 only. Transaction to reindex. Without it, the endpoint finds recent deposit transactions itself. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `message` | string | Human-readable summary of the reindex outcome. |
| `triggeredCurrencies` | object[] | Currencies for which a withdrawal was queued. |
| `triggeredCurrencies[].currency` | string | Currency address. |
| `triggeredCurrencies[].symbol` | string | Currency symbol. |
| `triggeredCurrencies[].balance` | string | Balance found at the deposit address, in the currency's smallest unit. |
| `checkedCurrencies` | number | Total number of currencies whose balance was checked. |
| `failedCurrencies` | number | Number of currencies whose balance check failed. |

<a id="r-get-swap-sources"></a>
### `GET /swap-sources`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `chainId` | number (query) |  | Chain ID to get swap sources for |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `sources` | string[] | An array of swap sources |

<a id="r-get-loadforge-txt"></a>
### `GET /loadforge.txt`



**Params**

_none_

**Response**

_none_

<a id="r-post-currencies-v1"></a>
### `POST /currencies/v1`

 **(deprecated)**

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |
| `defaultList` | boolean |  | Return default currencies |
| `chainIds` | number[] |  | Chain IDs to search for currencies |
| `term` | string |  | Search term for currencies |
| `address` | string |  | Address of the currency contract |
| `currencyId` | string |  | ID to search for a currency group |
| `symbol` | string |  | Filter by currency symbol |
| `groupID` | string |  | Filter by currency group ID |
| `tokens` | string[] |  | List of token addresses, like: chainId:address |
| `verified` | boolean |  | Filter verified currencies |
| `limit` | integer |  | Limit the number of results |
| `includeAllChains` | boolean |  | Include all chains for a currency when filtering by chainId and address |
| `useExternalSearch` | boolean |  | Uses 3rd party API's to search for a token, in case relay does not have it indexed |
| `depositAddressOnly` | boolean |  | Returns only currencies supported with deposit address bridging |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `[][].groupID` | string |  |
| `[][].chainId` | number |  |
| `[][].address` | string |  |
| `[][].symbol` | string |  |
| `[][].name` | string |  |
| `[][].decimals` | number |  |
| `[][].vmType` | enum: `bvm`, `evm`, `svm`, `tvm`, `tonvm`, `hypevm`, `lvm`, `xrpvm`, `hederavm`, `atlasvm` |  |
| `[][].metadata` | object |  |
| `[][].metadata.logoURI` | string |  |
| `[][].metadata.verified` | boolean |  |
| `[][].metadata.isNative` | boolean |  |

<a id="r-post-currencies-v2"></a>
### `POST /currencies/v2`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |
| `defaultList` | boolean |  | Return default currencies |
| `chainIds` | number[] |  | Chain IDs to search for currencies |
| `term` | string |  | Search term for currencies |
| `address` | string |  | Address of the currency contract |
| `currencyId` | string |  | ID to search for a currency |
| `symbol` | string |  | Filter by currency symbol |
| `groupID` | string |  | Filter by currency group ID |
| `tokens` | string[] |  | List of token addresses, like: chainId:address |
| `verified` | boolean |  | Filter verified currencies |
| `limit` | integer |  | Limit the number of results |
| `includeAllChains` | boolean |  | Include all chains for a currency when filtering by chainId and address |
| `useExternalSearch` | boolean |  | Uses 3rd party API's to search for a token, in case relay does not have it indexed |
| `depositAddressOnly` | boolean |  | Returns eligible deposit-address input currencies for the caller's DA mode. Eligibility does not guarantee availability for every destination and amount. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `[].chainId` | number |  |
| `[].address` | string |  |
| `[].symbol` | string |  |
| `[].name` | string |  |
| `[].decimals` | number |  |
| `[].vmType` | enum: `bvm`, `evm`, `svm`, `tvm`, `tonvm`, `hypevm`, `lvm`, `xrpvm`, `hederavm`, `atlasvm` |  |
| `[].metadata` | object |  |
| `[].metadata.logoURI` | string |  |
| `[].metadata.verified` | boolean |  |
| `[].metadata.isNative` | boolean |  |

<a id="r-get-currencies-token-price"></a>
### `GET /currencies/token/price`

 **(deprecated)**

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `address` | string (query) | yes | Token address to get price for |
| `chainId` | number (query) | yes | Chain ID of the token |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `price` | number | Token price in USD |
| `deprecation` | object |  |
| `deprecation.message` | string |  |
| `deprecation.deprecatedAt` | string |  |
| `deprecation.throttledFrom` | string |  |
| `deprecation.sunsetAt` | string |  |
| `deprecation.successor` | string |  |
| `deprecation.migrationGuide` | string |  |

<a id="r-get-currencies-token-price-v2"></a>
### `GET /currencies/token/price/v2`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `address` | string (query) | yes | Token address to get price for |
| `chainId` | number (query) | yes | Chain ID of the token |
| `x-api-key` | string (header) |  | Optional API key for authentication and higher rate limits. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `price` | string | Token price in USD |

<a id="r-get-currencies-trending"></a>
### `GET /currencies/trending`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `chainId` | number (query) |  |  |
| `sortBy` | enum: `relay24hBuyTxCount`, `relay24hBuyUsdVolume`, `coingecko6hTrending` (query) |  |  |
| `limit` | number (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `[].chainId` | number |  |
| `[].address` | string |  |
| `[].symbol` | string |  |
| `[].name` | string |  |
| `[].decimals` | number |  |
| `[].vmType` | enum: `bvm`, `evm`, `svm`, `tvm`, `tonvm`, `hypevm`, `lvm`, `xrpvm`, `hederavm`, `atlasvm` |  |
| `[].metadata` | object |  |
| `[].metadata.logoURI` | string |  |
| `[].metadata.verified` | boolean |  |
| `[].metadata.isNative` | boolean |  |

<a id="r-get-chains-chainid-currencies-address"></a>
### `GET /chains/{chainId}/currencies/{address}`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `chainId` | number (path) | yes |  |
| `address` | string (path) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `chainId` | number |  |
| `address` | string |  |
| `symbol` | string |  |
| `name` | string |  |
| `decimals` | number |  |
| `vmType` | enum: `bvm`, `evm`, `svm`, `tvm`, `tonvm`, `hypevm`, `lvm`, `xrpvm`, `hederavm`, `atlasvm` |  |
| `metadata` | object |  |
| `metadata.logoURI` | string |  |
| `metadata.verified` | boolean |  |
| `metadata.isNative` | boolean |  |
| `price` | number |  |
| `marketCap` | string |  |
| `fdv` | string |  |
| `liquidity` | string |  |
| `codexChainName` | string |  |
| `codexChainShortName` | string |  |
| `createdAt` | number |  |
| `socialLinks` | object |  |
| `socialLinks.website` | string |  |
| `socialLinks.twitter` | string |  |
| `socialLinks.coingecko` | string |  |
| `socialLinks.discord` | string |  |
| `volume` | object |  |
| `volume.24h` | object |  |
| `priceChange` | object |  |
| `priceChange.5m` | string |  |
| `priceChange.1h` | string |  |
| `priceChange.4h` | string |  |
| `priceChange.24h` | string |  |
| `pair` | object |  |
| `pair.address` | string |  |
| `pair.token0` | object |  |
| `pair.token1` | object |  |

<a id="r-get-chains-chainid-currencies-address-chart"></a>
### `GET /chains/{chainId}/currencies/{address}/chart`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `timeframe` | enum: `5M`, `1H`, `4H`, `24H`, `7D`, `30D`, `MAX` (query) |  | Timeframe for chart data can be either of the following |
| `chainId` | number (path) | yes |  |
| `address` | string (path) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `traders` | number[] |  |
| `transactions` | number[] |  |
| `t` | number[] |  |
| `o` | number[] |  |
| `h` | number[] |  |
| `l` | number[] |  |
| `c` | number[] |  |
| `volume` | string[] |  |
| `buyers` | number[] |  |
| `buys` | number[] |  |
| `buyVolume` | string[] |  |
| `sellers` | number[] |  |
| `sells` | number[] |  |
| `sellVolume` | string[] |  |
| `sumTraders` | number |  |
| `sumNonUniqueTraders` | number |  |
| `sumSellers` | number |  |
| `sumBuyers` | number |  |
| `sumTransactions` | number |  |
| `sumSells` | number |  |
| `sumBuys` | number |  |
| `sumVolume` | string |  |
| `sumSellVolume` | string |  |
| `sumBuyVolume` | string |  |

<a id="r-get-currencies-classifications"></a>
### `GET /currencies/classifications`



**Params**

_none_

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `major` | string[] |  |
| `stable` | string[] |  |

<a id="r-post-provision-chain"></a>
### `POST /provision/chain`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `X-RELAY-INTEGRATION-SECRET` | string (header) | yes |  |
| `chainId` | number | yes |  |
| `parentChainId` | number | yes |  |
| `type` | enum: `OPTIMISM`, `ARBITRUM` | yes |  |
| `name` | string | yes |  |
| `rpc` | string | yes |  |
| `ws` | string | yes |  |
| `explorer` | string |  |  |
| `logoUrl` | string |  |  |
| `iconurl` | string |  |  |
| `brandColor` | string |  |  |
| `nativeCurrency` | object | yes |  |
| `nativeCurrency.name` | string |  |  |
| `nativeCurrency.symbol` | string |  |  |
| `nativeCurrency.decimals` | number |  |  |
| `nativeCurrency.contract` | string |  |  |
| `contracts` | object | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `id` | string |  |
| `status` | string |  |
| `etaSeconds` | number |  |

<a id="r-get-sanctioned-address"></a>
### `GET /sanctioned/{address}`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `address` | string (path) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `sanctioned` | boolean |  |

<a id="r-post-wallets-screen"></a>
### `POST /wallets/screen`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) | yes | Required API key for authentication. Contact the team for getting an API Key |
| `wallets` | object[] | yes |  |
| `wallets[].address` | string |  |  |
| `wallets[].chainId` | string |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `message` | string |  |
| `wallets` | any[] |  |

<a id="r-post-wallets-screen-override"></a>
### `POST /wallets/screen/override`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string | yes |  |
| `chainId` | string |  |  |
| `action` | enum: `ALLOW`, `BLOCK`, `NONE` | yes |  |
| `reason` | string |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `message` | string |  |

<a id="r-get-wallets-screen-info"></a>
### `GET /wallets/screen/info`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `wallet` | string (query) | yes |  |
| `chainId` | string (query) |  |  |
| `source` | string (query) |  |  |
| `forceScreen` | boolean (query) |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `message` | string |  |
| `isBlocked` | boolean |  |
| `isTrmBlocked` | boolean |  |
| `isVasp` | boolean |  |
| `trmBlockReasons` | object[] |  |
| `trmBlockReasons[].category` | string |  |
| `trmBlockReasons[].severity` | enum: `unknown`, `low`, `medium`, `high`, `severe` |  |
| `trmBlockReasons[].riskType` | enum: `OWNERSHIP`, `COUNTERPARTY`, `INDIRECT`, `null` |  |
| `isHackBountyBlocked` | boolean |  |
| `isChainalysisBlocked` | boolean |  |
| `isOstiumBlocked` | boolean |  |
| `hermod` | object |  |
| `hermod.isBlocked` | boolean |  |
| `hermod.threatLevel` | number |  |
| `hermod.hitUuid` | string |  |
| `hermod.sanctioned` | string |  |
| `override` | string |  |
| `reason` | string |  |

<a id="r-post-withdrawals-attest-deposit"></a>
### `POST /withdrawals/attest-deposit`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `chainId` | number | yes |  |
| `gateway` | boolean |  |  |
| `transactionId` | string | yes |  |
| `hints` | object |  |  |
| `hints.atlas-vm` | object |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `success` | boolean |  |
| `execution` | object |  |
| `execution.chainId` | integer |  |
| `execution.oracleAddress` | string |  |
| `execution.idempotencyKey` | string |  |

<a id="r-post-withdrawals-request"></a>
### `POST /withdrawals/request`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `chainId` | string | yes |  |
| `currency` | string | yes |  |
| `amount` | string | yes |  |
| `ownerChainId` | string | yes |  |
| `owner` | string | yes |  |
| `recipient` | string | yes |  |
| `nonce` | string |  |  |
| `additionalData` | any |  |  |
| `signature` | string |  |  |

**Response**

_none_

<a id="r-get-withdrawals-status"></a>
### `GET /withdrawals/status`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `id` | string (query) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `status` | string |  |
| `transaction` | object |  |
| `withdrawal` | object |  |
| `txHash` | string |  |
| `reason` | string |  |

<a id="r-get-withdrawals-balances"></a>
### `GET /withdrawals/balances`

Lists credited Hub balances for one recovery owner. Excludes deposits awaiting attestation or recovery; discovery is eventually consistent.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `recoveryAddress` | string (query) | yes |  |
| `ownerChainId` | number (query) | yes |  |
| `limit` | number (query) |  |  |
| `continuation` | string (query) |  |  |
| `x-api-key` | string (header) |  | Optional API key for higher rate limits. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `balances` | object[] |  |
| `balances[].hubTokenId` | string |  |
| `balances[].currency` | object |  |
| `balances[].amount` | string |  |
| `balances[].amountFormatted` | string |  |
| `balances[].amountUsd` | string |  |
| `continuation` | string |  |

<a id="r-post-access-tokens"></a>
### `POST /access-tokens`

Exchange a tier 2+ backend API key for a 15-minute public API session JWT.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `x-api-key` | string (header) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `token` | string |  |
| `tokenType` | enum: `Bearer` |  |
| `expiresAt` | string (date-time) |  |
| `scope` | enum: `public-api` |  |

<a id="r-get-metrics-usage"></a>
### `GET /metrics/usage`

Get API call counts for the authenticated API key, or owned keys and Apps using x-dev-portal-key. Rows are grouped by API key, endpoint, status code, and error code.

**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `granularity` | enum: `minutely`, `hourly`, `daily` (query) |  | Time bucket granularity. minutely defaults to last 24h, hourly to last 7d, daily to last 14d. |
| `startTimestamp` | number (query) |  | Start of the query window as a Unix timestamp (seconds). Defaults based on granularity. |
| `endTimestamp` | number (query) |  | End of the query window as a Unix timestamp (seconds). Defaults to now. |
| `apiKey` | string (query) |  | Filter metrics by API key. Accepts a single value or a comma-separated list (e.g. key1,key2) — results include metrics matching any of the supplied keys. Maximum 50 values across apiKey, apiKeyId and appId. |
| `apiKeyId` | string (query) |  | Filter metrics by API key IDs (key_id_<uuid>, comma-separated) owned by your integrator when using x-dev-portal-key. OR matching with apiKey and appId; maximum 50 values combined. |
| `appId` | string (query) |  | Filter by owned Apps (app_id_<uuid>, comma-separated); requires x-dev-portal-key. Includes all current keys, including inactive keys. OR matching with apiKey and apiKeyId; maximum 50 filter values combined before expanding Apps to keys. Rows remain grouped by… |
| `x-dev-portal-key` | string (header) |  | Integrator portal credential required for appId filtering. |
| `x-api-key` | string (header) |  | Integrator API key. |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `metrics` | object[] |  |
| `metrics[].apiKey` | string |  |
| `metrics[].apiKeyId` | string |  |
| `metrics[].appId` | string |  |
| `metrics[].timestamp` | string |  |
| `metrics[].endpoint` | string |  |
| `metrics[].statusCode` | number |  |
| `metrics[].errorCode` | string | Only present on rows where statusCode is 400. Contains the machine-readable error code (e.g. AMOUNT_TOO_LOW). |
| `metrics[].count` | number |  |

<a id="r-get-protocol-executions-id"></a>
### `GET /protocol/executions/{id}`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `id` | string (path) | yes |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `execution` | object |  |
| `execution.chainId` | integer |  |
| `execution.oracleAddress` | string |  |
| `execution.idempotencyKey` | string |  |
| `status` | enum: `unknown`, `pending`, `executed`, `failed` |  |
| `txHash` | string |  |

<a id="r-post-protocol-transfers"></a>
### `POST /protocol/transfers`



**Params**

| Field | Type | Req. | Description |
| --- | --- | --- | --- |
| `requestId` | string (uuid) | yes |  |
| `asset` | object | yes |  |
| `asset.chainId` | integer | yes |  |
| `asset.currency` | string | yes |  |
| `asset.gateway` | boolean |  |  |
| `owner` | object | yes |  |
| `owner.chainId` | integer | yes |  |
| `owner.address` | string | yes |  |
| `owner.signature` | string |  |  |
| `amount` | string | yes |  |
| `recipient` | string | yes |  |
| `expiration` | integer |  |  |

**Response**

| Field | Type | Description |
| --- | --- | --- |
| `execution` | object |  |
| `execution.chainId` | integer |  |
| `execution.oracleAddress` | string |  |
| `execution.idempotencyKey` | string |  |
| `status` | enum: `awaiting_signature`, `pending`, `executed`, `failed` |  |
| `txHash` | string |  |
| `signing` | object |  |
| `signing.message` | string |  |
| `signing.expiration` | integer |  |

