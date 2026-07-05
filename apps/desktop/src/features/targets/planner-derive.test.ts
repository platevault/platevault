/**
 * planner-derive.test.ts — cache + pure-derivation tests (spec 044 Track B, T014).
 *
 * Validates SC-003 (instant threshold changes do not recompute positions) and
 * the never-visible edge case (T013): a target that never clears the horizon
 * degrades to zero imaging time / not-visible with no error.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearObservabilityCache,
  deriveObservability,
  getNightObservability,
} from './planner-derive';
import type { ObserverSite } from './observing-sites/observer-site';

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

const WINTER_NIGHT_MS = Date.UTC(2026, 0, 15, 12, 0, 0);

beforeEach(() => {
  clearObservabilityCache();
});

describe('getNightObservability — memoization', () => {
  it('returns the SAME cached object for repeated calls with identical (target, site, day)', () => {
    const a = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const b = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    expect(b).toBe(a); // same object reference => positions were not recomputed
  });

  it('recomputes (different object) when the target id changes', () => {
    const a = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const b = getNightObservability('t2', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    expect(b).not.toBe(a);
  });

  it('recomputes when the site changes (different coordinates)', () => {
    const a = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const otherSite: ObserverSite = { ...AMSTERDAM, id: 'site-2', latitudeDeg: 10 };
    const b = getNightObservability('t1', 180, 0, otherSite, WINTER_NIGHT_MS);
    expect(b).not.toBe(a);
  });
});

describe('deriveObservability — SC-003 threshold changes do not recompute positions', () => {
  it('two different usableAltitudeDeg values reuse the same cached NightObservability object', () => {
    const night = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const samplesRefBefore = night.samples;

    const low = deriveObservability(night, 5);
    const high = deriveObservability(night, 60);

    // The night object passed in is never mutated or replaced by derive calls.
    expect(night.samples).toBe(samplesRefBefore);
    // A fresh cache lookup for the same key still returns the identical object,
    // proving no recompute happened as a side effect of deriving twice.
    const cachedAgain = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    expect(cachedAgain).toBe(night);

    // The derived scalars themselves differ (lower threshold => more usable time).
    expect(low.totalImagingMinutes).toBeGreaterThanOrEqual(high.totalImagingMinutes);
  });

  it('maxAltDeg matches the true peak sample and is independent of the threshold', () => {
    const night = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const a = deriveObservability(night, 10);
    const b = deriveObservability(night, 80);
    expect(a.maxAltDeg).toBe(b.maxAltDeg);
    const sampledMax = Math.max(...night.samples.map((s) => s.altDeg));
    expect(a.maxAltDeg).toBeCloseTo(sampledMax, 6);
  });
});

describe('deriveObservability — never-visible edge case (T013)', () => {
  it('a target that never clears the horizon reports not-visible and zero imaging time', () => {
    // dec=-80 at 52N never rises above the horizon.
    const night = getNightObservability('never', 0, -80, AMSTERDAM, WINTER_NIGHT_MS);
    const derived = deriveObservability(night, 30);
    expect(derived.visibleTonight).toBe(false);
    expect(derived.totalImagingMinutes).toBe(0);
    expect(derived.maxAltDeg).toBeLessThan(0);
  });

  it('a threshold of 0 still reports not-visible for a target that never clears the true horizon', () => {
    const night = getNightObservability('never2', 0, -80, AMSTERDAM, WINTER_NIGHT_MS);
    const derived = deriveObservability(night, 0);
    expect(derived.visibleTonight).toBe(false);
    expect(derived.totalImagingMinutes).toBe(0);
  });

  it('a circumpolar target is visible all night at a low threshold', () => {
    const night = getNightObservability('circumpolar', 0, 85, AMSTERDAM, WINTER_NIGHT_MS);
    const derived = deriveObservability(night, 10);
    expect(derived.visibleTonight).toBe(true);
    expect(derived.totalImagingMinutes).toBeGreaterThan(0);
  });
});
