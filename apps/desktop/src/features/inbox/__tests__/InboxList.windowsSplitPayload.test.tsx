// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Regression coverage for the exact `inbox.list` payload captured off a
 * failing Windows CI run of
 * `inbox_ui_mixed_folder_splits_into_single_type_items` (run 28801974726).
 *
 * On that run, a direct `inbox.list` invoke through the debug bridge
 * (bypassing the UI) returned the 2 split single-type items below, while the
 * real Inbox page rendered 0 rows for the same data — deterministic across
 * retries, Windows-only (Ubuntu passes). This test feeds the byte-for-byte
 * payload (Windows backslash `rootAbsolutePath`, empty `relativePath` for
 * root-level files, a shared `contentSignature`/`sourceGroupId` across the two
 * split sub-items, and a needs-review item missing several optional
 * `group*`/`groupLabel` fields entirely rather than carrying them as `null` —
 * all serde `skip_serializing_if` omissions) through `InboxList` directly.
 *
 * It passes: `InboxList`'s filter/sort/group pipeline (`InboxList.tsx`,
 * `@/lib/grouping`) renders both rows correctly for this exact shape, so the
 * list's own render logic is not the drop's cause. See the fix-lane report for
 * the full trace (also verified at the `useInboxList` query-hook layer and a
 * full `InboxPage` mount, both green) and the remaining hypotheses.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InboxList } from '../InboxList';
import type { InboxListItem } from '@/bindings/index';

const items = [
  {
    contentSignature:
      '7b83c3d36012047f1a791eb152565542192e0ff57f3b100ce3efa2e4e7c620ef',
    fileCount: 2,
    format: 'fits',
    groupDate: '2026-01-10',
    groupFilter: 'Ha',
    groupFrameType: 'dark',
    groupId: '1eac81eb-931a-473e-a6eb-c1e9a984e32c',
    groupKey: '',
    groupTarget: 'M42',
    needsReview: false,
    inboxItemId: '1eac81eb-931a-473e-a6eb-c1e9a984e32c',
    isMaster: false,
    lane: 'fits',
    organizationState: 'unorganized',
    relativePath: '',
    rootAbsolutePath: 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\.tmpVD3uMB',
    rootId: 'e8f831a2-c44a-4678-94cc-cbf3c3defbf1',
    sourceGroupId: 'f12fc26d-f7f5-4778-ac81-c9a29a940891',
    state: 'classified',
  },
  {
    contentSignature:
      '7b83c3d36012047f1a791eb152565542192e0ff57f3b100ce3efa2e4e7c620ef',
    fileCount: 2,
    format: 'fits',
    groupId: '94acc60b-cfef-45f6-8460-d1f23b76827d',
    groupKey: 'type=dark·filter=∅',
    groupLabel: '(root) · needs review',
    needsReview: true,
    inboxItemId: '94acc60b-cfef-45f6-8460-d1f23b76827d',
    isMaster: false,
    lane: 'fits',
    organizationState: 'unorganized',
    relativePath: '',
    rootAbsolutePath: 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\.tmpVD3uMB',
    rootId: 'e8f831a2-c44a-4678-94cc-cbf3c3defbf1',
    sourceGroupId: 'f12fc26d-f7f5-4778-ac81-c9a29a940891',
    state: 'classified',
  },
] as unknown as InboxListItem[];

describe('InboxList — Windows CI split-payload regression', () => {
  it('renders both split single-type rows for the captured Windows inbox.list payload', () => {
    render(
      <InboxList
        items={items}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.getAllByTestId(/^inbox-item-/).length).toBe(2);
    expect(
      screen.getByTestId(`inbox-item-${items[0].inboxItemId}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`inbox-item-${items[1].inboxItemId}`),
    ).toBeInTheDocument();
  });
});
