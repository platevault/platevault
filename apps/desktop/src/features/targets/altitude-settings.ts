/**
 * altitude-settings.ts — user-configurable usable-altitude threshold (spec 044).
 *
 * The "usable altitude" is the minimum elevation above the horizon (in degrees)
 * that the user considers acceptable for imaging. It gates the
 * `hoursAboveUsable` and `visibleTonight` columns in the Planner table and the
 * guide line in AltitudeSparkline.
 *
 * Persisted as a UI preference in localStorage under ALTITUDE_THRESHOLD_KEY so
 * the value survives page reloads without a backend round-trip. When the real
 * ephemeris backend (#57/#58) lands the value will be threaded into the real
 * computation unchanged.
 *
 * Default: USABLE_ALT_DEG (30°) from planner-altitude.ts.
 */

import { useSyncExternalStore } from 'react';
import { USABLE_ALT_DEG } from './planner-altitude';

/** localStorage key for the usable altitude threshold setting. */
export const ALTITUDE_THRESHOLD_KEY = 'alm:planner:usableAltDeg';

/** Minimum allowed threshold value (degrees). */
export const ALTITUDE_THRESHOLD_MIN = 0;

/** Maximum allowed threshold value (degrees). */
export const ALTITUDE_THRESHOLD_MAX = 90;

// ── Storage helpers ────────────────────────────────────────────────────────────

/** Read the raw stored value and coerce it to a valid integer degree. */
function readFromStorage(): number {
  try {
    const raw = localStorage.getItem(ALTITUDE_THRESHOLD_KEY);
    if (raw === null) return USABLE_ALT_DEG;
    const n = Number(raw);
    if (!Number.isFinite(n)) return USABLE_ALT_DEG;
    return Math.max(ALTITUDE_THRESHOLD_MIN, Math.min(ALTITUDE_THRESHOLD_MAX, Math.round(n)));
  } catch {
    return USABLE_ALT_DEG;
  }
}

/** Persist a new threshold and notify all subscribers. */
export function setAltitudeThreshold(degrees: number): void {
  const clamped = Math.max(
    ALTITUDE_THRESHOLD_MIN,
    Math.min(ALTITUDE_THRESHOLD_MAX, Math.round(degrees)),
  );
  try {
    localStorage.setItem(ALTITUDE_THRESHOLD_KEY, String(clamped));
  } catch {
    // localStorage unavailable (SSR / tests without shim) — skip persist.
  }
  // Emit a storage event so useSyncExternalStore subscribers update.
  // `storageArea` is omitted: the jsdom Storage shim is not a real `Storage`
  // instance and jsdom rejects StorageEventInit.storageArea that isn't one.
  // Subscribers only check `e.key`, so omitting storageArea is safe.
  try {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: ALTITUDE_THRESHOLD_KEY,
        newValue: String(clamped),
      }),
    );
  } catch {
    // StorageEvent construction failed (non-browser env). Subscribers that
    // registered via window.addEventListener won't be notified, but
    // useSyncExternalStore will re-read on next render regardless.
  }
}

// ── useSyncExternalStore wiring ────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === ALTITUDE_THRESHOLD_KEY || e.key === null) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * React hook: subscribe to the user-configured usable-altitude threshold.
 * Updates automatically when `setAltitudeThreshold` is called from any tab or
 * component.
 */
export function useAltitudeThreshold(): number {
  return useSyncExternalStore(subscribe, readFromStorage, () => USABLE_ALT_DEG);
}

/** Non-hook read for use outside React (e.g., sort comparators, tests). */
export { readFromStorage as getAltitudeThreshold };
