import { createHash } from 'node:crypto';
import { hedgeKey } from '../../../lib/agent-config';
import { planHedge } from '../../../lib/plan';
import type { Candidate, RejectedCandidate, Snapshot } from '../types';
import { tickerOf } from './market';

// Value-based hedge sizing (the default, and what the test sheet and AGENT_BUILD.md describe):
//   target units = bStock qty x bStock price x hedge ratio / HEDGE price
// so an index proxy is sized by notional, not by share count (0.1 SPYB at $726 against a $7,260 index perp is 0.01, not 0.1).
// The trade is decided here, in code. Orders are rounded to the venue step and anything below the venue minimum is
// skipped and reported, never sent.

const r2 = (x: number) => Math.round(x * 100) / 100;
const key = (...p: (string | number)[]) => createHash('sha256').update(p.join('|')).digest('hex').slice(0, 24);
const decimalsOf = (step: number) => Math.max(0, Math.round(-Math.log10(step)));
const floorStep = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;
const venueName = (v: string) => (v === 'derive' ? 'Derive' : 'perps');

export interface RatioPlan { candidates: Candidate[]; rejected: RejectedCandidate[] }

export function planRatioHedges(s: Snapshot, now = new Date()): RatioPlan {
  const cfg = s.config; const out: Candidate[] = []; const rejected: RejectedCandidate[] = [];
  const info = (reason: string): RejectedCandidate => ({ kind: 'hedge', reason, severity: 'info' });
  const err = (reason: string): RejectedCandidate => ({ kind: 'hedge', reason, severity: 'error' });

  const held = Object.fromEntries(s.bsc.bstocks.map((b) => [b.symbol, { qty: b.qty, price: b.qty > 0 && b.value > 0 ? b.value / b.qty : null }]));
  const positions: Record<string, number> = { ...(s.hedgePositions ?? {}) };
  for (const l of cfg.hedge.legs) if (l.venue === 'aster') positions[hedgeKey(l)] = s.perpPositions[l.market] ?? positions[hedgeKey(l)] ?? 0;
  const actions = planHedge(cfg.hedge, held, positions, s.hedgePrices ?? {});

  actions.forEach((a, i) => {
    const leg = cfg.hedge.legs[i]; const k = a.key;
    if (leg.venue === 'lighter') { rejected.push(info(`${a.bstock}: this hedge leg is on a retired venue; set it on perps`)); return; }
    const venue = leg.venue; const mins = s.hedgeMins?.[k]; const price = s.hedgePrices?.[k];
    const tag = `${a.bstock} to ${venueName(a.venue)} ${a.market} ${a.kind}`;
    if (a.targetUnits === null || !price) { rejected.push(info(`${tag}: waiting for prices`)); return; }
    const hp = s.hedgePositions ?? {};

    // ── put: roll the held put before expiry, otherwise buy the missing contracts ──
    if (leg.kind === 'put') {
      const put = leg.put!; const pick = s.putPicks?.[k];
      const dying = (s.putPositions ?? []).filter((p) => p.key === k && p.daysToExpiry < put.minDaysToExpiry);
      let contracts = 0; let sell: { instrument: string; amount: number }[] | undefined;
      if (dying.length) { contracts = dying.reduce((x, p) => x + p.amount, 0); sell = dying.map((p) => ({ instrument: p.instrument, amount: p.amount })); }
      else if (a.act && a.deltaUnits > 0) contracts = a.deltaUnits;
      else { rejected.push(info(`${tag}: ${a.reason}`)); return; }
      const step = mins?.step ?? 1; const q = Number(floorStep(contracts, step).toFixed(decimalsOf(step)));
      if (mins && q < mins.minBase - 1e-12) { rejected.push(info(`${tag}: ${q} contracts is below the venue minimum (${mins.minBase}), so it is not sent`)); return; }
      if (!pick) { rejected.push(err(`${tag}: no put with at least ${put.minDaysToExpiry} days to expiry and an ask is listed`)); return; }
      const premium = q * pick.ask; const verb = sell ? 'Roll' : 'Buy';
      out.push({
        id: `hedge:${k}:put:${pick.instrument}:${q}`, kind: 'hedge', venue: 'derive', amountBaseUnit: '0', notionalUsd: r2(q * price),
        explain: `${verb} ${q} ${leg.market} put${q === 1 ? '' : 's'} on Derive: ${pick.instrument} (strike ${pick.strike}, ${pick.daysToExpiry} days) at about $${r2(pick.ask)} each, $${r2(premium)} in all.${sell ? ` The held put${sell.length > 1 ? 's' : ''} (${sell.map((x) => x.instrument).join(', ')}) ${sell.length > 1 ? 'are' : 'is'} under ${put.minDaysToExpiry} days to expiry, so ${sell.length > 1 ? 'they are' : 'it is'} sold first (reduce-only).` : ''} Target ${a.targetUnits.toFixed(4)} contracts = ${held[a.bstock].qty} ${a.bstock} x $${r2(held[a.bstock].price ?? 0)} x ratio ${leg.hedgeRatio} / index $${r2(price)}.`,
        reason: sell ? `put ${sell.map((x) => x.instrument).join(', ')} is ${dying[0].daysToExpiry} days from expiry (roll below ${put.minDaysToExpiry})` : `${a.bstock} ${a.reason} (target ${a.targetUnits.toFixed(4)}, held ${a.currentUnits}, drift ${a.driftPct.toFixed(1)}%)`,
        hedge: { bstock: a.bstock, market: leg.market, deltaToShort: q, driftPct: a.driftPct, ticker: tickerOf(a.bstock), key: k, venue: 'derive', kind: 'put', hedgePrice: price, instrument: 'put',
          option: { expiry: pick.expiry, strike: pick.strike, contracts: q, ask: pick.ask, premiumUsd: r2(premium), feesUsd: 0, notionalUsd: r2(q * price) }, derive: { instrument: pick.instrument, ...(sell ? { roll: { sell } } : {}) } },
        urgency: 1500 + (sell ? 300 : 0) + Math.min(400, a.driftPct),
        idempotencyKey: `ag-${key(s.wallet, s.network, 'put', k, pick.instrument, q, Math.floor(now.getTime() / 300_000))}`,
      });
      return;
    }

    // ── perp (perps venue or Derive) ──
    if (!a.act) { rejected.push(info(`${tag}: ${a.reason}${a.reason === 'in band' ? ` (${a.driftPct.toFixed(1)}% off, threshold ${cfg.hedge.driftThresholdPct}%), no trade` : ''}`)); return; }
    const delta = a.deltaUnits; const step = mins?.step ?? 1e-8; const dec = decimalsOf(step);
    const q = Number(floorStep(Math.abs(delta), step).toFixed(dec));
    const notional = q * price;
    if (mins && (q < mins.minBase - 1e-12 || notional < mins.minNotionalUsd)) {
      rejected.push(info(`${tag}: an order of ${q} ($${r2(notional)}) is below the venue minimum (${mins.minBase}${mins.minNotionalUsd ? ` and $${mins.minNotionalUsd}` : ''}), so it is not sent`)); return;
    }
    // Margin check before adding a short: the venue must be able to carry it. Report and skip instead of sending an order that fails.
    if (delta > 0) {
      const need = notional / Math.max(1, cfg.limits.maxLeverage);
      const free = venue === 'aster' ? s.perpMain?.freeUsd : s.deriveFree?.freeUsd;
      if (free !== undefined && need > free) { rejected.push(err(`${tag}: needs about $${r2(need)} of margin on ${venueName(leg.venue)} but only $${r2(free)} is free, so top up first`)); return; }
    }
    const sellSide = delta > 0; const sizeTxt = `${q} ${leg.market}`; void hp;
    out.push({
      id: `hedge:${k}:${sellSide ? 'sell' : 'buy'}:${q}`, kind: 'hedge', venue, amountBaseUnit: '0', notionalUsd: r2(notional),
      explain: `Place a ${venueName(leg.venue)} market order to ${sellSide ? 'sell (add to the short)' : 'buy back (reduce the short)'} ${sizeTxt} (about $${r2(notional)}). Target short ${a.targetUnits.toFixed(4)} = ${held[a.bstock].qty} ${a.bstock} x $${r2(held[a.bstock].price ?? 0)} x ratio ${leg.hedgeRatio} / ${leg.market} $${r2(price)}; now ${a.currentUnits}. ${a.driftPct.toFixed(0)}% off.`,
      reason: `${a.bstock} held ${held[a.bstock].qty} ($${r2((held[a.bstock].qty) * (held[a.bstock].price ?? 0))}); target ${leg.market} short ${a.targetUnits.toFixed(4)}, current ${a.currentUnits} (drift ${a.driftPct.toFixed(1)}%)`,
      hedge: { bstock: a.bstock, market: leg.market, deltaToShort: sellSide ? q : -q, driftPct: a.driftPct, ticker: tickerOf(a.bstock), key: k, venue, kind: 'perp', hedgePrice: price, ...(leg.venue === 'derive' ? { derive: { instrument: `${leg.market}-PERP` } } : {}) },
      urgency: 1000 + Math.min(400, a.driftPct), idempotencyKey: `ag-${key(s.wallet, s.network, 'hedge', k, sellSide ? q : -q, Math.floor(now.getTime() / 300_000))}`,
    });
  });
  out.sort((x, y) => y.urgency - x.urgency);
  return { candidates: out, rejected };
}
