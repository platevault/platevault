/**
 * planner-altitude.ts — per-row tonight observability for the Planner table +
 * detail pane (spec 044 Track B, T011).
 *
 * Prior versions of this module (tasks #84/#85, mock spec 044 §3) derived a
 * deterministic pseudo-curve from a hash of the target's designation at a
 * fixed placeholder latitude (STUB_OBSERVER_LAT_DEG=52.1). That mock is now
 * replaced with real per-site, per-date computation via `planner-astronomy.ts`
 * (astronomy-engine, offline) + `planner-derive.ts` (cached positions, pure
 * threshold derivation — SC-003).
 *
 * `RowAltitude` gains two degrade flags for the edge cases in T013:
 *   - `needsCoordinates`: the target has no RA/Dec (never resolved / manual
 *     entry without coordinates) — no astronomy is possible.
 *   - `needsSite`: there is no active observing site (US6 no-site state) — no
 *     astronomy is possible until the user adds/activates a site.
 * In either degrade state the row reports zero imaging time / not visible,
 * with NO thrown error (FR-024/SC-011, T013).
 *
 * STILL MOCK (spec 044 §3, out of Track B/US1 scope — real Moon geometry +
 * per-filter moon-free time are US5, Phase 7, T027/T028):
 *   - `MOCK_MOON_PHASE_FRAC` — fake Moon brightness fraction.
 *   - `filtersFor` — simple brightness/distance bracketing rule for filter
 *     recommendation.
 * `lunarDistanceDeg` IS now real (a single-instant `AngleBetween` at transit
 * via `angularSeparationFromMoonDeg`) — only the phase/filter-rule layer on
 * top of it remains mocked.
 */

import type { TargetListItem } from '@/bindings/index';
import { m } from '@/lib/i18n';
import type { ObserverSite } from './observing-sites/observer-site';
import { activeSite } from './observing-sites/site-store';
import { angularSeparationFromMoonDeg } from './planner-astronomy';
import { deriveObservability, getNightObservability } from './planner-derive';

/**
 * Default usable-altitude threshold (degrees above horizon for imaging).
 * Overridable via Settings → Target Planner; callers should prefer the
 * user-configured value from `observing-sites/site-store.ts` (settings-backed,
 * T012b) over this constant.
 */
export const USABLE_ALT_DEG = 30;

// ── Mock filter types (spec 044, NOT astronomy — US5 scope) ────────────────────

/** Compact filter-band identifier. Broadband: L/R/G/B. Narrowband: Ha/OIII/SII. */
export type FilterBand = 'L' | 'R' | 'G' | 'B' | 'Ha' | 'OIII' | 'SII';

/** A mock filter-recommendation result. */
export interface FiltersRecommendation {
  /** Which filter bands are recommended given the mock moon/separation. */
  bands: FilterBand[];
  /**
   * Short label for display (e.g. "Broadband + NB" or "Narrowband only").
   * NOT derived from real astronomy — see spec 044 §5 / US5.
   */
  label: string;
}

/**
 * MOCK module-level Moon phase fraction (0 = new moon, 1 = full moon).
 *
 * Real Moon-phase/illumination is US5 (T027). Fixed deterministic value so
 * every test/render is stable until then.
 *
 * NOT astronomy — mock per spec 044 §3.
 */
export const MOCK_MOON_PHASE_FRAC = 0.55; // ~gibbous — a realistic mid-range value

/** One sampled point of the night's altitude curve. */
export interface AltPoint {
  /** Hours into the night (0 = night start … night end). */
  tHour: number;
  /** Altitude in degrees (−90…+90), refraction-corrected. */
  altDeg: number;
}

/** Summary of a row's tonight visibility, derived from the real ephemeris. */
export interface RowAltitude {
  points: AltPoint[];
  /** Peak altitude across the night (deg). 0 in the degrade states. */
  maxAltDeg: number;
  /**
   * Hours of the (astronomically) dark window the target sits above the
   * caller's usable-altitude threshold (default USABLE_ALT_DEG = 30°;
   * overridable via Settings).
   */
  hoursAboveUsable: number;
  /** True when the target reaches usable altitude at any dark-window sample. */
  visibleTonight: boolean;
  /** Real angular separation from the Moon (0–180°) at transit; null in degrade states. */
  lunarDistanceDeg: number | null;
  /** Mock filter recommendation given mock Moon phase + (now real) lunar distance. */
  filters: FiltersRecommendation;
  /** T013: true when the target has no RA/Dec — no astronomy is possible. */
  needsCoordinates: boolean;
  /** T013/US6: true when there is no active observing site. */
  needsSite: boolean;
}

/**
 * MOCK: derive a recommended filter set from the mock Moon phase and the
 * (real) lunar distance.
 *
 * Rule (placeholder — real model is research §5 of spec 044 / US5):
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

const DEGRADE_ROW: Omit<RowAltitude, 'needsCoordinates' | 'needsSite'> = {
  points: [],
  maxAltDeg: 0,
  hoursAboveUsable: 0,
  visibleTonight: false,
  lunarDistanceDeg: null,
  // Fall back to the permissive (broadband-ok) recommendation when there is no
  // real lunar distance to reason about yet.
  filters: filtersFor(180),
};

/** A minimal shape sufficient to compute tonight observability (T012 fallback reuse). */
export interface AltitudeSubject {
  id: string;
  raDeg: number | null;
  decDeg: number | null;
}

/**
 * Compute the real tonight-altitude summary for a target at a site/date.
 *
 * Degrades cleanly (T013, no throw) when coordinates or a site are missing:
 * returns the zero/not-visible `DEGRADE_ROW` shape with the appropriate
 * `needsCoordinates`/`needsSite` flag set.
 *
 * @param subject - Anything with an id + RA/Dec (a `TargetListItem`, a
 *   `TargetDetailV3`, or a synthesized minimal object).
 * @param usableAltDeg - Altitude threshold for "usable for imaging" in
 *   degrees. Prefer the settings-backed value from `site-store.ts`
 *   (`useUsableAltitude()` / `getUsableAltitude()`) over the USABLE_ALT_DEG
 *   default.
 * @param site - The observer site to compute against. Defaults to the
 *   currently active site (`site-store.ts`); pass `null` explicitly to force
 *   the no-site degrade state.
 * @param dateMs - Any epoch-ms instant on the observing night. Defaults to now.
 */
export function altitudeFor(
  subject: AltitudeSubject,
  usableAltDeg: number = USABLE_ALT_DEG,
  site: ObserverSite | null | undefined = activeSite(),
  dateMs: number = Date.now(),
): RowAltitude {
  const needsCoordinates = subject.raDeg === null || subject.decDeg === null;
  const needsSite = !site;
  if (needsCoordinates || needsSite || subject.raDeg === null || subject.decDeg === null || !site) {
    return { ...DEGRADE_ROW, needsCoordinates, needsSite };
  }

  const night = getNightObservability(subject.id, subject.raDeg, subject.decDeg, site, dateMs);
  const derived = deriveObservability(night, usableAltDeg);
  const points: AltPoint[] = night.samples.map((s) => ({
    tHour: (s.tMs - night.nightStartMs) / 3_600_000,
    altDeg: s.altDeg,
  }));
  const instantMs = night.transit?.tMs ?? dateMs;
  const lunarDistanceDeg = angularSeparationFromMoonDeg(
    subject.raDeg,
    subject.decDeg,
    site,
    instantMs,
  );

  return {
    points,
    maxAltDeg: derived.maxAltDeg,
    hoursAboveUsable: derived.totalImagingMinutes / 60,
    visibleTonight: derived.visibleTonight,
    lunarDistanceDeg,
    filters: filtersFor(lunarDistanceDeg),
    needsCoordinates: false,
    needsSite: false,
  };
}

/**
 * Compute a real per-row tonight-altitude summary for a Planner list target.
 *
 * @param t - The target list item (carries raDeg/decDeg — gen-3 list rows
 *   always populate them per the binding doc comment).
 * @param usableAltDeg - See {@link altitudeFor}.
 * @param site - See {@link altitudeFor}. Defaults to the active site.
 * @param dateMs - See {@link altitudeFor}. Defaults to now ("tonight").
 *
 * Memoization of the underlying positions is `planner-derive.ts`'s job
 * (per target/site/day); this function itself is cheap enough to call inline
 * from render/sort/group code without an extra memo layer.
 */
export function rowAltitudeFor(
  t: TargetListItem,
  usableAltDeg: number = USABLE_ALT_DEG,
  site: ObserverSite | null | undefined = activeSite(),
  dateMs: number = Date.now(),
): RowAltitude {
  return altitudeFor({ id: t.id, raDeg: t.raDeg, decDeg: t.decDeg }, usableAltDeg, site, dateMs);
}
