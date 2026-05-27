/**
 * ProjectDetail -- single consolidated view for a project.
 * Header, pipeline stats bar, source map, source views status, notes, cleanup.
 * No tabbed layout -- all sections visible at once.
 * Used both as a standalone route (/projects/$id) and inline.
 */

import { useParams } from '@tanstack/react-router';
import { useParameterizedQuery, createParameterizedStore } from '@/data/store';
import { getProject } from '@/api/commands';
import type { ProjectDetail as ProjectDetailType, ProjectState } from '@/bindings/types';
import { Pill, Btn, Section } from '@/ui';
import { PipelineStatsBar } from './PipelineStatsBar';
import { SourceMap } from './SourceMap';
import { SourceViewStatus } from './SourceViewStatus';
import { ProjectNotes } from './ProjectNotes';
import { CleanupPlan } from './CleanupPlan';

const projectStore = createParameterizedStore<string, ProjectDetailType>((id) =>
  getProject({ id }),
);

function stateVariant(state: ProjectState) {
  const map: Record<ProjectState, 'warn' | 'ghost' | 'info' | 'ok' | 'neutral' | 'danger'> = {
    setup_incomplete: 'warn',
    ready: 'ghost',
    prepared: 'info',
    processing: 'info',
    completed: 'ok',
    archived: 'neutral',
    blocked: 'danger',
  };
  return map[state];
}

function stateLabel(state: ProjectState): string {
  return state.replace(/_/g, ' ');
}

// Phases where source map editing is allowed
const EDITABLE_PHASES = new Set<ProjectState>(['setup_incomplete', 'ready']);

interface ProjectDetailContentProps {
  project: ProjectDetailType;
}

function ProjectDetailContent({ project }: ProjectDetailContentProps) {
  const editable = EDITABLE_PHASES.has(project.state);

  return (
    <div className="alm-project-detail">
      {/* Header */}
      <header className="alm-project-detail__header">
        <div className="alm-project-detail__header-left">
          <h2 className="alm-project-detail__name">{project.name}</h2>
          <Pill
            label={stateLabel(project.state)}
            variant={stateVariant(project.state)}
            size="sm"
          />
        </div>
        <div className="alm-project-detail__header-right">
          <span className="alm-project-detail__path alm-mono">{project.root_path}</span>
          <Btn size="sm">Reveal in Explorer</Btn>
        </div>
      </header>

      {/* Pipeline stats bar */}
      <PipelineStatsBar
        sourceCount={project.sources.length}
        viewCount={project.source_views.length}
        onDiskLabel={project.on_disk_label}
        outputCount={project.outputs.length}
      />

      {/* Source map */}
      <Section title={`Source map (${project.sources.length} sources)`}>
        <SourceMap sources={project.sources} editable={editable} />
      </Section>

      {/* Source views status */}
      <Section title={`Source views (${project.source_views.length})`}>
        <SourceViewStatus views={project.source_views} />
      </Section>

      {/* Notes */}
      <Section title="Notes">
        <ProjectNotes
          initialContent={
            project.notes_count > 0
              ? '## Processing notes\n\n- Reduced star FWHM from 2.8 to 2.4 with drizzle\n- Color balance adjusted per PixInsight STF'
              : ''
          }
          notesCount={project.notes_count}
        />
      </Section>

      {/* Cleanup */}
      {project.artifacts.length > 0 && (
        <Section title="Cleanup opportunities">
          <CleanupPlan
            artifacts={project.artifacts}
            cleanupLabel={project.cleanup_label}
          />
        </Section>
      )}
    </div>
  );
}

/** Inline variant for use inside the projects page (no route params needed). */
export interface ProjectDetailInlineProps {
  projectId: string;
  onProjectLoaded?: (project: ProjectDetailType) => void;
}

export function ProjectDetailInline({ projectId, onProjectLoaded }: ProjectDetailInlineProps) {
  const { data: project, loading } = useParameterizedQuery(projectStore, projectId);

  if (project && onProjectLoaded) {
    onProjectLoaded(project);
  }

  if (loading || !project) {
    return <div className="alm-page__loading">Loading project...</div>;
  }

  return <ProjectDetailContent project={project} />;
}

/** Route-level component for /projects/$id. */
export function ProjectDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: project, loading } = useParameterizedQuery(projectStore, id);

  if (loading || !project) {
    return <div className="alm-page__loading">Loading project...</div>;
  }

  return (
    <div className="alm-page" data-testid="ProjectDetail">
      <ProjectDetailContent project={project} />
    </div>
  );
}
