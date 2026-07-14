// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useFavourites — database-backed favourite/starred targets (spec 051 US2).
 *
 * Favourites are canonical, database-backed state (`target_favourite` table,
 * migration `0061`) — see `targets.favourites.list` / `.add` / `.remove` in
 * `apps/desktop/src-tauri/src/commands/target_favourites.rs`. This replaces
 * the previous `localStorage`-only stub (task #18, spec 043).
 *
 * The old stub cited task #54 (FITS OBJECT → target_id linkage) as its own
 * blocker — that citation was specific to *storage location*, which this
 * feature resolves (favourites are keyed directly off canonical target ids,
 * independent of any FITS ingest linkage). Task #54 itself is broader than
 * favourites storage: it also covers the FITS-derived target list backing
 * `TargetsPage.tsx`'s stub filters and `ProjectsTable.tsx`'s target column
 * (both still marked STUB pending #54), which this feature does not close.
 *

 * API (unchanged shape from the stub):
 *   useFavourites() → { favouriteIds: Set<string>, toggle, isFavourite }
 *   getFavouriteIds()         — non-hook read (for tests / outside React;
 *                               returns the current in-memory cache, which is
 *                               empty until the first backend fetch resolves)
 */

import { useSyncExternalStore, useCallback, useEffect } from 'react';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';

// ── Module-level cache + subscriber wiring ──────────────────────────────────
//
// A single shared cache backs every `useFavourites()` mount so all
// subscribers (e.g. TargetsTable + a detail pane) stay in sync without each
// mount re-fetching independently.

let cachedIds: ReadonlySet<string> = new Set();
let hasLoaded = false;
let inFlightLoad: Promise<void> | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): ReadonlySet<string> {
  return cachedIds;
}

function getServerSnapshot(): ReadonlySet<string> {
  return new Set();
}

/** Fetch the current favourite set from the backend (de-duplicates concurrent calls). */
function ensureLoaded(): Promise<void> {
  if (hasLoaded) return Promise.resolve();
  if (inFlightLoad) return inFlightLoad;
  inFlightLoad = Promise.resolve()
    .then(() => commands.targetFavouritesList())
    .then(unwrap)
    .then(({ targetIds }) => {
      cachedIds = new Set(targetIds);
      hasLoaded = true;
      notify();
    })
    .catch(() => {
      // Leave the cache empty on failure; a future call may retry via a
      // fresh mount (hasLoaded stays false).
    })
    .finally(() => {
      inFlightLoad = null;
    });
  return inFlightLoad;
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
 * `toggle`, then reconciles with the backend call; a failed call reverts the
 * optimistic change.
 */
export function useFavourites(): UseFavouritesResult {
  const favouriteIds = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  useEffect(() => {
    void ensureLoaded();
  }, []);

  const toggle = useCallback((targetId: string) => {
    const wasFavourited = cachedIds.has(targetId);

    // Optimistic update.
    const next = new Set(cachedIds);
    if (wasFavourited) {
      next.delete(targetId);
    } else {
      next.add(targetId);
    }
    cachedIds = next;
    notify();

    const call = Promise.resolve().then(() =>
      wasFavourited
        ? commands.targetFavouritesRemove({ targetId })
        : commands.targetFavouritesAdd({ targetId }),
    );

    call.then(unwrap).catch(() => {
      // Revert the optimistic change on failure.
      const reverted = new Set(cachedIds);
      if (wasFavourited) {
        reverted.add(targetId);
      } else {
        reverted.delete(targetId);
      }
      cachedIds = reverted;
      notify();
    });
  }, []);

  const isFavourite = useCallback(
    (targetId: string) => favouriteIds.has(targetId),
    [favouriteIds],
  );

  return { favouriteIds, toggle, isFavourite };
}

/**
 * Non-hook read for use outside React (tests, initial render).
 *
 * Returns the current in-memory cache — empty until the first backend fetch
 * (triggered by a `useFavourites()` mount) resolves.
 */
export function getFavouriteIds(): ReadonlySet<string> {
  return cachedIds;
}

/**
 * Test-only reset of the module-level cache. Not part of the public hook
 * surface; exported so `useFavourites.test.ts` can isolate cases without
 * process-per-test isolation.
 */
export function __resetFavouritesCacheForTests(): void {
  cachedIds = new Set();
  hasLoaded = false;
  inFlightLoad = null;
}
