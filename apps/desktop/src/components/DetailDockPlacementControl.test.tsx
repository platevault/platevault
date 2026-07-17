// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * DetailDockPlacementControl tests — spec 054 T021 (US4, owner mandate).
 *
 * Covers the Auto/Bottom/Right mapping onto `setDetailDockMode`/'adaptive'|
 * 'bottom'|'side' — this is the ONE control instance shared verbatim by
 * Settings (General.tsx) and the in-page detail header (ListPageLayout).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DetailDockPlacementControl } from './DetailDockPlacementControl';
import { getDetailDock, resetPreferences } from '@/data/preferences';

beforeEach(() => {
  resetPreferences();
});

describe('DetailDockPlacementControl', () => {
  it('reflects the current pin and defaults to Auto', () => {
    render(<DetailDockPlacementControl page="sessions" />);
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveClass(
      'alm-seg__btn--active',
    );
  });

  it('writes bottom via setDetailDockMode when Bottom is clicked', () => {
    render(<DetailDockPlacementControl page="sessions" />);
    fireEvent.click(screen.getByRole('button', { name: 'Bottom' }));
    expect(getDetailDock('sessions').mode).toBe('bottom');
  });

  it('writes side ("Right") via setDetailDockMode when Right is clicked', () => {
    render(<DetailDockPlacementControl page="targets" />);
    fireEvent.click(screen.getByRole('button', { name: 'Right' }));
    expect(getDetailDock('targets').mode).toBe('side');
  });
});
