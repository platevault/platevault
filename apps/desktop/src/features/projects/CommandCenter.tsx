import { memo } from 'react';
import type { ProjectDetail, ProjectSource } from '@/api/types';
import { Box, KV, Pill, Btn, Lock } from '@/ui';
import { KitGrid } from './KitGrid';
import { LifecycleStrip } from './LifecycleStrip';

export interface CommandCenterProps {
  project: ProjectDetail;
  compact?: boolean;
}

export const CommandCenter = memo(function CommandCenter({ project, compact }: CommandCenterProps) {
  return (
    <div style={{ padding: compact ? 'var(--alm-space-3)' : 'var(--alm-space-5)' }}>
      {/* Source map (kit-grid) */}
      <div className="alm-project-section">
        <div className="alm-project-section__header">
          <span className="alm-project-section__title">Source map</span>
          <span className="alm-project-section__sub">
            kit view &mdash; each role is a column. Drag sessions between columns to change roles.
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--alm-space-3)' }}>
            <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
              {project.source_views.reduce((s, v) => s + v.link_count, 0)} links
            </span>
            <Btn size="sm">Re-run cal matching</Btn>
          </span>
        </div>
        <KitGrid sources={project.sources} compact={compact} />
      </div>

      {/* Three summary boxes: source views, processing artifacts, outputs */}
      <div className="alm-project-grid alm-project-grid--3" style={{ marginTop: 'var(--alm-space-5)' }}>
        <Box heading={`Source views (${project.source_views.length})`}>
          {project.source_views.map((v) => (
            <KV key={v.name} label={`${v.name}/`} value={`${v.link_count} ${v.strategy}s · ${v.plan_ref}`} />
          ))}
          <Btn size="sm" style={{ marginTop: 'var(--alm-space-3)' }}>+ New view</Btn>
        </Box>

        <Box heading={`Processing artifacts (${project.artifacts.reduce((s, a) => s + a.count, 0)})`}>
          {project.artifacts
            .filter((a) => a.count > 0)
            .slice(0, 4)
            .map((a) => (
              <KV
                key={a.type}
                label={a.type.toLowerCase()}
                value={`${a.count} files · ${formatSize(a.total_size_bytes)} · ${a.cleanup_eligibility === 'eligible' ? 'cleanup-eligible' : a.cleanup_eligibility}`}
              />
            ))}
        </Box>

        <Box heading={`Outputs (${project.outputs.filter((o) => o.verification === 'accepted').length} verified)`}>
          {project.outputs
            .filter((o) => o.verification === 'accepted')
            .map((o) => (
              <div key={o.id} className="alm-output-card">
                <Lock reason="Protected" />
                <div style={{ flex: 1 }}>
                  <div className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)', fontWeight: 500 }}>
                    {o.filename}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--alm-text-muted)' }}>
                    {formatSize(o.size_bytes)} &middot; {o.date}
                  </div>
                </div>
                <Pill label="accepted" variant="ok" size="sm" />
              </div>
            ))}
          <Btn size="sm" style={{ marginTop: 'var(--alm-space-3)' }}>+ Record output</Btn>
        </Box>
      </div>

      {/* Lifecycle + Cleanup */}
      <div className="alm-project-grid alm-project-grid--2-1" style={{ marginTop: 'var(--alm-space-5)' }}>
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
            reclaimable using global policy
          </div>
          <Btn size="sm" style={{ marginTop: 'var(--alm-space-3)' }}>Plan cleanup &rarr;</Btn>
          <div style={{ marginTop: 'var(--alm-space-2)', fontSize: '10.5px', color: 'var(--alm-text-muted)' }}>
            <a href="#">Edit global policy in Settings &rarr;</a>
          </div>
        </Box>
      </div>
    </div>
  );
});

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
