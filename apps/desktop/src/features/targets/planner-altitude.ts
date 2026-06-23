/**
 * planner-altitude.ts — per-row tonight observability MOCK for the Planner
 * table (tasks #84/#85, spec 044).
 *
 * MOCK (real values arrive with ephemeris + observer location, #58/#57): the
 * list endpoint (`target.list` → TargetListItem) carries NO coordinates — only
 * id/effectiveLabel/primaryDesignation/objectType. The detail pane
 * (TargetDetailV2.altitudeCurve) computes an approximate sinusoidal curve from
 * real RA/Dec at a placeholder 52.1°N latitude; rows do not have RA/Dec, so
 * here we derive DETERMINISTIC pseudo-values from the designation string.
 *
 * ALL values in this module are NOT astronomy — they are stable per-designation
 * placeholders so the UI layout, sorting, and filter controls are real and
 * testable while the real computation is deferred. Replace this module with
 * real ephemeris when #58 lands.
 *
 * Spec 044 additions (MOCK per spec 044 §3, NOT astronomy):
 *   - `lunarDistanceDeg` — mock 0–180° angular separation from the Moon, keyed
 *     off a second hash of the designation. Replaces on real Moon ephemeris + #57.
 *   - `mockMoonPhaseFrac` — module-level fake Moon brightness (0=new, 1=full),
 *     deterministic for the current session. Replaces on Moon-phase ephemeris.
 *   - `filtersFor` — simple bracketing rule: bright moon + close target →
 *     narrowband (Ha/OIII/SII); dim/distant → broadband ok (L/R/G/B +
 *     narrowband). Research §5 of spec 044 will replace this with the
 *     Telescopius-based model.
 *   - `rowAltitudeFor` now accepts a configurable `usableAltDeg` threshold
 *     (user setting, default USABLE_ALT_DEG) so imaging-time and visible-tonight
 *     recompute from the Settings → Target Planner control.
 */

import type { TargetListItem } from '@/api/commands';
import { m } from '@/lib/i18n';

/** Placeholder observer latitude — mirrors TargetDetailV2.STUB_OBSERVER_LAT_DEG. */
export const STUB_OBSERVER_LAT_DEG = 52.1; // ~Netherlands latitude

/**
 * Default usable-altitude threshold (degrees above horizon for imaging).
 * Overridable via Settings → Target Planner; callers should prefer the
 * user-configured value from `altitude-settings.ts` over this constant.
 */
export const USABLE_ALT_DEG = 30;

// ── Mock filter types (spec 044, NOT astronomy) ────────────────────────────────

/** Compact filter-band identifier. Broadband: L/R/G/B. Narrowband: Ha/OIII/SII. */
export type FilterBand = 'L' | 'R' | 'G' | 'B' | 'Ha' | 'OIII' | 'SII';

/** A mock filter-recommendation result. */
export interface FiltersRecommendation {
  /** Which filter bands are recommended given the mock moon/separation. */
  bands: FilterBand[];
  /**
   * Short label for display (e.g. "Broadband + NB" or "Narrowband only").
   * NOT derived from real astronomy — see spec 044 §5.
   */
  label: string;
}

/**
 * MOCK module-level Moon phase fraction (0 = new moon, 1 = full moon).
 *
 * In reality this is a nightly calculation tied to real lunar ephemeris.
 * Here we use a fixed deterministic value so every test/render is stable.
 * Replace with real Moon-phase calculation when spec 044 is promoted (#57).
 *
 * NOT astronomy — mock per spec 044 §3.
 */
export const MOCK_MOON_PHASE_FRAC = 0.55; // ~gibbous — a realistic mid-range value

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
  /** Mock angular separation from the Moon (0–180°). NOT astronomy. */
  lunarDistanceDeg: number;
  /** Mock filter recommendation given mock Moon phase + lunar distance. */
  filters: FiltersRecommendation;
}

// ── Mock lunar distance helpers (spec 044, NOT astronomy) ─────────────────────

/**
 * FNV-1a-ish 32-bit hash over a string. Used for several independent mock
 * values from the same designation so they don't correlate with each other.
 * Seed offset lets callers produce independent hash streams from the same input.
 */
function fnv1aHash(s: string, seed = 2166136261): number {
  let h = seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0; // unsigned 32-bit
}

/**
 * MOCK: deterministic angular separation (0–180°) between the target and the
 * Moon, keyed off a secondary hash of the designation.
 *
 * NOT astronomy — mock per spec 044 §3. Replace with real Moon-position
 * ephemeris + angular-separation calc when #57 lands.
 */
export function mockLunarDistanceDegFor(designation: string): number {
  const h = fnv1aHash(designation, 0x811c9dc5 ^ 0xdeadbeef); // second seed
  return (h / 0xffffffff) * 180; // 0…180°
}

/**
 * MOCK: derive a recommended filter set from the mock Moon phase and mock
 * lunar distance.
 *
 * Rule (placeholder — real model is research §5 of spec 044):
 *   - Moon is "bright" when MOCK_MOON_PHASE_FRAC ≥ 0.4
 *   - Target is "close" when lunarDistanceDeg < 60
 *   - Bright moon AND close target → narrowband only (Ha/OIII/SII)
 *   - Otherwise → broadband OK (L/R/G/B + narrowband)
 *
 * NOT astronomy.
 */
export function filtersFor(lunarDistanceDeg: number): FiltersRecommendation {
  const brightMoon = MOCK_MOON_PHASE_FRAC >= 0.4;
  const close = lunarDistanceDeg < 60;
  if (brightMoon && close) {
    return {
      bands: ['Ha', 'OIII', 'SII'],
      label: m.targets_filters_narrowband_only(),
    };
  }
  return {
    bands: ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII'],
    label: m.targets_filters_broadband_nb(),
  };
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

  const lunarDistanceDeg = mockLunarDistanceDegFor(desig);
  const filters = filtersFor(lunarDistanceDeg);

  return {
    points,
    maxAltDeg,
    hoursAboveUsable,
    visibleTonight: maxAltDeg >= usableAltDeg,
    lunarDistanceDeg,
    filters,
  };
}
