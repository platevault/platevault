// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Banner } from './Banner';

describe('Banner accessibility semantics', () => {
  it('announces danger content as an alert', () => {
    render(<Banner variant="danger">Registration failed</Banner>);

    expect(screen.getByRole('alert')).toHaveTextContent('Registration failed');
  });

  it('announces warnings politely and leaves informational content static', () => {
    const { rerender } = render(<Banner variant="warn">Site skipped</Banner>);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');

    rerender(<Banner variant="info">Files stay in place</Banner>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('preserves an explicit caller role', () => {
    render(
      <Banner variant="danger" role="status" aria-live="polite">
        Retry available
      </Banner>,
    );

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
