# Pulse Risk · Price Integrity

**CoinMarketCap and Atlas data as a safety layer for tokenized-stock collateral on BNB Chain**

## Problem

An agent that manages margin counts tokenized stocks (bStocks, BEP-20 tokens on BNB Chain) as collateral and sells them to
fund margin. A stale, degraded or thin-liquidity price leads to over-valued collateral, bad forced sales and missed hedges.

## Solution

For every bStock the app reads four independent prices, gives a verdict, prices the risk into the collateral haircut, and
stops the agent from acting on a price it cannot trust.

## How Atlas is used (core feature)

- Pull API (`POST /report/v1/price/latest`), one call per feed, for NVDAB, MSTRB, SPYB, QQQB and TSLAB.
- It reads the 18-decimal price, its age, and Atlas's own consensus score and status (healthy or degraded).
- A feed older than 180 s or with consensus under 0.70 blocks the token. A degraded feed adds 3 points to the haircut.

## How CoinMarketCap is used (core feature)

- **DEX data**, looked up by token contract address on BNB Chain, gives the price and pool liquidity. Address lookup stops
  look-alike tickers passing as the real token. A pool under $100k blocks the token, and liquidity tiers add 2 to 6 points
  to the haircut.
- **CoinMarketCap MCP** feeds the chat agent a stock's scheduled events for the next 7 days, a crypto market overview and
  a derivatives overview.

## Verdicts and risk pricing

| Verdict | Trigger | Effect |
|---|---|---|
| **OK** | Sources agree | Your own haircut |
| **WATCH** | Degraded feed, a gap of 1.5% or more, or a pool under $1M | Haircut raised, never lowered, capped at 90% |
| **BLOCK** | Stale feed, consensus under 0.70, a gap of 4% or more, or a pool under $100k | Agent holds off |
| **Unavailable** | Fewer than two sources readable | Behaves as before |

```
collateral value = quantity × price × (1 − haircut)
```

## Where it acts

Collateral value, the stress test, the funding plan, the agent's bStock sales for margin, new hedges (reduce-only closes
are never blocked), and the chat.

## Safety

The layer fails open on our own outage. One switch turns it off and restores the flat haircut. Every outbound call has a
timeout, and results are cached: 15 seconds overall and 60 seconds for DEX data.

## Verified

18 integrity tests and 6 CoinMarketCap-tool tests pass. On Nov 26, live mainnet readings matched the stock perps within
0.6%, and the chat answered from the live data, for example NVDAB on WATCH at 33%.

## Run it

Set `ATLAS_API_KEY` and `CMC_API_KEY`, run `npm run dev:all`, and open **Risk management**. More detail: [README](README.md).
