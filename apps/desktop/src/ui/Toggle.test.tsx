// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
// PR #1438: keyboard focus visibility on toggle controls.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toggle } from './Toggle';

const settingsCss = readFileSync(
  resolve(process.cwd(), 'src/styles/components/settings.css'),
  'utf8',
);

describe('Toggle', () => {
  it('keeps keyboard focus on the real checkbox', () => {
    render(
      <Toggle checked={false} onChange={vi.fn()} aria-label="Auto scan" />,
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Auto scan' });
    checkbox.focus();

    expect(checkbox).toHaveFocus();
    expect(checkbox.tabIndex).toBe(0);
  });

  it('draws the shared focus ring on the track with a forced-colors fallback', () => {
    const focusRule = settingsCss.match(
      /\.pv-toggle input:focus-visible ~ \.pv-toggle__track\s*\{([^}]*)\}/,
    )?.[1];

    expect(focusRule).toContain('box-shadow: var(--pv-focus-ring)');
    expect(focusRule).toContain('outline: 2px solid transparent');
  });

  it('exposes checked state and preserves click changes', () => {
    const onChange = vi.fn();
    render(<Toggle checked onChange={onChange} aria-label="Auto scan" />);

    const checkbox = screen.getByRole('checkbox', { name: 'Auto scan' });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('disables the checkbox and suppresses click changes', () => {
    const onChange = vi.fn();
    render(
      <Toggle
        checked={false}
        disabled
        onChange={onChange}
        aria-label="Auto scan"
      />,
    );

    const checkbox = screen.getByRole('checkbox', { name: 'Auto scan' });
    expect(checkbox).toBeDisabled();

    checkbox.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('routes aria-labelledby to the real checkbox', () => {
    render(
      <>
        <span id="toggle-name">Auto scan</span>
        <Toggle
          checked={false}
          onChange={vi.fn()}
          aria-labelledby="toggle-name"
        />
      </>,
    );

    expect(screen.getByRole('checkbox')).toHaveAccessibleName('Auto scan');
  });
});
