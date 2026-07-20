// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * InboxList — the inbox detection list, rendered with the shared `Table`
 * construct (same as Sessions / Calibration) so font, row height, headers, and
 * group sub-headers match the rest of the app. Virtualized via `Table`'s
 * opt-in padding-spacer windowing (the inbox is capped at 500 rows but can
 * still be large), so it stays windowed without a bespoke list.
 *
 * Columns: Path (relative path, primary) · Type (frame type / state) · Files ·
 * Format. When grouping is active, the chosen ordered dimensions render
 * collapsible group sub-header rows (shared `groupByDimensions` engine); leaf
 * rows indent under their group. Selection + grouping controls are owned by the
 * page / top-bar (FilterToolbar + useGrouping); this is a controlled
 * presentational list.
 *
 * Rows are of two kinds: inbox items, and — spec 058 T013/FR-016 —
 * scanned-but-unclassified source-group folders, which are visible and
 * selectable but have no item id and therefore nothing to confirm.
 *
 * Sort: column headers are <button> elements that call onSort (SessionsTable
 * convention). The page owns sort state and passes sortCol + sortDir.
 * Kind filter: the page passes a `kindFilter` string that filters by the item's
 * dominant frame type (groupFrameType / masterFrameType).
 */

import { useState, useMemo, useCallback } from 'react';
import type { InboxListItem, InboxSourceGroupListItem } from '@/bindings/index';
import {
  Table,
  tableIndent,
  Skeleton,
  Pill,
  type TableColumn,
  type TableRow,
} from '@/ui';
import { SortHeader, ariaSortFor } from '@/components';
import { groupByDimensions, type GroupNode } from './grouping';
import { ACCESSORS, dimLabel } from './InboxControls';
import { m } from '@/lib/i18n';

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
function isNeedsReview(item: InboxListItem): boolean {
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
function isUnresolvedClassification(item: InboxListItem): boolean {
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
function classificationLabel(item: InboxListItem): string {
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
function classificationMod(item: InboxListItem): string {
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
function formatTag(item: InboxListItem): string {
  if (item.lane === 'video') return 'VIDEO';
  if (item.format === 'xisf') return 'XISF';
  if (item.format === 'mixed') return 'MIXED';
  return 'FITS';
}

/**
 * The exact label rendered in the Format column cell (issue #649): a master
 * row displays `"{type} master"`, not its raw `formatTag`. The sort
 * comparator MUST compare this same displayed string — comparing the
 * internal format tag instead (as before) let master rows interleave
 * arbitrarily with FITS rows because "FITS" never equals "bias master" etc.
 */
function formatDisplayLabel(item: InboxListItem): string {
  return item.isMaster
    ? m.inbox_master_row_label({
        type: item.masterFrameType ?? m.inbox_state_master_fallback(),
      })
    : formatTag(item);
}

/**
 * Trailing path segment of an absolute path, tolerating both `/` and `\`
 * (Windows roots) separators. Falls back to the whole string when there is
 * no separator (e.g. a bare drive letter).
 */
function pathBasename(absolutePath: string): string {
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
function detectionLabel(item: InboxListItem): string {
  if (item.relativePath) return item.relativePath;
  const base = pathBasename(item.rootAbsolutePath);
  return base || m.inbox_list_root_label();
}

/**
 * Short, uppercase format tag for a source-group row. Mirrors `formatTag` but
 * reads the group's own `format`, because a source group has no `lane` in the
 * `fits`/`video` sense — its `lane` column is the `move`/`catalogue` lane, a
 * different axis that happens to share the name (see `InboxSourceGroupListItem`).
 */
function sourceGroupFormatTag(group: InboxSourceGroupListItem): string {
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
 * The `fits`/`video` lane a source-group row answers to for the lane filter.
 * Derived from `format` for the reason above: filtering source groups on their
 * own `lane` column would silently match the `move`/`catalogue` values against
 * `fits`/`video` and hide every group whatever the user picked.
 */
function sourceGroupLane(group: InboxSourceGroupListItem): string {
  return group.format === 'video' ? 'video' : 'fits';
}

/** Path label for a source-group row — same root-basename fallback as items (#556). */
function sourceGroupLabel(group: InboxSourceGroupListItem): string {
  if (group.relativePath) return group.relativePath;
  const base = pathBasename(group.rootAbsolutePath);
  return base || m.inbox_list_root_label();
}

/** Dominant frame-type key for kind-filtering (matches the Kind filter options). */
function itemKind(item: InboxListItem): string {
  if (item.isMaster) return item.masterFrameType ?? 'master';
  return item.frameType ?? item.groupFrameType ?? '';
}

/**
 * The four sortable values, projected off either row kind so one comparator
 * orders items and source-group rows in a single sequence. Sorting the two
 * kinds separately would pin every source group above (or below) the items
 * regardless of the chosen column, which reads as a broken sort.
 */
interface SortKey {
  detection: string;
  type: string;
  count: number;
  format: string;
}

function itemSortKey(item: InboxListItem): SortKey {
  return {
    detection: item.relativePath,
    type: classificationLabel(item),
    count: item.fileCount,
    format: formatDisplayLabel(item),
  };
}

function sourceGroupSortKey(group: InboxSourceGroupListItem): SortKey {
  return {
    detection: group.relativePath,
    type: m.inbox_source_group_state(),
    count: group.fileCount,
    format: sourceGroupFormatTag(group),
  };
}

/** Sort comparator over the projected keys of either row kind. */
function compareSortKeys(a: SortKey, b: SortKey, sort: InboxSort): number {
  let cmp = 0;
  switch (sort.col) {
    case 'detection':
      cmp = a.detection.localeCompare(b.detection);
      break;
    case 'type':
      cmp = a.type.localeCompare(b.type);
      break;
    case 'count':
      cmp = a.count - b.count;
      break;
    case 'format':
      cmp = a.format.localeCompare(b.format);
      break;
  }
  return sort.dir === 'asc' ? cmp : -cmp;
}

/** Sort comparator for inbox items. */
function compareItems(
  a: InboxListItem,
  b: InboxListItem,
  sort: InboxSort,
): number {
  return compareSortKeys(itemSortKey(a), itemSortKey(b), sort);
}

// ── Component types ─────────────────────────────────────────────────────────────

export interface InboxListProps {
  items: InboxListItem[];
  /**
   * Spec 058 T013/FR-016: folders the scan found but that carry no inbox item
   * yet. These render as rows so the folder is visible and selectable, but they
   * are **structurally** non-confirmable — a source group has no item id, and
   * selection is reported through `onSelectSourceGroup`, a channel entirely
   * separate from `onSelect`. Confirm reads the selected *item*, so there is no
   * value it could be handed; nothing here refuses a confirm, there is simply
   * nothing to refuse.
   */
  sourceGroups?: InboxSourceGroupListItem[];
  /** Currently selected source group, if the selection is a source-group row. */
  selectedSourceGroupId?: string | null;
  /** Called when the user selects a source-group row. */
  onSelectSourceGroup?: (sourceGroupId: string) => void;
  /** Issue #644: selection is by item identity, not list position — an index
   * silently points at whatever item now occupies that slot after search/lane/
   * kind filters change the array shape. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Lane filter ('all' | 'fits' | 'video'). Owned by the page (URL state). */
  filterType: string;
  /** Active ordered grouping dimensions (owned by the page / top-bar controls). */
  dims?: string[];
  /**
   * Frame-type kind filter ('all' | 'bias' | 'dark' | 'flat' | 'light' | 'master').
   * Owned by the page.
   */
  kindFilter?: string;
  /** When true, the detection list is still loading — show skeleton rows. */
  loading?: boolean;
  /** Active sort state. Owned by the page. */
  sort?: InboxSort;
  /** Called when the user clicks a sortable column header. */
  onSort?: (col: InboxSortCol) => void;
  /** @deprecated Sort state is now owned by column headers via sort/onSort. */
  sortBy?: string;
  /** @deprecated The frame-type filter control moved to the top-bar FilterToolbar. */
  onFilterTypeChange?: (type: string | undefined) => void;
}

// ── Flattened visual-row model (drives grouping + windowing) ─────────────────────

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
 * A scanned-but-unclassified folder row (spec 058 T013). Deliberately carries
 * the group — never an `InboxListItem`-shaped stand-in — so no downstream
 * consumer can read an `inboxItemId` off it.
 */
export interface SourceGroupVisualRow {
  kind: 'sourceGroup';
  group: InboxSourceGroupListItem;
  /** Left indent (px), to match leaf alignment when grouping is active. */
  indent: number;
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

// ── Component ───────────────────────────────────────────────────────────────────

export function InboxList({
  items,
  sourceGroups = [],
  selectedId,
  selectedSourceGroupId = null,
  onSelect,
  onSelectSourceGroup,
  filterType,
  dims = [],
  kindFilter,
  loading = false,
  sort = DEFAULT_INBOX_SORT,
  onSort,
}: InboxListProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    let result = items;
    // Lane filter (fits / video).
    if (filterType !== 'all') {
      result = result.filter((item) => item.lane === filterType);
    }
    // Kind filter (bias / dark / flat / light / master).
    if (kindFilter && kindFilter !== 'all') {
      result = result.filter((item) => itemKind(item) === kindFilter);
    }
    // Sort via column headers (replaces the old name/state sort dropdown).
    const sorted = [...result].sort((a, b) => compareItems(a, b, sort));
    return sorted;
  }, [items, filterType, kindFilter, sort]);

  /**
   * Source-group rows surviving the same two filters.
   *
   * The kind filter drops them whenever it is set to a specific frame type: an
   * unclassified folder has no frame type, so it matches no kind. Showing it
   * under "bias" would be the exact class of claim-what-you-are-not this
   * feature removes.
   */
  const filteredGroups = useMemo(() => {
    let result = sourceGroups;
    if (filterType !== 'all') {
      result = result.filter((g) => sourceGroupLane(g) === filterType);
    }
    if (kindFilter && kindFilter !== 'all') return [];
    return result;
  }, [sourceGroups, filterType, kindFilter]);

  const tree = useMemo(
    () => groupByDimensions(filtered, dims, ACCESSORS),
    [filtered, dims],
  );

  const originalIndexById = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((it, i) => {
      m.set(it.inboxItemId, i);
    });
    return m;
  }, [items]);

  const toggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const grouped = dims.length > 0;

  const visualRows = useMemo<VisualRow[]>(() => {
    const groupRows: SourceGroupVisualRow[] = filteredGroups.map((group) => ({
      kind: 'sourceGroup' as const,
      group,
      indent: 0,
    }));

    // Grouping dimensions read item fields (frame type, target, lane…) that an
    // unclassified folder has none of, so source-group rows cannot be placed in
    // the tree. They render as a flat block above it rather than being dropped
    // — a folder disappearing because the user grouped the list would be the
    // invisible-folder failure FR-016 exists to prevent.
    if (grouped) {
      return [
        ...groupRows,
        ...flattenVisibleTree(tree, collapsed, originalIndexById),
      ];
    }

    const itemRows: ItemVisualRow[] = filtered.map((item) => ({
      kind: 'item' as const,
      item,
      originalIdx: originalIndexById.get(item.inboxItemId) ?? -1,
      indent: 0,
    }));

    // Ungrouped, both kinds sort as one sequence off the shared key projection.
    // Keys are computed once per row up front (rather than inside the
    // comparator, which would re-derive every label on each of the O(n log n)
    // comparisons) and carried alongside the row.
    const keyed: { row: VisualRow; key: SortKey }[] = [
      ...groupRows.map((row) => ({ row, key: sourceGroupSortKey(row.group) })),
      ...itemRows.map((row) => ({ row, key: itemSortKey(row.item) })),
    ];
    keyed.sort((a, b) => compareSortKeys(a.key, b.key, sort));
    return keyed.map((entry) => entry.row);
  }, [
    grouped,
    tree,
    collapsed,
    originalIndexById,
    filtered,
    filteredGroups,
    sort,
  ]);

  // ── Sortable column headers (SessionsTable convention) ──────────────────────
  const makeSortHeader = (
    col: InboxSortCol,
    label: string,
    ariaLabel: string,
  ) => (
    <SortHeader
      label={label}
      active={sort.col === col}
      dir={sort.dir}
      onClick={() => onSort?.(col)}
      ariaLabel={ariaLabel}
    />
  );
  // aria-sort lives on the <th> (shared Table), not the SortHeader button.
  const thSort = (col: InboxSortCol) => ariaSortFor(sort.col === col, sort.dir);

  // Build columns with sortable headers.
  const COLUMNS: TableColumn[] = [
    {
      key: 'detection',
      label: makeSortHeader(
        'detection',
        m.inbox_col_detection(),
        m.inbox_sort_detection_aria(),
      ),
      ariaSort: thSort('detection'),
      style: { width: '20rem' },
    },
    {
      key: 'type',
      label: makeSortHeader(
        'type',
        m.inbox_col_type(),
        m.inbox_sort_type_aria(),
      ),
      ariaSort: thSort('type'),
      style: { width: '7.5rem' },
    },
    {
      key: 'count',
      label: makeSortHeader(
        'count',
        m.inbox_col_files(),
        m.inbox_sort_files_aria(),
      ),
      ariaSort: thSort('count'),
      className: 'num',
      style: { width: '5rem' },
    },
    {
      key: 'format',
      label: makeSortHeader(
        'format',
        m.inbox_dim_format(),
        m.inbox_sort_format_aria(),
      ),
      ariaSort: thSort('format'),
      className: 'pv-inbox-cell--right',
      style: { width: '7rem' },
    },
  ];

  // Map the visual rows onto shared-Table rows (group sub-headers + item rows).
  const rows = useMemo<TableRow[]>(
    () =>
      visualRows.map((row) => {
        if (row.kind === 'header') {
          const { node, depth, path, collapsed: isCollapsed } = row;
          return {
            _rowClassName: 'pv-inbox-table__group',
            _indent: tableIndent(depth),
            // The collapse control is a real <button> (keyboard-accessible,
            // announces expanded state) inside the group cell — not a clickable
            // <tr>. It carries the group testid + aria-expanded.
            detection: (
              <button
                type="button"
                className="pv-inbox-table__group-cell"
                data-testid={`inbox-group-${node.dimension}-${node.key}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggle(path)}
              >
                <span className="pv-inbox-list__group-caret" aria-hidden="true">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <span className="pv-inbox-list__group-label">{node.label}</span>
                <span className="pv-inbox-list__group-count">{node.count}</span>
              </button>
            ),
            type: '',
            count: '',
            format: '',
          };
        }
        if (row.kind === 'sourceGroup') {
          const { group, indent } = row;
          const selected = selectedSourceGroupId === group.sourceGroupId;
          return {
            _testid: `inbox-source-group-${group.sourceGroupId}`,
            _rowClassName: [
              'pv-inbox-table__row',
              'pv-inbox-table__row--source-group',
              selected ? 'pv-inbox-table__row--selected' : '',
            ]
              .filter(Boolean)
              .join(' '),
            _onClick: () => onSelectSourceGroup?.(group.sourceGroupId),
            _selected: selected,
            _indent: indent || undefined,
            detection: (
              <span className="pv-inbox-cell__path-wrap">
                <span
                  className="pv-inbox-cell__path"
                  title={sourceGroupLabel(group)}
                >
                  {sourceGroupLabel(group)}
                </span>
              </span>
            ),
            type: (
              <span className="pv-inbox-row__classification pv-inbox-row__classification--pending">
                {m.inbox_source_group_state()}
              </span>
            ),
            count: m.inbox_list_file_count({ count: group.fileCount }),
            format: sourceGroupFormatTag(group),
          };
        }
        const { item, indent } = row;
        const selected = selectedId === item.inboxItemId;
        const mod = classificationMod(item);
        return {
          _testid: `inbox-item-${item.inboxItemId}`,
          _rowClassName: [
            'pv-inbox-table__row',
            selected ? 'pv-inbox-table__row--selected' : '',
            item.state === 'plan_open' ? 'pv-inbox-table__row--muted' : '',
          ]
            .filter(Boolean)
            .join(' '),
          _onClick: () => onSelect(item.inboxItemId),
          _selected: selected,
          _indent: indent || undefined,
          detection: (
            <span className="pv-inbox-cell__path-wrap">
              <span
                className="pv-inbox-cell__path"
                title={detectionLabel(item)}
              >
                {detectionLabel(item)}
              </span>
              {/* Issue #605: an in-context hint that Confirm already created a
                  reviewable plan — the Type column keeps showing the item's
                  dominant frame type (classificationLabel checks frameType
                  before state), so without this the row looks unchanged and
                  reads as "my confirm did nothing". Additive: no action
                  needed here, "Review plans" in the top bar remains the one
                  place to act on it. */}
              {item.state === 'plan_open' && (
                <Pill
                  variant="info"
                  data-testid={`inbox-item-plan-pending-${item.inboxItemId}`}
                >
                  {m.inbox_row_plan_pending()}
                </Pill>
              )}
            </span>
          ),
          type: (
            <span
              className={`pv-inbox-row__classification pv-inbox-row__classification--${mod}`}
            >
              {classificationLabel(item)}
            </span>
          ),
          count: m.inbox_list_file_count({ count: item.fileCount }),
          format: formatDisplayLabel(item),
        };
      }),
    [
      visualRows,
      selectedId,
      selectedSourceGroupId,
      onSelect,
      onSelectSourceGroup,
      toggle,
    ],
  );

  const groupingHint = grouped
    ? m.inbox_grouping_hint({ dims: dims.map((d) => dimLabel(d)).join(' › ') })
    : null;

  return (
    <div className="pv-listtable" data-testid="inbox-list">
      {visualRows.length === 0 && loading ? (
        <div className="pv-listtable__empty">
          <Skeleton variant="block" count={8} label={m.common_loading()} />
        </div>
      ) : visualRows.length === 0 ? (
        <div className="pv-listtable__empty">{m.inbox_no_detections()}</div>
      ) : (
        <Table
          className="pv-inbox-table"
          columns={COLUMNS}
          rows={rows}
          virtualized
          estimateRowHeight={40}
          scrollClassName="pv-listtable__scroll"
          scrollTestId="inbox-virtual-sizer"
        />
      )}
      {groupingHint && (
        <div className="pv-listtable__foot" data-testid="inbox-grouping-hint">
          {groupingHint}
        </div>
      )}
    </div>
  );
}
