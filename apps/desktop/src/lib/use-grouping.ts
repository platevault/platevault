// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useGrouping — shared, page-agnostic ordered multi-level grouping state.
 *
 * Generalised from the Inbox's `useInboxControls` (spec 041 T021) so every list
 * page gets the SAME "Group by X, then by Y, then by Z" capability via the
 * shared `FilterToolbar` grouping control. The hook owns only the ordered
 * dimension ids + their persistence; each page supplies its own valid dimension
 * ids + a storage key, and feeds `dims` to its table's `groupByDimensions` call.
 *
 * Persistence: all grouping state lives in SQLite (`ui_state` scope) with a
 * localStorage boot cache. The settings key is `uiState.<storageKey>` (e.g.
 * `uiState.targets.grouping.dims.v1`). On first hydrate the old plain
 * localStorage key is imported automatically.
 */

import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  createPersistedState,
  type PersistedStateResult,
} from '@/data/persisted-state';

// Module-level registry: one PersistedState instance per storageKey so
// multiple renders of the same page share state and don't leak subscriptions.
const groupingRegistry = new Map<string, PersistedStateResult<string[]>>();

function getGroupingState(
  storageKey: string,
  defaultDims: readonly string[],
): PersistedStateResult<string[]> {
  let instance = groupingRegistry.get(storageKey);
  if (!instance) {
    instance = createPersistedState('ui_state', `uiState.${storageKey}`, {
      default: [...defaultDims],
    });
    groupingRegistry.set(storageKey, instance);
  }
  return instance;
}

export interface UseGroupingOptions {
  /**
   * Stable per-page key (e.g. `"targets.grouping.dims.v1"`). Used as both the
   * SQLite settings key suffix (`uiState.<storageKey>`) and the legacy
   * localStorage migration key.
   */
  storageKey: string;
  /** Dimension ids this page allows (persisted values are validated against it). */
  validIds: readonly string[];
  /** Number of ordered grouping slots. Default 3. */
  maxLevels?: number;
  /** Initial dimensions when nothing is persisted yet (e.g. Sessions → ['target']). */
  defaultDims?: readonly string[];
}

export interface UseGroupingResult {
  /** Active ordered dimension ids (length ≤ maxLevels). */
  dims: string[];
  /**
   * Set the dimension at `slot`. "" clears this slot AND all deeper slots (a
   * cleared slot terminates the ordered chain). Choosing a dimension already
   * used in an earlier slot moves it (no duplicates).
   */
  setSlot: (slot: number, value: string) => void;
}

export function useGrouping({
  storageKey,
  validIds,
  maxLevels = 3,
  defaultDims = [],
}: UseGroupingOptions): UseGroupingResult {
  const valid = new Set(validIds);
  const state = getGroupingState(storageKey, defaultDims);

  const rawDims = useSyncExternalStore(state.subscribe, state.get, state.get);

  // Validate stored dims against the page's valid id set and maxLevels.
  const dims = validateDims(rawDims, valid, maxLevels);

  const setSlot = useCallback(
    (slot: number, value: string) => {
      const prev = validateDims(state.get(), valid, maxLevels);
      const next = prev.slice(0, slot);
      if (value !== '') {
        const deduped = next.filter((d) => d !== value);
        deduped.push(value);
        state.set(deduped.slice(0, maxLevels));
      } else {
        state.set(next);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, maxLevels],
  );

  return { dims, setSlot };
}

/** Filter + deduplicate dims against the page's valid id set. */
function validateDims(
  raw: string[],
  valid: Set<string>,
  maxLevels: number,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of raw) {
    if (typeof d === 'string' && valid.has(d) && !seen.has(d)) {
      seen.add(d);
      out.push(d);
      if (out.length >= maxLevels) break;
    }
  }
  return out;
}

export interface UseCollapsibleGroupsResult {
  /** Set of collapsed group paths. */
  collapsed: Set<string>;
  /** Toggle a group's collapsed state by its path. */
  toggle: (path: string) => void;
}

/**
 * Collapse state for a grouped list — paired with `flattenVisibleGroups`. Keyed
 * by the group `path` the flattener emits.
 */
export function useCollapsibleGroups(): UseCollapsibleGroupsResult {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  return { collapsed, toggle };
}

/**
 * Test-only: clear the per-storageKey PersistedState registry so tests don't
 * bleed state across renders. Also call `__resetScopeRegistryForTest()` from
 * `persisted-state.ts` to avoid stale scope registrations.
 */
export function __resetGroupingRegistryForTest(): void {
  groupingRegistry.clear();
}
