/// <reference types="@testing-library/jest-dom" />
/**
 * ProjectStatusTag tests — spec 043 task #105.
 *
 * Verifies the dot+text replacement for the status Pill badge:
 *   1. Renders the label text.
 *   2. Carries the correct variant modifier class.
 *   3. Has a dot span (aria-hidden).
 *   4. Does not render a filled-background pill class.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProjectStatusTag } from './ProjectStatusTag';

describe('ProjectStatusTag', () => {
  it('renders the label text', () => {
    render(<ProjectStatusTag variant="ok">Completed</ProjectStatusTag>);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('applies the correct variant modifier class', () => {
    const { container } = render(
      <ProjectStatusTag variant="danger">Blocked</ProjectStatusTag>,
    );
    const tag = container.querySelector('.alm-status-tag');
    expect(tag).toHaveClass('alm-status-tag--danger');
  });

  it('renders a dot span that is aria-hidden', () => {
    const { container } = render(
      <ProjectStatusTag variant="info">Processing</ProjectStatusTag>,
    );
    const dot = container.querySelector('.alm-status-tag__dot');
    expect(dot).toBeInTheDocument();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not use the alm-pill class', () => {
    const { container } = render(
      <ProjectStatusTag variant="neutral">Ready</ProjectStatusTag>,
    );
    expect(container.querySelector('.alm-pill')).toBeNull();
  });

  it('renders all PillVariant-equivalent states without throwing', () => {
    const variants = ['ok', 'warn', 'danger', 'info', 'accent', 'neutral', 'ghost'] as const;
    for (const variant of variants) {
      const { unmount } = render(
        <ProjectStatusTag variant={variant}>{variant}</ProjectStatusTag>,
      );
      expect(screen.getByText(variant)).toBeInTheDocument();
      unmount();
    }
  });
});
