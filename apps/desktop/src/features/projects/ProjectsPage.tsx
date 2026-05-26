/**
 * ProjectsPage -- list-detail-sidebar layout for projects.
 * Left: ProjectsList (ListSidebar), Center: ProjectDetail, Right: LifecycleSidebar.
 */

import { useCallback, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, createQueryStore } from '@/data/store';
import { listProjects } from '@/api/commands';
import type { ProjectDetail as ProjectDetailType } from '@/bindings/types';
import { EmptyState, Btn } from '@/ui';
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

  if (loading) {
    return <div className="alm-page__loading">Loading projects...</div>;
  }

  const projects = data ?? [];

  if (projects.length === 0) {
    return (
      <div className="alm-page" data-testid="ProjectsPage">
        <EmptyState
          title="No projects yet"
          description="Create a project to organize sessions, calibration masters, and outputs."
          action={
            <Btn variant="primary" onClick={handleNewProject}>
              + New project
            </Btn>
          }
        />
      </div>
    );
  }

  const effectiveId = selectedId ?? projects[0]?.id;

  // Only show sidebar data when it belongs to the currently selected project
  const sidebarProject =
    loadedProject && loadedProject.id === effectiveId
      ? loadedProject
      : undefined;

  return (
    <div className="alm-page alm-page--hybrid" data-testid="ProjectsPage">
      <div className="alm-hybrid-layout">
        <div className="alm-hybrid-layout__list">
          <ProjectsList
            projects={projects}
            selectedId={effectiveId}
            onSelect={setSelectedId}
            onNewProject={handleNewProject}
          />
        </div>
        <div className="alm-hybrid-layout__content">
          {effectiveId ? (
            <ProjectDetailInline
              projectId={effectiveId}
              onProjectLoaded={handleProjectLoaded}
            />
          ) : (
            <div className="alm-page__empty">Select a project to view details</div>
          )}
        </div>
        <div className="alm-hybrid-layout__sidebar">
          {sidebarProject ? (
            <LifecycleSidebar project={sidebarProject} />
          ) : (
            <div className="alm-page__empty">
              {effectiveId
                ? 'Loading sidebar...'
                : 'Select a project to view lifecycle details'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
