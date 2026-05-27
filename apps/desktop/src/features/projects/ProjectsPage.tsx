/**
 * ProjectsPage -- three-pane layout (list + detail + lifecycle sidebar).
 * Uses fixture data from @/data/fixtures/projects.
 * Design V3 rewrite.
 */

import { useState } from 'react';
import { PageShell, ListDetailLayout } from '@/components';
import { EmptyState } from '@/ui';
import { PROJECTS_DATA } from '@/data/fixtures/projects';
import type { ProjectFixture } from '@/data/fixtures/projects';
import { ProjectsList } from './ProjectsList';
import { ProjectDetailContent } from './ProjectDetail';
import { LifecycleSidebar } from './LifecycleSidebar';

export function ProjectsPage() {
  const [selectedId, setSelectedId] = useState<number>(PROJECTS_DATA[0].id);

  const selected: ProjectFixture | undefined = PROJECTS_DATA.find((p) => p.id === selectedId);

  return (
    <PageShell>
      <ListDetailLayout
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
              description="Choose a project from the list to view its details."
            />
          )
        }
        sidebar={
          selected ? (
            <LifecycleSidebar project={selected} />
          ) : (
            <EmptyState title="Select a project" />
          )
        }
      />
    </PageShell>
  );
}
