import { describe, it, expect } from 'vitest';
import { observingNightAnchor, formatNightKey } from './observing-night';

describe('observingNightAnchor', () => {
  it('at 22:00 anchors to the coming midnight (tomorrow 00:00)', () => {
    const now = new Date(2026, 6, 4, 22, 0, 0); // 2026-07-04 22:00 local
    const { nightKey, midnight } = observingNightAnchor(now);
    expect(nightKey).toBe('2026-07-05');
    expect(midnight.getFullYear()).toBe(2026);
    expect(midnight.getMonth()).toBe(6);
    expect(midnight.getDate()).toBe(5);
    expect(midnight.getHours()).toBe(0);
  });

  it('at 02:00 anchors to the just-passed midnight (today 00:00)', () => {
    const now = new Date(2026, 6, 5, 2, 0, 0); // 2026-07-05 02:00 local
    const { nightKey } = observingNightAnchor(now);
    expect(nightKey).toBe('2026-07-05');
  });

  it('produces the SAME nightKey across a midnight span (no 00:00 flip)', () => {
    const evening = observingNightAnchor(new Date(2026, 6, 4, 23, 59, 0));
    const morning = observingNightAnchor(new Date(2026, 6, 5, 0, 1, 0));
    const predawn = observingNightAnchor(new Date(2026, 6, 5, 4, 30, 0));
    expect(evening.nightKey).toBe('2026-07-05');
    expect(morning.nightKey).toBe('2026-07-05');
    expect(predawn.nightKey).toBe('2026-07-05');
  });

  it('rolls over at the local noon boundary', () => {
    const beforeNoon = observingNightAnchor(new Date(2026, 6, 5, 11, 59, 0));
    const afterNoon = observingNightAnchor(new Date(2026, 6, 5, 12, 1, 0));
    expect(beforeNoon.nightKey).toBe('2026-07-05');
    expect(afterNoon.nightKey).toBe('2026-07-06');
  });

  it('handles month/year boundaries', () => {
    const nye = observingNightAnchor(new Date(2026, 11, 31, 22, 0, 0));
    expect(nye.nightKey).toBe('2027-01-01');
  });

  it('spring-forward DST day still yields a stable calendar-date key', () => {
    // Regardless of local DST rules, the anchor is a calendar midnight; the key
    // is the calendar date of that midnight and does not depend on the offset.
    const beforeDst = observingNightAnchor(new Date(2026, 2, 8, 22, 0, 0));
    const afterMidnight = observingNightAnchor(new Date(2026, 2, 9, 3, 0, 0));
    expect(beforeDst.nightKey).toBe('2026-03-09');
    expect(afterMidnight.nightKey).toBe('2026-03-09');
  });
});

describe('formatNightKey', () => {
  it('zero-pads month and day', () => {
    expect(formatNightKey(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});
