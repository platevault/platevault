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
    needsReview: false,
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
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.getByText('bias')).toBeInTheDocument();
    expect(screen.queryByText(/mixed/i)).not.toBeInTheDocument();
  });

  // Spec 058 T008/FR-028: needs-review is the backend's persisted verdict on
  // its own field. The old two-signal guess (`groupKey === '__needs_review__'`
  // OR a non-empty `missingMandatory`) is gone, so both directions must hold:
  // the field alone drives the label, and a classification-identity groupKey
  // does not suppress it.
  it('(058) the needs-review label comes from `needsReview`, not from `groupKey`', () => {
    const items = [
      makeItem({
        inboxItemId: 'nr',
        groupKey: 'type=light·filter=∅',
        frameType: null,
        needsReview: true,
      }),
    ];
    render(
      <InboxList
        items={items}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.getByText('needs review')).toBeInTheDocument();
  });

  // `frameType` and `groupFrameType` are deliberately null: both are checked
  // BEFORE the needs-review branch in `classificationLabel`, so a fixture
  // carrying either returns early and the negative assertion holds regardless
  // of what `isNeedsReview` reports — the classic vacuous negative. With them
  // null the branch is genuinely exercised.
  it('(058) `needsReview: false` on a frame-typeless item is not labelled needs review', () => {
    const items = [
      makeItem({
        inboxItemId: 'ok',
        groupKey: 'type=light·filter=Ha',
        frameType: null,
        groupFrameType: null,
        state: 'pending_classification',
        needsReview: false,
      }),
    ];
    render(
      <InboxList
        items={items}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.queryByText('needs review')).not.toBeInTheDocument();
  });

  it('(#556) column header reads "Path", not "Detection"', () => {
    render(
      <InboxList
        items={[makeItem({ inboxItemId: 'a' })]}
        selectedId={null}
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
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.getByText('DetectionMatrix')).toBeInTheDocument();
    expect(screen.queryByText('(root)')).not.toBeInTheDocument();
  });

  // #605: Confirm creates a plan but the row previously gave no visible sign
  // of it — the Type column keeps showing the item's dominant frame type
  // (frameType is checked before `state` in classificationLabel), so a
  // plan_open item looked byte-for-byte identical to one still awaiting
  // confirm. A "Plan pending review" chip on the row is the additive fix.
  it('(#605) a plan_open item shows a "Plan pending review" chip alongside its frame type', () => {
    const items = [
      makeItem({
        inboxItemId: 'has-plan',
        state: 'plan_open',
        frameType: 'dark',
      }),
    ];
    render(
      <InboxList
        items={items}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    // The Type column is unchanged (still "dark") — the chip is additive.
    expect(screen.getByText('dark')).toBeInTheDocument();
    expect(
      screen.getByTestId('inbox-item-plan-pending-has-plan'),
    ).toHaveTextContent('Plan pending review');
  });

  it('(#605) a classified item with no open plan shows no chip', () => {
    const items = [
      makeItem({
        inboxItemId: 'no-plan',
        state: 'classified',
        frameType: 'dark',
      }),
    ];
    render(
      <InboxList
        items={items}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(
      screen.queryByTestId('inbox-item-plan-pending-no-plan'),
    ).not.toBeInTheDocument();
  });
});

describe('InboxList — Format column sort matches the displayed value (#649)', () => {
  it('sorts master rows by their displayed "{type} master" label, not the internal format tag', () => {
    // Displayed labels, ascending (locale compare): "bias master" <
    // "dark master" < "FITS". Sorting by the internal `formatTag` (always
    // "FITS" for masters, ignoring the displayed "{type} master" swap) left
    // masters interleaved arbitrarily with plain FITS rows instead.
    const items = [
      makeItem({
        inboxItemId: 'dark-master',
        isMaster: true,
        masterFrameType: 'dark',
      }),
      makeItem({ inboxItemId: 'plain-fits' }),
      makeItem({
        inboxItemId: 'bias-master',
        isMaster: true,
        masterFrameType: 'bias',
      }),
    ];
    render(
      <InboxList
        items={items}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
        sort={{ col: 'format', dir: 'asc' }}
      />,
    );
    const rows = screen.getAllByTestId(/^inbox-item-/);
    const order = rows.map((r) => r.getAttribute('data-testid'));
    expect(order).toEqual([
      'inbox-item-bias-master',
      'inbox-item-dark-master',
      'inbox-item-plain-fits',
    ]);
  });
});
