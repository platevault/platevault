/**
 * Shared date/time formatting + comparison helpers (spec 042 / T181).
 *
 * Consolidates the previously-separate, hand-rolled display formatters and the
 * inline `new Date(x).getTime()` sort comparators that were duplicated across
 * AuditLog, LogPanel, CalendarScroll, ProjectsList, and manifests. All output
 * strings are intentionally byte-identical to the prior implementations:
 *
 *   - `formatDateTime`   → "yyyy-MM-dd HH:mm" (local)   — was AuditLog.formatTimestamp
 *   - `formatTimeOfDay`  → "hh:mm:ss a" (local, 12h)    — was LogPanel.formatTime
 *   - `formatMonthYear`  → "MMMM yyyy"                  — was CalendarScroll month label
 *
 * Note: the UTC-pinned manifest formatter (manifests.formatManifestTimestamp)
 * is deliberately NOT routed through here — date-fns' core `format` is
 * timezone-local and reproducing its UTC output would require `date-fns-tz`,
 * which is not a project dependency. It stays as a manual UTC formatter.
 */

import { format } from 'date-fns';

/**
 * Format an ISO timestamp as "yyyy-MM-dd HH:mm" in local time.
 * Replaces the hand-rolled pad()-based formatter in AuditLog.
 */
export function formatDateTime(iso: string): string {
  return format(new Date(iso), 'yyyy-MM-dd HH:mm');
}

/**
 * Format an ISO timestamp as a localized 12-hour time-of-day ("hh:mm:ss a").
 * Mirrors the prior `toLocaleTimeString(undefined, {hour, minute, second})`
 * output and keeps the original fall-back-to-input-on-parse-error behavior.
 */
export function formatTimeOfDay(iso: string): string {
  try {
    return format(new Date(iso), 'hh:mm:ss a');
  } catch {
    return iso;
  }
}

/**
 * Format an ISO date as the long month + year ("MMMM yyyy", e.g. "April 2026").
 * Replaces the CalendarScroll `toLocaleDateString(undefined, {year, month})`.
 */
export function formatMonthYear(iso: string): string {
  return format(new Date(iso), 'MMMM yyyy');
}

/**
 * Comparator that orders ISO date strings most-recent-first (descending).
 * Replaces the inline `new Date(b).getTime() - new Date(a).getTime()` sorts.
 */
export function compareDateDesc(aIso: string, bIso: string): number {
  return new Date(bIso).getTime() - new Date(aIso).getTime();
}

/** Parse an ISO date string to epoch milliseconds (for range filtering). */
export function toEpochMs(iso: string): number {
  return new Date(iso).getTime();
}
