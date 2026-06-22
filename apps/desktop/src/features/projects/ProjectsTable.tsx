/**
 * ProjectsTable — spec 043 shared-layout adoption (tasks #73 / #43).
 *
 * Replaces the old narrow `ProjectsList` sidebar with a DENSE, FULL-WIDTH
 * sortable table — the same surface pattern as the Sessions page (shared
 * `Table` from `@/ui`). One row per project; selecting a row opens the existing
 * ProjectDetail in the right-side detail pane on ProjectsPage.
 *
 * Columns: Name · Tool · Target · State (Pill) · Sources · Updated. These reuse
 * the rich-row fields introduced for the list rows (#43). `Target` is a STUB:
 * ProjectSummaryDto carries no target linkage yet (needs FITS OBJECT →
 * target_id, spec task #54), so it renders an em-dash placeholder — never a
 * fabricated value.
 *
 * Search + the State filter + the sort control live in the persistent page top
 * bar (shared PageTopBar + FilterToolbar), NOT inside this surface. Sorting is
 * driven by the `sort` prop; clicking a sortable header calls `onSort`.
 */

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Table, Pill } from '@/ui';
import type { TableColumn, TableRow } from '@/ui';
import { projectStateLabel, projectStateVariant } from '@/lib/lifecycle';
import { compareDateDesc, formatDateTime } from '@/lib/datetime';
import type { ProjectSummaryDto } from '@/bindings/index';

// ── Sort model ────────────────────────────────────────────────────────────────

export type ProjectSortCol = 'name' | 'tool' | 'state' | 'sources' | 'updated';
export type SortDir = 'asc' | 'desc';

export interface ProjectSort {
  col: ProjectSortCol;
  dir: SortDir;
}

export const DEFAULT_PROJECT_SORT: ProjectSort = { col: 'updated', dir: 'desc' };

function compareStr(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? '').localeCompare(b ?? '');
}

function compareProjects(a: ProjectSummaryDto, b: ProjectSummaryDto, sort: ProjectSort): number {
  let cmp = 0;
  switch (sort.col) {
    case 'name':
      cmp = compareStr(a.name, b.name);
      break;
    case 'tool':
      cmp = compareStr(a.tool, b.tool);
      break;
    case 'state':
      cmp = compareStr(a.lifecycle, b.lifecycle);
      break;
    case 'sources':
      cmp = a.sourceCount - b.sourceCount;
      break;
    case 'updated':
      // compareDateDesc returns most-recent-first; invert so the asc/desc flip
      // below keeps "desc" meaning newest-first.
      cmp = -compareDateDesc(a.updatedAt, b.updatedAt);
      break;
  }
  return sort.dir === 'asc' ? cmp : -cmp;
}

// ── Column model ────────────────────────────────────────────────────────────────

const COLUMNS: Array<{ key: string; label: string; sort?: ProjectSortCol; className?: string }> = [
  { key: 'name', label: 'Name', sort: 'name' },
  { key: 'tool', label: 'Tool', sort: 'tool', className: 'alm-projects-table__cell--muted' },
  { key: 'target', label: 'Target', className: 'alm-projects-table__cell--muted' },
  { key: 'state', label: 'State', sort: 'state' },
  { key: 'sources', label: 'Sources', sort: 'sources', className: 'alm-projects-table__cell--num' },
  { key: 'updated', label: 'Updated', sort: 'updated', className: 'alm-projects-table__cell--mono' },
];

// ── Props ───────────────────────────────────────────────────────────────────

export interface ProjectsTableProps {
  projects: ProjectSummaryDto[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  loading?: boolean;
  sort: ProjectSort;
  onSort: (col: ProjectSortCol) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProjectsTable({
  projects,
  selectedId,
  onSelect,
  loading = false,
  sort,
  onSort,
}: ProjectsTableProps) {
  const sorted = useMemo(
    () => [...projects].sort((a, b) => compareProjects(a, b, sort)),
    [projects, sort],
  );

  // Sortable header buttons (button-in-th) — mirrors the Sessions table.
  const columns: TableColumn[] = COLUMNS.map((c) => ({
    key: c.key,
    className: c.className,
    label: c.sort ? (
      <button
        type="button"
        className={
          'alm-projects-sorth' + (sort.col === c.sort ? ' alm-projects-sorth--active' : '')
        }
        onClick={() => onSort(c.sort as ProjectSortCol)}
        aria-label={`Sort by ${c.label}`}
      >
        {c.label}
        {sort.col === c.sort && (
          <span className="alm-projects-sorth__arrow" aria-hidden="true">
            {sort.dir === 'asc' ? '▲' : '▼'}
          </span>
        )}
      </button>
    ) : (
      c.label
    ),
  }));

  const rows: TableRow[] = sorted.map((project) => ({
    _rowClassName:
      'alm-projects-table__row' +
      (project.id === selectedId ? ' alm-projects-table__row--selected' : ''),
    _onClick: () => onSelect(project.id),
    name: (
      <span className="alm-projects-table__name">
        {project.lifecycle === 'blocked' && (
          <AlertTriangle
            size={13}
            role="img"
            aria-label="Blocked"
            className="alm-projects-table__blocked-icon"
          />
        )}
        {project.name}
        {project.channelDrift && (
          <span className="alm-projects-table__drift-badge" title="Channel drift detected">
            <AlertTriangle size={11} aria-hidden="true" /> channels
          </span>
        )}
      </span>
    ),
    tool: <span className="alm-projects-table__cell--muted">{project.tool}</span>,
    // STUB: target — omitted until FITS OBJECT → target_id linkage lands (#54).
    target: <span className="alm-projects-table__dash">—</span>,
    state: (
      <Pill variant={projectStateVariant(project.lifecycle)}>
        {projectStateLabel(project.lifecycle)}
      </Pill>
    ),
    sources: (
      <span className="alm-projects-table__cell--num">
        {project.sourceCount > 0 ? project.sourceCount : '—'}
      </span>
    ),
    updated: (
      <span className="alm-projects-table__cell--mono">{formatDateTime(project.updatedAt)}</span>
    ),
  }));

  if (loading && projects.length === 0) {
    return <div className="alm-projects-table__empty">Loading projects…</div>;
  }

  if (projects.length === 0) {
    return <div className="alm-projects-table__empty">No projects found.</div>;
  }

  return (
    <div>
      <Table className="alm-projects-table" columns={columns} rows={rows} />
      <div className="alm-projects-table__footer">
        {loading ? 'Loading…' : `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}
      </div>
    </div>
  );
}
