// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CalibrationMatchPanel — spec 007 T034.
 *
 * Read-only "Suggested calibration" accordion on the project detail page.
 * Calls `calibration.match.suggest.batch` for all linked source session IDs
 * and renders a compact summary per (session, calibration type).
 *
 * This panel is intentionally read-only: assignment is done from the
 * Calibration page (CalibrationPage + MasterDetail). The panel gives the user
 * a project-scoped overview of calibration readiness.
 *
 * Respects `prefill_suggestion` setting for the Assign link, but defers the
 * actual assign action to the Calibration feature page — no assign call here.
 *
 * Note: sessions missing `acquisition_fingerprint` data return the
 * `match.observer_location_missing` status. The panel handles this
 * gracefully (issue #664 — status codes here are backend-prefixed, e.g.
 * `match.*` / `session.*`, and must be matched as such, not bare).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { Section, Pill, EmptyState } from '@/ui';
import type { PillVariant } from '@/ui';
import { calibrationMatchSuggestBatch } from './calibrationMatch';
import type { CalibrationMatchType } from './calibrationMatch';
import type { BatchSessionResultDto } from '@/bindings/index';
import { useEntityNames, entityNameKey } from '@/hooks/useEntityNames';
import { errMessage } from '@/lib/errors';
import { m } from '@/lib/i18n';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusVariant(status: string): PillVariant {
  switch (status) {
    case 'match':
      return 'ok';
    case 'ambiguous':
      return 'warn';
    case 'no_match':
      return 'neutral';
    case 'match.observer_location_missing':
      return 'neutral';
    case 'session.mixed_state':
      return 'warn';
    default:
      return 'neutral';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'match':
      return m.projects_calib_status_match();
    case 'ambiguous':
      return m.projects_calib_status_ambiguous();
    case 'no_match':
      return m.projects_calib_status_no_match();
    case 'match.observer_location_missing':
      return m.projects_calib_status_needs_location();
    case 'session.mixed_state':
      return m.projects_calib_status_mixed_session();
    default:
      return m.projects_calib_status_unknown();
  }
}

const CAL_TYPES: CalibrationMatchType[] = ['dark', 'flat', 'bias'];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  sessionIds: string[];
  /** Whether the collapsible section starts open. Default true. */
  defaultOpen?: boolean;
}

export function CalibrationMatchPanel({
  sessionIds,
  defaultOpen = true,
}: Props) {
  // Batch key is the joined session-id list — matches the `matches(sid)` key
  // shape while distinguishing one panel's session set from another's.
  const {
    data,
    isFetching: loading,
    error,
  } = useQuery({
    queryKey: queryKeys.calibration.matches(sessionIds.join(',')),
    queryFn: () =>
      calibrationMatchSuggestBatch({
        requestId: `batch-${Date.now()}`,
        sessionIds,
        calibrationTypes: CAL_TYPES,
      }),
    enabled: sessionIds.length > 0,
  });

  // Session id → human-readable name (#663, #809 — resolved via the shared
  // entity-name hook instead of a prop-drilled ad hoc map, so this panel and
  // Audit Log/Projects Sources use one resolver).
  const sessionRefs = useMemo(
    () => sessionIds.map((id) => ({ entityType: 'session', entityId: id })),
    [sessionIds],
  );
  const sessionNames = useEntityNames(sessionRefs);

  const fetchError =
    data?.status === 'error'
      ? (data.errors?.[0]?.message ?? m.calibration_batch_suggest_failed())
      : error
        ? errMessage(error)
        : undefined;
  const results: BatchSessionResultDto[] =
    data && data.status !== 'error' ? (data.results ?? []) : [];

  if (sessionIds.length === 0) {
    return null;
  }

  if (loading) {
    return (
      <Section
        title={m.projects_calib_readiness_title()}
        defaultOpen={defaultOpen}
      >
        <div
          className="pv-calib-match-panel__loading"
          data-testid="cal-panel-loading"
        >
          {m.projects_calib_checking()}
        </div>
      </Section>
    );
  }

  if (fetchError) {
    return (
      <Section
        title={m.projects_calib_readiness_title()}
        defaultOpen={defaultOpen}
      >
        <div
          className="pv-calib-match-panel__error"
          data-testid="cal-panel-error"
        >
          {fetchError}
        </div>
      </Section>
    );
  }

  if (results.length === 0) {
    return (
      <Section
        title={m.projects_calib_readiness_title()}
        defaultOpen={defaultOpen}
      >
        <EmptyState
          title={m.projects_calib_no_data_title()}
          desc={m.projects_calib_no_data_title()}
          data-testid="cal-panel-empty"
        />
      </Section>
    );
  }

  // Group results by sessionId for display.
  const bySession = new Map<string, BatchSessionResultDto[]>();
  for (const r of results) {
    const existing = bySession.get(r.sessionId) ?? [];
    existing.push(r);
    bySession.set(r.sessionId, existing);
  }

  return (
    <Section
      title={m.projects_calib_readiness_title()}
      count={sessionIds.length}
      defaultOpen={defaultOpen}
      data-testid="cal-panel"
    >
      <div className="pv-calib-match-panel__list">
        {[...bySession.entries()].map(([sid, typeResults]) => (
          <div
            key={sid}
            className="pv-calib-match-panel__session"
            data-testid={`cal-session-${sid}`}
          >
            <div className="pv-calib-match-panel__session-id">
              {sessionNames.get(
                entityNameKey({ entityType: 'session', entityId: sid }),
              ) ?? `${sid.slice(0, 12)}…`}
            </div>
            <div className="pv-calib-match-panel__type-row">
              {typeResults.map((r) => {
                const topConfidence = r.candidates?.[0]?.confidence;
                return (
                  <div
                    key={r.calibrationType}
                    className="pv-calib-match-panel__type-item"
                    data-testid={`cal-type-${r.calibrationType}-${sid}`}
                  >
                    <Pill
                      variant={
                        r.calibrationType === 'dark'
                          ? 'info'
                          : r.calibrationType === 'flat'
                            ? 'accent'
                            : 'neutral'
                      }
                    >
                      {r.calibrationType}
                    </Pill>
                    <Pill variant={statusVariant(r.status)}>
                      {statusLabel(r.status)}
                    </Pill>
                    {topConfidence != null && (
                      <span
                        className="pv-mono pv-calib-match-panel__confidence"
                        data-testid={`cal-confidence-${r.calibrationType}-${sid}`}
                      >
                        {Math.round(topConfidence * 100)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="pv-calib-match-panel__hint">
        {m.projects_calib_assign_hint()}
      </div>
    </Section>
  );
}
