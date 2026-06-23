/**
 * useGrouping — shared, page-agnostic ordered multi-level grouping state.
 *
 * Generalised from the Inbox's `useInboxControls` (spec 041 T021) so every list
 * page gets the SAME "Group by X, then by Y, then by Z" capability via the
 * shared `FilterToolbar` grouping control. The hook owns only the ordered
 * dimension ids + their localStorage persistence; each page supplies its own
 * valid dimension ids + a storage key, and feeds `dims` to its table's
 * `groupByDimensions` call.
 */

import { useCallback, useEffect, useState } from 'react';

export interface UseGroupingOptions {
  /** localStorage key for the persisted ordered dimensions (per page). */
  storageKey: string;
  /** Dimension ids this page allows (persisted values are validated against it). */
  validIds: readonly string[];
  /** Number of ordered grouping slots. Default 3. */
  maxLevels?: number;
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
}: UseGroupingOptions): UseGroupingResult {
  const valid = new Set(validIds);

  const load = useCallback((): string[] => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const d of parsed) {
        if (typeof d === 'string' && valid.has(d) && !seen.has(d)) {
          seen.add(d);
          out.push(d);
          if (out.length >= maxLevels) break;
        }
      }
      return out;
    } catch {
      return [];
    }
    // `valid` is derived from validIds; depend on the stable storageKey + maxLevels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, maxLevels]);

  const [dims, setDims] = useState<string[]>(() => load());

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(dims));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [storageKey, dims]);

  const setSlot = useCallback(
    (slot: number, value: string) => {
      setDims((prev) => {
        const next = prev.slice(0, slot);
        if (value !== '') {
          const deduped = next.filter((d) => d !== value);
          deduped.push(value);
          return deduped.slice(0, maxLevels);
        }
        return next;
      });
    },
    [maxLevels],
  );

  return { dims, setSlot };
}
