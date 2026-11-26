import { describe, expect, it } from 'vitest';
import { venueWords, venueWordsDeep } from '../lib/venue-words';

// Real strings the agent shows (2026-11-25/26), and what users should read instead.
const cases: [string, string][] = [
  ['Short $10.36 MSTR perp on Lighter', 'Short $10.36 MSTR perp'],
  ['1 NVDA put at strike 150 on Derive', '1 NVDA put at strike 150'],
  ["A $5.00 short is under Lighter's $10.00 minimum order", "A $5.00 short is under the perps venue's $10.00 minimum order"],
  ['Derive lists no MSTR options right now.', 'Options lists no MSTR options right now.'],
  ['Buy 1 NVDA-20261204-150-P on Derive (you asked in chat)', 'Buy 1 NVDA-20261204-150-P (you asked in chat)'],
  ['Move $7.00 USDC margin on Derive: fallback subaccount #122954 to PRIME subaccount #122955', 'Move $7.00 USDC margin on options: fallback subaccount #122954 to PRIME subaccount #122955'],
  ['Lighter main account has $7.95 free', 'perps main account has $7.95 free'],
  ['Needs about $3.47 margin; a top-up from BNB to Lighter takes about 20 min', 'Needs about $3.47 margin; a top-up from BNB to perps takes about 20 min'],
  ['Short NVDA perp on Lighter (proxy for MSTR)', 'Short NVDA perp (proxy for MSTR)'],
  ['Lighter perps and Derive options', 'perps and options'],
  // Aster is the perps venue now: same words as Lighter.
  ['Short $10.36 MSTR perp on Aster', 'Short $10.36 MSTR perp'],
  ["A $4.00 short is under Aster's $5.00 minimum order", "A $4.00 short is under the perps venue's $5.00 minimum order"],
  ['Aster main account has $7.95 free', 'perps main account has $7.95 free'],
  ['A top-up from BNB to Aster takes about 1 min', 'A top-up from BNB to perps takes about 1 min'],
  ['Aster perps and Derive options', 'perps and options'],
  ['Aster -2019: Margin is insufficient.', 'Perps -2019: Margin is insufficient.'],
  ['Deposit on AsterDEX first', 'Deposit on perps first'],
];

describe('venueWords: shown text never names a venue', () => {
  for (const [from, to] of cases) it(from, () => expect(venueWords(from)).toBe(to));
  it('leaves venue-free text and instrument names alone, and is idempotent', () => {
    expect(venueWords('NVDA-20261204-150-P costs $9.97')).toBe('NVDA-20261204-150-P costs $9.97');
    for (const [from] of cases) { const once = venueWords(from); expect(venueWords(once)).toBe(once); expect(once).not.toMatch(/Lighter|Aster|Derive/); }
  });
  it('leaves words that merely start with Aster alone', () => {
    expect(venueWords('AsterSignTransaction domain')).toBe('AsterSignTransaction domain');
  });
  it('deep: every string in a reply, keys untouched', () => {
    expect(venueWordsDeep({ venue: 'lighter', title: 'Sell 0.07 NVDA short on Lighter', list: ['Derive put'], n: 3 })).toEqual({ venue: 'lighter', title: 'Sell 0.07 NVDA short', list: ['put'], n: 3 });
  });
});
