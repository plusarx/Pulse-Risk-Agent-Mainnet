# Agent build guide (step by step)

For: the developer building or extending the agent service. Companion to the [Agent integration guide](/docs/agent) (the API contract), the [Perps (Aster) notes](/docs/aster) and the [Reference (mainnet)](/docs/derive-api) pages (every venue endpoint). Updated 2026-11-26.

**What it does:** on every check (by default every 30 s), for every user, the agent reads live balances and positions, works out what the user's rules want, and either executes it or asks for approval:

1. **Top up margin.** The perps account or a Derive subaccount crosses its trigger. The agent pulls funds from the user's BNB wallet (selling bStocks if the user allowed it) and deposits them into that account.
2. **Release surplus.** An account sits on the other side of its release level for the configured time. On Derive the agent withdraws the surplus. On perps the agent cannot withdraw, so it reports that the user must do it in the app.
3. **Hedge bStocks.** Keep each hedge leg on target: short the stock's perp on Aster, short a Derive perp, or hold Derive protective puts (rolled before expiry).
4. **Check the prices it acts on.** Before it hedges against a bStock or sells one for margin, the price-integrity layer must trust that bStock's price (section 7).

The user's money never leaves the user's own accounts: BNB wallet, then their perps account or Derive subaccount, and back. The agent only signs with keys the user approved and within an allowance the user set.

```
 User (wallet) ──signs once──▶ Pulse Risk app (UI + backend)
                                   │  agent keys (encrypted), rules, rule state, activity
                                   ▼  /api/agent/v1/*  (Bearer AGENT_API_TOKEN)
                               AGENT SERVICE
       ┌────────────────────┬─────┴──────────────┬──────────────────────┐
  BNB Chain (56)        Aster (perps)         Derive (options)       Atlas · CoinMarketCap
  transferFrom user     USDT deposit via      deposit via Ethereum,  price-integrity reads,
  (allowance), sell     the Aster vault,      orders, transfer_spot, chat data tool
  bStocks on Pancake    orders (agent key)    withdraw (session key)
```

The perps leg needs no bridge: USDT goes from the agent wallet into the Aster vault, credited to the user's own account. Only Derive uses a bridge (BNB to Ethereum).

---

## 1. Project setup

1. **Stack:** Node 22.5 or newer, TypeScript, `viem`. The agent lives in `agent/` and imports the shared logic from `lib/`. Install with `cd agent && npm install`, copy `agent/.env.example` to `agent/.env`, then run:

```bash
cd agent
npm start        # the check loop
npm run chat     # the chat service (separate process, never executes)
```

2. **Import directly (pure, unit-tested):**

| Module | Use |
|---|---|
| `lib/agent-config.ts` | `AgentConfig`, `HedgeLeg`, `hedgeKey`, `RuleStateSchema` (validate what you read) |
| `lib/risk-rules.ts` | `planRule` (size a top-up or release), `ruleKey`, `effectiveCooldownSec`, `MIN_DEPOSIT_BASE_UNIT`, `MIN_COOLDOWN_SEC` |
| `lib/plan.ts` | `planFunding` (which BNB sources pay), `planHedge` (hedge deltas) |
| `lib/aster.ts` | Aster constants, the approval and request signing helpers, `symbolRules`, `stepQty` |
| `lib/integrity.ts`, `lib/integrity-sources.ts`, `lib/atlas-feeds.ts` | The price-integrity checks and their data fetchers |
| `lib/derive-codec.ts` | Derive EIP-712 action signing: `actionTypedData`, `encodeTradeData`, `encodeTransferData`, `nextNonce` |
| `lib/swap-path.ts`, `lib/bsc.ts` | PancakeSwap paths, `minOut`, ABIs, BSC addresses |
| `lib/venues.ts` | Mainnet URLs, contract addresses, module addresses |
| `lib/bstocks.ts` | Verified bStock list (never trust a token by symbol) |

3. **The agent's own tool modules** (read them before changing behaviour): `agent/src/tools/aster.ts` (reads, orders, leverage, signed with the Aster agent key), `asterDeposit.ts` (the BNB to perps top-up), `derive.ts` and `deriveFunding.ts` (Derive orders and the BNB to Derive top-up), `planner.ts` (candidates), `guard.ts` and `policy.ts` (hard checks), `executor.ts` (execution), `integrity.ts` (price integrity), `cmc.ts` (the chat data tool). Keys are never stored on the agent: it fetches them per check from `GET /api/agent/v1/credentials`.

4. **Env (agent side, `agent/.env`):**

| Var | Meaning |
|---|---|
| `APP_API_URL` | The app, for example `http://localhost:3100` |
| `AGENT_API_TOKEN` | Same value as the app's |
| `AGENT_NETWORK` | `mainnet` or `testnet`. Default is `testnet` |
| `TICK_INTERVAL_SEC` | Seconds between automatic checks. Default 30, minimum 5 |
| `DRY_RUN`, `ALLOW_LIVE` | The agent sends nothing unless `DRY_RUN=false` **and** `ALLOW_LIVE=yes-i-understand` |
| `AGENT_BSC_PRIVATE_KEY` | The agent's own wallet. Holds a little BNB for gas on BNB Chain (readiness warns below 0.0005 BNB) and, only if you use Derive, a little ETH on Ethereum (about 0.0003 ETH) |
| `BSC_RPC_URL`, `ETH_RPC_URL` | Paid RPCs recommended |
| `RELAY_API_KEY` | For the BNB to Ethereum bridge used by Derive top-ups |
| `OPENROUTER_API_KEY`, `LLM_MODE` | The language model that explains, ranks and reviews. `LLM_MODE` switches it on or off |
| `ATLAS_API_KEY` | Optional. Atlas oracle prices for the price-integrity layer. Without it that view is skipped |
| `CMC_API_KEY` | Optional. Enables the chat agent's CoinMarketCap data tool |

5. **Own database** (SQLite file at `AGENT_DB_PATH`, default `./data/agent.db`): `moves`, `locks` (one in-flight move per rule), `steps` (one row per completed step, the resume record, section 5), plus daily notional, equity baselines, anomaly counts and pauses. Never write to the app's database.

---

## 2. The check (one wake-up per wallet)

The loop wakes every few seconds and runs a wallet when it is due: on schedule (automatic checks on, every `TICK_INTERVAL_SEC`), when the user pressed Run now, or when an approved request is waiting. Per wallet, in `agent/src/index.ts`:

```ts
const wallets = await app.listWallets(network);         // GET /api/agent/v1/wallets
for (const w of wallets) {                              // one wallet at a time; one failing wallet never stops the others
  await sweepFallbackSafe(...);                         // Derive fallback money to the main subaccount (own 5-minute timer)
  if (!due(w)) continue;
  const snapshot = await collectSnapshot(w.wallet, network, w.config);   // section 3
  const ran = await runApproved(snapshot);              // requests the user approved run first, each re-planned and re-guarded
  if (!ran) await graph.invoke({ snapshot });           // validate, news, plan, analyst, decider, reviewer, confirm, guard, execute, report
  await app.postStatus(...);                            // posted every check, even with the kill switch on
}
```

The graph (`agent/src/graph/index.ts`): `validate → read_news → plan → analyst → decider → reviewer → confirm → guard → execute → report`. In *Ask me first* mode `confirm` posts a request and ends the run; in *Autonomous* mode it passes through. Any node can stop the run early. With nothing to do, the run ends without a model call.

Rules: **one action per wallet per check**, never two moves for the same rule in flight, and **fail closed**. If a price, balance or account cannot be read, that goes into the snapshot's data-quality notes and the move is skipped.

---

## 3. Reading state (per wallet)

`collectSnapshot` reads everything below. Each venue is read only if the user has a rule or hedge leg that needs it, and a venue whose key is missing is reported as a problem instead of failing the whole check.

| What | How | Notes |
|---|---|---|
| Perps account (Aster) | Signed `GET /fapi/v3/account` and `/fapi/v3/positionRisk` with the agent key | A never-funded account answers `-5050`; the agent reads that as connected, $0, no positions |
| Perps health | equity = `totalMarginBalance`; used = equity minus `availableBalance`; utilization = used ÷ equity | `healthOf` in `agent/src/tools/aster.ts`. One perps account per wallet, so its rule key is `aster:` (empty account) |
| Perps positions | `positionRisk`, signed size per ticker (negative = short) | One-way mode |
| Perps markets | Public `GET /fapi/v1/exchangeInfo`, cached 10 minutes: min quantity, step, tick, min notional | The minimum order is $5 |
| Derive subaccounts | `private/get_account` (ids and `fallback_subaccount_id`) then `private/get_subaccount` each | Skip the fallback. Headers signed by the session key |
| Derive health | collateral = `collaterals_value`; used = collateral minus `initial_margin` (`initial_margin` is **free headroom**); utilization = used ÷ collateral | |
| BNB wallet | `balanceOf` USDC and USDT (18 dp); each bStock `balanceOf × uiMultiplier() ÷ 1e18` | Raw amounts for transfers, UI amounts for value |
| bStock prices | PancakeSwap prices for value (`pancake.priceOf`); the quoter for what a sale actually returns | Sell size always from the **quoter** |
| Allowance left | `allowance(user, agentBsc)` on USDC, USDT and each bStock | The on-chain allowance is the hard cap |
| Hedge prices | Perps mark price (`premiumIndex`); Derive `public/get_ticker` | |
| Price integrity | `refreshIntegrity`: Atlas feed, CoinMarketCap DEX data, the stock's perp, the reference price | Only when the user's switch is on. Never throws; unavailable means "behave as before" |

Build `AccountHealth = { connected, accountUsd, usedUsd, utilBps }` per `ruleKey` (`aster:`, `derive:<subId>`). That is exactly what `planRule` takes.

---

## 4. Rebalance (top-up and release)

`planner.ts` turns each enabled rule into a candidate:

```ts
for (const rule of cfg.rebalance.rules.filter(r => r.enabled)) {
  const key = ruleKey(rule); const h = health[key]; const s = state[key] ?? {};
  // keep the release dwell clock current: set releaseBelowSince when the release condition starts, clear it when it stops
  const a = planRule(rule, h, s);                          // none | top_up{amountBaseUnit} | release{amountBaseUnit}
  if (a.kind === 'none') continue;
  // guard.ts then checks: minimum move, per-move cap, 24 h cap, cooldown, lock, funding and allowance, price integrity
}
```

The cooldown is never shorter than the venue's credit time (`MIN_COOLDOWN_SEC`, 300 s for both venues), because a second top-up before the first lands would double-fund.

### 4.1 Top-up: perps account (Aster, funded from your BNB wallet, no bridge)

Code: `agent/src/tools/asterDeposit.ts` (`fundAster`). No bridge.

1. **Check the agent's gas first.** About 0.0005 BNB must be on the agent wallet **before** anything is pulled, so the agent never moves the user's funds onto a wallet that cannot finish.
2. **Fund.** `planFunding` gives the sources, for example USDC, then USDT, then bStocks sold in the user's `sellOrder`. The funding fit is re-checked in `guard.ts`: on-chain allowance, BNB reserve (`keepBscReserveBaseUnit`), the bStock being in `sellOrder`, and the bStock's price being trusted (section 7).
3. **Pull.** `transferFrom(user, agentBsc, amount)` for USDC and USDT. It reverts above the allowance. For a bStock, raw = ui × 1e18 ÷ `uiMultiplier`.
4. **Sell bStocks** (only if the plan says so). The agent sells through PancakeSwap (`pancake.sellBstockForUsdc`) with a 1% max slippage.
5. **Swap to USDT.** All USDC becomes USDT on the PancakeSwap V3 0.01% pool (fee `100`) with 0.5% max slippage.
6. **Deposit.** Approve USDT to the Aster vault `0x128463A60784c4D3f46c23Af3f65Ed859Ba87974`, then `depositFor(USDT, user, amount, broker 1)`. The credited account is the **user's own wallet**. The smallest top-up is $6 (`MIN_DEPOSIT_BASE_UNIT`).
7. **Wait for the credit.** Poll the futures USDT balance (`GET /fapi/v3/balance`) for up to 90 s. If it has not arrived, the agent tries a spot to futures transfer, then waits 30 s more.
8. **Report.** One event per top-up plus the rule state `{lastMoveAt, lastOutcome, lastOutcomeMsg, topUpDoneAt?}` (`topUpDoneAt` only when `rule.topUpOnce`).

**Unverified live:** the agent paying `depositFor` for a different account (agent pays, user is credited) and the spot to futures fallback were decoded from real deposits and the exchange docs but not yet seen working with real funds. See [Perps (Aster) notes](/docs/aster).

### 4.2 Top-up: Derive subaccount

Steps 1 to 4 as above (the agent's Ethereum gas is checked too, about 0.0003 ETH), then (`agent/src/tools/deriveFunding.ts`):

5. **Bridge to Ethereum.** Relay quote `56 → 1`, BSC USDC to Ethereum USDC, **recipient = the agent's own Ethereum address** (the agent pays the Ethereum gas). Validate the quote (router, token, amount, depositor) before sending, then poll until it lands.
6. **Deposit for the user.** On Ethereum: `USDC.approve(ActionManager 0xE366…FAD3, amount6dp)` then `ActionManager.depositToNewSubaccount(asset, amount6dp, managerId, owner = USER wallet)`. managerId is the target subaccount's margin manager. **Below the venue minimum the deposit is lost**, so the agent refuses Derive top-ups under $8 (the bridge fee comes off the amount).
7. **Wait for the credit.** Poll `public/get_onchain_action_history {wallet: user}` for the tx hash with status `applied`, then read `private/get_account` to find the new subaccount id.
8. **Consolidate.** `private/transfer_spot` from the new subaccount into the rule's subaccount.
9. **Report** as above with `venue: 'derive'`.

### 4.3 Release

- **Perps (Aster):** the agent cannot withdraw. When a release is due, the planner records that the margin could be released but that **withdrawals from perps need the user's wallet signature in the app**, and sends nothing. The user withdraws in the app.
- **Derive:** `private/withdraw {subaccount_id, asset_name: "USDC", amount_in_underlying: "<human decimal>", recipient: <owner>, ...}` signed by the session key with the WITHDRAW module. It pays the user's own Ethereum address. Bringing it back to BNB Chain needs the **user** (their wallet holds it), so the agent reports `"released $X to your Ethereum wallet"`.
- Rule state: `lastMoveAt`, `releaseDoneAt` if `releaseOnce`, clear `releaseBelowSince`.

---

## 5. Every money move is a resumable set of steps

A crash in the middle of a move must never lose money or double-fund. Each step runs through `once(key, label, fn)`: if the `steps` table already has `key` as done, the step is skipped and its saved reference (a tx hash or an amount) is reused. A resumed run therefore carries on from the last finished step.

```
gas check ─▶ pull USDT/USDC ─▶ pull + sell bStocks ─▶ swap to USDT ─▶ approve ─▶ deposit ─▶ wait for credit
Derive: … ─▶ bridge ─▶ bridge_wait ─▶ deposit ─▶ credit ─▶ consolidate
```

- The balance **before** a deposit is recorded once, so a resumed run compares against the same number.
- An ambiguous result (timeout, 5xx) is not retried blindly: look it up first (tx receipt, relay status, Derive history).
- Use a stable idempotency key per action (`idempotencyKey` on the candidate), so retries never duplicate the activity feed. For perps orders the agent also sends a client order id, but Aster honouring it on V3 is **unverified**, so every order is also guarded by its own step record.

---

## 6. Hedge

```ts
const positions = {};  // hedgeKey → signed perp size, or long put contracts
//   aster:<TICKER>          signed position size on the user's perps account
//   derive-perp:<CCY>       sum of signed <CCY>-PERP amounts over Derive subaccounts
//   derive-put:<CCY>        sum of LONG put contracts on <CCY>
const plans = planHedge(cfg.hedge, held /* {qty, price} per bStock */, positions, prices);
```

If the user has not set a leg for a held bStock whose stock has a perp on Aster, `defaultHedgeLegs` adds one at ratio 1 (the user's own legs always win). A stock with no perp stays without a leg; the planner tries a proxy or reports it as unhedgeable.

| Leg | Execute `deltaUnits` (positive = more hedge) |
|---|---|
| Aster perp | Same-ticker USDT perp (NVDAB hedges `NVDAUSDT`). Market order on the V3 endpoint: more hedge = SELL, less = BUY with `reduceOnly`. Quantity is rounded **down** to the market's step. Before and after, the agent reads the position to confirm it moved |
| Derive perp | `private/order` on `<CCY>-PERP`, routed to the subaccount whose universe lists it. Market = limit through the touch, `ioc` |
| Derive puts | **Choose the put:** from `public/get_all_live_instruments`, keep puts with days-to-expiry at or above `put.minDaysToExpiry`; pick the expiry closest to `put.targetDaysToExpiry`, then the strike closest to index × `put.strikePct` ÷ 100. **Buy** the contracts at the ask plus a small buffer, IOC. **Roll:** a held put under `minDaysToExpiry` is sold (reduce-only) and replaced in the same run |

- A bStock and its hedge can differ in price units. `planHedge` sizes by **notional**, so use `targetUnits` and `deltaUnits` as given. Never map bStock units 1:1 onto an index perp.
- **Round to the market's step, then skip anything under the venue minimum** (report it, do not send it). On Aster that is the market's minimum quantity and the **$5** minimum notional (`orderQty` in `agent/src/tools/aster.ts`). Read both live from `exchangeInfo`.
- **Leverage.** A hedge from the rules does not change leverage. A trade the user asked for in chat may carry a leverage; the executor sets it on the market first (once) and the policy refuses anything above the user's `limits.maxLeverage`.
- **The decision must be deterministic.** The action to place (or skip) comes from `planRule` / `planFunding` / `planHedge` plus the hard checks in section 7. A language model may write the user-facing message but must not veto or resize a move: two runs on the same inputs produce the same action.
- **Before hedging on Derive, check margin** (`public/order_quote` or `private/get_margin`). If invalid, top up first or report and skip. On Aster a hedge that needs more margin first runs the same BNB to perps top-up (section 4.1).
- Report each hedge trade as an event, for example `{kind: 'hedge', venue, status, message: 'Shorted 1.63 NVDA on perps', payload: {key, deltaUnits}}`.

---

## 7. Safety (non-negotiable)

- **Money is integers in base units, as strings.** BSC USDC and USDT are 18 dp, Ethereum USDC 6 dp, rule amounts are USDC base units (6 dp), and Derive signs x1e18 while its withdraw amounts are human decimals.
- **Destinations only from config and verified ownership.** The perps deposit is always credited to the signed-in user's own wallet (`fundAster` refuses if the key's owner is not that wallet). Derive subaccounts must appear under `private/get_account`. The Relay recipient is the agent's own Ethereum wallet, and the deposit owner is the user.
- **Limits enforced in code** (`policy.ts` and `guard.ts`, re-checked right before execution, and the model cannot loosen them): kill switch, `maxNotionalPerTradeUsd`, `maxNotionalPerDayUsd`, `maxLeverage`, `dailyLossCapUsd` (only risk-reducing actions after it), `maxCapitalOffBnbUsd`, autonomy expiry, the on-chain allowance, `maxPerMoveBaseUnit`, `dailyCapBaseUnit`, `minMoveBaseUnit`, cooldown, `keepBscReserveBaseUnit`, and run-once markers.
- **Anomaly stop.** Too many intents or refusals inside a window pauses the agent for `PAUSE_MIN` minutes.
- **Price integrity** (`agent/src/tools/integrity.ts`, `lib/integrity.ts`). For each held bStock the agent compares an Atlas oracle price (with its age and consensus score), the CoinMarketCap DEX price and pool depth, the underlying stock's perp, and the reference price. A **block** verdict (stale oracle, a gap of 4% or more to the stock's perp, or a pool under $100k) makes the guard refuse to hedge against that bStock and refuse to sell it for margin, with the reason. A **watch** verdict only raises the haircut, never below the user's own. With fewer than two sources the token reads **unavailable** and nothing changes: the agent never blocks because of its own outage. A reduce-only close never relies on the price. The user's switch (`config.integrity.enabled`, default on) turns the whole layer off, and then behaviour is exactly the flat haircut with no checks.
- **Timeouts on every call.** Aster calls have a 10 s timeout and back off on 418 and 429. A 5xx or timeout is UNKNOWN, not failed (section 5).
- **Kill switch:** `limits.killSwitch`, automation on/off (`config.rebalance.enabled`) and hedge on/off are re-read every check. Revoking the allowance stops BNB pulls at the chain level.
- **The agent key can trade but never withdraw.** The Aster agent is approved with `canWithdraw=false` and no spot trading. Keys are fetched per check and never stored or logged. Never log the agent token.
- **Live needs two switches.** `DRY_RUN=false` and `ALLOW_LIVE=yes-i-understand`. Anything else is a dry run.

---

## 8. Build order and how to test each step (mainnet, small amounts)

| # | Build | Done when | How to test |
|---|---|---|---|
| 1 | Read-only check (sections 2 and 3) plus `planRule` / `planHedge` | For every rule card, the agent logs the same "needs top-up" or "in band" the Risk page shows | Point it at your wallet in a dry run; compare with the page side by side |
| 2 | Reporting | Events show in Risk management, Agent activity; rule cards show `lastOutcomeMsg` | The status and events are posted every check |
| 3 | Perps top-up from BNB USDC (section 4.1) | A rule with its trigger just below current utilization gets topped up once; the cooldown blocks a second | $10 USDC on BNB, allowance $10, rule trigger = current utilization minus 1% |
| 4 | Resumable moves (section 5) | Killing the agent after the deposit tx, then restarting, finishes the move without double funding | Kill it right after the `depositFor` transaction |
| 5 | Perps hedge (section 6) | NVDAB held, a short of about that notional appears on `NVDAUSDT`; changing the ratio re-hedges | Buy a little NVDAB on Spot, enable a hedge leg on the Risk page. Mind the $5 minimum order |
| 6 | Price integrity (section 7) | The Price integrity panel shows a verdict per token; switching it off restores the flat haircut | Compare with the live Atlas and CoinMarketCap numbers; flip the switch |
| 7 | Sell bStocks to fund (section 4.1) | With $0 USDC, a top-up sells bStocks in `sellOrder` | Allowance on NVDAB, USDC at 0 |
| 8 | Derive top-up (section 4.2) | The new subaccount is credited and consolidated into the rule's subaccount | $10, RWA subaccount enabled |
| 9 | Derive protective puts and roll (section 6) | Puts at the chosen strike and expiry appear; a put under the roll threshold is replaced | `minDaysToExpiry` higher than the held put's days |
| 10 | Release (section 4.3) | Derive surplus withdraws to the user's Ethereum after the dwell time; perps release is reported as "needs your signature" | Release level above current utilization, 1-minute dwell |

The agent's tests: `cd agent && npm test`. The app's: `npm test` at the project root. The Risk page's **Scenario forecast** shows where triggers and liquidations sit, which helps pick test levels.

---

## 9. Chat and data tools

The chat service (`npm run chat`) cannot execute, approve or save anything. It answers questions and creates **requests** the user approves. Its read tools include the portfolio, the perps account and markets, the price-integrity detail, and `get_cmc_data` (`agent/src/tools/cmc.ts`): the next 7 days of scheduled events for a US stock, a crypto market overview, and a derivatives overview, all read from the CoinMarketCap MCP server with `CMC_API_KEY`. Only those three fixed calls are allowed, every call has a timeout, the reply is capped, and without a key the tool says it is not set up. It never moves a hedge on its own.

---

## 10. Pointers

- API contract: [Agent integration guide](/docs/agent) (wallets, credentials, config, events, rule-state)
- Venue endpoints: Endpoints, Reference (mainnet): Derive, Relay, BNB Chain and bStocks. Aster: [Perps (Aster) notes](/docs/aster)
- Working examples in the app: `lib/server/aster.ts` (key registration, orders, deposits), `lib/server/derive.ts` (orders, transfer_spot, universes), `app/api/relay/quote/route.ts` (Relay validation), `components/spot/SwapTicket.tsx` (PancakeSwap), `components/funding/useTxRunner.ts` and `app/funding/page.tsx` (Ethereum deposits)
- Gotchas: [Perps (Aster)](/docs/aster), [Options](/docs/derive), [Relay](/docs/relay), [bStocks](/docs/bstocks). Aster `-1000` means the agent was not approved or was replaced by a same-name agent; Derive withdraw amounts are human decimals; Derive below-minimum deposits are lost.
- The earlier Lighter venue is kept in the code but dormant; the app and the agent use Aster for perps.
