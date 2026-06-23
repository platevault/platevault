/**
 * TargetsTable — spec 043 shared list-page adoption (task #73), refined #82,
 * VIRTUALIZED + planning columns (#84/#85), spec 044 mock columns.
 *
 * A DENSE, FULL-WIDTH sortable table (shared `Table` look) that is the primary
 * content of the Targets page's `ListPageLayout`; TargetDetailV2 lives in the
 * detail pane.
 *
 * Columns (spec 044): Designation · Type · Max alt · (sparkline) · Visible
 * tonight · Opposition · Lunar dist · Filters · Imaging time · Sessions.
 *
 * Task #84 — VIRTUALIZATION (padding-spacer pattern):
 *   The Planner catalogue is large; rendering every row synchronously blocks the
 *   main thread. Rows (group-header rows AND target rows) are flattened into one
 *   list and windowed with `@tanstack/react-virtual`.
 *
 *   IMPORTANT — mixing a real CSS `<table>` with TanStack Virtual requires the
 *   PADDING-SPACER pattern, NOT the tbody-height + transform pattern:
 *
 *   Problem: setting `height: totalSize` on `<tbody>` and leaving rows in normal
 *   table flow (display:table-row) causes the browser to distribute the total
 *   height across the rendered rows — each row stretches to totalSize/rowCount
 *   (~1.7 M px with 13 rows rendered from 11 k). If `measureElement` is also
 *   attached it reads the stretched height and re-inflates totalSize → runaway
 *   feedback loop → effectively invisible table.
 *
 *   Fix: keep `<tbody>` height unstyled (natural). Render two sentinel spacer
 *   `<tr>` rows — one before the windowed slice (height = start of first virtual
 *   row) and one after (height = totalSize − end of last virtual row). Real data
 *   rows render between them in normal table flow at their natural ~36 px height.
 *   No transforms, no absolutepositioning, no tbody height, no measureElement.
 *   Row heights are uniform so fixed `estimateSize` is exact.
 *
 *   jsdom fallback: when the scroll element has no measurable height the
 *   virtualizer yields zero virtual items. In that case all rows render with no
 *   spacers — windowing is a runtime perf optimization, not a behavior change.
 *
 * Task #85 — PLANNING COLUMNS:
 *   The low-value Constellation/Magnitude columns are replaced with
 *   planning-relevant ones driven by the STUB altitude model (planner-altitude.ts):
 *   max altitude tonight, a tiny inline opposition/altitude SPARKLINE per row, and
 *   a visible-tonight indicator. STUB — real values arrive with ephemeris +
 *   observer location (#58); the list endpoint has no coordinates (#57), so these
 *   are derived deterministically from the designation, not from the sky.
 *
 * Spec 044 mock columns (NOT astronomy, per spec 044 §3):
 *   - Lunar dist: mock 0–180° separation from Moon, keyed off designation hash.
 *   - Filters: simple bracketing (bright+close → NB only; else broadband+NB).
 *   - Imaging time: hours above the user-configured altitude threshold tonight.
 *   - Opposition: date stub (renders '—' until backend ephemeris #58 lands).
 *   All are SORTABLE; the usable-altitude threshold is configurable via Settings.
 *
 * Task #82:
 *   Row density follows the GLOBAL density setting (`density-*` on <html>).
 *   GROUP-BY: rows render under spanning group-header rows, grouped by Catalogue
 *   (default) or Object type.
 *
 * Search + the catalogue / group-by controls live in the page top bar; this
 * surface owns no toolbar state. Selecting a row opens TargetDetailV2 (selection
 * is driven by the host page via `?selected`).
 */

import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TargetListItem } from '@/api/commands';
import { Pill } from '@/ui';
import { catalogueOf, catalogueLabel } from './planner-catalog';
import { rowAltitudeFor, USABLE_ALT_DEG, type RowAltitude } from './planner-altitude';
import { AltitudeSparkline } from './AltitudeSparkline';
import { FilterBadges } from './FilterBadges';
import { m } from '@/lib/i18n';
import { useFavourites } from './useFavourites';
import {
  groupByDimensions,
  flattenVisibleGroups,
  type DimensionAccessor,
} from '@/lib/grouping';
import { useCollapsibleGroups } from '@/lib/use-grouping';

// ── Sort model ────────────────────────────────────────────────────────────────

/**
 * Columns the table can sort by.
 *
 * Spec 044 additions (mock values, sortable):
 *   - maxAlt: sorts by peak altitude tonight (deterministic mock)
 *   - visible: sorts by visibleTonight flag then hoursAboveUsable
 *   - opposition: stub — all values '—'; sort is a no-op (order preserved)
 *   - lunarDist: sorts by mock lunar distance
 *   - imagingTime: sorts by hoursAboveUsable
 *   - sessions: stub — all values 0; sort is a no-op
 */
export type TargetSortCol =
  | 'designation'
  | 'type'
  | 'maxAlt'
  | 'visible'
  | 'opposition'
  | 'lunarDist'
  | 'imagingTime'
  | 'sessions';
export type SortDir = 'asc' | 'desc';

export interface TargetSort {
  col: TargetSortCol;
  dir: SortDir;
}

export const DEFAULT_TARGET_SORT: TargetSort = { col: 'designation', dir: 'asc' };

// ── Grouping model (task #82) ───────────────────────────────────────────────────

/** What the table groups rows by (Planner top-bar Group-by control). */
export type TargetGroupBy = 'catalogue' | 'type';
export const DEFAULT_TARGET_GROUP_BY: TargetGroupBy = 'catalogue';

/** Formats the objectType string into a readable label. */
export function formatType(objectType: string): string {
  return objectType.replace(/_/g, ' ');
}

/** Resolve the group key + display headline for a target under `groupBy`. */
function groupHeadlineOf(t: TargetListItem, groupBy: TargetGroupBy): string {
  if (groupBy === 'type') {
    return t.objectType ? formatType(t.objectType) : 'Unknown type';
  }
  const cat = catalogueOf(t);
  return cat ? catalogueLabel(cat) : 'Other';
}

function compareStr(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Compare two target+altitude pairs for sorting. Altitude-derived columns
 * require the pre-computed `RowAltitude` values (which encode the user's
 * threshold), so the comparator receives them alongside the list items.
 */
function compareTargetRows(
  a: TargetListItem,
  altA: RowAltitude,
  b: TargetListItem,
  altB: RowAltitude,
  sort: TargetSort,
): number {
  let cmp = 0;
  switch (sort.col) {
    case 'designation':
      cmp = compareStr(a.effectiveLabel, b.effectiveLabel);
      break;
    case 'type':
      cmp = compareStr(a.objectType, b.objectType);
      break;
    case 'maxAlt':
      cmp = altA.maxAltDeg - altB.maxAltDeg;
      break;
    case 'visible':
      // Primary: visible flag (true > false). Secondary: hours above threshold.
      cmp =
        Number(altA.visibleTonight) - Number(altB.visibleTonight) ||
        altA.hoursAboveUsable - altB.hoursAboveUsable;
      break;
    case 'opposition':
      // All values are '—' until backend ephemeris lands; preserve input order.
      cmp = 0;
      break;
    case 'lunarDist':
      cmp = altA.lunarDistanceDeg - altB.lunarDistanceDeg;
      break;
    case 'imagingTime':
      cmp = altA.hoursAboveUsable - altB.hoursAboveUsable;
      break;
    case 'sessions':
      // All values are 0 until backend #57 lands; preserve input order.
      cmp = 0;
      break;
  }
  return sort.dir === 'asc' ? cmp : -cmp;
}

interface TargetGroup {
  label: string;
  /** Each entry holds the item and its pre-computed altitude row. */
  rows: Array<{ target: TargetListItem; alt: RowAltitude }>;
}

/**
 * Group targets by the selected key, compute altitude for each, sort within
 * groups, then order groups by their first (sorted) row.
 */
function groupTargets(
  targets: TargetListItem[],
  sort: TargetSort,
  groupBy: TargetGroupBy,
  usableAltDeg: number,
): TargetGroup[] {
  const byKey = new Map<string, Array<{ target: TargetListItem; alt: RowAltitude }>>();
  for (const t of targets) {
    const key = groupHeadlineOf(t, groupBy);
    const alt = rowAltitudeFor(t, usableAltDeg);
    const bucket = byKey.get(key);
    if (bucket) bucket.push({ target: t, alt });
    else byKey.set(key, [{ target: t, alt }]);
  }

  const groups: TargetGroup[] = [];
  for (const [label, rows] of byKey) {
    groups.push({
      label,
      rows: [...rows].sort((ra, rb) =>
        compareTargetRows(ra.target, ra.alt, rb.target, rb.alt, sort),
      ),
    });
  }

  groups.sort((ga, gb) => {
    const cmp = compareTargetRows(
      ga.rows[0].target,
      ga.rows[0].alt,
      gb.rows[0].target,
      gb.rows[0].alt,
      sort,
    );
    return cmp !== 0 ? cmp : compareStr(ga.label, gb.label);
  });
  return groups;
}

// ── Flattened virtual-row model ────────────────────────────────────────────────
//
// The virtualizer windows a single flat list, so groups + targets are flattened
// into a discriminated union. Group-header rows and target rows estimate to the
// same row height (keyed off --alm-row-height in CSS).

type FlatRow =
  | { kind: 'group'; key: string; label: string; count: number; path?: string; depth?: number; collapsible?: boolean; collapsed?: boolean }
  | { kind: 'target'; key: string; target: TargetListItem; alt: RowAltitude; depth?: number };

// ── Multi-level grouping accessors ────────────────────────────────────────────

export const TARGET_ACCESSORS: Readonly<Record<string, DimensionAccessor<TargetListItem>>> = {
  constellation: (t) => (t as TargetListItem & { constellation?: string }).constellation ?? null,
  type: (t) => t.objectType ? formatType(t.objectType) : null,
  catalogue: (t) => {
    const cat = catalogueOf(t);
    return cat ? catalogueLabel(cat) : 'Other';
  },
  // Applicable filters: group by the target's recommended band set (the same
  // mock recommendation the Filter-bands filter uses), e.g. "Ha OIII SII".
  filters: (t) => {
    const bands = rowAltitudeFor(t, USABLE_ALT_DEG).filters.bands;
    return bands.length > 0 ? bands.join(' ') : null;
  },
};

function flattenGroups(groups: TargetGroup[]): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const group of groups) {
    rows.push({
      kind: 'group',
      key: `g:${group.label}`,
      label: group.label,
      count: group.rows.length,
    });
    for (const { target, alt } of group.rows) {
      rows.push({ kind: 'target', key: target.id, target, alt });
    }
  }
  return rows;
}

// ── Column model (#85 + spec 044) ──────────────────────────────────────────────
//
// Designation + Type + Sessions are kept. Constellation/Magnitude are replaced
// by planning columns. Spec 044 adds Lunar dist, Filters possible, Imaging time.
//
// Opposition: the next midnight-transit peak date. planner-altitude.ts has no
// date; blocked on backend ephemeris (#58). Renders '—' until that lands.
// Sessions: linked-session count not on TargetListItem yet (#57). Renders '—'.
// All non-text columns are sortable on their mock value.

const COLUMNS: Array<{
  key: string;
  label: string;
  sort?: TargetSortCol;
  className?: string;
  title?: string;
}> = [
  // task #18: star column (no label — icon-only header)
  { key: 'star', label: '★', className: 'alm-targets-cell--center', title: m.targets_col_favourite() },
  { key: 'designation', label: m.targets_col_designation(), sort: 'designation' },
  { key: 'type', label: m.cmp_target_search_type_label(), sort: 'type' },
  { key: 'maxAlt', label: m.targets_col_max_alt(), sort: 'maxAlt', className: 'alm-targets-cell--num', title: m.targets_table_approx_max_alt() },
  { key: 'spark', label: m.targets_col_tonight(), className: 'alm-targets-cell--spark' },
  { key: 'visible', label: m.targets_col_visible(), sort: 'visible', className: 'alm-targets-cell--center', title: m.targets_col_visible_title() },
  { key: 'opposition', label: m.targets_col_opposition(), sort: 'opposition', className: 'alm-targets-cell--opposition', title: m.targets_table_next_opposition() },
  // task #5: abbreviated header "Lunar" fits the widened 80px column without clipping
  { key: 'lunarDist', label: m.targets_col_lunar(), sort: 'lunarDist', className: 'alm-targets-cell--num', title: m.targets_col_lunar_title() },
  { key: 'filters', label: m.common_filters(), className: 'alm-targets-cell--filters', title: m.targets_col_filters_title() },
  // task #5: abbreviated header "Img time" fits the widened 100px column without clipping
  { key: 'imagingTime', label: m.targets_col_img_time(), sort: 'imagingTime', className: 'alm-targets-cell--num', title: m.targets_col_img_time_title() },
  { key: 'sessions', label: m.common_sessions(), sort: 'sessions', className: 'alm-targets-cell--num', title: m.targets_col_sessions_title() },
];

// COL_COUNT is derived from COLUMNS so adding/removing a column stays in sync.
const COL_COUNT = COLUMNS.length;

/** Estimated row height (px) for the virtualizer's first measurement pass. */
const ROW_ESTIMATE = 36;
/** Extra rows rendered above/below the viewport to avoid blank flashes on scroll. */
const OVERSCAN = 12;

interface Props {
  targets: TargetListItem[];
  selected: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  sort: TargetSort;
  onSort: (col: TargetSortCol) => void;
  /**
   * Legacy single-tier group-by (kept for back-compat with tests).
   * When `dims` is provided it takes precedence; `groupBy` is only used as
   * the fallback when `dims` is empty.
   * @deprecated Prefer `dims` from `useGrouping`.
   */
  groupBy?: TargetGroupBy;
  /**
   * Active ordered grouping dimension ids from `useGrouping`.
   * When non-empty, drives multi-level collapsible grouping; overrides `groupBy`.
   * When empty, falls back to `groupBy` (single-tier, legacy).
   */
  dims?: string[];
  /** Message shown when the list is empty (tab-specific). */
  emptyMessage?: string;
  /**
   * User-configured usable-altitude threshold in degrees (default USABLE_ALT_DEG).
   * Drives hoursAboveUsable, visibleTonight, and the Imaging time column.
   * Pass `useAltitudeThreshold()` from the host page.
   */
  usableAltDeg?: number;
  /**
   * Set of currently-favourited target ids (task #18).
   * When provided the star column renders filled for matched ids.
   * STUB: sourced from localStorage via useFavourites until task #54 lands.
   */
  favouriteIds?: ReadonlySet<string>;
  /**
   * Called when the user clicks the star button in a row (task #18).
   * STUB: see useFavourites.ts.
   */
  onToggleFavourite?: (targetId: string) => void;
}

export function TargetsTable({
  targets,
  selected,
  onSelect,
  loading,
  sort,
  onSort,
  groupBy = DEFAULT_TARGET_GROUP_BY,
  dims,
  emptyMessage = m.targets_table_no_match(),
  usableAltDeg = USABLE_ALT_DEG,
  favouriteIds,
  onToggleFavourite,
}: Props) {
  // task #18: subscribe to the local favourites store.  The host page (TargetsPage)
  // passes its own useFavourites result down; if it doesn't (e.g. tests that don't
  // need favourites), we fall back to an internal subscription.  This keeps the
  // table self-contained when used standalone.
  const internalFavourites = useFavourites();
  const resolvedFavouriteIds = favouriteIds ?? internalFavourites.favouriteIds;
  const resolvedToggle = onToggleFavourite ?? internalFavourites.toggle;
  const scrollRef = useRef<HTMLDivElement>(null);
  const { collapsed, toggle: toggleCollapsed } = useCollapsibleGroups();

  // Grouping + sorting + per-row altitude MOCK are all derived here so a filter
  // or sort change does one O(n) pass off the render hot path, not per-row work
  // inside the virtualized render loop. usableAltDeg is included in the dep
  // array so that changing the altitude threshold re-derives all rows.
  //
  // When `dims` is non-empty we use the shared multi-level groupByDimensions
  // engine (with collapsible headers); when empty we fall back to the
  // legacy single-tier groupTargets (using `groupBy`).
  const useMultiGroup = dims != null && dims.length > 0;

  const flatRows = useMemo(() => {
    if (useMultiGroup) {
      // Pre-compute altitude for all items (needed for sort + display).
      const withAlt = targets.map((t) => ({ target: t, alt: rowAltitudeFor(t, usableAltDeg) }));
      // Sort the flat list first.
      const sortedWithAlt = [...withAlt].sort((a, b) =>
        compareTargetRows(a.target, a.alt, b.target, b.alt, sort),
      );
      const sorted = sortedWithAlt.map((r) => r.target);
      const altMap = new Map(sortedWithAlt.map((r) => [r.target.id, r.alt]));

      // Build the group tree using shared engine.
      const tree = groupByDimensions(sorted, dims!, TARGET_ACCESSORS);
      // Flatten with collapse state, then map to our FlatRow shape.
      const visRows = flattenVisibleGroups(tree, collapsed);
      return visRows.map((vrow): FlatRow => {
        if (vrow.kind === 'header') {
          return {
            kind: 'group',
            key: vrow.path,
            label: vrow.node.label,
            count: vrow.node.count,
            path: vrow.path,
            depth: vrow.depth,
            collapsible: true,
            collapsed: vrow.collapsed,
          };
        }
        const t = vrow.item;
        return {
          kind: 'target',
          key: t.id,
          target: t,
          alt: altMap.get(t.id) ?? rowAltitudeFor(t, usableAltDeg),
          depth: vrow.depth,
        };
      });
    }
    // Legacy single-tier grouping path.
    const groups = groupTargets(targets, sort, groupBy, usableAltDeg);
    return flattenGroups(groups);
  }, [targets, sort, groupBy, usableAltDeg, useMultiGroup, dims, collapsed]);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: OVERSCAN,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // Windowing fallback: in a non-layout environment (jsdom under vitest) the
  // scroll element has no measurable height, so the virtualizer yields zero
  // items. Render every row without spacers in that case — tests rely on all
  // rows being present; windowing is purely a runtime perf optimization.
  const useWindowing = virtualItems.length > 0;

  // Indices of the visible slice. In non-windowed mode we render everything.
  const renderIndices: number[] = useWindowing
    ? virtualItems.map((vi) => vi.index)
    : flatRows.map((_, i) => i);

  // Padding-spacer pattern for real CSS <table> (see module header):
  // two sentinel spacer rows bracket the visible slice. Their combined height
  // equals totalSize so the scrollbar reflects the full virtual list length,
  // but the rendered data rows are in normal table flow at their natural height.
  const paddingBefore = useWindowing && virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingAfter =
    useWindowing && virtualItems.length > 0
      ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0)
      : 0;

  const columns = COLUMNS.map((c) => ({
    key: c.key,
    className: c.className,
    title: c.title,
    header: c.sort ? (
      <button
        type="button"
        className={
          'alm-targets-sorth' + (sort.col === c.sort ? ' alm-targets-sorth--active' : '')
        }
        onClick={() => onSort(c.sort as TargetSortCol)}
        aria-label={m.targets_table_sort_by_aria({ col: c.label })}
        title={c.title}
      >
        {c.label}
        {sort.col === c.sort && (
          <span className="alm-targets-sorth__arrow" aria-hidden="true">
            {sort.dir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    ) : (
      c.label
    ),
  }));

  const count = targets.length;

  if (count === 0 && !loading) {
    return <div className="alm-targets-table__empty">{emptyMessage}</div>;
  }

  return (
    <div className="alm-targets-table__wrap">
      <div ref={scrollRef} className="alm-targets-table__scroll">
        <table className="alm-table alm-targets-table">
          {/* Fixed-layout colgroup: column widths are pinned so the table
              does NOT recompute widths per windowed page as pill text varies
              (e.g. "galaxy" vs "open cluster" would shift all columns).
              Designation is auto (fills remaining width); fixed widths on
              the right prevent the per-page column-shift bug.
              task #18: star col added first (28 px, wave2 CSS block). */}
          <colgroup>
            <col className="alm-targets-col--star" />
            <col className="alm-targets-col--designation" />
            <col className="alm-targets-col--type" />
            <col className="alm-targets-col--maxalt" />
            <col className="alm-targets-col--spark" />
            <col className="alm-targets-col--visible" />
            <col className="alm-targets-col--opposition" />
            {/* task #5: lunardist widened to 80px (wave2 CSS block). */}
            <col className="alm-targets-col--lunardist" />
            <col className="alm-targets-col--filters" />
            {/* task #5: imagingtime widened to 100px (wave2 CSS block). */}
            <col className="alm-targets-col--imagingtime" />
            <col className="alm-targets-col--sessions" />
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.className} title={c.title}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="alm-targets-table__body">
            {/* Before-spacer: reserve height for virtual rows above the window.
                Height is dynamic (virtualizer offset), allowed by convention. */}
            {paddingBefore > 0 && (
              <tr aria-hidden="true" className="alm-targets-table__spacer">
                {/* eslint-disable-next-line no-restricted-syntax, jsx-a11y/control-has-associated-label -- dynamic: virtualizer before-spacer height; empty presentational cell inside an aria-hidden spacer row (no label needed) */}
                <td colSpan={COL_COUNT} style={{ height: `${paddingBefore}px` }} />
              </tr>
            )}

            {renderIndices.map((index) => {
              const row = flatRows[index];

              if (row.kind === 'group') {
                const depthIndent = (row.depth ?? 0) * 12;
                if (row.collapsible && row.path != null) {
                  // Multi-level collapsible group header.
                  return (
                    <tr
                      key={row.key}
                      data-index={index}
                      className="alm-targets-table__group"
                    >
                      <td colSpan={COL_COUNT}>
                        <button
                          type="button"
                          className="alm-targets-table__group-cell"
                          data-testid={`targets-group-${row.key}`}
                          aria-expanded={!row.collapsed}
                          onClick={() => toggleCollapsed(row.path!)}
                          // eslint-disable-next-line no-restricted-syntax -- dynamic: depth-based group-header indent
                          style={{ paddingLeft: 8 + depthIndent }}
                        >
                          <span className="alm-targets-list__group-caret" aria-hidden="true">
                            {row.collapsed ? '▸' : '▾'}
                          </span>
                          <span className="alm-targets-list__group-label">{row.label}</span>
                          <span className="alm-targets-table__group-count">
                            {m.targets_table_target_count({ count: row.count })}
                          </span>
                        </button>
                      </td>
                    </tr>
                  );
                }
                // Legacy non-collapsible group header.
                return (
                  <tr
                    key={row.key}
                    data-index={index}
                    className="alm-targets-table__group"
                  >
                    <td colSpan={COL_COUNT}>
                      {row.label}
                      <span className="alm-targets-table__group-count">
                        {m.targets_table_target_count({ count: row.count })}
                      </span>
                    </td>
                  </tr>
                );
              }

              const t = row.target;
              const alt = row.alt;
              const showAltDesig = t.effectiveLabel !== t.primaryDesignation;
              const isSelected = selected === t.id;

              const isFav = resolvedFavouriteIds.has(t.id);

              return (
                <tr
                  key={row.key}
                  data-index={index}
                  className={
                    'alm-targets-table__row' +
                    (isSelected ? ' alm-targets-table__row--selected' : '')
                  }
                  onClick={() => onSelect(t.id)}
                >
                  {/* task #18: favourite star toggle.
                      STUB: stored in localStorage only until task #54 (backend linkage) lands.
                      stopPropagation prevents the row-select click from firing. */}
                  <td className="alm-targets-cell--center">
                    <button
                      type="button"
                      className={
                        'alm-targets-star' +
                        (isFav ? ' alm-targets-star--active' : '')
                      }
                      aria-label={isFav ? m.targets_star_unfavourite_aria({ label: t.effectiveLabel }) : m.targets_star_favourite_aria({ label: t.effectiveLabel })}
                      aria-pressed={isFav}
                      title={isFav ? m.targets_star_remove_title() : m.targets_star_add_title()}
                      onClick={(e) => {
                        e.stopPropagation();
                        resolvedToggle(t.id);
                      }}
                    >
                      {isFav ? '★' : '☆'}
                    </button>
                  </td>
                  <td>
                    <span className="alm-targets-cell__desig">
                      <span className="alm-targets-cell__label">{t.effectiveLabel}</span>
                      {showAltDesig && (
                        <span className="alm-targets-cell__alt">{t.primaryDesignation}</span>
                      )}
                    </span>
                  </td>
                  <td>
                    <Pill variant="ghost">{formatType(t.objectType)}</Pill>
                  </td>
                  {/* STUB (#58): max altitude tonight from the approximate model. */}
                  <td className="alm-targets-cell--num">
                    <span title={m.targets_table_approx_max_alt()}>
                      {Math.round(alt.maxAltDeg)}°
                    </span>
                  </td>
                  {/* STUB (#58): inline altitude sparkline for the night. */}
                  <td className="alm-targets-cell--spark">
                    <AltitudeSparkline alt={alt} label={m.targets_table_alt_sparkline_aria({ label: t.effectiveLabel })} />
                  </td>
                  {/* MOCK (#58): visible-tonight indicator (peaks above usable alt). */}
                  <td className="alm-targets-cell--center">
                    {alt.visibleTonight ? (
                      <span
                        className="alm-targets-vis alm-targets-vis--yes"
                        title={m.targets_table_visible_reaches_title({ deg: Math.round(alt.maxAltDeg), hours: alt.hoursAboveUsable.toFixed(1), threshold: usableAltDeg })}
                      >
                        ●<span className="alm-targets-vis__label">{m.targets_table_visible_tonight()}</span>
                      </span>
                    ) : (
                      <span
                        className="alm-targets-vis alm-targets-vis--no"
                        title={m.targets_table_visible_peaks_title({ deg: Math.round(alt.maxAltDeg), threshold: usableAltDeg })}
                      >
                        ○<span className="alm-targets-vis__label">{m.targets_table_visible_low()}</span>
                      </span>
                    )}
                  </td>
                  {/* MOCK (#58): opposition date — next midnight-transit peak.
                      planner-altitude.ts hash model has no date; blocked on
                      backend ephemeris (#58). Renders '—' until that lands. */}
                  <td className="alm-targets-cell--opposition">
                    <span className="alm-targets-cell--muted" title={m.targets_table_next_opposition()}>—</span>
                  </td>
                  {/* MOCK (spec 044): lunar angular separation. NOT astronomy. */}
                  <td className="alm-targets-cell--num">
                    <span
                      className="alm-targets-cell--lunardist"
                      title={m.targets_table_lunar_dist_title({ deg: Math.round(alt.lunarDistanceDeg) })}
                    >
                      {Math.round(alt.lunarDistanceDeg)}°
                    </span>
                  </td>
                  {/* MOCK (spec 044): filter recommendation from moon phase + separation. */}
                  <td className="alm-targets-cell--filters">
                    <FilterBadges recommendation={alt.filters} />
                  </td>
                  {/* MOCK (spec 044): hours above the usable-altitude threshold. */}
                  <td className="alm-targets-cell--num">
                    <span
                      title={m.targets_table_hours_above_title({ hours: alt.hoursAboveUsable.toFixed(1), threshold: usableAltDeg })}
                    >
                      {alt.hoursAboveUsable > 0 ? m.targets_hours_above({ hours: alt.hoursAboveUsable.toFixed(1) }) : '—'}
                    </span>
                  </td>
                  {/* MOCK (#57): linked-session count not on TargetListItem yet. */}
                  <td className="alm-targets-cell--num">
                    <span className="alm-targets-cell--muted">—</span>
                  </td>
                </tr>
              );
            })}

            {/* After-spacer: reserve height for virtual rows below the window.
                Height is dynamic (virtualizer remainder), allowed by convention. */}
            {paddingAfter > 0 && (
              <tr aria-hidden="true" className="alm-targets-table__spacer">
                {/* eslint-disable-next-line no-restricted-syntax, jsx-a11y/control-has-associated-label -- dynamic: virtualizer after-spacer height; empty presentational cell inside an aria-hidden spacer row (no label needed) */}
                <td colSpan={COL_COUNT} style={{ height: `${paddingAfter}px` }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="alm-targets-table__footer">
        {loading ? m.common_loading() : m.targets_table_target_count({ count })}
      </div>
    </div>
  );
}
