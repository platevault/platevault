import type { AcquisitionSession } from '@/bindings/types';
import { Pill, Btn } from '@/ui';

/** Fixture calibration matches for the inspector sidebar */
const CAL_MATCHES = [
  { kind: 'Master Dark', score: 0.92, decision: 'accepted' as const },
  { kind: 'Master Flat', score: 0.88, decision: 'accepted' as const },
  { kind: 'Master Bias', score: 0.71, decision: 'undecided' as const },
];

interface SessionInspectorProps {
  session: AcquisitionSession;
  onConfirm?: () => void;
  onReject?: () => void;
  onSplit?: () => void;
  onMerge?: () => void;
  onUseInProject?: () => void;
}

export function SessionInspector({
  session,
  onConfirm,
  onReject,
  onSplit,
  onMerge,
  onUseInProject,
}: SessionInspectorProps) {
  return (
    <div className="alm-session-inspector">
      {/* Actions */}
      <div className="alm-session-inspector__section">
        <div className="alm-session-inspector__section-label">Actions</div>
        <div className="alm-session-inspector__actions">
          <Btn size="sm" onClick={onConfirm}>Confirm</Btn>
          <Btn size="sm" onClick={onReject}>Reject</Btn>
          <Btn size="sm" onClick={onSplit}>Split&hellip;</Btn>
          <Btn size="sm" onClick={onMerge}>Merge</Btn>
          <Btn size="sm" onClick={onUseInProject}>Use in project &rarr;</Btn>
        </div>
      </div>

      {/* Provenance summary */}
      <div className="alm-session-inspector__section">
        <div className="alm-session-inspector__section-label">Provenance</div>
        <div className="alm-session-inspector__provenance">
          {Object.entries(session.metadata).slice(0, 5).map(([key, meta]) => (
            <div key={key} className="alm-session-inspector__prov-row">
              <span className="alm-session-inspector__prov-key">{key}</span>
              <span className="alm-session-inspector__prov-origin">
                {meta.origin === 'reviewed' ? '●' : meta.origin === 'inferred' ? '◐' : '○'}
              </span>
              <Pill label={meta.confidence} variant="ghost" size="sm" />
            </div>
          ))}
        </div>
      </div>

      {/* Target link */}
      <div className="alm-session-inspector__section">
        <div className="alm-session-inspector__section-label">Target</div>
        <div className="alm-session-inspector-card">
          <div style={{ fontWeight: 600 }}>
            {session.session_key.target} &rarr;
          </div>
          <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
            {session.target_ids.length} linked target{session.target_ids.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Calibration matches */}
      <div className="alm-session-inspector__section">
        <div className="alm-session-inspector__section-label">Calibration matches</div>
        {CAL_MATCHES.map((c, i) => (
          <div key={i} className="alm-session-inspector-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, fontWeight: 500, fontSize: 'var(--alm-text-sm)' }}>
                {c.kind} &rarr;
              </span>
              <span
                className="alm-mono"
                style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-secondary)' }}
              >
                {c.score.toFixed(2)}
              </span>
            </div>
            <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
              {c.decision === 'accepted' ? (
                <Pill label="accepted" variant="ok" size="sm" />
              ) : (
                <Pill label="undecided" variant="warn" size="sm" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Linked projects */}
      <div className="alm-session-inspector__section">
        <div className="alm-session-inspector__section-label">
          Projects ({session.project_ids.length})
        </div>
        {session.project_ids.length === 0 ? (
          <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', padding: '4px 0' }}>
            Not linked to any project
          </div>
        ) : (
          session.project_ids.map((pid) => (
            <div key={pid} className="alm-session-inspector-card">
              <div style={{ fontWeight: 500 }}>{pid.slice(0, 16)} &rarr;</div>
            </div>
          ))
        )}
      </div>

      {/* Immutable note */}
      <div className="alm-session-inspector__immutable">
        <div style={{ fontWeight: 500, color: 'var(--alm-text-secondary)' }}>
          Immutable
        </div>
        <div style={{ marginTop: 3 }}>
          Source identity is locked. Re-opening to review creates a new
          reviewed metadata record without rewriting history.
        </div>
      </div>
    </div>
  );
}
