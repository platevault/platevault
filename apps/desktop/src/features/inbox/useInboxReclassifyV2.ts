// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// ── reclassify_v2 (spec 041 R-13/T068, issue #755) ────────────────────────────
//
// Field-agnostic + bulk reclassify. Lives in the InboxDetail file set (not
// `./store`) so this feature's scope stays self-contained; the v1
// `useInboxReclassify` hook in `./store` is untouched for other/legacy callers.

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { ipcArgs } from '@/lib/ipc-args';
import { queryKeys } from '@/data/queryKeys';

export interface ReclassifyV2Args {
  /** Per-file property overrides (frameType correction, R-13). */
  overrides?: Array<{ filePath: string; properties: Record<string, unknown> }>;
  /** Bulk "set all" entries applied to a subset of files. */
  bulk?: Array<{ property: string; value: unknown; filePaths?: string[] }>;
}

/**
 * Returns a `reclassify_v2` callback + loading state, scoped to one inbox item.
 *
 * Scoped to the STABLE `sourceGroupId` when the item carries one: sub-item ids
 * are volatile across re-splits — the first `inbox.classify` of a folder
 * materializes single-type sub-items and PURGES the superseded placeholder row
 * (`materialize_sub_items`), so the id the pane mounted with can already be
 * deleted by the time the user clicks Apply. Sending that stale id fails the
 * whole apply with `inbox.item.not_found` (observed as the CI-red Layer-2
 * journey `inbox_ui_unclassified_gate_bulk_reclassify_unblocks_confirm`); the
 * source-group id survives every re-split. `inboxItemId` remains the fallback
 * for legacy rows that predate source groups.
 */
export function useInboxReclassifyV2(
  inboxItemId: string,
  rootAbsolutePath: string,
  sourceGroupId?: string | null,
) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const reclassifyV2 = useCallback(
    async (args: ReclassifyV2Args) => {
      setLoading(true);
      try {
        const result = unwrap(
          await commands.inboxReclassifyV2(
            ipcArgs<typeof commands.inboxReclassifyV2>({
              // Exactly ONE scope key: the stable source group when known,
              // else the item id (legacy rows predating source groups).
              ...(sourceGroupId ? { sourceGroupId } : { inboxItemId }),
              overrides: args.overrides ?? [],
              bulk: args.bulk ?? [],
              // Lets the re-split hash the group's real files, so each
              // re-materialized sub-item gets a per-group content signature
              // the confirm staleness guard can actually compare.
              rootAbsolutePath,
            }),
          ),
        );
        // v2 re-splits the source group into sub-items (R-14), so the item
        // list itself may have changed shape, not just this item's evidence.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.inbox.list('all'),
        });
        void queryClient.invalidateQueries({
          queryKey: [queryKeys.inbox.list('all')[0], 'classify'],
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.inbox.metadata(inboxItemId),
        });
        return result;
      } finally {
        setLoading(false);
      }
    },
    [inboxItemId, rootAbsolutePath, sourceGroupId, queryClient],
  );

  return { reclassifyV2, loading };
}
