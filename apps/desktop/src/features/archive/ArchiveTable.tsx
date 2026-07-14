// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ArchiveTable — spec 017 WP-B list on the spec 043 list-page system.
 *
 * Full-width dense sortable table (shared `Table` + `SortHeader`, the same
 * surface pattern as Sessions/Calibration/Projects), replacing the #401
 * two-pane `ListSidebar` + `ListItem` archive list. Flat only — the archive
 * has no grouping dimensions. Columns: Name · Type · Reason · Size ·
 * Archived. The active sort column's `<th>` announces `aria-sort` via the
 * shared Table + `ariaSortFor`.
 *
 * Controlled + presentational: entries (already search-filtered), selection,
 * and sort state are owned by ArchivePage.
 */

import { useMemo } from 'react';
import type { ArchiveEntry } from '@/bindings/index';
import { Pill, Table } from '@/ui';
import type { TableColumn, TableRow } from '@/ui';
import { SortHeader, ariaSortFor } from '@/components';
import { formatBytes } from '@/lib/format';
import { m } from '@/lib/i18n';

// ── Sort model ────────────────────────────────────────────────────────────────

export type ArchiveSortCol = 'name' | 'type' | 'reason' | 'size' | 'archived';
export type SortDir = 'asc' | 'desc';

export interface ArchiveSort {
  col: ArchiveSortCol;
  dir: SortDir;
}

export const DEFAULT_ARCHIVE_SORT: ArchiveSort = {
  col: 'archived',
  dir: 'desc',
};

function compareEntries(
  a: ArchiveEntry,
  b: ArchiveEntry,
  sort: ArchiveSort,
): number {
  let cmp = 0;
  switch (sort.col) {
    case 'name':
      cmp = a.name.localeCompare(b.name);
      break;
    case 'type':
      cmp = a.entityType.localeCompare(b.entityType);
      break;
    case 'reason':
      cmp = a.reason.localeCompare(b.reason);
      break;
    case 'size':
      cmp = a.sizeBytes - b.sizeBytes;
      break;
    case 'archived':
      cmp = a.archivedAt.localeCompare(b.archivedAt);
      break;
  }
  return sort.dir === 'asc' ? cmp : -cmp;
}

// ── Column model ──────────────────────────────────────────────────────────────

// `label` is a render-time thunk so headers re-read the active locale (spec 046 #8).
const COLUMNS: Array<{
  key: string;
  label: () => string;
  sort: ArchiveSortCol;
  className?: string;
}> = [
  { key: 'name', label: () => m.archive_col_name(), sort: 'name' },
  { key: 'type', label: () => m.archive_col_type(), sort: 'type' },
  {
    key: 'reason',
    label: () => m.archive_prop_reason(),
    sort: 'reason',
    className: 'alm-cell--muted',
  },
  {
    key: 'size',
    label: () => m.archive_prop_size(),
    sort: 'size',
    className: 'alm-cell--num',
  },
  {
    key: 'archived',
    label: () => m.archive_prop_archived_at(),
    sort: 'archived',
    className: 'alm-cell--mono',
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  entries: ArchiveEntry[];
  selected: string | null;
  onSelect: (id: string) => void;
  sort: ArchiveSort;
  onSort: (col: ArchiveSortCol) => void;
}

export function ArchiveTable({
  entries,
  selected,
  onSelect,
  sort,
  onSort,
}: Props) {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => compareEntries(a, b, sort)),
    [entries, sort],
  );

  const columns: TableColumn[] = COLUMNS.map((c) => ({
    key: c.key,
    className: c.className,
    ariaSort: ariaSortFor(sort.col === c.sort, sort.dir),
    label: (
      <SortHeader
        label={c.label()}
        active={sort.col === c.sort}
        dir={sort.dir}
        onClick={() => onSort(c.sort)}
        ariaLabel={m.archive_sort_by_aria({ col: c.label() })}
      />
    ),
  }));

  const rows: TableRow[] = sorted.map((a) => ({
    _testid: `archive-row-${a.id}`,
    _rowClassName:
      'alm-densetable__row' +
      (selected === a.id ? ' alm-densetable__row--selected' : ''),
    _onClick: () => onSelect(a.id),
    _selected: selected === a.id,
    name: a.name,
    type: <Pill variant="ghost">{a.entityType}</Pill>,
    reason: a.reason,
    size: formatBytes(a.sizeBytes),
    archived: a.archivedAt,
  }));

  return (
    <div className="alm-listtable" data-testid="archive-list">
      <Table className="alm-densetable" columns={columns} rows={rows} />
    </div>
  );
}
