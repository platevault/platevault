// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Post-split selection handoff (issue #755 CI fix, PR #854).
 *
 * `reclassify_v2` operates at source-group scope and re-splits the group
 * into new single-type sub-items (R-14). The previously-selected item can
 * silently stop existing after a bulk/per-file reclassify (the group it
 * belonged to no longer exists), leaving the Confirm gate (`InboxPage.tsx`
 * `canConfirm`) permanently disabled — this is exactly what the Real-UI e2e
 * `inbox_ui_unclassified_gate_bulk_reclassify_unblocks_confirm` caught.
 * (Selection itself is by item id, not list index — issue #644.)
 *
 * Three cheap unit-level checks stand in for a full-router InboxPage render
 * (no full-router test harness exists in this codebase — InboxPage.classify
 * .test.tsx deliberately renders InboxDetail directly to avoid the OOM a
 * full page tree causes, per its own comment):
 *
 * 1. `pickReclassifyTarget` — the pure logic InboxPage uses to choose which
 *    post-split sub-item id to select next, given the reclassify_v2
 *    response's `subItems`. Direct unit test, no rendering (mirrors the
 *    existing `mergeRescanRoots`/`normalizeConfirmError` pattern in
 *    inbox.crossRoot.test.tsx).
 * 2. `resolveReclassifyHandoff` — the pure per-render decision (wait /
 *    navigate / give up) that bounds `pendingReclassifySelectionId`'s
 *    lifetime (review round 3): an active search/kind filter hiding the
 *    post-split item from `filteredItems` must not gate
 *    `useStaleSelectionCleanup` open forever — it has to give up once the
 *    UNFILTERED list has settled without the target.
 * 3. `InboxDetail` calls `onReclassified` with the full v2 response
 *    (including `subItems`) after a successful bulk apply — the seam
 *    InboxPage's handoff logic depends on. Proves the CONTRACT between the
 *    two components without needing a router.
 */
import React from 'react';
import {
  render as rtlRender,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import type {
  InboxItemSummary_Serialize as InboxItemSummary,
  InboxClassifyResponse_Serialize as InboxClassifyResponse,
  InboxReclassifyV2Response_Serialize as InboxReclassifyV2Response,
  PropertyRegistryEntry_Serialize as PropertyRegistryEntry,
} from '@/bindings';

import { InboxDetail } from '../InboxDetail';

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// ── 1. pickReclassifyTarget (pure logic) ───────────────────────────────────────

describe('pickReclassifyTarget (post-split selection target, issue #755)', () => {
  it('picks the sole resolved (single-type, no missing-mandatory) sub-item', async () => {
    const { pickReclassifyTarget } = await import('../InboxPage');

    const subItems = [
      { inboxItemId: 'item-new-light', frameType: 'light', fileCount: 3 },
    ];

    expect(pickReclassifyTarget(subItems)).toBe('item-new-light');
  });

  it('excludes the needs-review sentinel bucket (frameType null)', async () => {
    const { pickReclassifyTarget } = await import('../InboxPage');

    const subItems = [
      { inboxItemId: 'item-still-review', frameType: null, fileCount: 5 },
      { inboxItemId: 'item-resolved', frameType: 'dark', fileCount: 2 },
    ];

    expect(pickReclassifyTarget(subItems)).toBe('item-resolved');
  });

  it('excludes a sub-item that still has missing-mandatory attributes', async () => {
    const { pickReclassifyTarget } = await import('../InboxPage');

    const subItems = [
      {
        inboxItemId: 'item-missing-attrs',
        frameType: 'flat',
        fileCount: 4,
        missingMandatory: ['filter'],
      },
      { inboxItemId: 'item-clean', frameType: 'flat', fileCount: 1 },
    ];

    expect(pickReclassifyTarget(subItems)).toBe('item-clean');
  });

  it('breaks ties between multiple resolved sub-items by file count', async () => {
    const { pickReclassifyTarget } = await import('../InboxPage');

    const subItems = [
      { inboxItemId: 'item-small', frameType: 'dark', fileCount: 1 },
      { inboxItemId: 'item-large', frameType: 'light', fileCount: 12 },
    ];

    expect(pickReclassifyTarget(subItems)).toBe('item-large');
  });

  it('returns null when every sub-item is still needs-review', async () => {
    const { pickReclassifyTarget } = await import('../InboxPage');

    const subItems = [
      { inboxItemId: 'item-a', frameType: null, fileCount: 3 },
      {
        inboxItemId: 'item-b',
        frameType: 'bias',
        fileCount: 2,
        missingMandatory: ['exposureS'],
      },
    ];

    expect(pickReclassifyTarget(subItems)).toBeNull();
  });

  it('returns null for an empty sub-item list', async () => {
    const { pickReclassifyTarget } = await import('../InboxPage');

    expect(pickReclassifyTarget([])).toBeNull();
  });
});

// ── 2. resolveReclassifyHandoff (bounded lifetime, review round 3) ─────────────

describe('resolveReclassifyHandoff (bounded pendingReclassifySelectionId lifetime)', () => {
  it('waits while the list query is still loading, even if already visible', async () => {
    const { resolveReclassifyHandoff } = await import('../InboxPage');

    const items = [{ inboxItemId: 'item-target' }];
    expect(
      resolveReclassifyHandoff(
        'item-target',
        items,
        items,
        /* listLoading */ true,
      ),
    ).toEqual({ action: 'wait' });
  });

  it('navigates to the item id once settled and visible (issue #644)', async () => {
    const { resolveReclassifyHandoff } = await import('../InboxPage');

    const items = [
      { inboxItemId: 'item-other' },
      { inboxItemId: 'item-target' },
    ];
    expect(
      resolveReclassifyHandoff('item-target', items, items, false),
    ).toEqual({
      action: 'navigate',
      id: 'item-target',
    });
  });

  it('gives up once settled and the target never appears in the UNFILTERED list', async () => {
    const { resolveReclassifyHandoff } = await import('../InboxPage');

    // The exact review-round-3 scenario: an unrelated search filter must not
    // matter here — the target is absent from `items` itself, not merely
    // filtered out, so there is nothing left to wait for.
    const items = [{ inboxItemId: 'item-unrelated' }];
    const filteredItems: typeof items = [];
    expect(
      resolveReclassifyHandoff('item-target', items, filteredItems, false),
    ).toEqual({ action: 'giveUp' });
  });

  it('gives up once settled when the target exists but is hidden by the active filter', async () => {
    const { resolveReclassifyHandoff } = await import('../InboxPage');

    // Present in the unfiltered list (it DID arrive) but absent from the
    // caller-filtered list (e.g. active search text hides it) — no index to
    // navigate to, so this must also resolve rather than wait forever.
    const items = [{ inboxItemId: 'item-target' }];
    const filteredItems: typeof items = [];
    expect(
      resolveReclassifyHandoff('item-target', items, filteredItems, false),
    ).toEqual({ action: 'giveUp' });
  });
});

// ── 3. InboxDetail → onReclassified seam contract ──────────────────────────────

const mockInboxReclassifyV2Response: InboxReclassifyV2Response = {
  sourceGroupId: 'group-001',
  subItems: [
    {
      inboxItemId: 'item-post-split',
      groupKey: 'k',
      groupLabel: 'l',
      frameType: 'light',
      fileCount: 3,
    },
  ],
  needsReviewCount: 0,
};

const mockInboxReclassifyV2 = vi
  .fn()
  .mockResolvedValue(mockInboxReclassifyV2Response);

const mockPropertyRegistry: PropertyRegistryEntry[] = [];

vi.mock('@/bindings/index', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...mod,
    commands: {
      ...mod.commands,
      inboxReclassifyV2: async (...args: unknown[]) => ({
        status: 'ok',
        data: await mockInboxReclassifyV2(...args),
      }),
      inboxPropertyRegistry: () => ({
        status: 'ok',
        data: mockPropertyRegistry,
      }),
    },
  };
});

const sampleItem: InboxItemSummary = {
  inboxItemId: 'item-pre-split',
  relativePath: '2025-11-01/NGC891',
  fileCount: 3,
  lane: 'fits',
  format: 'fits',
  state: 'classified',
  contentSignature: 'sig-002',
  isMaster: false,
  masterFrameType: null,
  masterFilter: null,
  masterExposureS: null,
};

const unclassifiedClassification: InboxClassifyResponse = {
  inboxItemId: 'item-pre-split',
  type: 'unclassified',
  frameType: null,
  contentSignature: 'sig-002',
  breakdown: [],
  unclassifiedFiles: ['frame_0001.fits', 'frame_0002.fits'],
  sampleFiles: [],
  computedAt: '2025-11-01T20:00:00Z',
};

type ItemProp = Parameters<typeof InboxDetail>[0]['item'];
type ClassProp = Parameters<typeof InboxDetail>[0]['classification'];

describe('InboxDetail onReclassified seam (issue #755 CI fix)', () => {
  beforeEach(() => {
    mockInboxReclassifyV2.mockClear();
    mockInboxReclassifyV2.mockResolvedValue(mockInboxReclassifyV2Response);
  });

  it('fires onReclassified with the raw reclassify_v2 response (incl. subItems) after a bulk apply', async () => {
    const onReclassified = vi.fn();

    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={unclassifiedClassification as unknown as ClassProp}
        onReclassified={onReclassified}
      />,
    );

    fireEvent.click(screen.getByTestId('reclassify-select-all'));
    fireEvent.change(screen.getByTestId('bulk-frame-type'), {
      target: { value: 'light' },
    });
    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    await waitFor(() => expect(onReclassified).toHaveBeenCalledTimes(1));
    expect(onReclassified).toHaveBeenCalledWith(mockInboxReclassifyV2Response);
  });

  it('does not fire onReclassified when the caller omits the prop (optional, backward compatible)', async () => {
    render(
      <InboxDetail
        item={sampleItem as unknown as ItemProp}
        rootAbsolutePath="/astro/inbox"
        classification={unclassifiedClassification as unknown as ClassProp}
      />,
    );

    fireEvent.click(screen.getByTestId('reclassify-select-all'));
    fireEvent.change(screen.getByTestId('bulk-frame-type'), {
      target: { value: 'light' },
    });
    fireEvent.click(screen.getByTestId('bulk-apply-btn'));

    // No onReclassified prop supplied — apply must still resolve without throwing.
    await waitFor(() => expect(mockInboxReclassifyV2).toHaveBeenCalledTimes(1));
  });
});
