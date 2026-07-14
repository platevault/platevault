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

    const { result } = renderHook(() => useFavourites());

    await waitFor(() => expect(result.current.favouriteIds.size).toBe(2));
    expect(result.current.isFavourite('id-a')).toBe(true);
    expect(result.current.isFavourite('id-b')).toBe(true);
    expect(mockTargetFavouritesList).toHaveBeenCalledTimes(1);
  });

  it('toggle favourites an unfavourited target optimistically then confirms via the backend', async () => {
    const { result } = renderHook(() => useFavourites());
    await waitFor(() => expect(mockTargetFavouritesList).toHaveBeenCalled());

    act(() => {
      result.current.toggle('id-x');
    });

    // Optimistic update is synchronous.
    expect(result.current.isFavourite('id-x')).toBe(true);

    await waitFor(() =>
      expect(mockTargetFavouritesAdd).toHaveBeenCalledWith({
        targetId: 'id-x',
      }),
    );
    expect(result.current.isFavourite('id-x')).toBe(true);
  });

  it('toggle unfavourites an already-favourited target', async () => {
    mockTargetFavouritesList.mockReturnValue(okList(['id-y']));
    const { result } = renderHook(() => useFavourites());
    await waitFor(() => expect(result.current.isFavourite('id-y')).toBe(true));

    act(() => {
      result.current.toggle('id-y');
    });

    expect(result.current.isFavourite('id-y')).toBe(false);
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
    const { result } = renderHook(() => useFavourites());
    await waitFor(() => expect(mockTargetFavouritesList).toHaveBeenCalled());

    act(() => {
      result.current.toggle('id-z');
    });
    expect(result.current.isFavourite('id-z')).toBe(true);

    await waitFor(() => expect(result.current.isFavourite('id-z')).toBe(false));
  });

  it('shares the cache across multiple hook mounts', async () => {
    mockTargetFavouritesList.mockReturnValue(okList(['id-shared']));
    const a = renderHook(() => useFavourites());
    const b = renderHook(() => useFavourites());

    await waitFor(() =>
      expect(a.result.current.isFavourite('id-shared')).toBe(true),
    );
    await waitFor(() =>
      expect(b.result.current.isFavourite('id-shared')).toBe(true),
    );
  });
});
