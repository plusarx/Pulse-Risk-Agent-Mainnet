// Atlas Oracle feed ids for bStock tokens on BNB Chain.
// CONFIRMED = given by the project owner from atlasoracle.io/feeds and price-checked against the stock's perp on
// 2026-11-26 (gap under 0.3%). Other bStocks have feeds too, but several feeds share a price, so they stay out until
// someone confirms the name on the Atlas site.

export const ATLAS_FEEDS: Readonly<Record<string, number>> = {
  NVDAB: 1005,
  MSTRB: 939,
  SPYB: 956,
  QQQB: 1010,
  TSLAB: 1206,
};

/** Price-matched but NOT name-confirmed. Shown in docs only; never used for decisions. */
export const ATLAS_FEED_CANDIDATES: Readonly<Record<string, number>> = {
  SPCXB: 1009, SKHYB: 958, GMEB: 999, GOOGLB: 952, AAPLB: 912, BABAB: 1073, INTCB: 940,
};

export const atlasFeedFor = (symbol: string): number | null => ATLAS_FEEDS[symbol] ?? null;
