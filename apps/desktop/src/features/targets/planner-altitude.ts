/**
 * planner-altitude.ts — per-row tonight-altitude STUB for the Planner table
 * (tasks #84/#85).
 *
 * STUB (real values arrive with ephemeris + observer location, #58): the list
 * endpoint (`target.list` → TargetListItem) carries NO coordinates — only
 * id/effectiveLabel/primaryDesignation/objectType (see task #57). The detail
 * pane (TargetDetailV2.altitudeCurve) computes an approximate sinusoidal curve
 * from real RA/Dec at a placeholder 52.1°N latitude; rows do not have RA/Dec, so
 * here we derive a DETERMINISTIC pseudo-declination from the designation string
 * and feed it through the same sinusoidal model. This is purely so each row
 * shows a STABLE, plausible-looking max-altitude + sparkline + visible-tonight
 * flag — it is NOT astronomy. Replace the whole module with real ephemeris when
 * #58 lands; until then every value is an approximation tied to a name hash, not
 * to the sky.
 */

import type { TargetListItem } from '@/api/commands';

/** Placeholder observer latitude — mirrors TargetDetailV2.STUB_OBSERVER_LAT_DEG. */
export const STUB_OBSERVER_LAT_DEG = 52.1; // ~Netherlands latitude

/** Minimum altitude (deg) we treat as "usable" for imaging — mirrors the detail graph's ≥30° band. */
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
  /** Hours of the night the target sits above USABLE_ALT_DEG. */
  hoursAboveUsable: number;
  /** True when the target reaches usable altitude at any sample tonight. */
  visibleTonight: boolean;
}

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
 * STUB: compute a deterministic per-row tonight-altitude summary for a list
 * target. Memoization is the caller's job (the table derives this inside a
 * useMemo over the visible rows).
 */
export function rowAltitudeFor(t: TargetListItem): RowAltitude {
  const decDeg = pseudoDecFromDesignation(t.primaryDesignation || t.effectiveLabel || t.id);
  const points = sampleCurve(decDeg);

  let maxAltDeg = -90;
  let aboveSamples = 0;
  for (const p of points) {
    if (p.altDeg > maxAltDeg) maxAltDeg = p.altDeg;
    if (p.altDeg >= USABLE_ALT_DEG) aboveSamples += 1;
  }
  // Each interior sample represents one slice of the night; convert the count of
  // above-threshold samples to an hour estimate.
  const hoursAboveUsable = (aboveSamples / SAMPLES) * NIGHT_HOURS;

  return {
    points,
    maxAltDeg,
    hoursAboveUsable,
    visibleTonight: maxAltDeg >= USABLE_ALT_DEG,
  };
}
