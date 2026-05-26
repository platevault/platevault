/**
 * LifecycleSidebar -- right sidebar for projects with phase badge,
 * phase-specific actions, and quick stats.
 */

import { memo } from 'react';
import type { ProjectDetail as ProjectDetailType, ProjectState } from '@/bindings/types';
import { Pill, Btn, Section, KV } from '@/ui';
import { LifecycleStrip } from './LifecycleStrip';

export interface LifecycleSidebarProps {
  project: ProjectDetailType;
}

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

/** Phase-specific actions based on the current project state. */
function phaseActions(state: ProjectState): Array<{ label: string; variant?: 'primary' | 'ghost' }> {
  switch (state) {
    case 'setup_incomplete':
      return [
        { label: 'Continue setup', variant: 'primary' },
      ];
    case 'ready':
      return [
        { label: 'Generate source view', variant: 'primary' },
        { label: 'Add sessions' },
        { label: 'Edit source map' },
      ];
    case 'processing':
      return [
        { label: 'Record output', variant: 'primary' },
        { label: 'Observe artifacts' },
        { label: 'Re-generate view' },
      ];
    case 'completed':
      return [
        { label: 'Generate cleanup plan', variant: 'primary' },
        { label: 'Archive project' },
      ];
    case 'archived':
      return [
        { label: 'Unarchive' },
      ];
    case 'blocked':
      return [
        { label: 'Resolve block', variant: 'primary' },
      ];
    default:
      return [
        { label: 'Generate source view' },
      ];
  }
}

export const LifecycleSidebar = memo(function LifecycleSidebar({
  project,
}: LifecycleSidebarProps) {
  const actions = phaseActions(project.state);

  return (
    <aside className="alm-lifecycle-sidebar" aria-label="Project lifecycle sidebar">
      {/* Phase badge */}
      <Section title="Lifecycle">
        <div className="alm-lifecycle-sidebar__phase">
          <Pill
            label={stateLabel(project.state)}
            variant={stateVariant(project.state)}
          />
        </div>
        <LifecycleStrip currentIndex={project.lifecycle_stage_index} />
        <div className="alm-lifecycle-sidebar__audit">
          {project.plan_count} plans applied &middot; {project.audit_count} audit entries
        </div>
      </Section>

      {/* Phase-specific actions */}
      <Section title="Actions">
        <div className="alm-lifecycle-sidebar__actions">
          {actions.map((action) => (
            <Btn
              key={action.label}
              size="sm"
              variant={action.variant}
            >
              {action.label}
            </Btn>
          ))}
        </div>
      </Section>

      {/* Quick stats */}
      <Section title="Quick stats">
        <div className="alm-lifecycle-sidebar__stats">
          <KV
            label="Integration"
            value={<span className="alm-mono">{project.total_integration_label}</span>}
          />
          <KV
            label="On disk"
            value={<span className="alm-mono">{project.on_disk_label}</span>}
          />
          <KV label="Profile" value={project.workflow_profile_id} />
          <KV
            label="Targets"
            value={project.targets?.join(', ') || 'No target'}
          />
          <KV
            label="Cleanup"
            value={
              project.cleanup_bytes > 0 ? (
                <span className="alm-mono">{project.cleanup_label} reclaimable</span>
              ) : (
                'None'
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
                'None'
              )
            }
          />
          <KV label="Notes" value={String(project.notes_count)} />
          <KV label="Manifests" value={String(project.manifest_count)} />
        </div>
      </Section>
    </aside>
  );
});
