/**
 * MatchCandidatesPanel — spec 007 US1-US4.
 *
 * Renders the ranked calibration-match candidates for a given session,
 * returned by `calibration.match.suggest`. Shows:
 *   - Per-type suggest status badge (match / ambiguous / no_match / observer_location_missing)
 *   - Ranked candidates with confidence bar + dimension breakdown
 *   - Dimension-mismatch warnings (reason + delta)
 *   - Assign button (calls calibration.match.assign; handles hard-violation errors)
 *   - Respects `prefillSuggestion` to auto-open confirm prompt on top candidate
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-1)' }}>
      <div
        style={{
          width: 60,
          height: 6,
          background: 'var(--alm-surface-overlay)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: barColor,
            borderRadius: 3,
          }}
          data-testid="confidence-bar"
        />
      </div>
      <span className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)', minWidth: 32 }}>
        {confidencePct(value)}
      </span>
    </div>
  );
}

// ── Dimension breakdown (matched + mismatched) ────────────────────────────────

function DimensionBreakdown({ match }: { match: CalibrationMatchDto }) {
  const hasMismatches = match.dimensionsMismatched.length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {match.dimensionsMatched.map((d) => (
        <span
          key={d.dimension}
          style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-secondary)' }}
        >
          <Check
            size={12}
            role="img"
            aria-label="matched"
            style={{ color: 'var(--alm-ok)', display: 'inline', verticalAlign: 'middle' }}
          />{' '}
          {d.dimension}
          {d.delta != null && d.delta > 0 && (
            <span style={{ color: 'var(--alm-text-faint)' }}> (Δ{d.delta.toFixed(2)})</span>
          )}
        </span>
      ))}
      {hasMismatches &&
        match.dimensionsMismatched.map((d) => (
          <span
            key={d.dimension}
            style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-warn)' }}
            data-testid={`mismatch-${d.dimension}`}
          >
            <AlertTriangle
              size={12}
              aria-label="mismatch"
              style={{ display: 'inline', verticalAlign: 'middle' }}
            />{' '}
            {d.dimension}: {reasonLabel(d.reason)}
            {d.delta != null && (
              <span style={{ color: 'var(--alm-text-faint)' }}> (Δ{d.delta.toFixed(2)})</span>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-1)' }}>
        <div style={{ display: 'flex', gap: 'var(--alm-sp-1)' }}>
          <Btn
            size="sm"
            variant="primary"
            onClick={handleClick}
            disabled={assigning}
            data-testid="assign-confirm-btn"
          >
            {assigning ? 'Assigning…' : 'Confirm assign'}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={handleCancel} data-testid="assign-cancel-btn">
            Cancel
          </Btn>
        </div>
      </div>
    );
  }

  if (pending === 'override_confirm') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-sp-1)' }}>
        <span
          style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-warn)' }}
          data-testid="override-warning"
        >
          {errorMsg}
        </span>
        <div style={{ display: 'flex', gap: 'var(--alm-sp-1)' }}>
          <Btn
            size="sm"
            variant="danger"
            onClick={handleClick}
            disabled={assigning}
            data-testid="assign-override-btn"
          >
            Force-assign
          </Btn>
          <Btn size="sm" variant="ghost" onClick={handleCancel}>
            Cancel
          </Btn>
        </div>
        <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-faint)' }}>
          Violates: {overrideDims.join(', ')}
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
      Assign
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
      <Section title="Calibration suggestions">
        <div
          style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)', padding: 'var(--alm-sp-2)' }}
          data-testid="suggest-loading"
        >
          Loading suggestions…
        </div>
      </Section>
    );
  }

  if (error) {
    return (
      <Section title="Calibration suggestions">
        <Banner variant="danger" data-testid="suggest-error">
          Failed to load suggestions: {error}
        </Banner>
      </Section>
    );
  }

  if (!response) {
    return (
      <Section title="Calibration suggestions">
        <EmptyState title="No session selected" desc="Select a session to view suggestions." />
      </Section>
    );
  }

  if (response.status === 'error') {
    const code = response.error?.code ?? 'unknown';
    const isObserverMissing = code === 'match.observer_location_missing' || response.suggestStatus === 'observer_location_missing';
    return (
      <Section title="Calibration suggestions">
        <Banner variant="warn" data-testid="suggest-guard-error">
          {isObserverMissing
            ? 'Observer location or acquisition time is missing — cannot suggest calibration masters.'
            : response.error?.code === 'session.mixed_state'
              ? 'Session is mixed (light + dark frames). Split it before requesting calibration suggestions.'
              : `Suggestion error: ${response.error?.message ?? code}`}
        </Banner>
      </Section>
    );
  }

  const suggestStatus = response.suggestStatus ?? 'no_match';
  const matches = response.matches ?? [];

  if (suggestStatus === 'observer_location_missing') {
    return (
      <Section title="Calibration suggestions">
        <Banner variant="warn" data-testid="suggest-observer-missing">
          Observer location or acquisition time is missing — cannot suggest calibration masters.
        </Banner>
      </Section>
    );
  }

  if (suggestStatus === 'no_match' || matches.length === 0) {
    return (
      <Section title="Calibration suggestions">
        <EmptyState
          title="No compatible masters"
          desc="No calibration masters matched this session's fingerprint. Add masters or adjust matching tolerances in Settings → Calibration."
        />
      </Section>
    );
  }

  return (
    <Section
      title="Calibration suggestions"
      count={matches.length}
    >
      <div style={{ marginBottom: 'var(--alm-sp-1)', display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-1)' }}>
        <Pill variant={statusVariant(suggestStatus)} data-testid="suggest-status-pill">
          {statusLabel(suggestStatus)}
        </Pill>
        {suggestStatus === 'ambiguous' && (
          <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            Multiple candidates at similar confidence — review before assigning.
          </span>
        )}
      </div>
      <Table
        columns={[
          { key: 'rank', label: '#', style: { width: 28 } },
          { key: 'type', label: 'Type', style: { width: 56 } },
          { key: 'masterId', label: 'Master', style: { width: 160 } },
          { key: 'confidence', label: 'Confidence', style: { width: 120 } },
          { key: 'reason', label: 'Selection', style: { width: 110 } },
          { key: 'dimensions', label: 'Dimensions' },
          { key: 'assign', label: '', style: { width: 120 } },
        ]}
        rows={matches.map((m, i) => ({
          rank: (
            <span className="alm-mono" style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-faint)' }}>
              {i + 1}
            </span>
          ),
          type: <Pill variant={m.calibrationType === 'dark' ? 'info' : m.calibrationType === 'flat' ? 'accent' : 'neutral'}>{m.calibrationType}</Pill>,
          masterId: (
            <span
              className="alm-mono"
              style={{ fontSize: 'var(--alm-text-xs)' }}
              data-testid={`candidate-master-${m.masterId}`}
            >
              {m.masterId.slice(0, 8)}…
            </span>
          ),
          confidence: <ConfidenceBar value={m.confidence} />,
          reason: (
            <span style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-secondary)' }}>
              {m.selectionReason.replace(/_/g, ' ')}
            </span>
          ),
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
