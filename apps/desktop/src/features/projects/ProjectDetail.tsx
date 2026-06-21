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
  callDismissChannelDrift,
  callReinferChannels,
  callTransitionLifecycle,
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
// spec 024: project notes + manifests
import { ProjectNotesSection } from './ProjectNotesSection';
import { ManifestsAccordion } from './ManifestsAccordion';
// spec 026: generated source view removal
import { SourceViewsSection } from './SourceViewsSection';

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
        <div className="alm-project-detail__loading">
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
      await callReinferChannels({ requestId: crypto.randomUUID(), projectId });
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
      await callDismissChannelDrift({ requestId: crypto.randomUUID(), projectId });
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
      const resp = await callTransitionLifecycle(
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
    void handleTransition(edge, 'Resolved blocker');
  };

  // Derive contextual footer actions for the current lifecycle state.
  const footerActions = lifecycleFooterActions(lifecycle as ProjectLifecycleState);

  // Derive typed blocked reason from project DTO (FR-020 / spec 033 US5 T053).
  // `blockedReasonKind` is populated by project_health.rs emit_block_transition
  // and stored in `projects.blocked_reason_kind` (migration 0037).
  const blockedReason: BlockedReason | undefined = (() => {
    if (lifecycle !== 'blocked') return undefined;
    const kind = project.blockedReasonKind;
    const note = project.blockedReasonNote ?? undefined;
    if (kind === 'source_missing') {
      // Extract inventoryId from the note ("Source missing: <id>") or use note as-is.
      const inventoryId = note?.replace(/^Source missing:\s*/i, '') ?? 'unknown';
      return { kind: 'source_missing', inventoryId } satisfies BlockedReason;
    }
    if (kind === 'tool_unconfigured') {
      const tool = note?.replace(/^Tool path not configured:\s*/i, '') ?? 'unknown';
      return { kind: 'tool_unconfigured', tool } satisfies BlockedReason;
    }
    if (kind === 'calibration_unmatched') {
      return { kind: 'calibration_unmatched', calibrationSetId: note ?? 'unknown' } satisfies BlockedReason;
    }
    if (kind === 'prepared_source_stale') {
      return { kind: 'prepared_source_stale', preparedId: note ?? 'unknown' } satisfies BlockedReason;
    }
    // user reason or unknown kind: use the note as the message, or a generic fallback.
    return { kind: 'user', note: note ?? 'Blocked — check project status.' } satisfies BlockedReason;
  })();

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
          <div className="alm-project-detail__drift-actions">
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
            {/* spec 035 US1 #2: associated canonical target (resolved on the read path) */}
            {project.canonicalTarget && (
              <RailCard title="Target">
                <div
                  className="alm-project-detail__target-info"
                  data-testid="project-canonical-target"
                >
                  <span className="alm-project-detail__target-name">
                    {project.canonicalTarget.primaryDesignation}
                  </span>
                  {project.canonicalTarget.commonName && (
                    <span className="alm-project-detail__target-common">
                      {project.canonicalTarget.commonName}
                    </span>
                  )}
                </div>
              </RailCard>
            )}
            {project.channels && project.channels.length > 0 && (
              <RailCard title="Channels">
                <div className="alm-project-detail__channels">
                  {project.channels.map((ch) => (
                    <span
                      key={ch.label}
                      title={ch.source === 'inferred' ? 'Auto-inferred' : 'Manually added'}
                      className={ch.source === 'inferred'
                        ? 'alm-project-detail__channel-chip alm-project-detail__channel-chip--inferred'
                        : 'alm-project-detail__channel-chip alm-project-detail__channel-chip--manual'}
                    >
                      {ch.label}
                      {ch.source === 'inferred' && (
                        <span className="alm-project-detail__channel-auto">Auto</span>
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
            <div className="alm-project-detail__sources-empty">
              No sources linked yet.
            </div>
          ) : (
            project.sources.map((src) => (
              <div
                key={src.inventoryId}
                className="alm-project-detail__source-row"
              >
                {src.filter && (
                  <Pill variant={sourceTypeVariant(src.filter)}>{src.filter}</Pill>
                )}
                <span className="alm-project-detail__source-name">{src.name || src.inventoryId}</span>
                {src.frames > 0 && (
                  <span className="alm-project-detail__source-frames">
                    {src.frames} frames
                  </span>
                )}
              </div>
            ))
          )}
        </Section>

        {/* Notes section — spec 024 T4.2.
            project.notes is the creation-time inline field (legacy); the canonical
            per-project note is stored in the project_notes table and loaded via
            project.note.get / project.note.update. */}
        <ProjectNotesSection
          projectId={projectId}
          readOnly={lifecycle === 'archived'}
        />

        {/* Manifests accordion — spec 024 T1.7 / T3.4 */}
        <ManifestsAccordion projectId={projectId} />

        {/* Source views — spec 026 (remove/regenerate generated views) */}
        <SourceViewsSection projectId={projectId} />

        {/* spec 007 T034: calibration match panel — batch suggest for light sources */}
        <CalibrationMatchPanel
          sessionIds={project.sources.map((s) => s.inventoryId)}
        />
      </DetailGrid>

      {/* Lifecycle footer actions (spec 009 US3-3) */}
      {footerActions.length > 0 && (
        <div
          className="alm-project-detail__footer"
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
          className="alm-project-detail__footer alm-project-detail__footer--tool"
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
            data-guide-anchor="project.open-in-tool"
          >
            {launchState.working ? 'Launching…' : `Open in ${projectToolStr}`}
          </Btn>
          {launchDisabledReason === 'not_configured' && (
            <span className="alm-project-detail__tool-hint">
              Tool path not configured —{' '}
              <a href="#/settings?pane=tools" className="alm-project-detail__tool-link">
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
          className="alm-project-detail__modal-overlay"
          data-testid="relaunch-modal"
        >
          <div className="alm-project-detail__modal-card">
            <p className="alm-project-detail__modal-body">
              {projectToolStr} may already be open for this project. Open another instance?
            </p>
            <div className="alm-project-detail__modal-actions">
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
        <div className="alm-project-detail__edit-overlay">
          <EditProjectPane project={project} onClose={() => setEditOpen(false)} />
        </div>
      )}
    </DetailPane>
  );
}
