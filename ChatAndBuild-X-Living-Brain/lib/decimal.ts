/** Scale a decimal string to an integer bigint with `decimals` places. Truncates extra precision (never rounds up). */
export function scaleDecimal(v: string, decimals: number): bigint {
  const t = v.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`invalid decimal: ${v}`);
  const [i, f = ''] = t.split('.');
  return BigInt(i + f.slice(0, decimals).padEnd(decimals, '0'));
}

export function unscale(v: bigint, decimals: number): string {
  const neg = v < 0n; const a = neg ? -v : v;
  const s = a.toString().padStart(decimals + 1, '0');
  const i = s.slice(0, s.length - decimals); const f = s.slice(s.length - decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${i}${f ? '.' + f : ''}`;
}

/** Round a decimal string DOWN to a multiple of `step` (both decimal strings). */
export function floorToStep(v: string, step: string): string {
  const d = Math.max((step.split('.')[1] ?? '').length, 0);
  const sv = scaleDecimal(v, d + 2); const ss = scaleDecimal(step, d + 2);
  if (ss === 0n) return v;
  return unscale((sv / ss) * ss, d + 2);
}
