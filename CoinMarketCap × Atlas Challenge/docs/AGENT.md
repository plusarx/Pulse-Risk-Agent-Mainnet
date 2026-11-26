# Agent integration guide

This guide is for the developer building the **hedging + margin-rebalancing agent**. This app (UI + small backend) owns wallet login, agent-key registration, user rules and the activity log. Your service owns the loop that reads state and calls the venues.

```
 Wallet (user)  ──signs once──▶ Pulse Risk backend (this repo)        Your agent service
   │ BSC: holds USDC + bStocks       • SQLite: encrypted agent keys   ◀─ GET  /api/agent/v1/wallets
   │ grants capped allowance ─┐      • rules (hedge / rebalance)     ◀─ GET  /api/agent/v1/credentials
   │                          │      • activity log                  ◀─ GET  /api/agent/v1/config
   ▼                          └────▶ agent BSC wallet (AGENT_BSC_ADDRESS) ─ POST /api/agent/v1/events
 Aster perps account ◀── USDT depositFor (no bridge) ◀── transferFrom(user) ─ your loop
 Derive subaccount ◀── Ethereum deposit ◀── Relay
```

## 1. Auth

Every `/api/agent/v1/*` call needs `Authorization: Bearer $AGENT_API_TOKEN` (set the same value in both services; ≥ 24 chars). The token gives access to decrypted venue keys, so keep it in a secret store.

## 2. Endpoints for the agent

### `GET /api/agent/v1/wallets?network=mainnet|testnet`
Every wallet with an active key or saved rules.
```json
{ "wallets": [ { "wallet": "0xabc…", "keys": [ { "venue": "aster", "accountRef": "0xuser…", "keyRef": "0xagent…", "status": "active", "expiresAt": 1811230549223 } ],
                 "config": { …AgentConfig… } } ] }
```

### `GET /api/agent/v1/credentials?wallet=0x…&venue=aster|derive&network=…`
- Aster: `{ user, agentAddress, agentPrivateKey, scope, expiresAt }`. `user` is the owner's wallet. The agent key signs every read and order as the signer for `user` (signing details: [Aster notes](/docs/aster)).
- Derive: `{ subaccountId, sessionKeyAddress, sessionPrivateKey, expiresAt }`. The key signs `X-DeriveSignature` and every action, with `owner = wallet` and `signer = sessionKeyAddress`.

Scopes granted:
- **Aster**: perp trading and reads only (`canPerpTrade`). No spot trading and **no withdraw**: money leaves Aster only with the owner's own wallet signature. The key expires after 180 days.
- **Derive**: `trade:all, withdraw, transfer:existing_subaccount, transfer:new_subaccount`. The owner is whitelisted as a withdrawal recipient.

### `GET /api/agent/v1/config?wallet=…&network=…`
Returns the `AgentConfig` (schema: `lib/agent-config.ts`). Defaults apply until the user saves.

### `POST /api/agent/v1/events`
Shows up live under **Risk management → Agent activity**. Idempotent on `(wallet, idempotencyKey)`.
```json
{ "wallet": "0x…", "network": "mainnet", "kind": "rebalance", "venue": "aster", "status": "done",
  "message": "Topped up perps $250 from BSC USDC",
  "payload": { "direction": "in", "amountUsd": 250, "ruleKey": "aster:" }, "idempotencyKey": "rb-0xabc-1732350000" }
```
- `kind`: `hedge | rebalance | bridge | info | error`. `status`: `pending | done | failed`.
- For `rebalance`/`bridge` events, set `payload.direction` (`in` = top-up, `out` = release) and `payload.amountUsd`. The "Recent moves" list and the 24h totals read them.

### `GET /api/agent/v1/rule-state?wallet=…&network=…`
Returns `{states: {<ruleKey>: {topUpDoneAt, releaseDoneAt, releaseBelowSince, lastMoveAt, lastOutcome, lastOutcomeMsg, lastOutcomeAt}}}`. Read it each tick before planning.

### `POST /api/agent/v1/rule-state`
Runtime state per rule. It's stored apart from the rules, so a user saving rules never wipes it. Fields you omit are kept; `null` clears a field.
```json
{ "wallet": "0x…", "network": "testnet", "ruleKey": "aster:",
  "topUpDoneAt": "2026-11-23T09:00:00Z", "releaseDoneAt": null, "releaseBelowSince": "2026-11-23T08:40:00Z",
  "lastMoveAt": "…", "lastOutcome": "topped-up", "lastOutcomeMsg": "Topped up $25 from BNB USDC" }
```
- `ruleKey` = `<venue>:<accountRef>`: `aster:` for the perps account, `derive:<subaccountId>` for a Derive subaccount.
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
| `hedge.legs[]` | `{bstock, venue: 'aster'\|'derive', kind: 'perp'\|'put', market, hedgeRatio, put?: {strikePct, minDaysToExpiry, targetDaysToExpiry}}`. Sized by notional: target units = bStock qty × price × ratio ÷ hedge price. Key for positions: `hedgeKey(leg)` |
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
| `venue`, `accountRef` | `aster` + `''` (the perps account), or `derive` + subaccount id (one per risk universe) |
| `mode` | `utilization` (margin used ÷ account value, uses the `*Bps` fields) or `account_value` (USD, uses the `*BaseUnit` fields) |
| `triggerBps`/`triggerBaseUnit` → `targetBps`/`targetBaseUnit` | Top up when utilization goes **above** the trigger (or account value goes **below** it), back to the target |
| `topUpOnce`, `releaseOnce` | Make one move, then pause that direction until re-armed |
| `releaseOn`, `releaseLevel*`, `releaseForSec`, `releaseTarget*` | Release the surplus when utilization stays **below** (or value stays **above**) the level for `releaseForSec`, down to the release target. A null release target means use the top-up target |
| `maxPerMoveBaseUnit`, `dailyCapBaseUnit`, `minMoveBaseUnit`, `cooldownSec` | Limits. The minimum move is at least the venue's deposit floor (Aster $6, Derive $7). The effective cooldown is at least 5 min (venue credit time) |
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
| Aster equity/usage | signed `GET /fapi/v3/account` → `totalMarginBalance`, `availableBalance`; `GET /fapi/v3/positionRisk` → positions (size, entry, leverage, liquidation price). `-5050` means the account was never funded: read it as $0, not an error |
| Derive equity/usage | `private/get_subaccount` → `collaterals_value`, `initial_margin` (= **excess**), `maintenance_margin`, `positions[]` |

Usage as the UI computes it: Aster `(equity − available) / equity`; Derive `1 − initial_margin / collaterals_value`.

## 5. Acting

### Hedge (Aster perp, Derive perp, Derive puts)
Use `planHedge` → per leg `deltaUnits` (positive = more hedge), sized by notional. Full steps (put selection, rolling, margin check): [Agent build guide](/docs/agent-build).
- **Aster perp** (`<TICKER>USDT`, for example `NVDAUSDT`): a signed `POST /fapi/v3/order`, market order, `reduceOnly` when closing. Round the size to the market's step and keep the notional at or above the $5 minimum. Set leverage first with `POST /fapi/v3/leverage` when the leg needs a specific one (the user's `limits.maxLeverage` is a hard cap). Reference: `placeMarketOrder` in `agent/src/tools/aster.ts`.
- **Derive perp** (`NVDA-PERP`, or `US500`/`US100` as proxies, RWA universe): `private/order` from the subaccount whose universe lists it, IOC, limit 2% through the touch. Reference: `placeDeriveOrder` + `subaccountForUniverse` in `lib/server/derive.ts`.
- **Derive protective puts:** buy `<CCY>` puts at strike ≈ index × `put.strikePct`/100, expiry closest to `put.targetDaysToExpiry`; roll any held put with fewer than `put.minDaysToExpiry` days left.
- **Price integrity gate:** with `integrity.enabled`, a bStock whose price verdict is `block` is not hedged against and not sold for funding. Collateral value uses the per-token haircut, never below `collateral.bstockHaircut`. Reference: `agent/src/tools/integrity.ts`.

### Top up the perps account from BNB (no bridge)
1. `USDC.transferFrom(user, AGENT_BSC_ADDRESS, amount)` (and `USDT` when the sources include `bsc_usdt`). This only works within the allowance the user granted on the Risk management page. Check the agent's BNB gas **before** anything is pulled.
   - **Selling bStocks** (source `sell_bstocks`, after USDC and USDT): for each symbol in `sellOrder` the agent pulls the bStock with `transferFrom`, sells it for USDC on PancakeSwap V3 (see the build guide), and continues with the proceeds. A sale is final.
2. Swap the USDC to USDT on PancakeSwap V3 (0.01% pool).
3. Approve USDT to the Aster vault `0x1284…7974` and call `depositFor(USDT, user, amount, broker 1)`. The deposit lands in futures margin and shows up as a `DEPOSIT` row in `/fapi/v3/income`.
4. Poll the user's futures balance. Reference: `agent/src/tools/asterDeposit.ts`. Each step is stored under its own idempotency key, so a crash and retry resumes where it stopped.
5. Post a `rebalance` event.

*Unverified live:* crediting an account other than the sender with `depositFor`, and the spot-to-futures fallback. The smallest top-up is $6.

### Top up Derive from BNB
BSC → Relay → Ethereum USDC to the agent wallet, then `approve(ACTION_MANAGER)` + `depositToNewSubaccount(0x57B0…f02b, amount6dp, managerId 1, owner=user)`. The agent needs ETH for gas. After about 2 minutes, `private/transfer_spot` from the new subaccount into the trading subaccount (`credentials.subaccountId`).

### Release (venue → BNB)
- **Aster: the agent cannot release.** Withdrawals need the owner's own wallet signature, so a release rule on the perps account produces a note for the user instead of a move. The user withdraws in the app: `POST /api/trade/withdraw` with `venue: 'aster'` has two steps, `prepare` (returns typed data the user signs in your wallet) and `submit` (needs `Idempotency-Key`). The withdrawal history for Aster is not listed yet. `/api/trade/aster-transfer` is only the spot-to-futures move used by the deposit fallback.
- **Derive:** `private/withdraw` (human amount, recipient = the owner, max fee $3), about 14 min to the owner's Ethereum address, then Relay ETH → BSC.
- **Working code to copy:** `withdrawDerive` / `deriveWithdrawals` (`lib/server/derive.ts`), `encodeWithdrawData` (`lib/derive-codec.ts`). The user-facing route is `POST /api/trade/withdraw {network, venue, amount, subaccountId?}` + `Idempotency-Key`, and `GET /api/trade/withdraw?network=&venue=` for status. These use the user's session, not the agent token.
- Released Derive funds land in the **user's** Ethereum wallet, so bridging back to BSC needs the user, or a second allowance on Ethereum.

## 6. Safety rules for the agent
- Amounts are integers in base units, as strings. Never round a value that you will use as a transaction amount.
- Use one idempotency key per action (events and Relay requests) so a retry never doubles a top-up.
- Respect `maxSingleTopUpUsd`, `maxDailyMovedUsd` and `keepBscReserveUsd`, and the on-chain allowance, which is the hard cap.
- Put a timeout on every outbound call. Treat 5xx and timeouts as AMBIGUOUS: look the operation up before retrying a withdraw or transfer.
- Aster answers `418`/`429` when you are rate limited: back off and retry. Derive `proven` calls run at about 1/s per wallet.
- Never give the agent more than it needs: the Aster agent key cannot withdraw, and a rotated or replaced key returns `-1000 No agent found` (stop and tell the user to rotate it, do not retry).

## 7. Endpoint references
- [Aster](/docs/aster) · [Derive](/docs/derive) · [Relay](/docs/relay) · [bStocks](/docs/bstocks)
