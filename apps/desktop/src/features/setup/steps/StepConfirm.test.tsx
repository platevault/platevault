// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * StepConfirm tests — first-run wizard Confirm summary (issue #515).
 *
 * Covers: each source row shows both organization state (organized/
 * unorganized) and scan depth, not scan depth alone.
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
  it('shows organization state alongside scan depth for each source row', () => {
    const sources: SourcesState = [
      {
        path: '/astro/lights',
        kind: 'light_frames',
        scanDepth: 'recursive',
        organizationState: 'organized',
      },
      {
        path: '/astro/inbox',
        kind: 'inbox',
        scanDepth: 'recursive',
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
    expect(screen.getAllByText('Recursive')).toHaveLength(2);
  });
});
