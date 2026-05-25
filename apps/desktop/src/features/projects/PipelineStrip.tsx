import { memo } from 'react';
import type { ProjectDetail } from '@/bindings/types';
import { Pill, Lock } from '@/ui';

export interface PipelineStripProps {
  project: ProjectDetail;
  compact?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export const PipelineStrip = memo(function PipelineStrip({ project, compact }: PipelineStripProps) {
  const lights = project.sources.filter((s) => s.role === 'light');
  const calibration = project.sources.filter((s) => s.role !== 'light');
  const totalLinks = project.source_views.reduce((s, v) => s + v.link_count, 0);
  const totalArtifacts = project.artifacts.reduce((s, a) => s + a.count, 0);
  const acceptedOutputs = project.outputs.filter((o) => o.verification === 'accepted');

  return (
    <div className="alm-pipeline">
      {/* Stage 1: Sources */}
      <div className="alm-pipeline__stage">
        <div className="alm-pipeline__stage-header">
          <span className="alm-pipeline__stage-title">{'①'} Sources</span>
          <Pill label="selected" variant="ok" size="sm" />
          <span className="alm-pipeline__stage-right">
            {lights.length} sess &middot; {project.total_integration_label}
          </span>
        </div>
        <div className="alm-pipeline__stage-body" style={{ padding: compact ? '6px' : '10px' }}>
          <div className="alm-pipeline__label">Lights</div>
          {lights.map((l, i) => (
            <div key={i} style={l.selection === 'candidate' ? { color: 'var(--alm-warn)' } : undefined}>
              {l.name.replace(/^.*?·\s*/, '')} &middot; {l.frames}&times;
              {l.selection === 'candidate' ? ' (cand)' : ''}
            </div>
          ))}
          <div className="alm-pipeline__label" style={{ marginTop: 'var(--alm-space-3)' }}>
            Calibration
          </div>
          <div>
            {calibration.map((c) => c.name.split('_')[0].replace('Master', '')).join(' · ')}
          </div>
        </div>
      </div>

      <Arrow />

      {/* Stage 2: Source views */}
      <div className="alm-pipeline__stage">
        <div className="alm-pipeline__stage-header">
          <span className="alm-pipeline__stage-title">{'②'} Source views</span>
          <Pill label="applied" variant="ok" size="sm" />
          <span className="alm-pipeline__stage-right">{totalLinks} links</span>
        </div>
        <div className="alm-pipeline__stage-body" style={{ padding: compact ? '6px' : '10px' }}>
          {project.source_views.map((v) => (
            <div key={v.name}>
              <div className="alm-mono" style={{ fontSize: '10.5px' }}>{v.name}/</div>
              <div style={{ fontSize: '10px', color: 'var(--alm-text-muted)' }}>
                {v.strategy === 'junction' ? 'NTFS junction' : v.strategy} &middot; {v.plan_ref}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Arrow />

      {/* Stage 3: Processing */}
      <div className="alm-pipeline__stage">
        <div className="alm-pipeline__stage-header">
          <span className="alm-pipeline__stage-title">{'③'} Processing</span>
          <Pill label="observed" variant="info" size="sm" />
          <span className="alm-pipeline__stage-right">{totalArtifacts} artifacts</span>
        </div>
        <div className="alm-pipeline__stage-body" style={{ padding: compact ? '6px' : '10px' }}>
          {project.artifacts
            .filter((a) => a.count > 0)
            .slice(0, 4)
            .map((a) => (
              <div key={a.type} style={{ display: 'flex' }}>
                <span style={{ flex: 1 }}>{a.type.toLowerCase()}</span>
                <span className="alm-mono" style={{ color: 'var(--alm-text-muted)' }}>
                  {formatSize(a.total_size_bytes)}
                </span>
              </div>
            ))}
        </div>
      </div>

      <Arrow />

      {/* Stage 4: Outputs */}
      <div className="alm-pipeline__stage">
        <div className="alm-pipeline__stage-header">
          <span className="alm-pipeline__stage-title">{'④'} Outputs</span>
          <Pill
            label={acceptedOutputs.length > 0 ? 'accepted' : 'pending'}
            variant={acceptedOutputs.length > 0 ? 'ok' : 'ghost'}
            size="sm"
          />
          <span className="alm-pipeline__stage-right">
            {acceptedOutputs.length} verified
          </span>
        </div>
        <div className="alm-pipeline__stage-body" style={{ padding: compact ? '6px' : '10px' }}>
          {acceptedOutputs.map((o) => (
            <div key={o.id} className="alm-output-card">
              <Lock reason="Protected" />
              <div style={{ flex: 1 }}>
                <div className="alm-mono" style={{ fontSize: '10.5px', fontWeight: 500 }}>
                  {o.filename}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--alm-text-muted)' }}>
                  {formatSize(o.size_bytes)} &middot; {o.date}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

function Arrow() {
  return (
    <div className="alm-pipeline__arrow">
      <div className="alm-pipeline__arrow-line" />
      <div className="alm-pipeline__arrow-head" />
    </div>
  );
}
