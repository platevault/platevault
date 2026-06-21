/**
 * ActionSidebar — right action bar for the Inbox workflow.
 *
 * Shows context-sensitive actions:
 * - "Confirm to Inventory" (single_type) or "Generate Split Plan" (mixed).
 * - "Open Existing Plan" when state = plan_open.
 * - Destructive-destination toggle (archive | trash) — FR-032.
 * - Keyboard shortcuts: C = confirm/split, O = open plan.
 */

import { useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Btn } from '@/ui';
import { useHotkeys } from '@/lib/useHotkeys';
import type { InboxClassifyResponse } from './store';

export interface ActionSidebarProps {
  hasSelection: boolean;
  classification: InboxClassifyResponse | null;
  hasOpenPlan: boolean;
  confirmLoading: boolean;
  canConfirm: boolean;
  destructiveDestination: 'archive' | 'trash';
  onDestructiveDestinationChange: (dest: 'archive' | 'trash') => void;
  onConfirm: () => void;
  onOpenExistingPlan: () => void;
}

export function ActionSidebar({
  hasSelection,
  classification,
  hasOpenPlan,
  confirmLoading,
  canConfirm,
  destructiveDestination,
  onDestructiveDestinationChange,
  onConfirm,
  onOpenExistingPlan,
}: ActionSidebarProps) {
  const isMixed = classification?.type === 'mixed';
  const confirmLabel = hasOpenPlan
    ? 'Open existing plan'
    : isMixed
      ? 'Generate split plan'
      : 'Confirm to inventory';

  // C = confirm/split, O = open plan. Bind by physical key code (`KeyC`/`KeyO`)
  // — plus the Shift variants — so both lowercase and uppercase presses fire,
  // matching the prior `e.key.toLowerCase()` check. tinykeys' exact-modifier
  // matching means Ctrl/Alt/Meta combinations never trigger these (replacing
  // the explicit modifier guard), and useHotkeys' form-field guard replaces the
  // input/textarea/select/contentEditable skip.
  const onConfirmKey = useCallback(
    (e: KeyboardEvent) => {
      if (!hasSelection) return;
      e.preventDefault();
      if (hasOpenPlan) onOpenExistingPlan();
      else if (canConfirm) onConfirm();
    },
    [hasSelection, hasOpenPlan, canConfirm, onConfirm, onOpenExistingPlan],
  );
  const onOpenPlanKey = useCallback(
    (e: KeyboardEvent) => {
      if (!hasSelection) return;
      if (!hasOpenPlan) return;
      e.preventDefault();
      onOpenExistingPlan();
    },
    [hasSelection, hasOpenPlan, onOpenExistingPlan],
  );

  useHotkeys(
    {
      KeyC: onConfirmKey,
      'Shift+KeyC': onConfirmKey,
      KeyO: onOpenPlanKey,
      'Shift+KeyO': onOpenPlanKey,
    },
    [onConfirmKey, onOpenPlanKey],
  );

  const unclassifiedCount = classification?.unclassifiedFiles?.length ?? 0;
  const hasUnclassified = unclassifiedCount > 0;
  const isUnclassified = classification?.type === 'unclassified';

  return (
    <aside
      className="alm-action-sidebar"
      aria-label="Inbox actions"
      style={{ width: 200, flexShrink: 0, padding: '12px 0' }}
    >
      <div
        style={{
          padding: '0 12px 8px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--alm-text-muted)',
        }}
      >
        Actions
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 12px' }}>
        {/* Primary action: confirm or open existing plan */}
        <Btn
          variant={hasOpenPlan ? undefined : 'accent'}
          disabled={!hasSelection || confirmLoading || (!hasOpenPlan && !canConfirm)}
          onClick={hasOpenPlan ? onOpenExistingPlan : onConfirm}
          style={{ width: '100%', justifyContent: 'space-between' }}
          aria-label={confirmLabel}
          data-testid="inbox-confirm-btn"
          data-guide-anchor="inbox.confirm-row"
        >
          <span>{confirmLoading ? 'Working…' : confirmLabel}</span>
          <kbd
            style={{
              fontSize: 10,
              opacity: 0.6,
              background: 'rgba(0,0,0,0.15)',
              borderRadius: 3,
              padding: '1px 4px',
            }}
          >
            {hasOpenPlan ? 'O' : 'C'}
          </kbd>
        </Btn>
      </div>

      {/* FR-032: Destructive-destination toggle (archive | trash) */}
      {hasSelection && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--alm-border)' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--alm-text-muted)',
              marginBottom: 6,
            }}
          >
            Move destination
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              fontSize: 'var(--alm-text-xs)',
              marginBottom: 4,
            }}
          >
            <input
              type="radio"
              name="destructive-destination"
              value="archive"
              checked={destructiveDestination === 'archive'}
              onChange={() => onDestructiveDestinationChange('archive')}
              aria-label="Move to archive folder"
            />
            Archive folder
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              fontSize: 'var(--alm-text-xs)',
            }}
          >
            <input
              type="radio"
              name="destructive-destination"
              value="trash"
              checked={destructiveDestination === 'trash'}
              onChange={() => onDestructiveDestinationChange('trash')}
              aria-label="Move to system trash"
            />
            System trash
          </label>
        </div>
      )}

      {/* Classification summary */}
      {hasSelection && classification && (
        <div
          style={{
            margin: '12px 12px 0',
            padding: '8px',
            background: 'var(--alm-bg3)',
            borderRadius: 4,
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
          }}
        >
          <div>
            <strong>Type:</strong>{' '}
            {classification.type === 'single_type'
              ? classification.frameType ?? 'single'
              : classification.type}
          </div>
          {hasUnclassified && (
            <div style={{ color: 'var(--alm-warn)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={14} aria-hidden="true" /> {unclassifiedCount} file
              {unclassifiedCount !== 1 ? 's' : ''} need review
            </div>
          )}
          {isUnclassified && !hasUnclassified && (
            <div style={{ color: 'var(--alm-warn)', marginTop: 4 }}>
              No IMAGETYP headers found
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
