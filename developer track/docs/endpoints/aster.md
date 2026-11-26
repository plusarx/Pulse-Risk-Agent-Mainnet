# Perps (Aster) notes and gotchas

Perps run on Aster's futures API on the Aster chain (USDT margin). Base URL `https://fapi.asterdex.com`; all private calls use
the **V3** endpoints (`/fapi/v3/...`). The older V1 order endpoints are gone. Facts below were checked live on mainnet
with small sizes unless marked *unverified*.

## Two keys, two jobs

| Key | Who holds it | What it signs |
|---|---|---|
| Your wallet (any EVM wallet) | you | the one-time agent approval, deposits, withdrawals |
| Agent wallet | the server (stored AES-256-GCM encrypted) | reads, orders, leverage changes, cancels |

The agent is approved with `canPerpTrade=true`, `canSpotTrade=false`, `canWithdraw=false`: it can trade and read the
account and can never move money out.

## Registering the agent

`POST /fapi/v3/registerAndApproveAgent` (form body). The user signs EIP-712 typed data:

- domain `AsterSignTransaction`, version `1`, `chainId` = 56 on mainnet, 97 on testnet (the `signatureChainId`)
- primary type `Message { string msg }`
- `msg` is the string
  `user=<addr>&nonce=<n>&agentName=<name>&agentAddress=<agent>&expired=<ms>&signatureChainId=56&canSpotTrade=false&canPerpTrade=true&canWithdraw=false`
  with the addresses in lowercase and the fields in exactly this order.

**One agent per name.** Approving a second agent under the same `agentName` replaces the first. Agents with different
names coexist. Each key here is named `PulseRisk-<last 6 hex of the agent address>` so two app instances do not revoke
each other. Agents expire after 180 days; rotate before then.

## Signed reads and orders

The agent signs the **raw query string** (not sorted) with EIP-712 on the `Message` type, `chainId` **1666** on mainnet
(714 on testnet), and appends `&signature=<hex>`. After the call's own parameters the query carries `asterChain`
(`Mainnet`), `user`, `signer` (the agent) and `nonce` (unix seconds x 1,000,000 plus a counter, so two calls in the same
second never collide).

| Endpoint | Use |
|---|---|
| `GET /fapi/v3/account`, `/balance`, `/positionRisk` | equity, free margin, positions (leverage, liquidation price) |
| `GET /fapi/v3/openOrders`, `/allOrders`, `/userTrades` | orders and fills |
| `GET /fapi/v3/income` | funding, realised PnL, commissions and **deposits** |
| `POST /fapi/v3/order`, `DELETE /fapi/v3/order` | place and cancel (market orders; reduce-only closes) |
| `POST /fapi/v3/leverage`, `GET /fapi/v3/leverageBracket` | set leverage, per-market maximum |
| `POST /fapi/v3/asset/wallet/transfer` | spot to futures margin (*unverified* as a fallback after a deposit) |
| `GET /fapi/v1/premiumIndex`, `/exchangeInfo`, `/ticker/24hr` | public marks, filters, 24 h stats (no signature) |

## Errors you will meet

| Code | Meaning | What to do |
|---|---|---|
| `-1000 No agent found` | the signer is not an approved agent for that user (never approved, expired, or replaced by a same-name agent) | rotate the key: one wallet signature |
| `-5050` | account has never been funded; returned before the signature is checked | deposit first |
| `-4028` | leverage outside the market's bracket | read `leverageBracket` |
| below `MIN_NOTIONAL` | smallest order is **$5** on the perps | raise size or leverage |

Leverage is per market. With $1 of margin at 5x the order is $5, which is how small accounts clear the minimum.

## Funding the account

Margin is USDT (18 decimals on BSC, `0x55d3…7955`) deposited into the Aster vault `0x1284…7974` (an
`AstherusVault` proxy). Both `deposit(address,uint256,uint256)` and
`depositFor(address currency, address account, uint256 amount, uint256 broker)` exist; broker is `1`. A deposit
emits an event whose topic 1 is the credited account, and the credited amount shows up as a `DEPOSIT` row in
`/fapi/v3/income`, which is how the activity feed attaches the BscScan transaction hash. In the app, USDC is swapped
to USDT and deposited in one flow; the smallest deposit is about **$6**.

Deposits landed straight in futures margin in every test. *Unverified:* the agent calling `depositFor` to credit another
account, the spot-to-futures fallback, and withdrawal signing. Withdrawals are signed by the user's own wallet.

## Testnet

Signing domain `chainId` 714. Orders, TP/SL, cancel and close were exercised there, but testnet has no deposits, so
funding is mainnet only.
