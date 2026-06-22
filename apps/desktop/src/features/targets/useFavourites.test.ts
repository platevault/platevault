/**
 * useFavourites.test.ts — unit tests for the client-side favourite/star store
 * (task #18, spec 043).
 *
 * Tests the non-hook surface (getFavouriteIds / the toggle function via direct
 * localStorage manipulation) since hooks require renderHook + act and these are
 * simpler to keep pure.  The localStorage shim in vitest.setup.ts provides
 * storage isolation.
 *
 * STUB: favourites are localStorage-only until task #54 lands.
 */

import { beforeEach, describe, it, expect } from 'vitest';
import { getFavouriteIds, FAVOURITES_STORAGE_KEY } from './useFavourites';

function writeIds(ids: string[]): void {
  localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(ids));
}

beforeEach(() => {
  localStorage.clear();
});

describe('getFavouriteIds', () => {
  it('returns an empty set when nothing is stored', () => {
    const ids = getFavouriteIds();
    expect(ids.size).toBe(0);
  });

  it('returns the stored ids as a Set', () => {
    writeIds(['id-a', 'id-b']);
    const ids = getFavouriteIds();
    expect(ids.has('id-a')).toBe(true);
    expect(ids.has('id-b')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('returns an empty set when the stored value is not a JSON array', () => {
    localStorage.setItem(FAVOURITES_STORAGE_KEY, 'not-json');
    const ids = getFavouriteIds();
    expect(ids.size).toBe(0);
  });

  it('filters out non-string entries from the stored array', () => {
    localStorage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify(['id-a', 42, null, 'id-b']));
    const ids = getFavouriteIds();
    expect(ids.has('id-a')).toBe(true);
    expect(ids.has('id-b')).toBe(true);
    expect(ids.size).toBe(2);
  });
});

describe('FAVOURITES_STORAGE_KEY', () => {
  it('is the expected localStorage key', () => {
    expect(FAVOURITES_STORAGE_KEY).toBe('alm:targets:favourites');
  });
});

describe('round-trip: write to localStorage then read back', () => {
  it('reads back ids written via JSON directly', () => {
    writeIds(['uuid-1', 'uuid-2', 'uuid-3']);
    const ids = getFavouriteIds();
    expect(ids.size).toBe(3);
    expect(ids.has('uuid-1')).toBe(true);
    expect(ids.has('uuid-3')).toBe(true);
  });

  it('an empty stored array gives an empty set', () => {
    writeIds([]);
    const ids = getFavouriteIds();
    expect(ids.size).toBe(0);
  });
});
