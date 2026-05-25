import type { ReviewItem } from '@/bindings/types';
import { Btn } from '@/ui';
import { queueProgress } from '@/data/fixtures/review';

export interface DecisionPanelProps {
  item: ReviewItem | null;
  onDecision: (action: 'confirm' | 'reject' | 'skip') => void;
}

/**
 * Right pane with lifecycle decision buttons, correction actions,
 * notes textarea, and queue progress bar.
 *
 * Matches wireframe: review-queue.jsx decision panel.
 */
export function DecisionPanel({ item, onDecision }: DecisionPanelProps) {
  if (!item) {
    return (
      <div className="alm-decision-panel">
        <p className="alm-decision-panel__placeholder">No item selected.</p>
      </div>
    );
  }

  const hasBlockingReasons = item.blocking_reasons.length > 0;
  const pct = Math.round(
    (queueProgress.reviewed / queueProgress.total) * 100,
  );

  return (
    <div className="alm-decision-panel">
      {/* Section label */}
      <div className="alm-decision-panel__section-label">Decisions</div>

      {/* Lifecycle */}
      <div className="alm-decision-panel__group">
        <div className="alm-decision-panel__group-title">Lifecycle</div>
        <div className="alm-decision-panel__actions">
          <Btn
            variant="primary"
            disabled={hasBlockingReasons}
            onClick={() => onDecision('confirm')}
          >
            Confirm ⌘1
          </Btn>
          <Btn onClick={() => onDecision('reject')}>Reject ⌘2</Btn>
          <Btn onClick={() => onDecision('skip')}>Skip (review later) ⌘3</Btn>
          <Btn size="sm" onClick={() => {}}>
            Re-open existing confirmation
          </Btn>
        </div>
      </div>

      {/* Corrections */}
      <div className="alm-decision-panel__group">
        <div className="alm-decision-panel__group-title">Corrections</div>
        <Btn size="sm" onClick={() => {}}>
          Reassign target…
        </Btn>
        <Btn size="sm" onClick={() => {}}>
          Reassign optical train…
        </Btn>
        <Btn size="sm" onClick={() => {}}>
          Split this session…
        </Btn>
        <Btn size="sm" onClick={() => {}}>
          Merge with another…
        </Btn>
      </div>

      {/* Notes */}
      <div className="alm-decision-panel__group">
        <div className="alm-decision-panel__group-title">Notes</div>
        <textarea
          className="alm-decision-panel__notes"
          placeholder="Optional notes for future reviewers…"
        />
      </div>

      {/* Queue progress */}
      <div className="alm-decision-panel__progress">
        <div className="alm-decision-panel__progress-title">Queue progress</div>
        <div className="alm-decision-panel__progress-track">
          <div
            className="alm-decision-panel__progress-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="alm-decision-panel__progress-label">
          {queueProgress.reviewed} reviewed · {queueProgress.remaining} remaining
        </div>
      </div>
    </div>
  );
}
