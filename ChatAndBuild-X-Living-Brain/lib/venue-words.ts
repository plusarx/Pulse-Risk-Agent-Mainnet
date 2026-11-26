// What users see never names the venues: Aster (and the dormant Lighter) is "perps", Derive is "options". The agent and app keep the venue names
// internally (code, APIs, logs); this turns any text that is about to be SHOWN into the product words. Pure and idempotent.

const RULES: [RegExp, string][] = [
  // Phrases first, so the result reads naturally. "...put at strike 150 on Derive" / "...NVDA-20261204-150-P on Derive": the clause
  // already says it is an option, so the venue is just dropped (same for a perp "on Lighter").
  [/(\b(?:puts?|calls?|options?|[A-Z0-9]+-\d{8}-[0-9_]+-[CP])\b[^.;:()\n]*?)\s+on\s+Derive\b/g, '$1'],
  [/(\b(?:perps?|shorts?|longs?)\b[^.;:()\n]*?)\s+on\s+(?:Lighter|Aster(?:DEX)?)\b/gi, '$1'],
  [/\b(perps?|short|shorts|long|longs)\s+on\s+(?:Lighter|Aster(?:DEX)?)\b/gi, '$1'],
  [/\b(puts?|calls?|options?)\s+on\s+Derive\b/gi, '$1'],
  [/\b(?:Lighter|Aster(?:DEX)?)\s*·\s*Perps\b/g, 'Perps'], [/\bDerive\s*·\s*Options\b/g, 'Options'],
  [/\b(?:Lighter|Aster(?:DEX)?)\s+perps?\b/gi, 'perps'], [/\bDerive\s+(options?|puts?)\b/gi, '$1'],
  [/\b(?:Lighter|Aster(?:DEX)?)'s\b/g, "the perps venue's"], [/\bDerive's\b/g, "the options venue's"],
  [/\b(?:Lighter|Aster(?:DEX)?)\s+(main\s+)?(sub-?)?accounts?\b/gi, (m: string) => m.replace(/Lighter|Aster(?:DEX)?/i, 'perps')] as unknown as [RegExp, string],
  [/\bDerive\s+(sub)?accounts?\b/gi, (m: string) => m.replace(/Derive/i, 'options')] as unknown as [RegExp, string],
  [/\b(on|to|from|into|via)\s+(?:Lighter|Aster(?:DEX)?)\b/g, '$1 perps'], [/\b(on|to|from|into|via)\s+Derive\b/g, '$1 options'],
  // Anything left: the bare venue name.
  [/\b(?:Lighter|Aster(?:DEX)?)\b/g, 'Perps'], [/\bDerive\b/g, 'Options'],
  // Tidy doubled words the phrases above can leave.
  [/\bperps?\s+perps\b/gi, 'perps'], [/\bPerps\s+perp\b/g, 'perp'], [/\boptions\s+options\b/gi, 'options'],
];

export function venueWords(text: string): string {
  if (!text || !/Lighter|Aster|Derive/.test(text)) return text;
  let t = text;
  for (const [re, to] of RULES) t = t.replace(re, to as never);
  return t;
}

/** Apply venueWords to every string in a JSON-like value (requests, status, chat replies). Keys are left alone. */
export function venueWordsDeep<T>(v: T): T {
  if (typeof v === 'string') return venueWords(v) as T;
  if (Array.isArray(v)) return v.map((x) => venueWordsDeep(x)) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, venueWordsDeep(x)])) as T;
  return v;
}
