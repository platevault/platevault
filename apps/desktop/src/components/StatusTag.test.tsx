// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * StatusTag tests — spec 043 task #105, relocated from the retired
 * `ProjectStatusTag` alias (handoff 06 consolidation: the alias added no
 * behavior of its own, so its tests now cover the shared component directly).
 *
 * Verifies the dot+text replacement for the status Pill badge:
 *   1. Renders the label text.
 *   2. Carries the correct variant modifier class.
 *   3. Has a dot span (aria-hidden).
 *   4. Does not render a filled-background pill class.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatusTag } from './StatusTag';

describe('StatusTag', () => {
  it('renders the label text', () => {
    render(<StatusTag variant="ok">Completed</StatusTag>);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('applies the correct variant modifier class', () => {
    const { container } = render(
      <StatusTag variant="danger">Blocked</StatusTag>,
    );
    const tag = container.querySelector('.pv-status-tag');
    expect(tag).toHaveClass('pv-status-tag--danger');
  });

  it('renders a dot span that is aria-hidden', () => {
    const { container } = render(
      <StatusTag variant="info">Processing</StatusTag>,
    );
    const dot = container.querySelector('.pv-status-tag__dot');
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not use the pv-pill class', () => {
    const { container } = render(
      <StatusTag variant="neutral">Ready</StatusTag>,
    );
    expect(container.querySelector('.pv-pill')).toBeNull();
  });

  it('renders all PillVariant-equivalent states without throwing', () => {
    const variants = [
      'ok',
      'warn',
      'danger',
      'info',
      'accent',
      'neutral',
      'ghost',
    ] as const;
    for (const variant of variants) {
      const { unmount } = render(
        <StatusTag variant={variant}>{variant}</StatusTag>,
      );
      expect(screen.getByText(variant)).toBeInTheDocument();
      unmount();
    }
  });
});
