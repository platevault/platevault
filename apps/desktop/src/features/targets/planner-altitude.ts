/**
 * planner-altitude.ts — per-row tonight observability PLACEHOLDER for the
 * Planner table (tasks #84/#85, spec 044; Track B per spec 047 boundary).
 *
 * Track B placeholder (real values arrive with ephemeris + observer location,
 * spec 044/048): the list endpoint (`target.list` → TargetListItem) carries NO
 * coordinates — only id/effectiveLabel/primaryDesignation/objectType. The
 * detail pane (TargetDetailV2.altitudeCurve) computes an approximate
 * sinusoidal curve from real RA/Dec at a placeholder 52.1°N latitude; rows do
 * not have RA/Dec, so here we derive DETERMINISTIC pseudo-values from the
 * designation string.
 *
 * ALL altitude/imaging-time values in this module are NOT astronomy — they
 * are stable per-designation placeholders so the UI layout, sorting, and
 * threshold controls are real and testable while the real observer-location
 * computation is deferred to Track B (spec 044). Per spec 047 FR-015/016,
 * Track A MUST NOT alter this module's semantics.
 *
 * Spec 047 mock retirement (FR-017, SC-004): the former spec 044 §3 mock
 * `lunarDistanceDeg`/`mockMoonPhaseFrac`/`filtersFor` (Moon/filter placeholders
 * hash-derived from the designation string) have been REMOVED. Real lunar
 * distance, filter guidance, and opposition now live in `astro/row-planning.ts`
 * (`RowMoonPlanning`, computed from the shared `ObservingNight` + catalogued
 * RA/Dec), not in this module.
 *
 * `rowAltitudeFor` accepts a configurable `usableAltDeg` threshold (user
 * setting, default USABLE_ALT_DEG) so imaging-time and visible-tonight
 * recompute from the Settings → Target Planner control.
 */

import type { TargetListItem } from '@/bindings/index';

/** Placeholder observer latitude — mirrors TargetDetailV2.STUB_OBSERVER_LAT_DEG. */
export const STUB_OBSERVER_LAT_DEG = 52.1; // ~Netherlands latitude

/**
 * Default usable-altitude threshold (degrees above horizon for imaging).
 * Overridable via Settings → Target Planner; callers should prefer the
 * user-configured value from `altitude-settings.ts` over this constant.
 */
export const USABLE_ALT_DEG = 30;

/** One sampled point of the night's altitude curve. */
export interface AltPoint {
  /** Hours into the night (0 = 18:00 local … 12 = 06:00 next day). */
  tHour: number;
  /** Approximate altitude in degrees (−90…+90). */
  altDeg: number;
}

/** Summary of a row's tonight visibility, derived from the sampled curve. */
export interface RowAltitude {
  points: AltPoint[];
  /** Peak altitude across the night (deg). */
  maxAltDeg: number;
  /**
   * Hours of the night the target sits above the caller's usable-altitude
   * threshold (default USABLE_ALT_DEG = 30°; overridable via Settings).
   */
  hoursAboveUsable: number;
  /** True when the target reaches usable altitude at any sample tonight. */
  visibleTonight: boolean;
}

// ── Core altitude sampling (unchanged model) ───────────────────────────────────

/**
 * STUB hash: fold the designation into a stable pseudo-declination in roughly
 * the −30…+85° range. Deterministic so the same target always renders the same
 * curve across renders/sorts. (FNV-1a-ish; collisions are irrelevant here.)
 */
function pseudoDecFromDesignation(designation: string): number {
  let h = 2166136261;
  for (let i = 0; i < designation.length; i++) {
    h ^= designation.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Map the unsigned 32-bit hash into −30…+85° (a band that gives a mix of
  // never-visible, marginal, and high-transit targets at 52.1°N).
  const frac = (h >>> 0) / 0xffffffff;
  return -30 + frac * 115;
}

const SAMPLES = 36; // every 20 min across a ~12 h night
const NIGHT_HOURS = 12;

/**
 * Sample the approximate altitude curve for a pseudo-declination at the
 * placeholder latitude. Same sinusoidal model as TargetDetailV2.altitudeCurve,
 * assuming the target transits near local midnight.
 */
function sampleCurve(decDeg: number): AltPoint[] {
  const latRad = (STUB_OBSERVER_LAT_DEG * Math.PI) / 180;
  const decRad = (decDeg * Math.PI) / 180;
  const points: AltPoint[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const tHour = i * (NIGHT_HOURS / SAMPLES); // 0..12 into the night
    const localHour = 18 + tHour; // 18:00 → 06:00
    const haDeg = (localHour - 24) * 15; // hours from midnight transit → degrees
    const haRad = (haDeg * Math.PI) / 180;
    const sinAlt =
      Math.sin(latRad) * Math.sin(decRad) +
      Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
    const altDeg = (Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180) / Math.PI;
    points.push({ tHour, altDeg });
  }
  return points;
}

/**
 * Compute a deterministic per-row tonight-altitude summary for a list target.
 *
 * @param t - The target list item.
 * @param usableAltDeg - Altitude threshold for "usable for imaging" in degrees.
 *   Defaults to USABLE_ALT_DEG (30°). Pass the user-configured value from
 *   `altitude-settings.ts` so that `hoursAboveUsable` and `visibleTonight`
 *   reflect the user's preference.
 *
 * Memoization is the caller's job (the table derives this inside a useMemo
 * over the visible rows).
 */
export function rowAltitudeFor(
  t: TargetListItem,
  usableAltDeg: number = USABLE_ALT_DEG,
): RowAltitude {
  const desig = t.primaryDesignation || t.effectiveLabel || t.id;
  const decDeg = pseudoDecFromDesignation(desig);
  const points = sampleCurve(decDeg);

  let maxAltDeg = -90;
  let aboveSamples = 0;
  for (const p of points) {
    if (p.altDeg > maxAltDeg) maxAltDeg = p.altDeg;
    if (p.altDeg >= usableAltDeg) aboveSamples += 1;
  }
  // Each interior sample represents one slice of the night; convert the count of
  // above-threshold samples to an hour estimate.
  const hoursAboveUsable = (aboveSamples / SAMPLES) * NIGHT_HOURS;

  return {
    points,
    maxAltDeg,
    hoursAboveUsable,
    visibleTonight: maxAltDeg >= usableAltDeg,
  };
}
