import { formatUnits, parseUnits } from 'viem';

/** Display-only: format a base-unit bigint. Never feed the result back into a tx amount. */
export function fmtUnits(v: bigint | undefined | null, decimals: number, maxFrac = 4): string {
  if (v === undefined || v === null) return '—';
  const s = formatUnits(v, decimals);
  const [i, f = ''] = s.split('.');
  const frac = f.slice(0, maxFrac).replace(/0+$/, '');
  return `${Number(i).toLocaleString('en-US')}${frac ? '.' + frac : ''}`;
}

/** Display-only USD formatting for numbers that are already display values. */
export function fmtUsd(n: number | undefined | null, frac = 2): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: frac, maximumFractionDigits: frac });
}

export function fmtNum(n: number | undefined | null, frac = 2): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: frac, maximumFractionDigits: frac });
}

export function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/** Parse user input into base units; returns null on invalid input instead of throwing. */
export function safeParseUnits(input: string, decimals: number): bigint | null {
  const t = input.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null;
  try { return parseUnits(t, decimals); } catch { return null; }
}

/** bigint → float for *display/aggregation only* (portfolio totals). */
export function toFloat(v: bigint, decimals: number): number {
  return Number(formatUnits(v, decimals));
}

export function shortAddr(a?: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

/** Price-tick aware formatting for order books. */
export function priceDecimals(p: number): number {
  if (p >= 1000) return 1;
  if (p >= 10) return 2;
  if (p >= 1) return 3;
  return 5;
}
