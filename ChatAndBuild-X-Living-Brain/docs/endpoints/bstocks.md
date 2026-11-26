# bStocks on BNB Chain — reference

bStocks are Binance's tokenized US equities and ETFs (issuer: BTech Holdings, ADGM). They are BEP-20 tokens on **BSC mainnet (56)**, with tickers ending in `B` (NVDAB, TSLAB, QQQB…). There is no testnet.

## Token universe
- 26 genuine on-chain tokens, verified 2026-08-20. Identity is checked through the shared EIP-1967 **beacon `0x156D6dce9a4f6139a3406F1f021F1A4880De93a3`** + `decimals()==18` + `uiMultiplier()` present.
- **A matching symbol does not prove identity.** 22 impostors share tickers (e.g. fake MSFTB `0x8f43…7777`). Use only `lib/bstocks.ts`.
- Tradeable on-chain = pool liquidity ≥ $100k (the UI marks the rest "thin" and blocks the ticket).

## BEP-677 scaled UI amount
`balanceOf` is **raw**. Position = `raw × uiMultiplier() / 1e18`. A stock split changes the multiplier, not balances. Transfer and swap amounts stay raw; scale only for display and NAV.

## Execution (PancakeSwap V3)
| Contract | Address |
|---|---|
| SmartRouter | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` (`exactInput`, `exactInputSingle` without a deadline, `multicall(uint256 deadline, bytes[])`) |
| QuoterV2 | `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997` (`quoteExactInput(path, amountIn)`) |
| USDT (quote asset) | `0x55d398326f99059fF775485246999027B3197955` (18 dp) |
| USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` (18 dp), routed through the USDC/USDT 0.01% pool |

- Fee tiers are `100, 500, 2500, 10000`. **The best tier is per token** (QQQB is deepest at 100; NVDAB at 2500), and pool balance ≠ best execution. Always quote every tier.
- This app: `GET /api/bstocks/quote?symbol=&side=buy|sell&pay=USDC|USDT&amountIn=<wei>` returns the best tier. The UI re-quotes just before signing, applies slippage (default 0.5%), approves the exact amount, and wraps the swap in `multicall(deadline=now+300)`.

## Market data
Binance spot (public, CORS-free via `GET /api/bstocks/market?kind=tickers|depth|trades|klines&symbol=`): `NVDABUSDT` etc. This is the reference price, book and candles. Fills happen on-chain at the quoted price.

## Hedge mapping
Every bStock underlying except a few has a Lighter equity perp with the same symbol (NVDA, TSLA, SPCX, QQQ, SPY, AAPL, GOOGL, AMZN, META, MSTR, HOOD, MU, CRCL, TSM, INTC, SNDK, GME, BABA, SKHY, DRAM, SOXL, ORCL, RKLB, AMD; verified 2026-11-23). Derive also lists NVDA, US500 and US100 options in its RWA universe.
