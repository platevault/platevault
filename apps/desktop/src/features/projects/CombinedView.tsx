import type { ProjectDetail } from '@/bindings/types';
import { Box, KV, Btn } from '@/ui';
import { KitGrid } from './KitGrid';
import { PipelineStrip } from './PipelineStrip';
import { LifecycleStrip } from './LifecycleStrip';

export interface CombinedViewProps {
  project: ProjectDetail;
}

export function CombinedView({ project }: CombinedViewProps) {
  const totalLinks = project.source_views.reduce((s, v) => s + v.link_count, 0);
  const totalArtifacts = project.artifacts.reduce((s, a) => s + a.count, 0);
  const lights = project.sources.filter((s) => s.role === 'light');
  const calMasters = project.sources.filter((s) => s.role !== 'light');

  return (
    <div style={{ padding: 'var(--alm-space-5)' }}>
      {/* Source map section */}
      <div className="alm-project-section">
        <div className="alm-project-section__header">
          <span className="alm-project-section__title">Source map</span>
          <span className="alm-project-section__sub">what feeds the pipeline</span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--alm-space-3)' }}>
            <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
              {lights.length} lights &middot; {calMasters.length} cal masters
            </span>
            <Btn size="sm">Re-run cal matching</Btn>
          </span>
        </div>
        <KitGrid sources={project.sources} compact />
      </div>

      {/* Vertical connector: source map -> pipeline */}
      <div className="alm-combined-connector" aria-hidden="true">
        <div className="alm-combined-connector__line" />
        <div className="alm-combined-connector__head" />
      </div>

      {/* Pipeline section */}
      <div className="alm-project-section">
        <div className="alm-project-section__header">
          <span className="alm-project-section__title">Pipeline</span>
          <span className="alm-project-section__sub">
            flow of data through the project after sources are selected
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            {project.source_views.length} views &middot; {totalArtifacts} artifacts &middot;{' '}
            {project.outputs.length} output{project.outputs.length !== 1 ? 's' : ''}
          </span>
        </div>
        <PipelineStrip project={project} compact />
      </div>

      {/* Bottom row: lifecycle, cleanup, notes */}
      <div className="alm-project-grid alm-project-grid--2-1-1" style={{ marginTop: 'var(--alm-space-5)' }}>
        <Box heading="Lifecycle">
          <LifecycleStrip currentIndex={project.lifecycle_stage_index} />
          <div style={{ marginTop: 'var(--alm-space-3)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            To complete: record outputs &rarr; mark accepted. To archive: requires plan (at minimum manifest write).
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

        <Box heading="Notes & manifests">
          <KV label="Notes" value={`${project.notes_count} markdown files`} />
          <KV label="Manifests" value={`${project.manifest_count} current · 0 stale`} />
          <KV label="Audit" value={`${project.audit_count} events`} />
        </Box>
      </div>
    </div>
  );
}
