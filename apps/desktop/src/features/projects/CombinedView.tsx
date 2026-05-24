import type { ProjectDetail } from '@/api/types';
import { Pill } from '@/ui';
import { CommandCenter } from './CommandCenter';
import { PipelineView } from './PipelineView';

export interface CombinedViewProps {
  project: ProjectDetail;
}

export function CombinedView({ project }: CombinedViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, overflow: 'auto' }}>
      {/* Compact command center */}
      <CommandCenter sourceMap={project.source_map} compact />

      {/* Feeds-into connector */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: 'var(--alm-space-2)',
          color: 'var(--alm-text-muted)',
          fontSize: 'var(--alm-text-xs)',
        }}
        aria-hidden="true"
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-space-2)' }}>
          <span style={{ width: 24, height: 1, background: 'var(--alm-border)', display: 'inline-block' }} />
          feeds into
          <span style={{ width: 24, height: 1, background: 'var(--alm-border)', display: 'inline-block' }} />
        </span>
      </div>

      {/* Pipeline strip */}
      <PipelineView project={project} />

      {/* Bottom row: lifecycle, cleanup, manifests */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--alm-space-5)',
          padding: 'var(--alm-space-4) var(--alm-space-5)',
          borderTop: '1px solid var(--alm-border)',
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
          flexWrap: 'wrap',
        }}
      >
        <span>
          Lifecycle: <Pill label={project.state.replace(/_/g, ' ')} variant="neutral" size="sm" />
        </span>
        {project.cleanup_state.reclaimable_bytes > 0 && (
          <span>
            Cleanup: <Pill label="eligible" variant="warn" size="sm" />
          </span>
        )}
        <span>
          Source views: {project.source_view_ids.length}
        </span>
        <span>
          Outputs: {project.outputs.length}
        </span>
      </div>
    </div>
  );
}
