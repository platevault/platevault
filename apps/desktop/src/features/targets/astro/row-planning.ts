/**
 * row-planning.ts — per-target planner astronomy derivation (spec 047).
 *
 * Combines a target's catalogued J2000 coordinates with the shared observing
 * night to produce the per-row `RowMoonPlanning` decorations (data-model.md):
 * real lunar separation (US2), and — added by later tasks — filter-band
 * viability + recommendation (US3) and the next opposition date (US4).
 *
 * `night === null` means the site gate is closed (no observing site yet); every
 * derived value is then the explicit unknown state, never a fabricated number.
 */

import type { ObservingNight } from './moon-state';
import { lunarSeparationDeg } from './lunar-separation';

/** Minimal catalogued coordinates a row exposes for planning. */
export interface RowCoords {
  raDeg: number | null;
  decDeg: number | null;
}

/** Per-target planner astronomy (data-model.md §RowMoonPlanning). */
export interface RowMoonPlanning {
  /** Target↔Moon separation (0…180°); `null` = unknown coordinates or no site. */
  lunarSeparationDeg: number | null;
}

/**
 * Derive the per-row planner astronomy for a target under a given night.
 *
 * @param coords - The row's catalogued RA/Dec (either may be `null`).
 * @param night - The shared observing night, or `null` when no site exists.
 */
export function deriveRowMoonPlanning(
  coords: RowCoords,
  night: ObservingNight | null,
): RowMoonPlanning {
  if (!night) return { lunarSeparationDeg: null };
  return {
    lunarSeparationDeg: lunarSeparationDeg(coords.raDeg, coords.decDeg, night.moonVec),
  };
}

/** The explicit unknown planning row (no site / no coordinates). */
export const UNKNOWN_ROW_PLANNING: RowMoonPlanning = { lunarSeparationDeg: null };
