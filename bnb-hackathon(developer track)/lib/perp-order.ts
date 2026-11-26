// Pre-trade checks and result wording for the perps ticket (Aster; Lighter is dormant). Pure, so it is unit-tested.
// A venue can accept an order and only reject it on execution, so the ticket catches the impossible ones first and
// then reports what really happened to the order. Shown text never names the venue.

export interface PerpCheckInput {
  size: number;
  /** Price the order is valued at: last trade for market orders, the limit price otherwise. */
  px: number;
  /** Initial margin fraction, e.g. 0.05 for 5% (20x). */
  imf: number;
  /** Free margin on the selected account; null = not loaded yet. */
  available: number | null;
  minBase: number;
  minQuote: number;
  sizeDecimals: number;
  reduceOnly: boolean;
  symbol: string;
}

export interface PerpCheck {
  notional: number;
  margin: number;
  /** Largest size the free margin can open, floored to the size step; null when unknown. */
  maxSize: number | null;
  /** Why the order cannot go, or null. */
  problem: string | null;
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: n >= 100 ? 0 : 2, minimumFractionDigits: n >= 100 ? 0 : 2 })}`;

export function checkPerpOrder(i: PerpCheckInput): PerpCheck {
  const notional = i.size > 0 && i.px > 0 ? i.size * i.px : 0;
  const margin = notional * i.imf;
  const step = 10 ** -i.sizeDecimals;
  const maxSize = i.available !== null && i.px > 0 && i.imf > 0 ? Math.floor(i.available / i.imf / i.px / step + 1e-9) * step : null;
  let problem: string | null = null;
  if (i.size > 0) {
    if (i.size < i.minBase) problem = `Minimum size is ${i.minBase} ${i.symbol}.`;
    else if (!i.reduceOnly && notional > 0 && notional < i.minQuote) problem = `The perps minimum order is ${usd(i.minQuote)}; this one is ${usd(notional)}.`;
    else if (!i.reduceOnly && i.available !== null && margin > i.available + 1e-9) {
      const max = maxSize !== null && maxSize > 0 ? ` You can open at most about ${maxSize.toFixed(i.sizeDecimals)} ${i.symbol}.` : '';
      problem = `Not enough margin: this order needs ${usd(margin)} (${Math.round(i.imf * 100)}% of ${usd(notional)}), you have ${usd(i.available)} free.${max}`;
    }
  }
  return { notional, margin, maxSize, problem };
}

export interface OrderOutcome { state: 'pending' | 'open' | 'filled' | 'partial' | 'canceled'; status: string | null; size: string | null; filled: string | null; avgPrice: string | null }

const CANCEL_REASON: Record<string, string> = {
  canceled: 'no reason given',
  expired: 'it expired',
  rejected: 'it was rejected',
  'canceled-margin-not-allowed': 'not enough margin',
  'canceled-not-enough-liquidity': 'not enough liquidity on the book',
  'canceled-too-much-slippage': 'the price moved past your limit',
  'canceled-post-only': 'it would have filled immediately (post-only)',
  'canceled-reduce-only': 'it would have increased the position (reduce-only)',
  'canceled-expired': 'it expired',
  'canceled-self-trade': 'it would have traded with your own order',
  'canceled-invalid-balance': 'the balance check failed',
};

/** One line for the ticket. */
export function describeOutcome(o: OrderOutcome, symbol: string): { ok: boolean; text: string } {
  const avg = o.avgPrice ? ` at ${Number(o.avgPrice).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '';
  switch (o.state) {
    case 'filled': return { ok: true, text: `Filled ${Number(o.filled)} ${symbol}${avg}.` };
    case 'open': return { ok: true, text: `Order is on the book${Number(o.filled) > 0 ? ` (${Number(o.filled)} ${symbol} filled so far)` : ''}.` };
    case 'partial': {
      const why = o.status ? CANCEL_REASON[o.status] ?? o.status.replace(/^canceled-/, '').replace(/-/g, ' ') : 'the rest was canceled';
      return { ok: true, text: `Partly filled: ${Number(o.filled)} of ${Number(o.size)} ${symbol}${avg}. The rest was canceled: ${why}.` };
    }
    case 'canceled': {
      const why = o.status ? CANCEL_REASON[o.status] ?? o.status.replace(/^canceled-/, '').replace(/-/g, ' ') : 'no reason given';
      return { ok: false, text: `Not filled. The venue canceled the order: ${why}.` };
    }
    default: return { ok: true, text: 'Order sent. Waiting for the venue to confirm…' };
  }
}
