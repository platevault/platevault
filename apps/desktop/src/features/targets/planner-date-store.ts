/**
 * planner-date-store.ts — the Planner's chosen planning date (spec 044 US2, T024).
 *
 * FR-008: the planner lets the user choose an arbitrary planning date, but that
 * choice MUST default to "tonight" on every launch and MUST NOT be persisted
 * across sessions. A plain in-memory module store (no settings key, no
 * localStorage) is the correct implementation for that requirement — it holds
 * the override only while the process is alive and naturally resets to
 * "tonight" on the next launch/reload, with no extra reset code needed.
 *
 * Mirrors the subscribe/snapshot shape of `observing-sites/site-store.ts` so
 * components read it the same way, but deliberately has no `save*`/backend
 * call — this store is never durable.
 */

import { useSyncExternalStore } from 'react';

/** `null` = no override ("tonight" — resolves to `Date.now()` on every read). */
let overrideDateMs: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Snapshot for `useSyncExternalStore`: the override, or `null` for "tonight". */
function snapshotOverride(): number | null {
  return overrideDateMs;
}

// "Tonight" fallback, memoized per calendar day (mirrors
// `astro/observing-night.ts`'s `lastKey`/`lastAnchor` memo). `getSnapshot`
// passed to `useSyncExternalStore` MUST return a referentially-stable value
// when nothing changed — returning a literal `Date.now()` every call makes
// React think the store changes on every render and re-render forever
// (`Maximum update depth exceeded`). Truncating to "first read this calendar
// day" keeps the snapshot stable across a session while still resolving to a
// real recent instant (nightSpan/dayKey downstream only care about the
// calendar day anyway).
let lastTonightDayKey: string | null = null;
let lastTonightMs = 0;

function tonightMs(): number {
  const dayKey = new Date().toDateString();
  if (dayKey !== lastTonightDayKey) {
    lastTonightDayKey = dayKey;
    lastTonightMs = Date.now();
  }
  return lastTonightMs;
}

/** Resolved-value snapshot for `useSyncExternalStore`: the override, or the memoized "tonight". */
function snapshotResolved(): number {
  return overrideDateMs ?? tonightMs();
}

/** Set the Planner's chosen date (epoch ms), or `null` to reset to "tonight" (FR-008). */
export function setPlannerDateMs(dateMs: number | null): void {
  overrideDateMs = dateMs;
  emit();
}

/** Non-hook read: the resolved planning date, `Date.now()` when unset ("tonight"). */
export function getPlannerDateMs(): number {
  return overrideDateMs ?? Date.now();
}

/** Non-hook read: `true` when the user has chosen a date other than "tonight". */
export function isPlannerDateOverridden(): boolean {
  return overrideDateMs !== null;
}

/** React hook: the resolved planning date (epoch ms); re-renders on `setPlannerDateMs`. */
export function usePlannerDateMs(): number {
  return useSyncExternalStore(subscribe, snapshotResolved, snapshotResolved);
}

/** React hook: whether the current date is a user override (vs the default "tonight"). */
export function useIsPlannerDateOverridden(): boolean {
  return (
    useSyncExternalStore(subscribe, snapshotOverride, snapshotOverride) !== null
  );
}

/** Test-only: reset to "tonight" (avoid cross-test leakage). */
export function __resetPlannerDateForTest(): void {
  overrideDateMs = null;
  lastTonightDayKey = null;
  emit();
}
