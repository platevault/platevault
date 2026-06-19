/// <reference types="@testing-library/jest-dom" />
/**
 * spec 039 — cross-root Inbox list tests.
 *
 * 1. InboxList renders items from ≥2 roots (SC-001 / FR-002).
 * 2. Empty list (server filtered all confirmed out) renders nothing (FR-003).
 * 3. useInboxList fetches and returns data; refresh triggers re-fetch (FR-001).
 * 4. useInboxRescan calls inboxScanFolder once per unique root (FR-005).
 */

import { render, screen, waitFor, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InboxList } from '../InboxList';
import type { InboxListItem, InboxListResponse } from '@/api/commands';

// ── sync mock registered at module level (required by vitest hoisting) ────────

vi.mock('@/api/commands', () => ({
  inboxList: vi.fn(),
  inboxScanFolder: vi.fn(),
  inboxClassify: vi.fn(),
  inboxConfirm: vi.fn(),
  inboxReclassify: vi.fn(),
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const itemRoot1a: InboxListItem = {
  inboxItemId: 'item-r1-a',
  rootId: 'root-001',
  rootAbsolutePath: '/astro/raw',
  relativePath: '2025-10-10/NGC7000',
  fileCount: 18,
  lane: 'fits',
  state: 'classified',
  contentSignature: 'sig-a',
};

const itemRoot1b: InboxListItem = {
  inboxItemId: 'item-r1-b',
  rootId: 'root-001',
  rootAbsolutePath: '/astro/raw',
  relativePath: '2025-10-10/darks',
  fileCount: 50,
  lane: 'fits',
  state: 'pending_classification',
  contentSignature: 'sig-b',
};

const itemRoot2a: InboxListItem = {
  inboxItemId: 'item-r2-a',
  rootId: 'root-002',
  rootAbsolutePath: '/astro/inbox',
  relativePath: '2025-11-01/Jupiter',
  fileCount: 3,
  lane: 'video',
  state: 'pending_classification',
  contentSignature: 'sig-c',
};

const multiRootResponse: InboxListResponse = {
  items: [itemRoot1a, itemRoot1b, itemRoot2a],
  capped: false,
  limit: 500,
};

// ── T039-1: InboxList renders items from ≥2 roots ────────────────────────────

describe('T039-1: InboxList cross-root rendering (SC-001)', () => {
  it('shows items from both roots', () => {
    render(
      <InboxList
        items={multiRootResponse.items}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
        onFilterTypeChange={vi.fn()}
        groupBy="none"
        onGroupByChange={vi.fn()}
      />,
    );
    expect(screen.getByText('2025-10-10/NGC7000')).toBeInTheDocument();
    expect(screen.getByText('2025-10-10/darks')).toBeInTheDocument();
    expect(screen.getByText('2025-11-01/Jupiter')).toBeInTheDocument();
  });

  it('items span two distinct root ids', () => {
    const rootIds = new Set(multiRootResponse.items.map((i) => i.rootId));
    expect(rootIds.size).toBe(2);
  });
});

// ── T039-2: empty list ────────────────────────────────────────────────────────

describe('T039-2: confirmed items absent — empty list (FR-003)', () => {
  it('renders no inbox-item elements when the server returns an empty list', () => {
    render(
      <InboxList
        items={[]}
        selectedIdx={null}
        onSelect={vi.fn()}
        filterType="all"
        onFilterTypeChange={vi.fn()}
        groupBy="none"
        onGroupByChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId(/^inbox-item-/)).not.toBeInTheDocument();
  });
});

// ── T039-3: useInboxList hook ─────────────────────────────────────────────────

describe('T039-3: useInboxList hook (FR-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns items after loading', async () => {
    const { inboxList } = await import('@/api/commands');
    (inboxList as ReturnType<typeof vi.fn>).mockResolvedValue(multiRootResponse);

    const { useInboxList } = await import('../store');
    const { result } = renderHook(() => useInboxList());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data?.items).toHaveLength(3);
    expect(result.current.error).toBeNull();
  });

  it('refresh triggers a re-fetch', async () => {
    const { inboxList } = await import('@/api/commands');
    const mockFn = inboxList as ReturnType<typeof vi.fn>;
    mockFn.mockResolvedValue(multiRootResponse);

    const { useInboxList } = await import('../store');
    const { result } = renderHook(() => useInboxList());

    await waitFor(() => expect(result.current.loading).toBe(false));

    const callsBefore = mockFn.mock.calls.length;
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFn.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

// ── T039-4: useInboxRescan ────────────────────────────────────────────────────

describe('T039-4: useInboxRescan (FR-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls inboxScanFolder once per unique root', async () => {
    const { inboxScanFolder } = await import('@/api/commands');
    (inboxScanFolder as ReturnType<typeof vi.fn>).mockResolvedValue({
      rootId: 'root-001',
      items: [],
    });

    const { useInboxRescan } = await import('../store');
    const roots = [
      { rootId: 'root-001', rootAbsolutePath: '/astro/raw' },
      { rootId: 'root-002', rootAbsolutePath: '/astro/inbox' },
    ];
    const onComplete = vi.fn();
    const { result } = renderHook(() => useInboxRescan(roots, onComplete));

    await act(async () => {
      await result.current.rescan();
    });

    expect((inboxScanFolder as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('calls onComplete even when a root errors (offline root graceful failure)', async () => {
    const { inboxScanFolder } = await import('@/api/commands');
    (inboxScanFolder as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('root offline'),
    );

    const { useInboxRescan } = await import('../store');
    const roots = [{ rootId: 'root-001', rootAbsolutePath: '/astro/raw' }];
    const onComplete = vi.fn();
    const { result } = renderHook(() => useInboxRescan(roots, onComplete));

    await act(async () => {
      await result.current.rescan();
    });

    expect(onComplete).toHaveBeenCalledOnce();
  });
});
