// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ProjectLifecycleStepper — spec 043 task #74.
 *
 * Replaces the vertical LIFECYCLE rail (Setup → Ready → Prepared → Processing →
 * Completed → Archived, plus NEXT and HISTORY rail cards) with a COMPACT
 * HORIZONTAL stepper rendered at the top of the detail pane. All stages are
 * kept; the current stage is highlighted and prior stages read as done. A
 * single next-action line sits beneath the chips, and project History collapses
 * into a small `ui/Section` instead of a standing rail card.
 *
 * Off-track ('blocked') projects get a trailing danger chip so the rail's prior
 * blocked marker is preserved in the horizontal form.
 *
 * Token-only styling via `.alm-stepper*` (new) + the shared `.alm-section`
 * collapsible. No inline styles.
 */

import { useSearch } from '@tanstack/react-router';
import { Section, Table, EmptyState, Skeleton, Pill } from '@/ui';
import { PROJECT_LIFECYCLE, projectStateIndex } from '@/lib/lifecycle';
import { m } from '@/lib/i18n';
import { formatDateTime } from '@/lib/datetime';
import { auditOutcomeVariant, auditOutcomeLabel } from '@/lib/audit-outcome';
import { useProjectHistory } from './store';

export interface ProjectLifecycleStepperProps {
  /**
   * Project id — scopes the audit-log query for the History section (#833).
   * Optional: the component's only mount point (`ProjectDetail.tsx:638`) is
   * off-limits while the #998 split is unmerged, so it isn't wired to pass
   * this explicitly yet. Falls back to the `/shell/projects` route's
   * `selected` search param — the same id source `ProjectDetail.tsx:176`
   * reads via `useProjectDetail(projectId)`. Follow-up: once #998 lands,
   * thread `projectId` through explicitly and drop the fallback.
   */
  projectId?: string;
  /** Stored project state (e.g. "processing", "setup_incomplete", "blocked"). */
  state: string;
  /** ISO creation timestamp (for the History collapsible). */
  createdAt: string;
  /** ISO updated timestamp (for the History collapsible). */
  updatedAt: string;
}

/** The single contextual next-action sentence for the current state. */
function nextActionText(state: string): string {
  switch (state) {
    case 'ready':
      return m.projects_stepper_next_ready();
    case 'prepared':
      return m.projects_stepper_next_prepared();
    case 'processing':
      return m.projects_stepper_next_processing();
    case 'completed':
      return m.projects_stepper_next_completed();
    case 'archived':
      return m.projects_stepper_next_archived();
    default:
      return m.projects_stepper_next_default();
  }
}

export function ProjectLifecycleStepper({
  projectId,
  state,
  createdAt,
  updatedAt,
}: ProjectLifecycleStepperProps) {
  const currentIdx =
    projectStateIndex[state as keyof typeof projectStateIndex] ?? -1;
  const isBlocked = state === 'blocked';
  const { selected: routeProjectId } = useSearch({ from: '/shell/projects' });
  const resolvedProjectId = projectId ?? routeProjectId;
  const {
    data: history,
    loading: historyLoading,
    error: historyError,
  } = useProjectHistory(resolvedProjectId);

  return (
    <div className="alm-stepper" data-testid="project-lifecycle-stepper">
      <ol className="alm-stepper__track" aria-label={m.projects_stepper_aria()}>
        {PROJECT_LIFECYCLE.map((step, i) => {
          const isDone = !isBlocked && i < currentIdx;
          const isCurrent = !isBlocked && i === currentIdx;
          const chipClass = [
            'alm-stepper__chip',
            isDone && 'alm-stepper__chip--done',
            isCurrent && 'alm-stepper__chip--active',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li
              key={step}
              className={chipClass}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {step}
            </li>
          );
        })}
        {isBlocked && (
          <li
            className="alm-stepper__chip alm-stepper__chip--blocked"
            aria-current="step"
          >
            {m.projects_stepper_blocked_chip()}
          </li>
        )}
      </ol>

      <p className="alm-stepper__next">{nextActionText(state)}</p>

      <Section title={m.projects_stepper_history_title()} defaultOpen={false}>
        <div className="alm-stepper__history">
          <div className="alm-stepper__history-row">
            {m.projects_stepper_created()}{' '}
            {new Date(createdAt).toLocaleDateString()}
          </div>
          <div className="alm-stepper__history-row">
            {m.projects_stepper_updated()}{' '}
            {new Date(updatedAt).toLocaleDateString()}
          </div>
        </div>

        {/* #833: the project's own lifecycle audit trail — transitions with
            from→to state, outcome, and actor, newest-first (backend-ordered,
            `ORDER BY at DESC`). Reuses the same `audit.list` query the
            archive feature runs for archived projects
            (`features/archive/store.ts` `useArchiveAudit`), filtered to this
            project's entity id, rather than a bespoke store. */}
        {historyLoading ? (
          <Skeleton count={3} label={m.common_loading()} />
        ) : historyError ? (
          <EmptyState title={m.projects_stepper_history_load_error()} />
        ) : !history || history.length === 0 ? (
          <EmptyState title={m.projects_stepper_history_empty()} />
        ) : (
          <Table
            columns={[
              {
                key: 'ts',
                label: m.archive_prop_date(),
                style: { width: 150 },
              },
              {
                key: 'stateChange',
                label: m.settings_auditlog_col_state_change(),
              },
              {
                key: 'outcome',
                label: m.settings_auditlog_col_outcome(),
                style: { width: 90 },
              },
              {
                key: 'actor',
                label: m.settings_auditlog_col_actor(),
                style: { width: 72 },
              },
            ]}
            rows={history.map((entry) => ({
              ts: (
                <span className="alm-mono">
                  {formatDateTime(entry.timestamp)}
                </span>
              ),
              stateChange:
                entry.fromState || entry.toState ? (
                  <span>
                    {entry.fromState ?? '—'} → {entry.toState ?? '—'}
                  </span>
                ) : (
                  entry.detail
                ),
              outcome: (
                <Pill variant={auditOutcomeVariant(entry.outcome)}>
                  {auditOutcomeLabel(entry.outcome)}
                </Pill>
              ),
              actor: <span className="alm-mono">{entry.actor}</span>,
            }))}
          />
        )}
      </Section>
    </div>
  );
}
