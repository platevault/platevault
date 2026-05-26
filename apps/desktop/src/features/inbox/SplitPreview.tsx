/**
 * T051 — SplitPreview: shown when the user clicks Split.
 *
 * Lists conflicting properties, shows resulting session count,
 * and provides Confirm/Cancel buttons. Uses the shared ConfirmOverlay.
 */

import { useMemo } from 'react';
import { Pill } from '@/ui';
import { ConfirmOverlay } from '@/components';
import { detectConflicts } from './conflict-detection';
import { toFrameProperties } from './mock-data';
import type { InboxSession } from './mock-data';

export interface SplitPreviewProps {
  open: boolean;
  session: InboxSession;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SplitPreview({
  open,
  session,
  onConfirm,
  onCancel,
}: SplitPreviewProps) {
  const conflicts = useMemo(
    () => detectConflicts(toFrameProperties(session)),
    [session],
  );

  const resultingSessions = useMemo(() => {
    let count = 1;
    if (conflicts.mixedGains) count += 1;
    if (conflicts.mixedFilters) count += 1;
    if (conflicts.exposureOutOfTolerance) count += 1;
    if (conflicts.temperatureOutOfTolerance) count += 1;
    return Math.min(count, session.frameCount);
  }, [conflicts, session.frameCount]);

  return (
    <ConfirmOverlay
      open={open}
      onClose={onCancel}
      onConfirm={onConfirm}
      title="Split Session"
      description={`This will split "${session.object}" into ${resultingSessions} sessions based on detected conflicts.`}
      confirmLabel="Split"
    >
      <div className="alm-split-preview">
        {/* Conflict list */}
        <div className="alm-split-preview__section">
          <h4 className="alm-split-preview__heading">Conflicting Properties</h4>
          {conflicts.hasConflicts ? (
            <ul className="alm-split-preview__list">
              {conflicts.details.map((detail) => (
                <li key={detail} className="alm-split-preview__item">
                  <Pill label="Conflict" variant="warn" size="sm" />
                  <span className="alm-split-preview__detail">{detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="alm-split-preview__no-conflicts">
              No conflicts detected. Split will create sub-sessions based on
              frame grouping.
            </p>
          )}
        </div>

        {/* Result summary */}
        <div className="alm-split-preview__section">
          <h4 className="alm-split-preview__heading">Result</h4>
          <div className="alm-split-preview__result">
            <span className="alm-split-preview__result-label">
              Resulting sessions:
            </span>
            <span className="alm-split-preview__result-value">
              {resultingSessions}
            </span>
          </div>
          <div className="alm-split-preview__result">
            <span className="alm-split-preview__result-label">
              Total frames:
            </span>
            <span className="alm-split-preview__result-value">
              {session.frameCount}
            </span>
          </div>
        </div>
      </div>
    </ConfirmOverlay>
  );
}
