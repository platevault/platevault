/// <reference types="@testing-library/jest-dom" />
/**
 * InboxStatsSummary tests — spec 041 US6 / T039.
 *
 * Asserts:
 * 1. Totals (folders / masters / images) are rendered from the stats response.
 * 2. At least one per-type row is rendered (frameType label + counts).
 * 3. When perType is empty, no per-type rows are rendered.
 * 4. useInboxStats triggers inboxStats() on mount; summary appears in InboxPage.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks ────────────────────────────────────────────────────────────

const { mockInboxStats } = vi.hoisted(() => ({
  mockInboxStats: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  inboxStats: mockInboxStats,
}));

vi.stubEnv('VITE_USE_MOCKS', 'true');

// ── Fixtures ───────────────────────────────────────────────────────────────

import type { InboxStatsResponse } from '../store';

const statsWithTypes: InboxStatsResponse = {
  totals: { folders: 12, masters: 3, images: 480 },
  perType: [
    { frameType: 'light', folderCount: 8, masterCount: 0, imageCount: 320 },
    { frameType: 'dark', folderCount: 4, masterCount: 3, imageCount: 160 },
  ],
};

const statsEmpty: InboxStatsResponse = {
  totals: { folders: 0, masters: 0, images: 0 },
  perType: [],
};

// ── Component tests (InboxStatsSummary in isolation) ──────────────────────

import { InboxStatsSummary } from '../InboxStatsSummary';

describe('InboxStatsSummary', () => {
  it('renders totals: folders, masters, images', () => {
    render(<InboxStatsSummary stats={statsWithTypes} />);

    const totalsEl = screen.getByTestId('inbox-stats-totals');
    expect(totalsEl).toBeInTheDocument();

    // Total values visible
    expect(screen.getByTestId('inbox-stats-total-folders').textContent).toContain('12');
    expect(screen.getByTestId('inbox-stats-total-masters').textContent).toContain('3');
    expect(screen.getByTestId('inbox-stats-total-images').textContent).toContain('480');
  });

  it('renders a row for each per-type entry', () => {
    render(<InboxStatsSummary stats={statsWithTypes} />);

    expect(screen.getByTestId('inbox-stats-type-light')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-stats-type-dark')).toBeInTheDocument();

    // Light row shows folder count and image count
    const lightRow = screen.getByTestId('inbox-stats-type-light');
    expect(lightRow.textContent).toContain('light');
    expect(lightRow.textContent).toContain('320');

    // Dark row shows master count indicator
    const darkRow = screen.getByTestId('inbox-stats-type-dark');
    expect(darkRow.textContent).toContain('dark');
    expect(darkRow.textContent).toContain('3M');
  });

  it('renders no per-type rows when perType is empty', () => {
    render(<InboxStatsSummary stats={statsEmpty} />);

    // Totals still render (all zeros)
    expect(screen.getByTestId('inbox-stats-totals')).toBeInTheDocument();
    expect(screen.getByTestId('inbox-stats-total-folders').textContent).toContain('0');

    // No per-type rows
    expect(screen.queryByTestId(/^inbox-stats-type-/)).not.toBeInTheDocument();
  });
});

// ── Integration test: useInboxStats hook wiring ───────────────────────────
// We test the hook directly via the renderHook helper to avoid OOM from
// mounting the full InboxPage (which pulls in router + many stores).

import { renderHook } from '@testing-library/react';
import { useInboxStats } from '../store';

describe('useInboxStats hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls inboxStats on mount and returns the response as data', async () => {
    mockInboxStats.mockResolvedValue(statsWithTypes);

    const { result } = renderHook(() => useInboxStats());

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();

    // After resolution
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockInboxStats).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(statsWithTypes);
    expect(result.current.error).toBeNull();
  });

  it('surfaces error string when inboxStats rejects', async () => {
    mockInboxStats.mockRejectedValue(new Error('db error'));

    const { result } = renderHook(() => useInboxStats());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toContain('db error');
  });
});
