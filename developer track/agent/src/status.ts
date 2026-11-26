import type { LastRun, StatusIn } from '../../lib/agent-status';
import type { NewsView } from './news';
import { effectiveMode } from './policy';
import { assessRisk } from './risk/plan';
import type { Snapshot } from './types';
import { readinessAlerts, type ReadinessEnv } from './readiness';
import { integrityAlerts } from './tools/integrity';

// The always-visible status the app shows (spec "Always-visible status"): mode, limits used today, coverage, the next
// event, the last news scan, what is monitored and what is not. Built from the snapshot alone, so it is posted
// every tick, even when the kill switch is on or the agent is paused.

const r2 = (x: number) => Math.round(x * 100) / 100;

export function buildStatus(s: Snapshot, extra: { news?: NewsView[]; newsAt?: string | null; run?: LastRun | null; readiness?: ReadinessEnv } = {}, now = new Date()): StatusIn {
  const cfg = s.config; const lim = cfg.limits; const t = s.today;
  const em = effectiveMode(s, now);
  const risk = assessRisk(s, now);
  const held = s.bsc.bstocks.filter((b) => b.qty > 0 && b.value > 0);
  const portfolioUsd = risk?.portfolioUsd ?? held.reduce((a, b) => a + b.value, 0);
  const flags = (extra.news ?? []).filter((n) => n.flagged);
  const alerts: string[] = [];
  if (lim.killSwitch) alerts.push('Kill switch is on: no new orders or transfers. Existing hedges stay open.');
  if (t?.pausedReason) alerts.push(`Agent paused itself: ${t.pausedReason}.`);
  if (em.note) alerts.push(em.note);
  for (const q of s.dataQuality) alerts.push(`Data problem: ${q}. New actions are on hold.`);
  for (const q of s.hedgeProblems ?? []) alerts.push(`Hedging on hold: ${q}.`);
  if (risk && !risk.solution.feasible) alerts.push(`Your ${risk.limitPct}% limit cannot be reached with the hedges available. Modelled loss after hedging: ${r2(risk.solution.varAfter * 100)}%.`);
  if (risk && risk.solution.varNow * 100 > risk.limitPct + 1e-9 && risk.hedgedPct < risk.solution.requiredHedgeRatio * 100 - 1) alerts.push(`Hedged ${risk.hedgedPct}% of the portfolio, ${r2(risk.solution.requiredHedgeRatio * 100)}% needed for your limit.`);
  if (extra.readiness) for (const a of readinessAlerts(s, extra.readiness)) alerts.push(`Needs your attention: ${a}`);
  alerts.push(...integrityAlerts(s));
  if (risk) for (const x of risk.tickers.filter((t2) => t2.bucket === 'none')) alerts.push(`${x.ticker} has no perp market to hedge on: $${r2(x.usd)} stays unhedged.`);

  return {
    wallet: s.wallet, network: s.network, mode: em.mode, modeNote: em.note, killSwitch: lim.killSwitch,
    paused: t?.pausedReason ? { reason: t.pausedReason } : null,
    portfolioUsd: r2(portfolioUsd),
    hedgedPct: risk?.hedgedPct ?? 0,
    requiredHedgePct: risk ? r2(risk.solution.requiredHedgeRatio * 100) : 0,
    varPct: risk ? r2(risk.solution.varNow * 100) : 0,
    limitPct: cfg.risk.lossTolerancePct,
    window: risk?.window ?? 'day',
    coverage: risk?.coverage ?? { directPct: 0, proxyPct: 0, nonePct: portfolioUsd > 0 ? 100 : 0 },
    tickers: (risk?.tickers ?? held.map((b) => ({ ticker: b.symbol.replace(/B$/, ''), bstock: b.symbol, usd: b.value, hedgedPct: 0, bucket: 'none' as const, excluded: false }))).map((x) => ({ ticker: x.ticker, bstock: x.bstock, usd: r2(x.usd), hedgedPct: x.hedgedPct, bucket: x.bucket, excluded: cfg.risk.excludeTickers.includes(x.ticker) })).slice(0, 30),
    nextEvent: risk?.nextEvent ?? null,
    lastNewsScanAt: extra.newsAt ?? null,
    newsFlags: flags.map((n) => ({ ticker: n.ticker, sentiment: n.sentiment, score: n.score, confidence: n.confidence, reason: n.reason.slice(0, 400), headline: (n.keyHeadlines[0] ?? n.headlines[0]?.title ?? null)?.slice(0, 300) ?? null })).slice(0, 30),
    limitsUsed: {
      notionalTodayUsd: r2(t?.notionalUsd ?? 0), maxNotionalPerDayUsd: lim.maxNotionalPerDayUsd,
      lossTodayUsd: r2(t?.lossUsd ?? 0), dailyLossCapUsd: lim.dailyLossCapUsd,
      capitalOffBnbUsd: r2(t?.capitalOffBnbUsd ?? 0), maxCapitalOffBnbUsd: lim.maxCapitalOffBnbUsd,
      autonomyExpiresAt: lim.autonomyExpiresAt,
    },
    monitored: [
      'Margin utilization on the perps and options accounts, every check',
      'Your bStock holdings and the perps hedge positions',
      'Portfolio 99% loss against your loss limit',
      'Scheduled events you added (earnings, corporate actions)',
      cfg.hedge.news.enabled ? 'Headlines for the stocks you hold (advisory flags only)' : 'News is switched off',
    ],
    notMonitored: [
      'Breaking news between scans: hedges cover scheduled events and price moves, not surprises',
      'Gaps can jump past a stop; only options cap loss without monitoring (Derive options are not connected yet)',
      'Hedge cost and spreads on off-hours books can differ from the quotes used here',
    ],
    alerts: alerts.map((a) => a.slice(0, 300)).slice(0, 10),
    takenAt: now.toISOString(),
    lastRun: extra.run ?? null,
  };
}

interface RunOut {
  outcome: string; note?: string; message?: string; chosen: { kind: string; ruleKey?: string; amountBaseUnit: string; hedge?: { market: string; deltaToShort: number; option?: { contracts: number; strike: number; premiumUsd: number; feesUsd: number } | null } | null; funding?: { source: string; amountUsd: number }[] } | null;
  candidates: { explain: string }[]; rejected: { reason: string; severity?: string }[]; analysis?: { summary?: string } | null;
  decision?: { reason?: string } | null; review?: { verdict?: string; reason?: string } | null;
}
const cut = (t: string | null | undefined, n: number) => (t ? t.slice(0, n) : null);

/** The latest run in plain words, for the page: what was decided, what happens next in this mode, and the live numbers it used. */
export function buildLastRun(s: Snapshot, out: RunOut | null, ranApproved: number, live: boolean, now = new Date()): LastRun {
  const em = effectiveMode(s, now);
  const c = out?.chosen ?? null;
  let decision: string;
  if (ranApproved) decision = `Ran ${ranApproved} request${ranApproved > 1 ? 's' : ''} you approved`;
  else if (!out) decision = 'No check this round';
  else if (c) {
    if (c.kind === 'hedge' && c.hedge?.option) { const o = c.hedge.option; decision = `Buy ${o.contracts} ${c.hedge.market} puts (strike ${o.strike}) on Derive, cost about $${(o.premiumUsd + o.feesUsd).toFixed(2)}`; }
    else if (c.kind === 'hedge' && c.hedge) decision = c.hedge.deltaToShort > 0 ? `Sell (short) ${Math.abs(c.hedge.deltaToShort)} ${c.hedge.market}` : `Buy back ${Math.abs(c.hedge.deltaToShort)} ${c.hedge.market}`;
    else { const amt = Math.round(Number(BigInt(c.amountBaseUnit)) / 1e4) / 100; decision = c.kind === 'top_up' ? `Top up $${amt.toFixed(2)} into ${c.ruleKey ?? ""}` : `Release $${amt.toFixed(2)} from ${c.ruleKey ?? ""}`; }
  } else decision = out.outcome === 'error' ? 'Paused this check' : 'No action';
  const next = ranApproved ? 'Approved request executed.'
    : !out ? 'Waiting for the next check.'
    : out.outcome === 'awaiting' ? 'Ask me first: waiting for your Approve or Reject on the card above. Nothing runs until you approve.'
    : out.outcome === 'simulated' ? 'Autonomous, dry run: it would have run this on its own. Nothing was sent because the agent is in dry-run mode.'
    : out.outcome === 'done' ? 'Autonomous: it ran this on its own.'
    : out.outcome === 'failed' ? 'It tried to run this and it failed. See the activity feed.'
    : out.outcome === 'vetoed' ? 'Blocked by a safety check. See the reasons.'
    : out.outcome === 'error' ? 'Held this round because of a problem. See the reasons.'
    : em.mode === 'autonomous' ? 'Autonomous: nothing needs doing.' : 'Ask me first: nothing needs your approval.';
  const feed: LastRun['feed'] = {
    bnbUsdc: r2(s.bsc.usdcUsd), bnbUsdt: r2(s.bsc.usdtUsd), /* shared field names (lib/agent-status): now the perps (Aster) account */ lighterEquityUsd: s.perpMain ? r2(s.perpMain.equityUsd) : null, lighterFreeUsd: s.perpMain ? r2(s.perpMain.freeUsd) : null, deriveFreeUsd: s.deriveFree ? r2(s.deriveFree.freeUsd) : null,
    bstocks: s.bsc.bstocks.filter((b) => b.qty > 0).slice(0, 30).map((b) => ({ symbol: b.symbol, qty: Math.round(b.qty * 1e6) / 1e6, usd: r2(b.value) })),
    positions: Object.entries(s.perpPositions).filter(([, v]) => v).slice(0, 30).map(([t, v]) => ({ market: t, units: v })),
  };
  return {
    at: now.toISOString(), live, outcome: out?.outcome ?? 'idle', decision: decision.slice(0, 300), next, why: cut(out?.message || out?.note || null, 900),
    candidates: (out?.candidates ?? []).slice(0, 10).map((x) => x.explain.slice(0, 500)), reasons: (out?.rejected ?? []).map((x) => x.reason).filter((x, i, a) => a.indexOf(x) === i).slice(0, 10).map((x) => x.slice(0, 400)),
    analyst: cut(out?.analysis?.summary, 900), decider: cut(out?.decision?.reason, 900), reviewer: out?.review ? cut(`${out.review.verdict ?? ''}: ${out.review.reason ?? ''}`, 900) : null, feed,
  };
}
