// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Issue #724/#755 CI-red (Real-UI E2E `inbox_ui_unclassified_gate_bulk_
 * reclassify_unblocks_confirm`, run 29638271121/job 88064532716, commit
 * 1fa9cc70). Three rounds of diagnosis on this file; the FINAL, CI-log-decided
 * root cause is the last `describe` block below — see its docstring. The
 * earlier rounds (empty-`subItems` handoff, selection-handoff ordering) were
 * investigated and their fixes kept as defense-in-depth, but neither explained
 * the actual CI dump (`allReclassifyV2CallCount: 0` — the real
 * `inbox.reclassify_v2` command was NEVER invoked at all).
 *
 * This suite needs a STATEFUL `useSearch`/`useNavigate` mock (unlike
 * `InboxPage.metadataGate.test.tsx`/`InboxPage.applyOne.test.tsx`'s static/
 * no-op ones) because the bugs under test live in how `InboxPage` reacts to
 * `selected` actually changing.
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
  const result = rtlRender(
    <QueryClientProvider client={queryClient}>
      <PageStatusProvider>{ui}</PageStatusProvider>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
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
      listeners.forEach((l) => {
        l();
      });
    },
    resetSearch: (next: typeof state) => {
      state = next;
      listeners.forEach((l) => {
        l();
      });
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

  // Coordinator's root-cause hypothesis (a): `reclassify_v2` only emits
  // `subItems` when it re-splits a group into SEPARATE materialized rows —
  // a group that resolves to exactly the item already selected (single-type,
  // no missing attrs, nothing to split) can report an empty `subItems` list.
  // `pickReclassifyTarget([])` returns null, so the selection-handoff path
  // never starts; the gate must still re-derive from a fresh classify of
  // whatever is CURRENTLY selected.
  it('re-enables Confirm when reclassify_v2 resolves the item IN PLACE (empty subItems)', async () => {
    mockInboxReclassifyV2.mockResolvedValue(
      ok({ sourceGroupId: 'sg-1', subItems: [], needsReviewCount: 0 }),
    );
    // The id never changes for an in-place resolve — same OLD_ID throughout,
    // but its classify() result flips from unclassified to single_type once
    // the reclassify's cache invalidation lands (call 2+).
    let classifyCall = 0;
    mockInboxClassify.mockImplementation(() => {
      classifyCall += 1;
      return Promise.resolve(
        classifyCall === 1
          ? ok({
              type: 'unclassified',
              frameType: null,
              unclassifiedFiles: ['ambiguous_001.fits'],
            })
          : ok({
              type: 'single_type',
              frameType: 'light',
              unclassifiedFiles: [],
            }),
      );
    });
    mockInboxList.mockReset();
    mockInboxList.mockResolvedValue(
      ok({ items: [oldItem], capped: false, limit: 500 }),
    );

    render(<InboxPage />);
    await screen.findByTestId(`inbox-item-${OLD_ID}`);
    screen.getByTestId(`inbox-item-${OLD_ID}`).click();

    await waitFor(() => expect(mockInboxClassify).toHaveBeenCalled());
    expect(await screen.findByTestId('inbox-confirm-btn')).toBeDisabled();

    screen.getByTestId('reclassify-select-all').click();
    const bulkFrameType = screen.getByTestId(
      'bulk-frame-type',
    ) as HTMLSelectElement;
    bulkFrameType.value = 'light';
    bulkFrameType.dispatchEvent(new Event('change', { bubbles: true }));
    screen.getByTestId('bulk-apply-btn').click();

    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));

    await waitFor(
      () => expect(screen.getByTestId('inbox-confirm-btn')).not.toBeDisabled(),
      { timeout: 5000 },
    );
    expect(screen.queryByTestId('inbox-unclassified-alert')).toBeNull();
    // Selection never needed to move — no handoff, no id change.
    expect(getSearch().selected).toBe(OLD_ID);
  });
});

// ── FINAL diagnosis (CI-log-decided, run 29638271121) ───────────────────────
//
// The CI dump was decisive and overturned both earlier hypotheses:
// `allReclassifyV2CallCount: 0` — the real `inbox.reclassify_v2` command was
// NEVER invoked — while `bulkFieldsetPresent: false` at dump time is a RED
// HERRING for "the fieldset never renders": that testid is
// `.alm-inbox-detail__bulk-controls`, gated on local `selectedFiles.size > 0`
// (`InboxDetail.tsx:1011`) — a POST-interaction state, not a structural
// render condition. The banner (`inbox-unclassified-alert`,
// `InboxDetail.tsx:847`) is gated purely on `classification.type`, unrelated
// to `unclassifiedFiles`/`selectedFiles` — so it staying present alongside an
// absent fieldset does NOT mean the fieldset's condition evaluates wrong; it
// means SOMETHING reset `selectedFiles` back to empty AFTER the retry loop
// already interacted with it.
//
// `handleBulkApply`'s success path (`InboxDetail.tsx` ~440) is the only
// in-component code that resets `selectedFiles` — ruled out, since that path
// calls `reclassifyV2` first and the call count is 0. The other way local
// state resets to empty is an INVOLUNTARY REMOUNT: `InboxPage.tsx` (pre-fix)
// keyed `<InboxDetail key={selectedItem.inboxItemId}>` — and `classify()`'s
// OWN materialize_sub_items (triggered by the FIRST classify of a freshly
// scanned item, not by any reclassify) purges the placeholder row and mints
// a fresh-UUID needs-review sub-item id (`classify.rs`'s `sg_id_for_split` /
// `materialize_sub_items`). That id churn remounts `InboxDetail`, wiping
// `selectedFiles`/`bulkFrameType` — if it lands in the (WebDriver-widened,
// by #854's added exposureS-field requirement) window between the E2E
// retry-loop's last DOM-value re-verification and the actual click event
// being processed, `handleBulkApply` runs against the FRESH (reset, empty)
// state and silently no-ops via its own `if (selectedFiles.size === 0)
// return;` guard — matching `allReclassifyV2CallCount: 0` exactly.
//
// Fix: key `InboxDetail` on the STABLE `sourceGroupId` (which the freshly
// materialized sub-item always shares with the placeholder it replaced),
// falling back to `inboxItemId` for legacy pre-source-group rows — so the
// component survives this involuntary churn while still remounting for a
// genuinely different row.
describe('InboxDetail survives the involuntary id churn from the FIRST classify (CI-red final diagnosis)', () => {
  it('preserves in-progress bulk-select state across an id swap that keeps the same sourceGroupId', async () => {
    const { queryClient } = render(<InboxPage />);

    await screen.findByTestId(`inbox-item-${OLD_ID}`);
    screen.getByTestId(`inbox-item-${OLD_ID}`).click();
    await waitFor(() => expect(mockInboxClassify).toHaveBeenCalled());

    // Start the bulk-reclassify interaction on the OLD (placeholder) id.
    const selectAll = await screen.findByTestId('reclassify-select-all');
    selectAll.click();
    const bulkFrameType = screen.getByTestId(
      'bulk-frame-type',
    ) as HTMLSelectElement;
    bulkFrameType.value = 'light';
    bulkFrameType.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => expect(selectAll).toBeChecked());
    expect(bulkFrameType.value).toBe('light');

    // Simulate classify()'s OWN materialize_sub_items id churn landing MID
    // interaction: the list now reports the SAME sourceGroupId under a
    // DIFFERENT inboxItemId (still genuinely unclassified — nothing has been
    // reclassified yet), and something moves `selected` to follow it (the
    // exact mechanism is out of scope here; this test isolates ONLY whether
    // InboxDetail's own local state survives the swap).
    mockInboxList.mockResolvedValue(
      ok({ items: [newItem], capped: false, limit: 500 }),
    );
    mockInboxClassify.mockResolvedValue(
      ok({
        type: 'unclassified',
        frameType: null,
        unclassifiedFiles: ['ambiguous_001.fits'],
      }),
    );
    await queryClient.invalidateQueries({ queryKey: ['inbox', 'all'] });
    setSearch((prev) => ({ ...prev, selected: NEW_ID }));

    await waitFor(() => expect(getSearch().selected).toBe(NEW_ID));

    // The regression: with the pre-fix `key={inboxItemId}`, this id swap
    // remounts InboxDetail — resetting `selectedFiles`/`bulkFrameType` to
    // empty — and the click below would silently no-op
    // (`allReclassifyV2CallCount: 0`, the real CI symptom). With the fix
    // (`key={sourceGroupId ?? inboxItemId}`, both items share 'sg-1'), the
    // SAME component instance survives, and the just-set values are still
    // there to submit.
    const selectAllAfter = screen.getByTestId('reclassify-select-all');
    const bulkFrameTypeAfter = screen.getByTestId(
      'bulk-frame-type',
    ) as HTMLSelectElement;
    expect(selectAllAfter).toBeChecked();
    expect(bulkFrameTypeAfter.value).toBe('light');

    screen.getByTestId('bulk-apply-btn').click();
    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));
    expect(mockInboxReclassifyV2).toHaveBeenCalledWith(
      expect.objectContaining({
        bulk: expect.arrayContaining([
          expect.objectContaining({ property: 'frameType', value: 'light' }),
        ]),
      }),
    );
  });
});
