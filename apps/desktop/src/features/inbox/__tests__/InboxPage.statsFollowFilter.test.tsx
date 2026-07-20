// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Spec 058 T022 / SC-004 — the Inbox summary counts must equal the number of
 * rows the list actually shows.
 *
 * `InboxList` renders `filteredItems`, but `derivedStats` was computed from the
 * unfiltered `items` array, so with any search or filter active the stats strip
 * reported MORE folders than the list displayed. On the folder-shape axes
 * SC-004 names (uniform / split / needs-review) the two reconciled by
 * construction, which is why this survived: the disagreement only appears once
 * a filter narrows the list.
 *
 * Owner decision, 2026-07-20 (issue #1178): SC-004 takes the reading that the
 * counts describe **what the user is looking at**, so the summary is derived
 * from `filteredItems`. A summary sitting above a filtered list and disagreeing
 * with it is the same class of lie spec 058 exists to remove.
 *
 * The fixture uses two folders with distinct `relativePath`s so a search term
 * matching exactly one narrows the list from 2 rows to 1. If the summary is
 * derived from the unfiltered array it keeps reporting 2 and this test fails.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageStatusProvider, usePageStatus } from '@/app/PageStatusContext';

/**
 * The stats strip is not rendered by `InboxPage` itself — the page pushes it
 * into `PageStatusProvider` via `useSetPageStatus` and the app shell renders
 * it. This stands in for that shell so the strip is present in the test DOM.
 */
function StatusSlot() {
  return <>{usePageStatus()}</>;
}

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <PageStatusProvider>
        {ui}
        <StatusSlot />
      </PageStatusProvider>
    </QueryClientProvider>,
  );
}

const {
  mockRootsList,
  mockInboxList,
  mockInboxPlanListOpen,
  mockInboxClassify,
  mockInboxItemMetadata,
} = vi.hoisted(() => ({
  mockRootsList: vi.fn(),
  mockInboxList: vi.fn(),
  mockInboxPlanListOpen: vi.fn(),
  mockInboxClassify: vi.fn(),
  mockInboxItemMetadata: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsList: mockRootsList,
    inboxList: mockInboxList,
    inboxPlanListOpen: mockInboxPlanListOpen,
    inboxClassify: mockInboxClassify,
    inboxItemMetadata: mockInboxItemMetadata,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({ selected: undefined, type: undefined }),
}));

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

/** One classified light folder, at its own distinct relative path. */
function folder(inboxItemId: string, relativePath: string, sig: string) {
  return {
    inboxItemId,
    groupId: inboxItemId,
    sourceGroupId: `sg-${inboxItemId}`,
    groupKey: 'type=light',
    groupFrameType: 'light',
    needsReview: false,
    rootId: 'root-001',
    rootAbsolutePath: '/astro/inbox',
    relativePath,
    fileCount: 2,
    lane: 'fits',
    format: 'fits',
    state: 'classified',
    classificationResult: 'classified',
    contentSignature: sig,
    isMaster: false,
    masterFrameType: null,
    masterFilter: null,
    masterExposureS: null,
    organizationState: 'unorganized',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRootsList.mockResolvedValue(ok([]));
  mockInboxList.mockResolvedValue(
    ok({
      items: [
        folder('item-ngc7000', 'lights/NGC7000', 'sig-a'),
        folder('item-m31', 'lights/M31', 'sig-b'),
      ],
      sourceGroups: [],
      capped: false,
      limit: 500,
    }),
  );
  mockInboxPlanListOpen.mockResolvedValue(ok({ plans: [], totalActions: 0 }));
  mockInboxClassify.mockResolvedValue(
    ok({
      type: 'single_type',
      frameType: 'light',
      contentSignature: 'sig-a',
      unclassifiedFiles: [],
    }),
  );
  mockInboxItemMetadata.mockResolvedValue(ok({ files: [] }));
});

describe('Inbox summary counts follow the filtered list (T022, SC-004)', () => {
  it('reports one folder after a search narrows the list to one row', async () => {
    const { InboxPage } = await import('../InboxPage');
    render(<InboxPage />);

    // Both folders are in the queue to begin with.
    await waitFor(() => {
      expect(screen.getByText('lights/NGC7000')).toBeInTheDocument();
      expect(screen.getByText('lights/M31')).toBeInTheDocument();
    });

    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'M31' } });

    // The list narrows to one row...
    await waitFor(() => {
      expect(screen.queryByText('lights/NGC7000')).not.toBeInTheDocument();
      expect(screen.getByText('lights/M31')).toBeInTheDocument();
    });

    // ...and the summary must agree. Both fixtures are `light` folders, so the
    // per-type light count is 2 before the filter and must become 1 after it.
    // Derived from the unfiltered array it stays 2 — exactly the SC-004
    // disagreement this task closes.
    // Read the count element itself rather than the cell's concatenated text:
    // the cell renders as "light1", where no word boundary separates the type
    // from the number.
    await waitFor(() => {
      const lightCell = screen.getByTestId('inbox-stats-type-light');
      const num = lightCell.querySelector('.pv-inbox-stats__num');
      expect(num?.textContent).toBe('1');
    });
  });
});
