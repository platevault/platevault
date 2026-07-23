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
  InboxSourceGroupListItem,
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
 *
 * #625: case AND underscore/hyphen/space variants of the same raw FITS
 * IMAGETYP value must collapse into one bucket — an unnormalised "Dark_flat"
 * vs "Darkflat" otherwise leaked into the status bar as two separate sibling
 * categories ("Dark_flat 1 · Darkflat 6") instead of one normalized category.
 */
function bucketKey(frameType: string | null | undefined): string {
  if (frameType == null || frameType === '') return UNRESOLVED_KEY;
  const lower = frameType.toLowerCase().replace(/[\s_-]+/g, '');
  return lower === 'mixed' ? UNRESOLVED_KEY : lower;
}

/**
 * Derive a reconciled {@link InboxStatsResponse} from the active inbox item
 * list. Each item contributes to exactly one per-type bucket: non-master
 * folders by their dominant `groupFrameType`, masters by their `masterFrameType`.
 *
 * Spec 058 T022 / CHK010 ([#1178](https://github.com/platevault/platevault/issues/1178)):
 * source-group rows ARE counted. A scanned-but-unclassified folder is a row the
 * list renders, so a summary that omitted it would report fewer rows than the
 * user can see — the same class of disagreement SC-004 exists to remove. Each
 * source group counts as exactly one folder in the {@link UNRESOLVED_KEY}
 * bucket: it has no frame type by definition (that is what "unclassified"
 * means), so it can never key into a resolved bucket.
 *
 * `sourceGroups` is optional so existing single-argument callers and fixtures
 * keep compiling; omitting it is equivalent to passing an empty array, which is
 * also the runtime state until the scan-time placeholder is removed (T020).
 */
export function deriveInboxStats(
  items: readonly InboxListItem[],
  sourceGroups: readonly InboxSourceGroupListItem[] = [],
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

  // A source group is a folder the list shows but that has produced no item
  // rows yet. It contributes a folder (never a master — a master item carries a
  // NULL `source_group_id` and is excluded from `sourceGroups` by the query's
  // `file_count > 0` carve-out) and its scanned sub-frame count.
  for (const group of sourceGroups) {
    images += group.fileCount;
    folders += 1;
    const row = rowFor(UNRESOLVED_KEY);
    row.folderCount += 1;
    row.imageCount += group.fileCount;
  }

  // Stable display order: alphabetical by frame type, "unresolved" last.
  const perType = [...byType.values()].sort((a, b) => {
    if (a.frameType === UNRESOLVED_KEY) return 1;
    if (b.frameType === UNRESOLVED_KEY) return -1;
    return a.frameType.localeCompare(b.frameType);
  });

  return { totals: { folders, masters, images }, perType };
}
