// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * useInboxClassification metadata-invalidation tests (issue #1019).
 *
 * `inbox.classify` persists per-file extracted metadata rows as a backend side
 * effect. The `inbox.item.metadata` query only re-fetches when its itemId
 * changes, so on first selection it can resolve BEFORE those rows exist and
 * cache an empty file list — the FR-032 "required metadata missing" banner then
 * fails to render. The hook fixes this by invalidating that item's metadata
 * query once classify settles.
 *
 * Covers:
 * - After classify resolves, `metadata(itemId)` is invalidated exactly once
 *   (the once-per-settle bound doubles as the no-loop proof).
 * - A failed classify (no persisted rows) does NOT invalidate metadata.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '@/data/queryKeys';

const { mockInboxClassify } = vi.hoisted(() => ({
  mockInboxClassify: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: { inboxClassify: mockInboxClassify },
}));

import { useInboxClassification } from '../store';

function classifyOk(itemId: string) {
  return {
    status: 'ok',
    data: {
      inboxItemId: itemId,
      type: 'single_type',
      frameType: 'light',
      contentSignature: `sig-${itemId}`,
      breakdown: [],
      unclassifiedFiles: [],
      sampleFiles: [],
      computedAt: '2026-07-18T00:00:00Z',
    },
  };
}

function renderClassify(itemId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  const view = renderHook(() => useInboxClassification(itemId, '/lib/root'), {
    wrapper,
  });
  return { ...view, invalidateSpy };
}

/** How many of the recorded `invalidateQueries` calls target `metadata(itemId)`. */
function metadataInvalidationCount(calls: unknown[][], itemId: string): number {
  const key = JSON.stringify(queryKeys.inbox.metadata(itemId));
  return calls.filter(
    (c) =>
      JSON.stringify((c[0] as { queryKey?: unknown } | undefined)?.queryKey) ===
      key,
  ).length;
}

describe('useInboxClassification metadata invalidation (#1019)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invalidates the item metadata query exactly once after classify settles', async () => {
    mockInboxClassify.mockResolvedValue(classifyOk('item-1'));

    const { result, invalidateSpy } = renderClassify('item-1');

    await waitFor(() => expect(result.current.data).toBeDefined());
    await waitFor(() =>
      expect(
        metadataInvalidationCount(invalidateSpy.mock.calls, 'item-1'),
      ).toBe(1),
    );

    // Bounded: no second invalidation fires on subsequent renders (no loop).
    await new Promise((r) => setTimeout(r, 50));
    expect(metadataInvalidationCount(invalidateSpy.mock.calls, 'item-1')).toBe(
      1,
    );
  });

  it('does not invalidate metadata when classify fails (no rows persisted)', async () => {
    mockInboxClassify.mockRejectedValue(new Error('boom'));

    const { result, invalidateSpy } = renderClassify('item-2');

    await waitFor(() => expect(result.current.error).toBeDefined());
    await new Promise((r) => setTimeout(r, 50));
    expect(metadataInvalidationCount(invalidateSpy.mock.calls, 'item-2')).toBe(
      0,
    );
  });
});
