# Demo script (about 3 minutes)

Pulse Risk keeps your tokenized stocks (bStocks) working as collateral, and now checks that the price it holds them at
can be trusted before it acts. Built for the CoinMarketCap x Atlas challenge.

## Before you start (2 minutes)
- Wallet connected on BNB Chain with a few bStocks; Risk page open; Perps agent key active (Agent keys page shows Active).
- Price integrity switch **ON** (Risk page). Keep the switch visible: it is the fallback.
- If anything on the live data looks wrong on stage, flip the switch OFF. The app then behaves exactly as before
  (flat 30% haircut, no price checks), and nothing else changes.

## The story
1. **The problem (20 s).** "My bStocks back my perps hedge. If the price feed is stale, wrong or the pool is empty, the
   agent could sell or hedge against a price that is not real." Show Portfolio: bStocks collateral card.
2. **Four views of one price (45 s).** Risk page, Price integrity table. Point at one row: Atlas oracle price and its
   consensus score, CoinMarketCap DEX price and pool depth, the stock's own perp price, and the biggest gap between them.
   "Four independent sources, anchored to the real stock's perp."
3. **A verdict, not a number (30 s).** Show an OK row (30%, "Sources agree") and a WATCH row (for example Atlas marks the
   feed degraded: haircut 33%, never below the user's own). Explain BLOCK: stale feed, a >4% gap or a pool under $100k stops
   hedges and top-ups on that token, with the reason in plain words.
4. **It acts on it (30 s).** Collateral page: haircut raised on the WATCH token. Ask Pulse: "Can I trust the price of
   NVDAB?" It answers from the live data. If a CMC key is set: "Is there an event before I hedge NVDA?" reads CoinMarketCap's
   stock calendar.
5. **Safe by design (20 s).** The agent key can trade perps but never withdraw. The layer fails open: if fewer than two
   sources answer, nothing is blocked because of our own outage. One switch turns it off.
6. **On-chain (15 s, only if deployed).** PriceIntegrityGuard reads the same checks on BNB Chain so other contracts can
   refuse a bad bStock price. Today it is written and tested, not deployed: say so.

## Answers to likely questions
- *Why not trust Atlas alone?* Atlas marks some stock feeds degraded; the check is a second opinion, not a replacement.
- *What if CMC or Atlas is down?* That source is skipped; with fewer than two sources the token reads "unavailable" and
  behaves as before.
- *Does the haircut ever go below the user's setting?* No. It only adds.
- *Which feeds are live?* Atlas pull feeds for NVDAB, MSTRB, SPYB, QQQB, TSLAB. Other tokens use CMC, the perp and the
  app's own price.

## Not claimed
- The guard contract is not deployed; no Atlas push-feed address is verified.
- CMC MCP data (event calendar) needs a CMC key; it is untested against the live server until one is set.
