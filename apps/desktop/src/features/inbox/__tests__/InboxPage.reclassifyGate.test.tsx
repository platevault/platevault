// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Issue #724/#755 CI-red (Real-UI E2E `inbox_ui_unclassified_gate_bulk_
 * reclassify_unblocks_confirm`, run 29638271121/job 88064532716, commit
 * 1fa9cc70): after a bulk `reclassify_v2` resolves an unclassified item to
 * `single_type` (backend confirmed: state=classified, frameTypeEffective=
 * light, needsReviewCount=0), the UI's unclassified-gate banner and disabled
 * Confirm stayed stuck on the PRE-reclassify state — end-to-end, real
 * router, real selection handoff (unlike `InboxPage.metadataGate.test.tsx`/
 * `InboxPage.applyOne.test.tsx`, which stub `useSearch`/`useNavigate` as
 * static/no-op — this test needs `navigate()` to actually move `selected`,
 * since the bug is IN that handoff).
 *
 * Root cause: `reclassify_v2` re-splits the source group into a NEW sub-item
 * id (`materialize_sub_items` always mints a fresh UUID, `classify.rs`).
 * Two independent effects in `InboxPage` react to the ensuing list refetch on
 * the SAME render: `useStaleSelectionCleanup` (declared first) sees the OLD
 * selected id is no longer `found` and clears `selected` to `undefined`;
 * `resolveReclassifyHandoff`'s effect (declared later) tries to navigate
 * `selected` to the NEW post-split id. Both call `navigate()` in the same
 * commit — the stale-cleanup's `undefined` wins because `pendingReclassify
 * SelectionId` timing let it fire on an EARLIER render (as soon as the list
 * refetch lands) than the handoff's own effect, which additionally waits one
 * more render for `listLoading` to have settled. Once cleared, nothing is
 * selected — `InboxDetail` unmounts to the pre-reclassify OLD item having
 * already rendered its stale gate one paint before the clear takes effect
 * (E2E takes its DOM snapshot in that window), and the handoff can never
 * retry (it already consumed its one-shot `pendingReclassifySelectionId`).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { useEffect, useState, type ReactElement } from 'react';
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

// ── Stateful router mock ─────────────────────────────────────────────────────
// Unlike the static `useSearch`/no-op `useNavigate` mocks elsewhere in this
// suite, this bug lives IN the selection handoff — `navigate()` must actually
// move `selected` and re-render, or the race this test targets can't occur.
const { getSearch, setSearch, resetSearch, subscribe } = vi.hoisted(() => {
  let state: { selected?: string; type?: string } = { selected: undefined };
  const listeners = new Set<() => void>();
  return {
    getSearch: () => state,
    setSearch: (updater: (prev: typeof state) => typeof state) => {
      state = updater(state);
      listeners.forEach((l) => l());
    },
    resetSearch: (next: typeof state) => {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
});

vi.mock('@tanstack/react-router', () => ({
  useNavigate:
    () =>
    ({
      search,
    }: {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    }) => {
      setSearch((prev) => search(prev) as typeof prev);
      return Promise.resolve();
    },
  useSearch: () => {
    const [, forceRender] = useState(0);
    useEffect(() => {
      return subscribe(() => forceRender((n) => n + 1));
    }, []);
    return getSearch();
  },
}));

const {
  mockRootsList,
  mockInboxList,
  mockInboxPlanListOpen,
  mockInboxClassify,
  mockInboxItemMetadata,
  mockInboxReclassifyV2,
  mockInboxPropertyRegistry,
} = vi.hoisted(() => ({
  mockRootsList: vi.fn(),
  mockInboxList: vi.fn(),
  mockInboxPlanListOpen: vi.fn(),
  mockInboxClassify: vi.fn(),
  mockInboxItemMetadata: vi.fn(),
  mockInboxReclassifyV2: vi.fn(),
  mockInboxPropertyRegistry: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsList: mockRootsList,
    inboxList: mockInboxList,
    inboxPlanListOpen: mockInboxPlanListOpen,
    inboxClassify: mockInboxClassify,
    inboxItemMetadata: mockInboxItemMetadata,
    inboxReclassifyV2: mockInboxReclassifyV2,
    inboxPropertyRegistry: mockInboxPropertyRegistry,
  },
}));

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

const OLD_ID = 'item-ambiguous';
const NEW_ID = 'item-post-split-light';

const oldItem = {
  inboxItemId: OLD_ID,
  groupId: OLD_ID,
  groupKey: '',
  sourceGroupId: 'sg-1',
  rootId: 'root-001',
  rootAbsolutePath: '/astro/inbox',
  relativePath: 'ambiguous_001',
  fileCount: 1,
  lane: 'fits',
  format: 'fits',
  state: 'pending_classification',
  contentSignature: 'sig-old',
  isMaster: false,
  masterFrameType: null,
  masterFilter: null,
  masterExposureS: null,
  organizationState: 'unorganized',
};

const newItem = {
  ...oldItem,
  inboxItemId: NEW_ID,
  groupId: NEW_ID,
  state: 'classified',
  contentSignature: 'sig-new',
};

beforeEach(() => {
  vi.clearAllMocks();
  resetSearch({ selected: undefined, type: undefined });

  mockRootsList.mockResolvedValue(ok([]));
  mockInboxPlanListOpen.mockResolvedValue(ok({ plans: [], totalActions: 0 }));
  mockInboxPropertyRegistry.mockResolvedValue(ok([]));
  mockInboxItemMetadata.mockResolvedValue(ok({ files: [] }));

  // First fetch: only the pre-split, unclassified item exists. After the
  // reclassify mutation invalidates the list, every subsequent fetch returns
  // the post-split, resolved item instead (the OLD row is gone — R-11: a
  // stale group's sub-item rows are purged on materialize_sub_items).
  mockInboxList
    .mockResolvedValueOnce(ok({ items: [oldItem], capped: false, limit: 500 }))
    .mockResolvedValue(ok({ items: [newItem], capped: false, limit: 500 }));

  mockInboxClassify.mockImplementation((args: { inboxItemId: string }) =>
    args.inboxItemId === NEW_ID
      ? Promise.resolve(
          ok({
            type: 'single_type',
            frameType: 'light',
            unclassifiedFiles: [],
          }),
        )
      : Promise.resolve(
          ok({
            type: 'unclassified',
            frameType: null,
            unclassifiedFiles: ['ambiguous_001.fits'],
          }),
        ),
  );

  mockInboxReclassifyV2.mockResolvedValue(
    ok({
      sourceGroupId: 'sg-1',
      subItems: [
        {
          inboxItemId: NEW_ID,
          groupKey: 'type=light',
          groupLabel: '(root) · light',
          frameType: 'light',
          fileCount: 1,
        },
      ],
      needsReviewCount: 0,
    }),
  );
});

import { InboxPage } from '../InboxPage';

describe('InboxPage bulk-reclassify unblocks Confirm (#724/#755 CI-red)', () => {
  it('moves selection to the post-split item and re-enables Confirm after bulk reclassify', async () => {
    // Matches the real flow (and the E2E's own `select_only_item()`): select
    // the row AFTER the list has loaded, not via a pre-set `?selected=` deep
    // link — selecting before load exercises a DIFFERENT (already-guarded)
    // mount-time path, not this bug.
    render(<InboxPage />);

    await screen.findByTestId(`inbox-item-${OLD_ID}`);
    screen.getByTestId(`inbox-item-${OLD_ID}`).click();

    // Pre-reclassify: the real gate this issue is about — classification.
    // type === 'unclassified' blocks Confirm.
    await waitFor(() => expect(mockInboxClassify).toHaveBeenCalled());
    expect(await screen.findByTestId('inbox-confirm-btn')).toBeDisabled();

    const selectAll = await screen.findByTestId('reclassify-select-all');
    selectAll.click();
    const bulkFrameType = screen.getByTestId(
      'bulk-frame-type',
    ) as HTMLSelectElement;
    bulkFrameType.value = 'light';
    bulkFrameType.dispatchEvent(new Event('change', { bubbles: true }));
    screen.getByTestId('bulk-apply-btn').click();

    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));

    // The real regression: Confirm must re-enable once the post-split item
    // (single_type, no missing attrs) is the one on screen — not stay
    // disabled on the OLD unclassified item's stale gate state.
    await waitFor(
      () => expect(screen.getByTestId('inbox-confirm-btn')).not.toBeDisabled(),
      { timeout: 5000 },
    );
    expect(screen.queryByTestId('inbox-unclassified-alert')).toBeNull();
    expect(getSearch().selected).toBe(NEW_ID);
  });
});
