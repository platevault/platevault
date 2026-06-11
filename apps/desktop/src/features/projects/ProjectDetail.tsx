/**
 * ProjectDetail — spec 008 wired.
 *
 * Loads project detail via useProjectDetail(id) from the real DB.
 * Renders sources, channels (with drift banner), and basic metadata.
 * Edit entry point opens EditProjectPane.
 */

import { useState } from 'react';
import {
  DetailHeader,
  DetailPane,
  MetricLine,
  DetailGrid,
  Rail,
  RailCard,
  Lifecycle,
} from '@/components';
import { Pill, Btn, Section, Banner } from '@/ui';
import type { PillVariant } from '@/ui';
import { projectStateLabel, projectStateVariant } from '@/lib/lifecycle';
import {
  useProjectDetail,
  useDismissChannelDrift,
  useReinferChannels,
  useTransitionLifecycle,
} from './store';
import type { ProjectLifecycleState } from './store';
import { EditProjectPane } from './edit/EditProjectPane';
import { addToast } from '@/shared/toast';
// spec 007 T034: calibration match panel (batch suggest per project source).
import { CalibrationMatchPanel } from './CalibrationMatchPanel';
import { BlockedBanner } from './BlockedBanner';
import type { BlockedReason, RecoveryEdge } from './BlockedBanner';
import { lifecycleFooterActions, isPlanRequiredError } from './lifecycle-actions';
// spec 011: tool launch CTA
import {
  toolIdFromProjectTool,
  toolLaunchDisabledReason,
  toolLaunchDisabledTooltip,
  useToolProfiles,
  useToolLaunch,
} from './tool-launch';

// ── Helpers ──────────────────────────────────────────────────────────────────

function sourceTypeVariant(filter: string): PillVariant {
  const lower = filter.toLowerCase();
  if (lower === 'ha') return 'danger';
  if (lower === 'oiii') return 'info';
  if (lower === 'sii') return 'warn';
  if (lower === 'l' || lower === 'lum') return 'neutral';
  return 'ghost';
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface ProjectDetailContentProps {
  projectId: string;
}

/** Alias export for backward compatibility (smoke tests, index.ts). */
export { ProjectDetailContent as ProjectDetail };

// ── Component ────────────────────────────────────────────────────────────────

export function ProjectDetailContent({ projectId }: ProjectDetailContentProps) {
  const { data: project, loading, error } = useProjectDetail(projectId);
  const [editOpen, setEditOpen] = useState(false);
  const [channelWorking, setChannelWorking] = useState(false);
  const [transitionWorking, setTransitionWorking] = useState(false);

  // spec 011: tool launch (hooks must be called unconditionally)
  const projectToolStr = typeof project?.tool === 'string' ? project.tool : '';
  const toolId = projectToolStr ? toolIdFromProjectTool(projectToolStr) : '';
  const { profiles } = useToolProfiles();
  const toolProfile = profiles.find((p) => p.id === toolId);
  const { state: launchState, launch: launchTool, dismissPriorWarning } = useToolLaunch(
    projectId,
    toolId,
    projectToolStr || 'tool',
  );
  const launchDisabledReason = toolLaunchDisabledReason(toolProfile);

  if (loading && !project) {
    return (
      <DetailPane fill>
        <div style={{ padding: 'var(--alm-sp-4)', color: 'var(--alm-color-muted)' }}>
          Loading project…
        </div>
      </DetailPane>
    );
  }

  if (error || !project) {
    return (
      <DetailPane fill>
        <Banner variant="danger">Could not load project.</Banner>
      </DetailPane>
    );
  }

  const toolLabel =
    typeof project.tool === 'string' ? project.tool : 'Unknown tool';
  const lifecycle =
    typeof project.lifecycle === 'string' ? project.lifecycle : 'setup_incomplete';

  const handleReinfer = async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      await useReinferChannels({ requestId: crypto.randomUUID(), projectId });
    } catch {
      addToast({ message: 'Re-infer failed.', variant: 'error' });
    } finally {
      setChannelWorking(false);
    }
  };

  const handleDismissDrift = async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      await useDismissChannelDrift({ requestId: crypto.randomUUID(), projectId });
    } catch {
      addToast({ message: 'Dismiss failed.', variant: 'error' });
    } finally {
      setChannelWorking(false);
    }
  };

  /**
   * Handle a lifecycle transition. Surfaces plan.required as an info toast
   * directing the user to the plan flow (US3-4 / US3-5).
   */
  const handleTransition = async (
    nextState: ProjectLifecycleState,
    actionLabel?: string,
  ) => {
    if (transitionWorking) return;
    setTransitionWorking(true);
    try {
      const resp = await useTransitionLifecycle(
        projectId,
        lifecycle as ProjectLifecycleState,
        nextState,
        actionLabel,
      );
      if (resp.status === 'success') {
        addToast({ message: `Project ${resp.newState ?? nextState}.`, variant: 'success' });
      } else if (resp.status === 'error' && isPlanRequiredError(resp.error?.code)) {
        addToast({
          message: 'A filesystem plan is required before this transition. Create or approve a plan first.',
          variant: 'info',
        });
      } else if (resp.status === 'error') {
        addToast({
          message: resp.error?.message ?? 'Transition refused.',
          variant: 'error',
        });
      }
    } catch {
      addToast({ message: 'Transition failed.', variant: 'error' });
    } finally {
      setTransitionWorking(false);
    }
  };

  /** Handle blocked resolve — dispatches the recovery edge from BlockedBanner. */
  const handleResolveBlocked = (edge: RecoveryEdge) => {
    void handleTransition(edge as ProjectLifecycleState, 'Resolved blocker');
  };

  // Derive contextual footer actions for the current lifecycle state.
  const footerActions = lifecycleFooterActions(lifecycle as ProjectLifecycleState);

  // Derive blocked reason from project (spec 009 US4-2).
  // The DB currently stores block_reason as a plain string. Until the BlockedReason
  // typed field is wired, we synthesize a 'user' reason from any available string.
  const blockedReason: BlockedReason | undefined =
    lifecycle === 'blocked'
      ? { kind: 'user', note: 'Project is blocked. Resolve to continue.' }
      : undefined;

  return (
    <DetailPane fill>
      <DetailHeader
        title={project.name}
        titleExtra={
          <Pill variant={projectStateVariant(lifecycle)}>
            {projectStateLabel(lifecycle)}
          </Pill>
        }
        subtitle={project.path}
        actions={
          lifecycle !== 'archived' && (
            <Btn size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
              Edit
            </Btn>
          )
        }
      />

      {/* Blocked banner (spec 009 US4-2) — shown above all other content */}
      {lifecycle === 'blocked' && blockedReason && (
        <BlockedBanner
          reason={blockedReason}
          onResolve={handleResolveBlocked}
          disabled={transitionWorking}
        />
      )}

      {/* Channel drift banner (US1c / US4) */}
      {project.channelDrift?.hasNewSources && (
        <Banner variant="warn" role="status" aria-live="polite">
          <span>New sources added since last channel review.</span>
          <div style={{ display: 'flex', gap: 'var(--alm-sp-2)', marginTop: 'var(--alm-sp-2)' }}>
            <Btn size="sm" variant="primary" onClick={handleReinfer} disabled={channelWorking}>
              Re-infer channels
            </Btn>
            <Btn size="sm" variant="ghost" onClick={handleDismissDrift} disabled={channelWorking}>
              Dismiss
            </Btn>
          </div>
        </Banner>
      )}

      <MetricLine
        metrics={[
          { value: project.sources.length, label: 'sources' },
          { value: project.channels?.length ?? 0, label: 'channels' },
          { value: toolLabel, label: 'tool' },
        ]}
      />

      <DetailGrid
        rail={
          <Rail>
            <RailCard title="Lifecycle">
              <Lifecycle state={lifecycle} />
            </RailCard>
            {project.channels && project.channels.length > 0 && (
              <RailCard title="Channels">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--alm-sp-1)' }}>
                  {project.channels.map((ch) => (
                    <span
                      key={ch.label}
                      title={ch.source === 'inferred' ? 'Auto-inferred' : 'Manually added'}
                      style={{
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 'var(--alm-text-xs)',
                        background: ch.source === 'inferred'
                          ? 'var(--alm-color-muted-bg)'
                          : 'var(--alm-color-accent-bg)',
                      }}
                    >
                      {ch.label}
                      {ch.source === 'inferred' && (
                        <span style={{ marginLeft: 4, opacity: 0.6, fontSize: '0.75em' }}>Auto</span>
                      )}
                    </span>
                  ))}
                </div>
              </RailCard>
            )}
          </Rail>
        }
      >
        {/* Sources section */}
        <Section title="Sources" count={project.sources.length}>
          {project.sources.length === 0 ? (
            <div style={{ padding: 'var(--alm-sp-2)', color: 'var(--alm-color-muted)' }}>
              No sources linked yet.
            </div>
          ) : (
            project.sources.map((src) => (
              <div
                key={src.inventoryId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--alm-sp-2)',
                  padding: 'var(--alm-sp-1) 0',
                  borderBottom: '1px solid var(--alm-border)',
                }}
              >
                {src.filter && (
                  <Pill variant={sourceTypeVariant(src.filter)}>{src.filter}</Pill>
                )}
                <span style={{ flex: 1 }}>{src.name || src.inventoryId}</span>
                {src.frames > 0 && (
                  <span style={{ color: 'var(--alm-color-muted)', fontSize: 'var(--alm-text-xs)' }}>
                    {src.frames} frames
                  </span>
                )}
              </div>
            ))
          )}
        </Section>

        {/* Notes section */}
        {project.notes && (
          <Section title="Notes">
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--alm-text-sm)' }}>
              {project.notes}
            </div>
          </Section>
        )}

        {/* spec 007 T034: calibration match panel — batch suggest for light sources */}
        <CalibrationMatchPanel
          sessionIds={project.sources.map((s) => s.inventoryId)}
        />
      </DetailGrid>

      {/* Lifecycle footer actions (spec 009 US3-3) */}
      {footerActions.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--alm-sp-2)',
            padding: 'var(--alm-sp-3) var(--alm-sp-4)',
            borderTop: '1px solid var(--alm-border)',
          }}
          data-testid="lifecycle-footer-actions"
        >
          {footerActions.map((action) => (
            <Btn
              key={action.nextState}
              size="sm"
              variant={action.variant}
              disabled={transitionWorking}
              onClick={() => void handleTransition(action.nextState, action.label)}
              data-testid={`transition-btn-${action.nextState}`}
            >
              {action.label}
            </Btn>
          ))}
        </div>
      )}

      {/* spec 011: Open in {tool} CTA */}
      {toolId && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--alm-sp-2)',
            padding: 'var(--alm-sp-3) var(--alm-sp-4)',
            borderTop: '1px solid var(--alm-border)',
          }}
          data-testid="tool-launch-footer"
        >
          <Btn
            size="sm"
            variant="primary"
            disabled={launchDisabledReason !== null || launchState.working}
            title={
              launchDisabledReason
                ? toolLaunchDisabledTooltip(launchDisabledReason)
                : `Open this project in ${projectToolStr}`
            }
            onClick={() => void launchTool()}
            data-testid="tool-launch-btn"
          >
            {launchState.working ? 'Launching…' : `Open in ${projectToolStr}`}
          </Btn>
          {launchDisabledReason === 'not_configured' && (
            <span
              style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}
            >
              Tool path not configured —{' '}
              <a href="#/settings?pane=tools" style={{ color: 'var(--alm-color-primary)' }}>
                Configure
              </a>
            </span>
          )}
        </div>
      )}

      {/* spec 011: Re-launch confirmation modal */}
      {launchState.priorInstanceAlive && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${projectToolStr} may already be running`}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 20,
          }}
          data-testid="relaunch-modal"
        >
          <div
            style={{
              background: 'var(--alm-surface)',
              border: '1px solid var(--alm-border)',
              borderRadius: '8px',
              padding: 'var(--alm-sp-6)',
              maxWidth: '360px',
              width: '100%',
            }}
          >
            <p style={{ marginBottom: 'var(--alm-sp-4)' }}>
              {projectToolStr} may already be open for this project. Open another instance?
            </p>
            <div style={{ display: 'flex', gap: 'var(--alm-sp-2)', justifyContent: 'flex-end' }}>
              <Btn size="sm" variant="ghost" onClick={dismissPriorWarning} data-testid="relaunch-cancel">
                Cancel
              </Btn>
              <Btn
                size="sm"
                variant="primary"
                onClick={() => void launchTool(true)}
                data-testid="relaunch-confirm"
              >
                Open another instance
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* Edit pane overlay */}
      {editOpen && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'var(--alm-surface)',
            zIndex: 10,
            overflow: 'auto',
          }}
        >
          <EditProjectPane project={project} onClose={() => setEditOpen(false)} />
        </div>
      )}
    </DetailPane>
  );
}
