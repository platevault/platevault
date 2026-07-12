/// <reference types="@testing-library/jest-dom" />
/**
 * useInboxPlanBreakdowns tests (spec 043 task #98).
 *
 * The hook preloads the AUTHORITATIVE per-type frame breakdown for every item
 * that has an open plan, regardless of which item is currently selected, so the
 * collapsed plan summary is accurate for UNSELECTED mixed folders (previously a
 * dominant-type guess like "41 darks").
 *
 * Covers:
 * - One classify query per target; the resolved `breakdown[]` is mapped per id.
 * - An item whose classify returns an empty breakdown is omitted from the map.
 * - No targets → no fetch, empty map.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { mockInboxClassify } = vi.hoisted(() => ({
  mockInboxClassify: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: { inboxClassify: mockInboxClassify },
}));

import { useInboxPlanBreakdowns } from '../store';
import type { InboxBreakdownTarget } from '../store';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function classifyResponse(
  itemId: string,
  breakdown: Array<{ kind: string; count: number }>,
) {
  return {
    inboxItemId: itemId,
    type: 'mixed',
    frameType: null,
    contentSignature: `sig-${itemId}`,
    breakdown: breakdown.map((b) => ({
      kind: b.kind,
      count: b.count,
      destinationPreview: null,
      sampleFiles: [],
    })),
    unclassifiedFiles: [],
    sampleFiles: [],
    computedAt: '2026-06-22T00:00:00Z',
  };
}

describe('useInboxPlanBreakdowns (#98)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches a classify per target and maps the breakdown by item id (incl. an UNSELECTED item)', async () => {
    mockInboxClassify.mockImplementation((req: { inboxItemId: string }) => {
      if (req.inboxItemId === 'a') {
        return Promise.resolve({
          status: 'ok',
          data: classifyResponse('a', [
            { kind: 'bias', count: 10 },
            { kind: 'dark', count: 16 },
            { kind: 'flat', count: 15 },
          ]),
        });
      }
      return Promise.resolve({
        status: 'ok',
        data: classifyResponse('b', [{ kind: 'light', count: 30 }]),
      });
    });

    const targets: InboxBreakdownTarget[] = [
      { inboxItemId: 'a', rootAbsolutePath: '/lib/root-a' },
      { inboxItemId: 'b', rootAbsolutePath: '/lib/root-b' },
    ];

    const { result } = renderHook(() => useInboxPlanBreakdowns(targets), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current['a']).toBeDefined();
      expect(result.current['b']).toBeDefined();
    });

    // Both items resolved their authoritative per-type tally — the unselected
    // mixed folder ('a') carries its real breakdown, not a dominant guess.
    expect(result.current['a']).toEqual([
      { kind: 'bias', count: 10 },
      { kind: 'dark', count: 16 },
      { kind: 'flat', count: 15 },
    ]);
    expect(result.current['b']).toEqual([{ kind: 'light', count: 30 }]);

    // One classify call per distinct target.
    expect(mockInboxClassify).toHaveBeenCalledTimes(2);
    expect(mockInboxClassify).toHaveBeenCalledWith(
      expect.objectContaining({
        inboxItemId: 'a',
        rootAbsolutePath: '/lib/root-a',
      }),
    );
  });

  it('omits an item whose classify returns an empty breakdown', async () => {
    mockInboxClassify.mockResolvedValue({
      status: 'ok',
      data: classifyResponse('a', []),
    });
    const targets: InboxBreakdownTarget[] = [
      { inboxItemId: 'a', rootAbsolutePath: '/lib/root-a' },
    ];

    const { result } = renderHook(() => useInboxPlanBreakdowns(targets), {
      wrapper,
    });

    await waitFor(() => expect(mockInboxClassify).toHaveBeenCalled());
    // Empty breakdown → no entry in the map (caller falls back to actions).
    expect(result.current['a']).toBeUndefined();
  });

  it('issues no fetch and returns an empty map for no targets', () => {
    const { result } = renderHook(() => useInboxPlanBreakdowns([]), {
      wrapper,
    });
    expect(mockInboxClassify).not.toHaveBeenCalled();
    expect(result.current).toEqual({});
  });
});
