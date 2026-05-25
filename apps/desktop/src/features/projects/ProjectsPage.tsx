import { useCallback, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, createQueryStore } from '@/data/store';
import { listProjects } from '@/api/commands';
import type { ProjectDetail as ProjectDetailType } from '@/api/types';
import { ThreePane, EmptyState, Btn } from '@/ui';
import { ProjectsList } from './ProjectsList';
import { ProjectDetailPane } from './ProjectDetailPane';
import { ProjectInspector } from './ProjectInspector';

const projectsStore = createQueryStore(() => listProjects());

export function ProjectsPage() {
  const { data, loading } = useQuery(projectsStore);
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [loadedProject, setLoadedProject] = useState<ProjectDetailType | undefined>(undefined);

  // Track the project ID the loaded detail belongs to so stale data is not
  // shown in the inspector when selection changes.
  const loadedProjectIdRef = useRef<string | undefined>(undefined);

  const handleProjectLoaded = useCallback(
    (project: ProjectDetailType) => {
      loadedProjectIdRef.current = project.id;
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

  // Auto-select first project when none is selected
  const effectiveId = selectedId ?? projects[0]?.id;

  // Only show inspector data when it belongs to the currently selected project
  const inspectorProject =
    loadedProject && loadedProjectIdRef.current === effectiveId
      ? loadedProject
      : undefined;

  return (
    <div className="alm-page" data-testid="ProjectsPage">
      <ThreePane
        list={
          <ProjectsList
            projects={projects}
            selectedId={effectiveId}
            onSelect={setSelectedId}
            onNewProject={handleNewProject}
          />
        }
        content={
          effectiveId ? (
            <ProjectDetailPane
              projectId={effectiveId}
              onProjectLoaded={handleProjectLoaded}
            />
          ) : (
            <div className="alm-page__empty">Select a project to view details</div>
          )
        }
        detail={
          inspectorProject ? (
            <ProjectInspector project={inspectorProject} />
          ) : (
            <div className="alm-page__empty" style={{ padding: 'var(--alm-space-7)' }}>
              {effectiveId
                ? 'Loading inspector...'
                : 'Select a project to view details'}
            </div>
          )
        }
      />
    </div>
  );
}
