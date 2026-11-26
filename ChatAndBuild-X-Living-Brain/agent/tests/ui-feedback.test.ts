import { describe, expect, it } from 'vitest';
import { fitRule } from '../src/proposal/compute';

const P = { maxUtil: 0.9, kSigma: 3, volStress: 1.5, minTrigger: 0.4, maxTrigger: 0.85, tickSec: 30 };
const book = { vol1h: 0.041, latencySec: 18, leverage: 12, utilNow: 0.55, equityUsd: 10_000, usedUsd: 5_500, bnbStablesUsd: 0, bstocksAfterHaircutUsd: 4_900, haircutPct: 30 };

describe('proposal wording', () => {
  it('shows the value and the value after the haircut, with thousands separators', () => {
    const f = fitRule(book, P).facts.join(' ');
    expect(f).toMatch(/\$7,000 value, \$4,900 after the 30% haircut/);
    expect(f).not.toMatch(/haircut value/); expect(f).not.toMatch(/\$7000/);
  });
  it('describes bStocks as sellable funding, and tells the user how to avoid a sale', () => {
    const f = fitRule(book, P).facts.join(' ');
    expect(f).toMatch(/could cover it by being sold/); expect(f).toMatch(/add USDC or USDT/);
  });
});
