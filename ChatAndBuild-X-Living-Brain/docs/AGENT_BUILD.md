# Agent build guide (step by step)

For: **Gaurav Bhisikar**, building the agent service. Companion to [Agent integration guide](/docs/agent) (the API contract) and the [Reference (mainnet)](/docs/derive-api) pages (every venue endpoint). Updated 2026-11-23.

**What it does:** every 30 s, for every user, the agent reads live balances and positions, works out what the user's rules want, and executes it:

1. **Top up margin.** A Lighter account or Derive subaccount crosses its trigger → pull USDC from the user's BNB wallet (selling bStocks if needed) → bridge → deposit into that account.
2. **Release surplus.** An account sits on the other side of its release level for the configured time → withdraw the surplus back towards BNB.
3. **Hedge bStocks.** Keep each hedge leg on target: short a Lighter perp, short a Derive perp, or hold Derive protective puts (rolled before expiry).

The user's money never leaves the user's own accounts: BNB wallet → their Lighter account / Derive subaccount → back. The agent only signs with keys the user approved and within an allowance the user set.

```
 User (MetaMask) ──signs once──▶ Pulse Risk app (UI + backend, this repo)
                                   │  agent keys (encrypted), rules, rule state, activity
                                   ▼  /api/agent/v1/*  (Bearer AGENT_API_TOKEN)
                               AGENT SERVICE (you)
       ┌────────────────────┬─────┴──────────────┬──────────────────────┐
  BNB Chain (56)        Relay bridge         Lighter (perps)        Derive (options/perps)
  transferFrom user     BSC → Lighter acct   orders, transfers,     deposit via Ethereum,
  (allowance), sell     BSC → Ethereum       withdraw (API key)     orders, transfer_spot,
  bStocks on Pancake                                                withdraw (session key)
```

---

## 1. Project setup

1. **Stack:** Node ≥ 22.5, TypeScript, `viem` (same versions as the app's `package.json`). One long-running process. Put it in this repo under `agent/` so it can import the shared logic.
2. **Run with** `NODE_OPTIONS=--conditions=react-server npx tsx agent/main.ts`. Some app files start with `import 'server-only'`, which throws under plain Node; the `react-server` condition makes it a no-op (verified).
3. **Import directly (pure, unit-tested):**

| Module | Use |
|---|---|
| `lib/agent-config.ts` | `AgentConfig`, `HedgeLeg`, `hedgeKey`, `RuleStateSchema` (validate what you read) |
| `lib/risk-rules.ts` | `planRule` (size a top-up/release), `ruleKey`, `effectiveCooldownSec`, `MIN_DEPOSIT_BASE_UNIT` |
| `lib/plan.ts` | `planFunding` (which BNB sources pay), `planHedge` (hedge deltas) |
| `lib/derive-codec.ts` | Derive EIP-712 action signing: `actionTypedData`, `encodeTradeData`, `encodeTransferData`, `nextNonce` |
| `lib/swap-path.ts`, `lib/bsc.ts` | PancakeSwap paths, `minOut`, ABIs, BSC addresses |
| `lib/venues.ts` | Mainnet URLs, contract addresses, module addresses |
| `lib/bstocks.ts` | Verified bStock list (never trust a token by symbol) |
| `lib/scenario.ts` | `bs()` Black-Scholes, `parseDeriveOption` (for put selection) |

4. **Copy, don't import** (they read the app's database): from `lib/server/lighter.ts` copy the WASM signer loader (`signer()`), `sendTx`, `nextNonce`, `lighterGet`; from `lib/server/derive.ts` copy `deriveRpc`, the header signing in `agentHeaders`, `transferSpot`, `placeDeriveOrder`, `subaccountForUniverse`. Replace "read key from DB" with the credentials from `GET /api/agent/v1/credentials`. The Lighter WASM is `vendor/lighter/lighter-signer.wasm` + `wasm_exec.js` (lighter-go v1.0.13).
5. **Env (agent side):**

| Var | Meaning |
|---|---|
| `APP_URL` | The app, e.g. `http://localhost:3100` |
| `AGENT_API_TOKEN` | Same value as the app's |
| `AGENT_BSC_PRIVATE_KEY` | The agent's own BNB Chain wallet (its address = the app's `AGENT_BSC_ADDRESS`). Holds ~$5 of BNB for gas |
| `AGENT_ETH_PRIVATE_KEY` | Same key is fine; holds ~$20 of ETH for the Derive deposit leg on Ethereum |
| `BSC_RPC_URL`, `ETH_RPC_URL` | Paid RPCs recommended |
| `RELAY_API_KEY` | From dashboard.relay.link (keyless works but is rate-limited) |
| `NETWORK` | `mainnet` (testnet has no Relay routes, so the BNB leg can't be tested there) |
| `TICK_MS` | 30000 |

6. **Own database** (SQLite file): `moves` (one row per top-up/release with a state machine, §5), `daily_totals`, `locks` (one in-flight move per rule). Never write to the app's database.

---

## 2. The tick (one function, every 30 s)

```ts
for (const network of ['mainnet']) {
  const { wallets } = await api.get(`/api/agent/v1/wallets?network=${network}`);
  for (const w of wallets) {                       // sequential per wallet; wallets can run in parallel (limit 4)
    try { await tickWallet(network, w); }
    catch (e) { await report(w, 'error', `tick failed: ${e.message}`); }  // never let one wallet stop the loop
  }
}

async function tickWallet(network, w) {
  const cfg   = AgentConfig.parse(w.config);
  const state = (await api.get(`/api/agent/v1/rule-state?wallet=${w.wallet}&network=${network}`)).states;
  const creds = { lighter: await credsOrNull(w, 'lighter'), derive: await credsOrNull(w, 'derive') };
  await resumeInFlightMoves(w);                    // §5: finish anything a crash interrupted FIRST
  const health = await readHealth(w, cfg, creds);  // §3
  if (cfg.rebalance.enabled) await rebalance(w, cfg, state, health, creds);   // §4
  if (cfg.hedge.enabled)     await hedge(w, cfg, health, creds);              // §6
}
```

Rules: **one money move per wallet per tick**, never two moves for the same rule in flight, and **fail closed**. If a price, balance or account can't be read, report `error` and skip the wallet for this tick.

---

## 3. Reading state (per wallet)

| What | How | Notes |
|---|---|---|
| Lighter accounts | `GET /api/v1/account?by=l1_address&value=<wallet>` | Master + sub-accounts. Per account: `total_asset_value` (equity), `available_balance`, `positions[]` (`sign`, `position`, `position_value`, `liquidation_price`) |
| Lighter health | equity = `total_asset_value`; used = equity − `available_balance`; utilization = used ÷ equity | Same formula as the UI (`lib/hooks/useRiskAccounts.ts`) |
| Derive subaccounts | `private/get_account` (ids + `fallback_subaccount_id`) then `private/get_subaccount` each | Skip the fallback. Headers signed by the session key |
| Derive health | collateral = `collaterals_value`; used = collateral − `initial_margin` (`initial_margin` is **free headroom**); utilization = used ÷ collateral; account value = collateral + `positions_value` | |
| BNB wallet | `balanceOf` USDC/USDT (18 dp); each bStock `balanceOf × uiMultiplier() ÷ 1e18` | Raw amounts for transfers, UI amounts for value |
| bStock prices | Binance `GET /api/v3/ticker/24hr?symbols=[…]` for value; PancakeSwap QuoterV2 for what a sale actually returns | Sell size always from the **quoter** |
| Allowance left | `allowance(user, agentBsc)` on USDC/USDT/each bStock | The on-chain allowance is the hard cap |
| Hedge prices | Lighter `orderBookDetails` `mark_price`; Derive `public/get_ticker <CCY>-PERP` → `M` (perp) / `I` (puts) | |

Build `AccountHealth = { connected, accountUsd, usedUsd, utilBps }` per `ruleKey` (`lighter:`, `lighter:<subIdx>`, `derive:<subId>`). That's exactly what `planRule` takes.

---

## 4. Rebalance (top-up and release)

```ts
for (const rule of cfg.rebalance.rules.filter(r => r.enabled)) {
  const key = ruleKey(rule); const h = health[key]; const s = state[key] ?? {};
  updateReleaseDwell(w, key, rule, h, s);                       // set/clear releaseBelowSince via POST /rule-state
  const a = planRule(rule, h, s);                               // none | top_up{amountBaseUnit} | release{amountBaseUnit}
  if (a.kind === 'none') continue;
  if (secondsSince(s.lastMoveAt) < effectiveCooldownSec(rule)) continue;
  if (sum24h(key) + amount(a) > BigInt(rule.dailyCapBaseUnit)) { await report(w, 'rebalance', 'daily cap reached', 'failed'); continue; }
  if (hasInFlight(key)) continue;
  return a.kind === 'top_up' ? topUp(w, rule, a, cfg) : release(w, rule, a);  // one move per tick
}
```

Pick the most urgent rule first: highest utilization over its trigger.

### 4.1 Top-up: Lighter account

1. **Fund.** `planFunding(amount, funding, cfg.rebalance, cfg.collateral.bstockHaircut)` gives sources such as `[bsc_usdc 90, sell SPYB 410]`. If `shortfallUsd > 0`, top up what you can, and report the shortfall.
2. **Pull stables.** `USDC.transferFrom(user, agentBsc, amount18dp)`, and the same on USDT when the plan includes `bsc_usdt`. It reverts if over the allowance, so check `allowance` on each token first (the user grants USDC and USDT separately on the Risk management page). Swap pulled USDT to USDC before the bridge: PancakeSwap V3 `exactInputSingle` USDT → USDC on the 0.01% pool (fee `100`, the same stable hop `lib/swap-path.ts` uses), with `amountOutMinimum` at 0.5% slippage.
3. **Sell bStocks** (only if the plan says so). `bStock.transferFrom(user, agentBsc, raw)` with raw = ui × 1e18 ÷ uiMultiplier. Quote all four fee tiers with `quoteExactInput(path)` (path bStock → USDT [→ USDC] from `buildPath('sell', …)`). Then `SmartRouter.multicall(deadline=now+300, [exactInput({path, recipient: agentBsc, amountIn: raw, amountOutMinimum: minOut(quote, 50)})])`, after approving the exact amount to the SmartRouter. Copy from `components/spot/SwapTicket.tsx`.
4. **Bridge into Lighter.** `POST https://api.relay.link/quote/v2` with `{user: agentBsc, recipient: "<user's Lighter MASTER account index>", originChainId: 56, destinationChainId: 3586256, originCurrency: BSC USDC, destinationCurrency: "0", amount, tradeType: "EXACT_INPUT", slippageTolerance: "50"}`. **Validate exactly as `app/api/relay/quote/route.ts` does** (router `0x4cd00e38…bc31`, approve spender + amount, decode `depositErc20(depositor=agentBsc, token, amount)`, `details.recipient`). Send the approve, then the deposit. Poll `GET /intents/status/v3?requestId=` until `success` (or `refund`).
5. **Sub-account rule.** After the master is credited, `SignTransfer(subIdx, 3, 0, 0, amount1e6, fee, 0x00…, 0, nonce, 4, master)` → `sendTx` (instant, same owner, no L1 signature).
6. **Report.** Event `{kind: 'rebalance', venue: 'lighter', status: 'done', payload: {direction: 'in', amountUsd, ruleKey, relayRequestId}}` + rule state `{lastMoveAt, lastOutcome: 'topped-up', lastOutcomeMsg, topUpDoneAt?}` (`topUpDoneAt` only when `rule.topUpOnce`).

### 4.2 Top-up: Derive subaccount

Steps 1–3 as above, then:

4. **Bridge to Ethereum.** Relay quote `56 → 1`, USDC → Ethereum USDC `0xA0b8…eB48`, **recipient = agentEth** (the agent pays the Ethereum gas). Validate and poll.
5. **Deposit for the user.** On Ethereum: `USDC.approve(ActionManager 0xE366…FAD3, amount6dp)` then `ActionManager.depositToNewSubaccount(asset=0x57B0…f02b, amount6dp, managerId, owner=<USER wallet>)`. managerId = the rule subaccount's manager (SM: PRIME 1, MIDCAP 2, ALT 3, RWA 4). **Below $5 the deposit is lost:** the minimum move for Derive is $7.
6. **Wait for the credit** (~1.5–2 min). Poll `public/get_onchain_action_history {wallet: user}` for your tx hash with status `applied`, then read `private/get_account` to find the new subaccount id.
7. **Consolidate.** `private/transfer_spot` from the new subaccount into the rule's subaccount (TRANSFER module action, `to_subaccount_id = rule.accountRef`, amount in human USDC). Copy `transferSpot` from `lib/server/derive.ts`.
8. **Report** as 4.1 with `venue: 'derive'`.

### 4.3 Release

**Copy the app's tested code:** `withdrawLighter` and `lighterWithdrawals` in `lib/server/lighter.ts`, `withdrawDerive` and `deriveWithdrawals` in `lib/server/derive.ts`, `encodeWithdrawData` in `lib/derive-codec.ts`. The Derive signing is checked against Derive's own `public/withdraw_debug` (`LIVE=1 npx vitest run tests/withdraw.test.ts`).

- **Lighter:** `SignWithdraw(3, 0, amount1e6, 0, nonce, 4, master)` → `sendTx` (tx type 13). The signed payload has no destination field, so it can only pay the account's L1 owner, on **Ethereum**, after ~26 min. Withdraw from the master only; for a sub-account rule, first `SignTransfer` sub → master. Minimum 1 USDC, at most `available_balance`. Status from `GET withdraw/history`: `pending` → `claimable` (ready on Ethereum; Lighter normally completes the claim) → `completed`.
- **Derive:** `private/withdraw {subaccount_id, asset_name: "USDC", amount_in_underlying: "<human decimal>", recipient: <owner>, max_fee_usd: "3", force_batch: false, nonce, signer, signature, signature_expiry_sec}`. Signed data = `(USDC asset, maxFee×1e18, owner, amount×1e6, false)` with the WITHDRAW module. Pays the user's Ethereum address (~14 min, fee about $1). At most the USDC held and the subaccount's free margin (`initial_margin`). Status from `private/get_withdrawal_history`: `batch_status` `Settled` = done, `…Error` = failed.
- Bringing it from Ethereum back to BNB needs the **user** (their wallet holds it). Report `"released $X to your Ethereum wallet"`. That's the decided behaviour for now.
- Rule state: `lastMoveAt`, `releaseDoneAt` if `releaseOnce`, clear `releaseBelowSince`.

---

## 5. Every money move is a resumable state machine

A crash in the middle of a move must never lose money or double-fund. Persist before every external step:

```
PLANNED ─▶ PULLED (transferFrom tx) ─▶ SOLD? (swap tx) ─▶ BRIDGING (relay requestId) ─▶ CREDITED
       ─▶ [Derive] DEPOSITED (eth tx) ─▶ CONSOLIDATED (op_uuid) ─▶ DONE
any step ─▶ FAILED (reason) ;  ambiguous (timeout/5xx) ─▶ UNKNOWN → look it up, never blindly retry
```

- Row: `id, wallet, ruleKey, direction, amountBaseUnit, state, txHashes{}, relayRequestId, deriveOpUuid, idempotencyKey, updatedAt`.
- `resumeInFlightMoves` runs at the start of every tick. It picks each non-terminal row up from its last state, checking on-chain or venue state first (tx receipt, Relay status, Derive history).
- Use the row's `idempotencyKey` for every event you post (`${rowId}-${state}`), so retries never duplicate the activity feed.

---

## 6. Hedge

```ts
const positions = {};  // hedgeKey → signed perp size, or long put contracts
//   lighter:<marketId>     sum of sign×position over the user's Lighter accounts
//   derive-perp:<CCY>      sum of signed <CCY>-PERP amounts over Derive subaccounts
//   derive-put:<CCY>       sum of LONG put contracts on <CCY> (parseDeriveOption(...).type === 'P', amount > 0)
const plans = planHedge(cfg.hedge, held /* {qty, price} per bStock */, positions, prices);
for (const p of plans.filter(p => p.act)) await executeHedge(w, leg(p), p);
```

| Leg | Execute `deltaUnits` (positive = more hedge) |
|---|---|
| Lighter perp | Same-symbol perp (NVDAB → NVDA) or index proxy (SPYB → US500 market 180, QQQB → US100 market 181). Market IOC on `marketId` from the **master** account: `deltaUnits > 0` → sell (short more); `< 0` → buy, reduce-only. Scale with `size_decimals`/`price_decimals`; worst price 2% through mark. Copy `placeLighterOrder` |
| Derive perp | `private/order` on `<CCY>-PERP`, routed to the subaccount whose universe lists it (`subaccountForUniverse`; NVDA/US500/US100 = RWA). Market = limit 2% through the touch, `time_in_force: ioc`, expiry ≥ now+2400 s. Copy `placeDeriveOrder` |
| Derive puts | **Choose the put:** from `public/get_all_live_instruments`, keep `<CCY>-YYYYMMDD-K-P` with days-to-expiry ≥ `put.minDaysToExpiry`; pick the expiry closest to `put.targetDaysToExpiry`, then the strike closest to index × `put.strikePct` ÷ 100. **Buy** `deltaUnits` contracts (limit at ask + 2%, IOC). **Roll:** any held put with days-to-expiry < `minDaysToExpiry` → sell it (reduce-only) and buy the replacement in the same tick |

- The bStock and its hedge often differ in price units (SPYB $725 vs US500 7,263). `planHedge` sizes by **notional**, so use `targetUnits` and `deltaUnits` as given. Example: 0.1 SPYB ($72.5) → 0.1 × 725 ÷ 7,263 = **0.01 US500**, not 0.1. Never map bStock units 1:1 onto an index perp.
- **Round to the market's step, then skip anything under the venue minimum** (report it, don't send it). Mainnet, 2026-11-24: Lighter NVDA/US500/US100 need ≥ $10 notional (and 0.025 / 0.0007 / 0.0002 base); Derive NVDA-PERP and US500-PERP ≥ 0.1; Derive NVDA puts ≥ 1 contract. Read them live: Lighter `orderBookDetails` `min_base_amount`/`min_quote_amount`, Derive `public/get_instrument` `minimum_amount`/`amount_step`.
- **The decision must be deterministic.** The trade to place (or skip) comes from `planRule` / `planFunding` / `planHedge` plus the hard checks in §7. A language model may write the user-facing message, but it must not veto or resize a move: two runs on the same inputs must produce the same action.
- **Before hedging on Derive, check margin:** `public/order_quote` (or `private/get_margin` with simulated changes) must say the order is valid. If not, top up first (§4.2) or report and skip.
- Report each hedge trade: event `{kind: 'hedge', venue, status, message: 'Shorted 1.63 NVDA-PERP on Derive', payload: {key, deltaUnits}}`.

---

## 7. Safety (non-negotiable)

- **Money is integers in base units, as strings.** BSC USDC/USDT 18 dp, Ethereum/Lighter USDC 6 dp, Derive signs ×1e18 and withdraw amounts are human decimals.
- **Destinations only from config + verified ownership.** Lighter accounts must appear under the user's L1 address; Derive subaccounts under `private/get_account`; Relay recipient = that account index or the agent's own Ethereum wallet (for the Derive leg).
- **Caps:** on-chain allowance (hard), `maxPerMoveBaseUnit`, `dailyCapBaseUnit`, `minMoveBaseUnit`, cooldown, `keepBscReserveBaseUnit`, run-once markers.
- **Timeouts on every call** (10–30 s). A 5xx or timeout is UNKNOWN, not failed (§5).
- **Kill switch:** the user's **Automation on/off** (`config.rebalance.enabled`) and **Hedge on/off** are re-read every tick. Revoking the allowance stops BNB pulls at the chain level.
- **Never log keys or the agent token.** The agent wallet keys live only in the agent's secret store.

---

## 8. Build order and how to test each step (mainnet, small amounts)

| # | Build | Done when | How to test |
|---|---|---|---|
| 1 | Read-only tick (§2–3) + `planRule`/`planHedge` | For every rule card, the agent logs the same "Needs top-up $X" / "in band" the Risk page shows | Point it at your wallet; compare with the page side by side |
| 2 | Reporting | Events show in Risk management → Agent activity; rule cards show `lastOutcomeMsg` | POST an `info` event and a rule-state per tick |
| 3 | Lighter top-up from BNB USDC (§4.1, steps 1, 2, 4, 6) | A rule with its trigger just below current utilization gets topped up once; cooldown blocks a second | $10 USDC on BNB, allowance $10, rule trigger = current utilization − 1% |
| 4 | Resumable moves (§5) | Killing the agent mid-bridge, then restarting, finishes the move without double funding | Kill it right after the Relay deposit tx |
| 5 | Hedge: Lighter perp, then Derive perp (§6) | NVDAB 1 held → NVDA short of ~1 appears; changing the ratio re-hedges | Buy 1 NVDAB on Spot; add hedge legs on the Risk page |
| 6 | Derive top-up (§4.2) | New subaccount is credited and consolidated into the rule's subaccount | $10, RWA subaccount enabled |
| 7 | Sell bStocks to fund (§4.1 step 3) | With $0 USDC, a top-up sells bStocks in `sellOrder` | Allowance on NVDAB, USDC at 0 |
| 8 | Derive protective puts + roll (§6) | Puts at the chosen strike/expiry appear; a put under the roll threshold is replaced | `minDaysToExpiry` higher than the held put's days |
| 9 | Release (§4.3) | Surplus withdraws to the user's Ethereum after the dwell time | Release level above current utilization, 1-minute dwell |

The app's own checks: `node tests/e2e-api.mjs` (agent API), `npx vitest run` (planning math). The Risk page's **Scenario forecast** shows where triggers and liquidations sit, which is useful for picking test levels.

---

## 9. Pointers

- API contract: `docs/AGENT.md` (wallets, credentials, config, events, rule-state)
- Venue endpoints: Endpoints → Reference (mainnet): Derive, Lighter, Relay, BNB Chain & bStocks
- Working examples in the app: `lib/server/lighter.ts` (orders, transfers, sub-accounts, key registration), `lib/server/derive.ts` (orders, transfer_spot, universes), `app/api/relay/quote/route.ts` (Relay validation), `components/spot/SwapTicket.tsx` (PancakeSwap), `components/funding/useTxRunner.ts` + `app/funding/page.tsx` (Ethereum deposits)
- Gotchas: `docs/endpoints/lighter.md`, `derive.md`, `relay.md` (Lighter HTTP 400 + `code 21100` = no account; Derive withdraw amounts are human decimals; Derive below-minimum deposits are lost; Relay has no testnet for these chains)
