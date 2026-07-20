// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { masterLabel } from './master-label';

describe('masterLabel (spec 040 FR-006, issue #754)', () => {
  it('composes type · filter · exposure', () => {
    expect(
      masterLabel({
        masterFrameType: 'flat',
        masterFilter: 'Ha',
        masterExposureS: 120,
      }),
    ).toBe('Master Flat · Ha · 120 s');
  });

  it('labels a dark by type and exposure (FR-006 example)', () => {
    expect(
      masterLabel({
        masterFrameType: 'dark',
        masterFilter: null,
        masterExposureS: 300,
      }),
    ).toBe('Master Dark · 300 s');
  });

  it('labels a flat by type and filter (FR-006 example)', () => {
    expect(
      masterLabel({
        masterFrameType: 'flat',
        masterFilter: 'Ha',
        masterExposureS: null,
      }),
    ).toBe('Master Flat · Ha');
  });

  it('omits qualifiers the extractor could not determine', () => {
    expect(masterLabel({ masterFrameType: 'bias' })).toBe('Master Bias');
  });

  it('degrades to a bare Master rather than fabricating a type', () => {
    expect(masterLabel({ masterFrameType: null })).toBe('Master');
  });

  it('keeps a zero-second exposure — 0 is a value, not a missing field', () => {
    expect(masterLabel({ masterFrameType: 'bias', masterExposureS: 0 })).toBe(
      'Master Bias · 0 s',
    );
  });

  it('rounds a raw FITS exposure float instead of printing it (#811)', () => {
    expect(
      masterLabel({ masterFrameType: 'light', masterExposureS: 6.92447668 }),
    ).toBe('Master Light · 6.9 s');
  });
});
