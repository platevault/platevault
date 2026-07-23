// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * InboxStatsSummary tests — spec 041 US6 / T039, reworked for spec 043 #83.
 *
 * #83 collapsed the old folder/master/image TOTALS strip (which triplicated the
 * top-bar + status-bar counts) into a single compact per-frame-type breakdown
 * chip row. Asserts:
 * 1. One chip per per-type entry (frame type label + folder count).
 * 2. A type with masters annotates the master count.
 * 3. When perType is empty, the component renders nothing (null).
 * 4. useInboxStats triggers inboxStats() on mount.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks ────────────────────────────────────────────────────────────

const { mockInboxStats } = vi.hoisted(() => ({
  mockInboxStats: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: { inboxStats: mockInboxStats },
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
  it('renders one compact chip per per-type entry', () => {
    render(<InboxStatsSummary stats={statsWithTypes} />);

    expect(screen.getByTestId('inbox-stats-summary')).toBeInTheDocument();

    // Light chip: type label + folder count (8).
    const lightChip = screen.getByTestId('inbox-stats-type-light');
    expect(lightChip.textContent).toContain('light');
    expect(lightChip.textContent).toContain('8');

    // Dark chip: type label + folder count (4) + master annotation (+3m).
    const darkChip = screen.getByTestId('inbox-stats-type-dark');
    expect(darkChip.textContent).toContain('dark');
    expect(darkChip.textContent).toContain('4');
    expect(darkChip.textContent).toContain('+3m');
  });

  it('no longer renders the folder/master/image totals strip (#83)', () => {
    render(<InboxStatsSummary stats={statsWithTypes} />);
    // The totals moved to the top-bar summary + status bar.
    expect(screen.queryByTestId('inbox-stats-totals')).toBeNull();
    expect(screen.queryByTestId('inbox-stats-total-folders')).toBeNull();
  });

  it('renders nothing when perType is empty', () => {
    const { container } = render(<InboxStatsSummary stats={statsEmpty} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('inbox-stats-summary')).toBeNull();
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
    mockInboxStats.mockResolvedValue({ status: 'ok', data: statsWithTypes });

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
