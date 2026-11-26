import { describe, expect, it } from 'vitest';
import { figures, ungroundedFigures } from '../src/chat/chat';

// Live 2026-11-25: "both fail the $10 minimum" was flagged as an invented figure "$10 m" ($10 million).
describe('figure parsing: k/m suffixes only when they are not the start of a word', () => {
  it('"$10 minimum" is $10, not $10 million', () => {
    expect(figures('both fail the $10 minimum')).toEqual([{ raw: '$10', value: 10 }]);
    expect(ungroundedFigures('both fail the $10 minimum', ['Venue minimum $10'])).toEqual([]);
  });
  it('real suffixes still scale', () => {
    expect(figures('a $10m book and $2k budget, $3 M cap').map((f) => f.value)).toEqual([10e6, 2e3, 3e6]);
  });
  it('"5% max" and "$4 more" keep their plain values', () => {
    expect(figures('about 5% max, $4 more').map((f) => f.value)).toEqual([5, 4]);
  });
});
