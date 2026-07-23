// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useFavourites — database-backed favourite/starred targets (spec 051 US2).
 *
 * Favourites are canonical, database-backed state (`target_favourite` table,
 * migration `0061`) — see `targets.favourites.list` / `.add` / `.remove` in
 * `apps/desktop/src-tauri/src/commands/target_favourites.rs`. Backed by
 * TanStack Query (spec `tiny/targets-tanstack-query-migration`): the
 * `queryKeys.targets.favourites()` cache entry IS the shared store, so every
 * `useFavourites()` mount reads/writes the same set without a bespoke
 * `useSyncExternalStore` subscriber list.
 *
 * API (unchanged shape from the pre-migration hook):
 *   useFavourites() → { favouriteIds: Set<string>, toggle, isFavourite }
 *   getFavouriteIds()         — non-hook read (for tests / outside React;
 *                               returns the current cache, empty until the
 *                               first backend fetch resolves)
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { queryClient as sharedQueryClient } from '@/data/queryClient';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';

const FAVOURITES_KEY = queryKeys.targets.favourites();

// Stable empty-set reference (not a fresh `new Set()` per render) so
// `isFavourite`'s useCallback dependency doesn't churn while data is loading.
const EMPTY_SET: ReadonlySet<string> = new Set();

async function fetchFavouriteIds(): Promise<Set<string>> {
  const { targetIds } = unwrap(await commands.targetFavouritesList());
  return new Set(targetIds);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface UseFavouritesResult {
  /** Set of currently-favourited canonical target ids. */
  favouriteIds: ReadonlySet<string>;
  /** Toggle the favourite state of a target by id. */
  toggle: (targetId: string) => void;
  /** Returns true when the given id is currently favourited. */
  isFavourite: (targetId: string) => boolean;
}

/**
 * React hook: subscribe to the database-backed favourite set.
 *
 * Provides `toggle` (stable across renders) to star/unstar a target, and
 * `isFavourite` for conditional rendering. Applies an optimistic update on
 * `toggle` directly against the shared query cache, then reconciles with the
 * backend call; a failed call reverts the optimistic change.
 */
export function useFavourites(): UseFavouritesResult {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: FAVOURITES_KEY,
    queryFn: fetchFavouriteIds,
  });
  const favouriteIds = data ?? EMPTY_SET;

  const toggle = useCallback(
    (targetId: string) => {
      const current =
        queryClient.getQueryData<Set<string>>(FAVOURITES_KEY) ??
        new Set<string>();
      const wasFavourited = current.has(targetId);

      // Optimistic update.
      const next = new Set(current);
      if (wasFavourited) {
        next.delete(targetId);
      } else {
        next.add(targetId);
      }
      queryClient.setQueryData(FAVOURITES_KEY, next);

      const call = wasFavourited
        ? commands.targetFavouritesRemove({ targetId })
        : commands.targetFavouritesAdd({ targetId });

      Promise.resolve(call)
        .then(unwrap)
        .catch(() => {
          // Revert the optimistic change on failure.
          const reverted = new Set(
            queryClient.getQueryData<Set<string>>(FAVOURITES_KEY) ??
              new Set<string>(),
          );
          if (wasFavourited) {
            reverted.add(targetId);
          } else {
            reverted.delete(targetId);
          }
          queryClient.setQueryData(FAVOURITES_KEY, reverted);
        });
    },
    [queryClient],
  );

  const isFavourite = useCallback(
    (targetId: string) => favouriteIds.has(targetId),
    [favouriteIds],
  );

  return { favouriteIds, toggle, isFavourite };
}

/**
 * Non-hook read for use outside React (tests, initial render).
 *
 * Returns the current query-cache entry — empty until the first backend
 * fetch (triggered by a `useFavourites()` mount) resolves. Reads the shared
 * app-wide `queryClient` singleton (also mounted at the app root), matching
 * the pattern in `data/queryClient.ts`'s module doc.
 */
export function getFavouriteIds(): ReadonlySet<string> {
  return (
    sharedQueryClient.getQueryData<Set<string>>(FAVOURITES_KEY) ?? new Set()
  );
}

/**
 * Test-only reset of the shared favourites cache entry. Not part of the
 * public hook surface; exported so `useFavourites.test.ts` can isolate cases
 * without process-per-test isolation.
 */
export function __resetFavouritesCacheForTests(): void {
  sharedQueryClient.removeQueries({ queryKey: FAVOURITES_KEY });
}
