/**
 * ProjectDetail — spec 008 wired, redesigned per PlateVault mock (2026-06-22).
 *
 * Layout:
 *   DetailHeader  (title + state pill + Edit action)
 *   TopActionBar  (tool · path breadcrumb · Reveal · Open in {tool} · primary lifecycle action)
 *   MetricLine    (integration · sources · channels · tool)
 *   DetailGrid
 *     primary: Sources table · Channels palette · Source views (clickable) ·
 *              Notes · Manifests · Generated source views · Calibration panel
 *     rail:    Lifecycle · Target · Next · History
 *
 * Lifecycle footer (data-testid="lifecycle-footer-actions") is preserved for
 * ALL footer action buttons — tests rely on transition-btn-* testids existing
 * in that container. The primary action is duplicated into the TopActionBar
 * without a testid so tests keep working against the footer.
 *
 * Channels palette: STUB — derives one row per unique filter from project
 * sources because ProjectChannelDto only carries label/source/addedAt.
 * A dedicated backend channel-mapping model with per-channel subs/integ is
 * planned; replace deriveChannels() once that lands.
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
  TopActionBar,
} from '@/components';
import { Pill, Btn, Section, Banner, CoverageBar, Table } from '@/ui';
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
import type { ProjectSourceDto_Deserialize } from '@/bindings/index';

// ── Helpers ──────────────────────────────────────────────────────────────────

function sourceTypeVariant(filter: string): PillVariant {
  const lower = filter.toLowerCase();
  if (lower === 'ha') return 'danger';
  if (lower === 'oiii') return 'info';
  if (lower === 'sii') return 'warn';
  if (lower === 'l' || lower === 'lum') return 'neutral';
  return 'ghost';
}

/** Convert raw seconds → "X.Xh" / "Xm" display string, or "—" for null/zero. */
function fmtIntegS(s: number | null | undefined): string {
  if (s == null || s === 0) return '—';
  const h = s / 3600;
  if (h >= 1) return `${h.toFixed(1)}h`;
  return `${Math.round(s / 60)}m`;
}

/** Format a frame count; returns "—" for zero. */
function fmtFrames(n: number): string {
  return n > 0 ? String(n) : '—';
}

// ── Channels palette (STUB) ──────────────────────────────────────────────────

/**
 * STUB: dedicated channel-mapping backend model pending — derived from source
 * filters. ProjectChannelDto only exposes label/source/addedAt; no per-channel
 * subs or integration totals are available from the current API.
 */
interface DerivedChannel {
  label: string;
  filter: string;
  totalFrames: number;
  totalIntegS: number;
  inSync: boolean;
}

function deriveChannels(
  sources: ProjectSourceDto_Deserialize[],
  projectChannelLabels: string[],
): DerivedChannel[] {
  const byFilter = new Map<string, { frames: number; integS: number }>();
  for (const src of sources) {
    if (!src.filter) continue;
    const key = src.filter.toUpperCase();
    const existing = byFilter.get(key) ?? { frames: 0, integS: 0 };
    existing.frames += src.frames;
    byFilter.set(key, existing);
  }

  const channelSet = new Set(projectChannelLabels.map((l) => l.toUpperCase()));

  return Array.from(byFilter.entries()).map(([filter, agg]) => ({
    label: filter,
    filter,
    totalFrames: agg.frames,
    totalIntegS: agg.integS,
    inSync: channelSet.has(filter),
  }));
}

/** Build a short palette name like "HOS" from channel labels. */
function paletteName(channels: DerivedChannel[]): string {
  return channels.map((c) => c.label[0] ?? c.label).join('');
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
  const blockedReason: BlockedReason | undefined = (() => {
    if (lifecycle !== 'blocked') return undefined;
    const kind = project.blockedReasonKind;
    const note = project.blockedReasonNote ?? undefined;
    if (kind === 'source_missing') {
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
    return { kind: 'user', note: note ?? 'Blocked — check project status.' } satisfies BlockedReason;
  })();

  // ── Derived channel palette data (STUB — see module comment) ─────────────
  const channelLabels = (project.channels ?? []).map((c) => c.label);
  const derivedChannels = deriveChannels(
    project.sources as ProjectSourceDto_Deserialize[],
    channelLabels,
  );
  const paletteLabel = paletteName(derivedChannels);
  const allInSync =
    derivedChannels.length > 0 && derivedChannels.every((c) => c.inSync);
  const maxFrames = Math.max(...derivedChannels.map((c) => c.totalFrames), 1);

  // Primary action for the top bar (visual only — no testid; footer has testids)
  const primaryAction = footerActions[0] ?? null;

  // ── Sources table ────────────────────────────────────────────────────────

  const sourceColumns = [
    { key: 'role',   label: 'ROLE',   className: 'alm-project-detail__role-cell' },
    { key: 'source', label: 'SOURCE' },
    { key: 'filter', label: 'FILTER' },
    { key: 'subs',   label: 'SUBS',  className: 'alm-project-detail__num-cell' },
    { key: 'integ',  label: 'INTEG', className: 'alm-project-detail__integ-cell' },
  ];

  const sourceRows = project.sources.map((src) => ({
    role: (
      <span className="alm-project-detail__role-cell">
        {src.role ?? <span className="alm-project-detail__dash">—</span>}
      </span>
    ),
    source: (
      <span className="alm-project-detail__source-name">
        {src.name || src.inventoryId}
      </span>
    ),
    filter: src.filter ? (
      <Pill variant={sourceTypeVariant(src.filter)}>{src.filter}</Pill>
    ) : (
      <span className="alm-project-detail__dash">—</span>
    ),
    subs: (
      <span className="alm-project-detail__num-cell">
        {fmtFrames(src.frames)}
      </span>
    ),
    integ: (
      <span className="alm-project-detail__integ-cell alm-project-detail__dash">—</span>
    ),
  }));

  return (
    <DetailPane fill>
      {/* ── Identity header ────────────────────────────────────────────── */}
      <DetailHeader
        title={project.name}
        titleExtra={
          <Pill variant={projectStateVariant(lifecycle)}>
            {projectStateLabel(lifecycle)}
          </Pill>
        }
        subtitle={undefined}
        actions={
          lifecycle !== 'archived' && (
            <Btn size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
              Edit
            </Btn>
          )
        }
      />

      {/* ── Top action bar: tool · path · Reveal · Open in tool · CTA ─── */}
      <TopActionBar
        title=""
        right={
          <>
            {/* Reveal */}
            <Btn size="sm" variant="ghost" data-testid="action-reveal">
              Reveal
            </Btn>

            {/* Open in processing tool */}
            {toolId && (
              <Btn
                size="sm"
                variant="ghost"
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
            )}

            {/* Primary lifecycle CTA — visual shortcut, footer keeps testids */}
            {primaryAction && (
              <Btn
                size="sm"
                variant={primaryAction.variant}
                disabled={transitionWorking}
                onClick={() => void handleTransition(primaryAction.nextState, primaryAction.label)}
              >
                {primaryAction.label}
              </Btn>
            )}
          </>
        }
      >
        <span className="alm-project-detail__bar-tool">{toolLabel}</span>
        {project.path && (
          <span className="alm-project-detail__bar-path">{project.path}</span>
        )}
      </TopActionBar>

      {/* ── Blocked banner (spec 009 US4-2) — above all content ──────────── */}
      {lifecycle === 'blocked' && blockedReason && (
        <BlockedBanner
          reason={blockedReason}
          onResolve={handleResolveBlocked}
          disabled={transitionWorking}
        />
      )}

      {/* ── Channel drift banner (US1c / US4) ────────────────────────────── */}
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

      {/* ── Metric line: consolidated single-row summary ──────────────────── */}
      <MetricLine
        metrics={[
          {
            value: derivedChannels.reduce((s, c) => s + c.totalIntegS, 0) > 0
              ? fmtIntegS(derivedChannels.reduce((s, c) => s + c.totalIntegS, 0))
              : '—',
            label: 'integration',
          },
          { value: project.sources.length, label: 'sources' },
          { value: project.channels?.length ?? 0, label: 'channels' },
          { value: toolLabel, label: 'tool' },
        ]}
      />

      <DetailGrid
        rail={
          <Rail>
            {/* Lifecycle stepper */}
            <RailCard title="Lifecycle">
              <Lifecycle state={lifecycle} />
            </RailCard>

            {/* spec 035 US1 #2: associated canonical target (resolved on read path) */}
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

            {/* Next action guide */}
            <RailCard title="Next">
              <p className="alm-project-detail__next-note">
                {lifecycle === 'ready' && 'Prepare sources and calibration masters before processing.'}
                {lifecycle === 'prepared' && 'Open in processing tool to begin integration.'}
                {lifecycle === 'processing' && 'Record an accepted output to complete the project.'}
                {lifecycle === 'completed' && 'Review cleanup candidates to reclaim disk space.'}
                {lifecycle === 'archived' && 'Project is archived. Unarchive to resume work.'}
                {(lifecycle === 'setup_incomplete' || lifecycle === 'blocked') &&
                  'Resolve any issues before proceeding.'}
              </p>
            </RailCard>

            {/* History */}
            <RailCard title="History">
              <div className="alm-project-detail__history-row">
                Created {new Date(project.createdAt).toLocaleDateString()}
              </div>
              <div className="alm-project-detail__history-row">
                Updated {new Date(project.updatedAt).toLocaleDateString()}
              </div>
            </RailCard>
          </Rail>
        }
      >
        {/* ── Sources section ────────────────────────────────────────────── */}
        <Section title="Sources" count={project.sources.length}>
          {project.sources.length === 0 ? (
            <div className="alm-project-detail__sources-empty">
              No sources linked yet.
            </div>
          ) : (
            <Table columns={sourceColumns} rows={sourceRows} />
          )}
        </Section>

        {/* ── Channels palette section (task #10) ──────────────────────────── */}
        {/*
         * STUB: dedicated channel-mapping backend model pending — derived from
         * source filters. ProjectChannelDto only carries label/source/addedAt;
         * no per-channel subs or integration totals exist in the current API.
         * Replace deriveChannels() once the backend model lands.
         */}
        {(derivedChannels.length > 0 || (project.channels?.length ?? 0) > 0) && (
          <Section
            title={paletteLabel ? `Channels — ${paletteLabel} palette` : 'Channels'}
            right={allInSync ? <Pill variant="ghost">in sync</Pill> : undefined}
          >
            <div className="alm-project-detail__channels-section">
              {derivedChannels.map((ch) => (
                <div key={ch.label} className="alm-project-detail__channel-row">
                  <span className="alm-project-detail__ch-letter">{ch.label[0]}</span>
                  <span className="alm-project-detail__ch-filter">{ch.filter}</span>
                  <div className="alm-project-detail__ch-coverage">
                    <CoverageBar label="" value={ch.totalFrames} max={maxFrames} />
                  </div>
                  <span className="alm-project-detail__ch-subs">{fmtFrames(ch.totalFrames)}</span>
                  <span className="alm-project-detail__ch-integ">
                    {ch.totalIntegS > 0 ? fmtIntegS(ch.totalIntegS) : '—'}
                  </span>
                  <div className="alm-project-detail__ch-status">
                    <Pill variant={ch.inSync ? 'ghost' : 'warn'}>
                      {ch.inSync ? 'in sync' : 'pending'}
                    </Pill>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Source views — project sources as clickable entries ──────────── */}
        {/*
         * Per user override: show project sources as clickable links to the
         * actual source (inventory session). Do NOT show junction/link-type
         * labels. Uses a simple tokenised list — no generated-view structure.
         */}
        {project.sources.length > 0 && (
          <Section title="Source views">
            <div className="alm-project-detail__sv-list">
              {project.sources.map((src) => (
                <div key={src.inventoryId} className="alm-project-detail__sv-row">
                  {src.role && (
                    <span className="alm-project-detail__sv-role">{src.role}</span>
                  )}
                  <a
                    href={`#/sessions/${src.inventoryId}`}
                    className="alm-project-detail__sv-name"
                    title={`Open source: ${src.name || src.inventoryId}`}
                  >
                    {src.name || src.inventoryId}
                  </a>
                  {src.filter && (
                    <Pill variant={sourceTypeVariant(src.filter)}>{src.filter}</Pill>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Notes section — spec 024 T4.2 ──────────────────────────────── */}
        {/* project.notes is the creation-time inline field (legacy); the
            canonical per-project note is stored in project_notes and loaded
            via project.note.get / project.note.update. */}
        <ProjectNotesSection
          projectId={projectId}
          readOnly={lifecycle === 'archived'}
        />

        {/* ── Manifests accordion — spec 024 T1.7 / T3.4 ─────────────────── */}
        <ManifestsAccordion projectId={projectId} />

        {/* ── Generated source views — spec 026 (remove/regenerate) ──────── */}
        <SourceViewsSection projectId={projectId} />

        {/* ── spec 007 T034: calibration match panel ──────────────────────── */}
        <CalibrationMatchPanel
          sessionIds={project.sources.map((s) => s.inventoryId)}
        />
      </DetailGrid>

      {/* ── Lifecycle footer (spec 009 US3-3) ────────────────────────────── */}
      {/* All transition buttons live here so data-testid="transition-btn-*"  */}
      {/* targets are always findable by tests regardless of bar layout.       */}
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

      {/* ── Tool-launch not-configured hint ─────────────────────────────── */}
      {launchDisabledReason === 'not_configured' && (
        <div
          className="alm-project-detail__footer alm-project-detail__footer--tool"
          data-testid="tool-launch-footer"
        >
          <span className="alm-project-detail__tool-hint">
            Tool path not configured —{' '}
            <a href="#/settings?pane=tools" className="alm-project-detail__tool-link">
              Configure
            </a>
          </span>
        </div>
      )}

      {/* ── spec 011: Re-launch confirmation modal ───────────────────────── */}
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

      {/* ── Edit pane overlay ───────────────────────────────────────────── */}
      {editOpen && (
        <div className="alm-project-detail__edit-overlay">
          <EditProjectPane project={project} onClose={() => setEditOpen(false)} />
        </div>
      )}
    </DetailPane>
  );
}
