// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * InfoTip accessibility tests (WCAG 1.4.13 / 2.1.1), mirroring `Lock.test.tsx`.
 *
 * The two components are deliberately separate and their contracts differ; the
 * assertions here pin the half that is InfoTip's. See
 * `docs/adr/0002-lock-and-infotip-stay-separate.md`.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { InfoTip } from './InfoTip';

describe('InfoTip accessibility', () => {
  it('carries the tip text in the accessible name without opening the popup', () => {
    render(<InfoTip tip="Applies to newly scanned files only" />);

    expect(
      screen.getByRole('note', {
        name: 'More information: Applies to newly scanned files only',
      }),
    ).toBeInTheDocument();
  });

  // Load-bearing: base-ui portals the popup and mounts it only while open, and
  // the closed trigger gets no aria-describedby. The name is therefore the ONLY
  // route from the trigger to the help text for a screen reader user who has
  // not opened it.
  it('keeps the tip text out of the DOM until the popup opens', () => {
    render(<InfoTip tip="Applies to newly scanned files only" />);

    expect(screen.getByRole('note')).not.toHaveAttribute('aria-describedby');
    expect(
      screen.queryByText('Applies to newly scanned files only'),
    ).not.toBeInTheDocument();
  });

  it('is keyboard focusable so the tip is not pointer-only', () => {
    render(<InfoTip tip="Applies to newly scanned files only" />);

    const trigger = screen.getByRole('note');
    expect(trigger).toHaveAttribute('tabindex', '0');

    trigger.focus();
    expect(trigger).toHaveFocus();
  });

  it('honours a caller-supplied label prefix', () => {
    render(<InfoTip label="Help" tip="Matching runs per optical train" />);

    expect(
      screen.getByRole('note', {
        name: 'Help: Matching runs per optical train',
      }),
    ).toBeInTheDocument();
  });

  // Unlike Lock, InfoTip has no decorative mode: its text is supplemental help
  // that appears nowhere else, so there is no instance where hiding it from
  // assistive tech is correct.
  it('is never hidden from assistive tech', () => {
    render(<InfoTip tip="Applies to newly scanned files only" />);

    expect(screen.getByRole('note')).not.toHaveAttribute('aria-hidden');
  });
});
