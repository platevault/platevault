// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * RenderValue unit tests — spec-030 Q16 (#620, #619), FR-135–FR-138, T134.
 *
 * Verifies the three modeled value states never collapse into each other:
 * 1. A real 0 renders as "0" plus its source pill (never dropped, never
 *    confused with missing).
 * 2. A missing-but-applicable numeric value renders the unresolved chip —
 *    never "0", never a source pill.
 * 3. A not-applicable value renders blank ("—") — never a chip.
 * 4. Source pills couple to value presence (FR-138): no pill on a missing
 *    value even when a `source` is passed.
 * 5. `valueState` classifies without rendering (pure function contract).
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import {
  renderValue,
  renderValueOnly,
  valueState,
  NOT_APPLICABLE_DISPLAY,
} from './RenderValue';

describe('RenderValue — spec-030 Q16 (#620, #619)', () => {
  it('1. real 0 renders as "0" with its source pill', () => {
    render(
      <div>
        {renderValue(0, { source: 'fits', applicability: 'applicable' })}
      </div>,
    );
    expect(screen.getByText('0')).toBeDefined();
    expect(screen.getByText('FITS')).toBeDefined();
  });

  it('2. missing-but-applicable numeric value renders the unresolved chip, never "0"', () => {
    render(
      <div>
        {renderValue(null, { source: 'fits', applicability: 'applicable' })}
      </div>,
    );
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByTestId('unresolved-chip')).toBeDefined();
    // No source pill on a missing value (FR-138).
    expect(screen.queryByText('FITS')).toBeNull();
  });

  it('3. not-applicable value renders blank ("—") without any chip', () => {
    render(<div>{renderValue(null, { applicability: 'not_applicable' })}</div>);
    expect(screen.queryByTestId('unresolved-chip')).toBeNull();
    expect(screen.getByText(NOT_APPLICABLE_DISPLAY)).toBeDefined();
  });

  it('4. a real value (non-zero) with no source never renders a pill', () => {
    render(
      <div>{renderValue('ASI2600MM', { applicability: 'applicable' })}</div>,
    );
    expect(screen.getByText('ASI2600MM')).toBeDefined();
    expect(screen.queryByText('FITS')).toBeNull();
  });

  it('5. valueState classifies real/unresolved/not_applicable without rendering', () => {
    expect(valueState(0, 'applicable')).toBe('real');
    expect(valueState(false, 'applicable')).toBe('real');
    expect(valueState('', 'applicable')).toBe('real');
    expect(valueState(null, 'applicable')).toBe('unresolved');
    expect(valueState(undefined, 'applicable')).toBe('unresolved');
    // not_applicable wins regardless of value — never inferred from absence.
    expect(valueState(42, 'not_applicable')).toBe('not_applicable');
    expect(valueState(null, 'not_applicable')).toBe('not_applicable');
  });

  it('6. renderValueOnly omits the source pill entirely (value-only slot)', () => {
    render(<div>{renderValueOnly(100, { applicability: 'applicable' })}</div>);
    expect(screen.getByText('100')).toBeDefined();
    expect(screen.queryByText('FITS')).toBeNull();
  });

  it('7. a custom format function applies only to real values', () => {
    render(
      <div>
        {renderValue(300, { applicability: 'applicable' }, (v) => `${v}s`)}
      </div>,
    );
    expect(screen.getByText('300s')).toBeDefined();
  });
});
