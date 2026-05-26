import type { ReviewItem } from '@/bindings/types';
import { Box, KV, Pill, Btn } from '@/ui';
import { focusedSession } from '@/data/fixtures/review';

export interface EvidencePaneProps {
  item: ReviewItem | null;
}

/**
 * Center pane showing detailed session evidence for the active review item.
 * Displays:
 * - Session title + status pills + keyboard hints
 * - Blocking-reason banner
 * - 2-column grid: Session key (derived) | Equipment & site
 * - 2-column grid: Frames summary | Calibration match status
 *
 * Matches wireframe: review-queue.jsx focus pane.
 */
export function EvidencePane({ item }: EvidencePaneProps) {
  if (!item) {
    return (
      <div className="alm-evidence-pane alm-evidence-pane--empty">
        <p className="alm-evidence-pane__placeholder">
          Select an item from the queue to review.
        </p>
      </div>
    );
  }

  // For the wireframe fixture, use the detailed session data when viewing sess-7
  const detail = item.id === 'sess-7' ? focusedSession : null;
  const label = detail?.label
    ?? (item.suggested_target
      ? `${item.suggested_target}${item.suggested_filter ? ` · ${item.suggested_filter}` : ''}`
      : item.session_id ?? 'Unknown session');

  return (
    <div className="alm-evidence-pane">
      {/* Header row */}
      <div className="alm-evidence-pane__header">
        <div className="alm-evidence-pane__header-left">
          <h2 className="alm-evidence-pane__title">{label}</h2>
          <Pill label="NEEDS REVIEW" variant="warn" size="sm" />
          <Pill label="acquisition session" variant="ghost" size="sm" />
        </div>
        <span className="alm-evidence-pane__keys">
          ← K / J → · ⌘1 confirm · ⌘2 reject · ⌘S split
        </span>
      </div>

      {/* Subtitle */}
      <div className="alm-evidence-pane__subtitle alm-mono">
        {detail
          ? `${detail.frameCount} frames · ${detail.integrationHours}h integration · ${detail.opticalTrain} · derived from ${detail.frameCount} FITS files in ${detail.sourcePath}`
          : `Session ${item.session_id}`}
      </div>

      {/* Blocking banner */}
      {item.blocking_reasons.length > 0 && (
        <div className="alm-evidence-pane__blocking" role="alert">
          <div className="alm-evidence-pane__blocking-title">
            <span>⚠</span>Confirmation blocked
          </div>
          <div className="alm-evidence-pane__blocking-body">
            {item.blocking_reasons.map((reason, i) => (
              <span key={i}>
                {reason.includes('observer_location') ? (
                  <>
                    <span className="alm-mono">observer_location</span> needs reviewed provenance before this session can be marked confirmed. Currently inferred from FITS sitelong/sitelat headers.
                  </>
                ) : (
                  reason
                )}
              </span>
            ))}
          </div>
          <Btn size="sm" onClick={() => {}}>Review location →</Btn>
        </div>
      )}

      {/* Two-column grid: Session key + Equipment */}
      {detail && (
        <div className="alm-evidence-pane__grid-2">
          <Box heading="Session key (derived)">
            {detail.sessionKey.map((row) => (
              <KV key={row.k} label={row.k} value={row.v} origin={row.prov} />
            ))}
          </Box>

          <Box heading="Equipment & site">
            {detail.equipment.map((row) => (
              <KV
                key={row.k}
                label={row.k}
                value={
                  row.warn ? (
                    <span className="alm-text-warn">{row.v}</span>
                  ) : (
                    row.v
                  )
                }
                origin={row.prov}
                confidence={row.conf}
              />
            ))}
          </Box>
        </div>
      )}

      {/* Two-column grid: Frames summary + Calibration */}
      {detail && (
        <div className="alm-evidence-pane__grid-2">
          <Box heading={`Frames summary (${detail.frameCount})`}>
            <div className="alm-evidence-pane__frame-rows">
              {detail.framesSummary.map((row) => (
                <div key={row.label} className="alm-evidence-pane__frame-row">
                  <span className="alm-evidence-pane__frame-label">{row.label}</span>
                  <span
                    className={`alm-mono ${row.warn ? 'alm-text-warn' : ''}`}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            <Btn size="sm" onClick={() => {}}>View frame stats →</Btn>
          </Box>

          <Box heading="What about calibration?">
            <div className="alm-evidence-pane__cal-rows">
              {detail.calibrationMatches.map((match) => (
                <div key={match.label} className="alm-evidence-pane__cal-row">
                  <span
                    className={
                      match.status === 'none' ? 'alm-text-danger' : undefined
                    }
                  >
                    {match.label}
                  </span>
                  <Pill
                    label={match.pill}
                    variant={match.status === 'match' ? 'ok' : 'danger'}
                    size="sm"
                  />
                </div>
              ))}
            </div>
            {detail.calibrationNote && (
              <div className="alm-evidence-pane__cal-note">
                ⚠ {detail.calibrationNote}
              </div>
            )}
          </Box>
        </div>
      )}

      {/* Fallback for non-detailed items: show raw evidence */}
      {!detail && (
        <div className="alm-evidence-pane__grid-2" style={{ marginTop: 14 }}>
          <Box heading="Evidence">
            {Object.entries(item.evidence).map(([key, meta]) => (
              <KV
                key={key}
                label={key.replace(/_/g, ' ')}
                value={String(meta.value)}
                origin={meta.origin}
                confidence={meta.confidence}
              />
            ))}
          </Box>
        </div>
      )}
    </div>
  );
}
