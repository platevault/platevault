/**
 * altitude-scale.test.ts — shared scale helper (spec 044 Track B, T035).
 */

import { describe, expect, it } from 'vitest';
import {
  altitudeScale,
  hourScale,
  ALT_DOMAIN,
  HOUR_DOMAIN,
} from './altitude-scale';

describe('altitudeScale', () => {
  it('maps the domain endpoints to the given pixel range', () => {
    const scale = altitudeScale(100, 0);
    expect(scale(ALT_DOMAIN[0])).toBeCloseTo(100, 6);
    expect(scale(ALT_DOMAIN[1])).toBeCloseTo(0, 6);
  });

  it('is monotonically decreasing in pixel-y as altitude increases', () => {
    const scale = altitudeScale(100, 0);
    expect(scale(0)).toBeGreaterThan(scale(45));
    expect(scale(45)).toBeGreaterThan(scale(90));
  });

  it('clamps out-of-domain values to the range instead of extrapolating', () => {
    const scale = altitudeScale(100, 0);
    expect(scale(-90)).toBe(100);
    expect(scale(90 + 45)).toBe(0);
  });
});

describe('hourScale', () => {
  it('maps the domain endpoints to the given pixel range', () => {
    const scale = hourScale(0, 400);
    expect(scale(HOUR_DOMAIN[0])).toBeCloseTo(0, 6);
    expect(scale(HOUR_DOMAIN[1])).toBeCloseTo(400, 6);
  });

  it('clamps out-of-domain values', () => {
    const scale = hourScale(0, 400);
    expect(scale(-5)).toBe(0);
    expect(scale(24)).toBe(400);
  });
});
