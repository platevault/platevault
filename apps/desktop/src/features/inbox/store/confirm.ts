// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inbox store — mutation hooks for confirm, reclassify, and source-group
 * classification.
 */

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { ipcArgs } from '@/lib/ipc-args';
import type {
  InboxConfirmResponse,
  ChosenAttributionDto_Deserialize as ChosenAttributionRequest,
} from '@/bindings/index';
import type {
  InboxReclassifyResponse,
} from '@/bindings/aliases';

export type {
  InboxConfirmResponse,
  InboxReclassifyResponse,
};

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
      /** The user's attribution pick (spec 008 FR-022) — omitted when unpicked. */
      chosenAttribution?: ChosenAttributionRequest;
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
            chosenAttribution: args.chosenAttribution ?? null,
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

export interface ClassifySourceGroupState {
  /** Id of the group currently being classified, or null when idle. */
  pendingSourceGroupId: string | null;
  error: string | null;
}

/**
 * Group-scoped classification for a scanned-but-unclassified folder
 * (spec 058 FR-017).
 *
 * Deliberately NOT a `useQuery`, unlike {@link useInboxClassification}.
 * `inbox.classify` is idempotent and safe to cache; this operation
 * *materialises item rows* as a side effect, so firing it from a cache miss on
 * remount would silently create rows the user never asked for. It follows the
 * hand-rolled mutation pattern this file uses everywhere else (see
 * {@link useInboxConfirm}).
 *
 * Busy state is keyed by `sourceGroupId` rather than a bare boolean because a
 * successful call *erases the row that triggered it*: the group leaves
 * `sourceGroups` and reappears as item rows on the next `inbox.list`. A bare
 * boolean would keep a spinner alive on a row that no longer exists.
 *
 * It is deliberately NOT fired on render (Q-10). Auto-firing would write
 * `inbox_items` rows for every folder the user never touched, raise one
 * blocking `MetadataUnreadable` per FITS-less folder on load, and transform
 * rows underneath the user — the selection churn FR-023 exists to prevent and
 * which Q-4 already rejected its Option A over. The trigger is an explicit
 * per-row action.
 *
 * Re-running is safe: `upsert_inbox_sub_item` is `ON CONFLICT(root_id,
 * relative_path, group_key) DO UPDATE` and orphaned siblings are removed by
 * `delete_sub_item_if_unlinked`, so a double-click converges rather than
 * duplicating rows.
 */
export function useInboxClassifySourceGroup() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ClassifySourceGroupState>({
    pendingSourceGroupId: null,
    error: null,
  });

  const classifySourceGroup = useCallback(
    async (args: { sourceGroupId: string; rootAbsolutePath: string }) => {
      setState({ pendingSourceGroupId: args.sourceGroupId, error: null });
      try {
        const result = unwrap(
          await commands.inboxClassifySourceGroup({
            sourceGroupId: args.sourceGroupId,
            rootAbsolutePath: args.rootAbsolutePath,
          }),
        );
        setState({ pendingSourceGroupId: null, error: null });
        // Required for the row to turn over: without this the group row stays
        // on screen and the freshly materialised items never appear.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.inbox.list('all'),
        });
        return result;
      } catch (e) {
        setState({
          pendingSourceGroupId: null,
          error: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    },
    [queryClient],
  );

  return { ...state, classifySourceGroup };
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
