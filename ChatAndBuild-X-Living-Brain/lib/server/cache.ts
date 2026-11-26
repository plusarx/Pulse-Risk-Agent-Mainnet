import 'server-only';
const store = new Map<string, { v: unknown; exp: number }>();
/** Tiny TTL cache with in-flight dedupe, bounded to 500 entries. */
const inflight = new Map<string, Promise<unknown>>();
export function invalidate(key: string): void { store.delete(key); }

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.exp > Date.now()) return hit.v as T;
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn().then((v) => {
    store.set(key, { v, exp: Date.now() + ttlMs });
    if (store.size > 500) { const k = store.keys().next().value; if (k !== undefined) store.delete(k); }
    return v;
  }).finally(() => inflight.delete(key)); // rejected promises are not stored, so failures are retried
  inflight.set(key, p);
  return p;
}
