import { useNavigate, useSearch } from '@tanstack/react-router';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import type { BtnVariant } from '@/ui';
import { PROJECTS_DATA } from '@/data/fixtures/projects';
import type { ProjectFixture } from '@/data/fixtures/projects';
import { useStaleSelectionCleanup } from '@/lib/use-stale-selection';
import { ProjectsList } from './ProjectsList';
import { ProjectDetailContent } from './ProjectDetail';

interface ContextualAction {
  label: string;
  variant?: BtnVariant;
}

// Contextual primary actions for the selected project, driven by lifecycle
// state (design v4: item actions live in the one toolbar row, not the header).
function projectActions(state: ProjectFixture['state']): ContextualAction[] {
  switch (state) {
    case 'setup_incomplete':
      return [{ label: 'Continue setup', variant: 'primary' }];
    case 'ready':
      return [{ label: 'Generate source view', variant: 'primary' }, { label: 'Add sessions' }];
    case 'prepared':
      return [{ label: 'Reveal source views', variant: 'primary' }];
    case 'processing':
      return [{ label: 'Mark complete', variant: 'primary' }];
    case 'completed':
      return [{ label: 'Generate cleanup plan', variant: 'primary' }, { label: 'Archive project' }];
    case 'archived':
      return [{ label: 'Unarchive' }];
    case 'blocked':
      return [{ label: 'Resolve block', variant: 'danger' }];
    default:
      return [];
  }
}

export function ProjectsPage() {
  const { selected, lifecycle } = useSearch({ from: '/shell/projects' });
  const navigate = useNavigate({ from: '/projects' });

  // Stale-id cleanup only when a selection is explicitly in the URL.
  const explicit = selected !== undefined ? PROJECTS_DATA.find((p) => p.id === selected) : undefined;
  useStaleSelectionCleanup(selected, explicit !== undefined, () =>
    navigate({ search: (prev) => ({ ...prev, selected: undefined }), replace: true }),
  );

  // Soft default: show the first project when nothing is explicitly selected
  // (do not write it to the URL, so the URL stays clean until the user picks).
  const selectedId = selected ?? PROJECTS_DATA[0].id;
  const project: ProjectFixture | undefined = PROJECTS_DATA.find((p) => p.id === selectedId);

  const onSelect = (id: number) => navigate({ search: (prev) => ({ ...prev, selected: id }) });
  const onLifecycleChange = (states: ProjectFixture['state'][]) =>
    navigate({ search: (prev) => ({ ...prev, lifecycle: states.length ? states : undefined }) });

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Projects"
            subtitle={`${PROJECTS_DATA.length} projects`}
            right={
              <>
                {project && (
                  <>
                    {projectActions(project.state).map((a) => (
                      <Btn key={a.label} size="sm" variant={a.variant}>
                        {a.label}
                      </Btn>
                    ))}
                    <Btn size="sm">Reveal in Explorer</Btn>
                  </>
                )}
                <Btn size="sm">+ New project</Btn>
              </>
            }
          />
        }
        list={
          <ProjectsList
            projects={PROJECTS_DATA}
            selectedId={selectedId}
            onSelect={onSelect}
            lifecycle={lifecycle ?? []}
            onLifecycleChange={onLifecycleChange}
          />
        }
        detail={
          project ? (
            <ProjectDetailContent project={project} />
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
