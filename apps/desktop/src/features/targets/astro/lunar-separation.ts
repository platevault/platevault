// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * lunar-separation.ts — target ↔ Moon angular separation (spec 047, plan D3).
 *
 * The target's catalogued J2000 RA/Dec is converted to a unit vector in EQJ
 * (J2000 equatorial) coordinates — the same frame as the geocentric Moon
 * vector from `moon-state.ts` — and the angle between them gives the on-sky
 * separation in degrees (0…180°).
 *
 * Geocentric simplification (≤ ~1° vs topocentric) and same-epoch treatment of
 * both vectors are documented as within the ±2° planning tolerance (SC-002);
 * no precession is applied to a separation angle at this tolerance. Targets
 * with null coordinates return `null` (explicit unknown), never a number.
 */

import type { Vec3 } from './moon-state';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Unit vector for a target at J2000 `raDeg` / `decDeg` in EQJ coordinates.
 *
 * x toward (RA 0h, Dec 0°), y toward (RA 6h, Dec 0°), z toward the north
 * celestial pole — matching astronomy-engine's equatorial `GeoVector` frame.
 */
export function targetUnitVector(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const cosDec = Math.cos(dec);
  return {
    x: cosDec * Math.cos(ra),
    y: cosDec * Math.sin(ra),
    z: Math.sin(dec),
  };
}

/** Angle (deg, 0…180) between two vectors via a numerically-stable dot product. */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const lenA = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
  const lenB = Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z);
  if (lenA === 0 || lenB === 0) return 0;
  // Clamp to [-1, 1] to guard against floating-point overshoot at the extremes.
  const cos = Math.max(-1, Math.min(1, dot / (lenA * lenB)));
  return Math.acos(cos) * RAD2DEG;
}

/**
 * Angular separation (deg) between a target and the Moon.
 *
 * @param raDeg - Target J2000 right ascension in degrees, or `null`.
 * @param decDeg - Target J2000 declination in degrees, or `null`.
 * @param moonVec - Geocentric Moon unit vector (EQJ) from the observing night.
 * @returns Separation in 0…180°, or `null` when either coordinate is missing.
 */
export function lunarSeparationDeg(
  raDeg: number | null | undefined,
  decDeg: number | null | undefined,
  moonVec: Vec3,
): number | null {
  if (raDeg == null || decDeg == null) return null;
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg)) return null;
  return angleBetweenDeg(targetUnitVector(raDeg, decDeg), moonVec);
}
