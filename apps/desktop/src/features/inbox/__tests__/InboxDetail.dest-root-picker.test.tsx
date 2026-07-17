// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * InboxDetail destination-root picker gating (#768).
 *
 * Repro: a `light_frames` item sourced from an ORGANIZED root, with a second
 * registered `raw` root present, showed an enabled destination-root picker
 * even though confirm always catalogues an organized-source item in place —
 * any selection there is silently ignored server-side. The picker must only
 * appear when a destination choice is actually meaningful, i.e. the item's
 * source root is NOT organized.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { InboxItemSummary } from '@/bindings/index';
import type { InboxClassifyResponse } from '@/bindings/aliases';
import { InboxDetail } from '../InboxDetail';

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

vi.mock('@/bindings/index', () => ({
  commands: { inboxReclassify: vi.fn() },
}));

const singleTypeLight: InboxClassifyResponse = {
  inboxItemId: 'item-light',
  type: 'single_type',
  frameType: 'light',
  contentSignature: 'sig-light',
  breakdown: [
    {
      kind: 'light',
      count: 2,
      destinationPreview: 'M51/LUM/2025-05-03/light/',
      sampleFiles: ['frame_001.fits'],
    },
  ],
  unclassifiedFiles: [],
  sampleFiles: ['frame_001.fits'],
  computedAt: '2025-05-03T00:00:00Z',
};

function makeItem(
  overrides: Partial<InboxItemSummary & { organizationState?: string }>,
): InboxItemSummary & { organizationState?: string } {
  return {
    inboxItemId: 'item-light',
    relativePath: 'M51/LUM/2025-05-03',
    fileCount: 2,
    lane: 'fits',
    format: 'fits',
    state: 'classified',
    contentSignature: 'sig-light',
    isMaster: false,
    masterFrameType: null,
    masterFilter: null,
    masterExposureS: null,
    ...overrides,
  };
}

const twoRawRoots = [
  { id: 'root-1', path: 'C:/Temp/lights/1', category: 'raw' },
  { id: 'root-2', path: 'C:/Temp/lights/2', category: 'raw' },
];

describe('InboxDetail destination-root picker (#768)', () => {
  it('does NOT render the picker for an item sourced from an ORGANIZED root, even with >1 applicable roots', () => {
    render(
      <InboxDetail
        item={makeItem({ organizationState: 'organized' })}
        rootAbsolutePath="/astro/lights/1"
        classification={singleTypeLight}
        onConfirm={vi.fn()}
        destinationRoots={twoRawRoots}
        selectedRootId=""
        onSelectRoot={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId('inbox-dest-root-select'),
    ).not.toBeInTheDocument();
  });

  it('still renders the picker for an UNORGANIZED-source item with >1 applicable roots (unchanged behavior)', () => {
    render(
      <InboxDetail
        item={makeItem({ organizationState: 'unorganized' })}
        rootAbsolutePath="/astro/lights/2"
        classification={singleTypeLight}
        onConfirm={vi.fn()}
        destinationRoots={twoRawRoots}
        selectedRootId=""
        onSelectRoot={vi.fn()}
      />,
    );
    expect(screen.getByTestId('inbox-dest-root-select')).toBeInTheDocument();
  });
});
