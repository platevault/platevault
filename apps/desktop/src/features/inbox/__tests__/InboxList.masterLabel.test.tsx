// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Inbox master row label (spec 040 FR-006/US2, issue #754).
 *
 * The Format cell used to render the master's frame type alone, so a dark and
 * a flat master were indistinguishable from their exposure/filter. FR-006
 * requires "type · filter · exposure" on the persistent list, not only in the
 * first-run wizard's transient scan step.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InboxList } from '../InboxList';
import type { InboxListItem } from '@/bindings/index';

function makeMaster(
  over: Partial<InboxListItem> & { inboxItemId: string },
): InboxListItem {
  return {
    relativePath: over.inboxItemId,
    fileCount: 1,
    lane: 'fits',
    format: 'fits',
    state: 'classified',
    contentSignature: `sig-${over.inboxItemId}`,
    isMaster: true,
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

function renderList(items: InboxListItem[]) {
  render(
    <InboxList
      items={items}
      selectedId={null}
      onSelect={vi.fn()}
      filterType="all"
    />,
  );
}

describe('InboxList — master row label (#754)', () => {
  it('shows type and exposure for a dark master', () => {
    renderList([
      makeMaster({
        inboxItemId: 'd1',
        masterFrameType: 'dark',
        masterExposureS: 300,
      }),
    ]);
    expect(screen.getByText('Master Dark · 300 s')).toBeInTheDocument();
  });

  it('shows type and filter for a flat master', () => {
    renderList([
      makeMaster({
        inboxItemId: 'f1',
        masterFrameType: 'flat',
        masterFilter: 'Ha',
      }),
    ]);
    expect(screen.getByText('Master Flat · Ha')).toBeInTheDocument();
  });

  it('no longer renders the bare frame type that #754 reported', () => {
    renderList([
      makeMaster({
        inboxItemId: 'd2',
        masterFrameType: 'dark',
        masterExposureS: 300,
        masterFilter: 'L',
      }),
    ]);
    expect(screen.queryByText('dark master')).not.toBeInTheDocument();
    expect(screen.getByText('Master Dark · L · 300 s')).toBeInTheDocument();
  });
});
