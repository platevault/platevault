// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inbox store — rescan and cone-search confirm hooks.
 */

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { ipcArgs } from '@/lib/ipc-args';

export interface RescanState {
  loading: boolean;
  error: string | null;
}

export interface RescanRoot {
  rootId: string;
  rootAbsolutePath: string;
}

/**
 * Merge registered inbox roots with any root already surfaced via the
 * current item list, deduped by rootId (registered roots take precedence).
 *
 * A freshly registered root has zero items until its first scan, so deriving
 * rescan targets from the item list alone would silently skip it — this is
 * why callers must pass the registered-root list, not just item-derived roots.
 */
export function mergeRescanRoots(
  registeredRoots: RescanRoot[],
  itemRoots: RescanRoot[],
): RescanRoot[] {
  const seen = new Set<string>();
  const result: RescanRoot[] = [];
  for (const r of [...registeredRoots, ...itemRoots]) {
    if (!seen.has(r.rootId)) {
      seen.add(r.rootId);
      result.push(r);
    }
  }
  return result;
}

/**
 * Trigger a rescan of all registered roots (FR-005).
 * On completion, calls onComplete so the caller can refresh the list.
 */
export function useInboxRescan(
  roots: Array<{ rootId: string; rootAbsolutePath: string }>,
  onComplete: () => void,
) {
  const [state, setState] = useState<RescanState>({
    loading: false,
    error: null,
  });

  const rescan = useCallback(async () => {
    if (roots.length === 0) {
      onComplete();
      return;
    }
    setState({ loading: true, error: null });
    try {
      await Promise.all(
        roots.map(async (r) =>
          unwrap(
            await commands.inboxScanFolder({
              rootId: r.rootId,
              rootAbsolutePath: r.rootAbsolutePath,
            }),
          ),
        ),
      );
      setState({ loading: false, error: null });
      onComplete();
    } catch (e: unknown) {
      setState({ loading: false, error: String(e) });
      // Still refresh so any partial results appear.
      onComplete();
    }
  }, [roots, onComplete]);

  return { ...state, rescan };
}

// ── Cone-search confirm (spec 052 P3) ────────────────────────────────────────

export interface ConeSearchConfirmState {
  loading: boolean;
  error: string | null;
}

/** `target.cone_search.confirm` (FR-016, SC-006) — the sole write path. */
export function useConeSearchConfirm(framesetId: string) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConeSearchConfirmState>({
    loading: false,
    error: null,
  });

  const confirm = useCallback(
    async (candidate: {
      canonicalTargetId: string | null;
      primaryDesignation: string;
      simbadOid: number | null;
    }) => {
      setState({ loading: true, error: null });
      try {
        const result = unwrap(
          await commands.targetConeSearchConfirm(
            ipcArgs<typeof commands.targetConeSearchConfirm>({
              framesetId,
              candidate,
            }),
          ),
        );
        setState({ loading: false, error: null });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.inbox.coneSearch(framesetId),
        });
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState({ loading: false, error: msg });
        throw e;
      }
    },
    [framesetId, queryClient],
  );

  return { ...state, confirm };
}
