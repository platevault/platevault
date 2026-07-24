// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * InboxList model layer — pure functions (no React, no JSX) for sort,
 * filter, classification labels, and visual-row tree flattening.
 *
 * Extracted from InboxList.tsx to isolate presentational logic from rendering.
 */

import type { InboxListItem, InboxSourceGroupListItem } from '@/bindings/index';
import { tableIndent } from '@/ui';
import type { GroupNode } from './grouping';
import { m } from '@/lib/i18n';
import { masterLabel } from '@/lib/master-label';

// ── Sort model ────────────────────────────────────────────────────────────────

export type InboxSortCol = 'detection' | 'type' | 'count' | 'format';
export type SortDir = 'asc' | 'desc';

export interface InboxSort {
  col: InboxSortCol;
  dir: SortDir;
}

export const DEFAULT_INBOX_SORT: InboxSort = { col: 'detection', dir: 'asc' };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * `true` when the T070/FR-047 mandatory-attribute gate failed for this item:
 * one or more files are missing a mandatory attribute, or have no frame type
 * at all, so the item cannot be confirmed until the user supplies them.
 *
 * Spec 058 FR-028 (T008): this is the backend's persisted verdict
 * (`inbox_items.needs_review`), not a guess derived from `groupKey`.
 * `groupKey` now carries classification identity only.
 */
export function isNeedsReview(item: InboxListItem): boolean {
  return item.needsReview;
}

/**
 * `true` when the item's own cached classification (`classificationResult`
 * — the SAME `inbox_classifications` row `inbox.classify`/the detail panel
 * read) has not resolved to a single type, and no dominant frame type is
 * otherwise known.
 *
 * Issue #711 Instance A (unsplit-folder variant): `classify()`
 * unconditionally sets `inbox_items.state = "classified"` once a folder has
 * been scanned, regardless of whether it actually resolved to one type —
 * for an empty/mixed/needs-review unsplit folder (no `frameType`/
 * `groupFrameType`, not the `__needs_review__` sentinel), `state` alone
 * would misleadingly render as "classified" while the detail panel/
 * `inbox.classify` correctly show "unclassified". `classificationResult` is
 * the only remaining signal that still agrees with them in that case.
 * Scoped to pre-confirm states only — a `plan_open`/`resolved` item is never
 * relabeled by this.
 */
export function isUnresolvedClassification(item: InboxListItem): boolean {
  return (
    item.classificationResult === 'unclassified' &&
    (item.state === 'pending_classification' || item.state === 'classified')
  );
}

/**
 * Classification label shown in the Type column. For classified / plan-open
 * items we show the dominant frame type when available so the column is
 * frame-type-forward rather than state-forward. A needs-review sub-item has
 * no dominant frame type by definition — it must show a distinct
 * "needs review" label, never the raw item `state` (which is otherwise
 * `classified` at this point and would misleadingly read as fully resolved).
 *
 * `frameType` is checked before `groupFrameType`: it is the authoritative,
 * singular post-materialization value (spec 041 T066 — items are single-type
 * after materialization), while `groupFrameType` is the legacy
 * aggregate-with-"Mixed"-fallback field. A single-file materialized sub-item
 * can carry a stale/aggregate `groupFrameType` of `"Mixed"` even though it is
 * definitionally never a mix of types (#550) — preferring `frameType` avoids
 * that mislabel.
 */
export function classificationLabel(item: InboxListItem): string {
  if (item.isMaster)
    return item.masterFrameType ?? m.inbox_state_master_fallback();
  if (item.frameType) return item.frameType;
  if (item.groupFrameType) return item.groupFrameType;
  if (isNeedsReview(item)) return m.inbox_state_needs_review();
  if (isUnresolvedClassification(item)) return m.inbox_state_unclassified();
  switch (item.state) {
    case 'pending_classification':
      return m.inbox_state_pending();
    case 'classified':
      return m.inbox_state_classified();
    case 'plan_open':
      return m.inbox_state_plan_open();
    case 'resolved':
      return m.inbox_state_resolved();
    default:
      return item.state;
  }
}

/** CSS colour modifier for the Type cell. */
export function classificationMod(item: InboxListItem): string {
  if (isNeedsReview(item)) return 'needs_review';
  if (isUnresolvedClassification(item)) return 'pending';
  switch (item.state) {
    case 'pending_classification':
      return 'pending';
    case 'classified':
      return 'classified';
    case 'plan_open':
      return 'plan_open';
    case 'resolved':
      return 'resolved';
    default:
      return 'classified';
  }
}

/** Short, uppercase format tag shown in the Format column. */
export function formatTag(item: InboxListItem): string {
  if (item.lane === 'video') return 'VIDEO';
  if (item.format === 'xisf') return 'XISF';
  if (item.format === 'mixed') return 'MIXED';
  return 'FITS';
}

/**
 * The exact label rendered in the Format column cell (issue #649): a master
 * row displays its spec 040 FR-006 "type · filter · exposure" label, not its
 * raw `formatTag`. The sort comparator MUST compare this same displayed
 * string — comparing the internal format tag instead (as before) let master
 * rows interleave arbitrarily with FITS rows because "FITS" never equals
 * "Master Bias" etc.
 */
export function formatDisplayLabel(item: InboxListItem): string {
  return item.isMaster ? masterLabel(item) : formatTag(item);
}

/**
 * Trailing path segment of an absolute path, tolerating both `/` and `\`
 * (Windows roots) separators. Falls back to the whole string when there is
 * no separator (e.g. a bare drive letter).
 */
export function pathBasename(absolutePath: string): string {
  const trimmed = absolutePath.replace(/[/\\]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/**
 * Label for the Path column when `relativePath` is empty (the item sits
 * directly in a source root). Every root-level item previously rendered the
 * literal constant `"(root)"`, so ~100+ rows across different roots were
 * visually and semantically indistinguishable (#556). The root's own
 * basename is a meaningful, distinguishing label per source instead.
 */
export function detectionLabel(item: InboxListItem): string {
  if (item.relativePath) return item.relativePath;
  const base = pathBasename(item.rootAbsolutePath);
  return base || m.inbox_list_root_label();
}

// ── Source groups (spec 058 FR-016 / T013) ───────────────────────────────────

/**
 * Path label for a source-group row, mirroring {@link detectionLabel}'s
 * `relativePath`-else-root-basename rule so a group sitting directly in a root
 * reads the same as an item there rather than as a blank cell.
 */
export function sourceGroupDetectionLabel(
  group: InboxSourceGroupListItem,
): string {
  if (group.relativePath) return group.relativePath;
  const base = pathBasename(group.rootAbsolutePath);
  return base || m.inbox_list_root_label();
}

/**
 * Lane a source group belongs to for the `fits`/`video` lane filter.
 *
 * **Derived from `format`, never from `group.lane`** — issue #854.
 * `inbox_source_groups.lane` is the `"move"`/`"catalogue"` lane and
 * `inbox_items.lane` is `CHECK(lane IN ('fits','video'))`; the two columns
 * share a name and nothing else. Filtering source groups on `group.lane` would
 * compare `"move"` against `"fits"` and silently hide every source group.
 */
export function sourceGroupLane(group: InboxSourceGroupListItem): string {
  return group.format === 'video' ? 'video' : 'fits';
}

/** Short, uppercase format tag for a source-group row's Format column. */
export function sourceGroupFormatTag(group: InboxSourceGroupListItem): string {
  switch (group.format) {
    case 'video':
      return 'VIDEO';
    case 'xisf':
      return 'XISF';
    case 'mixed':
      return 'MIXED';
    default:
      return 'FITS';
  }
}

/**
 * Sort comparator for source-group rows. They sort among themselves only —
 * they render as their own leading block rather than interleaving with items
 * (see {@link InboxListProps.sourceGroups}) — so the comparator only needs the
 * fields a group actually has. The `type` column is a constant label for every
 * source group, hence its deliberate no-op.
 */
export function compareSourceGroups(
  a: InboxSourceGroupListItem,
  b: InboxSourceGroupListItem,
  sort: InboxSort,
): number {
  let cmp = 0;
  switch (sort.col) {
    case 'detection':
      cmp = a.relativePath.localeCompare(b.relativePath);
      break;
    case 'count':
      cmp = a.fileCount - b.fileCount;
      break;
    case 'format':
      cmp = sourceGroupFormatTag(a).localeCompare(sourceGroupFormatTag(b));
      break;
    case 'type':
      cmp = 0;
      break;
  }
  return sort.dir === 'asc' ? cmp : -cmp;
}

/** Dominant frame-type key for kind-filtering (matches the Kind filter options). */
export function itemKind(item: InboxListItem): string {
  if (item.isMaster) return item.masterFrameType ?? 'master';
  return item.frameType ?? item.groupFrameType ?? '';
}

/** Sort comparator for inbox items. */
export function compareItems(
  a: InboxListItem,
  b: InboxListItem,
  sort: InboxSort,
): number {
  let cmp = 0;
  switch (sort.col) {
    case 'detection':
      cmp = a.relativePath.localeCompare(b.relativePath);
      break;
    case 'type':
      cmp = classificationLabel(a).localeCompare(classificationLabel(b));
      break;
    case 'count':
      cmp = a.fileCount - b.fileCount;
      break;
    case 'format':
      cmp = formatDisplayLabel(a).localeCompare(formatDisplayLabel(b));
      break;
  }
  return sort.dir === 'asc' ? cmp : -cmp;
}

// ── Flattened visual-row model (drives grouping + windowing) ─────────────────

/** A collapsible group header row. */
export interface HeaderVisualRow {
  kind: 'header';
  path: string;
  node: GroupNode<InboxListItem>;
  depth: number;
  collapsed: boolean;
}

/** A leaf item row. */
export interface ItemVisualRow {
  kind: 'item';
  item: InboxListItem;
  /** Original index in the unfiltered `items` array, for selection mapping. */
  originalIdx: number;
  /** Left indent (px) so nested leaves align under their group header. */
  indent: number;
}

/**
 * A scanned-but-unclassified folder row (spec 058 FR-016). Deliberately
 * carries no `originalIdx` and no item — there is no item identity to select
 * or confirm.
 */
export interface SourceGroupVisualRow {
  kind: 'sourceGroup';
  group: InboxSourceGroupListItem;
}

export type VisualRow = HeaderVisualRow | ItemVisualRow | SourceGroupVisualRow;

/**
 * Walk the grouped tree in render order and produce the flat list of VISIBLE
 * visual rows: every group header, plus the leaf rows of groups that are not
 * collapsed. A collapsed group contributes only its header.
 */
export function flattenVisibleTree(
  nodes: readonly GroupNode<InboxListItem>[],
  collapsed: ReadonlySet<string>,
  originalIndexById: ReadonlyMap<string, number>,
): VisualRow[] {
  const rows: VisualRow[] = [];
  const walk = (
    ns: readonly GroupNode<InboxListItem>[],
    depth: number,
    pathPrefix: string,
  ) => {
    for (const node of ns) {
      const path = `${pathPrefix}/${node.dimension}:${node.key}`;
      const isCollapsed = collapsed.has(path);
      rows.push({ kind: 'header', path, node, depth, collapsed: isCollapsed });
      if (isCollapsed) continue;
      if (node.children.length > 0) {
        walk(node.children, depth + 1, path);
      } else {
        const indent = tableIndent(depth + 1);
        for (const item of node.items) {
          rows.push({
            kind: 'item',
            item,
            originalIdx: originalIndexById.get(item.inboxItemId) ?? -1,
            indent,
          });
        }
      }
    }
  };
  walk(nodes, 0, 'root');
  return rows;
}
