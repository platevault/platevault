// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { ipcArgs } from '@/lib/ipc-args';
import type {
  InboxListItem,
  InboxListResponse,
  InboxConfirmResponse,
  InboxScanFolderResponse,
  InboxApplyAllResponse,
  InboxPlanCancelResponse,
  InboxPlanView,
  InboxOpenPlan,
  InboxOpenPlansResponse,
  InboxPlanAction,
  PlanApplyResponse,
  InboxStatsResponse,
  InboxStatsPerType,
  InboxStatsTotals,
  InboxFileMetadata_Serialize as InboxFileMetadata,
  ConeSearchReason,
} from '@/bindings/index';
import type {
  InboxClassifyResponse,
  InboxReclassifyResponse,
} from '@/bindings/aliases';

export type {
  InboxFileMetadata,
  InboxClassifyResponse,
  InboxConfirmResponse,
  InboxListItem,
  InboxListResponse,
  InboxReclassifyResponse,
  InboxScanFolderResponse,
  InboxApplyAllResponse,
  InboxPlanCancelResponse,
  InboxPlanView,
  InboxOpenPlan,
  InboxOpenPlansResponse,
  InboxPlanAction,
  PlanApplyResponse,
  InboxStatsResponse,
  InboxStatsPerType,
  InboxStatsTotals,
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
    queryKey: [queryKeys.inbox.list('all')[0], 'classify', key],
    queryFn: async () => {
      const [rootPath, itemId, forceStr] = key.split('|');
      return unwrap(
        await commands.inboxClassify({
          inboxItemId: itemId,
          rootAbsolutePath: rootPath,
          forceRescan: forceStr === 'force',
        }),
      );
    },
    enabled: !!inboxItemId && !!rootAbsolutePath,
  });
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
    queries: targets.map((t) => {
      const key = `${t.rootAbsolutePath}|${t.inboxItemId}`;
      return {
        queryKey: [queryKeys.inbox.list('all')[0], 'classify', key],
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
      };
    }),
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
          followSymlinks: false,
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

// ── Mutation hooks ────────────────────────────────────────────────────────────

/**
 * Structured error surfaced from a failed `inbox.confirm`.
 *
 * The backend rejects with a `ContractError`-shaped object (`{ code, message,
 * details, ... }`) — NOT a JS `Error`. Reading `e.message` off it directly
 * (or stringifying via `String(e)`) yields `"[object Object]"`, so we normalise
 * the thrown value into `code` / `message` / `details` here (spec 041 US8/US9).
 */
export interface ConfirmError {
  code: string | null;
  message: string;
  details: unknown;
}

/**
 * Normalise an unknown thrown value (from `inboxConfirm` via `unwrap`) into a
 * `ConfirmError`. Handles the structured `ContractError` object, a plain JS
 * `Error`, and anything else.
 */
export function normalizeConfirmError(e: unknown): ConfirmError {
  if (e && typeof e === 'object' && !(e instanceof Error)) {
    const obj = e as { code?: unknown; message?: unknown; details?: unknown };
    return {
      code: typeof obj.code === 'string' ? obj.code : null,
      message: typeof obj.message === 'string' ? obj.message : String(e),
      details: obj.details ?? null,
    };
  }
  if (e instanceof Error) {
    return { code: null, message: e.message, details: null };
  }
  return { code: null, message: String(e), details: null };
}

export interface ConfirmState {
  loading: boolean;
  result: InboxConfirmResponse | null;
  error: string | null;
  /** Structured error code (e.g. `inbox.destination_root_required`). */
  errorCode: string | null;
  /** Structured error details payload (candidate roots, missing-attr files). */
  errorDetails: unknown;
}

/** Returns a confirm callback and its loading/result state. */
export function useInboxConfirm() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConfirmState>({
    loading: false,
    result: null,
    error: null,
    errorCode: null,
    errorDetails: null,
  });

  const confirm = useCallback(
    async (args: {
      inboxItemId: string;
      contentSignature: string;
      rootAbsolutePath: string;
      destructiveDestination?: string;
      /** Caller-selected destination root (spec 041 US8/FR-029). */
      rootId?: string | null;
    }) => {
      setState({
        loading: true,
        result: null,
        error: null,
        errorCode: null,
        errorDetails: null,
      });
      try {
        const result = unwrap(
          await commands.inboxConfirm({
            inboxItemId: args.inboxItemId,
            contentSignature: args.contentSignature,
            rootAbsolutePath: args.rootAbsolutePath,
            destructiveDestination: args.destructiveDestination ?? null,
            rootId: args.rootId ?? null,
          }),
        );
        setState({
          loading: false,
          result,
          error: null,
          errorCode: null,
          errorDetails: null,
        });
        // Invalidate the inbox list so it refreshes after confirmation.
        // Use queryKeys.inbox.list(rootId) prefix — ['inbox'] covers both the
        // aggregate list and any future per-root keys without going broader.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.inbox.list('all'),
        });
        return result;
      } catch (e) {
        const norm = normalizeConfirmError(e);
        setState({
          loading: false,
          result: null,
          error: norm.message,
          errorCode: norm.code,
          errorDetails: norm.details,
        });
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
    async (
      overrides: Array<{
        filePath: string;
        frameType?: string | null;
        filter?: string | null;
        exposureS?: number | null;
        binning?: string | null;
      }>,
    ) => {
      setState({ loading: true, result: null, error: null });
      try {
        const result = unwrap(
          await commands.inboxReclassify(
            ipcArgs<typeof commands.inboxReclassify>({
              inboxItemId,
              overrides,
            }),
          ),
        );
        setState({ loading: false, result, error: null });
        // Invalidate all classification cache entries so the UI refreshes.
        void queryClient.invalidateQueries({
          queryKey: [queryKeys.inbox.list('all')[0], 'classify'],
        });
        // The per-file metadata DTO is override-derived too
        // (`frame_type_effective`, `missing_path_attributes`,
        // `missing_mandatory` all read the evidence overrides reclassify just
        // wrote) — without invalidating it, `InboxPage`'s
        // `hasMissingRequiredMeta` confirm gate keeps judging the PRE-override
        // state and Confirm never re-enables after a reclassify (spec 037
        // Layer-2 Inbox journey regression, PR #457).
        void queryClient.invalidateQueries({
          queryKey: queryKeys.inbox.metadata(inboxItemId),
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
              followSymlinks: false,
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

// ── Inbox plan surface (spec 041) ─────────────────────────────────────────────

interface PlanState {
  plan: InboxPlanView | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch + hold the open plan for the currently selected inbox item.
 * Pass an empty string to skip the fetch (no item selected / no plan).
 */
export function useInboxPlan(inboxItemId: string) {
  const [state, setState] = useState<PlanState>({
    plan: null,
    loading: false,
    error: null,
  });

  const fetchPlan = useCallback(async () => {
    if (!inboxItemId) {
      setState({ plan: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const plan = unwrap(await commands.inboxPlan(inboxItemId));
      setState({ plan, loading: false, error: null });
    } catch (e: unknown) {
      const msg = String(e);
      // 'no_plan' is expected when the item was just confirmed and listener
      // hasn't fired yet, or when the item is not in plan_open state.
      if (
        msg.includes('inbox.item.no_plan') ||
        msg.includes('inbox.item.not_found')
      ) {
        setState({ plan: null, loading: false, error: null });
      } else {
        setState({ plan: null, loading: false, error: msg });
      }
    }
  }, [inboxItemId]);

  return { ...state, fetchPlan };
}

interface PlanApplyState {
  loading: boolean;
  error: string | null;
}

/** Apply the open plan for a single inbox item. */
export function useInboxPlanApply() {
  const [state, setState] = useState<PlanApplyState>({
    loading: false,
    error: null,
  });

  const apply = useCallback(
    async (inboxItemId: string): Promise<PlanApplyResponse | null> => {
      setState({ loading: true, error: null });
      try {
        const result = unwrap(await commands.inboxPlanApply(inboxItemId));
        setState({ loading: false, error: null });
        return result;
      } catch (e: unknown) {
        setState({ loading: false, error: String(e) });
        return null;
      }
    },
    [],
  );

  return { ...state, apply };
}

/** Apply all plans currently in `plan_open` state. */
export function useInboxPlanApplyAll() {
  const [state, setState] = useState<PlanApplyState>({
    loading: false,
    error: null,
  });

  const applyAll =
    useCallback(async (): Promise<InboxApplyAllResponse | null> => {
      setState({ loading: true, error: null });
      try {
        const result = unwrap(await commands.inboxPlanApplyAll());
        setState({ loading: false, error: null });
        return result;
      } catch (e: unknown) {
        setState({ loading: false, error: String(e) });
        return null;
      }
    }, []);

  return { ...state, applyAll };
}

/** Cancel the open plan for a single inbox item, resetting it to `classified`. */
export function useInboxPlanCancel() {
  const [state, setState] = useState<PlanApplyState>({
    loading: false,
    error: null,
  });

  const cancel = useCallback(
    async (inboxItemId: string): Promise<InboxPlanCancelResponse | null> => {
      setState({ loading: true, error: null });
      try {
        const result = unwrap(await commands.inboxPlanCancel(inboxItemId));
        setState({ loading: false, error: null });
        return result;
      } catch (e: unknown) {
        setState({ loading: false, error: String(e) });
        return null;
      }
    },
    [],
  );

  return { ...state, cancel };
}

// ── Aggregate open-plans surface (spec 041, US2) ──────────────────────────────

export interface OpenPlansState {
  data: InboxOpenPlansResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Load and cache the cross-root aggregate of every open inbox plan.
 *
 * Mirrors `useInboxList`: a useState + useEffect + cancelled-flag pattern keyed
 * by a monotonic `epoch`. Call `refresh()` to re-fetch (e.g. after an
 * apply/cancel/confirm mutation).
 */
export function useOpenInboxPlans() {
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<OpenPlansState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    commands
      .inboxPlanListOpen()
      .then(unwrap)
      .then((resp) => {
        if (!cancelled) setState({ data: resp, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({ data: null, loading: false, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [epoch]);

  const refresh = useCallback(() => setEpoch((n) => n + 1), []);

  return { ...state, refresh };
}

/**
 * Apply a caller-chosen subset of open inbox plans (selection is per-ingestion
 * group / plan-level). Mirrors `useInboxPlanApplyAll`.
 */
export function useApplySelectedInboxPlans() {
  const [state, setState] = useState<PlanApplyState>({
    loading: false,
    error: null,
  });

  const applySelected = useCallback(
    async (inboxItemIds: string[]): Promise<InboxApplyAllResponse | null> => {
      setState({ loading: true, error: null });
      try {
        const result = unwrap(
          await commands.inboxPlanApplySelected({ inboxItemIds }),
        );
        setState({ loading: false, error: null });
        return result;
      } catch (e: unknown) {
        setState({ loading: false, error: String(e) });
        return null;
      }
    },
    [],
  );

  return { ...state, applySelected };
}

// ── Inbox stats hook (spec 041, US6 T039) ────────────────────────────────────

interface InboxStatsState {
  data: InboxStatsResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Load aggregate per-type frame counts across all active inbox items.
 * Mirrors `useOpenInboxPlans`: a useState + useEffect + cancelled-flag pattern
 * keyed by a monotonic `epoch`. Call `refresh()` to re-fetch.
 */
export function useInboxStats() {
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<InboxStatsState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    commands
      .inboxStats()
      .then(unwrap)
      .then((resp) => {
        if (!cancelled) setState({ data: resp, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setState({ data: null, loading: false, error: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [epoch]);

  const refresh = useCallback(() => setEpoch((n) => n + 1), []);

  return { ...state, refresh };
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
