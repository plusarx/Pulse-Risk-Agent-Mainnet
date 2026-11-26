# PriceIntegrityGuard

On-chain twin of the app's price-integrity check for tokenized stocks (bStocks) on BNB Chain. The owner registers, per
token, an oracle feed (for example an Atlas push feed) and optionally a second "anchor" feed for the same stock.
`check(token)` returns a status: `OK`, `NOT_CONFIGURED`, `STALE`, `BAD_PRICE` or `DIVERGED`, plus the price scaled to
18 decimals and its age. Other contracts call `isTrusted(token)` or `requireTrusted(token)` before accepting a bStock
as collateral.

- Holds no funds and moves nothing. `check` never reverts: a broken, silent or nonsense feed yields a status.
- Admin: `setFeed`, `removeFeed`, two-step ownership. Point ownership at a multisig.
- Limits: max age 1 .. 86400 s, max deviation 1 .. 5000 bps.
- Feeds only need the Chainlink `latestRoundData` / `decimals` shape.

**Status: written and tested locally. NOT deployed, and no Atlas push-feed address for a BNB Chain bStock has been
verified yet** (push feeds are whitelist-gated; the pull API is what the app uses today). Deploying needs those
addresses and a deployer key.

```sh
forge install foundry-rs/forge-std   # once
forge test                           # 14 tests incl. a fuzz test that check() never reverts
forge test --fuzz-runs 5000
```
