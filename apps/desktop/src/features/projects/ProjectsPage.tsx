import { useState } from 'react';
import { PageShell, ListDetailLayout, TopActionBar } from '@/components';
import { EmptyState } from '@/ui';
import { PROJECTS_DATA } from '@/data/fixtures/projects';
import type { ProjectFixture } from '@/data/fixtures/projects';
import { ProjectsList } from './ProjectsList';
import { ProjectDetailContent } from './ProjectDetail';

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
