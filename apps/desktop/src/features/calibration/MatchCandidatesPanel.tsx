/**
 * MatchCandidatesPanel — spec 007 US1-US4 · spec 043 §4 (calibration hero).
 *
 * The DETAIL hero for a calibration master: a COMPATIBLE-SESSIONS MATCH TABLE —
 * which acquisition sessions this master can calibrate, ranked by match
 * confidence. Data comes from `calibration.match.suggest`; each row is one
 * candidate session (`CalibrationMatchDto`). Shows:
 *   - Per-type suggest status badge (match / ambiguous / no_match / observer_location_missing)
 *   - Session-oriented columns: Target · Filter · Night · Frames · Confidence
 *   - Dimension-mismatch warnings (reason + delta)
 *   - Assign button (calls calibration.match.assign; handles hard-violation errors)
 *   - Respects `prefillSuggestion` to auto-open confirm prompt on top candidate
 *   - Humanized empty state when no sessions match.
 *
 * Target / Filter / Night / Frames are NOT carried on the suggest DTO
 * (`CalibrationMatchDto` only has sessionId + confidence + dimension breakdown);
 * those cells are marked `// STUB:` until the backend enriches the contract.
 *
 * No Playwright/visual smoke tests — jsdom unit-tested in MatchCandidatesPanel.test.tsx.
 */

import { useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { Section, Table, Pill, EmptyState, Banner, Btn } from '@/ui';
import type { PillVariant } from '@/ui';
import type {
  CalibrationMatchDto,
  CalibrationMatchSuggestResponse,
  SuggestStatus,
  MismatchReason,
} from '@/api/commands';
import { m } from '@/lib/i18n';

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusVariant(status: SuggestStatus | string): PillVariant {
  switch (status) {
    case 'match': return 'ok';
    case 'ambiguous': return 'warn';
    case 'no_match': return 'neutral';
    case 'observer_location_missing': return 'warn';
    default: return 'neutral';
  }
}

function statusLabel(status: SuggestStatus | string): string {
  switch (status) {
    case 'match': return 'match';
    case 'ambiguous': return 'ambiguous';
    case 'no_match': return 'no match';
    case 'observer_location_missing': return 'location missing';
    default: return status;
  }
}

function reasonLabel(reason: MismatchReason): string {
  switch (reason) {
    case 'out_of_tolerance': return 'out of tolerance';
    case 'metadata_missing': return 'metadata missing';
    case 'hard_rule_violation': return 'hard rule violation';
    default: return reason;
  }
}

function _mismatchVariant(reason: MismatchReason): PillVariant {
  return reason === 'hard_rule_violation' ? 'danger' : 'warn';
}

function confidencePct(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

// ── Confidence bar ────────────────────────────────────────────────────────────

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const barColor =
    pct >= 90 ? 'var(--alm-ok)' : pct >= 70 ? 'var(--alm-warn)' : 'var(--alm-danger)';
  return (
    <div className="alm-match-candidates__conf-bar">
      <div className="alm-match-candidates__conf-track">
        <div
          className="alm-match-candidates__conf-fill"
          // eslint-disable-next-line no-restricted-syntax -- dynamic: confidence bar width % and conditional token color
          style={{ width: `${pct}%`, background: barColor }}
          data-testid="confidence-bar"
        />
      </div>
      <span className="alm-mono alm-match-candidates__conf-label">
        {confidencePct(value)}
      </span>
    </div>
  );
}

// ── Dimension breakdown (matched + mismatched) ────────────────────────────────

function DimensionBreakdown({ match }: { match: CalibrationMatchDto }) {
  const hasMismatches = match.dimensionsMismatched.length > 0;
  return (
    <div className="alm-match-candidates__dim-list">
      {match.dimensionsMatched.map((d) => (
        <span
          key={d.dimension}
          className="alm-match-candidates__dim-matched"
        >
          <Check
            size={12}
            role="img"
            aria-label={m.calibration_dim_matched_aria()}
            className="alm-match-candidates__dim-check"
          />{' '}
          {d.dimension}
          {d.delta != null && d.delta > 0 && (
            // eslint-disable-next-line alm/no-user-string -- mathematical delta notation, not translatable prose
            <span className="alm-match-candidates__dim-delta"> (Δ{d.delta.toFixed(2)})</span>
          )}
        </span>
      ))}
      {hasMismatches &&
        match.dimensionsMismatched.map((d) => (
          <span
            key={d.dimension}
            className="alm-match-candidates__dim-mismatch"
            data-testid={`mismatch-${d.dimension}`}
          >
            <AlertTriangle
              size={12}
              aria-label={m.calibration_dim_mismatch_aria()}
              className="alm-match-candidates__dim-mismatch-icon"
            />{' '}
            {d.dimension}: {reasonLabel(d.reason)}
            {d.delta != null && (
              // eslint-disable-next-line alm/no-user-string -- mathematical delta notation, not translatable prose
              <span className="alm-match-candidates__dim-delta"> (Δ{d.delta.toFixed(2)})</span>
            )}
          </span>
        ))}
    </div>
  );
}

// ── Assign button + dialog ────────────────────────────────────────────────────

interface AssignButtonProps {
  match: CalibrationMatchDto;
  sessionId: string;
  onAssign: (masterId: string, override: boolean) => Promise<{ status: string; error?: { code: string; message: string; details?: { dimensions: string[] } } }>;
  assigning: boolean;
  prefill: boolean;
}

function AssignButton({ match, sessionId: _sessionId, onAssign, assigning, prefill }: AssignButtonProps) {
  const [pending, setPending] = useState<'idle' | 'confirming' | 'override_confirm'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | undefined>(undefined);
  const [overrideDims, setOverrideDims] = useState<string[]>([]);

  const handleClick = async () => {
    if (pending === 'confirming' || pending === 'override_confirm') {
      // Already in confirm state — do the actual assign
      const isOverride = pending === 'override_confirm';
      const res = await onAssign(match.masterId, isOverride);
      if (res.status === 'success') {
        setPending('idle');
        setErrorMsg(undefined);
      } else if (res.error?.code === 'incompatible.dimensions') {
        // First attempt without override hit hard rules; ask for override confirm
        const dims = res.error.details?.dimensions ?? [];
        setOverrideDims(dims);
        setPending('override_confirm');
        setErrorMsg(`Hard-rule mismatch: ${dims.join(', ')}. Confirm to force-assign.`);
      } else {
        setPending('idle');
        setErrorMsg(res.error?.message ?? 'Assignment failed');
      }
      return;
    }

    // First click: pre-fill or prompt
    if (prefill) {
      setPending('confirming');
    } else {
      setPending('confirming');
    }
  };

  const handleCancel = () => {
    setPending('idle');
    setErrorMsg(undefined);
  };

  if (pending === 'confirming') {
    return (
      <div className="alm-match-candidates__assign-col">
        <div className="alm-match-candidates__assign-row">
          <Btn
            size="sm"
            variant="primary"
            onClick={handleClick}
            disabled={assigning}
            data-testid="assign-confirm-btn"
          >
            {assigning ? m.calibration_assign_assigning() : m.calibration_assign_confirm_btn()}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={handleCancel} data-testid="assign-cancel-btn">
            {m.common_cancel()}
          </Btn>
        </div>
      </div>
    );
  }

  if (pending === 'override_confirm') {
    return (
      <div className="alm-match-candidates__assign-col">
        <span
          className="alm-match-candidates__override-warning"
          data-testid="override-warning"
        >
          {errorMsg}
        </span>
        <div className="alm-match-candidates__assign-row">
          <Btn
            size="sm"
            variant="danger"
            onClick={handleClick}
            disabled={assigning}
            data-testid="assign-override-btn"
          >
            {m.calibration_assign_force_btn()}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={handleCancel}>
            {m.common_cancel()}
          </Btn>
        </div>
        <div className="alm-match-candidates__override-dims">
          {m.calibration_assign_violates({ dims: overrideDims.join(', ') })}
        </div>
      </div>
    );
  }

  return (
    <Btn
      size="sm"
      variant="ghost"
      onClick={handleClick}
      data-testid={`assign-btn-${match.masterId}`}
    >
      {m.calibration_assign_btn()}
    </Btn>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export interface MatchCandidatesPanelProps {
  sessionId: string;
  response: CalibrationMatchSuggestResponse | undefined;
  loading: boolean;
  error: string | undefined;
  onAssign: (masterId: string, override: boolean) => Promise<{ status: string; error?: { code: string; message: string; details?: { dimensions: string[] } } }>;
  assigning: boolean;
  prefillSuggestion: boolean;
}

export function MatchCandidatesPanel({
  sessionId,
  response,
  loading,
  error,
  onAssign,
  assigning,
  prefillSuggestion,
}: MatchCandidatesPanelProps) {
  if (loading) {
    return (
      <Section title={m.calibration_compatible_sessions_title()}>
        <div
          className="alm-match-candidates__loading"
          data-testid="suggest-loading"
        >
          {m.calibration_compatible_sessions_loading()}
        </div>
      </Section>
    );
  }

  if (error) {
    return (
      <Section title={m.calibration_compatible_sessions_title()}>
        <Banner variant="danger" data-testid="suggest-error">
          {m.calibration_compatible_sessions_error({ error })}
        </Banner>
      </Section>
    );
  }

  if (!response) {
    return (
      <Section title={m.calibration_compatible_sessions_title()}>
        <EmptyState title={m.calibration_compatible_sessions_no_selection_title()} desc={m.calibration_compatible_sessions_no_selection_desc()} />
      </Section>
    );
  }

  if (response.status === 'error') {
    const code = response.error?.code ?? 'unknown';
    // A missing anchor session is benign for a master view (a master has no
    // originating light session to match against) — show a neutral empty state
    // rather than a raw "Session … not found" error.
    if (code === 'session.not_found') {
      return (
        <Section title={m.calibration_compatible_sessions_title()}>
          <EmptyState
            title={m.calibration_compatible_sessions_none_title()}
            desc={m.calibration_compatible_sessions_no_anchor_desc()}
          />
        </Section>
      );
    }
    const isObserverMissing = code === 'match.observer_location_missing' || response.suggestStatus === 'observer_location_missing';
     
    const isMixedState = response.error?.code === 'session.mixed_state';
    const guardMessage = isObserverMissing
      ? m.calibration_observer_missing_guard()
      : isMixedState
        ? m.calibration_session_mixed_state()
        : m.calibration_suggest_error({ message: response.error?.message ?? code });
    return (
      <Section title={m.calibration_compatible_sessions_title()}>
        <Banner variant="warn" data-testid="suggest-guard-error">
          {guardMessage}
        </Banner>
      </Section>
    );
  }

  const suggestStatus = response.suggestStatus ?? 'no_match';
  const matches = response.matches ?? [];

  if (suggestStatus === 'observer_location_missing') {
    return (
      <Section title={m.calibration_compatible_sessions_title()}>
        <Banner variant="warn" data-testid="suggest-observer-missing">
          {m.calibration_observer_missing_match()}
        </Banner>
      </Section>
    );
  }

  if (suggestStatus === 'no_match' || matches.length === 0) {
    return (
      <Section title={m.calibration_compatible_sessions_title()}>
        <EmptyState
          title={m.calibration_compatible_sessions_none_title()}
          desc={m.calibration_compatible_sessions_none_desc()}
        />
      </Section>
    );
  }

  return (
    <Section
      title={m.calibration_compatible_sessions_title()}
      count={matches.length}
    >
      <div className="alm-match-candidates__status-row">
        <Pill variant={statusVariant(suggestStatus)} data-testid="suggest-status-pill">
          {statusLabel(suggestStatus)}
        </Pill>
        { }
        {suggestStatus === 'ambiguous' && (
          <span className="alm-match-candidates__ambiguous-hint">
            {m.calibration_ambiguous_hint()}
          </span>
        )}
      </div>
      <Table
        columns={[
          { key: 'session', label: m.calibration_col_session(), style: { width: 150 } },
          { key: 'target', label: m.projects_create_target_label(), style: { width: 130 } },
          { key: 'filter', label: m.common_filter(), style: { width: 64 } },
          { key: 'night', label: m.sessions_col_night(), style: { width: 100 } },
          { key: 'frames', label: m.projects_wizard_col_frames(), style: { width: 64 } },
          { key: 'confidence', label: m.calibration_col_match(), style: { width: 120 } },
          { key: 'dimensions', label: m.calibration_col_dimensions() },
          { key: 'assign', label: '', style: { width: 120 } },
        ]}
        rows={matches.map((m) => ({
          session: (
            <span
              className="alm-mono alm-match-candidates__session-id"
              data-testid={`candidate-session-${m.sessionId}`}
            >
              {m.sessionId.slice(0, 12)}
              {m.sessionId.length > 12 ? '…' : ''}
            </span>
          ),
          // STUB: target name not on CalibrationMatchDto (suggest contract).
          // Backend enrichment needed to resolve sessionId → target.
          target: <span className="alm-match-candidates__stub-cell">—</span>,
          // STUB: filter not on CalibrationMatchDto. Backend enrichment needed.
          filter: <span className="alm-match-candidates__stub-cell">—</span>,
          // STUB: acquisition night not on CalibrationMatchDto. Backend enrichment needed.
          night: <span className="alm-match-candidates__stub-cell">—</span>,
          // STUB: frame count not on CalibrationMatchDto. Backend enrichment needed.
          frames: <span className="alm-match-candidates__stub-cell">—</span>,
          confidence: <ConfidenceBar value={m.confidence} />,
          dimensions: <DimensionBreakdown match={m} />,
          assign: (
            <AssignButton
              match={m}
              sessionId={sessionId}
              onAssign={onAssign}
              assigning={assigning}
              prefill={prefillSuggestion}
            />
          ),
        }))}
      />
    </Section>
  );
}
