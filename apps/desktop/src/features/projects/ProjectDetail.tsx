import { useParams } from '@tanstack/react-router';
import { useParameterizedQuery, createParameterizedStore } from '@/data/store';
import { usePreference } from '@/data/preferences';
import { getProject } from '@/api/commands';
import type { ProjectDetail as ProjectDetailType, ViewMode } from '@/api/types';
import { Toolbar, Pill, Btn } from '@/ui';
import { CommandCenter } from './CommandCenter';
import { PipelineView } from './PipelineView';
import { CombinedView } from './CombinedView';

const projectStore = createParameterizedStore<string, ProjectDetailType>((id) =>
  getProject({ id }),
);

function projectStateVariant(state: string) {
  switch (state) {
    case 'completed':
      return 'ok' as const;
    case 'ready':
    case 'prepared':
      return 'info' as const;
    case 'processing':
      return 'neutral' as const;
    case 'blocked':
      return 'danger' as const;
    case 'archived':
      return 'warn' as const;
    default:
      return 'ghost' as const;
  }
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

  return (
    <div className="alm-page" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <Toolbar>
        <span style={{ fontWeight: 600, fontSize: 'var(--alm-text-sm)' }}>
          {project.name}
        </span>
        <Pill label={project.state.replace(/_/g, ' ')} variant={projectStateVariant(project.state)} size="sm" />
        <span data-tour="open-tool">
          <Pill label={project.workflow_profile_id} variant="ghost" size="sm" />
        </span>
        <span style={{ flex: 1 }} />
        <Btn
          size="sm"
          variant={currentView === 'center' ? 'primary' : undefined}
          onClick={() => setView('center')}
        >
          Command center
        </Btn>
        <Btn
          size="sm"
          variant={currentView === 'pipeline' ? 'primary' : undefined}
          onClick={() => setView('pipeline')}
        >
          Pipeline
        </Btn>
        <Btn
          size="sm"
          variant={currentView === 'combined' ? 'primary' : undefined}
          onClick={() => setView('combined')}
        >
          Combined
        </Btn>
      </Toolbar>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {currentView === 'center' && <CommandCenter sourceMap={project.source_map} />}
        {currentView === 'pipeline' && <PipelineView project={project} />}
        {currentView === 'combined' && <CombinedView project={project} />}
      </div>
    </div>
  );
}
