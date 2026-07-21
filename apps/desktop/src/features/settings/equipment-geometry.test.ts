// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sensor-geometry parsing and field-of-view rendering (migration 0079).
 *
 * The load-bearing distinction is absent vs invalid vs zero: absent geometry
 * must persist as null and render as "not known", never as a fabricated 0°.
 */

import { describe, expect, it } from 'vitest';
import { fovSummary, parseGeometry } from './equipment-helpers';
import { m } from '@/lib/i18n';

describe('parseGeometry', () => {
  it('treats a blank field as absent, not as zero', () => {
    expect(parseGeometry('', false)).toEqual({ kind: 'absent' });
    expect(parseGeometry('   ', false)).toEqual({ kind: 'absent' });
  });

  it('accepts a positive decimal pixel size', () => {
    expect(parseGeometry('3.76', false)).toEqual({
      kind: 'valid',
      value: 3.76,
    });
  });

  it('rounds pixel counts to whole pixels', () => {
    expect(parseGeometry('6248.4', true)).toEqual({
      kind: 'valid',
      value: 6248,
    });
  });

  it('rejects zero and negative values rather than passing them through', () => {
    for (const input of ['0', '-1', '-3.76', '0.0']) {
      expect(parseGeometry(input, false)).toEqual({ kind: 'invalid' });
    }
  });

  it('rejects non-numeric text', () => {
    for (const input of ['abc', '3.7.6', 'NaN', 'Infinity']) {
      expect(parseGeometry(input, false)).toEqual({ kind: 'invalid' });
    }
  });
});

describe('fovSummary', () => {
  it('renders a known field of view in degrees', () => {
    expect(fovSummary(3.054)).toBe(
      m.settings_equipment_fov_value({ degrees: '3.05' }),
    );
  });

  it('renders absent geometry as "not known", never as 0°', () => {
    const absent = m.settings_equipment_fov_unknown();
    expect(fovSummary(null)).toBe(absent);
    expect(fovSummary(undefined)).toBe(absent);
    expect(fovSummary(null)).not.toContain('0');
  });

  it('still renders a genuine zero distinctly from absent', () => {
    // Defensive: the backend never emits 0, but if it ever did, that must not
    // be silently reinterpreted as "not known".
    expect(fovSummary(0)).not.toBe(m.settings_equipment_fov_unknown());
  });
});
