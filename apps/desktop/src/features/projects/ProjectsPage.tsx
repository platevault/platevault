/**
 * ProjectsPage — spec 008 wired.
 *
 * List+detail layout for projects. Reads from `projects.list` / `projects.get`
 * (real commands) instead of PROJECTS_DATA fixture.
 *
 * URL state:
 *   - `selected`: numeric index into the list (preserves existing router contract).
 *   - `lifecycle`: CSV state filter.
 *
 * "New project" button opens CreateProjectDialog (US1). On success, the list
 * is invalidated and the new project is navigated to.
 */

import { useCallback } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { ProjectsList } from './ProjectsList';
import { ProjectDetailContent } from './ProjectDetail';
import { useProjects } from './store';
import type { ProjectSummaryDto } from '@/bindings/index';

// ── Component ────────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const { selected, lifecycle } = useSearch({ from: '/shell/projects' });
  const navigate = useNavigate({ from: '/projects' });

  const { data: projects = [], loading } = useProjects();

  // Stale-id cleanup: if selected index is out of range, clear it.
  const selectedIdx = selected ?? 0;
  const inRange = projects.length > 0 && selectedIdx < projects.length;
  useStaleSelectionCleanup(selected, inRange, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const project: ProjectSummaryDto | undefined = inRange ? projects[selectedIdx] : undefined;

  const onSelect = (idx: number) =>
    void navigate({ search: (prev) => ({ ...prev, selected: idx }) });

  type ProjectLifecycleFilter = NonNullable<typeof lifecycle>;
  const onLifecycleChange = (states: string[]) =>
    navigate({
      search: (prev) => ({
        ...prev,
        lifecycle: states.length ? (states as ProjectLifecycleFilter) : undefined,
      }),
    });

  // T078c: navigate to wizard instead of opening modal
  const handleNewProject = useCallback(() => {
    void navigate({ to: '/projects/new' });
  }, [navigate]);

  const filteredProjects = lifecycle?.length
    ? projects.filter((p) => (lifecycle as string[]).includes(p.lifecycle))
    : projects;

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Projects"
            subtitle={loading ? 'Loading…' : `${filteredProjects.length} projects`}
            right={
              /* Header bar carries ONLY the global "New project" CTA; all
                 per-project actions live in the detail action bar. */
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
        }
        list={
          <ProjectsList
            projects={filteredProjects}
            selectedId={project?.id}
            onSelect={(id) => {
              const idx = projects.findIndex((p) => p.id === id);
              if (idx >= 0) onSelect(idx);
            }}
            lifecycle={lifecycle ?? []}
            onLifecycleChange={onLifecycleChange}
            loading={loading}
          />
        }
        detail={
          project ? (
            <ProjectDetailContent projectId={project.id} />
          ) : loading ? (
            <EmptyState title="Loading projects…" desc="" />
          ) : (
            <EmptyState
              title="Select a project"
              desc="Choose a project from the list to view its details."
            />
          )
        }
      />

    </PageShell>
  );
}
