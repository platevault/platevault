/**
 * altitude-settings.test.ts — unit tests for the usable-altitude localStorage
 * preference (spec 044).
 *
 * Tests the non-hook path (`getAltitudeThreshold` / `setAltitudeThreshold`)
 * since hooks require renderHook + act and these are simpler to keep pure.
 * The localStorage shim in vitest.setup.ts provides storage isolation.
 */

import { beforeEach, describe, it, expect } from 'vitest';
import {
  getAltitudeThreshold,
  setAltitudeThreshold,
  ALTITUDE_THRESHOLD_KEY,
  ALTITUDE_THRESHOLD_MIN,
  ALTITUDE_THRESHOLD_MAX,
} from './altitude-settings';
import { USABLE_ALT_DEG } from './planner-altitude';

beforeEach(() => {
  localStorage.clear();
});

describe('getAltitudeThreshold', () => {
  it('returns the default USABLE_ALT_DEG when nothing is stored', () => {
    expect(getAltitudeThreshold()).toBe(USABLE_ALT_DEG);
  });

  it('returns the stored value after setAltitudeThreshold', () => {
    setAltitudeThreshold(25);
    expect(getAltitudeThreshold()).toBe(25);
  });

  it('returns USABLE_ALT_DEG when stored value is not a number', () => {
    localStorage.setItem(ALTITUDE_THRESHOLD_KEY, 'not-a-number');
    expect(getAltitudeThreshold()).toBe(USABLE_ALT_DEG);
  });
});

describe('setAltitudeThreshold', () => {
  it('clamps values below ALTITUDE_THRESHOLD_MIN to the minimum', () => {
    setAltitudeThreshold(ALTITUDE_THRESHOLD_MIN - 10);
    expect(getAltitudeThreshold()).toBe(ALTITUDE_THRESHOLD_MIN);
  });

  it('clamps values above ALTITUDE_THRESHOLD_MAX to the maximum', () => {
    setAltitudeThreshold(ALTITUDE_THRESHOLD_MAX + 10);
    expect(getAltitudeThreshold()).toBe(ALTITUDE_THRESHOLD_MAX);
  });

  it('rounds fractional degrees to the nearest integer', () => {
    setAltitudeThreshold(27.7);
    expect(getAltitudeThreshold()).toBe(28);
  });

  it('stores the clamped value in localStorage under the correct key', () => {
    setAltitudeThreshold(45);
    expect(localStorage.getItem(ALTITUDE_THRESHOLD_KEY)).toBe('45');
  });

  it('accepts ALTITUDE_THRESHOLD_MIN as a valid boundary', () => {
    setAltitudeThreshold(ALTITUDE_THRESHOLD_MIN);
    expect(getAltitudeThreshold()).toBe(ALTITUDE_THRESHOLD_MIN);
  });

  it('accepts ALTITUDE_THRESHOLD_MAX as a valid boundary', () => {
    setAltitudeThreshold(ALTITUDE_THRESHOLD_MAX);
    expect(getAltitudeThreshold()).toBe(ALTITUDE_THRESHOLD_MAX);
  });
});
