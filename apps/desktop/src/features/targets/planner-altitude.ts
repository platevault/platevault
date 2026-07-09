/**
 * planner-altitude.ts — per-row tonight observability for the Planner table +
 * detail pane (spec 044 Track B, T011).
 *
 * Prior versions of this module (tasks #84/#85, mock spec 044 §3) derived a
 * deterministic pseudo-curve from a hash of the target's designation at a
 * fixed placeholder latitude. That mock is now replaced with real per-site,
 * per-date computation via `planner-astronomy.ts` (astronomy-engine, offline) +
 * `planner-derive.ts` (cached positions, pure threshold derivation — SC-003).
 *
 * `RowAltitude` gains two degrade flags for the edge cases in T013:
 *   - `needsCoordinates`: the target has no RA/Dec (never resolved / manual
 *     entry without coordinates) — no astronomy is possible.
 *   - `needsSite`: there is no active observing site (US6 no-site state) — no
 *     astronomy is possible until the user adds/activates a site.
 * In either degrade state the row reports zero imaging time / not visible,
 * with NO thrown error (FR-024/SC-011, T013).
 *
 * Moon geometry — real lunar distance, per-band filter guidance, and next
 * opposition — is spec 047 Track A and lives in `astro/row-planning.ts`
 * (`RowMoonPlanning`, computed from the shared `ObservingNight` + catalogued
 * RA/Dec), NOT in this module. This module owns tonight altitude / imaging time.
 *
 * US2/US5 (T024/T027-T029): also exposes `bestDate` (FR-009), the three real
 * target↔Moon separation scalars, and per-band moon-free minutes for the
 * chosen `(site, date)` — thin pass-through of `planner-derive.ts`'s
 * `DerivedObservability`, not a second computation.
 */

import type { TargetListItem } from '@/bindings/index';
import type { ObserverSite } from './observing-sites/observer-site';
import { activeSite } from './observing-sites/site-store';
import {
  deriveObservability,
  getNightObservability,
  UNKNOWN_SEPARATION_SCALARS,
  type BestImagingDate,
  type SeparationScalars,
} from './planner-derive';
import { BANDS, DEFAULT_MOON_AVOIDANCE, type Band, type MoonAvoidanceParams } from './astro/moon-avoidance';

/**
 * Default usable-altitude threshold (degrees above horizon for imaging).
 * Overridable via Settings → Target Planner; callers should prefer the
 * user-configured value from `observing-sites/site-store.ts` (settings-backed,
 * T012b) over this constant.
 */
export const USABLE_ALT_DEG = 30;

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
  /** T013: true when the target has no RA/Dec — no astronomy is possible. */
  needsCoordinates: boolean;
  /** T013/US6: true when there is no active observing site. */
  needsSite: boolean;
  /** Date the target transits at local midnight (US2, FR-009); `null` = unknown coordinates. */
  bestDate: BestImagingDate | null;
  /** Three real target↔Moon separation reference figures (US5, FR-020). */
  separationScalars: SeparationScalars;
  /** Per-band moon-free imaging minutes for the chosen night (US5, FR-022). */
  moonFreeMinutesByBand: Record<Band, number>;
  /**
   * US4/T033: true when the site/date has no qualifying dark window under the
   * chosen twilight (e.g. high-latitude summer) — total/per-band imaging time
   * is correctly zero, but the UI MUST disclose the reason rather than
   * implying the target is simply too low (FR-017). Always `false` in the
   * degrade states (no astronomy is attempted there at all).
   */
  noDarkWindow: boolean;
  /**
   * The dark window's `[startHour, endHour]` on the SAME `tHour` axis as
   * `points` (T035: lets the detail-pane graph shade twilight vs dark);
   * `null` when there is no dark window (`noDarkWindow`) or in the degrade
   * states.
   */
  darkWindowHours: { startHour: number; endHour: number } | null;
}

const ZERO_BY_BAND: Record<Band, number> = Object.fromEntries(BANDS.map((b) => [b, 0])) as Record<
  Band,
  number
>;

const DEGRADE_ROW: Omit<RowAltitude, 'needsCoordinates' | 'needsSite'> = {
  points: [],
  maxAltDeg: 0,
  hoursAboveUsable: 0,
  visibleTonight: false,
  bestDate: null,
  separationScalars: UNKNOWN_SEPARATION_SCALARS,
  moonFreeMinutesByBand: ZERO_BY_BAND,
  noDarkWindow: false,
  darkWindowHours: null,
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
 * @param dateMs - Any epoch-ms instant on the observing night. Defaults to now
 *   ("tonight"); pass the Planner's chosen date (`planner-date-store.ts`,
 *   US2/T024) to plan an arbitrary future night.
 * @param moonAvoidanceParams - Active per-band Moon-avoidance parameters
 *   (Track A, Settings → Target Planner) for `moonFreeMinutesByBand` (US5).
 *   Defaults to the shipped table; prefer `useGuidanceParams()` from the host
 *   page so a live settings edit recomputes moon-free hours (SC-008).
 */
export function altitudeFor(
  subject: AltitudeSubject,
  usableAltDeg: number = USABLE_ALT_DEG,
  site: ObserverSite | null | undefined = activeSite(),
  dateMs: number = Date.now(),
  moonAvoidanceParams: MoonAvoidanceParams = DEFAULT_MOON_AVOIDANCE,
): RowAltitude {
  const needsCoordinates = subject.raDeg === null || subject.decDeg === null;
  const needsSite = !site;
  if (needsCoordinates || needsSite || subject.raDeg === null || subject.decDeg === null || !site) {
    return { ...DEGRADE_ROW, needsCoordinates, needsSite };
  }

  const night = getNightObservability(subject.id, subject.raDeg, subject.decDeg, site, dateMs);
  const derived = deriveObservability(night, usableAltDeg, {
    raDegJ2000: subject.raDeg,
    minHorizonAltDeg: site.minHorizonAltDeg,
    moonAvoidanceParams,
    bestDateFromMs: dateMs,
  });
  const points: AltPoint[] = night.samples.map((s) => ({
    tHour: (s.tMs - night.nightStartMs) / 3_600_000,
    altDeg: s.altDeg,
  }));
  return {
    points,
    maxAltDeg: derived.maxAltDeg,
    hoursAboveUsable: derived.totalImagingMinutes / 60,
    visibleTonight: derived.visibleTonight,
    needsCoordinates: false,
    needsSite: false,
    bestDate: derived.bestDate,
    separationScalars: derived.separationScalars,
    moonFreeMinutesByBand: derived.moonFreeMinutesByBand,
    noDarkWindow: night.darkWindow === null,
    darkWindowHours: night.darkWindow
      ? {
          startHour: (night.darkWindow.startMs - night.nightStartMs) / 3_600_000,
          endHour: (night.darkWindow.endMs - night.nightStartMs) / 3_600_000,
        }
      : null,
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
 * @param moonAvoidanceParams - See {@link altitudeFor}.
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
  moonAvoidanceParams: MoonAvoidanceParams = DEFAULT_MOON_AVOIDANCE,
): RowAltitude {
  return altitudeFor(
    { id: t.id, raDeg: t.raDeg, decDeg: t.decDeg },
    usableAltDeg,
    site,
    dateMs,
    moonAvoidanceParams,
  );
}
