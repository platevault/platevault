/**
 * planner-astronomy.ts — real per-night observability engine (spec 044 Track B, US1 T009).
 *
 * Replaces the deterministic placeholder astronomy in the planner with a real,
 * per-site, per-date ephemeris computed entirely on the frontend via
 * `astronomy-engine` (MIT, offline, ±1′ — ADR-0001). Given a target's J2000
 * RA/Dec, an `ObserverSite`, and a date, it computes the target's altitude over
 * the night on a fixed 10-minute grid, its exact transit / rise / set, and the
 * site's astronomical/nautical dark window. All computation is offline/local —
 * no network (FR-027).
 *
 * Precession (FR-026): J2000 coordinates are precessed to of-date via
 * `Equator(..., ofdate=true)` before `Horizon()`, so the ~20′ 2000→2026 drift is
 * not dropped the way the old mock did.
 *
 * MVP scope note: Moon geometry (`moonSamples`, `moonUpWindows`, illumination)
 * and the anti-solar best-date belong to US5 / US2 and are added in follow-up
 * lanes; this module intentionally computes only the US1 (altitude/transit/
 * rise-set/dark-window) surface.
 *
 * Pure/offline compute; no React. Memoization is `planner-derive.ts`'s job.
 */

import {
  AngleBetween,
  Body,
  DefineStar,
  Equator,
  Horizon,
  Observer,
  SearchAltitude,
  SearchHourAngle,
  SearchRiseSet,
} from 'astronomy-engine';
import type { ObserverSite } from './observing-sites/observer-site';

/** Fixed grid step across the night (minutes). */
export const GRID_STEP_MINUTES = 10;
const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 3_600_000;

/** Twilight Sun-depression angle for a site's night definition (degrees). */
function twilightDepressionDeg(site: ObserverSite): number {
  return site.twilight === 'nautical' ? -12 : -18;
}

/** One sampled point of the target's altitude/azimuth over the night. */
export interface AltAzSample {
  /** Epoch ms (UTC) of the sample. */
  tMs: number;
  /** Apparent altitude in degrees (refraction applied). */
  altDeg: number;
  /** Azimuth in degrees (0 = north, clockwise). */
  azDeg: number;
}

/** An instant with the target's altitude at that instant. */
export interface AltEvent {
  tMs: number;
  altDeg: number;
}

/** A time window in epoch ms. */
export interface TimeWindow {
  startMs: number;
  endMs: number;
}

/** Per-target, per-site, per-date observability (US1 surface — data-model.md §2). */
export interface NightObservability {
  /** The night span the grid covers (sunset→sunrise, or a fallback window). */
  nightStartMs: number;
  nightEndMs: number;
  /** 10-minute altitude/az grid across the night (FR-001). */
  samples: AltAzSample[];
  /** Exact culmination via `SearchHourAngle(0)` (FR-002); null if not found. */
  transit: AltEvent | null;
  /** Exact rise/set respecting `minHorizonAltDeg` + refraction; null = circumpolar/never-rising (FR-003). */
  rise: AltEvent | null;
  set: AltEvent | null;
  /** Dark window from the site twilight depression; null when no dark exists (FR-017). */
  darkWindow: TimeWindow | null;
}

const REFRACTION = 'normal';
const STAR_DISTANCE_LY = 1000;

/** Build an astronomy-engine observer from a site. */
function observerFor(site: ObserverSite): Observer {
  return new Observer(site.latitudeDeg, site.longitudeDeg, site.elevationM ?? 0);
}

/** Of-date apparent horizontal coordinates of the currently-defined Star1. */
function starHorizonAt(date: Date, observer: Observer): { altDeg: number; azDeg: number } {
  // Precess J2000 → of-date (FR-026), then to horizontal with refraction.
  const eq = Equator(Body.Star1, date, observer, /*ofdate*/ true, /*aberration*/ false);
  const hor = Horizon(date, observer, eq.ra, eq.dec, REFRACTION);
  return { altDeg: hor.altitude, azDeg: hor.azimuth };
}

/**
 * Resolve the night span (sunset→sunrise) bracketing the solar midnight nearest
 * the given date. Falls back to a fixed ±6h window around solar midnight when
 * the Sun does not rise/set (polar day/night) so the grid is never empty.
 */
function nightSpan(observer: Observer, dateMs: number): { startMs: number; endMs: number } {
  const t0 = new Date(dateMs);
  // Solar noon of the day containing `dateMs` (search from 12h before).
  const noon = SearchHourAngle(Body.Sun, observer, 0, new Date(dateMs - 12 * MS_PER_HOUR), +1);
  const sunset = SearchRiseSet(Body.Sun, observer, -1, noon.time.date, 1);
  const sunrise = sunset ? SearchRiseSet(Body.Sun, observer, +1, sunset.date, 1) : null;
  if (sunset && sunrise) {
    return { startMs: sunset.date.getTime(), endMs: sunrise.date.getTime() };
  }
  // Polar fallback: centre a fixed window on solar midnight (lower transit).
  const midnight = SearchHourAngle(Body.Sun, observer, 12, noon.time.date, +1);
  const midMs = midnight.time.date.getTime();
  // Guard against an anchor far from the requested date.
  const anchor = Math.abs(midMs - t0.getTime()) < 36 * MS_PER_HOUR ? midMs : t0.getTime();
  return { startMs: anchor - 6 * MS_PER_HOUR, endMs: anchor + 6 * MS_PER_HOUR };
}

/** Compute the site's dark window (Sun below twilight depression) within the night. */
function darkWindowFor(
  observer: Observer,
  site: ObserverSite,
  nightStartMs: number,
): TimeWindow | null {
  const depression = twilightDepressionDeg(site);
  const dusk = SearchAltitude(Body.Sun, observer, -1, new Date(nightStartMs), 1, depression);
  if (!dusk) return null;
  const dawn = SearchAltitude(Body.Sun, observer, +1, dusk.date, 1, depression);
  if (!dawn) return null;
  return { startMs: dusk.date.getTime(), endMs: dawn.date.getTime() };
}

/**
 * Find the target's rise or set relative to the night, respecting the site's
 * minimum-horizon altitude (SearchAltitude when > 0) or the true horizon with
 * refraction (SearchRiseSet when 0). Returns null for circumpolar / never-rising.
 */
function riseSetFor(
  observer: Observer,
  site: ObserverSite,
  direction: 1 | -1,
  searchStartMs: number,
): AltEvent | null {
  const start = new Date(searchStartMs);
  const event =
    site.minHorizonAltDeg > 0
      ? SearchAltitude(Body.Star1, observer, direction, start, 1, site.minHorizonAltDeg)
      : SearchRiseSet(Body.Star1, observer, direction, start, 1);
  if (!event) return null;
  const { altDeg } = starHorizonAt(event.date, observer);
  return { tMs: event.date.getTime(), altDeg };
}

/**
 * Compute the night's observability for a fixed target at a site and date.
 *
 * @param raDegJ2000 - ICRS/J2000 right ascension in decimal degrees.
 * @param decDegJ2000 - ICRS/J2000 declination in decimal degrees.
 * @param site - The active observing site.
 * @param dateMs - Any epoch-ms instant on the observing day ("tonight" = now).
 */
export function computeNightObservability(
  raDegJ2000: number,
  decDegJ2000: number,
  site: ObserverSite,
  dateMs: number,
): NightObservability {
  const observer = observerFor(site);
  // Define the fixed target as Star1: RA in sidereal hours, Dec in degrees, J2000.
  DefineStar(Body.Star1, raDegJ2000 / 15, decDegJ2000, STAR_DISTANCE_LY);

  const { startMs, endMs } = nightSpan(observer, dateMs);

  // 10-minute altitude/az grid across the night.
  const samples: AltAzSample[] = [];
  const step = GRID_STEP_MINUTES * MS_PER_MIN;
  for (let tMs = startMs; tMs <= endMs; tMs += step) {
    const { altDeg, azDeg } = starHorizonAt(new Date(tMs), observer);
    samples.push({ tMs, altDeg, azDeg });
  }

  // Exact transit nearest the night (search from 1h before night start).
  let transit: AltEvent | null;
  try {
    const event = SearchHourAngle(Body.Star1, observer, 0, new Date(startMs - MS_PER_HOUR), +1);
    transit = { tMs: event.time.date.getTime(), altDeg: event.hor.altitude };
  } catch {
    transit = null;
  }

  // Exact rise/set relative to the night (search from 6h before night start).
  // IMPORTANT: `set` must be searched forward FROM the rise instant, not
  // independently from the same `searchStartMs` — searching both directions
  // from the same anchor can pair a `rise` that starts the pass containing the
  // night with a `set` that is the tail end of the PREVIOUS pass (already
  // above the horizon at `searchStartMs`), producing a `set` that precedes
  // `rise` for periodic sources. Anchoring `set`'s search on `rise` guarantees
  // both bracket the same above-horizon pass.
  const searchStartMs = startMs - 6 * MS_PER_HOUR;
  const rise = riseSetFor(observer, site, +1, searchStartMs);
  const set = riseSetFor(observer, site, -1, rise ? rise.tMs : searchStartMs);

  const darkWindow = darkWindowFor(observer, site, startMs);

  return { nightStartMs: startMs, nightEndMs: endMs, samples, transit, rise, set, darkWindow };
}

/**
 * Real (non-mock) instantaneous angular separation between a fixed J2000
 * target and the Moon, at a single instant.
 *
 * This is deliberately a single-scalar, single-instant helper — the full
 * Moon-geometry surface (illumination fraction, Moon-up windows intersected
 * with the dark window, per-filter-band moon-free time) is US5 (Phase 7,
 * T027/T028) and is NOT implemented here. This only replaces the mock
 * angular-distance placeholder used by the US1 "lunar distance" display
 * value with a real `AngleBetween` computation.
 */
export function angularSeparationFromMoonDeg(
  raDegJ2000: number,
  decDegJ2000: number,
  site: ObserverSite,
  dateMs: number,
): number {
  const observer = observerFor(site);
  const date = new Date(dateMs);
  DefineStar(Body.Star1, raDegJ2000 / 15, decDegJ2000, STAR_DISTANCE_LY);
  const targetEq = Equator(Body.Star1, date, observer, /*ofdate*/ false, /*aberration*/ false);
  const moonEq = Equator(Body.Moon, date, observer, /*ofdate*/ false, /*aberration*/ false);
  return AngleBetween(targetEq.vec, moonEq.vec);
}
