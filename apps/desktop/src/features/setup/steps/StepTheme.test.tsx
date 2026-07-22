// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
}));

import { THEMES } from '@/data/theme';
import { StepTheme } from './StepTheme';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StepTheme', () => {
  it('offers System and every shipped theme during onboarding', () => {
    render(<StepTheme />);

    const picker = screen.getByRole('group', { name: 'Theme' });
    const choices = within(picker).getAllByRole('button');
    expect(THEMES).toHaveLength(6);
    expect(choices).toHaveLength(THEMES.length + 1);
    expect(
      within(picker).getByRole('button', {
        name: 'System · auto · light',
      }),
    ).toBeInTheDocument();

    for (const theme of THEMES) {
      expect(
        within(picker).getByRole('button', {
          name: `${theme.label} · ${theme.mode}`,
        }),
      ).toBeInTheDocument();
    }
  });

  it('keeps the illustrative specimen out of the accessibility and tab flow', () => {
    const { container } = render(<StepTheme />);

    const specimen = screen.getByRole('region', {
      name: 'Observation record',
    });
    const body = specimen.querySelector('.pv-theme-specimen__body');
    expect(body).toHaveAttribute('aria-hidden', 'true');
    expect(
      body?.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).toHaveLength(0);
    expect(within(specimen).queryByRole('button')).not.toBeInTheDocument();
    expect(
      container.querySelector('.pv-theme-specimen__body button'),
    ).toBeNull();
  });
});
