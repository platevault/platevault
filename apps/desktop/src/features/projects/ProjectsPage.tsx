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

import { useState, useCallback } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import type { BtnVariant } from '@/ui';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { ProjectsList } from './ProjectsList';
import { ProjectDetailContent } from './ProjectDetail';
import { useProjects } from './store';
import { CreateProjectDialog } from './create/CreateProjectDialog';
import { addToast } from '@/shared/toast';
import type { ProjectSummaryDto } from '@/bindings/index';

// ── Contextual actions per lifecycle state ────────────────────────────────────

interface ContextualAction {
  label: string;
  variant?: BtnVariant;
}

function projectActions(lifecycle: string): ContextualAction[] {
  switch (lifecycle) {
    case 'setup_incomplete':
      return [{ label: 'Continue setup', variant: 'primary' }];
    case 'ready':
      return [{ label: 'Generate source view', variant: 'primary' }, { label: 'Add sessions' }];
    case 'prepared':
      return [{ label: 'Reveal source views', variant: 'primary' }];
    case 'processing':
      return [{ label: 'Mark complete', variant: 'primary' }];
    case 'completed':
      return [
        { label: 'Generate cleanup plan', variant: 'primary' },
        { label: 'Archive project' },
      ];
    case 'archived':
      return [{ label: 'Unarchive' }];
    case 'blocked':
      return [{ label: 'Resolve block', variant: 'danger' }];
    default:
      return [];
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const { selected, lifecycle } = useSearch({ from: '/shell/projects' });
  const navigate = useNavigate({ from: '/projects' });

  const { data: projects = [], loading } = useProjects();
  const [createOpen, setCreateOpen] = useState(false);

  // Stale-id cleanup: if selected index is out of range, clear it.
  const selectedIdx = selected ?? 0;
  const inRange = projects.length > 0 && selectedIdx < projects.length;
  useStaleSelectionCleanup(selected, inRange, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  const project: ProjectSummaryDto | undefined = inRange ? projects[selectedIdx] : undefined;

  const onSelect = (idx: number) =>
    navigate({ search: (prev) => ({ ...prev, selected: idx }) });

  type ProjectLifecycleFilter = NonNullable<typeof lifecycle>;
  const onLifecycleChange = (states: string[]) =>
    navigate({
      search: (prev) => ({
        ...prev,
        lifecycle: states.length ? (states as ProjectLifecycleFilter) : undefined,
      }),
    });

  const handleCreateSuccess = useCallback(
    (result: { projectId: string; planId?: string | null }) => {
      // Navigate to first slot (list will re-fetch and show the new project)
      navigate({ search: (prev) => ({ ...prev, selected: 0 }) });
      if (result.planId) {
        addToast({
          message: `Project created. Review the folder plan before applying.`,
          variant: 'info',
          action: {
            label: 'View plan',
            onClick: () => navigate({ to: '/archive', search: { selected: undefined } as never }),
          },
        });
      } else {
        addToast({ message: 'Project created.', variant: 'success' });
      }
    },
    [navigate],
  );

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
              <>
                {project && (
                  <>
                    {projectActions(project.lifecycle).map((a) => (
                      <Btn key={a.label} size="sm" variant={a.variant}>
                        {a.label}
                      </Btn>
                    ))}
                    <Btn size="sm">Reveal in Explorer</Btn>
                  </>
                )}
                <Btn
                  size="sm"
                  variant="primary"
                  onClick={() => setCreateOpen(true)}
                  data-guide-anchor="projects.create-cta"
                >
                  + New project
                </Btn>
              </>
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

      <CreateProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={handleCreateSuccess}
      />
    </PageShell>
  );
}
