// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * altitude-scale.test.ts — shared scale helper (spec 044 Track B, T035).
 */

import { describe, expect, it } from 'vitest';
import {
  altitudeScale,
  hourScale,
  nightSpan,
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

  // #759: a caller-supplied maxHour drives the domain instead of the fixed
  // 12 h default, so a long winter night's samples spread across the full
  // pixel width rather than flattening past hour 12.
  it('accepts a caller-supplied maxHour beyond the 12h default', () => {
    const scale = hourScale(0, 400, 16.5);
    expect(scale(0)).toBeCloseTo(0, 6);
    expect(scale(16.5)).toBeCloseTo(400, 6);
    // A sample at hour 13 (past the old fixed domain) now lands mid-chart,
    // not clamped onto the rightmost pixel.
    expect(scale(13)).toBeGreaterThan(0);
    expect(scale(13)).toBeLessThan(400);
  });
});

describe('nightSpan', () => {
  it('returns the max tHour across the sampled curve', () => {
    expect(nightSpan([{ tHour: 0 }, { tHour: 9.2 }, { tHour: 16.5 }])).toBe(
      16.5,
    );
  });

  it('falls back to the default 12h domain for an empty curve', () => {
    expect(nightSpan([])).toBe(HOUR_DOMAIN[1]);
  });
});
