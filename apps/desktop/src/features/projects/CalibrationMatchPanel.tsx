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
 * Note: until `acquisition_fingerprint` rows are populated by the metadata
 * extraction pipeline, all sessions will return `observer_location_missing`
 * status. The panel handles this gracefully.
 */

import { useState, useEffect } from 'react';
import { Section, Pill, EmptyState } from '@/ui';
import type { PillVariant } from '@/ui';
import { calibrationMatchSuggestBatch } from '@/api/commands';
import type { BatchSessionResultDto, CalibrationMatchType } from '@/api/commands';
import { errMessage } from '@/lib/errors';
import { m } from '@/lib/i18n';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusVariant(status: string): PillVariant {
  switch (status) {
    case 'match': return 'ok';
    case 'ambiguous': return 'warn';
    case 'no_match': return 'neutral';
    case 'observer_location_missing': return 'neutral';
    case 'session.mixed_state': return 'warn';
    default: return 'neutral';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'match': return m.projects_calib_status_match();
    case 'ambiguous': return m.projects_calib_status_ambiguous();
    case 'no_match': return m.projects_calib_status_no_match();
    case 'observer_location_missing': return m.projects_calib_status_needs_location();
    case 'session.mixed_state': return m.projects_calib_status_mixed_session();
    default: return status;
  }
}

const CAL_TYPES: CalibrationMatchType[] = ['dark', 'flat', 'bias'];

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  sessionIds: string[];
  /** Whether the collapsible section starts open. Default true. */
  defaultOpen?: boolean;
}

export function CalibrationMatchPanel({ sessionIds, defaultOpen = true }: Props) {
  const [results, setResults] = useState<BatchSessionResultDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (sessionIds.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(undefined);

    calibrationMatchSuggestBatch({
      requestId: `batch-${Date.now()}`,
      sessionIds,
      calibrationTypes: CAL_TYPES,
    })
      .then((res) => {
        if (cancelled) return;
        setLoading(false);
        if (res.status === 'error') {
          setFetchError(res.errors?.[0]?.message ?? m.calibration_batch_suggest_failed());
          return;
        }
        setResults(res.results ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoading(false);
          setFetchError(errMessage(err));
        }
      });

    return () => { cancelled = true; };
  }, [sessionIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sessionIds.length === 0) {
    return null;
  }

  if (loading) {
    return (
      <Section title={m.projects_calib_readiness_title()} defaultOpen={defaultOpen}>
        <div
          className="alm-calib-match-panel__loading"
          data-testid="cal-panel-loading"
        >
          {m.projects_calib_checking()}
        </div>
      </Section>
    );
  }

  if (fetchError) {
    return (
      <Section title={m.projects_calib_readiness_title()} defaultOpen={defaultOpen}>
        <div
          className="alm-calib-match-panel__error"
          data-testid="cal-panel-error"
        >
          {fetchError}
        </div>
      </Section>
    );
  }

  if (results.length === 0) {
    return (
      <Section title={m.projects_calib_readiness_title()} defaultOpen={defaultOpen}>
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
    <Section title={m.projects_calib_readiness_title()} count={sessionIds.length} defaultOpen={defaultOpen} data-testid="cal-panel">
      <div className="alm-calib-match-panel__list">
        {[...bySession.entries()].map(([sid, typeResults]) => (
          <div
            key={sid}
            className="alm-calib-match-panel__session"
            data-testid={`cal-session-${sid}`}
          >
            <div className="alm-calib-match-panel__session-id">
              {sid.slice(0, 12)}…
            </div>
            <div className="alm-calib-match-panel__type-row">
              {typeResults.map((r) => {
                const topConfidence = r.candidates?.[0]?.confidence;
                return (
                  <div
                    key={r.calibrationType}
                    className="alm-calib-match-panel__type-item"
                    data-testid={`cal-type-${r.calibrationType}-${sid}`}
                  >
                    <Pill variant={r.calibrationType === 'dark' ? 'info' : r.calibrationType === 'flat' ? 'accent' : 'neutral'}>
                      {r.calibrationType}
                    </Pill>
                    <Pill variant={statusVariant(r.status)}>
                      {statusLabel(r.status)}
                    </Pill>
                    {topConfidence != null && (
                      <span
                        className="alm-mono alm-calib-match-panel__confidence"
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
      <div className="alm-calib-match-panel__hint">
        {m.projects_calib_assign_hint()}
      </div>
    </Section>
  );
}
