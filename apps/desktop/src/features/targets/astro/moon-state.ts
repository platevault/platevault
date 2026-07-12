/**
 * moon-state.ts — nightly Moon state via astronomy-engine (spec 047, plan D2).
 *
 * Real lunar ephemeris for the planner: 8-phase name, waxing/waning direction,
 * illuminated fraction, Moon age (days from full — the Lorentzian input), and
 * the geocentric Moon unit vector (EQJ / J2000 equatorial, same frame as the
 * catalogued target RA/Dec) used for per-target separation.
 *
 * Everything is evaluated once at the observing-night midnight instant (plan
 * D1). astronomy-engine accuracy (±1 arcmin class) vastly exceeds the planning
 * tolerances (±3 pp illumination, ±2° separation).
 */

import { Body, Illumination, MoonPhase, GeoVector } from 'astronomy-engine';
import type { ObservingNightAnchor } from './observing-night';

/** Synodic month length in days (full → next full). */
export const SYNODIC_MONTH_DAYS = 29.530588;

/** The eight canonical Moon phases (i18n-rendered by the UI, never shown raw). */
export type MoonPhaseName =
  | 'new'
  | 'waxing-crescent'
  | 'first-quarter'
  | 'waxing-gibbous'
  | 'full'
  | 'waning-gibbous'
  | 'last-quarter'
  | 'waning-crescent';

/** A 3-vector (unit or otherwise) in EQJ (J2000 equatorial) coordinates. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Full nightly Moon state + the anchoring night identity (data-model.md). */
export interface ObservingNight {
  /** Local calendar date of the anchoring midnight, `YYYY-MM-DD`. */
  nightKey: string;
  /** The evaluation instant (upcoming/in-progress local midnight). */
  midnight: Date;
  /** 8-phase name. */
  phaseName: MoonPhaseName;
  /** True while the Moon is waxing (elongation < 180°). */
  waxing: boolean;
  /** Illuminated fraction of the lunar disk, 0…1. */
  illuminationFrac: number;
  /** Days from full Moon (0 = full … ~14.77 = new) — the Lorentzian input. */
  moonAgeFromFullDays: number;
  /** Geocentric Moon direction, unit vector in EQJ. */
  moonVec: Vec3;
}

/**
 * Map a lunar elongation angle (0° = new, 180° = full, 360° = new) to its
 * canonical 8-phase name. Each phase spans 45°, centred on its cardinal angle.
 */
export function moonPhaseName(elongationDeg: number): MoonPhaseName {
  // Normalise to [0, 360).
  const a = ((elongationDeg % 360) + 360) % 360;
  if (a < 22.5 || a >= 337.5) return 'new';
  if (a < 67.5) return 'waxing-crescent';
  if (a < 112.5) return 'first-quarter';
  if (a < 157.5) return 'waxing-gibbous';
  if (a < 202.5) return 'full';
  if (a < 247.5) return 'waning-gibbous';
  if (a < 292.5) return 'last-quarter';
  return 'waning-crescent';
}

/** Days from full Moon for a given elongation angle (0…SYNODIC_MONTH/2). */
export function moonAgeFromFullDays(elongationDeg: number): number {
  const a = ((elongationDeg % 360) + 360) % 360;
  return (Math.abs(a - 180) / 360) * SYNODIC_MONTH_DAYS;
}

/** Normalise a 3-vector to unit length (returns the input direction). */
function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Compute the full nightly Moon state at a given instant.
 *
 * @param at - The evaluation instant (the observing-night midnight).
 * @returns Phase name, waxing flag, illumination, Moon age, and unit vector.
 */
export function moonStateAt(
  at: Date,
): Omit<ObservingNight, 'nightKey' | 'midnight'> {
  const elongationDeg = MoonPhase(at); // 0 = new, 180 = full
  const illum = Illumination(Body.Moon, at);
  const geo = GeoVector(Body.Moon, at, true); // EQJ, aberration-corrected
  return {
    phaseName: moonPhaseName(elongationDeg),
    waxing: elongationDeg < 180,
    illuminationFrac: illum.phase_fraction,
    moonAgeFromFullDays: moonAgeFromFullDays(elongationDeg),
    moonVec: normalize({ x: geo.x, y: geo.y, z: geo.z }),
  };
}

/**
 * Compose an {@link ObservingNight} from a night anchor: evaluates the Moon
 * state at the anchor's midnight instant and attaches the night identity.
 */
export function computeObservingNight(
  anchor: ObservingNightAnchor,
): ObservingNight {
  return {
    nightKey: anchor.nightKey,
    midnight: anchor.midnight,
    ...moonStateAt(anchor.midnight),
  };
}
