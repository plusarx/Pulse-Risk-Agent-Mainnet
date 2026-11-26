// Auto margin rebalancing — rule model, ported from the original terminal-web-app lib/margin-rebalance.ts
// (main branch). Pure: no React, no fetch. Money is integer USDC base units (6 dp) as strings, percentages
// are integer basis points; floats appear only in display helpers.
//
// Differences from the original terminal: the funding source is the user's BNB-chain wallet (not a hub "exchange
// wallet"), and the accounts are the Aster perps account plus every Derive subaccount (one per risk
// universe). Rules are executed by the external agent; this file is also its reference semantics.

/** Venues a margin rule can watch. Lighter is dormant (kept in code), Aster is the perps venue. */
export const RULE_VENUES = ['aster', 'derive'] as const;
export type RuleVenue = (typeof RULE_VENUES)[number];
export const VENUE_LABEL: Record<RuleVenue, string> = { aster: 'Aster', derive: 'Derive' };

export type RuleMode = 'utilization' | 'account_value';
export type RuleUnits = 'percent' | 'usdc';
export const unitsOf = (m: RuleMode): RuleUnits => (m === 'utilization' ? 'percent' : 'usdc');

export interface RiskRule {
  venue: RuleVenue;
  /** '' = the perps (Aster) account; for Derive the subaccount id (one per risk universe). */
  accountRef: string;
  accountLabel?: string | null;
  mode: RuleMode;
  // Top-up: utilization rises ABOVE trigger → bring back to target; or account value falls BELOW trigger → up to target.
  triggerBps: number | null;
  targetBps: number | null;
  triggerBaseUnit: string | null;
  targetBaseUnit: string | null;
  topUpOnce: boolean;
  // Release surplus: utilization BELOW (or account value ABOVE) the level for releaseForSec → down to release target.
  releaseOn: boolean;
  releaseLevelBps: number | null;
  releaseLevelBaseUnit: string | null;
  releaseForSec: number | null;
  /** null = the top-up target. */
  releaseTargetBps: number | null;
  releaseTargetBaseUnit: string | null;
  releaseOnce: boolean;
  // Limits
  maxPerMoveBaseUnit: string;
  dailyCapBaseUnit: string;
  minMoveBaseUnit: string;
  cooldownSec: number;
  enabled: boolean;
}

/** Agent-written runtime state, kept apart from the rule so a user save never clobbers it. */
export interface RuleState {
  topUpDoneAt?: string | null;
  releaseDoneAt?: string | null;
  releaseBelowSince?: string | null;
  lastMoveAt?: string | null;
  lastOutcome?: string | null;
  lastOutcomeMsg?: string | null;
  lastOutcomeAt?: string | null;
}

export const ruleKey = (r: { venue: string; accountRef: string }) => `${r.venue}:${r.accountRef}`;

/** Venue deposit floors: a top-up below this can't land (Aster: app floor $5 → use $6 for headroom; Derive $5 → $7). */
export const MIN_DEPOSIT_BASE_UNIT: Record<RuleVenue, string> = { aster: '6000000', derive: '7000000' };
/** Venue credit time; the effective cooldown is never shorter (a second top-up before the first lands double-funds). */
export const MIN_COOLDOWN_SEC: Record<RuleVenue, number> = { aster: 300, derive: 300 };
export const RELEASE_ARRIVAL: Record<RuleVenue, string> = {
  aster: 'Aster withdraws straight to your BNB Chain wallet (you sign it in MetaMask)',
  derive: 'Derive withdraws to your Ethereum address (~14 min), then Relay bridges it to BNB',
};

export function defaultRule(venue: RuleVenue, accountRef = '', accountLabel: string | null = null): RiskRule {
  return {
    venue, accountRef, accountLabel, mode: 'utilization',
    triggerBps: 7000, targetBps: 4500, triggerBaseUnit: null, targetBaseUnit: null, topUpOnce: false,
    releaseOn: false, releaseLevelBps: 2500, releaseLevelBaseUnit: null, releaseForSec: 1800, releaseTargetBps: null, releaseTargetBaseUnit: null, releaseOnce: false,
    maxPerMoveBaseUnit: '500000000', dailyCapBaseUnit: '2000000000', minMoveBaseUnit: MIN_DEPOSIT_BASE_UNIT[venue], cooldownSec: 600, enabled: true,
  };
}

// ── Unit conversion (string ↔ integer, no floats) ──────────────────────────
export function percentToBps(raw: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(raw.replace(/[%\s]/g, ''));
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bps > 0 && bps <= 10_000 ? bps : null;
}
export const bpsToPercent = (bps: number): string => (bps % 100 === 0 ? `${bps / 100}%` : `${(bps / 100).toFixed(2).replace(/0$/, '')}%`);
export const bpsText = (bps: number | null): string => (bps === null ? '' : bpsToPercent(bps).replace('%', ''));

export function usdToBaseUnits(raw: string): string | null {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(raw.replace(/[$,\s]/g, ''));
  if (!m) return null;
  const v = BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'));
  return v > 0n ? v.toString() : null;
}
export function baseUnitsToText(base: string | null): string {
  if (!base) return '';
  const v = BigInt(base); const whole = v / 1_000_000n; const frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}
export function formatUsd(base: string | null | undefined): string {
  const v = BigInt(base ?? '0'); const neg = v < 0n; const a = neg ? -v : v;
  const cents = (a % 1_000_000n) / 10_000n;
  return `${neg ? '-' : ''}$${(a / 1_000_000n).toLocaleString('en-US')}${cents === 0n ? '' : `.${cents.toString().padStart(2, '0')}`}`;
}
const usdOf = (b: string | null) => (b === null ? null : Number(BigInt(b)) / 1e6);
export const minutes = (sec: number) => (sec % 60 === 0 ? `${sec / 60} min` : `${sec}s`);

/** Why a rule can't be saved, or null. Mirrors the original terminal ruleProblem(), mode-aware. */
export function ruleProblem(r: RiskRule): string | null {
  if (r.mode === 'utilization') {
    if (r.triggerBps === null || r.targetBps === null) return 'Set both the top-up level and the target level.';
    if (r.targetBps >= r.triggerBps) return 'The target must be below the top-up trigger.';
    if (r.releaseOn) {
      if (r.releaseLevelBps === null || r.releaseForSec === null) return 'Set both the release level and how long it must hold.';
      const rt = r.releaseTargetBps ?? r.targetBps;
      if (rt >= r.triggerBps) return 'Release target must be below the top-up trigger.';
      if (r.releaseLevelBps >= rt) return r.releaseTargetBps !== null ? 'Release level must be below the release target.' : 'Release level must be below the target.';
    }
  } else {
    if (!r.triggerBaseUnit || !r.targetBaseUnit) return 'Set both the trigger and the target amount.';
    const trig = BigInt(r.triggerBaseUnit); const tgt = BigInt(r.targetBaseUnit);
    if (trig >= tgt) return 'The top-up level must be below the target account value.';
    if (r.releaseOn) {
      if (!r.releaseLevelBaseUnit || r.releaseForSec === null) return 'Set both the release level and how long it must hold.';
      const rt = r.releaseTargetBaseUnit ? BigInt(r.releaseTargetBaseUnit) : tgt;
      if (r.releaseTargetBaseUnit && rt <= trig) return 'Release target must be above the top-up level.';
      if (BigInt(r.releaseLevelBaseUnit) <= rt) return r.releaseTargetBaseUnit ? 'Release level must be above the release target.' : 'Release level must be above the target account value.';
    }
  }
  if (r.releaseOn && r.releaseForSec !== null && r.releaseForSec < 60) return 'Release must hold for at least 1 minute.';
  if (BigInt(r.minMoveBaseUnit) < BigInt(MIN_DEPOSIT_BASE_UNIT[r.venue])) return `${VENUE_LABEL[r.venue]} needs a minimum move of at least ${formatUsd(MIN_DEPOSIT_BASE_UNIT[r.venue])}.`;
  if (BigInt(r.minMoveBaseUnit) > BigInt(r.maxPerMoveBaseUnit)) return 'Minimum move cannot exceed the per-move cap.';
  if (BigInt(r.maxPerMoveBaseUnit) > BigInt(r.dailyCapBaseUnit)) return 'Per-move cap cannot exceed the daily cap.';
  if (r.cooldownSec < 60) return 'Cooldown must be at least 1 minute.';
  return null;
}

export const effectiveCooldownSec = (r: Pick<RiskRule, 'venue' | 'cooldownSec'>) => Math.max(r.cooldownSec, MIN_COOLDOWN_SEC[r.venue]);

export function ruleTitle(r: { venue: RuleVenue; accountRef: string; accountLabel?: string | null }): string {
  if (!r.accountRef) return VENUE_LABEL[r.venue];
  return `${VENUE_LABEL[r.venue]} · ${r.accountLabel ?? `#${r.accountRef}`}`;
}

/** One-sentence summary in the rule's own units (the editor footer). */
export function describeRule(r: RiskRule): string {
  const once = (on: boolean) => (on ? ' Once only.' : '');
  const acct = ruleTitle(r);
  if (r.mode === 'utilization') {
    const top = `When ${acct} margin utilization rises above ${bpsToPercent(r.triggerBps ?? 0)} → top up to ${bpsToPercent(r.targetBps ?? 0)} from your BNB wallet.${once(r.topUpOnce)}`;
    if (!r.releaseOn || r.releaseLevelBps === null) return top;
    return `${top} Below ${bpsToPercent(r.releaseLevelBps)} for ${minutes(r.releaseForSec ?? 0)} → send the surplus back to BNB, down to ${bpsToPercent(r.releaseTargetBps ?? r.targetBps ?? 0)}.${once(r.releaseOnce)}`;
  }
  const top = `When the ${acct} account value falls below ${formatUsd(r.triggerBaseUnit)} → top it up to ${formatUsd(r.targetBaseUnit)} from your BNB wallet.${once(r.topUpOnce)}`;
  if (!r.releaseOn || !r.releaseLevelBaseUnit) return top;
  return `${top} Above ${formatUsd(r.releaseLevelBaseUnit)} for ${minutes(r.releaseForSec ?? 0)} → send the surplus back to BNB, down to ${formatUsd(r.releaseTargetBaseUnit ?? r.targetBaseUnit)}.${once(r.releaseOnce)}`;
}

/** Two short lines for a card. */
export function ruleLines(r: RiskRule, s?: RuleState): { topUp: string; release: string | null } {
  const runs = (once: boolean, done?: string | null) => (!once ? '' : done ? ' · done' : ' · once');
  const holds = r.releaseForSec !== null ? ` for ${minutes(r.releaseForSec)}` : '';
  if (r.mode === 'utilization') {
    return {
      topUp: `Above ${bpsToPercent(r.triggerBps ?? 0)} → back to ${bpsToPercent(r.targetBps ?? 0)}${runs(r.topUpOnce, s?.topUpDoneAt)}`,
      release: r.releaseOn && r.releaseLevelBps !== null ? `Below ${bpsToPercent(r.releaseLevelBps)}${holds} → ${bpsToPercent(r.releaseTargetBps ?? r.targetBps ?? 0)}${runs(r.releaseOnce, s?.releaseDoneAt)}` : null,
    };
  }
  return {
    topUp: `Below ${formatUsd(r.triggerBaseUnit)} → back to ${formatUsd(r.targetBaseUnit)}${runs(r.topUpOnce, s?.topUpDoneAt)}`,
    release: r.releaseOn && r.releaseLevelBaseUnit ? `Above ${formatUsd(r.releaseLevelBaseUnit)}${holds} → ${formatUsd(r.releaseTargetBaseUnit ?? r.targetBaseUnit)}${runs(r.releaseOnce, s?.releaseDoneAt)}` : null,
  };
}

// ── Live account health + meter ────────────────────────────────────────────
export interface AccountHealth {
  connected: boolean;
  /** Margin used ÷ account value, bps. */
  utilBps: number | null;
  accountUsd: number | null;
  /** Margin in use, USD (for "how much to add" math). */
  usedUsd: number | null;
}

export interface MeterMarker { at: number; kind: 'release' | 'target' | 'trigger'; label: string }
export interface Meter {
  display: string; caption: string; value: number | null; max: number;
  topUpZone: [number, number] | null; releaseZone: [number, number] | null; markers: MeterMarker[];
  state: 'unknown' | 'topup' | 'release' | 'ok';
}

const usdShort = (n: number) => (n >= 1_000_000 ? `$${+(n / 1e6).toFixed(1)}M` : n >= 10_000 ? `$${+(n / 1e3).toFixed(1)}k` : `$${Math.round(n).toLocaleString('en-US')}`);
function niceMax(...xs: (number | null)[]): number {
  const top = Math.max(1, ...xs.filter((x): x is number => x !== null && Number.isFinite(x))) * 1.25;
  const mag = 10 ** Math.floor(Math.log10(top));
  return Math.ceil(top / mag) * mag;
}

/** The zone bar for one account. Utilization is dangerous when HIGH (top-up zone on the right); account value when LOW. */
export function meterFor(rule: RiskRule | undefined, h: AccountHealth, units: RuleUnits): Meter {
  const mode: RuleMode = rule ? rule.mode : units === 'percent' ? 'utilization' : 'account_value';
  const rel = !!rule && rule.releaseOn;
  if (mode === 'utilization') {
    const trig = rule?.triggerBps ?? null; const tgt = rule?.targetBps ?? null;
    const lvl = rel ? rule!.releaseLevelBps : null;
    const rt = rel && rule!.releaseTargetBps !== null && rule!.releaseTargetBps !== tgt ? rule!.releaseTargetBps : null;
    const v = h.utilBps;
    return {
      display: v === null ? '—' : bpsToPercent(v), caption: 'margin used ÷ account value', value: v, max: 10_000,
      topUpZone: trig !== null ? [trig, 10_000] : null, releaseZone: lvl !== null ? [0, lvl] : null,
      markers: [
        ...(lvl !== null ? [{ at: lvl, kind: 'release' as const, label: bpsToPercent(lvl) }] : []),
        ...(rt !== null ? [{ at: rt, kind: 'target' as const, label: bpsToPercent(rt) }] : []),
        ...(tgt !== null ? [{ at: tgt, kind: 'target' as const, label: bpsToPercent(tgt) }] : []),
        ...(trig !== null ? [{ at: trig, kind: 'trigger' as const, label: bpsToPercent(trig) }] : []),
      ],
      state: v === null ? 'unknown' : trig !== null && v > trig ? 'topup' : lvl !== null && v < lvl ? 'release' : 'ok',
    };
  }
  const trig = usdOf(rule?.triggerBaseUnit ?? null); const tgt = usdOf(rule?.targetBaseUnit ?? null);
  const lvl = rel ? usdOf(rule!.releaseLevelBaseUnit) : null;
  const a = h.accountUsd;
  const max = niceMax(trig, tgt, lvl, a);
  return {
    display: a === null ? '—' : usdShort(a), caption: 'account value', value: a, max,
    topUpZone: trig !== null ? [0, trig] : null, releaseZone: lvl !== null ? [lvl, max] : null,
    markers: [
      ...(trig !== null ? [{ at: trig, kind: 'trigger' as const, label: usdShort(trig) }] : []),
      ...(tgt !== null ? [{ at: tgt, kind: 'target' as const, label: usdShort(tgt) }] : []),
      ...(lvl !== null ? [{ at: lvl, kind: 'release' as const, label: usdShort(lvl) }] : []),
    ],
    state: a === null ? 'unknown' : trig !== null && a < trig ? 'topup' : lvl !== null && a > lvl ? 'release' : 'ok',
  };
}

// ── What the agent should do now (pure; the UI preview and the agent share this) ──
export type RuleAction =
  | { kind: 'none'; reason: string }
  | { kind: 'top_up'; amountBaseUnit: string; reason: string }
  | { kind: 'release'; amountBaseUnit: string; reason: string };

const toBase = (usd: number) => BigInt(Math.max(0, Math.floor(usd * 1e6)));
const minBig = (...xs: bigint[]) => xs.reduce((a, b) => (b < a ? b : a));

/**
 * Size a move for a rule given live health. Top-up amounts are rounded UP to the minimum move
 * (a smaller deposit can't land) and capped by the per-move cap; releases are capped the same way.
 * Cooldown, daily cap, dwell timing and run-once are enforced by the agent with its RuleState.
 */
export function planRule(r: RiskRule, h: AccountHealth, s: RuleState = {}, now = new Date()): RuleAction {
  if (!r.enabled) return { kind: 'none', reason: 'paused' };
  if (!h.connected || h.accountUsd === null) return { kind: 'none', reason: 'account not readable' };
  const cap = BigInt(r.maxPerMoveBaseUnit); const min = BigInt(r.minMoveBaseUnit);
  let need: number | null = null; let excess: number | null = null; let why = '';
  if (r.mode === 'utilization') {
    if (h.utilBps === null || h.usedUsd === null) return { kind: 'none', reason: 'utilization unknown' };
    if (r.triggerBps !== null && r.targetBps !== null && h.utilBps > r.triggerBps) {
      need = h.usedUsd / (r.targetBps / 10_000) - h.accountUsd; // used / (E + x) = target
      why = `utilization ${bpsToPercent(h.utilBps)} > ${bpsToPercent(r.triggerBps)} → ${bpsToPercent(r.targetBps)}`;
    } else if (r.releaseOn && r.releaseLevelBps !== null && h.utilBps < r.releaseLevelBps) {
      const rt = r.releaseTargetBps ?? r.targetBps ?? 0;
      excess = rt > 0 ? h.accountUsd - h.usedUsd / (rt / 10_000) : 0;
      why = `utilization ${bpsToPercent(h.utilBps)} < ${bpsToPercent(r.releaseLevelBps)} → ${bpsToPercent(rt)}`;
    }
  } else {
    const trig = usdOf(r.triggerBaseUnit); const tgt = usdOf(r.targetBaseUnit); const lvl = usdOf(r.releaseLevelBaseUnit);
    if (trig !== null && tgt !== null && h.accountUsd < trig) { need = tgt - h.accountUsd; why = `account ${usdShort(h.accountUsd)} < ${usdShort(trig)} → ${usdShort(tgt)}`; }
    else if (r.releaseOn && lvl !== null && h.accountUsd > lvl) {
      const rt = usdOf(r.releaseTargetBaseUnit) ?? tgt ?? h.accountUsd;
      excess = h.accountUsd - rt; why = `account ${usdShort(h.accountUsd)} > ${usdShort(lvl)} → ${usdShort(rt)}`;
    }
  }
  if (need !== null && need > 0) {
    if (r.topUpOnce && s.topUpDoneAt) return { kind: 'none', reason: 'top-up ran once; re-arm to allow another' };
    const amt = minBig(cap, toBase(need) < min ? min : toBase(need));
    return { kind: 'top_up', amountBaseUnit: amt.toString(), reason: why };
  }
  if (excess !== null && excess > 0) {
    if (r.releaseOnce && s.releaseDoneAt) return { kind: 'none', reason: 'release ran once; re-arm to allow another' };
    const since = s.releaseBelowSince ? Date.parse(s.releaseBelowSince) : null;
    if (r.releaseForSec !== null && (since === null || now.getTime() - since < r.releaseForSec * 1000)) {
      return { kind: 'none', reason: `${why} · waiting ${minutes(r.releaseForSec)} before releasing` };
    }
    const amt = minBig(cap, toBase(excess));
    if (amt < min) return { kind: 'none', reason: `${why} · surplus below the minimum move` };
    return { kind: 'release', amountBaseUnit: amt.toString(), reason: why };
  }
  return { kind: 'none', reason: 'within the band' };
}

// ── Account health score (KPI strip) ───────────────────────────────────────
/**
 * 0–100, same spirit as the original terminal: starts at 100, loses points for margin utilization (linearly, up to
 * 70) and for the nearest liquidation (up to 30 when a position is within 30% of its liq price).
 */
export function healthScore(utilPct: number | null, liqDistPct: number | null): number {
  const u = utilPct === null ? 0 : Math.min(100, Math.max(0, utilPct)) * 0.7;
  const l = liqDistPct === null ? 0 : Math.max(0, 30 - liqDistPct);
  return Math.max(0, Math.round(100 - u - l));
}
