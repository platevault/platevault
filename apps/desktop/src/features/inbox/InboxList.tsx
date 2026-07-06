/**
 * InboxList — the inbox detection list, rendered with the shared `Table`
 * construct (same as Sessions / Calibration) so font, row height, headers, and
 * group sub-headers match the rest of the app. Virtualized via `Table`'s
 * opt-in padding-spacer windowing (the inbox is capped at 500 rows but can
 * still be large), so it stays windowed without a bespoke list.
 *
 * Columns: Detection (path, primary) · Type (frame type / state) · Files ·
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
import type { InboxListItem } from '@/bindings/index';
import { Table, type TableColumn, type TableRow } from '@/ui';
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
 * `true` for a materialized single-type sub-item that landed in the T070/
 * FR-047 needs-review sentinel bucket (spec 041 "single-type sub-items"):
 * one or more files are missing a mandatory attribute (or have no frame
 * type at all), so the group has no single dominant frame type — the
 * backend marks this with `groupKey === "__needs_review__"` and a non-empty
 * `missingMandatory` list (see `crates/app/inbox/src/classify.rs`'s
 * `SENTINEL_NEEDS_REVIEW`). Both signals are checked because legacy
 * pre-materialization rows may carry neither.
 */
function isNeedsReview(item: InboxListItem): boolean {
  return item.groupKey === '__needs_review__' || (item.missingMandatory?.length ?? 0) > 0;
}

/**
 * Classification label shown in the Type column. For classified / plan-open
 * items we show the dominant frame type when available so the column is
 * frame-type-forward rather than state-forward. A needs-review sub-item has
 * no dominant frame type by definition — it must show a distinct
 * "needs review" label, never the raw item `state` (which is otherwise
 * `classified` at this point and would misleadingly read as fully resolved).
 */
function classificationLabel(item: InboxListItem): string {
  if (item.isMaster) return item.masterFrameType ?? m.inbox_state_master_fallback();
  if (item.groupFrameType) return item.groupFrameType;
  if (isNeedsReview(item)) return m.inbox_state_needs_review();
  switch (item.state) {
    case 'pending_classification': return m.inbox_state_pending();
    case 'classified':             return m.inbox_state_classified();
    case 'plan_open':              return m.inbox_state_plan_open();
    case 'resolved':               return m.inbox_state_resolved();
    default:                       return item.state;
  }
}

/** CSS colour modifier for the Type cell. */
function classificationMod(item: InboxListItem): string {
  if (isNeedsReview(item)) return 'needs_review';
  switch (item.state) {
    case 'pending_classification': return 'pending';
    case 'classified':             return 'classified';
    case 'plan_open':              return 'plan_open';
    case 'resolved':               return 'resolved';
    default:                       return 'classified';
  }
}

/** Short, uppercase format tag shown in the Format column. */
function formatTag(item: InboxListItem): string {
  if (item.lane === 'video') return 'VIDEO';
  if (item.format === 'xisf') return 'XISF';
  if (item.format === 'mixed') return 'MIXED';
  return 'FITS';
}

/** Dominant frame-type key for kind-filtering (matches the Kind filter options). */
function itemKind(item: InboxListItem): string {
  if (item.isMaster) return item.masterFrameType ?? 'master';
  return item.groupFrameType ?? '';
}

/** Sort comparator for inbox items. */
function compareItems(a: InboxListItem, b: InboxListItem, sort: InboxSort): number {
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
      cmp = formatTag(a).localeCompare(formatTag(b));
      break;
  }
  return sort.dir === 'asc' ? cmp : -cmp;
}

// ── Component types ─────────────────────────────────────────────────────────────

export interface InboxListProps {
  items: InboxListItem[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  /** Lane filter ('all' | 'fits' | 'video'). Owned by the page (URL state). */
  filterType: string;
  /** Active ordered grouping dimensions (owned by the page / top-bar controls). */
  dims?: string[];
  /**
   * Frame-type kind filter ('all' | 'bias' | 'dark' | 'flat' | 'light' | 'master').
   * Owned by the page.
   */
  kindFilter?: string;
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

const INDENT_PER_DEPTH = 12;

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

export type VisualRow = HeaderVisualRow | ItemVisualRow;

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
  const walk = (ns: readonly GroupNode<InboxListItem>[], depth: number, pathPrefix: string) => {
    for (const node of ns) {
      const path = `${pathPrefix}/${node.dimension}:${node.key}`;
      const isCollapsed = collapsed.has(path);
      rows.push({ kind: 'header', path, node, depth, collapsed: isCollapsed });
      if (isCollapsed) continue;
      if (node.children.length > 0) {
        walk(node.children, depth + 1, path);
      } else {
        const indent = 8 + (depth + 1) * INDENT_PER_DEPTH;
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
  selectedIdx,
  onSelect,
  filterType,
  dims = [],
  kindFilter,
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

  const tree = useMemo(
    () => groupByDimensions(filtered, dims, ACCESSORS),
    [filtered, dims],
  );

  const originalIndexById = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((it, i) => m.set(it.inboxItemId, i));
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
    if (grouped) return flattenVisibleTree(tree, collapsed, originalIndexById);
    return filtered.map((item) => ({
      kind: 'item' as const,
      item,
      originalIdx: originalIndexById.get(item.inboxItemId) ?? -1,
      indent: 0,
    }));
  }, [grouped, tree, collapsed, originalIndexById, filtered]);

  // ── Sortable column headers (SessionsTable convention) ──────────────────────
  const makeSortHeader = (col: InboxSortCol, label: string, ariaLabel: string) => (
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
      label: makeSortHeader('detection', m.inbox_col_detection(), m.inbox_sort_detection_aria()),
      ariaSort: thSort('detection'),
    },
    {
      key: 'type',
      label: makeSortHeader('type', m.inbox_col_type(), m.inbox_sort_type_aria()),
      ariaSort: thSort('type'),
      style: { width: '7.5rem' },
    },
    {
      key: 'count',
      label: makeSortHeader('count', m.inbox_col_files(), m.inbox_sort_files_aria()),
      ariaSort: thSort('count'),
      className: 'num',
      style: { width: '5rem' },
    },
    {
      key: 'format',
      label: makeSortHeader('format', m.inbox_dim_format(), m.inbox_sort_format_aria()),
      ariaSort: thSort('format'),
      className: 'alm-inbox-cell--right',
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
            _rowClassName: 'alm-inbox-table__group',
            // The collapse control is a real <button> (keyboard-accessible,
            // announces expanded state) inside the group cell — not a clickable
            // <tr>. It carries the group testid + aria-expanded.
            detection: (
              <button
                type="button"
                className="alm-inbox-table__group-cell"
                data-testid={`inbox-group-${node.dimension}-${node.key}`}
                aria-expanded={!isCollapsed}
                onClick={() => toggle(path)}
                // eslint-disable-next-line no-restricted-syntax -- dynamic: depth-based group-header indent
                style={{ paddingLeft: 8 + depth * INDENT_PER_DEPTH }}
              >
                <span className="alm-inbox-list__group-caret" aria-hidden="true">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <span className="alm-inbox-list__group-label">{node.label}</span>
                <span className="alm-inbox-list__group-count">{node.count}</span>
              </button>
            ),
            type: '',
            count: '',
            format: '',
          };
        }
        const { item, originalIdx, indent } = row;
        const selected = selectedIdx === originalIdx;
        const mod = classificationMod(item);
        return {
          _testid: `inbox-item-${item.inboxItemId}`,
          _rowClassName: [
            'alm-inbox-table__row',
            selected ? 'alm-inbox-table__row--selected' : '',
            item.state === 'plan_open' ? 'alm-inbox-table__row--muted' : '',
          ]
            .filter(Boolean)
            .join(' '),
          _onClick: () => onSelect(originalIdx),
          detection: (
            <span
              className="alm-inbox-cell__path"
              title={item.relativePath || m.inbox_list_root_label()}
              // eslint-disable-next-line no-restricted-syntax -- dynamic: nested-group leaf indent
              style={indent ? { paddingLeft: indent } : undefined}
            >
              {item.relativePath || m.inbox_list_root_label()}
            </span>
          ),
          type: (
            <span
              className={`alm-inbox-row__classification alm-inbox-row__classification--${mod}`}
            >
              {classificationLabel(item)}
            </span>
          ),
          count: m.inbox_list_file_count({ count: item.fileCount }),
          format: item.isMaster
            ? m.inbox_master_row_label({ type: item.masterFrameType ?? m.inbox_state_master_fallback() })
            : formatTag(item),
        };
      }),
    [visualRows, selectedIdx, onSelect, toggle],
  );

  const groupingHint = grouped
    ? m.inbox_grouping_hint({ dims: dims.map((d) => dimLabel(d)).join(' › ') })
    : null;

  return (
    <div className="alm-listtable" data-testid="inbox-list">
      {visualRows.length === 0 ? (
        <div className="alm-listtable__empty">{m.inbox_no_detections()}</div>
      ) : (
        <Table
          className="alm-inbox-table"
          columns={COLUMNS}
          rows={rows}
          virtualized
          estimateRowHeight={40}
          scrollClassName="alm-listtable__scroll"
          scrollTestId="inbox-virtual-sizer"
        />
      )}
      {groupingHint && (
        <div className="alm-listtable__foot" data-testid="inbox-grouping-hint">
          {groupingHint}
        </div>
      )}
    </div>
  );
}
