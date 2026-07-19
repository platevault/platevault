// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ProjectDetail — spec 008 wired, redesigned per PlateVault mock (2026-06-22).
 *
 * Layout (spec 043 task #74 — compact stepper replaces the vertical rail):
 *   DetailHeader            (title + state tag + Edit action)
 *   TopActionBar            (tool · path breadcrumb · Reveal · Open in {tool} · lifecycle actions)
 *   MetricLine              (integration · sources · channels · tool)
 *   ProjectLifecycleStepper (horizontal stage chips + next-action + History collapsible)
 *   Target block            (canonical target, when resolved)
 *   Sections (side column): Sources table · Channels palette
 *
 * Secondary/operational sections (Notes · Manifests · Calibration · Source
 * views · Outputs · Cleanup) live in ProjectBottomDetail, which renders in
 * the full-width bottom panel of the dual side+bottom layout (task #104).
 * They benefit from the horizontal room the bottom strip provides and were
 * collapsed by default in the narrow 420px side column.
 *
 * Per-project actions (Reveal · Open in {tool} · lifecycle
 * transitions) live ONLY in the detail action bar (data-testid="lifecycle-actions").
 * The transition buttons carry the data-testid="transition-btn-*" hooks. The
 * previous duplicate bottom footer was removed to de-duplicate these actions.
 *
 * Channels palette: `subFrames`/`totalIntegrationS` are aggregated server-side
 * (P7 — `ProjectChannelDto`, grouped by `filter_snapshot` over the project's
 * linked sources). `deriveChannels()` only adds the presentational `inSync`
 * flag (whether the channel is currently backed by a linked source with a
 * matching filter), which the API does not model.
 */

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { m } from '@/lib/i18n';
import { revealLabel } from '@/lib/reveal-label';
import { revealInOs } from '@/shared/native/reveal';
import { queryKeys } from '@/data/queryKeys';
import { queryClient as sharedQueryClient } from '@/data/queryClient';
import {
  DetailPane,
  DetailPanel,
  MetricLine,
  TopActionBar,
  renderValue,
} from '@/components';
import { ProjectLifecycleStepper } from './ProjectLifecycleStepper';
import { Pill, Btn, Section, Banner, CoverageBar, Table } from '@/ui';
import type { PillVariant } from '@/ui';
import { projectStateLabel, projectStateVariant } from '@/lib/lifecycle';
import { ProjectStatusTag } from './ProjectStatusTag';
import {
  useProjectDetail,
  useSessionNames,
  callDismissChannelDrift,
  callReinferChannels,
  callTransitionLifecycle,
} from './store';
import type { ProjectLifecycleState } from './store';
import { EditProjectPane } from './edit/EditProjectPane';
import { addToast } from '@/shared/toast';
import { BlockedBanner, deriveBlockedReason } from './BlockedBanner';
import type { BlockedReason, RecoveryEdge } from './BlockedBanner';
import {
  lifecycleFooterActions,
  isPlanRequiredError,
} from './lifecycle-actions';
import { useGenerateArchivePlan } from '@/features/archive/store';
import { PlanReviewOverlay } from '@/features/plans/PlanReviewOverlay';
// spec 011: tool launch CTA
import {
  toolIdFromProjectTool,
  toolLaunchDisabledReason,
  toolLaunchDisabledTooltip,
  useToolProfiles,
  useToolLaunch,
} from './tool-launch';
// spec 012 T008: filesystem artifact watcher, attached/detached with this
// drawer's own mount lifecycle.
import { useProjectArtifactWatcher } from './artifacts';
import type {
  ProjectChannelDto_Deserialize,
  ProjectSourceDto_Deserialize,
} from '@/bindings/index';
// Secondary sections (Notes, Manifests, Calibration, Source views, Outputs,
// Cleanup) have moved to ProjectBottomDetail (task #104 — bottom panel).

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

/**
 * Parse a source's `exposure` snapshot string (e.g. "300s", "1.5s") into
 * seconds. Mirrors the backend's `parse_exposure_seconds`
 * (crates/app/projects/src/project_setup.rs) — unparseable/empty values
 * degrade to 0 rather than throwing.
 */
function parseExposureSeconds(exposure: string): number {
  const trimmed = exposure.trim();
  if (!trimmed) return 0;
  const numeric = trimmed.endsWith('s') ? trimmed.slice(0, -1) : trimmed;
  const v = Number.parseFloat(numeric);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

// ── Channels palette ─────────────────────────────────────────────────────────

/**
 * Presentation-ready channel row. `totalFrames`/`totalIntegS` come straight
 * from the server-aggregated `ProjectChannelDto` (P7); only `inSync` is
 * derived client-side (the API has no notion of "backed by a current
 * source" — it just returns the channel list + its totals).
 */
interface DerivedChannel {
  label: string;
  filter: string;
  totalFrames: number;
  totalIntegS: number;
  inSync: boolean;
}

function deriveChannels(
  channels: ProjectChannelDto_Deserialize[],
  sources: ProjectSourceDto_Deserialize[],
): DerivedChannel[] {
  const sourceFilters = new Set(
    sources.filter((src) => src.filter).map((src) => src.filter.toUpperCase()),
  );

  return channels.map((ch) => ({
    label: ch.label,
    filter: ch.label,
    totalFrames: ch.subFrames,
    totalIntegS: ch.totalIntegrationS,
    inSync: sourceFilters.has(ch.label.toUpperCase()),
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
  // #663: resolve raw session UUIDs to the same human names Sessions shows.
  const sessionNames = useSessionNames();
  const [editOpen, setEditOpen] = useState(false);
  const [channelWorking, setChannelWorking] = useState(false);
  const [transitionWorking, setTransitionWorking] = useState(false);
  // Archive plan generation (spec 017 US2/WP-B) — the completed→archived
  // transition is plan-gated; this is the UI entry point that actually
  // creates the reviewable plan the toast below points the user to.
  const generateArchivePlan = useGenerateArchivePlan();
  const [archiveReviewPlanId, setArchiveReviewPlanId] = useState<string | null>(
    null,
  );
  // #603: diagnostic sentence for a 0-item archive plan, surfaced by
  // `archive.plan.generate` alongside the plan id — the review overlay has
  // no other way to explain WHY a plan came back empty.
  const [archiveEmptyReason, setArchiveEmptyReason] = useState<string | null>(
    null,
  );

  // spec 012 T008: attach the project's filesystem artifact watcher for as
  // long as this drawer is open; detaches on close/project switch.
  useProjectArtifactWatcher(projectId);

  // spec 011: tool launch (hooks must be called unconditionally)
  const projectToolStr = typeof project?.tool === 'string' ? project.tool : '';
  const toolId = projectToolStr ? toolIdFromProjectTool(projectToolStr) : '';
  const { profiles } = useToolProfiles();
  const toolProfile = profiles.find((p) => p.id === toolId);
  const {
    state: launchState,
    launch: launchTool,
    dismissPriorWarning,
  } = useToolLaunch(
    projectId,
    toolId,
    projectToolStr || 'tool',
    toolProfile?.supportsOpenFolder,
  );
  const launchDisabledReason = toolLaunchDisabledReason(toolProfile);

  if (loading && !project) {
    return (
      <DetailPane fill>
        <div className="alm-project-detail__loading">
          {m.projects_detail_loading()}
        </div>
      </DetailPane>
    );
  }

  if (error || !project) {
    return (
      <DetailPane fill>
        <Banner variant="danger">{m.projects_detail_load_error()}</Banner>
      </DetailPane>
    );
  }

  const toolLabel =
    typeof project.tool === 'string' ? project.tool : m.projects_tool_unknown();
  const lifecycle =
    typeof project.lifecycle === 'string'
      ? project.lifecycle
      : 'setup_incomplete';

  const handleReinfer = async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      await callReinferChannels({ requestId: crypto.randomUUID(), projectId });
    } catch {
      addToast({
        message: m.projects_toast_reinfer_failed(),
        variant: 'error',
      });
    } finally {
      setChannelWorking(false);
    }
  };

  const handleDismissDrift = async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      await callDismissChannelDrift({
        requestId: crypto.randomUUID(),
        projectId,
      });
    } catch {
      addToast({
        message: m.projects_toast_dismiss_failed(),
        variant: 'error',
      });
    } finally {
      setChannelWorking(false);
    }
  };

  /**
   * Handle a lifecycle transition. Surfaces plan.required as an info toast
   * directing the user to the plan flow (US3-4 / US3-5). For the
   * completed/blocked → archived edge specifically, a generator command
   * (`archive.plan.generate`) exists, so a refusal here also generates the
   * plan and opens the shared review/apply overlay — previously this edge
   * dead-ended on the toast with no way to actually create the plan.
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
        addToast({
          message: m.projects_toast_transitioned({
            state: resp.newState ?? nextState,
          }),
          variant: 'success',
        });
      } else if (
        resp.status === 'error' &&
        isPlanRequiredError(resp.error?.code)
      ) {
        addToast({
          message: m.projects_toast_plan_required(),
          variant: 'info',
        });
        if (nextState === 'archived') {
          void handleGenerateArchivePlan();
        }
      } else if (resp.status === 'error') {
        addToast({
          message: resp.error?.message ?? m.projects_toast_transition_refused(),
          variant: 'error',
        });
      }
    } catch {
      addToast({
        message: m.projects_toast_transition_failed(),
        variant: 'error',
      });
    } finally {
      setTransitionWorking(false);
    }
  };

  /**
   * Generate a reviewable whole-project archive plan (`archive.plan.generate`)
   * and open the shared {@link PlanReviewOverlay} for review + apply. This is
   * the ONLY UI entry point for the command — previously it had zero callers
   * and the flow only worked driven over the dev bridge.
   */
  const handleGenerateArchivePlan = async () => {
    try {
      const res = await generateArchivePlan.mutateAsync(projectId);
      addToast({
        message: m.projects_archive_plan_created_toast({
          count: res.itemCount,
        }),
        variant: 'info',
      });
      setArchiveEmptyReason(res.emptyReason ?? null);
      setArchiveReviewPlanId(res.planId);
    } catch {
      addToast({
        message: m.projects_archive_generate_failed(),
        variant: 'error',
      });
    }
  };

  /** After the archive plan applies, the project's lifecycle flips server-side
   * (C5 — applying an origin=archive plan is the one legitimate path to
   * `archived`); refresh the detail query so the UI reflects it. */
  const handleArchivePlanApplied = () => {
    void sharedQueryClient.invalidateQueries({
      queryKey: queryKeys.projects.detail(projectId),
    });
  };

  /** Handle blocked resolve — dispatches the recovery edge from BlockedBanner. */
  const handleResolveBlocked = (edge: RecoveryEdge) => {
    void handleTransition(edge, 'Resolved blocker');
  };

  /** Reveal the project folder in the OS file manager (spec 012 / native reveal). */
  const handleReveal = async () => {
    if (!project.path) return;
    try {
      await revealInOs(project.path, {
        entityKind: 'project_manifest',
        entityId: projectId,
      });
    } catch (err: unknown) {
      const msg =
        typeof err === 'string'
          ? err
          : ((err as Error)?.message ?? m.sessions_toast_reveal_error());
      addToast({ message: msg, variant: 'error' });
    }
  };

  // Derive contextual footer actions for the current lifecycle state.
  const footerActions = lifecycleFooterActions(
    lifecycle as ProjectLifecycleState,
  );

  // Derive typed blocked reason from project DTO (FR-020 / spec 033 US5 T053).
  const blockedReason: BlockedReason | undefined =
    lifecycle === 'blocked'
      ? deriveBlockedReason(
          project.blockedReasonKind,
          project.blockedReasonNote,
        )
      : undefined;

  // ── Derived channel palette data (server totals + client `inSync`) ────────
  const derivedChannels = deriveChannels(
    (project.channels ?? []) as ProjectChannelDto_Deserialize[],
    project.sources as ProjectSourceDto_Deserialize[],
  );
  const paletteLabel = paletteName(derivedChannels);
  const allInSync =
    derivedChannels.length > 0 && derivedChannels.every((c) => c.inSync);
  const maxFrames = Math.max(...derivedChannels.map((c) => c.totalFrames), 1);

  // ── Sources table ────────────────────────────────────────────────────────

  const sourceColumns = [
    {
      key: 'role',
      label: m.projects_col_role(),
      className: 'alm-project-detail__role-cell',
    },
    { key: 'source', label: m.projects_col_source() },
    { key: 'filter', label: m.common_filter() },
    {
      key: 'subs',
      label: m.projects_col_subs(),
      className: 'alm-project-detail__num-cell',
    },
    {
      key: 'integ',
      label: m.projects_col_integ(),
      className: 'alm-project-detail__integ-cell',
    },
  ];

  const sourceRows = project.sources.map((src) => {
    // #663: prefer the DTO name, then the Sessions-derived human name; raw
    // UUID is the last resort (matches Sessions page fallback ordering).
    const displayName =
      src.name || sessionNames.get(src.inventoryId) || src.inventoryId;
    const integS = src.frames * parseExposureSeconds(src.exposure);
    return {
      role: (
        <span className="alm-project-detail__role-cell">
          {renderValue(src.role ?? null, { applicability: 'applicable' })}
        </span>
      ),
      source: (
        // #720 FR-006/SC-002: click through to the source's Inventory
        // (Sessions) entry instead of rendering inert text.
        <a
          className="alm-project-detail__source-name"
          href={`#/sessions?selected=${encodeURIComponent(src.inventoryId)}`}
          data-testid={`project-source-link-${src.inventoryId}`}
        >
          {displayName}
        </a>
      ),
      // Project sources are light sessions (filter is applicable, data-model.md
      // matrix) — a missing filter is unresolved, not the same blank marker a
      // not-applicable field would use (spec-030 Q16 / FR-135).
      filter: src.filter ? (
        <Pill variant={sourceTypeVariant(src.filter)}>{src.filter}</Pill>
      ) : (
        renderValue(null, { applicability: 'applicable' })
      ),
      subs: (
        <span className="alm-project-detail__num-cell">
          {fmtFrames(src.frames)}
        </span>
      ),
      integ: (
        <span className="alm-project-detail__integ-cell">
          {fmtIntegS(integS)}
        </span>
      ),
    };
  });

  return (
    <DetailPanel
      fill
      title={project.name}
      titleExtra={
        <ProjectStatusTag variant={projectStateVariant(lifecycle)}>
          {projectStateLabel(lifecycle)}
        </ProjectStatusTag>
      }
      subtitle={undefined}
      actions={
        lifecycle !== 'archived' && (
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => setEditOpen(true)}
            data-testid="edit-project-btn"
          >
            {m.common_edit()}
          </Btn>
        )
      }
    >
      {/* ── Top action bar: tool · path · Reveal · Open in tool · CTA ───
          Wrapped in a project-detail scope so the breadcrumb (tool + path)
          and the action cluster lay out on their OWN rows and never overlap
          the MetricLine below (task #81). The shared bar's single fixed-height
          flex row is relaxed to auto-height + wrap only within this scope. */}
      <div className="alm-project-detail__action-bar">
        <TopActionBar
          title=""
          right={
            /* Per-project actions live ONLY here (the detail action bar):
             Reveal · Open in {tool} · lifecycle transitions.
             The transition buttons carry the data-testid="transition-btn-*"
             hooks (previously on a separate bottom footer that has been
             removed to de-duplicate the per-project actions). */
            <div
              className="alm-project-detail__bar-actions"
              data-testid="lifecycle-actions"
            >
              {/* Reveal — platform-native label (shared revealLabel()) */}
              <Btn
                size="sm"
                variant="ghost"
                data-testid="action-reveal"
                disabled={!project.path}
                onClick={() => void handleReveal()}
              >
                {revealLabel()}
              </Btn>

              {/* Open in processing tool */}
              {toolId && (
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={
                    launchDisabledReason !== null || launchState.working
                  }
                  title={
                    launchDisabledReason
                      ? toolLaunchDisabledTooltip(launchDisabledReason)
                      : m.projects_open_in_tool_title({ tool: projectToolStr })
                  }
                  onClick={() => void launchTool()}
                  data-testid="tool-launch-btn"
                  data-guide-anchor="project.open-in-tool"
                >
                  {launchState.working
                    ? m.projects_launching()
                    : m.projects_open_in({ tool: projectToolStr })}
                </Btn>
              )}

              {/* Lifecycle transitions — single source of truth for these actions. */}
              {footerActions.map((action) => (
                <Btn
                  key={action.nextState}
                  size="sm"
                  variant={action.variant}
                  disabled={transitionWorking}
                  onClick={() =>
                    void handleTransition(action.nextState, action.label)
                  }
                  data-testid={`transition-btn-${action.nextState}`}
                >
                  {action.label}
                </Btn>
              ))}
            </div>
          }
        >
          <span className="alm-project-detail__bar-tool">{toolLabel}</span>
          {project.path && (
            <span className="alm-project-detail__bar-path">{project.path}</span>
          )}
        </TopActionBar>
      </div>

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
          <span>{m.projects_detail_channel_drift()}</span>
          <div className="alm-project-detail__drift-actions">
            <Btn
              size="sm"
              variant="primary"
              onClick={handleReinfer}
              disabled={channelWorking}
            >
              {m.projects_detail_reinfer_btn()}
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              onClick={handleDismissDrift}
              disabled={channelWorking}
            >
              {m.projects_detail_dismiss_btn()}
            </Btn>
          </div>
        </Banner>
      )}

      {/* ── Metric line: consolidated single-row summary ──────────────────── */}
      <MetricLine
        metrics={[
          {
            value:
              derivedChannels.reduce((s, c) => s + c.totalIntegS, 0) > 0
                ? fmtIntegS(
                    derivedChannels.reduce((s, c) => s + c.totalIntegS, 0),
                  )
                : '—',
            label: m.projects_metric_integration(),
          },
          {
            value: project.sources.length,
            label: m.projects_metric_sources({ count: project.sources.length }),
          },
          {
            value: project.channels?.length ?? 0,
            label: m.projects_metric_channels({
              count: project.channels?.length ?? 0,
            }),
          },
          { value: toolLabel, label: m.projects_metric_tool() },
        ]}
      />

      {/* ── Compact lifecycle stepper (task #74) — replaces the vertical rail.
          Horizontal stage chips + next-action line + History collapsible. ── */}
      <ProjectLifecycleStepper
        state={lifecycle}
        createdAt={project.createdAt}
        updatedAt={project.updatedAt}
      />

      {/* spec 035 US1 #2: associated canonical target (resolved on read path).
          No longer a rail card — a compact inline block under the stepper.
          #738: links through to the Targets page with the target
          pre-selected, matching the Cmd+K / TargetsTable entry point. */}
      {project.canonicalTarget && (
        <Link
          to="/targets"
          search={{ selected: project.canonicalTarget.id }}
          className="alm-project-detail__target-info"
          data-testid="project-canonical-target"
        >
          <span className="alm-project-detail__target-label">
            {m.projects_create_target_label()}
          </span>
          <span className="alm-project-detail__target-name">
            {project.canonicalTarget.primaryDesignation}
          </span>
          {project.canonicalTarget.commonName && (
            <span className="alm-project-detail__target-common">
              {project.canonicalTarget.commonName}
            </span>
          )}
        </Link>
      )}

      <div className="alm-project-detail__sections">
        {/* ── Sources section ────────────────────────────────────────────── */}
        <Section title={m.common_sources()} count={project.sources.length}>
          {project.sources.length === 0 ? (
            <div className="alm-project-detail__sources-empty">
              {m.projects_sources_empty()}
            </div>
          ) : (
            <Table columns={sourceColumns} rows={sourceRows} />
          )}
        </Section>

        {/* ── Channels palette section (task #10) ──────────────────────────── */}
        {/*
         * subFrames/totalIntegS are server-aggregated (P7); derivedChannels
         * is a 1:1 presentational mapping of project.channels (see
         * deriveChannels() above).
         */}
        {derivedChannels.length > 0 && (
          <Section
            title={
              paletteLabel
                ? m.projects_channels_palette_title({
                    channels: m.projects_edit_channels_label(),
                    palette: paletteLabel,
                  })
                : m.projects_edit_channels_label()
            }
            right={
              allInSync ? (
                <Pill variant="ghost">{m.projects_channels_in_sync()}</Pill>
              ) : undefined
            }
          >
            <div className="alm-project-detail__channels-section">
              {derivedChannels.map((ch) => (
                <div key={ch.label} className="alm-project-detail__channel-row">
                  <span className="alm-project-detail__ch-letter">
                    {ch.label[0]}
                  </span>
                  <span className="alm-project-detail__ch-filter">
                    {ch.filter}
                  </span>
                  <div className="alm-project-detail__ch-coverage">
                    <CoverageBar
                      label=""
                      value={ch.totalFrames}
                      max={maxFrames}
                      unit=""
                    />
                  </div>
                  <span className="alm-project-detail__ch-subs">
                    {fmtFrames(ch.totalFrames)}
                  </span>
                  <span className="alm-project-detail__ch-integ">
                    {ch.totalIntegS > 0 ? fmtIntegS(ch.totalIntegS) : '—'}
                  </span>
                  <div className="alm-project-detail__ch-status">
                    <Pill variant={ch.inSync ? 'ghost' : 'warn'}>
                      {ch.inSync
                        ? m.projects_channels_in_sync()
                        : m.common_pending()}
                    </Pill>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Secondary sections (Notes · Manifests · Calibration · Source views ·
            Outputs · Cleanup) have moved to the bottom panel (ProjectBottomDetail,
            task #104). They benefit from the full-width horizontal room there and
            were collapsed by default in this narrow 420px column anyway. */}
      </div>

      {/* Lifecycle transition buttons now live in the detail action bar above
          (single source of truth) — the duplicate bottom footer was removed. */}

      {/* ── Tool-launch not-configured hint ─────────────────────────────── */}
      {launchDisabledReason === 'not_configured' && (
        <div
          className="alm-project-detail__footer alm-project-detail__footer--tool"
          data-testid="tool-launch-footer"
        >
          <span className="alm-project-detail__tool-hint">
            {m.projects_tool_not_configured()}{' '}
            <a
              href="#/settings?pane=tools"
              className="alm-project-detail__tool-link"
            >
              {m.projects_tool_configure_link()}
            </a>
          </span>
        </div>
      )}

      {/* ── spec 011: Re-launch confirmation modal ───────────────────────── */}
      {launchState.priorInstanceAlive && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={m.projects_tool_already_running_aria({
            tool: projectToolStr,
          })}
          className="alm-project-detail__modal-overlay"
          data-testid="relaunch-modal"
        >
          <div className="alm-project-detail__modal-card">
            <p className="alm-project-detail__modal-body">
              {m.projects_relaunch_body({ tool: projectToolStr })}
            </p>
            <div className="alm-project-detail__modal-actions">
              <Btn
                size="sm"
                variant="ghost"
                onClick={dismissPriorWarning}
                data-testid="relaunch-cancel"
              >
                {m.common_cancel()}
              </Btn>
              <Btn
                size="sm"
                variant="primary"
                onClick={() => void launchTool(true)}
                data-testid="relaunch-confirm"
              >
                {m.projects_relaunch_confirm_btn()}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit pane overlay ───────────────────────────────────────────── */}
      {editOpen && (
        <div className="alm-project-detail__edit-overlay">
          <EditProjectPane
            project={project}
            onClose={() => setEditOpen(false)}
          />
        </div>
      )}

      {/* ── Archive plan review overlay (spec 017 US2/WP-B) ──────────────────
          Opens automatically when the plan-gated Archive transition refuses
          with plan.required; shares the same review → approve → apply kit as
          the cleanup flow. */}
      <PlanReviewOverlay
        planId={archiveReviewPlanId}
        open={archiveReviewPlanId !== null}
        onClose={() => {
          setArchiveReviewPlanId(null);
          setArchiveEmptyReason(null);
        }}
        title={m.projects_archive_review_title()}
        emptyReason={archiveEmptyReason}
        onApplied={handleArchivePlanApplied}
        onRetryCreated={setArchiveReviewPlanId}
      />
    </DetailPanel>
  );
}
