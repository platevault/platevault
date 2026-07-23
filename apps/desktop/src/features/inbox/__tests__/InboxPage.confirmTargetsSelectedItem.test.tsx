// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Spec 058 T027 / T029 — the id `inbox.confirm` is handed must be the SELECTED
 * item's own `inboxItemId`, never the folder-level id its siblings share.
 *
 * T027 turned out to need no production change: `handleConfirm` already reads
 * `selectedItem.inboxItemId`, and `selectedItem` is resolved from the list by
 * id (#644). This test exists because that is an invariant, not an accident —
 * #1038 broke this flow twice, and once FR-001 drops the parent row the N
 * siblings of a folder are the only rows there are, so handing confirm a
 * folder-scoped id stops being merely wrong and starts being unrepresentable.
 *
 * The fixture is built so all three plausible regressions fail it: the two
 * siblings share one `sourceGroupId` (the folder they were materialized from),
 * the SECOND one is selected (so "pick the first sibling" fails), and both item
 * ids differ from that source-group id (so "pass the folder id" fails).
 *
 * Note `groupId` is NOT the folder id despite the name — per the contract it
 * "Equals `inbox_item_id`". `sourceGroupId` is the folder-scoped one, and it is
 * what `InboxDetail`'s remount key already reads (InboxPage.tsx:1156).
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
import { PageStatusProvider } from '@/app/PageStatusContext';

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>
      <PageStatusProvider>{ui}</PageStatusProvider>
    </QueryClientProvider>,
  );
}

const {
  mockRootsList,
  mockInboxList,
  mockInboxPlanListOpen,
  mockInboxClassify,
  mockInboxItemMetadata,
  mockInboxConfirm,
} = vi.hoisted(() => ({
  mockRootsList: vi.fn(),
  mockInboxList: vi.fn(),
  mockInboxPlanListOpen: vi.fn(),
  mockInboxClassify: vi.fn(),
  mockInboxItemMetadata: vi.fn(),
  mockInboxConfirm: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsList: mockRootsList,
    inboxList: mockInboxList,
    inboxPlanListOpen: mockInboxPlanListOpen,
    inboxClassify: mockInboxClassify,
    inboxItemMetadata: mockInboxItemMetadata,
    inboxConfirm: mockInboxConfirm,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({ selected: 'item-flats', type: undefined }),
}));

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

/** Both siblings live in one folder and therefore share `sourceGroupId`. */
function sibling(inboxItemId: string, groupKey: string, sig: string) {
  return {
    inboxItemId,
    // Per the contract this restates the item's own identity, not the folder's.
    groupId: inboxItemId,
    sourceGroupId: 'sg-folder-1',
    groupKey,
    needsReview: false,
    rootId: 'root-001',
    rootAbsolutePath: '/astro/inbox',
    relativePath: 'lights/NGC7000',
    fileCount: 2,
    lane: 'fits',
    format: 'fits',
    state: 'classified',
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
        sibling('item-lights', 'type=light', 'sig-lights'),
        sibling('item-flats', 'type=flat', 'sig-flats'),
      ],
      capped: false,
      limit: 500,
    }),
  );
  mockInboxPlanListOpen.mockResolvedValue(ok({ plans: [], totalActions: 0 }));
  mockInboxClassify.mockResolvedValue(
    ok({
      type: 'single_type',
      frameType: 'flat',
      contentSignature: 'sig-flats',
      unclassifiedFiles: [],
    }),
  );
  mockInboxItemMetadata.mockResolvedValue(
    ok({
      files: [
        {
          relativeFilePath: 'lights/NGC7000/flat_001.fits',
          missingPathAttributes: [],
          missingMandatory: [],
        },
      ],
    }),
  );
  mockInboxConfirm.mockResolvedValue(
    ok({
      planId: 'plan-1',
      planState: 'ready_for_review',
      itemsTotal: 2,
      destinations: [],
      organizationState: 'unorganized',
    }),
  );
});

import { InboxPage } from '../InboxPage';

describe('spec 058 FR-010 — confirm targets the selected item, not its folder', () => {
  it('sends the selected sibling own inboxItemId', async () => {
    render(<InboxPage />);

    const confirmBtn = await screen.findByTestId('inbox-confirm-btn');
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());

    fireEvent.click(confirmBtn);

    await waitFor(() => expect(mockInboxConfirm).toHaveBeenCalledTimes(1));
    expect(mockInboxConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        inboxItemId: 'item-flats',
        contentSignature: 'sig-flats',
      }),
    );
  });

  /**
   * FR-023 / CHK011 companion: the classification fetch is keyed on the same
   * id, so a confirm that targeted a sibling would also be reviewing the wrong
   * classification. Pinned here rather than in a second file because it is the
   * same selection invariant read at a different call site.
   */
  it('loads the classification for that same sibling', async () => {
    render(<InboxPage />);

    await waitFor(() => expect(mockInboxClassify).toHaveBeenCalled());
    expect(mockInboxClassify).toHaveBeenCalledWith(
      expect.objectContaining({ inboxItemId: 'item-flats' }),
    );
  });
});
