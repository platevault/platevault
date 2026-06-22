/**
 * planner-altitude.test.ts — per-row tonight-altitude STUB (tasks #84/#85).
 *
 * The model is a deterministic placeholder (no real ephemeris, #58); these tests
 * pin the contract the Planner table relies on: stable per-designation output,
 * a sampled curve, a max altitude, and a usable-visibility flag consistent with
 * the threshold.
 */

import { describe, it, expect } from 'vitest';
import type { TargetListItem } from '@/api/commands';
import { rowAltitudeFor, USABLE_ALT_DEG } from './planner-altitude';

function item(primaryDesignation: string, overrides: Partial<TargetListItem> = {}): TargetListItem {
  return {
    id: primaryDesignation,
    effectiveLabel: primaryDesignation,
    primaryDesignation,
    objectType: 'other',
    ...overrides,
  };
}

describe('planner-altitude (STUB)', () => {
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
