/// <reference types="@testing-library/jest-dom" />
/**
 * Spec 041 (T021) — user-configurable multi-level grouping. Spec 043: the
 * grouping CONTROLS moved out of InboxList into the shared FilterToolbar on
 * InboxPage (driven by `useGrouping`); InboxList is now a controlled list that
 * receives the active `dims`. These tests mount both via a small harness that
 * mirrors the page wiring using FilterToolbar.grouping + useGrouping.
 *
 * Tests:
 * 1. Picking a grouping dimension renders nested, collapsible group headers
 *    with per-group item counts.
 * 2. Picking a SECOND dimension nests groups under the first ("then by").
 * 3. Selecting a row inside a group still calls onSelect with the row's
 *    ORIGINAL index in the unfiltered items array.
 * 4. The chosen ordered dimensions are persisted to localStorage and restored
 *    on a fresh mount.
 */

import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InboxList } from '../InboxList';
import { FilterToolbar } from '@/components';
import { useGrouping } from '@/lib/use-grouping';
import { GROUPING_DIMENSIONS, GROUPING_STORAGE_KEY } from '../InboxControls';
import type { InboxListItem } from '@/api/commands';

// ── Harness ───────────────────────────────────────────────────────────────────
// Mirrors InboxPage's wiring: useGrouping owns the grouping state,
// FilterToolbar.grouping renders the selects, dims fed to InboxList.
function Harness({
  items,
  onSelect = vi.fn(),
}: {
  items: InboxListItem[];
  onSelect?: (idx: number) => void;
}) {
  const { dims, setSlot } = useGrouping({
    storageKey: GROUPING_STORAGE_KEY,
    validIds: GROUPING_DIMENSIONS.map((d) => d.id),
    defaultDims: [],
  });
  return (
    <>
      <FilterToolbar
        grouping={{
          dimensions: GROUPING_DIMENSIONS.map((d) => ({ value: d.id, label: d.label() })),
          dims,
          setSlot,
        }}
      />
      <InboxList
        items={items}
        selectedIdx={null}
        onSelect={onSelect}
        filterType="all"
        dims={dims}
      />
    </>
  );
}

// ── Fixtures ────────────────────────────────────────────────────────────────────

function makeItem(over: Partial<InboxListItem> & { inboxItemId: string }): InboxListItem {
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
    ...over,
  } as InboxListItem;
}

// index 0: M31 / light, 1: M31 / dark, 2: NGC 7000 / light
const items: InboxListItem[] = [
  makeItem({ inboxItemId: 'a', groupTarget: 'M31', groupFrameType: 'light' }),
  makeItem({ inboxItemId: 'b', groupTarget: 'M31', groupFrameType: 'dark' }),
  makeItem({ inboxItemId: 'c', groupTarget: 'NGC 7000', groupFrameType: 'light' }),
];

beforeEach(() => {
  localStorage.clear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InboxList — configurable grouping', () => {
  it('(1) selecting a dimension renders group headers with counts', () => {
    render(<Harness items={items} />);

    // Default (no grouping): flat rows, no group headers.
    expect(screen.queryByTestId(/^inbox-group-/)).not.toBeInTheDocument();

    // Choose "Target" in the first grouping slot.
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'target' } });

    // Two target groups appear as collapsible headers.
    const m31 = screen.getByTestId('inbox-group-target-M31');
    const ngc = screen.getByTestId('inbox-group-target-NGC 7000');
    expect(m31).toBeInTheDocument();
    expect(ngc).toBeInTheDocument();
    expect(m31).toHaveAttribute('aria-expanded', 'true');

    // Count shown on the M31 header is 2.
    expect(within(m31).getByText('2')).toBeInTheDocument();
    expect(within(ngc).getByText('1')).toBeInTheDocument();
  });

  it('(2) adding a second dimension nests groups under the first', () => {
    render(<Harness items={items} />);

    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'target' } });
    fireEvent.change(screen.getByLabelText('Then group by (level 2)'), { target: { value: 'frameType' } });

    expect(screen.getByTestId('inbox-group-target-M31')).toBeInTheDocument();

    const frameTypeHeaders = screen.getAllByTestId(/^inbox-group-frameType-/);
    expect(frameTypeHeaders).toHaveLength(3);
    const labels = frameTypeHeaders.map((h) => h.getAttribute('data-testid'));
    expect(labels.filter((l) => l === 'inbox-group-frameType-light')).toHaveLength(2);
    expect(labels.filter((l) => l === 'inbox-group-frameType-dark')).toHaveLength(1);

    expect(screen.getByTestId('inbox-item-a')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-item-b')).toBeInTheDocument();
  });

  it('(3) selecting a row inside a group reports the original item index', () => {
    const onSelect = vi.fn();
    render(<Harness items={items} onSelect={onSelect} />);

    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'target' } });

    fireEvent.click(screen.getByTestId('inbox-item-c'));
    expect(onSelect).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByTestId('inbox-item-a'));
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });

  it('(3b) collapsing a group hides its leaf rows', () => {
    render(<Harness items={items} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'target' } });

    expect(screen.getByTestId('inbox-item-c')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('inbox-group-target-NGC 7000'));
    expect(screen.queryByTestId('inbox-item-c')).not.toBeInTheDocument();
    // M31 group untouched.
    expect(screen.getByTestId('inbox-item-a')).toBeInTheDocument();
  });

  // #83: the list no longer renders ListSidebar's folder/master COUNT footer
  // (that count moved to the top-bar summary + status bar). The only footer
  // affordance now is a grouping-state hint, shown only when grouping is active.
  it('(5) shows a grouping-state hint footer only when grouping is active', () => {
    render(<Harness items={items} />);

    // No grouping yet → no hint footer, and no legacy sidebar count.
    expect(screen.queryByTestId('inbox-grouping-hint')).toBeNull();
    expect(document.querySelector('.alm-list-sidebar__count')).toBeNull();

    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'target' } });

    const hint = screen.getByTestId('inbox-grouping-hint');
    expect(hint.textContent).toContain('Grouped by');
    expect(hint.textContent).toContain('Target');
  });

  it('(5b) renders no duplicate search box or count footer (single search lives in the top bar)', () => {
    render(<Harness items={items} />);

    expect(document.querySelector('.alm-list-sidebar__search')).toBeNull();
    expect(document.querySelector('.alm-list-sidebar__count')).toBeNull();
    expect(screen.queryByPlaceholderText(/search inbox/i)).toBeNull();
  });

  it('(4) persists the ordered dimensions to localStorage and restores them', () => {
    const { unmount } = render(<Harness items={items} />);

    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'target' } });
    fireEvent.change(screen.getByLabelText('Then group by (level 2)'), { target: { value: 'frameType' } });

    expect(JSON.parse(localStorage.getItem(GROUPING_STORAGE_KEY)!)).toEqual(['target', 'frameType']);

    unmount();
    cleanup();

    // Fresh mount restores the persisted grouping → nested headers render
    // without re-selecting dimensions.
    render(<Harness items={items} />);
    expect(screen.getByTestId('inbox-group-target-M31')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^inbox-group-frameType-/).length).toBeGreaterThan(0);
    expect((screen.getByLabelText('Group by') as HTMLSelectElement).value).toBe('target');
  });
});
