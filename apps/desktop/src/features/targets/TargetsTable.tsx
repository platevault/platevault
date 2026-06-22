/**
 * TargetsTable — spec 043 shared list-page adoption (task #73), refined #82.
 *
 * Replaces the narrow `alm-targets-list` sidebar with a DENSE, FULL-WIDTH
 * sortable table — the same surface pattern as SessionsTable (shared `Table`
 * from `@/ui`). It is the primary content of the Targets page's
 * `ListPageLayout`; TargetDetailV2 lives in the detail pane.
 *
 * Columns: Designation · Type · Constellation · Magnitude · Sessions.
 *
 * STUB (task #57): `TargetListItem` only carries `id`, `effectiveLabel`,
 * `primaryDesignation`, and `objectType`. Constellation, magnitude, and the
 * linked-session count live on the enriched list endpoint that does not exist
 * yet, so those columns are OMITTED rather than fabricated. They are added back
 * here once `target.list` returns the enrichment.
 *
 * Task #82:
 *  - Row DENSITY now follows the GLOBAL density setting (the `density-*` class
 *    on <html>, see data/theme.ts → applyDensity). There is no per-page density
 *    prop any more; cell padding is keyed off `--alm-row-height` in CSS.
 *  - GROUP-BY: rows render under spanning group-header rows, grouped by
 *    Catalogue (default) or Object type, mirroring SessionsTable/MastersTable.
 *
 * Search + the catalogue / group-by controls live in the page top bar
 * (PageTopBar + FilterToolbar); this surface owns no toolbar state. Selecting a
 * row opens TargetDetailV2 in the page detail pane (selection is driven by the
 * host page via `?selected`).
 */

import { useMemo } from 'react';
import type { TargetListItem } from '@/api/commands';
import { Table, Pill } from '@/ui';
import type { TableColumn, TableRow } from '@/ui';
import { catalogueOf, catalogueLabel } from './planner-catalog';

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

  // Order groups by their first row under the active sort, breaking ties by the
  // group label so ordering stays stable and reads naturally.
  groups.sort((ga, gb) => {
    const cmp = compareTargets(ga.targets[0], gb.targets[0], sort);
    return cmp !== 0 ? cmp : compareStr(ga.label, gb.label);
  });
  return groups;
}

// ── Column model ────────────────────────────────────────────────────────────────
//
// Constellation / Magnitude / Sessions are present in the design but absent on
// the list endpoint (task #57). They render an em-dash placeholder so the
// columns read as "pending enrichment" rather than being silently dropped.

const COLUMNS: Array<{
  key: string;
  label: string;
  sort?: TargetSortCol;
  className?: string;
}> = [
  { key: 'designation', label: 'Designation', sort: 'designation' },
  { key: 'type', label: 'Type', sort: 'type' },
  { key: 'constellation', label: 'Constellation', className: 'alm-targets-cell--muted' },
  { key: 'magnitude', label: 'Magnitude', className: 'alm-targets-cell--num' },
  { key: 'sessions', label: 'Sessions', className: 'alm-targets-cell--num' },
];

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
  const groups = useMemo(
    () => groupTargets(targets, sort, groupBy),
    [targets, sort, groupBy],
  );

  // Build sortable header labels as button elements (column header passthrough).
  const columns: TableColumn[] = COLUMNS.map((c) => ({
    key: c.key,
    className: c.className,
    label: c.sort ? (
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

  // Flatten groups into rows: a spanning group-header row, then target rows.
  const rows: TableRow[] = [];
  for (const group of groups) {
    rows.push({
      _rowClassName: 'alm-targets-table__group',
      designation: (
        <span>
          {group.label}
          <span className="alm-targets-table__group-count">
            {group.targets.length} {group.targets.length === 1 ? 'target' : 'targets'}
          </span>
        </span>
      ),
      type: '',
      constellation: '',
      magnitude: '',
      sessions: '',
    });

    for (const t of group.targets) {
      const showAltDesig = t.effectiveLabel !== t.primaryDesignation;
      rows.push({
        _rowClassName:
          'alm-targets-table__row' +
          (selected === t.id ? ' alm-targets-table__row--selected' : ''),
        _onClick: () => onSelect(t.id),
        designation: (
          <span className="alm-targets-cell__desig">
            <span className="alm-targets-cell__label">{t.effectiveLabel}</span>
            {showAltDesig && (
              <span className="alm-targets-cell__alt">{t.primaryDesignation}</span>
            )}
          </span>
        ),
        type: <Pill variant="ghost">{formatType(t.objectType)}</Pill>,
        // STUB (task #57): not on TargetListItem — em-dash placeholder.
        constellation: <span className="alm-targets-cell--muted">—</span>,
        magnitude: <span className="alm-targets-cell--muted">—</span>,
        sessions: <span className="alm-targets-cell--muted">—</span>,
      });
    }
  }

  const count = targets.length;

  if (count === 0 && !loading) {
    return <div className="alm-targets-table__empty">{emptyMessage}</div>;
  }

  return (
    <div>
      <Table className="alm-targets-table" columns={columns} rows={rows} />
      <div className="alm-targets-table__footer">
        {loading ? 'Loading…' : `${count} ${count === 1 ? 'target' : 'targets'}`}
      </div>
    </div>
  );
}
