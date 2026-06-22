/**
 * InboxList — left list of scanned inbox detections.
 *
 * Each row shows the relative path, state, file count, format, and master
 * indicator using aligned text columns (FR-008) — no Pill components in the
 * per-row layout so nothing overflows horizontally at 1100×720.
 *
 * spec 043 (tasks #73/#31/#63): the grouping / sort / frame-type CONTROLS that
 * used to sit stacked in this list's header have moved UP into the shared
 * PageTopBar's FilterToolbar (see `InboxControls`). This component is now a
 * CONTROLLED presentational list — it receives the active ordered grouping
 * dimensions (`dims`), `sortBy`, and `filterType` as props and renders only the
 * (virtualized) list + a footer count.
 *
 * The user-configurable multi-level grouping (spec 041 T021) is preserved: the
 * chosen ordered dimensions render a nested, collapsible tree using the shared
 * `groupByDimensions` engine.
 *
 * Rendering is VIRTUALIZED: the grouped tree (or the flat list) is flattened
 * into a single array of visual rows (`flattenVisibleTree`) — headers plus the
 * leaf rows of expanded groups — and windowed with `@tanstack/react-virtual`
 * so a large inbox mounts only the rows in view. When the scroll viewport has
 * no measured height (e.g. jsdom under test, or the first paint before layout),
 * the virtualizer yields an empty window; in that case we fall back to
 * rendering every visual row so behavior and tests stay correct off-screen.
 */

import {
  useState,
  useMemo,
  useCallback,
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ListSidebar } from '@/components';
import type { InboxListItem } from '@/api/commands';
import {
  groupByDimensions,
  flattenLeafItems,
  type GroupNode,
} from './grouping';
import { ACCESSORS, DIM_LABELS, type InboxSortBy } from './InboxControls';

// ── Helpers ───────────────────────────────────────────────────────────────────

function stateLabel(state: string): string {
  switch (state) {
    case 'pending_classification': return 'pending';
    case 'classified':             return 'classified';
    case 'plan_open':              return 'plan open';
    case 'resolved':               return 'resolved';
    default:                       return state;
  }
}

/**
 * Short, uppercase format tag shown in the format column.
 * Keeps width predictable for alignment.
 */
function formatTag(item: InboxListItem): string {
  if (item.lane === 'video') return 'VIDEO';
  if (item.format === 'xisf') return 'XISF';
  if (item.format === 'mixed') return 'MIXED';
  return 'FITS';
}

// ── Component types ─────────────────────────────────────────────────────────────

export interface InboxListProps {
  items: InboxListItem[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  filterType: string;
  /**
   * Active ordered grouping dimensions (owned by the page / top-bar controls).
   * Optional — defaults to no grouping (flat list).
   */
  dims?: string[];
  /**
   * Active list sort (owned by the page / top-bar controls). Optional —
   * defaults to `'name'`.
   */
  sortBy?: InboxSortBy;
  /**
   * @deprecated The frame-type filter control moved to the top-bar
   * `InboxControls`. Accepted (and ignored) here only so existing standalone
   * test renders keep compiling; the page no longer passes it.
   */
  onFilterTypeChange?: (type: string | undefined) => void;
}

// ── Flattened visual-row model (drives virtualization) ───────────────────────────

const INDENT_PER_DEPTH = 12;

/** A collapsible group header row. */
export interface HeaderVisualRow {
  kind: 'header';
  /** Stable per-node collapse key (matches the GroupTree path scheme). */
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

/** Stable virtualization/react key for a visual row. */
function rowKey(row: VisualRow): string {
  return row.kind === 'header' ? `h:${row.path}` : `i:${row.item.inboxItemId}`;
}

/**
 * Walk the grouped tree in render order and produce the flat list of VISIBLE
 * visual rows: every group header, plus the leaf rows of groups that are not
 * collapsed. A collapsed group contributes only its header (descendants are
 * omitted). Leaf rows resolve their selection index via the O(1)
 * `originalIndexById` map. Mirrors the indent/path math of the old GroupTree.
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

// Estimated row heights for the virtualizer (real heights are measured on mount
// via measureElement; these only seed the initial window + total size).
const HEADER_SIZE_EST = 28;
const ITEM_SIZE_EST = 52;

// ── Row renderers ────────────────────────────────────────────────────────────────

function InboxRow({
  item,
  originalIdx,
  selected,
  onSelect,
  indent,
}: {
  item: InboxListItem;
  originalIdx: number;
  selected: boolean;
  onSelect: (idx: number) => void;
  indent: number;
}) {
  return (
    <div
      data-testid={`inbox-item-${item.inboxItemId}`}
      className={`alm-list-item${selected ? ' alm-list-item--selected' : ''}${item.state === 'plan_open' ? ' alm-list-item--muted' : ''}`}
      onClick={() => onSelect(originalIdx)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(originalIdx)}
      aria-selected={selected}
      // eslint-disable-next-line no-restricted-syntax -- dynamic: depth-based indent padding for grouped inbox rows
      style={indent ? { paddingLeft: indent } : undefined}
    >
      {/* ── Primary line: path ── */}
      <div className="alm-list-item__title">
        <strong>{item.relativePath || '(root)'}</strong>
      </div>

      {/* ── Secondary line: structured columns ── */}
      <div className="alm-list-item__meta alm-inbox-list__meta">
        {/* State — left column, truncates if narrow */}
        <span className="alm-inbox-list__meta-state">
          {stateLabel(item.state)}
        </span>

        {/* File count — fixed right */}
        <span className="alm-inbox-list__meta-count">
          {item.fileCount} {item.fileCount !== 1 ? 'files' : 'file'}
        </span>

        {/* Format / master indicator — fixed right */}
        <span className="alm-inbox-list__meta-format">
          {item.isMaster
            ? `${item.masterFrameType ?? 'master'} master`
            : formatTag(item)}
        </span>
      </div>
    </div>
  );
}

function GroupHeaderRow({
  node,
  depth,
  collapsed,
  onToggle,
}: {
  node: GroupNode<InboxListItem>;
  depth: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const headerIndent = depth * INDENT_PER_DEPTH;
  return (
    <button
      type="button"
      className="alm-list-group-header alm-inbox-list__group-header"
      data-testid={`inbox-group-${node.dimension}-${node.key}`}
      onClick={onToggle}
      aria-expanded={!collapsed}
      // eslint-disable-next-line no-restricted-syntax -- dynamic: depth-based indent padding for group header
      style={{ paddingLeft: 8 + headerIndent }}
    >
      <span aria-hidden="true" className="alm-inbox-list__group-caret">
        {collapsed ? '▸' : '▾'}
      </span>
      <span className="alm-inbox-list__group-label">
        {node.label}
      </span>
      <span className="alm-inbox-list__group-count">
        {node.count}
      </span>
    </button>
  );
}

// ── Component ───────────────────────────────────────────────────────────────────

export function InboxList({
  items,
  selectedIdx,
  onSelect,
  filterType,
  dims = [],
  sortBy = 'name',
}: InboxListProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // The scroll viewport the virtualizer measures against — captured from the
  // sizer's parent (ListSidebar's `.alm-list-sidebar__list`, which scrolls).
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    let result = items;
    if (filterType !== 'all') {
      result = result.filter((item) => item.lane === filterType);
    }
    const sorted = [...result];
    if (sortBy === 'name') {
      sorted.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    } else if (sortBy === 'state') {
      sorted.sort((a, b) => a.state.localeCompare(b.state));
    }
    return sorted;
  }, [items, filterType, sortBy]);

  // Build the nested grouping tree from the active (ordered, de-duplicated) dims.
  const tree = useMemo(
    () => groupByDimensions(filtered, dims, ACCESSORS),
    [filtered, dims],
  );

  // Total leaf count across the whole tree (== filtered length, but derived from
  // the tree so the footer matches what is actually rendered). Also split into
  // folders vs masters using the same isMaster flag that InboxStatsSummary uses.
  const { visibleFolders, visibleMasters } = useMemo(() => {
    const leaves = flattenLeafItems(tree);
    return {
      visibleFolders: leaves.filter((it) => !it.isMaster).length,
      visibleMasters: leaves.filter((it) => it.isMaster).length,
    };
  }, [tree]);

  // O(1) original-index lookup by item id (stable across filter/sort/group).
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

  // Whether grouping is active at all (drives header rows vs a plain flat list).
  const grouped = dims.length > 0;

  // Flatten to the visible visual rows the virtualizer windows. When grouped we
  // walk the tree (headers + expanded leaves); otherwise it's a flat item list.
  const visualRows = useMemo<VisualRow[]>(() => {
    if (grouped) return flattenVisibleTree(tree, collapsed, originalIndexById);
    return filtered.map((item) => ({
      kind: 'item' as const,
      item,
      originalIdx: originalIndexById.get(item.inboxItemId) ?? -1,
      indent: 0,
    }));
  }, [grouped, tree, collapsed, originalIndexById, filtered]);

  const rowVirtualizer = useVirtualizer({
    count: visualRows.length,
    getScrollElement: () => scrollEl,
    estimateSize: (i) => (visualRows[i].kind === 'header' ? HEADER_SIZE_EST : ITEM_SIZE_EST),
    getItemKey: (i) => rowKey(visualRows[i]),
    overscan: 8,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  // Window only when the virtualizer has a measured viewport; otherwise (no
  // size yet / jsdom) render every row so nothing is hidden off-screen.
  const windowed = virtualItems.length > 0;

  // Capture the scrolling ancestor once the sizer mounts.
  const sizerRef = useCallback((node: HTMLDivElement | null) => {
    setScrollEl((node?.parentElement as HTMLDivElement | null) ?? null);
  }, []);

  // ↑/↓ move the selection across visible leaf rows (skipping headers), keeping
  // the moved-to row scrolled into view in the virtualized window.
  const onListKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const itemPositions: number[] = [];
      visualRows.forEach((r, i) => {
        if (r.kind === 'item') itemPositions.push(i);
      });
      if (itemPositions.length === 0) return;
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      let cur = itemPositions.findIndex(
        (i) => (visualRows[i] as ItemVisualRow).originalIdx === selectedIdx,
      );
      if (cur === -1) cur = dir === 1 ? -1 : itemPositions.length;
      const nextPos = Math.min(Math.max(cur + dir, 0), itemPositions.length - 1);
      const targetRowIndex = itemPositions[nextPos];
      onSelect((visualRows[targetRowIndex] as ItemVisualRow).originalIdx);
      rowVirtualizer.scrollToIndex(targetRowIndex);
    },
    [visualRows, selectedIdx, onSelect, rowVirtualizer],
  );

  const renderVisualRow = useCallback(
    (row: VisualRow) =>
      row.kind === 'header' ? (
        <GroupHeaderRow
          node={row.node}
          depth={row.depth}
          collapsed={row.collapsed}
          onToggle={() => toggle(row.path)}
        />
      ) : (
        <InboxRow
          item={row.item}
          originalIdx={row.originalIdx}
          selected={selectedIdx === row.originalIdx}
          onSelect={onSelect}
          indent={row.indent}
        />
      ),
    [toggle, selectedIdx, onSelect],
  );

  return (
    <ListSidebar
      placeholder="Search inbox…"
      footer={
        <span className="alm-list-sidebar__count">
          {(() => {
            const parts: string[] = [];
            if (visibleFolders > 0) parts.push(`${visibleFolders} folder${visibleFolders !== 1 ? 's' : ''}`);
            if (visibleMasters > 0) parts.push(`${visibleMasters} master${visibleMasters !== 1 ? 's' : ''}`);
            const summary = parts.length > 0 ? parts.join(' · ') : '0 detections';
            return grouped ? `${summary} · grouped by ${dims.map((d) => DIM_LABELS[d]).join(' › ')}` : summary;
          })()}
        </span>
      }
    >
      <div
        ref={sizerRef}
        data-testid="inbox-virtual-sizer"
        className="alm-inbox-list__sizer"
        onKeyDown={onListKeyDown}
        // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer total height for windowed mode
        style={{
          height: windowed ? rowVirtualizer.getTotalSize() : undefined,
        }}
      >
        {windowed
          ? virtualItems.map((vi) => {
              const row = visualRows[vi.index];
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer translateY offset per inbox row
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  {renderVisualRow(row)}
                </div>
              );
            })
          : visualRows.map((row) => (
              <Fragment key={rowKey(row)}>{renderVisualRow(row)}</Fragment>
            ))}
      </div>
    </ListSidebar>
  );
}
