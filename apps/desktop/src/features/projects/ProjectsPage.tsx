import { useState } from 'react';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { Btn, EmptyState } from '@/ui';
import type { BtnVariant } from '@/ui';
import { PROJECTS_DATA } from '@/data/fixtures/projects';
import type { ProjectFixture } from '@/data/fixtures/projects';
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
  const [selectedId, setSelectedId] = useState<number>(PROJECTS_DATA[0].id);
  const selected: ProjectFixture | undefined = PROJECTS_DATA.find((p) => p.id === selectedId);

  return (
    <PageShell>
      <ListDetailLayout
        topBar={
          <TopActionBar
            title="Projects"
            subtitle={`${PROJECTS_DATA.length} projects`}
            right={
              <>
                {selected && (
                  <>
                    {projectActions(selected.state).map((a) => (
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
            onSelect={setSelectedId}
          />
        }
        detail={
          selected ? (
            <ProjectDetailContent project={selected} />
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
