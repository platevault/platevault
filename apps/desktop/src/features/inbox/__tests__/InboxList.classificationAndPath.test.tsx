// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Regression coverage for two Inbox list findings from the Journey 8
 * validation campaign (fixtures: `docs/development/fixtures/gen_detection_matrix.py`):
 *
 * - #550: a single-file materialized sub-item must classify to its own
 *   authoritative `frameType`, never the legacy aggregate-with-"Mixed"-
 *   fallback `groupFrameType`.
 * - #556: the "Detection" column is relabelled "Path", and a root-level item
 *   (empty `relativePath`) shows the source root's own basename instead of
 *   the constant `"(root)"` (indistinguishable across ~100+ rows in a real
 *   library).
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InboxList } from '../InboxList';
import type { InboxListItem } from '@/bindings/index';

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
    ...over,
  } as InboxListItem;
}

describe('InboxList — classification label + path column (#550/#556)', () => {
  it('(#550) a single-file item with a stale aggregate "Mixed" groupFrameType shows its authoritative frameType', () => {
    const items = [
      makeItem({
        inboxItemId: 'masterBiass',
        fileCount: 1,
        groupFrameType: 'Mixed',
        frameType: 'bias',
      }),
    ];
    render(
      <InboxList
        items={items}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.getByText('bias')).toBeInTheDocument();
    expect(screen.queryByText(/mixed/i)).not.toBeInTheDocument();
  });

  it('(#556) column header reads "Path", not "Detection"', () => {
    render(
      <InboxList
        items={[makeItem({ inboxItemId: 'a' })]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Sort by Path' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Detection')).not.toBeInTheDocument();
  });

  it('(#556) a root-level item (empty relativePath) shows the root basename, not the literal "(root)"', () => {
    const items = [
      makeItem({
        inboxItemId: 'root-item',
        relativePath: '',
        rootAbsolutePath: 'D:\\astrophotography\\ALM test\\DetectionMatrix',
      }),
    ];
    render(
      <InboxList
        items={items}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.getByText('DetectionMatrix')).toBeInTheDocument();
    expect(screen.queryByText('(root)')).not.toBeInTheDocument();
  });
});
