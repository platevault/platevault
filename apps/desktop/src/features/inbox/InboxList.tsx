/**
 * InboxList — left sidebar listing scanned inbox folders.
 *
 * Each row shows the relative path, state, file count, format, and master
 * indicator using aligned text columns (FR-008) — no Pill components in the
 * per-row layout so nothing overflows horizontally at 1100×720.
 *
 * Spec 041 (T021): the list supports USER-CONFIGURABLE multi-level grouping.
 * The user picks an ordered list of grouping dimensions ("first by X, then by
 * Y, then by Z") via a row of ordered dropdowns in the always-visible controls
 * bar. The chosen order is persisted to localStorage and the list renders as a
 * nested, collapsible tree using the shared `groupByDimensions` engine.
 */

import { useState, useMemo, useCallback, useEffect, Fragment } from 'react';
import { ListSidebar } from '@/components';
import type { InboxListItem } from '@/api/commands';
import {
  groupByDimensions,
  flattenLeafItems,
  type GroupNode,
  type DimensionAccessor,
} from './grouping';

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

/** Basename (last path segment) of an absolute path, for the "source" dimension. */
function basename(p: string | null | undefined): string | null {
  if (!p) return null;
  const trimmed = p.replace(/[/\\]+$/, '');
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || null;
}

// ── Grouping dimension registry ─────────────────────────────────────────────────

/** A user-selectable grouping dimension. */
interface Dimension {
  id: string;
  label: string;
  accessor: DimensionAccessor<InboxListItem>;
}

/**
 * Ordered registry of dimensions the user can group by. Accessors return the
 * string value or null/undefined; the engine buckets null/empty under its
 * NONE_KEY → "(none)" label.
 */
export const GROUPING_DIMENSIONS: readonly Dimension[] = [
  { id: 'target',     label: 'Target',      accessor: (i) => i.groupTarget },
  { id: 'frameType',  label: 'Frame type',  accessor: (i) => i.groupFrameType },
  { id: 'date',       label: 'Date',        accessor: (i) => i.groupDate },
  { id: 'filter',     label: 'Filter',      accessor: (i) => i.groupFilter },
  { id: 'exposure',   label: 'Exposure',    accessor: (i) => i.groupExposure },
  { id: 'instrument', label: 'Instrument',  accessor: (i) => i.groupInstrument },
  { id: 'source',     label: 'Source',      accessor: (i) => basename(i.rootAbsolutePath) },
  { id: 'format',     label: 'Format',      accessor: (i) => i.format },
  { id: 'orgState',   label: 'Org. state',  accessor: (i) => i.organizationState },
];

/** Accessor map keyed by dimension id, consumed by `groupByDimensions`. */
const ACCESSORS: Record<string, DimensionAccessor<InboxListItem>> =
  Object.fromEntries(GROUPING_DIMENSIONS.map((d) => [d.id, d.accessor]));

const DIM_LABELS: Record<string, string> =
  Object.fromEntries(GROUPING_DIMENSIONS.map((d) => [d.id, d.label]));

/** Number of ordered grouping slots offered in the configurator. */
const MAX_GROUP_LEVELS = 3;

/** localStorage key for the persisted ordered grouping dimensions. */
export const GROUPING_STORAGE_KEY = 'inbox.grouping.dims.v1';

/** Sentinel value used by the dropdowns for "no grouping at this slot". */
const NONE_DIM = '';

function loadDims(): string[] {
  try {
    const raw = localStorage.getItem(GROUPING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only known dimension ids, drop duplicates, cap at MAX_GROUP_LEVELS.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const d of parsed) {
      if (typeof d === 'string' && ACCESSORS[d] && !seen.has(d)) {
        seen.add(d);
        out.push(d);
        if (out.length >= MAX_GROUP_LEVELS) break;
      }
    }
    return out;
  } catch {
    return [];
  }
}

function saveDims(dims: string[]): void {
  try {
    localStorage.setItem(GROUPING_STORAGE_KEY, JSON.stringify(dims));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

// ── Component types ─────────────────────────────────────────────────────────────

type SortBy  = 'name' | 'state';
type FilterType = 'all' | 'fits' | 'video';

export interface InboxListProps {
  items: InboxListItem[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  filterType: string;
  onFilterTypeChange: (type: string | undefined) => void;
}

// ── Row renderer (reused for every leaf item) ───────────────────────────────────

interface RowProps {
  item: InboxListItem;
  /** Original index in the unfiltered `items` array, for selection mapping. */
  originalIdx: number;
  selected: boolean;
  onSelect: (idx: number) => void;
  /** Left indent (px) so nested leaves align under their group header. */
  indent: number;
}

function InboxRow({ item, originalIdx, selected, onSelect, indent }: RowProps) {
  return (
    <div
      data-testid={`inbox-item-${item.inboxItemId}`}
      className={`alm-list-item${selected ? ' alm-list-item--selected' : ''}${item.state === 'plan_open' ? ' alm-list-item--muted' : ''}`}
      onClick={() => onSelect(originalIdx)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(originalIdx)}
      aria-selected={selected}
      style={indent ? { paddingLeft: indent } : undefined}
    >
      {/* ── Primary line: path ── */}
      <div className="alm-list-item__title">
        <strong>{item.relativePath || '(root)'}</strong>
      </div>

      {/* ── Secondary line: structured columns ── */}
      <div
        className="alm-list-item__meta"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) auto auto',
          gap: '0 var(--alm-sp-2)',
          alignItems: 'baseline',
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
          marginTop: 2,
        }}
      >
        {/* State — left column, truncates if narrow */}
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--alm-text-secondary)',
          }}
        >
          {stateLabel(item.state)}
        </span>

        {/* File count — fixed right */}
        <span style={{ whiteSpace: 'nowrap' }}>
          {item.fileCount} {item.fileCount !== 1 ? 'files' : 'file'}
        </span>

        {/* Format / master indicator — fixed right */}
        <span
          style={{
            whiteSpace: 'nowrap',
            fontFamily: 'var(--alm-font-mono, monospace)',
            letterSpacing: '0.02em',
          }}
        >
          {item.isMaster
            ? `${item.masterFrameType ?? 'master'} master`
            : formatTag(item)}
        </span>
      </div>
    </div>
  );
}

// ── Collapsible group header + recursive tree ───────────────────────────────────

const INDENT_PER_DEPTH = 12;

interface TreeProps {
  nodes: GroupNode<InboxListItem>[];
  depth: number;
  /** Original-index lookup by item identity (stable across nesting). */
  indexOf: (item: InboxListItem) => number;
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
  collapsed: Set<string>;
  toggle: (path: string) => void;
  /** Group path prefix used to build a stable per-node collapse key. */
  pathPrefix: string;
}

function GroupTree({
  nodes,
  depth,
  indexOf,
  selectedIdx,
  onSelect,
  collapsed,
  toggle,
  pathPrefix,
}: TreeProps) {
  return (
    <>
      {nodes.map((node) => {
        const path = `${pathPrefix}/${node.dimension}:${node.key}`;
        const isCollapsed = collapsed.has(path);
        const headerIndent = depth * INDENT_PER_DEPTH;
        const childLeafIndent = (depth + 1) * INDENT_PER_DEPTH;

        return (
          <Fragment key={path}>
            <button
              type="button"
              className="alm-list-group-header"
              data-testid={`inbox-group-${node.dimension}-${node.key}`}
              onClick={() => toggle(path)}
              aria-expanded={!isCollapsed}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                background: 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                padding: '4px 8px',
                paddingLeft: 8 + headerIndent,
                font: 'inherit',
                color: 'var(--alm-text-secondary)',
                fontSize: 'var(--alm-text-xs)',
                fontWeight: 600,
              }}
            >
              <span aria-hidden="true" style={{ width: '0.7em', display: 'inline-block' }}>
                {isCollapsed ? '▸' : '▾'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {node.label}
              </span>
              <span style={{ color: 'var(--alm-text-muted)', fontWeight: 400, marginLeft: 'auto' }}>
                {node.count}
              </span>
            </button>

            {!isCollapsed && (
              node.children.length > 0 ? (
                <GroupTree
                  nodes={node.children}
                  depth={depth + 1}
                  indexOf={indexOf}
                  selectedIdx={selectedIdx}
                  onSelect={onSelect}
                  collapsed={collapsed}
                  toggle={toggle}
                  pathPrefix={path}
                />
              ) : (
                node.items.map((item) => {
                  const originalIdx = indexOf(item);
                  return (
                    <InboxRow
                      key={item.inboxItemId}
                      item={item}
                      originalIdx={originalIdx}
                      selected={selectedIdx === originalIdx}
                      onSelect={onSelect}
                      indent={8 + childLeafIndent}
                    />
                  );
                })
              )
            )}
          </Fragment>
        );
      })}
    </>
  );
}

// ── Component ───────────────────────────────────────────────────────────────────

export function InboxList({
  items,
  selectedIdx,
  onSelect,
  filterType,
  onFilterTypeChange,
}: InboxListProps) {
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [dims, setDims] = useState<string[]>(() => loadDims());
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Persist the chosen ordered dimensions whenever they change.
  useEffect(() => {
    saveDims(dims);
  }, [dims]);

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
  // the tree so the footer matches what is actually rendered).
  const visibleCount = useMemo(() => flattenLeafItems(tree).length, [tree]);

  // Map an item back to its index in the unfiltered `items` array. Identity-based
  // (the same object flows through filter/sort/group), so selection stays correct
  // through arbitrary nesting.
  const indexOf = useCallback((item: InboxListItem) => items.indexOf(item), [items]);

  const toggle = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /**
   * Update the dimension at `slot`. Selecting "(none)" clears this slot and all
   * deeper slots (a none terminates the ordered chain). Selecting a real
   * dimension also removes any later slot already using it (no duplicates).
   */
  const setSlot = useCallback((slot: number, value: string) => {
    setDims((prev) => {
      const next = prev.slice(0, slot);
      if (value !== NONE_DIM) {
        // Drop the value if it appears earlier, then append at this slot.
        const filteredPrev = next.filter((d) => d !== value);
        filteredPrev.push(value);
        return filteredPrev.slice(0, MAX_GROUP_LEVELS);
      }
      // "(none)" → truncate here (clears this and all deeper slots).
      return next;
    });
  }, []);

  // Whether grouping is active at all (drives the flat-vs-tree render path).
  const grouped = dims.length > 0;

  return (
    <ListSidebar
      placeholder="Search inbox…"
      controls={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 8px' }}>
          {/* Ordered grouping configurator: "Group by X, then by Y, then by Z". */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {Array.from({ length: MAX_GROUP_LEVELS }).map((_, slot) => {
              const value = dims[slot] ?? NONE_DIM;
              // A slot is only enabled if all earlier slots have a dimension.
              const disabled = slot > 0 && !dims[slot - 1];
              // Dimensions already chosen in earlier slots are excluded here.
              const usedEarlier = new Set(dims.slice(0, slot));
              return (
                <select
                  key={slot}
                  className="alm-select"
                  value={value}
                  disabled={disabled}
                  onChange={(e) => setSlot(slot, e.target.value)}
                  aria-label={slot === 0 ? 'Group by' : `Then group by (level ${slot + 1})`}
                >
                  <option value={NONE_DIM}>
                    {slot === 0 ? 'Group: none' : 'then: —'}
                  </option>
                  {GROUPING_DIMENSIONS.filter(
                    (d) => d.id === value || !usedEarlier.has(d.id),
                  ).map((d) => (
                    <option key={d.id} value={d.id}>
                      {slot === 0 ? `Group: ${d.label}` : `then: ${d.label}`}
                    </option>
                  ))}
                </select>
              );
            })}
          </div>
          {/* Sort + filter controls. */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <select
              className="alm-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              aria-label="Sort by"
            >
              <option value="name">Sort: name</option>
              <option value="state">Sort: state</option>
            </select>
            <select
              className="alm-select"
              value={filterType}
              onChange={(e) => {
                const v = e.target.value as FilterType;
                onFilterTypeChange(v === 'all' ? undefined : v);
              }}
              aria-label="Filter file type"
            >
              <option value="all">All file types</option>
              <option value="fits">FITS</option>
              <option value="video">Video</option>
            </select>
          </div>
        </div>
      }
      footer={
        <span className="alm-list-sidebar__count">
          {visibleCount} folder{visibleCount !== 1 ? 's' : ''}
          {grouped ? ` · grouped by ${dims.map((d) => DIM_LABELS[d]).join(' › ')}` : ''}
        </span>
      }
    >
      {grouped ? (
        <GroupTree
          nodes={tree}
          depth={0}
          indexOf={indexOf}
          selectedIdx={selectedIdx}
          onSelect={onSelect}
          collapsed={collapsed}
          toggle={toggle}
          pathPrefix="root"
        />
      ) : (
        // Flat list (current behavior) when no grouping dimensions are chosen.
        filtered.map((item) => {
          const originalIdx = items.indexOf(item);
          return (
            <InboxRow
              key={item.inboxItemId}
              item={item}
              originalIdx={originalIdx}
              selected={selectedIdx === originalIdx}
              onSelect={onSelect}
              indent={0}
            />
          );
        })
      )}
    </ListSidebar>
  );
}
