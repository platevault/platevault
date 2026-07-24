// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inbox store — TanStack Query hooks for read-only queries (classification,
 * list, scan, metadata, cone-search suggestions).
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { ipcArgs } from '@/lib/ipc-args';
import type {
  InboxListItem,
  InboxSourceGroupListItem,
  InboxListResponse,
  InboxScanFolderResponse,
  InboxFileMetadata_Serialize as InboxFileMetadata,
  ConeSearchReason,
} from '@/bindings/index';
import type {
  InboxClassifyResponse,
} from '@/bindings/aliases';

export type {
  InboxFileMetadata,
  InboxClassifyResponse,
  InboxListItem,
  InboxSourceGroupListItem,
  InboxListResponse,
  InboxScanFolderResponse,
};

// ── Query hooks ───────────────────────────────────────────────────────────────

/**
 * Shared `inbox.classify` TanStack Query key builder. Used by
 * `useInboxClassification`/`useInboxPlanBreakdowns` (which fetch it) and by
 * any caller that needs to directly invalidate one item's classify cache
 * (e.g. `InboxPage`'s post-reclassify-in-place refetch) — keeping the key
 * shape in ONE place means an invalidator can never drift out of sync with
 * the query it's supposed to target.
 */
export function inboxClassifyQueryKey(
  rootAbsolutePath: string,
  inboxItemId: string,
  forceRescan = false,
) {
  const key = forceRescan
    ? `${rootAbsolutePath}|${inboxItemId}|force`
    : `${rootAbsolutePath}|${inboxItemId}`;
  return [queryKeys.inbox.list('all')[0], 'classify', key] as const;
}

/** Load and cache an inbox classification for the given item. */
export function useInboxClassification(
  inboxItemId: string,
  rootAbsolutePath: string,
  forceRescan = false,
) {
  const queryClient = useQueryClient();
  const { data, isFetching, error, dataUpdatedAt } =
    useQuery<InboxClassifyResponse>({
      queryKey: inboxClassifyQueryKey(
        rootAbsolutePath,
        inboxItemId,
        forceRescan,
      ),
      queryFn: async () =>
        unwrap(
          await commands.inboxClassify({
            inboxItemId,
            rootAbsolutePath,
            forceRescan,
          }),
        ),
      enabled: !!inboxItemId && !!rootAbsolutePath,
    });

  // `inbox.classify` persists per-file extracted metadata rows as a backend
  // side effect (issue #1019). The `inbox.item.metadata` query only re-fetches
  // when its itemId changes, so on FIRST selection it can resolve BEFORE
  // classify has written those rows, cache an empty file list, and never
  // recover — the FR-032 "required metadata missing" banner then fails to
  // render until a manual re-open. Invalidate that item's metadata query once
  // each time classify settles with fresh data, mirroring the reclassify
  // mutation (which persists the same rows and invalidates the same key).
  // Bounded: keyed on `dataUpdatedAt` (fires once per settle) and gated on a
  // real itemId; invalidating metadata never re-triggers classify, so there is
  // no loop. The error path leaves `dataUpdatedAt` at 0 — no persistence, no
  // invalidation.
  useEffect(() => {
    if (!inboxItemId || dataUpdatedAt === 0) return;
    void queryClient.invalidateQueries({
      queryKey: queryKeys.inbox.metadata(inboxItemId),
    });
  }, [inboxItemId, dataUpdatedAt, queryClient]);

  return { data, loading: isFetching, error: error ?? undefined };
}

/** One item whose authoritative per-type breakdown should be preloaded. */
export interface InboxBreakdownTarget {
  inboxItemId: string;
  rootAbsolutePath: string;
}

/**
 * Preload the AUTHORITATIVE per-type frame breakdown for a set of items
 * (typically every ingestion that has an open plan), regardless of which item
 * is currently selected (#98).
 *
 * The collapsed plan summary needs the real per-type tally (bias/dark/flat/
 * light/master) for each open plan. Previously that tally was only correct for
 * the SELECTED item — its `classification.breakdown` was loaded by
 * `useInboxClassification`. An UNSELECTED mixed folder fell back to a per-action
 * keyword/hint guess that degenerates to one dominant type (e.g. "41 darks").
 *
 * This hook runs one cached `inbox.classify` query per target via `useQueries`
 * (sharing the SAME query key as `useInboxClassification`, so the selected
 * item's already-fetched classification is reused, not re-fetched), and returns
 * a `inboxItemId → breakdown[]` map. The breakdown is exactly the shape
 * `InboxStatsSummary` / the detail breakdown table consume.
 *
 * Stable identity: the returned map is memoised on the resolved classification
 * data so consumers' `useMemo` deps don't thrash every render.
 */
export function useInboxPlanBreakdowns(
  targets: InboxBreakdownTarget[],
): Record<string, ReadonlyArray<{ kind: string; count: number }>> {
  const results = useQueries({
    queries: targets.map((t) => ({
      queryKey: inboxClassifyQueryKey(t.rootAbsolutePath, t.inboxItemId),
      queryFn: async () =>
        unwrap(
          await commands.inboxClassify({
            inboxItemId: t.inboxItemId,
            rootAbsolutePath: t.rootAbsolutePath,
            forceRescan: false,
          }),
        ),
      enabled: !!t.inboxItemId && !!t.rootAbsolutePath,
      // Breakdown is stable for an unchanged folder — avoid re-fetch churn.
      staleTime: 30_000,
    })),
  });

  // Stable dependency signatures: recompute only when the set of target ids
  // changes OR when a classification result lands/changes. Computed as named
  // values so the dep array stays a list of simple expressions (the React
  // Compiler lint rule forbids inline `.map().join()` in the deps).
  const targetSignature = targets.map((t) => t.inboxItemId).join('|');
  const resultsSignature = results.map((r) => (r.data ? '1' : '0')).join('');

  // Build a stable map keyed by item id. `useQueries` returns results in the
  // same order as `targets`, so we can zip them together.
  return useMemo(() => {
    const map: Record<
      string,
      ReadonlyArray<{ kind: string; count: number }>
    > = {};
    targets.forEach((t, i) => {
      const data = results[i]?.data;
      if (data?.breakdown && data.breakdown.length > 0) {
        map[t.inboxItemId] = data.breakdown.map((b) => ({
          kind: b.kind,
          count: b.count,
        }));
      }
    });
    return map;
    // Depend on the resolved data refs (per result) + the target ids, not the
    // array identity, so the memo only recomputes when a classification lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSignature, resultsSignature]);
}

/** Load and cache an inbox scan for a root folder. */
export function useInboxScan(rootId: string, rootAbsolutePath: string) {
  const { data, isFetching, error } = useQuery<InboxScanFolderResponse>({
    queryKey: [
      queryKeys.inbox.list('all')[0],
      'scan',
      rootId,
      rootAbsolutePath,
    ],
    queryFn: async () =>
      unwrap(
        await commands.inboxScanFolder({
          rootId,
          rootAbsolutePath,
        }),
      ),
    enabled: !!rootId && !!rootAbsolutePath,
  });
  return { data, loading: isFetching, error: error ?? undefined };
}

/**
 * Load and cache the cross-root unacknowledged inbox list.
 *
 * Key: queryKeys.inbox.list('all') = ['inbox', 'all'].
 * Returns refresh() to manually re-fetch (e.g. after a rescan).
 */
export function useInboxList() {
  const queryClient = useQueryClient();
  // 'all' is the sentinel rootId for the cross-root aggregate.
  const listKey = queryKeys.inbox.list('all');
  const { data, isFetching, error } = useQuery<InboxListResponse>({
    queryKey: listKey,
    queryFn: async () => unwrap(await commands.inboxList()),
  });
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: listKey });
  }, [queryClient, listKey]);
  return {
    data: data ?? null,
    loading: isFetching,
    error: error ? String(error) : null,
    refresh,
  };
}

export interface InboxItemMetadataState {
  data: InboxFileMetadata[];
  loading: boolean;
  error: string | null;
}

/**
 * Load per-file extracted metadata for one inbox item (spec 041 US2/FR-010).
 *
 * Backed by TanStack Query (matching the rest of this store). Pass `null` to
 * skip fetching (e.g. when no item is selected); the query stays disabled and
 * returns an empty list. Re-fetches whenever `itemId` changes.
 */
export function useInboxItemMetadata(
  itemId: string | null,
): InboxItemMetadataState {
  const { data, isFetching, error } = useQuery<InboxFileMetadata[]>({
    queryKey: queryKeys.inbox.metadata(itemId ?? '__none__'),
    queryFn: async () => {
      const resp = unwrap(
        await commands.inboxItemMetadata({ inboxItemId: itemId as string }),
      );
      return resp.files;
    },
    enabled: itemId != null,
  });

  return {
    data: data ?? [],
    loading: itemId != null && isFetching,
    error: error ? String(error) : null,
  };
}

// ── Cone-search suggestion (spec 052 P3, US3) ────────────────────────────────

export type {
  ConeSearchSuggestResponse_Serialize as ConeSearchSuggestResponse,
  ConeSearchSuggestion_Serialize as ConeSearchSuggestion,
  ConeSearchCandidateTarget_Serialize as ConeSearchCandidateTarget,
  ConeSearchConfidence,
  ConeSearchReason,
  PointingSource,
} from '@/bindings/index';

/**
 * `target.cone_search.suggest` for one light-frameset (spec 052 P3).
 *
 * `resolve.offline` (online resolution disabled, or the TAP cone-search
 * failed) is a non-blocking degraded state (FR-018) — surfaced as
 * `offline: true` with `data: undefined` rather than a thrown query error, so
 * the UI can render "unavailable offline" instead of an error banner.
 * `frameset.not_found` / other backend errors still surface via `error`.
 *
 * `reason` distinguishes the automatic ingest-time run from a user-triggered
 * "re-check" (FR-017); both call the same command.
 */
export function useConeSearchSuggestions(
  framesetId: string | null,
  reason: ConeSearchReason,
) {
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: [...queryKeys.inbox.coneSearch(framesetId ?? ''), reason],
    queryFn: async () => {
      const result = await commands.targetConeSearchSuggest(
        ipcArgs<typeof commands.targetConeSearchSuggest>({
          framesetId: framesetId as string,
          reason,
        }),
      );
      if (result.status === 'ok') {
        return { offline: false as const, response: result.data };
      }
      const code = (result.error as { code?: string } | undefined)?.code;
      if (code === 'resolve.offline') {
        return { offline: true as const, response: undefined };
      }
      throw result.error;
    },
    enabled: !!framesetId,
  });

  return {
    response: data?.response,
    offline: data?.offline ?? false,
    loading: isFetching,
    error: error ?? undefined,
    refetch,
  };
}
