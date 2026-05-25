import { useParams } from '@tanstack/react-router';
import { useParameterizedQuery, createParameterizedStore } from '@/data/store';
import { usePreference } from '@/data/preferences';
import { getProject } from '@/api/commands';
import type { ProjectDetail as ProjectDetailType, ViewMode, ProjectState } from '@/api/types';
import { Toolbar, Pill, Btn } from '@/ui';
import { CommandCenter } from './CommandCenter';
import { PipelineView } from './PipelineView';
import { CombinedView } from './CombinedView';

const projectStore = createParameterizedStore<string, ProjectDetailType>((id) =>
  getProject({ id }),
);

function projectStateVariant(state: ProjectState) {
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

export function ProjectDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: project, loading } = useParameterizedQuery(projectStore, id);
  const [viewModes, setViewModes] = usePreference('projectViewModes');
  const [defaultView] = usePreference('defaultProjectView');

  const currentView: ViewMode = viewModes[id] || defaultView;

  function setView(mode: ViewMode) {
    setViewModes({ ...viewModes, [id]: mode });
  }

  if (loading || !project) {
    return <div className="alm-page__loading">Loading project...</div>;
  }

  const breadcrumbLabel =
    currentView === 'center'
      ? 'Command center'
      : currentView === 'pipeline'
        ? 'Pipeline'
        : 'Overview (source + pipeline)';

  return (
    <div className="alm-page" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Main toolbar */}
      <Toolbar
        subBar={
          <div className="alm-project-sub">
            <span className="alm-mono">{project.root_path}</span>
            <span className="alm-project-sub__dot">&middot;</span>
            <span>
              created 2024-12-02 &middot; plan #{project.plan_count} applied &middot;{' '}
              {project.audit_count} audit entries
            </span>
            <span style={{ marginLeft: 'auto' }}>
              {project.targets?.join(', ') || 'No target'} &middot; {project.workflow_profile_id}
            </span>
          </div>
        }
      >
        {/* Title + lifecycle pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-space-3)' }}>
          <span style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}>
            {project.name}
          </span>
          <Pill
            label={project.state.replace(/_/g, ' ').toUpperCase()}
            variant={projectStateVariant(project.state)}
            size="sm"
          />
        </div>

        <span style={{ flex: 1 }} />

        {/* View toggle group */}
        <div className="alm-view-toggle">
          <button
            className={`alm-view-toggle__btn${currentView === 'center' ? ' alm-view-toggle__btn--active' : ''}`}
            onClick={() => setView('center')}
          >
            Command center
          </button>
          <button
            className={`alm-view-toggle__btn${currentView === 'pipeline' ? ' alm-view-toggle__btn--active' : ''}`}
            onClick={() => setView('pipeline')}
          >
            Pipeline
          </button>
          <button
            className={`alm-view-toggle__btn${currentView === 'combined' ? ' alm-view-toggle__btn--active' : ''}`}
            onClick={() => setView('combined')}
          >
            Combined
          </button>
        </div>

        {/* Action buttons */}
        <Btn size="sm" data-tour="open-tool">Source views&hellip;</Btn>
        <Btn size="sm">Observe artifacts</Btn>
        <Btn size="sm">Record output&hellip;</Btn>
        <Btn size="sm">Generate plan &#x25BE;</Btn>
      </Toolbar>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {currentView === 'center' && <CommandCenter project={project} />}
        {currentView === 'pipeline' && <PipelineView project={project} />}
        {currentView === 'combined' && <CombinedView project={project} />}
      </div>
    </div>
  );
}
