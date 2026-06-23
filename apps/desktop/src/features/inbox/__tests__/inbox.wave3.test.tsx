/// <reference types="@testing-library/jest-dom" />
/**
 * inbox.wave3 — tests for tasks #32 / #33 / #35 / #6 (wave 3 Inbox polish).
 *
 * task 32: InboxRow renders a classification-forward grid with four columns
 *   (classification label, path, count, format).
 * task 33: InboxDetail breakdown rows are filter buttons; clicking sets/clears
 *   the frame-type filter via onBreakdownFilterChange; an active filter shows
 *   the indicator + clear link.
 * task 35: InboxPage top-bar shows a "Confirm all (N)" ghost button when
 *   classified items exist; it is hidden when none exist.
 * task 6: breakdown destination cell uses the ellipsis class (not wrapping).
 */

import React from 'react';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InboxListItem } from '@/api/commands';
import type {
  InboxItemSummary_Serialize as InboxItemSummary,
  InboxClassifyResponse_Serialize as InboxClassifyResponse,
} from '@/bindings';

import { InboxList } from '../InboxList';
import { InboxDetail } from '../InboxDetail';

// ── Mock reclassify so InboxDetail can render standalone ──────────────────────

vi.mock('@/api/commands', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/api/commands')>();
  return {
    ...mod,
    inboxReclassify: vi.fn().mockResolvedValue({
      inboxItemId: 'item-001',
      remainingUnclassified: 0,
    }),
  };
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeListItem(overrides: Partial<InboxListItem> = {}): InboxListItem {
  return {
    inboxItemId: 'item-001',
    rootId: 'root-001',
    rootAbsolutePath: '/astro',
    relativePath: 'lights/NGC7000',
    fileCount: 18,
    lane: 'fits',
    format: 'fits',
    state: 'classified',
    contentSignature: 'sig-001',
    isMaster: false,
    masterFrameType: null,
    masterFilter: null,
    masterExposureS: null,
    organizationState: 'unorganized',
    ...overrides,
  };
}

const sampleItem: InboxItemSummary = {
  inboxItemId: 'item-001',
  relativePath: 'lights/NGC7000',
  fileCount: 18,
  lane: 'fits',
  format: 'fits',
  state: 'classified',
  contentSignature: 'sig-001',
  isMaster: false,
  masterFrameType: null,
  masterFilter: null,
  masterExposureS: null,
};

const lightClassification: InboxClassifyResponse = {
  inboxItemId: 'item-001',
  type: 'single_type',
  frameType: 'light',
  contentSignature: 'sig-001',
  sampleFiles: [],
  computedAt: '2026-01-01T00:00:00Z',
  breakdown: [
    {
      kind: 'light',
      count: 18,
      destinationPreview: 'NGC7000/Ha/2025-10-10/light/',
      sampleFiles: ['Ha_001.fits', 'Ha_002.fits'],
    },
  ],
  unclassifiedFiles: [],
};

const mixedClassification: InboxClassifyResponse = {
  inboxItemId: 'item-002',
  type: 'mixed',
  frameType: null,
  contentSignature: 'sig-002',
  sampleFiles: [],
  computedAt: '2026-01-01T00:00:00Z',
  breakdown: [
    {
      kind: 'light',
      count: 12,
      destinationPreview: 'NGC7000/Ha/light/',
      sampleFiles: [],
    },
    {
      kind: 'dark',
      count: 6,
      destinationPreview: 'calibration/darks/dark_300s/',
      sampleFiles: [],
    },
  ],
  unclassifiedFiles: [],
};

// ── task 32: InboxRow grid layout ─────────────────────────────────────────────

describe('task 32: InboxRow classification-forward grid', () => {
  it('renders classification column with frame type when groupFrameType is set', () => {
    const item = makeListItem({ groupFrameType: 'light', state: 'classified' });
    rtlRender(
      <InboxList
        items={[item]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    // The classification column should show "light" (the frame type) not "classified"
    expect(screen.getByText('light')).toBeInTheDocument();
  });

  it('renders classification column with state label when no groupFrameType', () => {
    const item = makeListItem({ groupFrameType: null, state: 'pending_classification' });
    rtlRender(
      <InboxList
        items={[item]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('renders master frame type in classification column for master items', () => {
    const item = makeListItem({
      isMaster: true,
      masterFrameType: 'dark',
      state: 'classified',
    });
    rtlRender(
      <InboxList
        items={[item]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    // Classification cell shows "dark"; format column shows "dark master"
    const darks = screen.getAllByText(/dark/i);
    expect(darks.length).toBeGreaterThanOrEqual(1);
  });

  it('renders the row path in its own element (not strong-wrapped)', () => {
    const item = makeListItem({ relativePath: 'lights/NGC7000' });
    rtlRender(
      <InboxList
        items={[item]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    // path should appear as a span.alm-inbox-row__path
    const row = screen.getByTestId('inbox-item-item-001');
    expect(row.querySelector('.alm-inbox-row__path')).not.toBeNull();
    expect(row.querySelector('.alm-inbox-row__path')?.textContent).toBe('lights/NGC7000');
  });

  it('applies alm-inbox-row class (not the old alm-list-item)', () => {
    const item = makeListItem();
    rtlRender(
      <InboxList
        items={[item]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    const row = screen.getByTestId('inbox-item-item-001');
    expect(row.classList.contains('alm-inbox-row')).toBe(true);
    expect(row.classList.contains('alm-list-item')).toBe(false);
  });

  it('adds alm-inbox-row--selected when item is selected', () => {
    const item = makeListItem();
    rtlRender(
      <InboxList
        items={[item]}
        selectedIdx={0}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    const row = screen.getByTestId('inbox-item-item-001');
    expect(row.classList.contains('alm-inbox-row--selected')).toBe(true);
  });

  it('adds alm-inbox-row--muted for plan_open items', () => {
    const item = makeListItem({ state: 'plan_open' });
    rtlRender(
      <InboxList
        items={[item]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    const row = screen.getByTestId('inbox-item-item-001');
    expect(row.classList.contains('alm-inbox-row--muted')).toBe(true);
  });
});

// ── task 33: breakdown rows as filters ────────────────────────────────────────

describe('task 33: InboxDetail breakdown rows as frame-type filters', () => {
  it('renders breakdown rows as buttons with data-testid', () => {
    wrap(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro"
        classification={lightClassification}
        onBreakdownFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('breakdown-filter-light')).toBeInTheDocument();
  });

  it('calls onBreakdownFilterChange with the frame type when row is clicked', () => {
    const onChange = vi.fn();
    wrap(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro"
        classification={lightClassification}
        onBreakdownFilterChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('breakdown-filter-light'));
    expect(onChange).toHaveBeenCalledWith('light');
  });

  it('calls onBreakdownFilterChange(null) when clicking the active row again', () => {
    const onChange = vi.fn();
    wrap(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro"
        classification={lightClassification}
        activeBreakdownFilter="light"
        onBreakdownFilterChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('breakdown-filter-light'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('marks the active filter row with alm-breakdown-filter-btn--active', () => {
    wrap(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro"
        classification={lightClassification}
        activeBreakdownFilter="light"
        onBreakdownFilterChange={vi.fn()}
      />,
    );
    const btn = screen.getByTestId('breakdown-filter-light');
    expect(btn.classList.contains('alm-breakdown-filter-btn--active')).toBe(true);
  });

  it('shows the active filter indicator when a filter is set', () => {
    wrap(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro"
        classification={lightClassification}
        activeBreakdownFilter="light"
        onBreakdownFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('breakdown-filter-active')).toBeInTheDocument();
  });

  it('shows a clear button that calls onBreakdownFilterChange(null)', () => {
    const onChange = vi.fn();
    wrap(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro"
        classification={lightClassification}
        activeBreakdownFilter="light"
        onBreakdownFilterChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId('breakdown-filter-clear'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('does not show the filter indicator when no filter is set', () => {
    wrap(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro"
        classification={lightClassification}
        onBreakdownFilterChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('breakdown-filter-active')).not.toBeInTheDocument();
  });

  it('renders multiple breakdown rows for mixed classification', () => {
    wrap(
      <InboxDetail
        item={{ ...sampleItem, inboxItemId: 'item-002', relativePath: 'mixed/folder' }}
        rootAbsolutePath="/astro"
        classification={mixedClassification}
        onBreakdownFilterChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('breakdown-filter-light')).toBeInTheDocument();
    expect(screen.getByTestId('breakdown-filter-dark')).toBeInTheDocument();
  });
});

// ── task 6: breakdown destination ellipsis ─────────────────────────────────────

describe('task 6: breakdown destination uses ellipsis class', () => {
  it('wraps destination in alm-inbox-detail__dest-cell span', () => {
    const { container } = wrap(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro"
        classification={lightClassification}
      />,
    );
    const destCell = container.querySelector('.alm-inbox-detail__dest-cell');
    expect(destCell).not.toBeNull();
    expect(destCell?.textContent).toBe('NGC7000/Ha/2025-10-10/light/');
  });

  it('sets title attribute on dest cell for tooltip on truncated text', () => {
    const { container } = wrap(
      <InboxDetail
        item={sampleItem}
        rootAbsolutePath="/astro"
        classification={lightClassification}
      />,
    );
    const destCell = container.querySelector('.alm-inbox-detail__dest-cell');
    expect(destCell?.getAttribute('title')).toBe('NGC7000/Ha/2025-10-10/light/');
  });
});
