// Derive order expiry. signature_expiry_sec is also the order's expiry, and Derive refuses (error 14038) any action
// whose expiry is after the signing session key's own expiry. Venue window: 1920 s .. 90 days.

/** Derive's shortest allowed signature expiry, in seconds from now. */
export const DERIVE_MIN_EXPIRY_SEC = 1_920;
/** Stop this long before the key expires, so clock skew never pushes an order past it. */
const KEY_MARGIN_SEC = 300;

/**
 * Expiry for an order: market orders 40 minutes, resting orders 30 days, never later than the session key allows.
 * `keyExpiry` is the session key's expiry (seconds or ms; null = unknown, no cap). Throws a clear error when the key
 * expires too soon for any order.
 */
export function deriveOrderExpiry(immediate: boolean, keyExpiry: number | null | undefined, nowMs = Date.now()): number {
  const now = Math.floor(nowMs / 1000);
  const wanted = now + (immediate ? 2_400 : 30 * 86_400);
  if (!keyExpiry) return wanted;
  const keySec = keyExpiry > 1e12 ? Math.floor(keyExpiry / 1000) : Math.floor(keyExpiry);
  const cap = keySec - KEY_MARGIN_SEC;
  if (cap - now < DERIVE_MIN_EXPIRY_SEC) {
    throw new Error(`The Derive agent key expires ${new Date(keySec * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC, too soon to place an order. Register a new Derive key on the Agent keys page.`);
  }
  return Math.min(wanted, cap);
}
