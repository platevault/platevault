/**
 * Inbox store — TanStack Query hooks for classify, confirm, and reclassify.
 *
 * Key structure (queryKeys factory):
 *   queryKeys.inbox.list('all') = ['inbox', 'all'] — cross-root aggregate list.
 *   classify/confirm/reclassify mutations invalidate ['inbox'] prefix so the
 *   aggregate list and any future per-root keys are all refreshed.
 *
 * NOTE: US3 (O(n^2) indexOf / virtualisation) is out of scope here — this
 * file only migrates the store layer to TanStack Query.
 */

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/data/queryKeys";
import {
  inboxScanFolder,
  inboxClassify,
  inboxConfirm,
  inboxList,
  inboxReclassify,
} from "@/api/commands";
import type {
  InboxClassifyResponse,
  InboxConfirmResponse,
  InboxListItem,
  InboxListResponse,
  InboxReclassifyResponse,
  InboxScanFolderResponse,
} from "@/api/commands";

export type {
  InboxClassifyResponse,
  InboxConfirmResponse,
  InboxListItem,
  InboxListResponse,
  InboxReclassifyResponse,
  InboxScanFolderResponse,
};

// ── Query hooks ───────────────────────────────────────────────────────────────

/** Load and cache an inbox classification for the given item. */
export function useInboxClassification(
  inboxItemId: string,
  rootAbsolutePath: string,
  forceRescan = false,
) {
  const key = forceRescan
    ? `${rootAbsolutePath}|${inboxItemId}|force`
    : `${rootAbsolutePath}|${inboxItemId}`;
  const { data, isFetching, error } = useQuery<InboxClassifyResponse>({
    queryKey: [queryKeys.inbox.list('all')[0], "classify", key],
    queryFn: () => {
      const [rootPath, itemId, forceStr] = key.split("|");
      return inboxClassify({
        inboxItemId: itemId,
        rootAbsolutePath: rootPath,
        forceRescan: forceStr === "force",
      });
    },
    enabled: !!inboxItemId && !!rootAbsolutePath,
  });
  return { data, loading: isFetching, error: error ?? undefined };
}

/** Load and cache an inbox scan for a root folder. */
export function useInboxScan(rootId: string, rootAbsolutePath: string) {
  const { data, isFetching, error } = useQuery<InboxScanFolderResponse>({
    queryKey: [queryKeys.inbox.list('all')[0], "scan", rootId, rootAbsolutePath],
    queryFn: () => inboxScanFolder({ rootId, rootAbsolutePath, followSymlinks: false }),
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
    queryFn: () => inboxList(),
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

// ── Mutation hooks ────────────────────────────────────────────────────────────

export interface ConfirmState {
  loading: boolean;
  result: InboxConfirmResponse | null;
  error: string | null;
}

/** Returns a confirm callback and its loading/result state. */
export function useInboxConfirm() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConfirmState>({ loading: false, result: null, error: null });

  const confirm = useCallback(
    async (args: {
      inboxItemId: string;
      action: string;
      contentSignature: string;
      rootAbsolutePath: string;
      destructiveDestination?: string;
    }) => {
      setState({ loading: true, result: null, error: null });
      try {
        const result = await inboxConfirm({
          inboxItemId: args.inboxItemId,
          action: args.action,
          contentSignature: args.contentSignature,
          rootAbsolutePath: args.rootAbsolutePath,
          destructiveDestination: args.destructiveDestination ?? null,
        });
        setState({ loading: false, result, error: null });
        // Invalidate the inbox list so it refreshes after confirmation.
        // Use queryKeys.inbox.list(rootId) prefix — ['inbox'] covers both the
        // aggregate list and any future per-root keys without going broader.
        void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.list('all') });
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState({ loading: false, result: null, error: msg });
        throw e;
      }
    },
    [queryClient],
  );

  return { ...state, confirm };
}

export interface ReclassifyState {
  loading: boolean;
  result: InboxReclassifyResponse | null;
  error: string | null;
}

/** Returns a reclassify callback and its loading/result state. */
export function useInboxReclassify(inboxItemId: string) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ReclassifyState>({
    loading: false,
    result: null,
    error: null,
  });

  const reclassify = useCallback(
    async (overrides: Array<{ filePath: string; frameType: string }>) => {
      setState({ loading: true, result: null, error: null });
      try {
        const result = await inboxReclassify({ inboxItemId, overrides });
        setState({ loading: false, result, error: null });
        // Invalidate all classification cache entries so the UI refreshes.
        void queryClient.invalidateQueries({
          queryKey: [queryKeys.inbox.list('all')[0], "classify"],
        });
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState({ loading: false, result: null, error: msg });
        throw e;
      }
    },
    [inboxItemId, queryClient],
  );

  return { ...state, reclassify };
}

export interface RescanState {
  loading: boolean;
  error: string | null;
}

/**
 * Trigger a rescan of all registered roots (FR-005).
 * On completion, calls onComplete so the caller can refresh the list.
 */
export function useInboxRescan(
  roots: Array<{ rootId: string; rootAbsolutePath: string }>,
  onComplete: () => void,
) {
  const [state, setState] = useState<RescanState>({ loading: false, error: null });

  const rescan = useCallback(async () => {
    if (roots.length === 0) {
      onComplete();
      return;
    }
    setState({ loading: true, error: null });
    try {
      await Promise.all(
        roots.map((r) =>
          inboxScanFolder({ rootId: r.rootId, rootAbsolutePath: r.rootAbsolutePath, followSymlinks: false }),
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
