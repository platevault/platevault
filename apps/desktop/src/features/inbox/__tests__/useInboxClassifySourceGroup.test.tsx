// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * useInboxClassifySourceGroup (spec 058 FR-017).
 *
 * The operation materialises item rows as a backend side effect, which makes
 * the row that triggered it disappear: the source group leaves `sourceGroups`
 * and reappears as item rows on the next `inbox.list`. Two consequences are
 * pinned here.
 *
 * 1. The inbox list MUST be invalidated on success, or the group row stays on
 *    screen and the freshly materialised items never appear — the user presses
 *    Classify and, as far as the UI is concerned, nothing happens.
 * 2. Busy state is keyed by `sourceGroupId`, not a bare boolean, so a spinner
 *    is never left attached to a row that has since been erased.
 *
 * A failure must NOT invalidate: nothing was materialised, and a refetch would
 * only hide the error behind a list flicker.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryKeys } from '@/data/queryKeys';

const { mockClassifySourceGroup } = vi.hoisted(() => ({
  mockClassifySourceGroup: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: { inboxClassifySourceGroup: mockClassifySourceGroup },
}));

import { useInboxClassifySourceGroup } from '../store';

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  mockClassifySourceGroup.mockReset();
});

describe('useInboxClassifySourceGroup', () => {
  it('invalidates the inbox list so the group row turns over', async () => {
    mockClassifySourceGroup.mockResolvedValue({
      status: 'ok',
      data: { sourceGroupId: 'sg-1', materializedSubItemCount: 2 },
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useInboxClassifySourceGroup(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.classifySourceGroup({
        sourceGroupId: 'sg-1',
        rootAbsolutePath: '/lib/root',
      });
    });

    expect(mockClassifySourceGroup).toHaveBeenCalledWith({
      sourceGroupId: 'sg-1',
      rootAbsolutePath: '/lib/root',
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: queryKeys.inbox.list('all'),
    });
  });

  it('tracks the in-flight group by id, then clears it', async () => {
    let release: (v: unknown) => void = () => {};
    mockClassifySourceGroup.mockReturnValue(
      new Promise((res) => {
        release = res;
      }),
    );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useInboxClassifySourceGroup(), {
      wrapper: wrapper(client),
    });

    expect(result.current.classifyingGroupId).toBeNull();

    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.classifySourceGroup({
        sourceGroupId: 'sg-busy',
        rootAbsolutePath: '/lib/root',
      });
    });

    // The id — not `true` — is what the list needs to disable exactly one row.
    await waitFor(() =>
      expect(result.current.classifyingGroupId).toBe('sg-busy'),
    );

    await act(async () => {
      release({
        status: 'ok',
        data: { sourceGroupId: 'sg-busy', materializedSubItemCount: 1 },
      });
      await pending;
    });

    expect(result.current.classifyingGroupId).toBeNull();
  });

  it('surfaces the error and does not invalidate on failure', async () => {
    mockClassifySourceGroup.mockResolvedValue({
      status: 'error',
      error: { message: 'metadata.unreadable' },
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const spy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useInboxClassifySourceGroup(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(
        result.current.classifySourceGroup({
          sourceGroupId: 'sg-bad',
          rootAbsolutePath: '/lib/root',
        }),
      ).rejects.toBeDefined();
    });

    expect(result.current.classifyingGroupId).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
