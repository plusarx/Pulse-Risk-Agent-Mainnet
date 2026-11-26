import { z } from 'zod';
import type { Snapshot } from '../types';

// The values the chat may change when it runs the hedging agent on a "what if". A whitelist: the model fills this in, code validates and
// applies it to a COPY of the live snapshot. Nothing here is ever written back to the user's settings or sent to a venue.
const num = (min: number, max: number) => z.number().finite().min(min).max(max);
const tk = z.string().regex(/^[A-Z]{1,8}$/);
export const Overrides = z.object({
  lossLimitPct: num(0.1, 50).optional(),
  weeklyBudgetUsd: num(0, 10_000_000).optional(),
  maxPerTradeUsd: num(0, 10_000_000).optional(),
  maxLeverage: num(1, 10).optional(),
  mode: z.enum(['confirm', 'autonomous']).optional(),
  clearEvents: z.boolean().optional(),
  events: z.array(z.object({ ticker: tk, hoursAhead: num(0.01, 720), gapPct: num(0.1, 80).optional() })).max(8).optional(),
  bnbUsdc: num(0, 1e9).optional(),
  deriveFreeUsd: num(0, 1e9).optional(),
  perpFreeUsd: num(0, 1e9).optional(),
  holdingValueUsd: z.record(tk, num(0, 1e9)).optional(),
});
export type Overrides = z.infer<typeof Overrides>;

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** Apply to a deep copy. Returns the copy and a plain-language list of what was changed, for the answer to cite. */
export function applyOverrides(base: Snapshot, ov: Overrides): { snapshot: Snapshot; applied: string[] } {
  const s = structuredClone(base); const applied: string[] = [];
  const cfg = s.config;
  if (ov.lossLimitPct !== undefined) { cfg.risk.lossTolerancePct = ov.lossLimitPct; applied.push(`loss limit ${ov.lossLimitPct}%`); }
  if (ov.weeklyBudgetUsd !== undefined) {
    const total = s.bsc.bstocks.reduce((a, b) => a + b.value, 0) || 1; cfg.risk.premiumBudgetWeeklyPct = Math.min(10, (ov.weeklyBudgetUsd / total) * 100); applied.push(`weekly budget $${ov.weeklyBudgetUsd}`);
  }
  if (ov.maxPerTradeUsd !== undefined) { cfg.limits.maxNotionalPerTradeUsd = ov.maxPerTradeUsd; applied.push(`max per trade $${ov.maxPerTradeUsd}`); }
  if (ov.maxLeverage !== undefined) { cfg.limits.maxLeverage = ov.maxLeverage; applied.push(`max leverage ${ov.maxLeverage}x`); }
  if (ov.mode) { cfg.mode = ov.mode; if (ov.mode === 'autonomous') cfg.limits.autonomyExpiresAt = hours(24); applied.push(ov.mode === 'confirm' ? 'mode: ask me first' : 'mode: autonomous'); }
  if (ov.clearEvents) { cfg.events = []; applied.push('existing events cleared'); }
  for (const e of ov.events ?? []) {
    cfg.events = [...cfg.events.filter((x) => x.ticker !== e.ticker), { ticker: e.ticker, at: hours(e.hoursAhead), kind: 'earnings' as const, ...(e.gapPct !== undefined ? { gapPct: e.gapPct } : {}) }];
    applied.push(`${e.ticker} event in ${e.hoursAhead}h${e.gapPct !== undefined ? ` with a ${e.gapPct}% gap` : ''}`);
  }
  if (ov.bnbUsdc !== undefined) { s.bsc = { ...s.bsc, usdcUsd: ov.bnbUsdc }; applied.push(`BNB USDC $${ov.bnbUsdc}`); }
  if (ov.deriveFreeUsd !== undefined) { s.deriveFree = { ref: s.deriveFree?.ref ?? '0', freeUsd: ov.deriveFreeUsd }; applied.push(`Derive free $${ov.deriveFreeUsd}`); }
  if (ov.perpFreeUsd !== undefined) { s.perpMain = { equityUsd: Math.max(s.perpMain?.equityUsd ?? 0, ov.perpFreeUsd), freeUsd: ov.perpFreeUsd }; applied.push(`perps free $${ov.perpFreeUsd}`); }
  for (const [t, v] of Object.entries(ov.holdingValueUsd ?? {})) {
    const b = s.bsc.bstocks.find((x) => x.symbol === `${t}B`);
    if (b) { b.value = v; applied.push(`${t} holding value $${v}`); }
  }
  return { snapshot: s, applied };
}
