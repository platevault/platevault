/**
 * planner-astronomy.test.ts — real-ephemeris engine tests (spec 044 Track B, T014).
 *
 * Validates `computeNightObservability` against SC-001 (max-alt/transit/curve
 * internal-consistency, since an offline test has no network access to an
 * independent ephemeris service) and SC-002 (rise/set plausibility to ≈±1 min,
 * circumpolar / never-rising targets return null rise/set with no error).
 *
 * Cross-checks used instead of a live reference ephemeris:
 *   - Transit altitude must equal the sampled-grid maximum to within one grid
 *     step's worth of altitude drift (the exact transit can exceed the nearest
 *     10-min sample, never fall short of it by more than a hair).
 *   - For an object on the celestial equator (dec = 0), the hour angle at
 *     rise/set (ignoring refraction) is exactly ±90° from transit — i.e. almost
 *     exactly 12h between rise and set. Refraction lifts the true horizon
 *     slightly, extending this by a small, bounded amount (a few minutes) — so
 *     `(set - rise)` should be close to 12h, comfortably inside a 10-minute
 *     tolerance band used elsewhere in this file for grid-scale checks.
 *   - Rise must precede transit must precede set (chronological bracketing).
 */

import { describe, expect, it } from 'vitest';
import {
  computeNightObservability,
  angularSeparationFromMoonDeg,
  type AltEvent,
} from './planner-astronomy';
import type { ObserverSite } from './observing-sites/observer-site';

/** Assert-and-narrow: fails the test with a clear message instead of `!`. */
function required<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`expected ${label} to be non-null`);
  return value;
}

const AMSTERDAM: ObserverSite = {
  id: 'site-ams',
  name: 'Amsterdam',
  latitudeDeg: 52.37,
  longitudeDeg: 4.9,
  elevationM: 0,
  timezone: 'Europe/Amsterdam',
  twilight: 'astronomical',
  minHorizonAltDeg: 0,
};

// A fixed winter date so the night is long and well-defined at this latitude.
const WINTER_NIGHT_MS = Date.UTC(2026, 0, 15, 12, 0, 0); // 2026-01-15 noon UTC anchor

describe('computeNightObservability — SC-001 internal consistency', () => {
  it('transit altitude is >= the sampled-grid maximum (grid can only fall short of the true peak)', () => {
    // Equatorial target, well-placed for a mid-northern site.
    const night = computeNightObservability(180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const transit = required<AltEvent>(night.transit, 'transit');
    const sampledMax = Math.max(...night.samples.map((s) => s.altDeg));
    expect(transit.altDeg).toBeGreaterThanOrEqual(sampledMax - 0.01);
    // And the grid should get close to the true transit altitude (10-min grid).
    expect(sampledMax).toBeGreaterThan(transit.altDeg - 2);
  });

  it('rise precedes transit precedes set for a normal (non-circumpolar) target', () => {
    const night = computeNightObservability(180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const rise = required<AltEvent>(night.rise, 'rise');
    const transit = required<AltEvent>(night.transit, 'transit');
    const set = required<AltEvent>(night.set, 'set');
    expect(rise.tMs).toBeLessThan(transit.tMs);
    expect(transit.tMs).toBeLessThan(set.tMs);
  });

  it('altitude at rise and set is ~0 (near the true horizon, refraction applied)', () => {
    const night = computeNightObservability(180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const rise = required<AltEvent>(night.rise, 'rise');
    const set = required<AltEvent>(night.set, 'set');
    expect(Math.abs(rise.altDeg)).toBeLessThan(1);
    expect(Math.abs(set.altDeg)).toBeLessThan(1);
  });
});

describe('computeNightObservability — SC-002 rise/set plausibility', () => {
  it('an equatorial target is above the horizon for ~12h (±10min for refraction)', () => {
    const night = computeNightObservability(180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const rise = required<AltEvent>(night.rise, 'rise');
    const set = required<AltEvent>(night.set, 'set');
    const upMs = set.tMs - rise.tMs;
    const twelveHoursMs = 12 * 3_600_000;
    expect(Math.abs(upMs - twelveHoursMs)).toBeLessThan(10 * 60_000);
  });

  it('a circumpolar target (far north, mid-northern site) has no rise/set and stays visible all night', () => {
    // dec=85 at 52N is circumpolar (dec > 90 - lat).
    const night = computeNightObservability(0, 85, AMSTERDAM, WINTER_NIGHT_MS);
    expect(night.rise).toBeNull();
    expect(night.set).toBeNull();
    // Never drops near the horizon across the sampled night.
    for (const s of night.samples) {
      expect(s.altDeg).toBeGreaterThan(0);
    }
  });

  it('a never-rising target (far south, mid-northern site) has no rise/set and stays below the horizon', () => {
    // dec=-80 at 52N never rises (dec < lat - 90).
    const night = computeNightObservability(0, -80, AMSTERDAM, WINTER_NIGHT_MS);
    expect(night.rise).toBeNull();
    expect(night.set).toBeNull();
    for (const s of night.samples) {
      expect(s.altDeg).toBeLessThan(0);
    }
  });

  it('computing rise/set does not throw for either circumpolar or never-rising targets', () => {
    expect(() => computeNightObservability(0, 85, AMSTERDAM, WINTER_NIGHT_MS)).not.toThrow();
    expect(() => computeNightObservability(0, -80, AMSTERDAM, WINTER_NIGHT_MS)).not.toThrow();
  });
});

describe('computeNightObservability — dark window + grid shape', () => {
  it('produces a 10-minute grid spanning the night', () => {
    const night = computeNightObservability(180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    expect(night.samples.length).toBeGreaterThan(1);
    for (let i = 1; i < night.samples.length; i++) {
      expect(night.samples[i].tMs - night.samples[i - 1].tMs).toBe(10 * 60_000);
    }
    expect(night.samples[0].tMs).toBe(night.nightStartMs);
  });

  it('the astronomical dark window sits inside (or matches) the night span', () => {
    const night = computeNightObservability(180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const darkWindow = required(night.darkWindow, 'darkWindow');
    expect(darkWindow.startMs).toBeGreaterThanOrEqual(night.nightStartMs);
    expect(darkWindow.endMs).toBeLessThanOrEqual(night.nightEndMs);
  });
});

describe('angularSeparationFromMoonDeg', () => {
  it('returns a value in [0, 180] degrees', () => {
    const deg = angularSeparationFromMoonDeg(180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    expect(deg).toBeGreaterThanOrEqual(0);
    expect(deg).toBeLessThanOrEqual(180);
  });

  it('is deterministic for the same inputs', () => {
    const a = angularSeparationFromMoonDeg(45, 20, AMSTERDAM, WINTER_NIGHT_MS);
    const b = angularSeparationFromMoonDeg(45, 20, AMSTERDAM, WINTER_NIGHT_MS);
    expect(a).toBe(b);
  });

  it('differs for targets in different parts of the sky (not a constant stub)', () => {
    const a = angularSeparationFromMoonDeg(0, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const b = angularSeparationFromMoonDeg(180, 60, AMSTERDAM, WINTER_NIGHT_MS);
    expect(a).not.toBe(b);
  });
});
