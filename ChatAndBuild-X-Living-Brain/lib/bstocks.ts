// bStock BEP-20 contracts on BNB Smart Chain (chain 56) — the on-chain settlement registry.
//
// These are the contracts the TradingModule swaps against on PancakeSwap V3. Identity is
// verified via the shared issuer beacon rather than by name or symbol, which are not unique.
//
// ── How these addresses were verified (do not add an entry without repeating this) ──
// Binance's Proof-of-Collateral page and BscScan's bStocks label list are both unusable
// programmatically (client-rendered / Cloudflare 403), and a SYMBOL MATCH IS NOT IDENTITY —
// an impostor `MSFTB` at 0x8f43f061… advertises $1.88M of "liquidity" on an unknown DEX at
// price $0.00. Identity is therefore established on-chain, which is stronger than any list:
//
//   1. The token is an EIP-1967 BEACON proxy whose beacon slot equals ISSUER_BEACON below.
//      All 9 verified bStocks share one beacon, so a matching beacon means the same issuer
//      (BTech Holdings Ltd, admitted to ADGM FSRA's Official List of Securities).
//   2. `decimals() == 18`.
//   3. `uiMultiplier()` is present — the BEP-677 / EIP-8056 scaled-UI interface.
//
// The impostor fails (1) and (3). Verified 2026-08-19 against BSC mainnet; see
// the internal bStocks G1-G4 gate findings.
//
// ⚠ BEP-677: `balanceOf` is RAW and does not change on a split or dividend reinvestment.
//    uiAmount = rawAmount * uiMultiplier() / 1e18. Keep raw BigInt wei as the tx amount and
//    scale only for display/NAV. All 9 read uiMultiplier() == 1e18 (1.0x) with effectiveAt 0
//    as of verification — do NOT hardcode that; read it.
//
// ⚠ SHARED-BEACON RISK: the beacon owner (0x4333DAf4481F281F3D3d2B8735cE80bc00028d0C) can
//    swap the implementation for EVERY token below in one transaction, including adding a
//    transfer allowlist that would brick pool positions. Transfers are permissionless today;
//    that is a statement about today only.

export const BSC_CHAIN_ID = 56;

/** Shared EIP-1967 beacon for all genuine bStocks — the identity discriminator. */
export const ISSUER_BEACON = '0x156D6dce9a4f6139a3406F1f021F1A4880De93a3' as const;

/** Beacon owner. Can upgrade logic for every bStock simultaneously. Monitor for upgrades. */
export const ISSUER_BEACON_OWNER = '0x4333DAf4481F281F3D3d2B8735cE80bc00028d0C' as const;

/** BSC USDT — the quote asset for every bStock pool (18 decimals, unlike Arbitrum USDC's 6). */
export const BSC_USDT = '0x55d398326f99059fF775485246999027B3197955' as const;
export const BSC_USDT_DECIMALS = 18;

/**
 * PancakeSwap V3 fee tiers. NOTE 2500, where Uniswap V3 uses 3000 — and `feeTier` is a
 * SIGNED field of SingleTradePermit, so an offered tier with no pool mints a permit that can
 * only revert. Never reuse the Uniswap tier menu on chain 56.
 */
export const PANCAKE_V3_FEE_TIERS = [100, 500, 2500, 10000] as const;

/**
 * ⚠ THE DEEPEST TIER IS PER-TOKEN. DO NOT HARDCODE ONE.
 *
 * Measured USDT-side depth per pool, 2026-08-20 (PancakeSwap V3):
 *
 *   SPCXB   fee=2500 → $1,642,902   fee=500 → $50,292   fee=10000 → $19,522   fee=100 → $28
 *   NVDAB   fee=2500 →   $943,264   fee=10000 → $272,062   fee=500 → $139     fee=100 → $4
 *   QQQB    fee=100  →   $729,477   fee=500 → $22,754   fee=2500 → $1         fee=10000 → $0
 *
 * QQQB's liquidity sits at the **100** tier and its 2500 pool holds **$1**. Signing a blanket
 * 2500 for QQQB would route a real order into a dust pool — the permit would not revert (the
 * pool exists), it would just execute at a catastrophic price. That is worse than a revert.
 *
 * ⚠ AND POOL BALANCE IS NOT THE SAME AS BEST EXECUTION. Quoting 1,000 USDT through
 * PancakeSwap's QuoterV2 (2026-08-20) contradicts the balance ranking above:
 *
 *   NVDAB  best fee 2500 → 4.547179 NVDAB  ($219.92)   [balance ranking agreed]
 *   QQQB   best fee  100 → 1.391532 QQQB   ($718.63)   [balance ranking agreed]
 *   SPCXB  best fee  500 → 7.156647 SPCXB  ($139.73)   [balance ranking said 2500 — WRONG]
 *
 * SPCXB's 2500 pool holds more USDT yet quotes worse, because V3 liquidity is concentrated:
 * what matters is depth *around the current price*, not the total balance. Only the quoter is
 * authoritative. Never rank tiers by `balanceOf` — always call the quoter.
 *
 * Correct behaviour: quote across ALL FOUR tiers at order-build time and sign the tier with the
 * best output. The tier must be chosen where the permit is BUILT (it is signed into the permit),
 * not in the keeper — the keeper can only honour what was signed.
 *
 * Only the three tickers above have been measured. Everything else must be quoted live.
 */
export const FEE_TIER_MUST_BE_QUOTED_PER_TOKEN = true as const;

export interface BStockToken {
  symbol: string;
  underlying: string;
  address: `0x${string}`;
  decimals: 18;
  /** Aggregate pool liquidity in USD observed at verification — staleness expected. */
  observedLiquidityUsd: number;
  /** Aggregate 24h volume in USD observed at verification. */
  observedVolume24hUsd: number;
  /** Human label for the underlying, e.g. "SpaceX". */
  displayName: string;
}

/**
 * Confirmed IMPOSTORS — same symbol, different (non-bStock) contract. Never resolve these.
 * `MSFTB` at this address advertises ~$1.88M "liquidity" on DEX `flapsh` at price $0.00 and
 * fails BOTH the beacon and the BEP-677 checks. A genuine MSFTB has no PancakeSwap pool.
 */
export const IMPOSTOR_ADDRESSES: ReadonlySet<string> = new Set([
  '0x8f43f0612f4c4e8af452b6304629ebbb80b17777', // fake MSFTB
]);

/**
 * THE COMPLETE on-chain bStock universe: 26 tokens, every one verified against the shared
 * issuer beacon (2026-08-20). Ordered by observed liquidity, deepest first.
 *
 * Why 26 and not 67 — measured, not chosen:
 *
 *   67  tickers listed on Binance (derived from public exchangeInfo — see app/api/bstocks/route.ts)
 *   48  have ANY pool on BSC
 *   26  are GENUINE bStocks (beacon + decimals 18 + uiMultiplier + symbol match)
 *   22  are IMPOSTORS with pools — same ticker, unrelated contract, no beacon
 *   19  have no BSC pool at all (CEX-only: AAOIB ASMLB AVGOB AXTIB COINB CRWVB EWYB FLNCB
 *       INTWB IRENB LITEB MRVLB MUUB MVLLB NBISB PLTRB QCOMB SMCIB SNXXB)
 *
 * The 22 impostors are exactly the tickers measured at **$0 liquidity on PancakeSwap V2** —
 * fakes minted against bStock symbols with empty pools. Listing them would let a manager sign
 * an order against a worthless token, so symbol-derived lists must never reach this file:
 * ALABB AMATB ARMB ASTSB BEB BMNRB CBRSB COHRB CRDOB DELLB GLWB GSB IBMB KORUB MSFTB PYPLB
 * QNTB SMHB SOXSB TQQQB USARB WDCB.
 *
 * All 26 here are safe to DISPLAY. Only those clearing `MIN_LIQUIDITY_USD` are safe to TRADE —
 * see `TRADEABLE`. The tail is real but unusable (AMDB $204, RKLBB $222), so the UI shows them
 * with their depth and blocks the ticket rather than hiding them.
 */
export const BSTOCKS_BSC: readonly BStockToken[] = [
  { symbol: 'SPCXB',   underlying: 'SPCX',    displayName: 'SpaceX',           address: '0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1', decimals: 18, observedLiquidityUsd: 7_017_030, observedVolume24hUsd: 18_266_351 },
  { symbol: 'NVDAB',   underlying: 'NVDA',    displayName: 'NVIDIA',           address: '0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436', decimals: 18, observedLiquidityUsd: 1_979_241, observedVolume24hUsd:  8_947_674 },
  { symbol: 'QQQB',    underlying: 'QQQ',     displayName: 'Invesco QQQ',      address: '0x205812CdBed920aFf76C6580abD681a46D11efc7', decimals: 18, observedLiquidityUsd: 1_569_204, observedVolume24hUsd: 47_194_336 },
  { symbol: 'SKHYB',   underlying: 'SKHY',    displayName: 'SK Hynix',         address: '0xCA750eF65f295BBECd685Abf54e82CAf297BDB61', decimals: 18, observedLiquidityUsd: 1_013_488, observedVolume24hUsd: 11_047_057 },
  { symbol: 'GMEB',    underlying: 'GME',     displayName: 'GameStop',         address: '0x46cEeFDa28Dd7207059ed19B0acdc026955bb15C', decimals: 18, observedLiquidityUsd:   610_154, observedVolume24hUsd:  1_870_115 },
  { symbol: 'GOOGLB',  underlying: 'GOOGL',   displayName: 'Alphabet',         address: '0x3F53De71c126BdaBAe20f9cD64848d317f6C3238', decimals: 18, observedLiquidityUsd:   484_853, observedVolume24hUsd:    469_824 },
  { symbol: 'TSLAB',   underlying: 'TSLA',    displayName: 'Tesla',            address: '0x5b1910eAaD6450E50f816082Aa078C41F10C292f', decimals: 18, observedLiquidityUsd:   463_830, observedVolume24hUsd:    567_383 },
  { symbol: 'SPYB',    underlying: 'SPY',     displayName: 'S&P 500 ETF',      address: '0x7138b48df7D98D7e3cc221BfE7192D0a178182D8', decimals: 18, observedLiquidityUsd:   446_856, observedVolume24hUsd:  3_911_290 },
  { symbol: 'AAPLB',   underlying: 'AAPL',    displayName: 'Apple',            address: '0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A', decimals: 18, observedLiquidityUsd:   321_172, observedVolume24hUsd:    377_873 },
  { symbol: 'BABAB',   underlying: 'BABA',    displayName: 'Alibaba',          address: '0x4eF9d3062c7F6ebA4AAE4990c5036598C6eff4ec', decimals: 18, observedLiquidityUsd:   282_197, observedVolume24hUsd:  1_415_670 },
  { symbol: 'SNDKB',   underlying: 'SNDK',    displayName: 'Sandisk',          address: '0x3eE4dF61bd4F867E349BEaE8bFE07bc31b4850fb', decimals: 18, observedLiquidityUsd:   142_694, observedVolume24hUsd:    221_033 },
  { symbol: 'INTCB',   underlying: 'INTC',    displayName: 'Intel',            address: '0xe614E2fc6C787035FF51f452e8E826Bfd32D5283', decimals: 18, observedLiquidityUsd:   140_945, observedVolume24hUsd:    115_174 },
  { symbol: 'MSTRB',   underlying: 'MSTR',    displayName: 'Strategy',         address: '0xE87afb3076AeB0f9B14E368DE8145ae6a2826A14', decimals: 18, observedLiquidityUsd:   104_601, observedVolume24hUsd:    119_194 },
  { symbol: 'HOODB',   underlying: 'HOOD',    displayName: 'Robinhood',        address: '0xA394dCEa3fd3847fD793afBFd163E2e3858B7c65', decimals: 18, observedLiquidityUsd:    70_789, observedVolume24hUsd:     63_463 },
  { symbol: 'NFLXB',   underlying: 'NFLX',    displayName: 'Netflix',          address: '0xD6829Ea836b6FA224d099D40E54B31262f874631', decimals: 18, observedLiquidityUsd:    56_583, observedVolume24hUsd:      5_835 },
  { symbol: 'MUB',     underlying: 'MU',      displayName: 'Micron',           address: '0xcdf2f3e0fa43C47A6662a91C9E4a7C5f69762699', decimals: 18, observedLiquidityUsd:    52_107, observedVolume24hUsd:     75_031 },
  { symbol: 'CRCLB',   underlying: 'CRCL',    displayName: 'Circle',           address: '0x80f3D493EBCe97e343c53D29a137942416B4ffC0', decimals: 18, observedLiquidityUsd:    50_239, observedVolume24hUsd:    134_013 },
  { symbol: 'AMZNB',   underlying: 'AMZN',    displayName: 'Amazon',           address: '0x1a4b499833A79A09ad7Cf1D42D7DacF71e92eb00', decimals: 18, observedLiquidityUsd:    49_527, observedVolume24hUsd:     19_138 },
  { symbol: 'TSMB',    underlying: 'TSM',     displayName: 'TSMC',             address: '0xAB78b89B5bb00236Be0B4B20704cBfa04EfC711c', decimals: 18, observedLiquidityUsd:    47_756, observedVolume24hUsd:      7_764 },
  { symbol: 'NOKB',    underlying: 'NOK',     displayName: 'Nokia',            address: '0x7c4d7a180D737Dd5A70d8065a90E6746a69C37EA', decimals: 18, observedLiquidityUsd:    47_376, observedVolume24hUsd:     24_675 },
  { symbol: 'METAB',   underlying: 'META',    displayName: 'Meta',             address: '0x7425889FE94F9d693E8daefE88BCCed6AcFEf4c0', decimals: 18, observedLiquidityUsd:    45_552, observedVolume24hUsd:      4_865 },
  { symbol: 'DRAMB',   underlying: 'DRAM',    displayName: 'DRAM Index',       address: '0x93862d63fd9Fd488B1328E9b47717d75e994a84B', decimals: 18, observedLiquidityUsd:    21_851, observedVolume24hUsd:          3 },
  { symbol: 'SOXLB',   underlying: 'SOXL',    displayName: 'Semis 3x Bull',    address: '0xd97d097a89113fa59b76c572E5b2Eb647E8eefaf', decimals: 18, observedLiquidityUsd:     7_013, observedVolume24hUsd:      3_607 },
  { symbol: 'ORCLB',   underlying: 'ORCL',    displayName: 'Oracle',           address: '0x4684D9887fC1c71cBa7baB8E88835CEC217eB598', decimals: 18, observedLiquidityUsd:     2_591, observedVolume24hUsd:      1_819 },
  { symbol: 'RKLBB',   underlying: 'RKLB',    displayName: 'Rocket Lab',       address: '0xC8Da12cbCCE7c45180692a6420b0076e03a5179a', decimals: 18, observedLiquidityUsd:       222, observedVolume24hUsd:     12_033 },
  { symbol: 'AMDB',    underlying: 'AMD',     displayName: 'AMD',              address: '0x75Fd4cF6f8392E41E70391D60c90C0D5211603a1', decimals: 18, observedLiquidityUsd:       204, observedVolume24hUsd:        116 },
] as const;

/** Minimum aggregate pool liquidity to offer a ticker on-chain. */
export const MIN_LIQUIDITY_USD = 100_000;

/** The set actually offered for on-chain trading — excludes the PLTRB control. */
export const TRADEABLE: readonly BStockToken[] =
  BSTOCKS_BSC.filter((t) => t.observedLiquidityUsd >= MIN_LIQUIDITY_USD);

const BY_SYMBOL = new Map(BSTOCKS_BSC.map((t) => [t.symbol.toUpperCase(), t]));
const BY_ADDRESS = new Map(BSTOCKS_BSC.map((t) => [t.address.toLowerCase(), t]));

export function bstockBySymbol(symbol: string): BStockToken | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase());
}
export function bstockByAddress(address: string): BStockToken | undefined {
  const key = address.toLowerCase();
  if (IMPOSTOR_ADDRESSES.has(key)) return undefined; // never resolve a known impostor
  return BY_ADDRESS.get(key);
}
/** True when the symbol is whitelisted for ON-CHAIN settlement (not merely a known bStock). */
export function isTradeableOnChain(symbol: string): boolean {
  const t = bstockBySymbol(symbol);
  return !!t && t.observedLiquidityUsd >= MIN_LIQUIDITY_USD;
}
