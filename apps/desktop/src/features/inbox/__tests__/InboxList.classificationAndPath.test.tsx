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
        selectedId={null}
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

describe('InboxList — unsplit-folder badge agrees with inbox_classify (#711 Instance A)', () => {
  // classify() unconditionally sets `state = "classified"` once a folder is
  // scanned, even when the actual result is unclassified/mixed/needs-review
  // and the folder never split into materialized sub-items (no frameType/
  // groupFrameType, groupKey stays the placeholder's `""`). Without reading
  // `classificationResult` the row previously fell through to `state` and
  // rendered "classified" — disagreeing with the detail panel/inbox_classify.
  it('shows "unclassified", not "classified", when classificationResult says unclassified', () => {
    const items = [
      makeItem({
        inboxItemId: 'placeholder-unsplit',
        groupKey: '',
        groupFrameType: null,
        state: 'classified',
        classificationResult: 'unclassified',
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
    expect(screen.getByText('unclassified')).toBeInTheDocument();
    expect(screen.queryByText('classified')).not.toBeInTheDocument();
  });

  it('still shows "classified" when classificationResult agrees (no regression for a genuinely resolved unsplit folder)', () => {
    const items = [
      makeItem({
        inboxItemId: 'placeholder-resolved',
        groupKey: '',
        groupFrameType: null,
        state: 'classified',
        classificationResult: 'classified',
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
    expect(screen.getByText('classified')).toBeInTheDocument();
  });

  it('a plan_open item is never relabeled "unclassified", even with a stale classificationResult', () => {
    const items = [
      makeItem({
        inboxItemId: 'plan-open-stale',
        groupKey: '',
        groupFrameType: null,
        state: 'plan_open',
        classificationResult: 'unclassified',
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
    expect(screen.getByText('plan open')).toBeInTheDocument();
    expect(screen.queryByText('unclassified')).not.toBeInTheDocument();
  });
});

describe('InboxList — Format column sort matches the displayed value (#649)', () => {
  it('sorts master rows by their displayed spec 040 label, not the internal format tag', () => {
    // Displayed labels, ascending (locale compare): "FITS" < "Master Bias" <
    // "Master Dark". Sorting by the internal `formatTag` (always "FITS" for
    // masters, ignoring the displayed master-label swap) left masters
    // interleaved arbitrarily with plain FITS rows instead.
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
      'inbox-item-plain-fits',
      'inbox-item-bias-master',
      'inbox-item-dark-master',
    ]);
  });
});
