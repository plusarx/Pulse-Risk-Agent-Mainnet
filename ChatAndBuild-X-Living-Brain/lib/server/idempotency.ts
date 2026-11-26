import 'server-only';
// In-process idempotency for order/cancel submits: a retried request with the same key returns the
// first result instead of placing a second order. Bounded and TTL'd (single-instance hackathon backend).
const seen = new Map<string, { at: number; p: Promise<unknown> }>();
const TTL = 10 * 60_000;

export function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [k, v] of seen) { if (now - v.at > TTL) seen.delete(k); else break; }
  const hit = seen.get(key);
  if (hit) return hit.p as Promise<T>;
  const p = fn();
  seen.set(key, { at: now, p });
  if (seen.size > 5_000) { const first = seen.keys().next().value; if (first !== undefined) seen.delete(first); }
  p.catch(() => seen.delete(key)); // a failed attempt may be retried
  return p;
}
