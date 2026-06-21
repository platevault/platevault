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
              <Pill variant="ghost">{meta.confidence}</Pill>
            </div>
          ))}
        </div>
      </div>

      {/* Target link */}
      <div className="alm-session-inspector__section">
        <div className="alm-session-inspector__section-label">Target</div>
        <div className="alm-session-inspector-card">
          <div className="alm-session-inspector__target-name">
            {session.sessionKey.target} &rarr;
          </div>
          <div className="alm-session-inspector__target-subtitle">
            {session.targetIds.length} linked target{session.targetIds.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Calibration matches */}
      <div className="alm-session-inspector__section">
        <div className="alm-session-inspector__section-label">Calibration matches</div>
        {CAL_MATCHES.map((c, i) => (
          <div key={i} className="alm-session-inspector-card">
            <div className="alm-session-inspector__cal-header">
              <span className="alm-session-inspector__cal-kind">
                {c.kind} &rarr;
              </span>
              <span className="alm-mono alm-session-inspector__cal-score">
                {c.score.toFixed(2)}
              </span>
            </div>
            <div className="alm-session-inspector__cal-decision">
              {c.decision === 'accepted' ? (
                <Pill variant="ok">accepted</Pill>
              ) : (
                <Pill variant="warn">undecided</Pill>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Linked projects */}
      <div className="alm-session-inspector__section">
        <div className="alm-session-inspector__section-label">
          Projects ({session.projectIds.length})
        </div>
        {session.projectIds.length === 0 ? (
          <div className="alm-session-inspector__projects-empty">
            Not linked to any project
          </div>
        ) : (
          session.projectIds.map((pid) => (
            <div key={pid} className="alm-session-inspector-card">
              <div className="alm-session-inspector__project-label">{pid.slice(0, 16)} &rarr;</div>
            </div>
          ))
        )}
      </div>

      {/* Immutable note */}
      <div className="alm-session-inspector__immutable">
        <div className="alm-session-inspector__immutable-heading">
          Immutable
        </div>
        <div className="alm-session-inspector__immutable-body">
          Source identity is locked. Re-opening to review creates a new
          reviewed metadata record without rewriting history.
        </div>
      </div>
    </div>
  );
}
