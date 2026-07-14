// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { fieldApplicability } from './field-applicability';

describe('fieldApplicability — spec-030 Q16 (#620) field-applicability matrix', () => {
  it('target is applicable only to light', () => {
    expect(fieldApplicability('light', 'target')).toBe('applicable');
    expect(fieldApplicability('dark', 'target')).toBe('not_applicable');
    expect(fieldApplicability('flat', 'target')).toBe('not_applicable');
    expect(fieldApplicability('bias', 'target')).toBe('not_applicable');
  });

  it('filter is applicable to light/flat only', () => {
    expect(fieldApplicability('light', 'filter')).toBe('applicable');
    expect(fieldApplicability('flat', 'filter')).toBe('applicable');
    expect(fieldApplicability('dark', 'filter')).toBe('not_applicable');
    expect(fieldApplicability('bias', 'filter')).toBe('not_applicable');
  });

  it('exposure is applicable to light/dark/flat, not bias', () => {
    expect(fieldApplicability('light', 'exposure')).toBe('applicable');
    expect(fieldApplicability('dark', 'exposure')).toBe('applicable');
    expect(fieldApplicability('flat', 'exposure')).toBe('applicable');
    expect(fieldApplicability('bias', 'exposure')).toBe('not_applicable');
  });

  it('set-temp is applicable to light/dark, not flat/bias', () => {
    expect(fieldApplicability('light', 'setTemp')).toBe('applicable');
    expect(fieldApplicability('dark', 'setTemp')).toBe('applicable');
    expect(fieldApplicability('flat', 'setTemp')).toBe('not_applicable');
    expect(fieldApplicability('bias', 'setTemp')).toBe('not_applicable');
  });

  it('gain/binning/camera/date/frameType are applicable to every kind', () => {
    for (const kind of ['light', 'dark', 'flat', 'bias']) {
      expect(fieldApplicability(kind, 'gain')).toBe('applicable');
      expect(fieldApplicability(kind, 'binning')).toBe('applicable');
      expect(fieldApplicability(kind, 'camera')).toBe('applicable');
      expect(fieldApplicability(kind, 'date')).toBe('applicable');
      expect(fieldApplicability(kind, 'frameType')).toBe('applicable');
    }
  });

  it('is case-insensitive', () => {
    expect(fieldApplicability('DARK', 'filter')).toBe('not_applicable');
    expect(fieldApplicability('Flat', 'filter')).toBe('applicable');
  });

  it('unknown/absent kind defaults permissive (applicable) — never falsely not-applicable', () => {
    expect(fieldApplicability(null, 'target')).toBe('applicable');
    expect(fieldApplicability(undefined, 'filter')).toBe('applicable');
    expect(fieldApplicability('mixed', 'target')).toBe('applicable');
  });
});
