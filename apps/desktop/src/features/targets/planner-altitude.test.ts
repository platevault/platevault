/**
 * planner-altitude.test.ts — per-row tonight-altitude PLACEHOLDER (tasks
 * #84/#85, spec 044; Track B boundary per spec 047).
 *
 * The model is a deterministic placeholder (no real ephemeris; Track B/spec
 * 044 owns the real observer-location computation); these tests pin the
 * contract the Planner table relies on: stable per-designation output, a
 * sampled curve, a max altitude, and a usable-visibility flag consistent with
 * the threshold.
 *
 * Spec 047 mock retirement (FR-017, SC-004): the former spec 044 §3 mock
 * `mockLunarDistanceDegFor`/`filtersFor`/`MOCK_MOON_PHASE_FRAC` tests have been
 * REMOVED along with the mocks themselves — real lunar distance and filter
 * guidance are now tested in `astro/row-planning.test.ts` and
 * `astro/moon-avoidance.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { TargetListItem } from '@/bindings/index';
import { rowAltitudeFor, USABLE_ALT_DEG } from './planner-altitude';

function item(primaryDesignation: string, overrides: Partial<TargetListItem> = {}): TargetListItem {
  return {
    id: primaryDesignation,
    effectiveLabel: primaryDesignation,
    primaryDesignation,
    objectType: 'other',
    raDeg: 0,
    decDeg: 0,
    aliases: [],
    ...overrides,
  };
}

describe('planner-altitude (MOCK)', () => {
  it('is deterministic for the same designation', () => {
    const a = rowAltitudeFor(item('NGC 7000'));
    const b = rowAltitudeFor(item('NGC 7000'));
    expect(a.maxAltDeg).toBe(b.maxAltDeg);
    expect(a.visibleTonight).toBe(b.visibleTonight);
    expect(a.points.map((p) => p.altDeg)).toEqual(b.points.map((p) => p.altDeg));
  });

  it('produces different curves for different designations', () => {
    const a = rowAltitudeFor(item('M 31'));
    const b = rowAltitudeFor(item('IC 1396'));
    // Hash-derived pseudo-dec should differ → different peak altitudes.
    expect(a.maxAltDeg).not.toBe(b.maxAltDeg);
  });

  it('samples a non-empty curve and a max altitude that matches the samples', () => {
    const r = rowAltitudeFor(item('M 42'));
    expect(r.points.length).toBeGreaterThan(0);
    const sampledMax = Math.max(...r.points.map((p) => p.altDeg));
    expect(r.maxAltDeg).toBeCloseTo(sampledMax, 6);
  });

  it('visibleTonight agrees with the usable-altitude threshold', () => {
    const r = rowAltitudeFor(item('NGC 891'));
    expect(r.visibleTonight).toBe(r.maxAltDeg >= USABLE_ALT_DEG);
  });

  it('reports hours-above-usable as non-negative and bounded by the night', () => {
    const r = rowAltitudeFor(item('Sh2-155'));
    expect(r.hoursAboveUsable).toBeGreaterThanOrEqual(0);
    expect(r.hoursAboveUsable).toBeLessThanOrEqual(12);
  });

  it('falls back to effectiveLabel/id when primaryDesignation is empty', () => {
    const r = rowAltitudeFor(item('', { id: 'x', effectiveLabel: 'M 13' }));
    expect(Number.isFinite(r.maxAltDeg)).toBe(true);
  });
});

// ── rowAltitudeFor — usableAltDeg param ────────────────────────────────────────

describe('rowAltitudeFor — usableAltDeg threshold', () => {
  it('default threshold equals explicit USABLE_ALT_DEG', () => {
    const t = item('M 42');
    const dflt = rowAltitudeFor(t);
    const expl = rowAltitudeFor(t, USABLE_ALT_DEG);
    expect(dflt.hoursAboveUsable).toBe(expl.hoursAboveUsable);
    expect(dflt.visibleTonight).toBe(expl.visibleTonight);
  });

  it('lower threshold yields same or more imaging time', () => {
    const t = item('NGC 1234');
    const high = rowAltitudeFor(t, 30);
    const low = rowAltitudeFor(t, 5);
    expect(low.hoursAboveUsable).toBeGreaterThanOrEqual(high.hoursAboveUsable);
  });

  it('threshold 0° makes every target visible', () => {
    for (const desig of ['M 31', 'NGC 7000', 'IC 342']) {
      expect(rowAltitudeFor(item(desig), 0).visibleTonight).toBe(true);
    }
  });

  it('threshold 89° makes most targets invisible', () => {
    let hiddenCount = 0;
    for (const desig of ['M 31', 'NGC 7000', 'IC 342', 'Sh2-155', 'M 42']) {
      if (!rowAltitudeFor(item(desig), 89).visibleTonight) hiddenCount++;
    }
    expect(hiddenCount).toBeGreaterThanOrEqual(3);
  });
});
