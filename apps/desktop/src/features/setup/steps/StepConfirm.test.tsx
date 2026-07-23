// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * StepConfirm tests — first-run wizard Confirm summary (issue #515).
 *
 * Covers: each source row shows organization state (organized/unorganized).
 * Scan-depth display was retired end-to-end (#913) — 'single' was never
 * implemented, every scan is recursive (#509).
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { StepConfirm } from './StepConfirm';
import type { SourcesState } from '../sources-store';
import type { CatalogSettings } from './StepCatalogs';
import type { ToolsState } from './StepTools';

const CATALOG_SETTINGS: CatalogSettings = { downloadAll: false };
const TOOLS: ToolsState = {
  pixinsight: { enabled: false, path: '' },
  siril: { enabled: false, path: '' },
};

describe('StepConfirm', () => {
  it('shows organization state for each source row', () => {
    const sources: SourcesState = [
      {
        path: '/astro/lights',
        kind: 'light_frames',
        organizationState: 'organized',
      },
      {
        path: '/astro/inbox',
        kind: 'inbox',
        organizationState: 'unorganized',
      },
    ];

    render(
      <StepConfirm
        sources={sources}
        catalogSettings={CATALOG_SETTINGS}
        tools={TOOLS}
        isSubmitting={false}
      />,
    );

    expect(screen.getByText('Already organized')).toBeInTheDocument();
    expect(screen.getByText('Needs organizing')).toBeInTheDocument();
  });
});
