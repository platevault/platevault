// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * General.test.tsx — #587 (Settings Appearance: density and font-size
 * controls have no visible effect).
 *
 * Confirms both selects, when changed, apply through the shared token layer
 * on <html> (data/theme.ts) rather than being inert local state. Density
 * applies via the preference subscription installed by `initAppearance()`
 * (called at app boot in main.tsx), so the test boots it the same way.
 */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initAppearance } from '@/data/theme';
import { General } from './General';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.className = '';
  initAppearance();
});

afterEach(() => {
  cleanup();
});

describe('General — density', () => {
  it('scales the shared spacing tokens on <html> when changed', () => {
    render(<General />);

    const select = screen.getByDisplayValue('Comfortable (32px row)');
    fireEvent.change(select, { target: { value: 'compact' } });

    expect(document.documentElement.style.getPropertyValue('--alm-sp-2')).toBe(
      '6.00px',
    );
    expect(document.documentElement.classList.contains('density-compact')).toBe(
      true,
    );
  });
});

describe('General — font size', () => {
  it('scales the shared type-scale tokens on <html> when changed', () => {
    render(<General />);

    const select = screen.getByDisplayValue('Default (14px)');
    fireEvent.change(select, { target: { value: 'large' } });

    expect(
      document.documentElement.style.getPropertyValue('--alm-text-base'),
    ).toBe('14.95px');
  });

  it('persists the choice so it does not reset on a revisit', () => {
    const { unmount } = render(<General />);

    const select = screen.getByDisplayValue('Default (14px)');
    fireEvent.change(select, { target: { value: 'large' } });
    unmount();

    render(<General />);
    expect(screen.getByDisplayValue('Large (16px)')).toBeInTheDocument();
  });
});
