/**
 * planner-derive.ts — pure derivations over cached night observability (spec 044 US1 T010).
 *
 * Splits the planner's astronomy into two layers so the interactive controls are
 * cheap (SC-003): the expensive positions (`NightObservability`) are computed
 * once per `(target, activeSite, date)` and memoized here; the threshold-
 * dependent scalars (`DerivedObservability`) are re-derived from the cached
 * positions **without** recomputing positions whenever the usable-altitude
 * threshold changes.
 *
 * MVP scope (US1): band-free total imaging time, visible-tonight, max altitude.
 * The three Moon separation scalars and per-band moon-free time are US5 and are
 * added there (importing 047's shared Lorentzian module).
 *
 * Pure functions only — no React, no astronomy-engine import beyond the memoized
 * `computeNightObservability` call.
 */

import {
  GRID_STEP_MINUTES,
  type NightObservability,
  computeNightObservability,
} from './planner-astronomy';
import type { ObserverSite } from './observing-sites/observer-site';

/** Threshold-derived, per-target observability scalars (US1 surface). */
export interface DerivedObservability {
  /** Peak altitude across the night (= transit altitude), degrees. */
  maxAltDeg: number;
  /** True when any dark-window sample reaches the usable altitude (FR-005). */
  visibleTonight: boolean;
  /** Minutes of dark window with altitude ≥ usable (band-free — FR-005). */
  totalImagingMinutes: number;
}

/**
 * Derive the threshold-dependent scalars from cached positions. Pure and cheap —
 * safe to call on every threshold change (SC-003).
 */
export function deriveObservability(
  night: NightObservability,
  usableAltitudeDeg: number,
): DerivedObservability {
  let maxAltDeg = Number.NEGATIVE_INFINITY;
  for (const s of night.samples) {
    if (s.altDeg > maxAltDeg) maxAltDeg = s.altDeg;
  }
  if (!Number.isFinite(maxAltDeg)) maxAltDeg = 0;

  // Imaging time counts only samples inside the dark window that clear the
  // usable altitude. No dark window (high-lat summer) → zero imaging (FR-017).
  let usableSamples = 0;
  let visibleTonight = false;
  const dark = night.darkWindow;
  if (dark) {
    for (const s of night.samples) {
      if (s.tMs < dark.startMs || s.tMs > dark.endMs) continue;
      if (s.altDeg >= usableAltitudeDeg) {
        usableSamples += 1;
        visibleTonight = true;
      }
    }
  }

  return {
    maxAltDeg,
    visibleTonight,
    totalImagingMinutes: usableSamples * GRID_STEP_MINUTES,
  };
}

// ── Position memoization per (target, site, date) ────────────────────────────

interface CacheEntry {
  key: string;
  night: NightObservability;
}

const CACHE_LIMIT = 2000;
const cache = new Map<string, CacheEntry>();

/** The night is keyed by the day of the date, not the exact instant. */
function dayKey(dateMs: number): string {
  return new Date(dateMs).toISOString().slice(0, 10);
}

function siteKey(site: ObserverSite): string {
  // Everything that changes the positions: id + coordinates + horizon/twilight.
  return [
    site.id,
    site.latitudeDeg,
    site.longitudeDeg,
    site.elevationM ?? 'n',
    site.twilight,
    site.minHorizonAltDeg,
  ].join('|');
}

/**
 * Cached night observability for a target at a site/date. Positions are computed
 * once per `(targetId, site, day)`; repeated calls (e.g. threshold drags) reuse
 * the cached result so only `deriveObservability` re-runs (SC-003).
 */
export function getNightObservability(
  targetId: string,
  raDegJ2000: number,
  decDegJ2000: number,
  site: ObserverSite,
  dateMs: number,
): NightObservability {
  const key = `${targetId}@${siteKey(site)}@${dayKey(dateMs)}`;
  const hit = cache.get(key);
  if (hit) return hit.night;

  const night = computeNightObservability(raDegJ2000, decDegJ2000, site, dateMs);
  if (cache.size >= CACHE_LIMIT) {
    // Simple bound: drop the oldest insertion.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { key, night });
  return night;
}

/** Clear the position cache (tests, or when the target catalog changes). */
export function clearObservabilityCache(): void {
  cache.clear();
}
