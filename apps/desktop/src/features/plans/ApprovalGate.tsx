import { useState } from 'react';
import { AlertDialog } from '@base-ui-components/react/alert-dialog';
import { Checkbox } from '@base-ui-components/react/checkbox';
import type { FilesystemPlan } from '@/api/types';
import { Btn } from '@/ui';

export interface ApprovalGateProps {
  plan: FilesystemPlan;
  onApprove: () => void;
}

/**
 * 3-tier approval component for filesystem plans.
 *
 * Tier 1 (non-destructive): Simple "Approve" button
 * Tier 2 (has trash/archive but no permanent delete): Approve with AlertDialog confirmation
 * Tier 3 (has_destructive = true): Checkbox acknowledgement required before approve
 *
 * Blocks approval entirely if any dry_run_ok === false in plan items.
 */
export function ApprovalGate({ plan, onApprove }: ApprovalGateProps) {
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);

  // Check if any dry-run preconditions failed
  const hasDryRunFailure = plan.items.some((item) => !item.dry_run_ok);

  // Determine tier
  const hasTrashOrArchive = plan.items.some(
    (item) => item.action === 'trash' || item.action === 'archive',
  );
  const isDestructive = plan.has_destructive;

  // Tier 3: permanent deletes
  if (isDestructive) {
    return (
      <div
        className="alm-approval-gate"
        style={{
          padding: 'var(--alm-space-5)',
          borderTop: '1px solid var(--alm-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--alm-space-3)',
        }}
      >
        {hasDryRunFailure && (
          <p style={{ color: 'var(--alm-danger)', fontSize: 'var(--alm-text-sm)', margin: 0 }}>
            Cannot approve: dry-run preconditions failed
          </p>
        )}

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--alm-space-2)',
            fontSize: 'var(--alm-text-sm)',
            color: 'var(--alm-danger)',
            cursor: hasDryRunFailure ? 'not-allowed' : 'pointer',
            opacity: hasDryRunFailure ? 0.5 : 1,
          }}
        >
          <Checkbox.Root
            className="alm-checkbox"
            checked={deleteAcknowledged}
            disabled={hasDryRunFailure}
            onCheckedChange={(checked) => setDeleteAcknowledged(checked === true)}
          >
            <Checkbox.Indicator className="alm-checkbox__indicator">
              &#x2713;
            </Checkbox.Indicator>
          </Checkbox.Root>
          I understand this will permanently delete files
        </label>

        <div>
          <Btn
            variant="danger"
            disabled={hasDryRunFailure || !deleteAcknowledged}
            onClick={onApprove}
          >
            Approve
          </Btn>
        </div>
      </div>
    );
  }

  // Tier 2: has trash/archive — AlertDialog confirmation
  if (hasTrashOrArchive) {
    return (
      <div
        className="alm-approval-gate"
        style={{
          padding: 'var(--alm-space-5)',
          borderTop: '1px solid var(--alm-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--alm-space-3)',
        }}
      >
        {hasDryRunFailure && (
          <p style={{ color: 'var(--alm-danger)', fontSize: 'var(--alm-text-sm)', margin: 0 }}>
            Cannot approve: dry-run preconditions failed
          </p>
        )}

        <AlertDialog.Root>
          <AlertDialog.Trigger
            className="alm-btn alm-btn--primary"
            disabled={hasDryRunFailure}
          >
            Approve
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className="alm-dialog-backdrop" />
            <AlertDialog.Popup className="alm-dialog">
              <AlertDialog.Title className="alm-dialog__title">
                Confirm plan approval
              </AlertDialog.Title>
              <AlertDialog.Description className="alm-dialog__description">
                This plan will move files to trash/archive. Continue?
              </AlertDialog.Description>
              <div className="alm-dialog__actions">
                <AlertDialog.Close className="alm-btn alm-btn--ghost">
                  Cancel
                </AlertDialog.Close>
                <AlertDialog.Close
                  className="alm-btn alm-btn--primary"
                  onClick={onApprove}
                >
                  Confirm
                </AlertDialog.Close>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    );
  }

  // Tier 1: non-destructive — simple button
  return (
    <div
      className="alm-approval-gate"
      style={{
        padding: 'var(--alm-space-5)',
        borderTop: '1px solid var(--alm-border)',
      }}
    >
      {hasDryRunFailure && (
        <p style={{ color: 'var(--alm-danger)', fontSize: 'var(--alm-text-sm)', margin: 0, marginBottom: 'var(--alm-space-3)' }}>
          Cannot approve: dry-run preconditions failed
        </p>
      )}
      <Btn variant="primary" disabled={hasDryRunFailure} onClick={onApprove}>
        Approve
      </Btn>
    </div>
  );
}
