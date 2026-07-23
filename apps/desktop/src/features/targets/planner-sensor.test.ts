// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * planner-sensor tests (spec 044 iteration 2026-07-15, T046): the equipment →
 * planner SensorConfig derivation. FR-038's guarantee is the load-bearing
 * part: mono, unknown, ambiguous, or empty equipment must yield `null` so the
 * per-filter model stays byte-identical (SC-017 regression).
 */

import { describe, expect, it } from 'vitest';
import type { Camera } from '@/features/settings/settingsIpc';
import { derivePlannerSensorConfig } from './planner-sensor';

function cam(overrides: Partial<Camera>): Camera {
  return {
    id: 'cam-1',
    name: 'Cam',
    aliases: [],
    autoDetected: false,
    sensorType: null,
    passband: null,
    ...overrides,
  };
}

describe('derivePlannerSensorConfig (FR-036/FR-038)', () => {
  it('no cameras / unknown sensor types → null (mono behavior)', () => {
    expect(derivePlannerSensorConfig([])).toBeNull();
    expect(derivePlannerSensorConfig([cam({})])).toBeNull();
  });

  it('any mono camera keeps the per-filter model, even alongside an OSC one', () => {
    expect(derivePlannerSensorConfig([cam({ sensorType: 'mono' })])).toBeNull();
    expect(
      derivePlannerSensorConfig([
        cam({ sensorType: 'mono' }),
        cam({ id: 'cam-2', sensorType: 'osc' }),
      ]),
    ).toBeNull();
  });

  it('unambiguous OSC without a passband → rgb (plain color) config', () => {
    expect(derivePlannerSensorConfig([cam({ sensorType: 'osc' })])).toEqual({
      sensorType: 'osc',
      passband: 'rgb',
    });
  });

  it('OSC narrowband passband carries the band set; unknown band names are dropped', () => {
    expect(
      derivePlannerSensorConfig([
        cam({ sensorType: 'osc', passband: ['Ha', 'OIII', 'bogus'] }),
      ]),
    ).toEqual({ sensorType: 'osc', passband: ['Ha', 'OIII'] });
  });

  it('unknown-sensor cameras alongside an OSC camera do not block the OSC model', () => {
    expect(
      derivePlannerSensorConfig([
        cam({}),
        cam({ id: 'cam-2', sensorType: 'osc', passband: ['Ha', 'OIII'] }),
      ]),
    ).toEqual({ sensorType: 'osc', passband: ['Ha', 'OIII'] });
  });
});
