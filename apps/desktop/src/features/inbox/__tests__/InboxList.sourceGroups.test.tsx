// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Spec 058 FR-016 / T013 (UI half) — a scanned-but-unclassified folder renders
 * as a source-group row that is **structurally non-confirmable**.
 *
 * "Structurally" is the whole point of FR-016 and is what these tests pin: the
 * row carries no `inboxItemId`, so there is no id to hand to `inbox.confirm`
 * and clicking it cannot select anything. A guard that refuses a confirm is a
 * runtime promise that a later refactor can quietly break; an absent id cannot
 * be broken by a refactor because there is nothing to break.
 *
 * These rows are inert on this branch — scan still writes a folder placeholder
 * item, so `inbox.list` always returns `sourceGroups: []` until T020. The
 * fixtures below therefore supply the array directly rather than going through
 * the backend, which is exactly why the UI half could land ahead of T020.
 */

import { render, screen, fireEvent } from '@testing-library/react';
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
    fileCount: 3,
    format: 'fits',
    // NOTE: the source group's own lane vocabulary — 'move' | 'catalogue'.
    // NOT the item lane ('fits' | 'video'). See the #854 test below.
    lane: 'move',
    contentSignature: `sig-${over.sourceGroupId}`,
    discoveredAt: '2026-07-20T00:00:00Z',
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
    groupFrameType: 'light',
    groupDate: null,
    groupFilter: null,
    groupExposure: null,
    groupInstrument: null,
    groupId: over.inboxItemId,
    groupKey: 'type=light',
    needsReview: false,
    ...over,
  } as InboxListItem;
}

describe('InboxList — source-group rows (spec 058 FR-016 / T013)', () => {
  it('renders a scanned-but-unclassified folder as its own row', () => {
    render(
      <InboxList
        items={[]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );

    expect(screen.getByTestId('inbox-source-group-sg-1')).toBeInTheDocument();
    expect(screen.getByText('not yet classified')).toBeInTheDocument();
    // The empty-state must not win when the only rows are source groups.
    expect(screen.queryByText('No detections.')).not.toBeInTheDocument();
  });

  it('is structurally non-confirmable: clicking it selects nothing', () => {
    const onSelect = vi.fn();
    render(
      <InboxList
        items={[]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        selectedId={null}
        onSelect={onSelect}
        filterType="all"
      />,
    );

    fireEvent.click(screen.getByTestId('inbox-source-group-sg-1'));

    // No item id exists to select, so nothing can be handed to the detail pane
    // and therefore nothing can reach `inbox.confirm`.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders source groups above item rows', () => {
    render(
      <InboxList
        items={[makeItem({ inboxItemId: 'item-1' })]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );

    const rows = screen.getAllByTestId(/^inbox-(source-group|item)-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'inbox-source-group-sg-1',
      'inbox-item-item-1',
    ]);
  });

  /**
   * Issue #854 regression guard. `inbox_source_groups.lane` is
   * `'move' | 'catalogue'`; `inbox_items.lane` is `'fits' | 'video'`. The
   * columns share a name and nothing else. Filtering source groups on
   * `group.lane` compares `'move'` against `'fits'` and hides every source
   * group under any lane filter — silently, with every static check green.
   *
   * Two-direction control (recorded 2026-07-20): swapping `sourceGroupLane`'s
   * body to `return group.lane;` fails this test with
   * `Unable to find an element by: [data-testid="inbox-source-group-sg-fits"]`
   * — i.e. the fits-lane group vanishes, the exact #854 shape. Restoring the
   * format-derived body passes.
   */
  it('(#854) filters source groups by format-derived lane, not by their move/catalogue lane', () => {
    render(
      <InboxList
        items={[]}
        sourceGroups={[
          makeGroup({ sourceGroupId: 'sg-fits', format: 'fits', lane: 'move' }),
          makeGroup({
            sourceGroupId: 'sg-video',
            format: 'video',
            lane: 'catalogue',
          }),
        ]}
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
  });

  it('hides source groups under a specific kind filter, since an unclassified folder has no frame type', () => {
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

  it('shows the root basename when the group sits directly in a root', () => {
    render(
      <InboxList
        items={[]}
        sourceGroups={[
          makeGroup({
            sourceGroupId: 'sg-1',
            relativePath: '',
            rootAbsolutePath: '/lib/AstroArchive',
          }),
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );

    expect(screen.getByText('AstroArchive')).toBeInTheDocument();
  });

  /**
   * Spec 058 FR-017 / Q-10 — the row's ONE action.
   *
   * FR-016 makes the row structurally non-confirmable; it does not make it
   * actionless. Classification is user-triggered rather than fired on render:
   * auto-firing would write `inbox_items` rows for folders nobody touched,
   * raise a blocking `MetadataUnreadable` per FITS-less folder, and transform
   * rows under the user — the churn FR-023 exists to prevent.
   */
  it('offers a Classify action that reports the group id', () => {
    const onClassifySourceGroup = vi.fn();
    const onSelect = vi.fn();
    render(
      <InboxList
        items={[]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        onClassifySourceGroup={onClassifySourceGroup}
        selectedId={null}
        onSelect={onSelect}
        filterType="all"
      />,
    );

    fireEvent.click(screen.getByTestId('inbox-source-group-classify-sg-1'));

    expect(onClassifySourceGroup).toHaveBeenCalledWith('sg-1');
    // The action must not smuggle in a selection identity — FR-016's structural
    // guarantee has to survive the row gaining a button.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('stays read-only when no classify handler is supplied', () => {
    render(
      <InboxList
        items={[]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );

    expect(screen.getByTestId('inbox-source-group-sg-1')).toBeInTheDocument();
    expect(
      screen.queryByTestId('inbox-source-group-classify-sg-1'),
    ).not.toBeInTheDocument();
  });

  it('disables the action for the group whose classification is in flight', () => {
    render(
      <InboxList
        items={[]}
        sourceGroups={[
          makeGroup({ sourceGroupId: 'sg-1' }),
          makeGroup({ sourceGroupId: 'sg-2' }),
        ]}
        onClassifySourceGroup={vi.fn()}
        classifyingSourceGroupId="sg-1"
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );

    expect(
      screen.getByTestId('inbox-source-group-classify-sg-1'),
    ).toBeDisabled();
    // Only the in-flight group is blocked; its siblings stay actionable.
    expect(
      screen.getByTestId('inbox-source-group-classify-sg-2'),
    ).not.toBeDisabled();
    expect(screen.getByText('classifying…')).toBeInTheDocument();
  });

  it('still renders source groups when grouping dimensions are active', () => {
    render(
      <InboxList
        items={[makeItem({ inboxItemId: 'item-1' })]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
        dims={['frameType']}
      />,
    );

    // A source group has no dimension value to group under, so it must not be
    // swallowed by the grouping engine.
    expect(screen.getByTestId('inbox-source-group-sg-1')).toBeInTheDocument();
  });
});
