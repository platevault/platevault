import { memo } from 'react';
import type { ProjectDetail as ProjectDetailType, ProjectState } from '@/api/types';
import { Box, KV, Pill, Btn, Section } from '@/ui';
import { LifecycleStrip } from './LifecycleStrip';

export interface ProjectInspectorProps {
  project: ProjectDetailType;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function lifecycleVariant(state: ProjectState) {
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

function lifecycleLabel(state: ProjectState): string {
  return state.replace(/_/g, ' ');
}

// ─── Component ──────────────────────────────────────────────────────────────

export const ProjectInspector = memo(function ProjectInspector({
  project,
}: ProjectInspectorProps) {
  const lightSessions = project.sources.filter((s) => s.role === 'light');
  const calSources = project.sources.filter((s) => s.role !== 'light');

  return (
    <div className="alm-proj-inspector">
      {/* Quick stats */}
      <Section title="Quick stats">
        <div className="alm-proj-inspector__stats">
          <KV
            label="Lifecycle"
            value={
              <Pill
                label={lifecycleLabel(project.state)}
                variant={lifecycleVariant(project.state)}
                size="sm"
              />
            }
          />
          <KV label="Integration" value={<span className="alm-mono">{project.total_integration_label}</span>} />
          <KV label="On disk" value={<span className="alm-mono">{project.on_disk_label}</span>} />
          <KV label="Profile" value={project.workflow_profile_id} />
          <KV
            label="Cleanup"
            value={
              project.cleanup_bytes > 0 ? (
                <span className="alm-mono">{project.cleanup_label} reclaimable</span>
              ) : (
                <span style={{ color: 'var(--alm-text-faint)' }}>None</span>
              )
            }
          />
          <KV
            label="Outputs"
            value={
              project.outputs.filter((o) => o.verification === 'accepted').length > 0 ? (
                <Pill
                  label={`${project.outputs.filter((o) => o.verification === 'accepted').length} accepted`}
                  variant="ok"
                  size="sm"
                />
              ) : (
                <span style={{ color: 'var(--alm-text-faint)' }}>&mdash;</span>
              )
            }
          />
        </div>
      </Section>

      {/* Linked sessions */}
      <Section title={`Sessions (${lightSessions.length} lights, ${calSources.length} cal)`}>
        <ul className="alm-proj-inspector__session-list">
          {lightSessions.map((s) => (
            <li key={s.name} className="alm-proj-inspector__session">
              <div className="alm-proj-inspector__session-name">{s.name}</div>
              <div className="alm-proj-inspector__session-meta">
                {s.frames} frames &middot; {s.hours}
                {s.warning && (
                  <span className="alm-proj-inspector__session-warn"> &middot; {s.warning}</span>
                )}
              </div>
            </li>
          ))}
          {calSources.map((s) => (
            <li key={s.name} className="alm-proj-inspector__session alm-proj-inspector__session--cal">
              <div className="alm-proj-inspector__session-name">
                <span className="alm-proj-inspector__session-role">{s.role}</span>
                {s.name}
              </div>
              <div className="alm-proj-inspector__session-meta">
                {s.frames} frames
                {s.warning && (
                  <span className="alm-proj-inspector__session-warn"> &middot; {s.warning}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      {/* Actions */}
      <Section title="Actions">
        <div className="alm-proj-inspector__actions">
          <Btn size="sm" data-tour="open-tool">Source views&hellip;</Btn>
          <Btn size="sm">Generate plan &#x25BE;</Btn>
          <Btn size="sm">Archive&hellip;</Btn>
        </div>
      </Section>

      {/* Lifecycle strip */}
      <Section title="Lifecycle">
        <LifecycleStrip currentIndex={project.lifecycle_stage_index} />
        <div style={{ marginTop: 'var(--alm-space-2)', fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
          {project.plan_count} plans applied &middot; {project.audit_count} audit entries
        </div>
      </Section>
    </div>
  );
});
