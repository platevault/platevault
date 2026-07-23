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
 * Sort: column headers are <button> elements that call onSort (SessionsTable
 * convention). The page owns sort state and passes sortCol + sortDir.
 * Kind filter: the page passes a `kindFilter` string that filters by the item's
 * dominant frame type (groupFrameType / masterFrameType).
 */

import { useState, useMemo, useCallback } from 'react';
import type { InboxListItem, InboxSourceGroupListItem } from '@/bindings/index';
import {
  Btn,
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
import { masterLabel } from '@/lib/master-label';
import { useHotkeys } from '@/lib/useHotkeys';

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
 * row displays its spec 040 FR-006 "type · filter · exposure" label, not its
 * raw `formatTag`. The sort comparator MUST compare this same displayed
 * string — comparing the internal format tag instead (as before) let master
 * rows interleave arbitrarily with FITS rows because "FITS" never equals
 * "Master Bias" etc.
 */
function formatDisplayLabel(item: InboxListItem): string {
  return item.isMaster ? masterLabel(item) : formatTag(item);
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

// ── Source groups (spec 058 FR-016 / T013) ───────────────────────────────────

/**
 * Path label for a source-group row, mirroring {@link detectionLabel}'s
 * `relativePath`-else-root-basename rule so a group sitting directly in a root
 * reads the same as an item there rather than as a blank cell.
 */
function sourceGroupDetectionLabel(group: InboxSourceGroupListItem): string {
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
function sourceGroupLane(group: InboxSourceGroupListItem): string {
  return group.format === 'video' ? 'video' : 'fits';
}

/** Short, uppercase format tag for a source-group row's Format column. */
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
 * Sort comparator for source-group rows. They sort among themselves only —
 * they render as their own leading block rather than interleaving with items
 * (see {@link InboxListProps.sourceGroups}) — so the comparator only needs the
 * fields a group actually has. The `type` column is a constant label for every
 * source group, hence its deliberate no-op.
 */
function compareSourceGroups(
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
function itemKind(item: InboxListItem): string {
  if (item.isMaster) return item.masterFrameType ?? 'master';
  return item.frameType ?? item.groupFrameType ?? '';
}

/** Sort comparator for inbox items. */
function compareItems(
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

// ── Component types ─────────────────────────────────────────────────────────────

export interface InboxListProps {
  items: InboxListItem[];
  /**
   * Spec 058 FR-016 / T013 — folders that have been scanned but have produced
   * no item rows yet.
   *
   * These render as **structurally non-confirmable** rows: a source group has
   * no `inboxItemId`, so there is no id to hand to `inbox.confirm` and no
   * selection to drive the detail pane's Confirm button. That is the point —
   * FR-016 asks for a row that *cannot* be confirmed rather than a row that is
   * offered and then refused by a guard, because a guard is a runtime promise
   * while an absent id is a structural one.
   *
   * They render as a leading block above the item rows rather than
   * interleaving: the grouping engine (`groupByDimensions`/`ACCESSORS`) keys on
   * `InboxListItem` fields that a source group does not have, and an
   * unclassified folder has no dimension value to group under in any case.
   *
   * Inert until T020: while scan still writes a folder placeholder item, every
   * scanned folder has an item row, so `inbox.list` always returns this empty.
   */
  sourceGroups?: InboxSourceGroupListItem[];
  /**
   * Spec 058 FR-017 — trigger group-scoped classification for a scanned folder.
   *
   * Deliberately separate from {@link InboxListProps.onSelect}: a source group
   * has no `inboxItemId`, and `onSelect` feeds the `?selected=` URL param,
   * which resolves against item ids only. Routing group classification through
   * `onSelect` would both break selection and delete the FR-016 invariant that
   * a source-group row never selects anything.
   *
   * When omitted the row renders its static "not yet classified" label, so
   * existing callers and fixtures keep their current behaviour.
   */
  onClassifySourceGroup?: (group: InboxSourceGroupListItem) => void;
  /** Source group whose classification is in flight — disables its action. */
  classifyingSourceGroupId?: string | null;
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

// ── Component ───────────────────────────────────────────────────────────────────

export function InboxList({
  items,
  sourceGroups = [],
  onClassifySourceGroup,
  classifyingSourceGroupId = null,
  selectedId,
  onSelect,
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
   * Source groups surviving the active filters.
   *
   * The lane filter maps through `sourceGroupLane` (format-derived, #854). The
   * kind filter hides every source group whenever it is narrowed to a specific
   * frame type: a source group is unclassified by definition, so it matches no
   * frame-type kind — showing it under "bias" would be exactly the kind of row
   * lying about itself that this feature removes.
   */
  const filteredSourceGroups = useMemo(() => {
    let result = sourceGroups;
    if (filterType !== 'all') {
      result = result.filter((g) => sourceGroupLane(g) === filterType);
    }
    if (kindFilter && kindFilter !== 'all') {
      return [];
    }
    return [...result].sort((a, b) => compareSourceGroups(a, b, sort));
  }, [sourceGroups, filterType, kindFilter, sort]);

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
    // Source-group rows lead, ungrouped and unindented, in both the grouped and
    // flat views — see `InboxListProps.sourceGroups` for why they do not enter
    // the grouping engine.
    const groupRows: VisualRow[] = filteredSourceGroups.map((group) => ({
      kind: 'sourceGroup' as const,
      group,
    }));
    if (grouped)
      return [
        ...groupRows,
        ...flattenVisibleTree(tree, collapsed, originalIndexById),
      ];
    return [
      ...groupRows,
      ...filtered.map((item) => ({
        kind: 'item' as const,
        item,
        originalIdx: originalIndexById.get(item.inboxItemId) ?? -1,
        indent: 0,
      })),
    ];
  }, [
    grouped,
    tree,
    collapsed,
    originalIndexById,
    filtered,
    filteredSourceGroups,
  ]);

  // ── J/K triage navigation (spec 027 FR-022, issue #747) ─────────────────────
  // Bound here rather than on the page because this component owns the visual
  // order: grouping, collapse state, sort and filters all reshape it, and J/K
  // must step through what the user actually sees.
  const navigableIds = useMemo(
    () =>
      visualRows
        .filter((r): r is ItemVisualRow => r.kind === 'item')
        .map((r) => r.item.inboxItemId),
    [visualRows],
  );

  const step = useCallback(
    (delta: number) => {
      if (navigableIds.length === 0) return;
      const cur = selectedId ? navigableIds.indexOf(selectedId) : -1;
      // Clamped, not wrapped: triage is a top-to-bottom sweep, and silently
      // jumping back to the top reads as "nothing happened" at the last row.
      // With nothing selected, J enters at the top and K at the bottom.
      const next =
        cur === -1
          ? delta > 0
            ? 0
            : navigableIds.length - 1
          : Math.min(navigableIds.length - 1, Math.max(0, cur + delta));
      const id = navigableIds[next];
      if (id && id !== selectedId) onSelect(id);
    },
    [navigableIds, selectedId, onSelect],
  );

  // Single-key bindings, matching the scheme the retired Inbox ActionSidebar
  // used. useHotkeys suppresses these while a text field has focus.
  useHotkeys(
    {
      KeyJ: (e) => {
        e.preventDefault();
        step(1);
      },
      KeyK: (e) => {
        e.preventDefault();
        step(-1);
      },
    },
    [step],
  );

  // Selection moves without moving DOM focus (the target row may not even be
  // rendered under virtualization), so nothing would reach a screen reader
  // without an explicit announcement.
  const selectedItem = useMemo(
    () =>
      selectedId
        ? visualRows.find(
            (r): r is ItemVisualRow =>
              r.kind === 'item' && r.item.inboxItemId === selectedId,
          )?.item
        : undefined,
    [visualRows, selectedId],
  );

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
          const { group } = row;
          const label = sourceGroupDetectionLabel(group);
          const classifying = classifyingSourceGroupId === group.sourceGroupId;
          // No `_onClick`, no `_selected`, no item id — the row carries no
          // selection identity, so nothing here can reach `inbox.confirm`
          // (FR-016). That guarantee is structural and still holds. What the
          // row is NOT is actionless: its one action is Classify, which
          // materialises the folder's item rows and replaces this row with them
          // (FR-017).
          //
          // Classification is user-triggered, never fired on render, and never
          // routed through selection. Selection is the `?selected=<inboxItemId>`
          // URL param, so a `sourceGroupId` placed there resolves to no item and
          // the stale-selection cleanup clears it on the same commit. Auto-firing
          // on render would be worse still: it would write `inbox_items` rows for
          // folders nobody touched, raise one blocking `MetadataUnreadable` per
          // FITS-less folder, and transform rows under the user — the churn
          // FR-023 exists to prevent. See Q-10.
          return {
            _testid: `inbox-source-group-${group.sourceGroupId}`,
            _rowClassName: 'pv-inbox-table__row pv-inbox-table__row--muted',
            detection: (
              <span className="pv-inbox-cell__path-wrap">
                <span
                  className="pv-inbox-cell__path"
                  title={m.inbox_source_group_row_aria({ path: label })}
                >
                  {label}
                </span>
              </span>
            ),
            type: (
              <span className="pv-inbox-row__classification pv-inbox-row__classification--pending">
                {classifying
                  ? m.inbox_source_group_classifying()
                  : m.inbox_state_not_yet_classified()}
                {onClassifySourceGroup ? (
                  <Btn
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`inbox-source-group-classify-${group.sourceGroupId}`}
                    disabled={classifying}
                    aria-label={m.inbox_source_group_classify_aria({
                      path: label,
                    })}
                    onClick={() => onClassifySourceGroup(group)}
                  >
                    {m.inbox_source_group_classify()}
                  </Btn>
                ) : null}
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
    [visualRows, selectedId, onSelect, toggle],
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
      {/* Discoverability for the otherwise invisible J/K/C bindings (#747). */}
      <div className="pv-listtable__foot" data-testid="inbox-hotkey-hint">
        {m.inbox_hotkey_hint()}
      </div>
      {/* Keyboard selection moves no DOM focus, so announce it explicitly. */}
      <div
        className="pv-visually-hidden"
        role="status"
        aria-live="polite"
        data-testid="inbox-selection-announcer"
      >
        {selectedItem
          ? m.inbox_row_selected_aria({ label: detectionLabel(selectedItem) })
          : ''}
      </div>
    </div>
  );
}
