# Agent integration guide

This guide is for the developer building the **hedging + margin-rebalancing agent**. This app (UI + small backend) owns wallet login, agent-key registration, user rules and the activity log. Your service owns the loop that reads state and calls the venues.

```
 MetaMask (user) ──signs once──▶ Pulse Risk backend (this repo)        Your agent service
   │ BSC: holds USDC + bStocks       • SQLite: encrypted agent keys   ◀─ GET  /api/agent/v1/wallets
   │ grants capped allowance ─┐      • rules (hedge / rebalance)     ◀─ GET  /api/agent/v1/credentials
   │                          │      • activity log                  ◀─ GET  /api/agent/v1/config
   ▼                          └────▶ agent BSC wallet (AGENT_BSC_ADDRESS) ─ POST /api/agent/v1/events
 Lighter account ◀── Relay ◀── transferFrom(user) ───────────────────────── your loop
 Derive subaccount ◀── Ethereum deposit ◀── Relay
```

## 1. Auth

Every `/api/agent/v1/*` call needs `Authorization: Bearer $AGENT_API_TOKEN` (set the same value in both services; ≥ 24 chars). The token gives access to decrypted venue keys, so keep it in a secret store.

## 2. Endpoints for the agent

### `GET /api/agent/v1/wallets?network=mainnet|testnet`
Every wallet with an active key or saved rules.
```json
{ "wallets": [ { "wallet": "0xabc…", "keys": [ { "venue": "lighter", "accountRef": "123456", "keyRef": "4", "status": "active", "expiresAt": null } ],
                 "config": { …AgentConfig… } } ] }
```

### `GET /api/agent/v1/credentials?wallet=0x…&venue=lighter|derive&network=…`
- Lighter: `{ accountIndex, apiKeyIndex, publicKey, apiPrivateKey }`. Use these with the lighter-go signer (`CreateClient("", apiPrivateKey, 304|300, apiKeyIndex, accountIndex)`).
- Derive: `{ subaccountId, sessionKeyAddress, sessionPrivateKey, expiresAt }`. The key signs `X-DeriveSignature` and every action, with `owner = wallet` and `signer = sessionKeyAddress`.

Scopes granted:
- **Lighter** API key index 4: trade, same-owner transfer, secure withdraw to the owner's own Ethereum address.
- **Derive**: `trade:all, withdraw, transfer:existing_subaccount, transfer:new_subaccount`. The owner is whitelisted as a withdrawal recipient.

### `GET /api/agent/v1/config?wallet=…&network=…`
Returns the `AgentConfig` (schema: `lib/agent-config.ts`). Defaults apply until the user saves.

### `POST /api/agent/v1/events`
Shows up live under **Risk management → Agent activity**. Idempotent on `(wallet, idempotencyKey)`.
```json
{ "wallet": "0x…", "network": "mainnet", "kind": "rebalance", "venue": "lighter", "status": "done",
  "message": "Topped up Lighter $250 from BSC USDC via Relay",
  "payload": { "direction": "in", "amountUsd": 250, "ruleKey": "lighter:", "relayRequestId": "0x…" }, "idempotencyKey": "rb-0xabc-1732350000" }
```
- `kind`: `hedge | rebalance | bridge | info | error`. `status`: `pending | done | failed`.
- For `rebalance`/`bridge` events, set `payload.direction` (`in` = top-up, `out` = release) and `payload.amountUsd`. The "Recent moves" list and the 24h totals read them.

### `GET /api/agent/v1/rule-state?wallet=…&network=…`
Returns `{states: {<ruleKey>: {topUpDoneAt, releaseDoneAt, releaseBelowSince, lastMoveAt, lastOutcome, lastOutcomeMsg, lastOutcomeAt}}}`. Read it each tick before planning.

### `POST /api/agent/v1/rule-state`
Runtime state per rule. It's stored apart from the rules, so a user saving rules never wipes it. Fields you omit are kept; `null` clears a field.
```json
{ "wallet": "0x…", "network": "testnet", "ruleKey": "lighter:",
  "topUpDoneAt": "2026-11-23T09:00:00Z", "releaseDoneAt": null, "releaseBelowSince": "2026-11-23T08:40:00Z",
  "lastMoveAt": "…", "lastOutcome": "topped-up", "lastOutcomeMsg": "Topped up $25 from BNB USDC" }
```
- `ruleKey` = `<venue>:<accountRef>`: `lighter:` for the Lighter main account, `derive:<subaccountId>` for a Derive subaccount.
- Set `topUpDoneAt` / `releaseDoneAt` after a move on a run-once rule. The user's **Re-arm** button clears them.
- Set `releaseBelowSince` when the release condition starts holding, and clear it when it stops. The release dwell timer counts from it.
- `lastOutcomeMsg` is shown on the rule's card.

### `POST /api/agent/v1/actions`
Confirmation mode: ask the user before a real move. Body is `ActionIn` (`lib/agent-action.ts`): `kind` (`top_up|release|hedge`), `venue`, `origin` (`rule|news`), `slot` (a newer request in the same slot supersedes the open one), `title`, `why`, `helps`, `willDo[]`, `detail` (opaque, comes back to you), optional `plan` (`HedgePlanView`, shown to the user), `idempotencyKey`. Returns `{ok, id, duplicate, status}`. Requests expire after 30 min.
- `GET /api/agent/v1/actions?wallet=&network=&status=approved|pending` (default `approved`): requests the user approved and you have not run yet, or ones still waiting (do not ask twice).
- `POST /api/agent/v1/actions/{id}/result?network=`: after running an approved request, acknowledge with `{wallet, status: executed|failed|expired, message}`.

### `POST /api/agent/v1/status`
Post the always-visible status every tick (`StatusIn`, `lib/agent-status.ts`): effective mode, kill switch, paused reason, portfolio, hedged vs required %, VaR vs limit, coverage, per-ticker table, next event, news flags, limits used today, monitored / not monitored, alerts, `takenAt`. Replaces the previous snapshot. The UI warns if `takenAt` is older than 3 min.

## 3. The rules (`AgentConfig`)

Money is **USDC base units (6 dp) as integer strings**. Percentages are **basis points**. Schema: `lib/agent-config.ts`.

| Field | Meaning |
|---|---|
| `hedge.enabled`, `hedge.driftThresholdPct` | Re-hedge when the hedge drifts more than X% from target |
| `hedge.legs[]` | `{bstock, venue: 'lighter'\|'derive', kind: 'perp'\|'put', market, marketId? (Lighter), hedgeRatio, put?: {strikePct, minDaysToExpiry, targetDaysToExpiry}}`. Sized by notional: target units = bStock qty × price × ratio ÷ hedge price. Key for positions: `hedgeKey(leg)` |
| `hedge.sizing` | `ratio` (default): each leg is hedged to its ratio by value. `loss_limit`: size the smallest hedge that keeps the modelled loss inside `risk.lossTolerancePct` (the leg ratio is the maximum) |
| `hedge.news.enabled` | News risk flags. ADVISORY ONLY: flags and reviews, never changes a position or size |
| `mode` | `confirm` (default: the agent asks first via `/actions`) or `autonomous` (acts inside the limits). Autonomous lapses at `limits.autonomyExpiresAt`, then act as `confirm` |
| `risk` | `lossTolerancePct`, `premiumBudgetWeeklyPct`, `excludeTickers`, `fullyHedgeTickers`, `correlation` (0..1), `eventLeadHours` |
| `limits` | `maxNotionalPerTradeUsd`, `maxNotionalPerDayUsd`, `maxLeverage`, `dailyLossCapUsd`, `maxCapitalOffBnbUsd`, `autonomyExpiresAt`, `killSwitch` (halts new orders and transfers). Only the user changes these; the agent never writes config |
| `events[]` | Known events `{ticker, at, kind: earnings|corporate_action|halt, gapPct?}` to hedge ahead of |
| `rebalance.enabled` | Master switch ("Automation on"). Off = rules are saved, but nothing moves |
| `rebalance.rules[]` | One rule per venue account (same model as the original terminal's auto margin rebalancing). See below |
| `rebalance.sources` | Ordered: `bsc_usdc`, `bsc_usdt`, `sell_bstocks` |
| `rebalance.sellOrder` | bStocks the agent may sell, in order, when `sell_bstocks` is a source. The user must also allow each bStock to the agent address. A sale is valued after `collateral.bstockHaircut` |
| `rebalance.keepBscReserveBaseUnit` | Never drain the BNB wallet below this |
| `collateral.bstockHaircut` | Discount on bStock value when counting it as collateral (0.3 = 30%) |

**Rule fields** (`RiskRule` in `lib/risk-rules.ts`):

| Field | Meaning |
|---|---|
| `venue`, `accountRef` | `lighter` + `''` (main account), or `derive` + subaccount id (one per risk universe) |
| `mode` | `utilization` (margin used ÷ account value, uses the `*Bps` fields) or `account_value` (USD, uses the `*BaseUnit` fields) |
| `triggerBps`/`triggerBaseUnit` → `targetBps`/`targetBaseUnit` | Top up when utilization goes **above** the trigger (or account value goes **below** it), back to the target |
| `topUpOnce`, `releaseOnce` | Make one move, then pause that direction until re-armed |
| `releaseOn`, `releaseLevel*`, `releaseForSec`, `releaseTarget*` | Release the surplus when utilization stays **below** (or value stays **above**) the level for `releaseForSec`, down to the release target. A null release target means use the top-up target |
| `maxPerMoveBaseUnit`, `dailyCapBaseUnit`, `minMoveBaseUnit`, `cooldownSec` | Limits. The minimum move is at least the venue's deposit floor (Lighter $6, Derive $7). The effective cooldown is at least 5 min (venue credit time) |
| `enabled` | Per-rule pause |

**Reference math** (pure, unit-tested in `tests/risk-rules.test.ts`). The UI preview uses the same functions, so the agent should agree with it:
- `planRule(rule, health, state)` returns `none | top_up{amountBaseUnit} | release{amountBaseUnit}`. Sizing is `x = used ÷ target − equity`, rounded **up** to the minimum move and capped per move. It applies run-once and the release dwell. The agent still enforces the cooldown and the 24h cap, using its own move history.
- `planFunding(amount, funding, cfg, haircut)` decides which BNB funds pay for a top-up.
- `planHedge(hedge, held{qty,price}, positions, prices)` returns per leg `targetUnits`, `currentUnits`, `deltaUnits` (positive = more hedge) and `act`. Full execution steps: [Agent build guide](/docs/agent-build).

## 4. Reading state

| What | Call |
|---|---|
| BSC USDC/USDT | `balanceOf` on `0x8AC7…580d` / `0x55d3…7955` (18 dp) |
| bStock qty | `balanceOf` × `uiMultiplier()` / 1e18. **BEP-677: never use raw balanceOf as the position** |
| bStock price | PancakeSwap QuoterV2 `0xB048…5997` (quote every tier: 100/500/2500/10000) or Binance `NVDABUSDT` |
| Lighter equity/usage | `GET /api/v1/account?by=index&value=<acct>` → `total_asset_value`, `available_balance`, `positions[]`. Live: WS `user_stats/{acct}` (`margin_usage`, `available_balance`) |
| Derive equity/usage | `private/get_subaccount` → `collaterals_value`, `initial_margin` (= **excess**), `maintenance_margin`, `positions[]` |

Usage as the UI computes it: Lighter `(equity − available) / equity`; Derive `1 − initial_margin / collaterals_value`.

## 5. Acting

### Hedge (Lighter perp, Derive perp, Derive puts)
Use `planHedge` → per leg `deltaUnits` (positive = more hedge), sized by notional. Full steps (put selection, rolling, margin check): [Agent build guide §6](/docs/agent-build).
- **Lighter perp** (same symbol, or index proxy SPYB → US500 market 180, QQQB → US100 market 181): `SignCreateOrder(marketId, clientOrderIndex, baseAmount, price, isAsk, type=1 (market), tif=0 (IOC), reduceOnly, trigger=0, expiry=0, 0,0,0, 0,0, skipNonce=0, nonce, keyIdx, acct)`, then `POST /api/v1/sendTx`. Scale with `size_decimals`/`price_decimals`; the price is the worst acceptable price. Reference: `placeLighterOrder` in `lib/server/lighter.ts`.
- **Derive perp** (`NVDA-PERP`, or `US500`/`US100` as proxies, RWA universe): `private/order` from the subaccount whose universe lists it, IOC, limit 2% through the touch. Reference: `placeDeriveOrder` + `subaccountForUniverse` in `lib/server/derive.ts`.
- **Derive protective puts:** buy `<CCY>` puts at strike ≈ index × `put.strikePct`/100, expiry closest to `put.targetDaysToExpiry`; roll any held put with fewer than `put.minDaysToExpiry` days left.

### Top up Lighter from BNB
1. `USDC.transferFrom(user, AGENT_BSC_ADDRESS, amount)` (and `USDT` when the sources include `bsc_usdt`, then swap USDT to USDC on PancakeSwap V3, 0.01% pool). This only works within the allowance the user granted on the Risk management page.
   - **Selling bStocks** (source `sell_bstocks`, after USDC and USDT): for each symbol in `sellOrder` the agent pulls the bStock with `transferFrom` (allowance to the agent address), sells it for USDC on PancakeSwap V3 (see AGENT_BUILD.md 4.1), and bridges the proceeds. A sale is final.
2. Relay `POST /quote/v2`: `{user: AGENT_BSC_ADDRESS, recipient: "<user's Lighter accountIndex>", originChainId: 56, destinationChainId: 3586256, originCurrency: BSC USDC, destinationCurrency: "0", amount, tradeType: "EXACT_INPUT"}`.
3. Validate the steps exactly as `app/api/relay/quote/route.ts` does (router `0x4cd00e38…bc31`, token, amount), send them, then poll `/intents/status/v3`.
4. Post a `rebalance` event.

### Top up Derive from BNB
BSC → Relay → Ethereum USDC to the agent wallet, then `approve(ACTION_MANAGER)` + `depositToNewSubaccount(0x57B0…f02b, amount6dp, managerId 1, owner=user)`. The agent needs ETH for gas. After about 2 minutes, `private/transfer_spot` from the new subaccount into the trading subaccount (`credentials.subaccountId`).

### Release (venue → BNB)
- Lighter: secure withdraw (`SignWithdraw(3, 0, amount1e6, …)`, about 26 min to Ethereum, from the master account), then Relay ETH → BSC.
  - Alternative: the Relay Lighter-origin route, but that needs an L1 signature, which the agent doesn't have.
- Derive: `private/withdraw` (human amount, recipient = the owner, max fee $3), about 14 min to the owner's Ethereum address, then Relay ETH → BSC.
- **Working code to copy:** `withdrawLighter` / `lighterWithdrawals` (`lib/server/lighter.ts`), `withdrawDerive` / `deriveWithdrawals` (`lib/server/derive.ts`), `encodeWithdrawData` (`lib/derive-codec.ts`). The user-facing route is `POST /api/trade/withdraw {network, venue, amount, subaccountId?}` + `Idempotency-Key`, and `GET /api/trade/withdraw?network=&venue=` for status. These use the user's session, not the agent token; the agent signs with its own copy of the same functions.
- Note: released funds land in the **user's** Ethereum wallet, so bridging back to BSC needs the user, or a second allowance on Ethereum.

## 6. Safety rules for the agent
- Amounts are integers in base units, as strings. Never round a value that you will use as a transaction amount.
- Use one idempotency key per action (events and Relay requests) so a retry never doubles a top-up.
- Respect `maxSingleTopUpUsd`, `maxDailyMovedUsd` and `keepBscReserveUsd`, and the on-chain allowance, which is the hard cap.
- Put a timeout on every outbound call. Treat 5xx and timeouts as AMBIGUOUS: look the operation up before retrying a withdraw or transfer.
- Lighter secure withdrawals are limited to 3 per 2 h per L1 address. Derive `proven` calls run at about 1/s per wallet.

## 7. Endpoint references
- [Lighter](/docs/lighter) · [Derive](/docs/derive) · [Relay](/docs/relay) · [bStocks](/docs/bstocks)
