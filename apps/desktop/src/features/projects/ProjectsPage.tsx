/**
 * ProjectsPage — spec 008 wired; spec 043 shared-layout adoption (tasks #73/#74/#104).
 *
 * Adopts the shared list-page system (the Sessions reference): a pinned
 * `PageTopBar` over a `ListPageLayout` body — a DENSE FULL-WIDTH projects
 * `ProjectsTable` as primary content with the existing `ProjectDetail` in the
 * right-side detail pane that mounts only on selection.
 *
 * Top-bar convention (user feedback): NO title/summary (the left nav names the
 * page; per-page counts live in the bottom status bar) and NO sort control
 * (sorting is via the clickable table column headers). The bar carries only the
 * `FilterToolbar` (search over name/tool + a single State filter) and the
 * page-level "+ New project" CTA.
 *
 * Top-bar actions: a page-level "+ New project" CTA. Per-project actions
 * (Reveal in Explorer · Open in {tool} · lifecycle transitions incl. Mark as
 * Completed) live in the detail pane's action bar, which only mounts when a
 * project is selected — so they are, by construction, shown only on selection
 * and carry the canonical `transition-btn-*` / `lifecycle-actions` testids.
 *
 * Dual-panel layout (task #104): the Projects page uses `detailPlacement=
 * "side-and-bottom"`. The SIDE panel (ProjectDetailContent) shows the primary
 * project identity — header, actions, metrics, stepper, target, Sources table,
 * and Channels palette. The BOTTOM panel (ProjectBottomDetail) shows the
 * secondary/operational sections that benefit from full-width horizontal room:
 * Notes, Manifests, Calibration, Source views, Outputs, and Cleanup preview.
 * Both panels mount when a project is selected and close together.
 *
 * URL state (unchanged router contract):
 *   - `selected`: numeric index into the (unfiltered) list.
 *   - `lifecycle`: CSV state filter.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { PageTopBar, FilterToolbar, ListPageLayout } from '@/components';
import type { FilterOption } from '@/components';
import { Btn } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { projectStateLabel } from '@/lib/lifecycle';
import {
  ProjectsTable,
  DEFAULT_PROJECT_SORT,
  type ProjectSort,
  type ProjectSortCol,
} from './ProjectsTable';
import { ProjectDetailContent } from './ProjectDetail';
import { ProjectBottomDetail } from './ProjectBottomDetail';
import { useProjects } from './store';
import type { ProjectSummaryDto } from '@/bindings/index';

// All selectable lifecycle states for the top-bar State filter.
const LIFECYCLE_OPTIONS: FilterOption[] = [
  'processing',
  'ready',
  'prepared',
  'completed',
  'archived',
  'blocked',
  'setup_incomplete',
].map((value) => ({ value, label: projectStateLabel(value) }));

/** Client-side text search over name + tool. */
function filterBySearch(projects: ProjectSummaryDto[], query: string): ProjectSummaryDto[] {
  const q = query.trim().toLowerCase();
  if (!q) return projects;
  return projects.filter(
    (p) => p.name.toLowerCase().includes(q) || p.tool.toLowerCase().includes(q),
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const { selected, lifecycle } = useSearch({ from: '/shell/projects' });
  const navigate = useNavigate({ from: '/projects' });

  const { data: projects = [], loading } = useProjects();

  // (task #87) The per-page status-bar summary was removed: the status bar now
  // shows GLOBAL library totals via useStatusSummary, not per-route counts.

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProjectSort>(DEFAULT_PROJECT_SORT);

  // Stale-id cleanup: if selected index is out of range, clear it.
  const selectedIdx = selected ?? 0;
  const inRange = projects.length > 0 && selected != null && selectedIdx < projects.length;
  useStaleSelectionCleanup(selected, inRange, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const project: ProjectSummaryDto | undefined = inRange ? projects[selectedIdx] : undefined;

  const onSelect = (id: string) => {
    const idx = projects.findIndex((p) => p.id === id);
    if (idx >= 0) void navigate({ search: (prev) => ({ ...prev, selected: idx }) });
  };

  const clearSelection = useCallback(
    () => navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
    [navigate],
  );

  type ProjectLifecycleFilter = NonNullable<typeof lifecycle>;
  // The top-bar State filter is single-select; map it onto the CSV `lifecycle`
  // URL param (an empty value clears it).
  const lifecycleValue = lifecycle?.length === 1 ? lifecycle[0] : '';
  const onLifecycleChange = (value: string) =>
    navigate({
      search: (prev) => ({
        ...prev,
        lifecycle: value ? ([value] as ProjectLifecycleFilter) : undefined,
      }),
    });

  const handleNewProject = useCallback(() => {
    void navigate({ to: '/projects/new' });
  }, [navigate]);

  const handleHeaderSort = useCallback((col: ProjectSortCol) => {
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' },
    );
  }, []);

  // Apply the lifecycle filter (URL) then the client-side search.
  const filtered = useMemo(() => {
    const byState = lifecycle?.length
      ? projects.filter((p) => (lifecycle as string[]).includes(p.lifecycle))
      : projects;
    return filterBySearch(byState, search);
  }, [projects, lifecycle, search]);

  // Per the top-bar convention (user feedback): OMIT title + summary (the left
  // nav names the page; per-page counts live in the bottom status bar), and do
  // NOT surface a sort control here — sorting is driven by the clickable
  // ProjectsTable column headers. The bar carries only search + the State
  // filter + the page-level "+ New project" CTA. Per-project actions live in
  // the detail panel header, which mounts only on selection.
  const topBar = (
    <PageTopBar
      filters={
        <FilterToolbar
          search={{
            value: search,
            onChange: setSearch,
            placeholder: 'Search name, tool…',
            ariaLabel: 'Search projects',
          }}
          fields={[
            {
              key: 'state',
              label: 'State',
              value: lifecycleValue,
              options: LIFECYCLE_OPTIONS,
              allLabel: 'All states',
              onChange: onLifecycleChange,
            },
          ]}
        />
      }
      actions={
        <Btn
          size="sm"
          variant="primary"
          onClick={handleNewProject}
          data-guide-anchor="projects.create-cta"
        >
          + New project
        </Btn>
      }
    />
  );

  return (
    <ListPageLayout
      topBar={topBar}
      // Standardised bottom-docked detail (Sessions/Calibration convention): the
      // project identity (ProjectDetailContent) stacks above the operational
      // sections (ProjectBottomDetail) in ONE full-width bottom panel — no right
      // side panel. Keeps the projects table full-width and column layout stable.
      detail={
        project ? (
          <div className="alm-project-detail-stack">
            <ProjectDetailContent projectId={project.id} />
            <ProjectBottomDetail projectId={project.id} />
          </div>
        ) : undefined
      }
      onCloseDetail={project ? clearSelection : undefined}
      detailLabel="Project details"
    >
      <ProjectsTable
        projects={filtered}
        selectedId={project?.id}
        onSelect={onSelect}
        loading={loading}
        sort={sort}
        onSort={handleHeaderSort}
      />
    </ListPageLayout>
  );
}
