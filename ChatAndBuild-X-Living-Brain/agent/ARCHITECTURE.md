# Pulse Risk Margin Agent — how it works

A background service that keeps each user's Aster (perps) and Derive (options) margin safe using money they hold on BNB Chain, and keeps their bStocks hedged. It runs the rules the user set on the app's **Risk management** page. This document describes what is built in `agent/` today.

## 1. The idea in one paragraph

Every 30 seconds the agent reads each user's rules and live balances, **code** works out what (if anything) should happen, and a small **LangGraph** of LLM steps (via OpenRouter) reviews and chooses among the actions code already computed. Code then re-checks every safety limit and executes. The LLM never writes an amount or an address, so a wrong or manipulated LLM answer cannot move money outside the user's limits.

## 2. Principle: code owns money, LLM owns judgment

| Code (deterministic) | LLM (OpenRouter) |
|---|---|
| Every number and every amount (integer base units) | Does the situation make sense? |
| All caps, cooldowns, allowance, reserve, ownership checks | Which of the offered actions fits best? |
| Signing and sending transactions | Is there a reason to veto the pick? |
| Reading balances and account health | Writing the plain-language message for the user |

The LLM can only **narrow** the set of actions (pick one, veto it, or skip). It can never add one. If the LLM is down, slow, or returns something invalid, the agent skips the tick (fail closed).

## 3. Big picture

```
                         ┌──────────────────────── Pulse Risk app (Next.js + SQLite) ───────────────────────┐
  user (MetaMask) ──────▶│ login · agent keys · rules (Risk mgmt page) · allowance · Activity feed       │
                         └───────▲─────────────────────────────────────────────────▲─────────────────────┘
                                 │ Bearer AGENT_API_TOKEN                            │ events, rule-state
                                 │ wallets · config · credentials · rule-state       │
                         ┌───────┴─────────────────────────────────────────────────┴─────────────────────┐
                         │                          AGENT  (this folder)                                  │
                         │   scheduler ─▶ collect ─▶ LangGraph ─▶ executor ─▶ report                      │
                         └───┬───────────────┬───────────────┬───────────────┬───────────────┬───────────┘
                             ▼               ▼               ▼               ▼               ▼
                           Aster           Derive       BNB Chain         Relay        PancakeSwap
                       (account, orders,  (account,    (balances,      (bridge BSC→    (sell bStocks,
                        leverage, deposit)  transfers)   allowance,      Ethereum for    USDC to USDT)
                                                         transferFrom)
                                                  OpenRouter (LLM) ◀── graph nodes
```

## 4. The three jobs

1. **Top up margin.** An account crosses its trigger (utilization too high or value too low). Pull USDC from the user's BNB wallet, bridge it, deposit it.
2. **Release surplus.** Too much idle margin for the configured time. Withdraw the surplus.
3. **Hedge bStocks.** Keep a short on the matching Aster perp (NVDAB → NVDAUSDT). Re-hedge when drift passes the threshold. It only acts when bStocks are held or a stale short must be closed.

## 5. One tick, step by step

`src/index.ts` loops every `TICK_INTERVAL_SEC` (default 30). For each wallet from the app:

**Step 0 — collect (code, not an LLM).** `tools/collect.ts` builds a `Snapshot`: the user's rules, rule state, live health of every rule's account (Aster / Derive), Aster positions, BNB balances (USDC, USDT, bStocks with price), the on-chain allowance to the agent, and the agent's own 24 h move log. A failed read never throws; it adds a `dataQuality` flag.

Then the LangGraph (`src/graph/`) runs:

```
START → validate ─(data problem)────────────────────────────────┐
           │                                                     │
           ▼                                                     │
         plan ─(no candidates)─▶ END  (quiet, no LLM call)        │
           ▼                                                     │
        analyst ─(LLM down)────────────────────────────────────▶ report ─▶ END
           ▼                                                     ▲ ▲ ▲
        decider ─(skip / unknown id / LLM down)──────────────────┘ │ │
           ▼                                                       │ │
       reviewer ─(veto / LLM down)─────────────────────────────────┘ │
           ▼                                                         │
         guard ─(refused / already in flight)────────────────────────┘
           ▼
        execute ─────────────────────────────────────────────────────┘
```

| # | Node | Type | What it does | Output |
|---|---|---|---|---|
| 1 | `validate` | code | Any `dataQuality` flag means stop (fail closed) | `outcome=error` or continue |
| 2 | `plan` | code | Runs the app's own `planRule`, `planFunding`, `planHedge`, then applies cooldown, min/max move, 24 h cap, allowance, reserve, run-once, in-flight lock. Keeps each rule's release-dwell clock current | `candidates[]`, `rejected[]` |
| 3 | `analyst` | **LLM** | Checks the numbers are coherent and flags oddities | `{dataLooksSane, concerns, summary}` |
| 4 | `decider` | **LLM** | Picks ONE candidate id, or skips | `{action, candidateId, reason}` |
| 5 | `reviewer` | **LLM** | Independent check whose job is to find a reason to veto | `{verdict, reason}` |
| 6 | `guard` | code | Re-runs every check on the chosen action and takes the per-rule lock | pass / refuse |
| 7 | `execute` | code | Runs the steps (or simulates them in a dry run) | `steps[]`, outcome |
| 8 | `report` | code + **LLM** | Reporter LLM writes the user-facing message; posts the event and rule-state to the app | message |

Outcomes: `idle`, `error`, `skipped`, `vetoed`, `simulated` (dry run), `done`, `failed`.

## 6. Inputs and outputs

**Inputs**

| Source | Data |
|---|---|
| App API (`AGENT_API_TOKEN`) | wallets, config (rules, hedge legs, caps), venue credentials, rule-state |
| Aster REST (`/fapi/v3`, agent-signed) | account equity, available balance, positions, open orders, leverage brackets, market rules, mark price, funding |
| Derive REST | subaccount collateral and margin (read-only today) |
| BSC RPC | USDC/USDT/bStock balances, `uiMultiplier`, user→agent allowance |
| PancakeSwap quoter | bStock prices (best of the four fee tiers) |
| Relay | bridge quotes and delivery status |
| `.env` | secrets, model names, safety switches |

**Outputs**

| Where | What |
|---|---|
| On-chain / venues (live mode only) | `transferFrom` pull, Relay bridge txs, Aster order / leverage / deposit, Derive transfers |
| App `POST /events` | pending → done / failed, with direction and amount (feeds Activity and Recent moves) |
| App `POST /rule-state` | last move time, outcome text on the rule card, run-once markers, release-dwell start |
| Local SQLite (`data/agent.db`) | move log (24 h cap), in-flight locks, per-step idempotency keys |

## 7. Approvals: who allows what

There is **no per-move approval**. The user approves once, in the app, and the agent then acts alone inside hard limits.

| Approval | Where | Effect |
|---|---|---|
| Wallet login | app, MetaMask signature | identifies the user |
| Agent keys | Agents page | lets the agent trade on Aster (it can never withdraw) and trade/transfer on Derive |
| Rules + Automation on | Risk management page | when and how much, with caps |
| Allowance | on-chain `approve` to the agent's BSC address | the hard cap on BNB funds the agent can pull; revocable any time |

The agent's own switches: `DRY_RUN=true` by default (nothing is signed or sent). Live execution needs **both** `DRY_RUN=false` and `ALLOW_LIVE=yes-i-understand`.

## 8. Safety rules enforced in code

- Amounts are integer base-unit strings; never rounded into a tx amount. BSC stables are 18 dp, USDC on venues 6 dp (`baseToBsc`).
- Caps: on-chain allowance, `maxPerMove`, `dailyCap` (from the agent's own log), `minMove` (Aster $6, Derive $7), cooldown (at least 5 min), BNB reserve, run-once markers.
- Money only goes to the same user's accounts, and the destination always comes from the rule, never from an LLM.
- One move in flight per rule (lock with 30 min expiry).
- Idempotency: every live step is stored under its own key, so a crash and retry resumes instead of repeating a transfer.
- Relay quotes are validated (router, token, amount, depositor, recipient) before anything is signed.
- Timeouts on every call; a timeout is treated as ambiguous, not failed.
- Secrets never reach logs (`log.ts` masks keys and tokens). The LLM never receives credentials.
- Fail closed: missing price, unreadable account, venue outage, or any LLM failure means do nothing this tick.

## 9. LLM layer (OpenRouter)

- One OpenAI-compatible client (`@langchain/openai`) pointed at `OPENROUTER_BASE_URL`. Structured output via function calling, validated with Zod (`src/llm/schemas.ts`).
- **Every model, fallback list, temperature, timeout and retry count is in `.env`**, per node: `LLM_MODEL_ANALYST`, `LLM_MODEL_DECIDER`, `LLM_MODEL_REVIEWER`, `LLM_MODEL_REPORTER`, plus `LLM_FALLBACK_MODELS` (OpenRouter native fallback).
- Defaults: a Claude Sonnet-class model for analyst / decider / reviewer, a Haiku-class model for the reporter. Verify slugs at openrouter.ai/models and change them in `.env`; no code change needed.
- `LLM_MODE=off` skips all LLM calls: the top-urgency candidate is picked by code. Use it for debugging and as a break-glass mode.
- **System prompts** live in `prompts/` and are the single source of truth: `common.md` (shared rules, prepended to all) plus `analyst.md`, `decider.md`, `reviewer.md`, `reporter.md`. Print exactly what is sent with `npm run prompts`.

## 10. Tools (code modules)

| Module | Methods | Status |
|---|---|---|
| `tools/appApi.ts` | `listWallets`, `getConfig`, `getAsterCreds`, `getDeriveCreds`, `getRuleStates`, `postEvent`, `postRuleState` | built, tested against types only |
| `tools/collect.ts` | `collectSnapshot` | built, tested via injected deps |
| `tools/aster.ts` | `getAccount`, `healthOf`, `positionsOf`, `openOrders`, `markets`, `market`, `markPrice`, `marketStats`, `maxLeverage`, `setLeverage`, `placeMarketOrder`, `cancelOrder` | reads verified live; orders verified on mainnet with small size |
| `tools/asterDeposit.ts` | `fundAster`, `describeAsterFunding` | BNB wallet to Aster margin, all on BNB Chain (USDC to USDT swap, then deposit) |
| `tools/derive.ts` | `authHeaders`, `getSubaccount`, `healthOf` | reads built; **writes (`depositToSubaccount`, `transferSpot`, `withdrawToOwner`) NOT wired**, they throw |
| `tools/bsc.ts` | `getFunds`, `pullUsdc`, `baseToBsc` / `bscToBase` | reads built; `pullUsdc` never run live |
| `tools/relay.ts` | `validateQuote`, `executeSteps`, `getStatus`, `getStatusDetail` | built, never run live (mainnet only) |
| `tools/pancake.ts` | `quoteSell`, `priceOf`, `sell` | built, never run live; the guard currently refuses bStock-funded top-ups |
| `tools/planner.ts` | `buildCandidates` (wraps the app's `planRule`, `planFunding`, `planHedge`) | built, unit-tested |
| `tools/guard.ts` | `checkCandidate`, `filterCandidates`, `lockKey` | built, unit-tested |
| `tools/store.ts` | `logMove`, `moved24h`, `acquireLock`, `getStep`, `saveStep` | built |
| `tools/executor.ts` | `execute`, `describeSteps` | dry run built and tested; live paths for Aster top-up / hedge and Derive top-up / release |

## 11. Configuration (`agent/.env`, never committed)

| Group | Keys |
|---|---|
| App link | `APP_API_URL`, `AGENT_API_TOKEN` (same value as the app's `.env.local`) |
| Loop | `AGENT_NETWORK` (testnet / mainnet), `TICK_INTERVAL_SEC` |
| Safety | `DRY_RUN` (default true), `ALLOW_LIVE`, `POST_EVENTS` |
| LLM | `LLM_MODE`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `LLM_MODEL_*`, `LLM_FALLBACK_MODELS`, `LLM_TEMPERATURE`, `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES` |
| Chain | `AGENT_BSC_PRIVATE_KEY`, `BSC_RPC_URL`, `ETH_RPC_URL`, `RELAY_API_KEY` |
| Local | `AGENT_DB_PATH`, `LOG_LEVEL` |

`.env.example` documents every key. The real `.env` is git-ignored.

## 12. Run it

```
cd agent
npm run demo        # whole graph on a made-up wallet, no network (set LLM_MODE=off for no LLM)
npm run prompts     # print the system prompt of every LLM node
npm test            # 22 tests: planner, guard, graph paths, fake-LLM paths, fail-closed cases, rule fitting, volatility
npm run demo:propose -- 0xYourWallet   # push a made-up risk proposal into the UI (approve it there)
npm run propose     # one real risk-analyst pass for every wallet, then exit
npm run typecheck
npm run once        # one real tick against the running app, then exit
npm start           # the 30 s loop
```

## 13. Risk analyst and human approval (rules from the market, not a fixed 70%)

The fixed 70 / 45 / 25 numbers are only defaults. A separate **risk analyst** pass (every `PROPOSE_INTERVAL_SEC`, default 5 min, per wallet) fits a rule to the user's actual book and submits it as a **proposal**. Nothing is armed until the user clicks Approve in the app.

```
 Aster account + positions ──┐
 realised 1h volatility ──────┤   code: fitRule()           LLM: risk_analyst           app UI
 top-up latency (measured) ───┼─▶ trigger / restore /  ───▶ writes structural_risk ───▶ Proposal card
 leverage, BNB stables, ──────┘   release / primary source   + reasoning (no numbers)    [Approve & arm] [Reject]
 bStocks after haircut                                                                       │
                                                                                             ▼
                                              rule saved, funding order set, Automation on ─▶ the harness (sections 5-8) enforces it
```

- **Numbers come from code** (`src/proposal/compute.ts`). Trigger `u = 1 / (1/maxUtil + k·σ·√τ·L)`: leave enough room to survive a k-sigma move (volatility stressed) during the time a top-up takes (detection cycle + measured transfer latency) on a book with leverage `L`. Higher volatility, slower transfers or more leverage lower the trigger. Restore and release levels follow (restore = trigger − 17 pts, release = restore − 20 pts, with floors). All knobs are `PROPOSE_*` in `.env`.
- **Primary source** is chosen by capacity: BNB stables if they can cover the estimated top-up, else bStocks after haircut, else it says no source has capacity. An empty BNB wallet is flagged in the text.
- **The LLM only explains** (`prompts/risk_analyst.md`): a plain-language structural risk and the reasoning, citing the metrics. It cannot change the numbers.
- **Fail closed:** volatility or funds unreadable means no proposal. If the existing rule already matches (within 1 point) nothing is proposed. The same numbers are never proposed twice (idempotency key), so a rejected proposal does not nag.
- **App changes** (small, in `pulse-risk-bnb`): table `agent_proposals`; `POST /api/agent/v1/proposals` (agent token); `GET /api/agent/proposals` and `POST /api/agent/proposals/[id]` (signed-in user only, own wallet only); `components/risk/ProposalCard.tsx` on the Risk management page; shared schema and `applyProposal` in `lib/agent-proposal.ts`. Approving writes the rule (existing caps and cooldown are kept), sets the funding order, turns Automation on and logs "You approved the AI proposal…" in the Activity feed. Rejecting changes nothing.
- **Limit:** the executor currently refuses bStock-funded top-ups (see section 14), so a proposal with `bstocks_bnb` as primary source can be approved but will not execute until selling bStocks is wired.

## 14. What is not done yet

- **Derive money moves** (deposit, `transfer_spot`, withdraw): not wired. Derive top-ups and releases fail closed with a clear step message.
- **bStock-funded top-ups** (selling on PancakeSwap): the tool exists but the guard refuses these until the bStock allowance is read; USDT sources likewise.
- **Release returning to BNB:** a release lands on the user's Ethereum address; bridging back needs the user or an Ethereum allowance (open decision).
- **Live paths** for Aster top-up and hedge, Derive top-up and release, plus `pullUsdc` and Relay execution, are written but have never run against a real venue. They need the agent BSC wallet, RPC URLs, a test user with keys, a rule and an allowance, and (for BNB → Aster) about $10 of real USDC on mainnet, since there is no testnet for these paths.
- **Venue-position hedging** (hedge an Aster or Derive position rather than held bStocks) is not in scope; it needs exposure netting.
- **Monitoring and hosting** of the service is undecided.
- Verify the OpenRouter model slugs before the first LLM run.

## 15. Hedging, limits, modes, bStock sales (from the BNB Hedging Agent spec)

**Graph:** `validate -> read_news -> plan -> analyst -> decider -> reviewer -> confirm -> guard -> execute -> report`. A second graph (`graph/proposal.ts`) proposes margin rules for human approval (section 13).

**Hedge size is solved, not set.** `risk/model.ts` computes the 99% loss per ticker (z99 x daily volatility from Aster hourly candles, or the event gap inside an event window), the portfolio 99% loss with an assumed correlation, and the smallest hedge that keeps it inside the user's loss tolerance (`h >= 1 - L / VaR99`). `risk/plan.ts` turns that into trades: exposure and coverage per ticker (direct perp, proxy, none), cost, perp leverage capped so a p99 gap stays under about 30% of margin, the margin move from BNB with its transfer time, and a proposal card with the 99% loss before and after, validity, assumptions, invalidation conditions and the worst case on the hedge. Trades are trimmed to the user's per-trade and per-day notional limits, and to the margin that can arrive before an event (a bridge slower than the event gives a partial hedge from the margin already on Aster). Every number is computed by code. The LLM nodes only choose, veto and explain.

**News is advisory only.** `read_news` fetches free RSS headlines, a model scores them, and a strong score becomes a flag in the activity feed and status. A flag is context for the LLM nodes and never a reason to size, place or veto anything. The plan is identical with and without news (tested).

**Policy engine** (`policy.ts`, enforced inside the guard before any LLM sees a candidate): kill switch, max notional per trade and per day, max leverage, market allowlist and do-not-hedge list, premium budget (over budget asks the user), daily loss cap (stops autonomy and allows only risk-reducing actions), max capital off BNB, autonomy expiry, and an anomaly stop (too many intents or refusals in a window pauses the agent). Margin only goes to the user's own accounts from config. Only the user changes limits; the agent has no write path to them.

**Modes.** `confirm` (default): the agent posts what, why, what it helps, the plan and the steps; the user approves in the app; the agent re-plans from fresh data, re-checks the guard, executes and acknowledges (`executed`, `failed`, `expired`). `autonomous`: opt-in, lapses at its expiry or at the daily loss cap, falls back to asking when a limit needs a human. The kill switch halts all new orders and transfers; existing hedges stay open.

**Margin comes from USDC, then USDT, then selling bStocks** (`tools/executor.ts` `fundAster`). USDT is pulled and swapped to USDC on PancakeSwap V3. For each bStock sale the agent pulls the bStock from the user (`transferFrom`, needs an allowance to the agent address), sells it for USDC on PancakeSwap V3 along bStock -> USDT -> USDC (`pancake.sellBstockForUsdc`, min-out from a fresh QuoterV2 quote, 1% slippage, actual USDC from the balance difference), then bridges everything in one Relay transfer. A sale is final, so there is no rollback: a failed step stops the move and is reported, and each step is resumable by its idempotency key. `collateral.bstockHaircut` is the haircut applied to a bStock's value when counting what a sale yields.

**Status** (`status.ts`) is posted every tick, even with the kill switch on: mode, limits used today, coverage, VaR against the limit, next event, last news scan, flags, what is and is not monitored, alerts.

**Not built yet:** Derive protective puts and collars (the cost is shown for comparison but Derive orders are not wired), a live event calendar (events come from the user's config), the chat interface (skipped by decision), proxy hedging, cancel-all (the agent only places IOC market orders, so no resting orders exist).

