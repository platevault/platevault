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
import { BANDS, DEFAULT_MOON_AVOIDANCE } from './astro/moon-avoidance';
import { __resetOppositionCacheForTest } from './astro/opposition';

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
  __resetOppositionCacheForTest();
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

describe('deriveObservability — US5 separation scalars (T028, SC-009)', () => {
  it('all three scalars are either a finite [0,180] degree figure or "moon-not-up"', () => {
    const night = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const derived = deriveObservability(night, 30);
    for (const figure of Object.values(derived.separationScalars)) {
      if (figure === 'moon-not-up') continue;
      expect(figure).toBeGreaterThanOrEqual(0);
      expect(figure).toBeLessThanOrEqual(180);
    }
  });

  it('minOverDarkDeg never exceeds atDarkMidpointDeg when both are numeric (min ≤ any point)', () => {
    const night = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const derived = deriveObservability(night, 30);
    const { minOverDarkDeg, atDarkMidpointDeg } = derived.separationScalars;
    if (minOverDarkDeg !== 'moon-not-up' && atDarkMidpointDeg !== 'moon-not-up') {
      expect(minOverDarkDeg).toBeLessThanOrEqual(atDarkMidpointDeg + 1e-6);
    }
  });

  it('raising minHorizonAltDeg can only turn a numeric figure into "moon-not-up", never the reverse', () => {
    const night = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const low = deriveObservability(night, 30, { minHorizonAltDeg: 0 });
    const high = deriveObservability(night, 30, { minHorizonAltDeg: 89 });
    if (low.separationScalars.atDarkMidpointDeg === 'moon-not-up') {
      expect(high.separationScalars.atDarkMidpointDeg).toBe('moon-not-up');
    }
  });
});

describe('deriveObservability — US5 per-band moon-free minutes (T028, SC-010)', () => {
  it('every band is within [0, totalImagingMinutes]', () => {
    const night = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const derived = deriveObservability(night, 30, { moonAvoidanceParams: DEFAULT_MOON_AVOIDANCE });
    for (const band of BANDS) {
      expect(derived.moonFreeMinutesByBand[band]).toBeGreaterThanOrEqual(0);
      expect(derived.moonFreeMinutesByBand[band]).toBeLessThanOrEqual(derived.totalImagingMinutes);
    }
  });

  it('a more Moon-tolerant band never reports less moon-free time than a stricter band (SC-010)', () => {
    const night = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const derived = deriveObservability(night, 30, { moonAvoidanceParams: DEFAULT_MOON_AVOIDANCE });
    // Ha (60°/7d) is strictly more tolerant than L (120°/14d) at every Moon age
    // (smaller required distance AND narrower width) — Ha must never trail L.
    expect(derived.moonFreeMinutesByBand.Ha).toBeGreaterThanOrEqual(derived.moonFreeMinutesByBand.L);
  });

  it('no dark window => every band is zero (FR-017, no fabrication)', () => {
    const highLat: ObserverSite = { ...AMSTERDAM, latitudeDeg: 69.6, longitudeDeg: 18.9 };
    const summerMs = Date.UTC(2026, 5, 21, 12, 0, 0);
    const night = getNightObservability('t-summer', 180, 0, highLat, summerMs);
    expect(night.darkWindow).toBeNull();
    const derived = deriveObservability(night, 30);
    for (const band of BANDS) {
      expect(derived.moonFreeMinutesByBand[band]).toBe(0);
    }
  });

  it('includeMoonGeometry=false (CI perf FIX fast path) degrades to zero, never fabricating full imaging time', () => {
    // A naive "no moonSamples => treat as no interference" reading would make
    // every band equal totalImagingMinutes here (there IS a dark window and
    // imaging time) — that would be a fabricated non-zero value for data that
    // was never computed. Must be honestly zero instead.
    const night = getNightObservability('t-fast', 180, 0, AMSTERDAM, WINTER_NIGHT_MS, false);
    expect(night.moonSamples).toEqual([]);
    const derived = deriveObservability(night, 30, { moonAvoidanceParams: DEFAULT_MOON_AVOIDANCE });
    expect(derived.totalImagingMinutes).toBeGreaterThan(0);
    for (const band of BANDS) {
      expect(derived.moonFreeMinutesByBand[band]).toBe(0);
    }
    expect(derived.separationScalars.atTransitDeg).toBe('moon-not-up');
    expect(derived.separationScalars.minOverDarkDeg).toBe('moon-not-up');
    expect(derived.separationScalars.atDarkMidpointDeg).toBe('moon-not-up');
  });
});

describe('deriveObservability — US2 bestDate (T025, FR-009)', () => {
  it('is null for unknown coordinates', () => {
    const night = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const derived = deriveObservability(night, 30, { raDegJ2000: null });
    expect(derived.bestDate).toBeNull();
  });

  it('is a real future-or-present date with a non-negative days-until for known coordinates', () => {
    const night = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const derived = deriveObservability(night, 30, { raDegJ2000: 180, bestDateFromMs: WINTER_NIGHT_MS });
    expect(derived.bestDate).not.toBeNull();
    expect(derived.bestDate?.inDays).toBeGreaterThanOrEqual(0);
    expect(derived.bestDate?.dateMs).toBeGreaterThanOrEqual(WINTER_NIGHT_MS);
  });

  it('a later anchor within the same cycle reduces the best-date days-until (US2/SC-004)', () => {
    const night = getNightObservability('t1', 180, 0, AMSTERDAM, WINTER_NIGHT_MS);
    const fromWinter = deriveObservability(night, 30, { raDegJ2000: 180, bestDateFromMs: WINTER_NIGHT_MS });
    // 10 days later, still well short of the ~60-day-out best date found above —
    // moving the anchor forward within the same cycle must shrink days-until by
    // the same 10 days (same absolute best-date calendar day).
    const laterMs = WINTER_NIGHT_MS + 10 * 86_400_000;
    const fromLater = deriveObservability(night, 30, { raDegJ2000: 180, bestDateFromMs: laterMs });
    expect(fromLater.bestDate?.dateMs).toBe(fromWinter.bestDate?.dateMs);
    expect(fromLater.bestDate?.inDays).toBeLessThan(fromWinter.bestDate?.inDays ?? -Infinity);
  });
});
