// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * PropertyTable unit tests — spec-030 Q16 (#620, #619), FR-135–FR-138, T131/T134.
 *
 * Verifies PropertyTable's adoption of the shared missing-value renderer:
 * 1. A real 0 renders as "0" with its source badge.
 * 2. A missing applicable value (default applicability) renders the
 *    unresolved chip, never "0", never a source badge.
 * 3. An explicit `applicability: 'not_applicable'` value renders blank,
 *    never the unresolved chip.
 * 4. Source badge is coupled to value presence (FR-138): no badge for a
 *    missing value even when `source` is set.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PropertyTable, type PropertyDef } from './PropertyTable';

describe('PropertyTable — spec-030 Q16 (#620, #619)', () => {
  it('1. real 0 renders as "0" with its source badge', () => {
    const props: PropertyDef[] = [
      { key: 'gain', label: 'Gain', value: 0, source: 'fits' },
    ];
    render(<PropertyTable mode="view" properties={props} showSource />);
    expect(screen.getByText('0')).toBeDefined();
    expect(screen.getByText('FITS')).toBeDefined();
  });

  it('2. missing applicable value renders the unresolved chip, never "0" or a badge', () => {
    const props: PropertyDef[] = [
      { key: 'gain', label: 'Gain', value: null, source: 'fits' },
    ];
    render(<PropertyTable mode="view" properties={props} showSource />);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByTestId('unresolved-chip')).toBeDefined();
    expect(screen.queryByText('FITS')).toBeNull();
  });

  it('3. not-applicable value renders blank, never the unresolved chip', () => {
    const props: PropertyDef[] = [
      {
        key: 'filter',
        label: 'Filter',
        value: null,
        applicability: 'not_applicable',
      },
    ];
    render(<PropertyTable mode="view" properties={props} />);
    expect(screen.queryByTestId('unresolved-chip')).toBeNull();
    expect(screen.getByText('—')).toBeDefined();
  });

  it('4. default applicability (omitted) treats null as unresolved, not blank', () => {
    const props: PropertyDef[] = [
      { key: 'camera', label: 'Camera', value: null },
    ];
    render(<PropertyTable mode="view" properties={props} />);
    expect(screen.getByTestId('unresolved-chip')).toBeDefined();
  });
});
