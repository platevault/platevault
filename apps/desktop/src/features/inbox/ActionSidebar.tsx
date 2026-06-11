/**
 * ActionSidebar — right action bar for the Inbox workflow.
 *
 * Shows context-sensitive actions:
 * - "Confirm to Inventory" (single_type) or "Generate Split Plan" (mixed).
 * - "Open Existing Plan" when state = plan_open.
 * - Keyboard shortcuts: C = confirm/split, O = open plan.
 */

import { useEffect, useCallback } from 'react';
import { Btn } from '@/ui';
import type { InboxClassifyResponse } from './store';

export interface ActionSidebarProps {
  hasSelection: boolean;
  classification: InboxClassifyResponse | null;
  hasOpenPlan: boolean;
  confirmLoading: boolean;
  canConfirm: boolean;
  onConfirm: () => void;
  onOpenExistingPlan: () => void;
}

export function ActionSidebar({
  hasSelection,
  classification,
  hasOpenPlan,
  confirmLoading,
  canConfirm,
  onConfirm,
  onOpenExistingPlan,
}: ActionSidebarProps) {
  const isMixed = classification?.type === 'mixed';
  const confirmLabel = hasOpenPlan
    ? 'Open existing plan'
    : isMixed
      ? 'Generate split plan'
      : 'Confirm to inventory';

  const handleConfirmKey = useCallback(
    (e: KeyboardEvent) => {
      if (!hasSelection) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      if (isInput) return;

      if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        if (hasOpenPlan) onOpenExistingPlan();
        else if (canConfirm) onConfirm();
      }
      if (e.key.toLowerCase() === 'o' && hasOpenPlan) {
        e.preventDefault();
        onOpenExistingPlan();
      }
    },
    [hasSelection, hasOpenPlan, canConfirm, onConfirm, onOpenExistingPlan],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleConfirmKey);
    return () => document.removeEventListener('keydown', handleConfirmKey);
  }, [handleConfirmKey]);

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

      {/* Classification summary */}
      {hasSelection && classification && (
        <div
          style={{
            margin: '12px 12px 0',
            padding: '8px',
            background: 'var(--alm-bg3, rgba(0,0,0,0.05))',
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
            <div style={{ color: 'var(--alm-warn, #c07d00)', marginTop: 4 }}>
              ⚠ {unclassifiedCount} file{unclassifiedCount !== 1 ? 's' : ''} need review
            </div>
          )}
          {isUnclassified && !hasUnclassified && (
            <div style={{ color: 'var(--alm-warn, #c07d00)', marginTop: 4 }}>
              No IMAGETYP headers found
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
