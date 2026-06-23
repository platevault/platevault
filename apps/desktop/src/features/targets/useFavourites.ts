/**
 * useFavourites — client-side favourite/starred targets (task #18, spec 043).
 *
 * STUB: favourites are stored in localStorage only.  Real persistence requires
 * the FITS OBJECT → target_id linkage (task #54) so the backend knows which
 * canonical targets have linked sessions/projects.  When #54 lands, replace
 * this module with a backend-backed hook that reads the real "My Targets" set.
 *
 * localStorage key: 'alm:targets:favourites'
 * Format:           JSON array of canonical target id strings.
 *
 * API:
 *   useFavourites() → { favouriteIds: Set<string>, toggle, isFavourite }
 *   getFavouriteIds()         — non-hook read (for tests / outside React)
 *   FAVOURITES_STORAGE_KEY    — exported for tests
 */

import { useSyncExternalStore, useCallback } from 'react';

/** localStorage key under which favourited target ids are stored. */
export const FAVOURITES_STORAGE_KEY = 'alm:targets:favourites';

// ── Storage helpers ────────────────────────────────────────────────────────────

/** Read the raw stored set (empty set on any parse/storage error). */
function readFromStorage(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(FAVOURITES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

/** Persist a new id set and notify all subscribers. */
function writeToStorage(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable (e.g. tests without shim) — skip persist.
  }
  // Notify useSyncExternalStore subscribers across all mounts.
  try {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: FAVOURITES_STORAGE_KEY,
        newValue: JSON.stringify([...ids]),
      }),
    );
  } catch {
    // Non-browser env; subscribers won't get the push notification but will
    // re-read on the next render via useSyncExternalStore.
  }
  // Also call module-local listeners directly (same-tab updates).
  for (const fn of listeners) fn();
}

// ── useSyncExternalStore wiring ────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === FAVOURITES_STORAGE_KEY || e.key === null) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

// Stable snapshot reference: useSyncExternalStore requires referential equality
// between renders when the data hasn't changed.  We keep a module-level cache
// so the same Set object is returned until a write actually occurs.
let cachedSnapshot: ReadonlySet<string> = new Set();
let cachedRaw: string | null = null;

function getSnapshot(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(FAVOURITES_STORAGE_KEY);
    if (raw === cachedRaw) return cachedSnapshot;
    cachedRaw = raw;
    cachedSnapshot = readFromStorage();
    return cachedSnapshot;
  } catch {
    return cachedSnapshot;
  }
}

function getServerSnapshot(): ReadonlySet<string> {
  return new Set();
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
 * React hook: subscribe to the client-side favourite set.
 *
 * Provides `toggle` (stable across renders) to star/unstar a target, and
 * `isFavourite` for conditional rendering.
 *
 * STUB — see module header.  Replace with a backend-backed hook when #54 lands.
 */
export function useFavourites(): UseFavouritesResult {
  const favouriteIds = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback((targetId: string) => {
    // Re-read from storage immediately (not from the React snapshot) so rapid
    // successive clicks on different rows don't race.
    const current = new Set(readFromStorage());
    if (current.has(targetId)) {
      current.delete(targetId);
    } else {
      current.add(targetId);
    }
    writeToStorage(current);
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
 * STUB — see module header.
 */
export { readFromStorage as getFavouriteIds };
