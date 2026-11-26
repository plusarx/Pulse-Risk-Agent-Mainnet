# Relay bridge — BSC ↔ Lighter / Derive

Researched 2026-11-23 (live curls against `api.relay.link`, docs.relay.link, our code). VERIFIED unless marked.

> ⚠ Arbitrum USDC is `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (`e77c`). A one-character typo returns `INVALID_INPUT_CURRENCY`.

## 1. Support

- **BSC (56)**: USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` (18 dp), USDT `0x55d398326f99059fF775485246999027B3197955` (18 dp).
- **Ethereum** USDC `0xA0b8…eB48` (6 dp), **Arbitrum** USDC `0xaf88…5831` (6 dp).
- **Lighter is a Relay chain**: id `3586256`, currency `"0"` (USDC perp, 6 dp). **`recipient` = Lighter account index as a string**, not an address (address → `INVALID_ADDRESS`). Look it up with `GET /api/v1/accountsByL1Address`.
- **Derive (957) is NOT supported.** Route: BSC → Ethereum USDC → Derive L1 deposit.

Quotes for 100 USDC (`POST /quote`, `EXACT_INPUT`):

| Route | Out | Relayer fee | ETA |
|---|---|---|---|
| BSC USDC → ETH USDC | 99.857 | $0.143 | 4 s |
| BSC USDC → ARB USDC | 99.878 | $0.122 | 1 s |
| **BSC USDC → Lighter** | 99.86 | $0.140 | 1 s |
| ETH USDC → BSC USDC | 99.767 | $0.233 | 1 s |
| Lighter → BSC USDC | 99.678 | $0.322 (+1 USDC Lighter transfer fee) | 1 s |

- The fee **scales with the amount**: about 0.12% ($1.02 on $1,000). The fee is **not** flat; only tiny ETH gas top-ups are flat.
- Default slippage is 200 bps. This app sends `slippageTolerance: "50"`.

## 2. API

- `POST https://api.relay.link/quote/v2` (header `x-api-key` recommended; keyless works today, 50 req/min):
  `{user, recipient, originChainId, destinationChainId, originCurrency, destinationCurrency, amount (base units), tradeType:"EXACT_INPUT", slippageTolerance?, refundTo?}`
- Response `steps[]`:
  - `approve`: ERC-20 `approve(0x4cd00e387622c35bddb9b4c962c136462338bc31, amount)`
  - `deposit`: `to = 0x4cd00e38…bc31`, `depositErc20(address depositor, address token, uint256 amount, bytes32 id)` (selector `0xe8017952`)
  - also `fees.relayer.amountUsd`, `details.currencyOut.{amount,minimumAmount}`, `details.timeEstimate`
- **The destination is NOT in the calldata** (it lives in Relay's off-chain order); `depositor` = the user. Trust comes from the pinned router, the decoded amount and token, and `details.recipient`.
  - `app/api/relay/quote/route.ts` checks all of these before your wallet sees anything.
- Status: `GET /intents/status/v3?requestId=` → `waiting | depositing | pending | success | failure | refund`. Only `success` and `refund` are final.
- SDK (optional): `@relayprotocol/relay-sdk` 8.3.0. Its Lighter adapter signs Lighter-origin withdrawals.

## 3. Directions the agent uses

| Need | Route |
|---|---|
| Top up Lighter margin from BNB | BSC USDC → Relay → Lighter account index (2 BSC txs: approve + deposit). **Agent needs a BSC signer for this**; see AGENT.md. |
| Top up Derive margin from BNB | BSC USDC → Relay → Ethereum USDC, then `approve` + `depositToNewSubaccount` on Ethereum (needs ETH gas), then `transfer_spot` to consolidate |
| Release Lighter margin to BNB | Lighter → Relay: origin `3586256`, `user` = account index. The step is a **Lighter L2 Transfer** to Relay's depository account `731033` with `usdcFee 1000000`, signed with the Lighter API key **plus an L1 signature** (transfer to another owner). Alternative: secure withdraw to Ethereum (~26 min), then ETH → BSC via Relay. |
| Release Derive margin | `private/withdraw` → Ethereum (~14 min) → Relay ETH → BSC |

## 4. Testnets

`api.testnets.relay.link` only covers **Sepolia and Base Sepolia**. There are no BSC-testnet, Arbitrum-Sepolia, Lighter-testnet or Derive-testnet routes, so in testnet mode the app disables the Relay flows and deposits directly on Sepolia.

## 5. Our code

- `manager-service/src/noncustodial/hub/relay-quote.ts`: native gas bridge; rebuilds calldata instead of trusting it.
- `.wt/manager-service-rh/src/noncustodial/hub/relay-erc20.ts`: the best USDC template (pin router, decode, `maxFeeBps`, poll v3).
- Known bug (unfixed): `hub-policy.ts` `relayGasBridgeRule` pins `depositNative` arg 1 as the recipient, but it is the depositor.
