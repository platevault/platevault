// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reconciled inbox stats derived from the SAME item list the header and footer
 * count from (spec: stats-strip reconciliation).
 *
 * The backend `inbox.stats` command tallies per-type folder counts by counting
 * a folder once per frame type it contains, so a mixed "(root)" folder is
 * double-counted across types and the stats-strip total drifts from the
 * header/footer ("3 folders" vs "6 Folders"). This helper recomputes totals and
 * the per-type breakdown using DISTINCT-folder counting (each inbox folder is
 * counted exactly once, under a single bucket) so every site agrees.
 *
 *   total folders === sum(perType.folderCount)
 *   total masters === sum(perType.masterCount)
 *
 * matching `items.filter(!isMaster).length` / `items.filter(isMaster).length`
 * used by the InboxList header and footer.
 */

import type {
  InboxListItem,
  InboxStatsResponse,
  InboxStatsPerType,
} from '@/bindings/index';

/**
 * Bucket key for a folder/master with no single resolved dominant frame type
 * (`groupFrameType`/`masterFrameType` is null/empty, or the legacy cross-type
 * sentinel string `"Mixed"`).
 *
 * #791: this was named `"mixed"`, which the status-bar chip renders verbatim
 * (capitalised via CSS) as "Mixed N" — colliding with the UNRELATED per-item
 * "mixed folder" concept shown in the detail pane (a folder whose files
 * genuinely span more than one frame type). In practice a real mixed folder's
 * dominant type usually DOES resolve (e.g. to "light"), so this bucket is
 * actually dominated by items with no frame type at all yet (pending/
 * unclassified). "Unresolved" names that population without reusing the
 * "mixed" word.
 */
const UNRESOLVED_KEY = 'unresolved';

/**
 * Normalise a frame-type value into a stable per-type bucket key. `null`,
 * empty, or the cross-type sentinel `"Mixed"` all collapse to the single
 * {@link UNRESOLVED_KEY} bucket so such an item is counted exactly once
 * overall.
 */
function bucketKey(frameType: string | null | undefined): string {
  if (frameType == null || frameType === '') return UNRESOLVED_KEY;
  const lower = frameType.toLowerCase();
  return lower === 'mixed' ? UNRESOLVED_KEY : lower;
}

/**
 * Derive a reconciled {@link InboxStatsResponse} from the active inbox item
 * list. Each item contributes to exactly one per-type bucket: non-master
 * folders by their dominant `groupFrameType`, masters by their `masterFrameType`.
 */
export function deriveInboxStats(
  items: readonly InboxListItem[],
): InboxStatsResponse {
  const byType = new Map<string, InboxStatsPerType>();
  let folders = 0;
  let masters = 0;
  let images = 0;

  const rowFor = (key: string): InboxStatsPerType => {
    let row = byType.get(key);
    if (!row) {
      row = { frameType: key, folderCount: 0, masterCount: 0, imageCount: 0 };
      byType.set(key, row);
    }
    return row;
  };

  for (const item of items) {
    images += item.fileCount;
    if (item.isMaster) {
      masters += 1;
      const row = rowFor(bucketKey(item.masterFrameType));
      row.masterCount += 1;
      row.imageCount += item.fileCount;
    } else {
      folders += 1;
      const row = rowFor(bucketKey(item.groupFrameType));
      row.folderCount += 1;
      row.imageCount += item.fileCount;
    }
  }

  // Stable display order: alphabetical by frame type, "unresolved" last.
  const perType = [...byType.values()].sort((a, b) => {
    if (a.frameType === UNRESOLVED_KEY) return 1;
    if (b.frameType === UNRESOLVED_KEY) return -1;
    return a.frameType.localeCompare(b.frameType);
  });

  return { totals: { folders, masters, images }, perType };
}
