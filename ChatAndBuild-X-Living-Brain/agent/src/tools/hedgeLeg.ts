import { hedgeKey, type HedgeLeg } from '../../../lib/agent-config';

/** The leg key a hedge candidate trades. Perps legs are keyed by ticker (`aster:NVDA`); a candidate without a key is a perps one. */
export const legKeyOf = (h: { key?: string; market: string }): string => h.key ?? `aster:${h.market}`;
/** True when the hedge candidate matches a leg the user configured (the market allowlist). */
export const legInConfig = (legs: HedgeLeg[], h: { bstock: string; key?: string; market: string; proxyFor?: string }): boolean => legs.some((l) => (h.proxyFor ? true : l.bstock === h.bstock) && hedgeKey(l) === legKeyOf(h));
