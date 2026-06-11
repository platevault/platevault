/**
 * Inbox store — reactive hooks for classify, confirm, and reclassify.
 *
 * Uses `createParameterizedStore` keyed by string IDs. Classification results
 * are keyed by `${rootAbsolutePath}|${inboxItemId}`. Scan results are keyed
 * by `${rootId}|${rootAbsolutePath}`.
 */

import { useCallback, useState } from 'react';
import { createParameterizedStore, useParameterizedQuery } from '@/data/store';
import {
  inboxScanFolder,
  inboxClassify,
  inboxConfirm,
  inboxReclassify,
} from '@/api/commands';
import type {
  InboxClassifyResponse,
  InboxConfirmResponse,
  InboxReclassifyResponse,
  InboxScanFolderResponse,
} from '@/api/commands';

export type {
  InboxClassifyResponse,
  InboxConfirmResponse,
  InboxReclassifyResponse,
  InboxScanFolderResponse,
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
