/**
 * planner-altitude.test.ts — per-row tonight-altitude MOCK (tasks #84/#85,
 * spec 044).
 *
 * The model is a deterministic placeholder (no real ephemeris, #58); these tests
 * pin the contract the Planner table relies on: stable per-designation output,
 * a sampled curve, a max altitude, and a usable-visibility flag consistent with
 * the threshold.
 *
 * Spec 044 additions tested here:
 *  - mockLunarDistanceDegFor: deterministic 0–180°, differs across designations
 *  - filtersFor: bracketing rule (bright+close → NB only; else broadband+NB)
 *  - rowAltitudeFor: lunarDistanceDeg + filters attached; usableAltDeg param
 */

import { describe, it, expect } from 'vitest';
import type { TargetListItem } from '@/api/commands';
import {
  rowAltitudeFor,
  USABLE_ALT_DEG,
  MOCK_MOON_PHASE_FRAC,
  mockLunarDistanceDegFor,
  filtersFor,
} from './planner-altitude';

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

// ── spec 044: mockLunarDistanceDegFor ─────────────────────────────────────────

describe('mockLunarDistanceDegFor (spec 044, NOT astronomy)', () => {
  it('returns a value in [0, 180]', () => {
    const d = mockLunarDistanceDegFor('M 31');
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(180);
  });

  it('is deterministic for the same designation', () => {
    expect(mockLunarDistanceDegFor('NGC 7000')).toBe(mockLunarDistanceDegFor('NGC 7000'));
  });

  it('produces different values for different designations', () => {
    // Near-zero probability of hash collision.
    expect(mockLunarDistanceDegFor('M 31')).not.toBe(mockLunarDistanceDegFor('NGC 224'));
  });

  it('stays in [0, 180] across a spread of inputs', () => {
    for (const d of ['M 1', 'NGC 1234', 'IC 342', 'Sh2-155', 'Barnard 33']) {
      const deg = mockLunarDistanceDegFor(d);
      expect(deg).toBeGreaterThanOrEqual(0);
      expect(deg).toBeLessThanOrEqual(180);
    }
  });
});

// ── spec 044: filtersFor ──────────────────────────────────────────────────────

describe('filtersFor (spec 044, NOT astronomy)', () => {
  // MOCK_MOON_PHASE_FRAC = 0.55 → "bright moon" (≥ 0.4) throughout these tests.

  it('MOCK_MOON_PHASE_FRAC is documented as bright moon (≥ 0.4)', () => {
    // Pin the constant so callers know the mock rule direction.
    expect(MOCK_MOON_PHASE_FRAC).toBeGreaterThanOrEqual(0.4);
  });

  it('recommends narrowband only when target is close (<60°)', () => {
    const result = filtersFor(30);
    expect(result.bands).toEqual(['Ha', 'OIII', 'SII']);
    expect(result.label).toBe('Narrowband only');
  });

  it('recommends broadband+NB when target is far (≥60°)', () => {
    const result = filtersFor(90);
    expect(result.bands).toContain('L');
    expect(result.bands).toContain('Ha');
    expect(result.label).toBe('Broadband + NB');
  });

  it('boundary: distance exactly 60 is not close → broadband+NB', () => {
    // Rule: close = dist < 60; distance === 60 is NOT close.
    expect(filtersFor(60).label).toBe('Broadband + NB');
  });

  it('broadband+NB includes exactly L R G B Ha OIII SII', () => {
    const result = filtersFor(180);
    expect(result.bands).toHaveLength(7);
    for (const b of ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII']) {
      expect(result.bands).toContain(b);
    }
  });
});

// ── spec 044: rowAltitudeFor — new fields and usableAltDeg param ───────────────

describe('rowAltitudeFor — spec 044 fields', () => {
  it('attaches lunarDistanceDeg in [0, 180]', () => {
    const r = rowAltitudeFor(item('M 31'));
    expect(r.lunarDistanceDeg).toBeGreaterThanOrEqual(0);
    expect(r.lunarDistanceDeg).toBeLessThanOrEqual(180);
  });

  it('attaches filters recommendation with at least one band', () => {
    const r = rowAltitudeFor(item('NGC 7000'));
    expect(r.filters.bands.length).toBeGreaterThan(0);
    expect(r.filters.label).toMatch(/Narrowband only|Broadband \+ NB/);
  });

  it('lunarDistanceDeg is deterministic', () => {
    expect(rowAltitudeFor(item('IC 342')).lunarDistanceDeg)
      .toBe(rowAltitudeFor(item('IC 342')).lunarDistanceDeg);
  });

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
