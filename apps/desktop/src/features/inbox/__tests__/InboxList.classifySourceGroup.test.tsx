// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Spec 058 FR-017 — a scanned-but-unclassified folder can be classified from
 * its row, without the row becoming selectable.
 *
 * The tension these tests hold: FR-016 says a source-group row must be
 * structurally non-confirmable (no item id, nothing to hand `inbox.confirm`),
 * while FR-017 says the user must be able to classify that folder. The
 * resolution is an explicit button that carries the `sourceGroupId` itself,
 * rather than making the row selectable — so `onSelect` is still never called
 * and the FR-016 invariant survives intact.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InboxList } from '../InboxList';
import type { InboxSourceGroupListItem } from '@/bindings/index';

function makeGroup(
  over: Partial<InboxSourceGroupListItem> & { sourceGroupId: string },
): InboxSourceGroupListItem {
  return {
    rootId: 'root-1',
    rootAbsolutePath: '/lib/root',
    relativePath: over.sourceGroupId,
    fileCount: 3,
    format: 'fits',
    lane: 'move',
    contentSignature: `sig-${over.sourceGroupId}`,
    discoveredAt: '2026-07-20T00:00:00Z',
    ...over,
  } as InboxSourceGroupListItem;
}

describe('InboxList — classifying a source group (spec 058 FR-017)', () => {
  it('hands the whole group to the callback, not an item id', () => {
    const onClassify = vi.fn();
    render(
      <InboxList
        items={[]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        onClassifySourceGroup={onClassify}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );

    fireEvent.click(screen.getByTestId('inbox-source-group-classify-sg-1'));

    expect(onClassify).toHaveBeenCalledTimes(1);
    // Both fields the IPC request needs must come off the row itself; there is
    // no item to look them up from.
    expect(onClassify.mock.calls[0][0]).toMatchObject({
      sourceGroupId: 'sg-1',
      rootAbsolutePath: '/lib/root',
    });
  });

  /**
   * The FR-016 invariant, re-asserted under FR-017. If a future refactor makes
   * the row clickable to "simplify" this, `onSelect` starts firing with a
   * `sourceGroupId` — which resolves to no item in `InboxPage`, so the stale
   * selection cleanup clears the URL param on the same commit and the detail
   * pane flickers empty. This test is what catches that.
   */
  it('classifying does not select the row', () => {
    const onSelect = vi.fn();
    render(
      <InboxList
        items={[]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        onClassifySourceGroup={vi.fn()}
        selectedId={null}
        onSelect={onSelect}
        filterType="all"
      />,
    );

    fireEvent.click(screen.getByTestId('inbox-source-group-classify-sg-1'));

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('disables only the row whose classification is in flight', () => {
    render(
      <InboxList
        items={[]}
        sourceGroups={[
          makeGroup({ sourceGroupId: 'sg-busy' }),
          makeGroup({ sourceGroupId: 'sg-idle' }),
        ]}
        onClassifySourceGroup={vi.fn()}
        classifyingSourceGroupId="sg-busy"
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );

    expect(
      screen.getByTestId('inbox-source-group-classify-sg-busy'),
    ).toBeDisabled();
    expect(
      screen.getByTestId('inbox-source-group-classify-sg-idle'),
    ).not.toBeDisabled();
  });

  /**
   * Without the callback the row must keep its previous appearance. Existing
   * fixtures and any caller that has not adopted FR-017 yet render the static
   * label rather than a button that would do nothing when pressed.
   */
  it('falls back to the static label when no callback is supplied', () => {
    render(
      <InboxList
        items={[]}
        sourceGroups={[makeGroup({ sourceGroupId: 'sg-1' })]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );

    expect(
      screen.queryByTestId('inbox-source-group-classify-sg-1'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('not yet classified')).toBeInTheDocument();
  });
});
