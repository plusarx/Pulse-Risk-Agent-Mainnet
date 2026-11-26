# BNB Chain, bStocks & mainnet index

Generated 2026-11-23 by `scripts/gen-endpoint-docs.mjs` (token list from `lib/bstocks.ts`, verified on-chain against the issuer beacon). **Mainnet only.**

## Mainnet index — every base URL and contract the app uses

| Venue / chain | What | Value |
| --- | --- | --- |
| BNB Chain (56) | RPC | `https://bsc-rpc.publicnode.com`, `https://bsc-dataseed1.defibit.io`, `https://bsc-dataseed.bnb.org` |
| BNB Chain (56) | USDC / USDT (18 dp) | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` / `0x55d398326f99059fF775485246999027B3197955` |
| BNB Chain (56) | PancakeSwap V3 SmartRouter / QuoterV2 | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` / `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997` |
| BNB Chain (56) | bStock issuer beacon (identity check) | `0x156D6dce9a4f6139a3406F1f021F1A4880De93a3` |
| Ethereum (1) | USDC (6 dp) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Lighter | REST / WS / signing chain | `https://mainnet.zklighter.elliot.ai` / `wss://mainnet.zklighter.elliot.ai/stream` / 304 |
| Lighter | Deposit contract (Ethereum) | ZkLighter `0x3B4D794a66304F130a4Db8F2551B0070dfCf5ca7` |
| Derive | REST / WS / EIP-712 chain | `https://api.derive.xyz/v3` / `wss://api.derive.xyz/v3/ws` / 1 |
| Derive | Deposit (Ethereum) | ActionManager `0xE366CcA474968e33b777E13905829A3b800CFAD3` · protocol USDC asset `0x57B03E14d409ADC7fAb6CFc44b5886CAD2D5f02b` |
| Derive | Withdrawal outbox (Ethereum) | `0x7c743D79C9C595cE332314503d84cBBb4E85FA63` |
| Relay | API / router | `https://api.relay.link` / depository `0x4cd00e387622c35bddb9b4c962c136462338bc31`; Lighter chain id `3586256` |
| Binance (market data) | REST | `https://api.binance.com/api/v3` |

## bStock token reads (BEP-20 + BEP-677)

| Call | Returns | Note |
| --- | --- | --- |
| `balanceOf(address)` | raw balance (18 dp) | Does NOT change on a split. Never show it as the position |
| `uiMultiplier()` | uint256, 1e18 = 1.0× | Position = raw × uiMultiplier ÷ 1e18 |
| `newUIMultiplier()`, `effectiveAt()` | pending multiplier and when it applies | Corporate actions |
| `decimals()` | 18 | Identity check together with the beacon |
| event `UIMultiplierUpdated(old,new,effectiveAtTimestamp)` |  | Watch for splits |
| event `TransferWithUIAmount(from,to,amount,uiAmount)` |  |  |

## Trading bStocks on-chain (PancakeSwap V3)

| Call | Contract | Detail |
| --- | --- | --- |
| `quoteExactInput(bytes path, uint256 amountIn)` | QuoterV2 | Quote **every** fee tier (100, 500, 2500, 10000): the deepest tier differs per token. Path for USDC: USDC -100-> USDT -fee-> bStock |
| `quoteExactInputSingle((tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96))` | QuoterV2 | Single hop against USDT |
| `exactInput((path, recipient, amountIn, amountOutMinimum))` | SmartRouter | No deadline field: wrap in `multicall(uint256 deadline, bytes[] data)` |
| `exactInputSingle((tokenIn, tokenOut, fee, recipient, amountIn, amountOutMinimum, sqrtPriceLimitX96))` | SmartRouter |  |
| `approve(SmartRouter, amount)` | token | Approve the exact amount |

## bStock market data (Binance spot, public, no key)

Symbol = bStock + `USDT`, e.g. `NVDABUSDT`. Reference prices only; fills happen on PancakeSwap.

| Endpoint | Returns |
| --- | --- |
| `GET /api/v3/ticker/24hr?symbols=["NVDABUSDT",…]` | last, change %, high/low, volume (batch) |
| `GET /api/v3/ticker/price?symbol=` | last price |
| `GET /api/v3/depth?symbol=&limit=` | order book bids/asks |
| `GET /api/v3/trades?symbol=&limit=` | recent trades |
| `GET /api/v3/klines?symbol=&interval=1m|5m|15m|1h|4h|1d|1w&limit=` | candles |
| `GET /api/v3/exchangeInfo?symbol=` | tick size, lot size, status |
| WS `wss://stream.binance.com:9443/ws/<symbol>@ticker` / `@depth` / `@kline_1m` | live streams |

## All verified bStocks on BNB Chain (26)

Tradeable in the app when pool liquidity ≥ $100k. Lighter has an equity perp with the same underlying symbol for most (hedge leg).

| bStock | Underlying | Name | Contract | Pool liquidity (observed) |
| --- | --- | --- | --- | --- |
| SPCXB | SPCX | SpaceX | `0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1` | $7,017,030 |
| NVDAB | NVDA | NVIDIA | `0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436` | $1,979,241 |
| QQQB | QQQ | Invesco QQQ | `0x205812CdBed920aFf76C6580abD681a46D11efc7` | $1,569,204 |
| SKHYB | SKHY | SK Hynix | `0xCA750eF65f295BBECd685Abf54e82CAf297BDB61` | $1,013,488 |
| GMEB | GME | GameStop | `0x46cEeFDa28Dd7207059ed19B0acdc026955bb15C` | $610,154 |
| GOOGLB | GOOGL | Alphabet | `0x3F53De71c126BdaBAe20f9cD64848d317f6C3238` | $484,853 |
| TSLAB | TSLA | Tesla | `0x5b1910eAaD6450E50f816082Aa078C41F10C292f` | $463,830 |
| SPYB | SPY | S&P 500 ETF | `0x7138b48df7D98D7e3cc221BfE7192D0a178182D8` | $446,856 |
| AAPLB | AAPL | Apple | `0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A` | $321,172 |
| BABAB | BABA | Alibaba | `0x4eF9d3062c7F6ebA4AAE4990c5036598C6eff4ec` | $282,197 |
| SNDKB | SNDK | Sandisk | `0x3eE4dF61bd4F867E349BEaE8bFE07bc31b4850fb` | $142,694 |
| INTCB | INTC | Intel | `0xe614E2fc6C787035FF51f452e8E826Bfd32D5283` | $140,945 |
| MSTRB | MSTR | Strategy | `0xE87afb3076AeB0f9B14E368DE8145ae6a2826A14` | $104,601 |
| HOODB | HOOD | Robinhood | `0xA394dCEa3fd3847fD793afBFd163E2e3858B7c65` | $70,789 |
| NFLXB | NFLX | Netflix | `0xD6829Ea836b6FA224d099D40E54B31262f874631` | $56,583 |
| MUB | MU | Micron | `0xcdf2f3e0fa43C47A6662a91C9E4a7C5f69762699` | $52,107 |
| CRCLB | CRCL | Circle | `0x80f3D493EBCe97e343c53D29a137942416B4ffC0` | $50,239 |
| AMZNB | AMZN | Amazon | `0x1a4b499833A79A09ad7Cf1D42D7DacF71e92eb00` | $49,527 |
| TSMB | TSM | TSMC | `0xAB78b89B5bb00236Be0B4B20704cBfa04EfC711c` | $47,756 |
| NOKB | NOK | Nokia | `0x7c4d7a180D737Dd5A70d8065a90E6746a69C37EA` | $47,376 |
| METAB | META | Meta | `0x7425889FE94F9d693E8daefE88BCCed6AcFEf4c0` | $45,552 |
| DRAMB | DRAM | DRAM Index | `0x93862d63fd9Fd488B1328E9b47717d75e994a84B` | $21,851 |
| SOXLB | SOXL | Semis 3x Bull | `0xd97d097a89113fa59b76c572E5b2Eb647E8eefaf` | $7,013 |
| ORCLB | ORCL | Oracle | `0x4684D9887fC1c71cBa7baB8E88835CEC217eB598` | $2,591 |
| RKLBB | RKLB | Rocket Lab | `0xC8Da12cbCCE7c45180692a6420b0076e03a5179a` | $222 |
| AMDB | AMD | AMD | `0x75Fd4cF6f8392E41E70391D60c90C0D5211603a1` | $204 |
