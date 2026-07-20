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

import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  initAppearance,
  getThemeChoice,
  getFontSizeChoice,
} from '@/data/theme';
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

    expect(document.documentElement.style.getPropertyValue('--pv-sp-2')).toBe(
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
      document.documentElement.style.getPropertyValue('--pv-text-base'),
    ).toBe('16px');
    expect(document.documentElement.style.getPropertyValue('font-size')).toBe(
      '16px',
    );
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

describe('General — theme picker (handoff 03: canonical themes, grouped)', () => {
  it('shows the four canonical themes grouped Warm/Cool, and hides the two disabled variants', () => {
    render(<General />);

    expect(screen.getByText('Warm')).toBeInTheDocument();
    expect(screen.getByText('Cool')).toBeInTheDocument();

    expect(
      screen.getByRole('button', { name: /^Warm Slate/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Observatorydark$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Observatory Cool · Light/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Observatory Cooldark$/i }),
    ).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: /warm clay/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /espresso/i }),
    ).not.toBeInTheDocument();
  });
});

describe('General — restore defaults (#802)', () => {
  it('renders a Restore defaults control for the Appearance pane', () => {
    render(<General />);
    expect(
      screen.getByRole('button', { name: /restore defaults/i }),
    ).toBeInTheDocument();
  });

  it('resets theme, font size, and density to their in-code defaults', async () => {
    render(<General />);

    // Density's underlying preference store is shared module state (not
    // localStorage-synchronous like theme/font size), so an earlier test in
    // this file may have left it non-default — query the combobox by its row
    // rather than assuming a starting display value.
    const densityRow = screen
      .getByText('Density')
      .closest('.pv-settings__row') as HTMLElement;
    const densitySelect = within(densityRow).getByRole('combobox');

    // Espresso Dark is a disabled (registry-only) variant as of handoff 03 —
    // it no longer renders in the picker, so this exercises a canonical
    // theme instead. The exact-anchored name avoids matching the
    // "Observatory Cool · Light" card, whose accessible name also starts
    // with "Observatory Cool".
    fireEvent.click(
      screen.getByRole('button', { name: /^Observatory Cooldark$/i }),
    );
    fireEvent.change(screen.getByDisplayValue('Default (14px)'), {
      target: { value: 'large' },
    });
    fireEvent.change(densitySelect, { target: { value: 'compact' } });
    expect(getThemeChoice()).toBe('observatory-cool');
    expect(getFontSizeChoice()).toBe('large');
    expect(densitySelect).toHaveValue('compact');

    fireEvent.click(screen.getByRole('button', { name: /restore defaults/i }));

    await waitFor(() => {
      expect(getThemeChoice()).toBe('system');
    });
    expect(getFontSizeChoice()).toBe('default');
    expect(densitySelect).toHaveValue('comfortable');
  });
});
