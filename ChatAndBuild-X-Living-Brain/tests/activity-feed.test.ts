import { describe, expect, it } from 'vitest';
import { eventLabel, splitEvent, type EventRow } from '@/components/risk/ActivityFeed';

const row = (o: Partial<EventRow>): EventRow => ({ id: 1, kind: 'info', venue: 'lighter', status: null, message: 'x', payload: null, created_at: 0, ...o });

describe('activity feed', () => {
  it('turns kind and venue into readable labels', () => {
    expect(eventLabel(row({ kind: 'info', venue: 'lighter' }))).toBe('Note · Perps');
    expect(eventLabel(row({ kind: 'rebalance', venue: 'derive' }))).toBe('Margin move · Options');
    expect(eventLabel(row({ kind: 'error', venue: null }))).toBe('Problem');
    expect(eventLabel(row({ kind: 'hedge', venue: 'lighter' }))).toBe('Hedge · Perps');
  });
  it('keeps the AI reasoning in payload.details, not in the message', () => {
    const e = row({ message: 'Dry run: would top up $10.00 on Lighter.', payload: JSON.stringify({ details: { reasoning: 'Utilization is 82%...' } }) });
    const s = splitEvent(e);
    expect(s.message).toBe('Dry run: would top up $10.00 on Lighter.'); expect(s.details?.reasoning).toMatch(/82%/);
  });
  it('older "AI recommendation" events show one short line and keep the text behind Details', () => {
    const s = splitEvent(row({ message: 'AI recommendation: Utilization is 82% ... 45%. Safety review: approved.' }));
    expect(s.message).not.toMatch(/82%/); expect(s.details?.reasoning).toMatch(/82%/);
  });
  it('plain events have no Details', () => {
    expect(splitEvent(row({ message: 'hello' })).details).toBeNull();
  });
});
