/**
 * ProjectsList -- list sidebar for Projects page.
 * Spec 008: works with ProjectSummaryDto (real DB shape) instead of fixtures.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  createColumnHelper,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import { AlertTriangle } from 'lucide-react';
import { ListSidebar, ListItem } from '@/components';
import { Pill } from '@/ui';
import type { PillVariant } from '@/ui';
import type { ProjectSummaryDto } from '@/bindings/index';
import { compareDateDesc, formatDateTime } from '@/lib/datetime';

// ─── Helpers ────────────────────────────────────────────────────────────────

function projectVariant(lifecycle: string): PillVariant {
  switch (lifecycle) {
    case 'completed':
    case 'archived':
      return 'ok';
    case 'processing':
      return 'info';
    case 'prepared':
      return 'accent';
    case 'ready':
      return 'neutral';
    case 'blocked':
      return 'danger';
    case 'setup_incomplete':
      return 'ghost';
    default:
      return 'neutral';
  }
}

function stateLabel(lifecycle: string): string {
  switch (lifecycle) {
    case 'setup_incomplete': return 'Setup';
    case 'ready':            return 'Ready';
    case 'prepared':         return 'Prepared';
    case 'processing':       return 'Processing';
    case 'completed':        return 'Completed';
    case 'archived':         return 'Archived';
    case 'blocked':          return 'Blocked';
    default:                 return lifecycle;
  }
}

// ─── Rich list-row meta (spec 043 §4 / task #43) ──────────────────────────────
// The Projects mock asks each LIST row to read
//   tool · target · integration · size · cleanup · updated
// alongside the state pill. Only the fields present on ProjectSummaryDto are
// rendered; the rest are backend-gated and omitted cleanly (see STUBs below).
//
// Present on the list DTO:  tool, sourceCount, updatedAt, channelDrift.
// STUB (NOT on ProjectSummaryDto — backend-gated, omitted, no fabricated values):
//   - target       — needs FITS OBJECT → target_id linkage (spec task #54).
//   - integration  — needs per-channel integration aggregation (spec task #56).
//   - size         — needs on-disk source size aggregation (no list field).
//   - cleanup      — needs cleanup-candidate summary (no list field).

function ProjectRowMeta({ project }: { project: ProjectSummaryDto }) {
  // Build the ordered set of meta segments from fields that actually exist on
  // the list DTO. Each entry is keyed so the `·`-separated render is stable.
  const segments: Array<{ key: string; node: ReactNode }> = [];

  // tool — always present on the summary DTO; reads as the row's secondary id.
  segments.push({
    key: 'tool',
    node: <span className="alm-projects-list__meta-tool">{project.tool}</span>,
  });

  // STUB: target — omitted until FITS OBJECT → target_id linkage lands (#54).
  // STUB: integration — omitted until per-channel integration aggregation (#56).
  // STUB: size — omitted; no source-size field on the list DTO.
  // STUB: cleanup — omitted; no cleanup-summary field on the list DTO.

  // sources — present; only meaningful when there is at least one.
  if (project.sourceCount > 0) {
    segments.push({ key: 'sources', node: <>{project.sourceCount} sources</> });
  }

  // updated — present; the backend default sort key, surfaced on every row.
  segments.push({ key: 'updated', node: <>{formatDateTime(project.updatedAt)}</> });

  return (
    <span className="alm-projects-list__meta">
      {segments.map((seg, i) => (
        <span key={seg.key} className="alm-projects-list__meta-field">
          {i > 0 && (
            <span className="alm-list-item__meta-sep" aria-hidden="true">
              ·
            </span>
          )}
          {seg.node}
        </span>
      ))}
      {project.channelDrift && (
        <span className="alm-projects-list__drift-badge" title="Channel drift detected">
          <AlertTriangle size={12} aria-hidden="true" /> channels
        </span>
      )}
    </span>
  );
}

type SortBy = 'updated' | 'name' | 'created' | 'sources';

// ─── react-table column model (T182) ─────────────────────────────────────────
// Headless @tanstack/react-table owns sorting + the lifecycle filter; the rows
// it yields are still rendered as ListItem cards (no <table> markup change).

const columnHelper = createColumnHelper<ProjectSummaryDto>();

const PROJECT_COLUMNS = [
  columnHelper.accessor('name', {
    id: 'name',
    sortingFn: (a, b) => a.original.name.localeCompare(b.original.name),
  }),
  // `created` sorts most-recent-first (descending), matching the prior
  // `new Date(b) - new Date(a)` comparator via the shared datetime helper.
  columnHelper.accessor('createdAt', {
    id: 'created',
    sortingFn: (a, b) => compareDateDesc(a.original.createdAt, b.original.createdAt),
  }),
  columnHelper.accessor('sourceCount', {
    id: 'sources',
    // Descending by source count (prior: b.sourceCount - a.sourceCount).
    sortingFn: (a, b) => b.original.sourceCount - a.original.sourceCount,
  }),
  // Lifecycle is not a visible sort key — it backs the multiselect filter.
  // An empty filter array means "all"; otherwise keep rows whose lifecycle is
  // in the selected set (prior: `lifecycle.includes(p.lifecycle)`).
  columnHelper.accessor('lifecycle', {
    id: 'lifecycle',
    filterFn: (row, _id, value: string[]) =>
      value.length === 0 || value.includes(row.original.lifecycle),
  }),
];

// Map the sort-select value to a react-table SortingState. 'updated' keeps the
// backend's updated_at-desc order, so no client sorting is applied.
function sortingFor(sortBy: SortBy): SortingState {
  switch (sortBy) {
    case 'name':
      return [{ id: 'name', desc: false }];
    case 'created':
      // The comparator already encodes desc order; `desc:false` preserves it.
      return [{ id: 'created', desc: false }];
    case 'sources':
      return [{ id: 'sources', desc: false }];
    default:
      return [];
  }
}

// All selectable lifecycle states (excludes the synthetic 'all' sentinel — empty array means all).
const LIFECYCLE_STATES: Array<{ value: string; label: string }> = [
  { value: 'processing', label: 'Processing' },
  { value: 'ready', label: 'Ready' },
  { value: 'prepared', label: 'Prepared' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'setup_incomplete', label: 'Setup incomplete' },
];

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ProjectsListProps {
  projects: ProjectSummaryDto[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  lifecycle: string[];
  onLifecycleChange: (states: string[]) => void;
  loading?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ProjectsList({
  projects,
  selectedId,
  onSelect,
  lifecycle,
  onLifecycleChange,
  loading = false,
}: ProjectsListProps) {
  const [sortBy, setSortBy] = useState<SortBy>('updated');

  const sorting = useMemo(() => sortingFor(sortBy), [sortBy]);
  const columnFilters = useMemo<ColumnFiltersState>(
    () => [{ id: 'lifecycle', value: lifecycle }],
    [lifecycle],
  );

  const table = useReactTable({
    data: projects,
    columns: PROJECT_COLUMNS,
    state: { sorting, columnFilters },
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const filtered = useMemo(
    () => table.getRowModel().rows.map((r) => r.original),
    [table, sorting, columnFilters, projects],
  );

  const handleLifecycleToggle = (value: string, checked: boolean) => {
    if (checked) {
      onLifecycleChange([...lifecycle, value]);
    } else {
      onLifecycleChange(lifecycle.filter((v) => v !== value));
    }
  };

  if (loading && projects.length === 0) {
    return (
      <ListSidebar placeholder="Search projects…">
        <div className="alm-projects-list__loading">
          Loading projects…
        </div>
      </ListSidebar>
    );
  }

  return (
    <ListSidebar
      placeholder="Search projects…"
      controls={
        <div className="alm-projects-list__controls">
          <select
            className="alm-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            aria-label="Sort by"
          >
            <option value="updated">Sort: updated</option>
            <option value="created">Sort: created</option>
            <option value="name">Sort: name</option>
            <option value="sources">Sort: sources</option>
          </select>
          {/* FR-022 / T055: multiselect lifecycle filter.
              base-ui Menu provides click-outside dismiss + Escape-to-close +
              focus management (replaces the prior hand-rolled dropdown, which
              had neither). `closeOnClick={false}` keeps the menu open while the
              user toggles multiple states. */}
          <Menu.Root>
            <Menu.Trigger
              className="alm-select alm-projects-list__filter-trigger"
              aria-label="Filter lifecycle"
            >
              {lifecycle.length === 0
                ? 'State: all'
                : lifecycle.length === 1
                  ? `State: ${LIFECYCLE_STATES.find((s) => s.value === lifecycle[0])?.label ?? lifecycle[0]}`
                  : `State: ${lifecycle.length} selected`}
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner className="alm-menu__positioner" sideOffset={4} align="start">
                <Menu.Popup className="alm-menu__popup" aria-label="Lifecycle states">
                  <Menu.CheckboxItem
                    className="alm-menu__item"
                    closeOnClick={false}
                    checked={lifecycle.length === 0}
                    onCheckedChange={(checked) => {
                      if (checked) onLifecycleChange([]);
                    }}
                    aria-label="All states"
                  >
                    <Menu.CheckboxItemIndicator className="alm-menu__indicator">
                      &#x2713;
                    </Menu.CheckboxItemIndicator>
                    <span className="alm-menu__label">All</span>
                  </Menu.CheckboxItem>
                  {LIFECYCLE_STATES.map((opt) => (
                    <Menu.CheckboxItem
                      key={opt.value}
                      className="alm-menu__item"
                      closeOnClick={false}
                      checked={lifecycle.includes(opt.value)}
                      onCheckedChange={(checked) => handleLifecycleToggle(opt.value, checked)}
                      aria-label={opt.label}
                    >
                      <Menu.CheckboxItemIndicator className="alm-menu__indicator">
                        &#x2713;
                      </Menu.CheckboxItemIndicator>
                      <span className="alm-menu__label">{opt.label}</span>
                    </Menu.CheckboxItem>
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      }
      footer={
        <div className="alm-projects-list__footer">
          <span className="alm-list-sidebar__count">{filtered.length} projects</span>
        </div>
      }
    >
      {filtered.length === 0 && (
        <div className="alm-projects-list__empty">
          No projects found.
        </div>
      )}
      {filtered.map((project) => (
        <ListItem
          key={project.id}
          selected={project.id === selectedId}
          onClick={() => onSelect(project.id)}
          title={
            <>
              {project.lifecycle === 'blocked' && (
                <AlertTriangle
                  size={14}
                  role="img"
                  aria-label="Blocked"
                  className="alm-projects-list__blocked-icon"
                />
              )}
              {project.name}
            </>
          }
          pills={
            <Pill variant={projectVariant(project.lifecycle)}>
              {stateLabel(project.lifecycle)}
            </Pill>
          }
          meta={<ProjectRowMeta project={project} />}
        />
      ))}
    </ListSidebar>
  );
}
