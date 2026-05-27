/**
 * ProjectsPage -- three-pane layout using PageShell + ListDetailLayout.
 * Left: ProjectsList (ListSidebar), Center: ProjectDetail,
 * Right: LifecycleSidebar.
 * Replaces alm-hybrid-layout divs with ListDetailLayout(list, detail, sidebar).
 * Rewritten per spec 030 composition contracts.
 */

import { useCallback, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, createQueryStore } from '@/data/store';
import { listProjects } from '@/api/commands';
import type { ProjectDetail as ProjectDetailType } from '@/bindings/types';
import { EmptyState, Btn } from '@/ui';
import { PageShell, ListDetailLayout } from '@/components';
import { ProjectsList } from './ProjectsList';
import { ProjectDetailInline } from './ProjectDetail';
import { LifecycleSidebar } from './LifecycleSidebar';

const projectsStore = createQueryStore(() => listProjects());

export function ProjectsPage() {
  const { data, loading } = useQuery(projectsStore);
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [loadedProject, setLoadedProject] = useState<ProjectDetailType | undefined>(undefined);

  const handleProjectLoaded = useCallback(
    (project: ProjectDetailType) => {
      setLoadedProject(project);
    },
    [],
  );

  const handleNewProject = useCallback(() => {
    navigate({ to: '/projects/new' });
  }, [navigate]);

  const projects = data ?? [];
  const effectiveId = selectedId ?? projects[0]?.id;

  // Only show sidebar data when it belongs to the currently selected project
  const sidebarProject =
    loadedProject && loadedProject.id === effectiveId
      ? loadedProject
      : undefined;

  return (
    <PageShell
      testId="ProjectsPage"
      loading={loading}
      loadingMessage="Loading projects..."
      empty={{
        title: 'No projects yet',
        description: 'Create a project to organize sessions, calibration masters, and outputs.',
        action: (
          <Btn variant="primary" onClick={handleNewProject}>
            + New project
          </Btn>
        ),
      }}
      hasData={projects.length > 0}
    >
      <ListDetailLayout
        list={
          <ProjectsList
            projects={projects}
            selectedId={effectiveId}
            onSelect={setSelectedId}
            onNewProject={handleNewProject}
          />
        }
        detail={
          effectiveId ? (
            <ProjectDetailInline
              projectId={effectiveId}
              onProjectLoaded={handleProjectLoaded}
            />
          ) : (
            <EmptyState
              title="Select a project"
              description="Choose a project from the list to view its details."
            />
          )
        }
        sidebar={
          sidebarProject ? (
            <LifecycleSidebar project={sidebarProject} />
          ) : (
            <EmptyState
              title={effectiveId ? 'Loading...' : 'Select a project'}
              description={effectiveId ? undefined : 'Choose a project to view lifecycle details.'}
            />
          )
        }
      />
    </PageShell>
  );
}
