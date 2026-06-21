/// <reference types="@testing-library/jest-dom" />
/**
 * Spec 041 (T021) — user-configurable multi-level grouping in InboxList.
 *
 * Tests:
 * 1. Picking a grouping dimension renders nested, collapsible group headers
 *    with per-group item counts.
 * 2. Picking a SECOND dimension nests groups under the first ("then by").
 * 3. Selecting a row inside a group still calls onSelect with the row's
 *    ORIGINAL index in the unfiltered items array (selection stays correct
 *    through nesting).
 * 4. The chosen ordered dimensions are persisted to localStorage and restored
 *    on a fresh mount.
 */

import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InboxList, GROUPING_STORAGE_KEY } from '../InboxList';
import type { InboxListItem } from '@/api/commands';

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
    render(
      <InboxList items={items} selectedIdx={null} onSelect={vi.fn()} filterType="all" onFilterTypeChange={vi.fn()} />,
    );

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
    render(
      <InboxList items={items} selectedIdx={null} onSelect={vi.fn()} filterType="all" onFilterTypeChange={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'target' } });
    fireEvent.change(screen.getByLabelText('Then group by (level 2)'), { target: { value: 'frameType' } });

    // Top-level target group exists; its frameType subgroups (light, dark) nest
    // beneath it. The M31 subtree is queried via the leaf rows it contains, since
    // the same frameType testid can legitimately recur under other targets.
    expect(screen.getByTestId('inbox-group-target-M31')).toBeInTheDocument();

    // Two distinct frameType subgroups appear under M31 (light + dark) and one
    // under NGC 7000 (light) → three frameType headers total.
    const frameTypeHeaders = screen.getAllByTestId(/^inbox-group-frameType-/);
    expect(frameTypeHeaders).toHaveLength(3);
    const labels = frameTypeHeaders.map((h) => h.getAttribute('data-testid'));
    expect(labels.filter((l) => l === 'inbox-group-frameType-light')).toHaveLength(2);
    expect(labels.filter((l) => l === 'inbox-group-frameType-dark')).toHaveLength(1);

    // The M31 leaf rows (a, b) both render under the nested structure.
    expect(screen.getByTestId('inbox-item-a')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-item-b')).toBeInTheDocument();
  });

  it('(3) selecting a row inside a group reports the original item index', () => {
    const onSelect = vi.fn();
    render(
      <InboxList items={items} selectedIdx={null} onSelect={onSelect} filterType="all" onFilterTypeChange={vi.fn()} />,
    );

    // Group by target so NGC 7000 (original index 2) sits in its own group.
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'target' } });

    fireEvent.click(screen.getByTestId('inbox-item-c'));
    expect(onSelect).toHaveBeenCalledWith(2);

    // And the first M31 row (original index 0) still maps to 0.
    fireEvent.click(screen.getByTestId('inbox-item-a'));
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });

  it('(3b) collapsing a group hides its leaf rows', () => {
    render(
      <InboxList items={items} selectedIdx={null} onSelect={vi.fn()} filterType="all" onFilterTypeChange={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'target' } });

    expect(screen.getByTestId('inbox-item-c')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('inbox-group-target-NGC 7000'));
    expect(screen.queryByTestId('inbox-item-c')).not.toBeInTheDocument();
    // M31 group untouched.
    expect(screen.getByTestId('inbox-item-a')).toBeInTheDocument();
  });

  it('(4) persists the ordered dimensions to localStorage and restores them', () => {
    const { unmount } = render(
      <InboxList items={items} selectedIdx={null} onSelect={vi.fn()} filterType="all" onFilterTypeChange={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'target' } });
    fireEvent.change(screen.getByLabelText('Then group by (level 2)'), { target: { value: 'frameType' } });

    expect(JSON.parse(localStorage.getItem(GROUPING_STORAGE_KEY)!)).toEqual(['target', 'frameType']);

    // Tear down the first render's DOM before remounting so testid lookups are
    // unambiguous (localStorage persists across the cleanup).
    unmount();
    cleanup();

    // Fresh mount restores the persisted grouping → nested headers render
    // without re-selecting dimensions.
    render(
      <InboxList items={items} selectedIdx={null} onSelect={vi.fn()} filterType="all" onFilterTypeChange={vi.fn()} />,
    );
    expect(screen.getByTestId('inbox-group-target-M31')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^inbox-group-frameType-/).length).toBeGreaterThan(0);
    expect((screen.getByLabelText('Group by') as HTMLSelectElement).value).toBe('target');
  });
});
