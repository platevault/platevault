// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useFavourites.test.ts — unit tests for the database-backed favourite/star
 * store (spec 051 US2).
 *
 * Mocks the generated IPC bindings (`@/bindings/index`'s `commands` object)
 * instead of `localStorage`/`StorageEvent` — favourites are now backend-backed
 * state (`targets.favourites.list` / `.add` / `.remove`).
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryClient } from '@/data/queryClient';

// Every `useFavourites()` mount reads/writes the app-wide `queryClient`
// singleton (matching production, where `main.tsx` mounts the same instance)
// — `getFavouriteIds()`/`__resetFavouritesCacheForTests()` read that same
// singleton directly, so tests must wrap with it too (not an ad-hoc client)
// or the hook and the non-hook reads would diverge.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

type MockIpc = (...args: unknown[]) => Promise<unknown>;

const mockTargetFavouritesList = vi.fn<MockIpc>();
const mockTargetFavouritesAdd = vi.fn<MockIpc>();
const mockTargetFavouritesRemove = vi.fn<MockIpc>();

vi.mock('@/bindings/index', () => ({
  commands: {
    targetFavouritesList: (...args: unknown[]) =>
      mockTargetFavouritesList(...args),
    targetFavouritesAdd: (...args: unknown[]) =>
      mockTargetFavouritesAdd(...args),
    targetFavouritesRemove: (...args: unknown[]) =>
      mockTargetFavouritesRemove(...args),
  },
}));

// Imported after the mock so the module under test picks up the mocked bindings.
const { useFavourites, getFavouriteIds, __resetFavouritesCacheForTests } =
  await import('./useFavourites');

function okList(targetIds: string[]) {
  return Promise.resolve({ status: 'ok', data: { targetIds } });
}

function okAdd(targetId: string, favouritedAt = '2026-07-06T00:00:00Z') {
  return Promise.resolve({ status: 'ok', data: { targetId, favouritedAt } });
}

function okRemove(targetId: string) {
  return Promise.resolve({ status: 'ok', data: { targetId } });
}

beforeEach(() => {
  __resetFavouritesCacheForTests();
  mockTargetFavouritesList.mockReset();
  mockTargetFavouritesAdd.mockReset();
  mockTargetFavouritesRemove.mockReset();
  mockTargetFavouritesList.mockReturnValue(okList([]));
  mockTargetFavouritesAdd.mockImplementation((...args: unknown[]) => {
    const { targetId } = args[0] as { targetId: string };
    return okAdd(targetId);
  });
  mockTargetFavouritesRemove.mockImplementation((...args: unknown[]) => {
    const { targetId } = args[0] as { targetId: string };
    return okRemove(targetId);
  });
});

describe('getFavouriteIds', () => {
  it('returns an empty set before the backend fetch resolves', () => {
    const ids = getFavouriteIds();
    expect(ids.size).toBe(0);
  });
});

describe('useFavourites', () => {
  it('loads the favourite set from the backend on mount', async () => {
    mockTargetFavouritesList.mockReturnValue(okList(['id-a', 'id-b']));

    const { result } = renderHook(() => useFavourites(), { wrapper });

    await waitFor(() => expect(result.current.favouriteIds.size).toBe(2));
    expect(result.current.isFavourite('id-a')).toBe(true);
    expect(result.current.isFavourite('id-b')).toBe(true);
    expect(mockTargetFavouritesList).toHaveBeenCalledTimes(1);
  });

  it('toggle favourites an unfavourited target optimistically then confirms via the backend', async () => {
    const { result } = renderHook(() => useFavourites(), { wrapper });
    await waitFor(() => expect(mockTargetFavouritesList).toHaveBeenCalled());

    // After the add succeeds the invalidate re-fetches; simulate the
    // server-side post-add state so the refetch confirms id-x is now in the set.
    mockTargetFavouritesList.mockReturnValue(okList(['id-x']));

    act(() => {
      result.current.toggle('id-x');
    });

    // Optimistic update: applied to the query cache synchronously, but
    // TanStack Query's notifyManager batches the resulting re-render via a
    // macrotask, so the hook's return value reflects it after a tick.
    await waitFor(() => expect(result.current.isFavourite('id-x')).toBe(true));

    await waitFor(() =>
      expect(mockTargetFavouritesAdd).toHaveBeenCalledWith({
        targetId: 'id-x',
      }),
    );
    expect(result.current.isFavourite('id-x')).toBe(true);
  });

  it('toggle unfavourites an already-favourited target', async () => {
    mockTargetFavouritesList.mockReturnValue(okList(['id-y']));
    const { result } = renderHook(() => useFavourites(), { wrapper });
    await waitFor(() => expect(result.current.isFavourite('id-y')).toBe(true));

    // After the remove succeeds the invalidate re-fetches; simulate the
    // server-side post-remove state so the refetch doesn't restore id-y.
    mockTargetFavouritesList.mockReturnValue(okList([]));

    act(() => {
      result.current.toggle('id-y');
    });

    await waitFor(() => expect(result.current.isFavourite('id-y')).toBe(false));
    await waitFor(() =>
      expect(mockTargetFavouritesRemove).toHaveBeenCalledWith({
        targetId: 'id-y',
      }),
    );
  });

  it('reverts the optimistic add when the backend call fails', async () => {
    mockTargetFavouritesAdd.mockReturnValue(
      Promise.resolve({
        status: 'error',
        error: { code: 'internal.database', message: 'boom' },
      }),
    );
    const { result } = renderHook(() => useFavourites(), { wrapper });
    await waitFor(() => expect(mockTargetFavouritesList).toHaveBeenCalled());

    // The mock backend call rejects on the SAME microtask turn as the
    // optimistic cache write, and TanStack Query's notifyManager batches
    // same-turn cache writes into one render — so the optimistic `true` and
    // its revert can coalesce into a single visible update here (unlike a
    // real IPC round-trip, which always takes longer than one tick). The end
    // state — reverted to unfavourited — is what matters and is asserted below.
    act(() => {
      result.current.toggle('id-z');
    });

    await waitFor(() => expect(result.current.isFavourite('id-z')).toBe(false));
  });

  it('shares the cache across multiple hook mounts', async () => {
    mockTargetFavouritesList.mockReturnValue(okList(['id-shared']));
    const a = renderHook(() => useFavourites(), { wrapper });
    const b = renderHook(() => useFavourites(), { wrapper });

    await waitFor(() =>
      expect(a.result.current.isFavourite('id-shared')).toBe(true),
    );
    await waitFor(() =>
      expect(b.result.current.isFavourite('id-shared')).toBe(true),
    );
  });

  it('GFD-4: invalidates the cache after a successful toggle so the authoritative DB state is fetched', async () => {
    // Two list calls: initial load (empty), then the post-add reconcile.
    mockTargetFavouritesList
      .mockReturnValueOnce(okList([]))
      .mockReturnValue(okList(['id-inv']));

    const { result } = renderHook(() => useFavourites(), { wrapper });
    await waitFor(() =>
      expect(mockTargetFavouritesList).toHaveBeenCalledTimes(1),
    );

    act(() => {
      result.current.toggle('id-inv');
    });

    // After the add settles + invalidate fires, the refetch (second list call)
    // confirms the item is in the DB-backed set.
    await waitFor(() =>
      expect(mockTargetFavouritesList).toHaveBeenCalledTimes(2),
    );
    await waitFor(() =>
      expect(result.current.isFavourite('id-inv')).toBe(true),
    );
  });
});
