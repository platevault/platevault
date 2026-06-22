/**
 * TargetsTable — spec 043 shared list-page adoption (task #73).
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
 * Search + density live in the page top bar (PageTopBar + FilterToolbar); this
 * surface owns no toolbar state. Selecting a row opens TargetDetailV2 in the
 * page detail pane (selection is driven by the host page via `?selected`).
 */

import { useMemo } from 'react';
import type { TargetListItem } from '@/api/commands';
import { Table, Pill } from '@/ui';
import type { TableColumn, TableRow } from '@/ui';

// ── Sort model ────────────────────────────────────────────────────────────────

/** Columns the table can sort by. Only fields present on TargetListItem. */
export type TargetSortCol = 'designation' | 'type';
export type SortDir = 'asc' | 'desc';

export interface TargetSort {
  col: TargetSortCol;
  dir: SortDir;
}

export const DEFAULT_TARGET_SORT: TargetSort = { col: 'designation', dir: 'asc' };

/** Row density (mirrors the legacy TargetList density toggle). */
export type TargetDensity = 'Dense' | 'Rich';
export const DEFAULT_TARGET_DENSITY: TargetDensity = 'Dense';

/** Formats the objectType string into a readable label. */
export function formatType(objectType: string): string {
  return objectType.replace(/_/g, ' ');
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
  density?: TargetDensity;
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
  density = DEFAULT_TARGET_DENSITY,
  emptyMessage = 'No targets match the current filters.',
}: Props) {
  const sorted = useMemo(
    () => [...targets].sort((a, b) => compareTargets(a, b, sort)),
    [targets, sort],
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

  const rows: TableRow[] = sorted.map((t) => {
    const showAltDesig = t.effectiveLabel !== t.primaryDesignation;
    return {
      _rowClassName:
        'alm-targets-table__row' +
        (density === 'Rich' ? ' alm-targets-table__row--rich' : '') +
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
    };
  });

  if (sorted.length === 0 && !loading) {
    return <div className="alm-targets-table__empty">{emptyMessage}</div>;
  }

  return (
    <div>
      <Table className="alm-targets-table" columns={columns} rows={rows} />
      <div className="alm-targets-table__footer">
        {loading
          ? 'Loading…'
          : `${sorted.length} ${sorted.length === 1 ? 'target' : 'targets'}`}
      </div>
    </div>
  );
}
