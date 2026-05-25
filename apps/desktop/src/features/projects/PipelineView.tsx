import { memo } from 'react';
import type { ProjectDetail } from '@/api/types';
import { Box, KV, Btn } from '@/ui';
import { PipelineStrip } from './PipelineStrip';
import { LifecycleStrip } from './LifecycleStrip';

export interface PipelineViewProps {
  project: ProjectDetail;
}

export const PipelineView = memo(function PipelineView({ project }: PipelineViewProps) {
  return (
    <div style={{ padding: 'var(--alm-space-5)' }}>
      {/* Pipeline section */}
      <div className="alm-project-section">
        <div className="alm-project-section__header">
          <span className="alm-project-section__title">Project pipeline</span>
          <span className="alm-project-section__sub">
            follow the data: sources &rarr; tool-friendly views &rarr; processing &rarr; outputs
          </span>
        </div>
        <PipelineStrip project={project} />
      </div>

      {/* Bottom row: lifecycle, cleanup, manifests */}
      <div className="alm-project-grid alm-project-grid--2-1-1" style={{ marginTop: 'var(--alm-space-5)' }}>
        <Box heading="Lifecycle">
          <LifecycleStrip currentIndex={project.lifecycle_stage_index} />
          <div style={{ marginTop: 'var(--alm-space-3)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            1 attempt &middot; audited {project.audit_count} events &middot; cleanup not yet run
          </div>
        </Box>

        <Box heading="Cleanup">
          <div className="alm-mono" style={{ fontSize: '18px', fontWeight: 600 }}>
            {project.cleanup_label}
          </div>
          <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            reclaimable
          </div>
          <Btn size="sm" style={{ marginTop: 'var(--alm-space-3)' }}>Plan cleanup &rarr;</Btn>
        </Box>

        <Box heading="Manifests">
          <KV label="project.json" value="current" />
          <KV label="sources.json" value="current" />
          <KV label="audit.jsonl" value={`${project.audit_count} entries`} />
        </Box>
      </div>
    </div>
  );
});
