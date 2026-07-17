// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Spec 054 US3 (T018/T019/T020) — Inbox's permanent detail-dominant split.
 *
 * Two things are pinned here:
 *   1. Inbox's `ListPageLayout` usage resolves to the `'split'` placement at
 *      EVERY window width (FR-014: `forcedPlacement="split"` bypasses the
 *      adaptive side/bottom heuristic entirely) — never `'bottom'`.
 *   2. `InboxList`, narrowed for the ~360px split-list column (T019), shows
 *      only the essential Path/Type/Files columns and truncates an
 *      over-long detection name with a full-name tooltip rather than
 *      wrapping or overflowing the column.
 *
 * `useDetailDock.test.ts` already covers the generic `forcedPlacement`
 * precedence at the hook level; this test pins the INTEGRATION — Inbox's
 * actual `ListPageLayout` call shape — the same way
 * `ListPageLayout.containment.test.tsx` pins T004/T008.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ListPageLayout } from '@/components/ListPageLayout';
import { DetailPanel } from '@/components/DetailPanel';
import { InboxList } from '../InboxList';
import type { InboxListItem } from '@/bindings/index';

function setWindowWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
}

function renderInboxLayout() {
  return render(
    <ListPageLayout
      topBar={<div>bar</div>}
      dockPage="inbox"
      forcedPlacement="split"
      detail={<DetailPanel title="Selected detection">detail</DetailPanel>}
    >
      <div>list</div>
    </ListPageLayout>,
  );
}

describe('Inbox permanent split placement (spec 054 T018)', () => {
  it.each([
    320,
    900,
    DEFAULT_WIDE_WIDTH(),
  ])('resolves .alm-listpage__detail--split at window width %ipx, never bottom', (width) => {
    setWindowWidth(width);
    const { container } = renderInboxLayout();
    expect(
      container.querySelector('.alm-listpage__detail--split'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('.alm-listpage__main--split'),
    ).toBeInTheDocument();
    // The bottom-dock shape never renders alongside split.
    expect(
      container.querySelector('.alm-listpage__body--split'),
    ).toBeInTheDocument();
  });
});

/** A window width comfortably above every adaptive threshold (Targets' 1500px
 * is the highest), so the "never bottom" assertion covers the wide end too. */
function DEFAULT_WIDE_WIDTH(): number {
  return 2000;
}

// ── InboxList narrow presentation (T019) ────────────────────────────────────

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

describe('InboxList narrow split-column presentation (spec 054 T019)', () => {
  it('truncates an over-long detection name with a full-name tooltip', () => {
    const longName =
      'M31-Andromeda-Galaxy_LIGHT_2026-07-15_Ha-3nm_600s_-15C_frame-0042.fits';
    render(
      <InboxList
        items={[makeItem({ inboxItemId: 'long', relativePath: longName })]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    const cell = screen.getByText(longName);
    // CSS (`.alm-inbox-cell__path`, tables-lists.css) does the visual
    // ellipsis; the DOM contract this locks down is the full untruncated
    // string still rendering as the accessible `title` tooltip.
    expect(cell).toHaveAttribute('title', longName);
  });

  it('shows only the essential Path/Type/Files columns (no Format column)', () => {
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
    expect(
      screen.getByRole('button', { name: 'Sort by Type' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Sort by Files' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Format')).not.toBeInTheDocument();
  });

  it('folds the master flag into the Type cell (no dedicated Format cell to carry it)', () => {
    render(
      <InboxList
        items={[
          makeItem({
            inboxItemId: 'master-bias',
            isMaster: true,
            masterFrameType: 'bias',
          }),
        ]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.getByText('bias master')).toBeInTheDocument();
  });
});
