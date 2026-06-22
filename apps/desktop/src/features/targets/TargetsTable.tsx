/**
 * TargetsTable — spec 043 shared list-page adoption (task #73), refined #82,
 * VIRTUALIZED + planning columns (#84/#85).
 *
 * A DENSE, FULL-WIDTH sortable table (shared `Table` look) that is the primary
 * content of the Targets page's `ListPageLayout`; TargetDetailV2 lives in the
 * detail pane.
 *
 * Columns: Designation · Type · Max altitude · (sparkline) · Visible tonight ·
 * Sessions.
 *
 * Task #84 — VIRTUALIZATION:
 *   The Planner catalogue can be large; rendering every row synchronously blocks
 *   the main thread on filter/sort. Rows (group-header rows AND target rows) are
 *   flattened into one list and windowed with `@tanstack/react-virtual`
 *   (mirroring the old TargetList.tsx). Only the visible slice mounts; the rest
 *   is reserved with spacer rows so the native `<table>` (and `<tr>` semantics
 *   the page/tests rely on) is preserved. In a non-layout environment (jsdom)
 *   the scroll element measures 0px, so we fall back to rendering ALL rows — the
 *   windowing is a runtime perf optimization, not a behavior change.
 *
 * Task #85 — PLANNING COLUMNS:
 *   The low-value Constellation/Magnitude columns are replaced with
 *   planning-relevant ones driven by the STUB altitude model (planner-altitude.ts):
 *   max altitude tonight, a tiny inline opposition/altitude SPARKLINE per row, and
 *   a visible-tonight indicator. // STUB — real values arrive with ephemeris +
 *   observer location (#58); the list endpoint has no coordinates (#57), so these
 *   are derived deterministically from the designation, not from the sky.
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

// ── Sort model ────────────────────────────────────────────────────────────────

/** Columns the table can sort by. Only fields present on TargetListItem. */
export type TargetSortCol = 'designation' | 'type';
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

function compareTargets(a: TargetListItem, b: TargetListItem, sort: TargetSort): number {
  let cmp = 0;
  switch (sort.col) {
    case 'designation':
      cmp = compareStr(a.effectiveLabel, b.effectiveLabel);
      break;
    case 'type':
      cmp = compareStr(a.objectType, b.objectType);
      break;
  }
  return sort.dir === 'asc' ? cmp : -cmp;
}

interface TargetGroup {
  label: string;
  targets: TargetListItem[];
}

/**
 * Group targets by the selected key, sort targets within each group, then order
 * the groups by their first (sorted) row — mirroring SessionsTable.
 */
function groupTargets(
  targets: TargetListItem[],
  sort: TargetSort,
  groupBy: TargetGroupBy,
): TargetGroup[] {
  const byKey = new Map<string, TargetListItem[]>();
  for (const t of targets) {
    const key = groupHeadlineOf(t, groupBy);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(t);
    else byKey.set(key, [t]);
  }

  const groups: TargetGroup[] = [];
  for (const [label, list] of byKey) {
    groups.push({ label, targets: [...list].sort((a, b) => compareTargets(a, b, sort)) });
  }

  groups.sort((ga, gb) => {
    const cmp = compareTargets(ga.targets[0], gb.targets[0], sort);
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
  | { kind: 'group'; key: string; label: string; count: number }
  | { kind: 'target'; key: string; target: TargetListItem; alt: RowAltitude };

function flattenGroups(groups: TargetGroup[]): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const group of groups) {
    rows.push({
      kind: 'group',
      key: `g:${group.label}`,
      label: group.label,
      count: group.targets.length,
    });
    for (const t of group.targets) {
      rows.push({ kind: 'target', key: t.id, target: t, alt: rowAltitudeFor(t) });
    }
  }
  return rows;
}

// ── Column model (#85) ──────────────────────────────────────────────────────────
//
// Designation + Type + Sessions are kept. Constellation/Magnitude are replaced
// by the planning columns: Max altitude, an altitude sparkline (no header text),
// and a Visible-tonight indicator. Sessions remains a backend-absent STUB (#57).

const COLUMNS: Array<{
  key: string;
  label: string;
  sort?: TargetSortCol;
  className?: string;
}> = [
  { key: 'designation', label: 'Designation', sort: 'designation' },
  { key: 'type', label: 'Type', sort: 'type' },
  { key: 'maxAlt', label: 'Max alt', className: 'alm-targets-cell--num' },
  { key: 'spark', label: 'Tonight', className: 'alm-targets-cell--spark' },
  { key: 'visible', label: 'Visible', className: 'alm-targets-cell--center' },
  { key: 'sessions', label: 'Sessions', className: 'alm-targets-cell--num' },
];

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
  /** Group rows under spanning header rows by this key. Default 'catalogue'. */
  groupBy?: TargetGroupBy;
  /** Message shown when the list is empty (tab-specific). */
  emptyMessage?: string;
}

export function TargetsTable({
  targets,
  selected,
  onSelect,
  loading,
  sort,
  onSort,
  groupBy = DEFAULT_TARGET_GROUP_BY,
  emptyMessage = 'No targets match the current filters.',
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Grouping + sorting + per-row altitude STUB are all derived here so a filter
  // or sort change does one O(n) pass off the render hot path, not per-row work
  // inside the virtualized render loop.
  const flatRows = useMemo(() => {
    const groups = groupTargets(targets, sort, groupBy);
    return flattenGroups(groups);
  }, [targets, sort, groupBy]);

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
  // items. Render every row in that case — the page/tests rely on all rows being
  // present, and windowing is purely a runtime perf optimization.
  const useWindowing = virtualItems.length > 0;
  const renderRows: Array<{ index: number; start: number }> = useWindowing
    ? virtualItems.map((vi) => ({ index: vi.index, start: vi.start }))
    : flatRows.map((_, index) => ({ index, start: 0 }));

  // Top spacer reserves the height of the rows scrolled above the window so the
  // scrollbar + absolute row offsets line up. Bottom is handled by the inner
  // container height (totalSize) when windowing.
  const paddingTop = useWindowing && virtualItems.length > 0 ? virtualItems[0].start : 0;

  const columns = COLUMNS.map((c) => ({
    key: c.key,
    className: c.className,
    header: c.sort ? (
      <button
        type="button"
        className={
          'alm-targets-sorth' + (sort.col === c.sort ? ' alm-targets-sorth--active' : '')
        }
        onClick={() => onSort(c.sort as TargetSortCol)}
        aria-label={`Sort by ${c.label}`}
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
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.className}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            className="alm-targets-table__body"
            // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer total scroll height (getTotalSize) so the scrollbar reflects all rows
            style={useWindowing ? { height: `${totalSize}px` } : undefined}
          >
            {/* Top spacer: reserve the height of rows above the window so the
                first rendered row sits at the correct scroll offset. */}
            {useWindowing && paddingTop > 0 && (
              <tr aria-hidden="true" className="alm-targets-table__spacer">
                {/* eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer top spacer height (offset of first windowed row) */}
                <td colSpan={COL_COUNT} style={{ height: `${paddingTop}px` }} />
              </tr>
            )}

            {renderRows.map(({ index }) => {
              const row = flatRows[index];

              if (row.kind === 'group') {
                return (
                  <tr
                    key={row.key}
                    data-index={index}
                    ref={useWindowing ? virtualizer.measureElement : undefined}
                    className="alm-targets-table__group"
                  >
                    <td colSpan={COL_COUNT}>
                      {row.label}
                      <span className="alm-targets-table__group-count">
                        {row.count} {row.count === 1 ? 'target' : 'targets'}
                      </span>
                    </td>
                  </tr>
                );
              }

              const t = row.target;
              const alt = row.alt;
              const showAltDesig = t.effectiveLabel !== t.primaryDesignation;
              const isSelected = selected === t.id;

              return (
                <tr
                  key={row.key}
                  data-index={index}
                  ref={useWindowing ? virtualizer.measureElement : undefined}
                  className={
                    'alm-targets-table__row' +
                    (isSelected ? ' alm-targets-table__row--selected' : '')
                  }
                  onClick={() => onSelect(t.id)}
                >
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
                    <span title="Approximate max altitude tonight (STUB — pending ephemeris)">
                      {Math.round(alt.maxAltDeg)}°
                    </span>
                  </td>
                  {/* STUB (#58): inline altitude sparkline for the night. */}
                  <td className="alm-targets-cell--spark">
                    <AltitudeSparkline alt={alt} label={`Altitude tonight for ${t.effectiveLabel}`} />
                  </td>
                  {/* STUB (#58): visible-tonight indicator (peaks above usable alt). */}
                  <td className="alm-targets-cell--center">
                    {alt.visibleTonight ? (
                      <span
                        className="alm-targets-vis alm-targets-vis--yes"
                        title={`Reaches ${Math.round(alt.maxAltDeg)}° · ~${alt.hoursAboveUsable.toFixed(1)} h above ${USABLE_ALT_DEG}° (STUB)`}
                      >
                        ●<span className="alm-targets-vis__label">tonight</span>
                      </span>
                    ) : (
                      <span
                        className="alm-targets-vis alm-targets-vis--no"
                        title={`Peaks at ${Math.round(alt.maxAltDeg)}° — below usable altitude tonight (STUB)`}
                      >
                        ○<span className="alm-targets-vis__label">low</span>
                      </span>
                    )}
                  </td>
                  {/* STUB (#57): linked-session count not on TargetListItem yet. */}
                  <td className="alm-targets-cell--num">
                    <span className="alm-targets-cell--muted">—</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="alm-targets-table__footer">
        {loading ? 'Loading…' : `${count} ${count === 1 ? 'target' : 'targets'}`}
      </div>
    </div>
  );
}
