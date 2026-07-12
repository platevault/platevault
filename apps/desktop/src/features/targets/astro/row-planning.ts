/**
 * row-planning.ts — per-target planner astronomy derivation (spec 047).
 *
 * Combines a target's catalogued J2000 coordinates with the shared observing
 * night to produce the per-row `RowMoonPlanning` decorations (data-model.md):
 * real lunar separation (US2), per-band filter viability + derived
 * recommendation (US3), and the next opposition date (US4).
 *
 * `night === null` means the site gate is closed (no observing site yet); every
 * derived value is then the explicit unknown state, never a fabricated number.
 */

import type { ObservingNight } from './moon-state';
import { lunarSeparationDeg } from './lunar-separation';
import {
  bandViability,
  deriveRecommendation,
  DEFAULT_MOON_AVOIDANCE,
  type Band,
  type MoonAvoidanceParams,
  type Recommendation,
} from './moon-avoidance';
import { nextOpposition } from './opposition';

/** Minimal catalogued coordinates a row exposes for planning. */
export interface RowCoords {
  raDeg: number | null;
  decDeg: number | null;
}

/** Per-target planner astronomy (data-model.md §RowMoonPlanning). */
export interface RowMoonPlanning {
  /** Target↔Moon separation (0…180°); `null` = unknown coordinates or no site. */
  lunarSeparationDeg: number | null;
  /** Per-band viability for tonight; `null` = unknown coordinates or no site. */
  bandViability: Record<Band, boolean> | null;
  /** Derived summary recommendation ('unknown' when `bandViability` is null). */
  recommendation: Recommendation;
  /** Next opposition date (ISO `YYYY-MM-DD`), or `null` = unknown coordinates. */
  nextOppositionDate: string | null;
  /** Whole days from tonight to `nextOppositionDate`; sort key (unknowns last). */
  daysToOpposition: number | null;
}

/**
 * Derive the per-row planner astronomy for a target under a given night.
 *
 * @param coords - The row's catalogued RA/Dec (either may be `null`).
 * @param night - The shared observing night, or `null` when no site exists.
 * @param params - Active per-band Moon-avoidance parameters (Settings →
 *   Target Planner); defaults to the shipped table.
 */
export function deriveRowMoonPlanning(
  coords: RowCoords,
  night: ObservingNight | null,
  params: MoonAvoidanceParams = DEFAULT_MOON_AVOIDANCE,
): RowMoonPlanning {
  if (!night) return { ...UNKNOWN_ROW_PLANNING };

  const separation = lunarSeparationDeg(
    coords.raDeg,
    coords.decDeg,
    night.moonVec,
  );
  const viability =
    separation === null
      ? null
      : bandViability(separation, night.moonAgeFromFullDays, params);
  const recommendation = deriveRecommendation(viability);

  const opposition = nextOpposition(coords.raDeg, night.midnight);

  return {
    lunarSeparationDeg: separation,
    bandViability: viability,
    recommendation,
    nextOppositionDate: opposition
      ? opposition.date.toISOString().slice(0, 10)
      : null,
    daysToOpposition: opposition ? opposition.daysUntil : null,
  };
}

/** The explicit unknown planning row (no site / no coordinates). */
export const UNKNOWN_ROW_PLANNING: RowMoonPlanning = {
  lunarSeparationDeg: null,
  bandViability: null,
  recommendation: 'unknown',
  nextOppositionDate: null,
  daysToOpposition: null,
};
