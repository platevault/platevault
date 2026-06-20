/**
 * Inbox store — reactive hooks for classify, confirm, and reclassify.
 *
 * Uses `createParameterizedStore` keyed by string IDs. Classification results
 * are keyed by `${rootAbsolutePath}|${inboxItemId}`. Scan results are keyed
 * by `${rootId}|${rootAbsolutePath}`.
 */

import { useCallback, useEffect, useState } from 'react';
import { createParameterizedStore, useParameterizedQuery } from '@/data/store';
import {
  inboxScanFolder,
  inboxClassify,
  inboxConfirm,
  inboxList,
  inboxReclassify,
  inboxPlan,
  inboxPlanApply,
  inboxPlanApplyAll,
  inboxPlanCancel,
} from '@/api/commands';
import type {
  InboxClassifyResponse,
  InboxConfirmResponse,
  InboxListItem,
  InboxListResponse,
  InboxReclassifyResponse,
  InboxScanFolderResponse,
  InboxApplyAllResponse,
  InboxPlanCancelResponse,
  InboxPlanView,
  PlanApplyResponse,
} from '@/api/commands';

export type {
  InboxClassifyResponse,
  InboxConfirmResponse,
  InboxListItem,
  InboxListResponse,
  InboxReclassifyResponse,
  InboxScanFolderResponse,
  InboxApplyAllResponse,
  InboxPlanCancelResponse,
  InboxPlanView,
  PlanApplyResponse,
};

// ── Parameterised stores ──────────────────────────────────────────────────────

/**
 * Store for inbox.classify results.
 * Key format: `${rootAbsolutePath}|${inboxItemId}[|force]`
 */
export const classifyStore = createParameterizedStore<string, InboxClassifyResponse>(
  (key) => {
    const [rootAbsolutePath, inboxItemId, forceStr] = key.split('|');
    return inboxClassify({
      inboxItemId,
      rootAbsolutePath,
      forceRescan: forceStr === 'force',
    });
  },
);

/**
 * Store for inbox.scan.folder results.
 * Key format: `${rootId}|${rootAbsolutePath}`
 */
export const scanFolderStore = createParameterizedStore<string, InboxScanFolderResponse>(
  (key) => {
    const [rootId, ...rest] = key.split('|');
    const rootAbsolutePath = rest.join('|');
    return inboxScanFolder({ rootId, rootAbsolutePath, followSymlinks: false });
  },
);

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
  return useParameterizedQuery(classifyStore, key);
}

/** Load and cache an inbox scan for a root folder. */
export function useInboxScan(rootId: string, rootAbsolutePath: string) {
  const key = `${rootId}|${rootAbsolutePath}`;
  return useParameterizedQuery(scanFolderStore, key);
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export interface ConfirmState {
  loading: boolean;
  result: InboxConfirmResponse | null;
  error: string | null;
}

/** Returns a confirm callback and its loading/result state. */
export function useInboxConfirm() {
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
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState({ loading: false, result: null, error: msg });
        throw e;
      }
    },
    [],
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
        classifyStore.invalidateAll();
        return result;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setState({ loading: false, result: null, error: msg });
        throw e;
      }
    },
    [inboxItemId],
  );

  return { ...state, reclassify };
}

// ── Cross-root list hooks (spec 039) ─────────────────────────────────────────

export interface InboxListState {
  data: InboxListResponse | null;
  loading: boolean;
  error: string | null;
}

/**
 * Load and cache the cross-root unacknowledged inbox list.
 * Call `refresh()` to re-fetch (e.g. after a rescan).
 */
export function useInboxList() {
  const [epoch, setEpoch] = useState(0);
  const [state, setState] = useState<InboxListState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    inboxList()
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

export interface RescanState {
  loading: boolean;
  error: string | null;
}

/**
 * Trigger a rescan of all registered roots (FR-005).
 * Each root with a known `rootId` and `rootAbsolutePath` is re-scanned via
 * `inboxScanFolder`; confirmed items are not resurrected (the scan only
 * INSERT OR IGNOREs — existing resolved rows keep their state).
 * On completion, `onComplete` is called so the caller can refresh the list.
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
  const [state, setState] = useState<PlanState>({ plan: null, loading: false, error: null });

  const fetchPlan = useCallback(async () => {
    if (!inboxItemId) {
      setState({ plan: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const plan = await inboxPlan(inboxItemId);
      setState({ plan, loading: false, error: null });
    } catch (e: unknown) {
      const msg = String(e);
      // 'no_plan' is expected when the item was just confirmed and listener
      // hasn't fired yet, or when the item is not in plan_open state.
      if (msg.includes('inbox.item.no_plan') || msg.includes('inbox.item.not_found')) {
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
  const [state, setState] = useState<PlanApplyState>({ loading: false, error: null });

  const apply = useCallback(
    async (inboxItemId: string): Promise<PlanApplyResponse | null> => {
      setState({ loading: true, error: null });
      try {
        const result = await inboxPlanApply(inboxItemId);
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
  const [state, setState] = useState<PlanApplyState>({ loading: false, error: null });

  const applyAll = useCallback(async (): Promise<InboxApplyAllResponse | null> => {
    setState({ loading: true, error: null });
    try {
      const result = await inboxPlanApplyAll();
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
  const [state, setState] = useState<PlanApplyState>({ loading: false, error: null });

  const cancel = useCallback(
    async (inboxItemId: string): Promise<InboxPlanCancelResponse | null> => {
      setState({ loading: true, error: null });
      try {
        const result = await inboxPlanCancel(inboxItemId);
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
