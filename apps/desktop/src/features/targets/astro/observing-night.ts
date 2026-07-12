/**
 * observing-night.ts — the "tonight" anchor for the planner (spec 047, plan D1).
 *
 * "Tonight" is the night containing the upcoming or in-progress local midnight,
 * derived from the system clock/timezone. All nightly astronomy (Moon state,
 * per-target separations) is evaluated once, at that local-midnight instant —
 * the Moon moves ~0.5°/h, well inside the ±2° separation tolerance, so a single
 * midnight sample is accurate for the whole session.
 *
 * The night is identified by a stable `nightKey` (the local calendar date of
 * the anchoring midnight, e.g. `2026-07-05`). It is used as the memoization key
 * so values change only when the night rolls over (at the next local noon
 * boundary) — nothing flips at 00:00 mid-session. A lightweight re-check on
 * window focus / hourly tick (see `useObservingNight`) picks up day changes,
 * DST shifts, and clock changes.
 *
 * Pure date math; no astronomy-engine import (that lives in moon-state.ts).
 */

import { useSyncExternalStore } from 'react';

/** The anchoring instant + stable key for one observing night. */
export interface ObservingNightAnchor {
  /** Local calendar date of the anchoring midnight, `YYYY-MM-DD`. */
  nightKey: string;
  /** The upcoming/in-progress local-midnight instant — the evaluation time. */
  midnight: Date;
}

/**
 * The local calendar date (in the machine's own timezone) whose midnight
 * anchors the night containing `now`.
 *
 * Rollover rule (plan D1): the night "belongs" to a calendar date from local
 * noon of the previous day through local noon of that date. Concretely:
 * - Local time before noon (00:00–11:59): still the night that began the
 *   previous evening → anchor midnight is *today's* 00:00 (already passed).
 * - Local time from noon onward (12:00–23:59): the upcoming night → anchor
 *   midnight is *tomorrow's* 00:00.
 *
 * This keeps a single stable anchor across the whole dark window: at 22:00 and
 * again at 02:00 the same `nightKey` is produced, so nothing recomputes when
 * the clock crosses 00:00 during a session.
 */
function anchorDateFor(now: Date): Date {
  const anchor = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  if (now.getHours() >= 12) {
    // Evening/afternoon: the night's midnight is the coming 00:00 (tomorrow).
    anchor.setDate(anchor.getDate() + 1);
  }
  return anchor;
}

/** Format a local `Date` as a `YYYY-MM-DD` key in the machine's timezone. */
export function formatNightKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Compute the observing-night anchor for a given instant (default: now).
 *
 * The returned `midnight` is a local-midnight `Date`; `nightKey` is its local
 * calendar date. Reconstructing from `formatNightKey(midnight)` is stable
 * across a session because DST shifts change the wall-clock offset but not the
 * calendar date of the anchoring midnight.
 */
export function observingNightAnchor(
  now: Date = new Date(),
): ObservingNightAnchor {
  const midnight = anchorDateFor(now);
  return { nightKey: formatNightKey(midnight), midnight };
}

// ── React hook (focus / interval re-check, plan D1) ──────────────────────────

/** Interval (ms) at which the observing night is re-checked (hourly). */
const RECHECK_MS = 60 * 60 * 1000;

/**
 * Subscribe a listener to day-rollover triggers: window focus, visibility
 * change, and an hourly tick. The store snapshot is the current `nightKey`, so
 * `useObservingNight` only re-renders callers when the night actually rolls
 * over (DST shifts, clock changes, and the noon boundary all surface here).
 */
function subscribeNight(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener('focus', handler);
  document.addEventListener('visibilitychange', handler);
  const id = window.setInterval(handler, RECHECK_MS);
  return () => {
    window.removeEventListener('focus', handler);
    document.removeEventListener('visibilitychange', handler);
    window.clearInterval(id);
  };
}

/** Snapshot = the current night key (stable string identity across re-checks). */
function nightKeySnapshot(): string {
  return observingNightAnchor().nightKey;
}

/**
 * React hook: the current observing-night anchor, re-checked on focus /
 * visibility change / hourly. The returned object's identity is stable within
 * a night (memoized by `nightKey`) so downstream per-night astronomy memoizes
 * cleanly and nothing flips at local midnight mid-session.
 */
export function useObservingNight(): ObservingNightAnchor {
  const nightKey = useSyncExternalStore(
    subscribeNight,
    nightKeySnapshot,
    nightKeySnapshot,
  );
  return useMemoNight(nightKey);
}

// Memoize the anchor object per nightKey so consumers get a stable reference.
let lastKey: string | null = null;
let lastAnchor: ObservingNightAnchor | null = null;
function useMemoNight(nightKey: string): ObservingNightAnchor {
  if (nightKey !== lastKey || lastAnchor === null) {
    lastKey = nightKey;
    lastAnchor = observingNightAnchor();
  }
  return lastAnchor;
}
