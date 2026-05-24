import type { ReviewItem } from '@/api/types';
import { Btn } from '@/ui';

export interface DecisionPanelProps {
  item: ReviewItem | null;
  onDecision: (action: 'confirm' | 'reject' | 'skip') => void;
}

/**
 * Right pane with decision action buttons.
 * Confirm is disabled when blocking_reasons exist.
 * Keyboard shortcut hints are displayed alongside each button.
 */
export function DecisionPanel({ item, onDecision }: DecisionPanelProps) {
  if (!item) {
    return (
      <div className="alm-decision-panel" style={{ padding: 24 }}>
        <p style={{ color: 'var(--alm-text-muted)' }}>No item selected.</p>
      </div>
    );
  }

  const hasBlockingReasons = item.blocking_reasons.length > 0;

  return (
    <div className="alm-decision-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600, marginBottom: 4 }}>
        Decision
      </h3>

      {/* Confirm */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Btn
          variant="primary"
          disabled={hasBlockingReasons}
          onClick={() => onDecision('confirm')}
        >
          Confirm
        </Btn>
        <kbd style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
          &#x2318;1
        </kbd>
      </div>

      {/* Reject */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Btn
          variant="danger"
          onClick={() => onDecision('reject')}
        >
          Reject
        </Btn>
        <kbd style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
          &#x2318;2
        </kbd>
      </div>

      {/* Skip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Btn
          variant="ghost"
          onClick={() => onDecision('skip')}
        >
          Skip
        </Btn>
        <kbd style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
          &#x2318;3
        </kbd>
      </div>

      {/* Blocking reasons note */}
      {hasBlockingReasons && (
        <p
          style={{
            marginTop: 8,
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-warn)',
            lineHeight: 1.4,
          }}
        >
          Confirm is disabled because blocking reasons must be resolved first:
          {item.blocking_reasons.map((reason, i) => (
            <span key={i} style={{ display: 'block', marginTop: 2 }}>
              &bull; {reason}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
