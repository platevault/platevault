// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  formatDateTime,
  formatTimeOfDay,
  formatMonthYear,
  compareDateDesc,
  toEpochMs,
} from './datetime';

/**
 * Locks the shared date-fns formatters (T181) to the exact output strings of
 * the prior hand-rolled / Intl-based formatters they replaced. Assertions use
 * local-time-stable inputs (no trailing `Z`) so they don't depend on the
 * runner timezone.
 */
describe('datetime formatters', () => {
  it('formatDateTime → "yyyy-MM-dd HH:mm" (was AuditLog.formatTimestamp)', () => {
    expect(formatDateTime('2026-04-12T18:01:00')).toBe('2026-04-12 18:01');
    expect(formatDateTime('2026-01-05T09:07:00')).toBe('2026-01-05 09:07');
  });

  it('formatTimeOfDay → 12-hour "hh:mm:ss a" (was LogPanel.formatTime)', () => {
    expect(formatTimeOfDay('2026-04-12T22:01:00')).toBe('10:01:00 PM');
    expect(formatTimeOfDay('2026-04-12T09:05:07')).toBe('09:05:07 AM');
  });

  it('formatTimeOfDay falls back to the raw input on a parse error', () => {
    expect(formatTimeOfDay('not-a-date')).toBe('not-a-date');
  });

  it('formatMonthYear → "MMMM yyyy" (was CalendarScroll month label)', () => {
    expect(formatMonthYear('2026-04-12')).toBe('April 2026');
    expect(formatMonthYear('2026-12-01')).toBe('December 2026');
  });

  it('compareDateDesc orders most-recent first', () => {
    const items = [
      '2026-01-01T00:00:00Z',
      '2026-03-01T00:00:00Z',
      '2026-02-01T00:00:00Z',
    ];
    expect([...items].sort(compareDateDesc)).toEqual([
      '2026-03-01T00:00:00Z',
      '2026-02-01T00:00:00Z',
      '2026-01-01T00:00:00Z',
    ]);
  });

  it('toEpochMs matches Date.getTime()', () => {
    const iso = '2026-04-12T18:01:00Z';
    expect(toEpochMs(iso)).toBe(new Date(iso).getTime());
  });
});
