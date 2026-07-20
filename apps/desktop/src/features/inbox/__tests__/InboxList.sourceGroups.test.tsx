// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Spec 058 T013 / FR-016 — a scanned-but-unclassified folder renders as a
 * source-group row that is **structurally** non-confirmable.
 *
 * "Structurally" is the load-bearing word and what these tests pin: the row
 * carries no `inboxItemId`, and its selection is reported through a separate
 * callback (`onSelectSourceGroup`), so there is no value the confirm path could
 * receive. A test asserting only "Confirm is disabled" would pass equally
 * against a guard, which FR-016 explicitly rejects — so the assertions here are
 * about which callback fires and what the row does NOT carry.
 *
 * Two filter behaviours are pinned for reasons that are easy to get backwards:
 *
 * - The lane filter (`fits`/`video`) must read the group's `format`, NOT its
 *   `lane` column. A source group's `lane` is the `move`/`catalogue` lane — a
 *   different axis that shares the name (`InboxSourceGroupListItem`). Filtering
 *   on it would match `"move"` against `"fits"` and hide every group.
 * - The kind filter (a specific frame type) must drop source groups entirely.
 *   An unclassified folder has no frame type, so surfacing it under "bias"
 *   would be the claim-what-you-are-not shape #711 is about.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InboxList } from '../InboxList';
import type { InboxListItem, InboxSourceGroupListItem } from '@/bindings/index';

function makeGroup(
  over: Partial<InboxSourceGroupListItem> & { sourceGroupId: string },
): InboxSourceGroupListItem {
  return {
    rootId: 'root-1',
    rootAbsolutePath: '/lib/root',
    relativePath: over.sourceGroupId,
    fileCount: 12,
    format: 'fits',
    lane: 'move',
    contentSignature: `sig-${over.sourceGroupId}`,
    discoveredAt: '2026-07-20T10:00:00Z',
    ...over,
  } as InboxSourceGroupListItem;
}

function makeItem(
  over: Partial<InboxListItem> & { inboxItemId: string },
): InboxListItem {
  return {
    relativePath: over.inboxItemId,
    fileCount: 1,
    lane: 'fits',
    format: 'fits',
    state: 'classified',
    contentSignature: `sig-${over.inboxItemId}`,
    isMaster: false,
    masterFrameType: null,
    masterFilter: null,
    masterExposureS: null,
    rootAbsolutePath: '/lib/root',
    organizationState: 'unorganized',
    groupTarget: null,
    groupFrameType: null,
    groupDate: null,
    groupFilter: null,
    groupExposure: null,
    groupInstrument: null,
    groupId: over.inboxItemId,
    groupKey: 'type=dark',
    needsReview: false,
    ...over,
  } as InboxListItem;
}

describe('InboxList — scanned-but-unclassified source-group rows (058 T013)', () => {
  it('renders a source-group row with its path, file count and format', () => {
    render(
      <InboxList
        items={[]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1', fileCount: 41 })]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );

    const row = screen.getByTestId('inbox-source-group-sg-1');
    expect(row).toBeInTheDocument();
    expect(row).toHaveTextContent('sg-1');
    expect(row).toHaveTextContent('41 files');
    expect(row).toHaveTextContent('FITS');
  });

  it('selecting a source-group row reports it through onSelectSourceGroup, never onSelect', () => {
    const onSelect = vi.fn();
    const onSelectSourceGroup = vi.fn();
    render(
      <InboxList
        items={[]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        selectedId={null}
        onSelect={onSelect}
        onSelectSourceGroup={onSelectSourceGroup}
        filterType="all"
      />,
    );

    fireEvent.click(screen.getByTestId('inbox-source-group-sg-1'));

    expect(onSelectSourceGroup).toHaveBeenCalledWith('sg-1');
    // The confirm path is driven by the selected ITEM. If a source-group click
    // could reach `onSelect`, the row would become confirmable by accident —
    // which is precisely the structural boundary FR-016 draws.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not render an item testid for a source-group row (it has no item id)', () => {
    render(
      <InboxList
        items={[]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );

    expect(screen.queryByTestId('inbox-item-sg-1')).not.toBeInTheDocument();
  });

  it('the lane filter reads the group format, not its move/catalogue lane column', () => {
    const groups = [
      makeGroup({ sourceGroupId: 'sg-fits', format: 'fits', lane: 'move' }),
      makeGroup({
        sourceGroupId: 'sg-video',
        format: 'video',
        lane: 'catalogue',
      }),
    ];

    const { rerender } = render(
      <InboxList
        items={[]}
        sourceGroups={groups}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="fits"
      />,
    );
    expect(
      screen.getByTestId('inbox-source-group-sg-fits'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('inbox-source-group-sg-video'),
    ).not.toBeInTheDocument();

    rerender(
      <InboxList
        items={[]}
        sourceGroups={groups}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="video"
      />,
    );
    expect(
      screen.getByTestId('inbox-source-group-sg-video'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('inbox-source-group-sg-fits'),
    ).not.toBeInTheDocument();
  });

  it('an active kind filter hides source groups — an unclassified folder has no frame type', () => {
    render(
      <InboxList
        items={[]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
        kindFilter="bias"
      />,
    );

    expect(
      screen.queryByTestId('inbox-source-group-sg-1'),
    ).not.toBeInTheDocument();
  });

  it('source-group rows and item rows sort as one sequence, not two blocks', () => {
    render(
      <InboxList
        items={[
          makeItem({ inboxItemId: 'a-item' }),
          makeItem({ inboxItemId: 'z-item' }),
        ]}
        sourceGroups={[makeGroup({ sourceGroupId: 'm-group' })]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
        sort={{ col: 'detection', dir: 'asc' }}
      />,
    );

    const testids = screen
      .getAllByTestId(/^inbox-(item|source-group)-/)
      .map((el) => el.getAttribute('data-testid'));
    expect(testids).toEqual([
      'inbox-item-a-item',
      'inbox-source-group-m-group',
      'inbox-item-z-item',
    ]);
  });

  it('grouping keeps source-group rows visible rather than dropping them', () => {
    render(
      <InboxList
        items={[makeItem({ inboxItemId: 'i-1', groupFrameType: 'light' })]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
        dims={['frameType']}
      />,
    );

    // Grouping dimensions read item fields an unclassified folder has none of,
    // so the group row cannot sit in the tree — but it must not vanish, or the
    // user loses the folder by changing a view control.
    expect(screen.getByTestId('inbox-source-group-sg-1')).toBeInTheDocument();
  });
});
