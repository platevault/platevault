// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Spec 058 T034 / FR-025 / SC-010 — grouping the Inbox list by folder.
 *
 * Once a folder no longer has an aggregate row, a folder holding several frame
 * types is N sibling rows sharing one path. Read flat, that is N
 * near-identical detections; grouped by folder it reads as "one folder, N
 * types", which is what FR-025 asks for.
 *
 * The dimension keys on `relativePath` because that IS a row's folder identity
 * — a materialized sub-item inherits its source folder's path — so siblings
 * collapse under one header without needing a source-group id the item rows do
 * not carry in the list DTO.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InboxList } from '../InboxList';
import { GROUPING_DIMENSIONS, ACCESSORS } from '../InboxControls';
import type { InboxListItem } from '@/bindings/index';

function makeItem(
  over: Partial<InboxListItem> & { inboxItemId: string },
): InboxListItem {
  return {
    relativePath: '2025-11-01/session',
    fileCount: 4,
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

describe('InboxList — grouping by folder (spec 058 T034)', () => {
  it('registers a folder dimension keyed on the row path', () => {
    const folder = GROUPING_DIMENSIONS.find((d) => d.id === 'folder');
    expect(folder).toBeDefined();
    expect(ACCESSORS.folder(makeItem({ inboxItemId: 'a' }))).toBe(
      '2025-11-01/session',
    );
  });

  it('collapses siblings of one folder under a single header', () => {
    render(
      <InboxList
        items={[
          makeItem({
            inboxItemId: 'light',
            groupKey: 'type=light',
            groupFrameType: 'light',
          }),
          makeItem({
            inboxItemId: 'dark',
            groupKey: 'type=dark',
            groupFrameType: 'dark',
          }),
          makeItem({
            inboxItemId: 'other',
            relativePath: '2025-11-02/other',
          }),
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
        dims={['folder']}
      />,
    );

    // Both siblings still render as their own selectable rows...
    expect(screen.getByTestId('inbox-item-light')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-item-dark')).toBeInTheDocument();

    // ...but the shared folder contributes exactly ONE group header, not one
    // per sibling. Asserted on the header testid rather than on the path text,
    // which also appears in each row's own path cell.
    expect(
      screen.getAllByTestId(/^inbox-group-folder-/),
    ).toHaveLength(2); // this folder + the unrelated one
    expect(
      screen.getByTestId('inbox-group-folder-2025-11-01/session'),
    ).toBeInTheDocument();
  });

  it('keeps folders apart rather than merging them into one bucket', () => {
    render(
      <InboxList
        items={[
          makeItem({ inboxItemId: 'a', relativePath: 'folder-a' }),
          makeItem({ inboxItemId: 'b', relativePath: 'folder-b' }),
        ]}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
        dims={['folder']}
      />,
    );

    expect(
      screen.getByTestId('inbox-group-folder-folder-a'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('inbox-group-folder-folder-b'),
    ).toBeInTheDocument();
  });
});
