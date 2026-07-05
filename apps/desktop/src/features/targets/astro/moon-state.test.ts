import { describe, it, expect } from 'vitest';
import {
  moonPhaseName,
  moonAgeFromFullDays,
  moonStateAt,
  computeObservingNight,
  SYNODIC_MONTH_DAYS,
  type MoonPhaseName,
} from './moon-state';

/**
 * Fixture almanac dates (published new/full/quarter instants, spread across
 * 2000–2050). Illumination tolerance ±3 percentage points (SC-001).
 */
interface Fixture {
  iso: string;
  phase: MoonPhaseName;
  illumPct: number; // expected illuminated fraction ×100
  waxing: boolean;
}

const FIXTURES: Fixture[] = [
  { iso: '2000-01-21T04:40:00Z', phase: 'full', illumPct: 100, waxing: false },
  { iso: '2024-01-25T17:54:00Z', phase: 'full', illumPct: 100, waxing: false },
  { iso: '2024-08-04T11:13:00Z', phase: 'new', illumPct: 0, waxing: true },
  { iso: '2016-12-29T06:53:00Z', phase: 'new', illumPct: 0, waxing: true },
  { iso: '2015-06-24T11:03:00Z', phase: 'first-quarter', illumPct: 50, waxing: true },
  { iso: '2015-07-08T20:24:00Z', phase: 'last-quarter', illumPct: 50, waxing: false },
];

describe('moonStateAt — almanac fixtures (SC-001, ±3pp)', () => {
  for (const f of FIXTURES) {
    it(`${f.iso} → ${f.phase}, ~${f.illumPct}% ${f.waxing ? 'waxing' : 'waning'}`, () => {
      const s = moonStateAt(new Date(f.iso));
      expect(s.phaseName).toBe(f.phase);
      expect(s.illuminationFrac * 100).toBeCloseTo(f.illumPct, 0);
      // Within ±3 percentage points explicitly.
      expect(Math.abs(s.illuminationFrac * 100 - f.illumPct)).toBeLessThanOrEqual(3);
      // At the exact new/full instants the elongation sits within ~0.01° of the
      // 0/180/360 boundary, so the waxing/waning flag straddles; only assert
      // direction at the quarters (unambiguous).
      if (f.phase !== 'new' && f.phase !== 'full') expect(s.waxing).toBe(f.waxing);
    });
  }

  it('returns a unit Moon vector', () => {
    const s = moonStateAt(new Date('2024-01-25T17:54:00Z'));
    const len = Math.sqrt(
      s.moonVec.x ** 2 + s.moonVec.y ** 2 + s.moonVec.z ** 2,
    );
    expect(len).toBeCloseTo(1, 6);
  });

  it('extreme-date sanity: 2050 stays in range', () => {
    const s = moonStateAt(new Date('2050-05-01T00:00:00Z'));
    expect(s.illuminationFrac).toBeGreaterThanOrEqual(0);
    expect(s.illuminationFrac).toBeLessThanOrEqual(1);
    expect(s.moonAgeFromFullDays).toBeGreaterThanOrEqual(0);
    expect(s.moonAgeFromFullDays).toBeLessThanOrEqual(SYNODIC_MONTH_DAYS / 2 + 0.01);
  });
});

describe('moonPhaseName', () => {
  it('maps cardinal elongations to phases', () => {
    expect(moonPhaseName(0)).toBe('new');
    expect(moonPhaseName(360)).toBe('new');
    expect(moonPhaseName(90)).toBe('first-quarter');
    expect(moonPhaseName(180)).toBe('full');
    expect(moonPhaseName(270)).toBe('last-quarter');
    expect(moonPhaseName(45)).toBe('waxing-crescent');
    expect(moonPhaseName(135)).toBe('waxing-gibbous');
    expect(moonPhaseName(225)).toBe('waning-gibbous');
    expect(moonPhaseName(315)).toBe('waning-crescent');
  });

  it('normalises out-of-range angles', () => {
    expect(moonPhaseName(-10)).toBe('new');
    expect(moonPhaseName(720 + 180)).toBe('full');
  });
});

describe('moonAgeFromFullDays', () => {
  it('is 0 at full and ~half a synodic month at new', () => {
    expect(moonAgeFromFullDays(180)).toBeCloseTo(0, 6);
    expect(moonAgeFromFullDays(0)).toBeCloseTo(SYNODIC_MONTH_DAYS / 2, 3);
    expect(moonAgeFromFullDays(360)).toBeCloseTo(SYNODIC_MONTH_DAYS / 2, 3);
  });
});

describe('computeObservingNight', () => {
  it('attaches the night identity to the Moon state', () => {
    const anchor = { nightKey: '2024-01-26', midnight: new Date('2024-01-25T17:54:00Z') };
    const on = computeObservingNight(anchor);
    expect(on.nightKey).toBe('2024-01-26');
    expect(on.midnight).toBe(anchor.midnight);
    expect(on.phaseName).toBe('full');
  });
});
