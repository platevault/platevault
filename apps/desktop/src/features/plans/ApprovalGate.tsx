import { useState } from 'react';
import { AlertDialog } from '@base-ui-components/react/alert-dialog';
import { Checkbox } from '@base-ui-components/react/checkbox';
import type { FilesystemPlan } from '@/bindings/types';
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
 * Tier 3 (has_destructive = true): Inline danger banner with checkbox acknowledgement
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
  const deleteCount = plan.items.filter((item) => item.action === 'delete').length;

  // Tier 3: permanent deletes — inline danger banner (matches wireframe)
  if (isDestructive) {
    return (
      <div className="alm-approval-gate alm-approval-gate--danger">
        {hasDryRunFailure && (
          <p className="alm-approval-gate__block-msg">
            Cannot approve: dry-run preconditions failed
          </p>
        )}

        <div className="alm-approval-gate__banner">
          <span className="alm-approval-gate__icon" aria-hidden="true">&#x26A0;</span>
          <div className="alm-approval-gate__body">
            <div className="alm-approval-gate__title">
              This plan includes {deleteCount} permanent delete{deleteCount !== 1 ? 's' : ''}
            </div>
            <div className="alm-approval-gate__desc">
              Permanent delete is normally disabled. It was enabled for:{' '}
              <span className="alm-mono">processing/pixinsight/temp/*.tmp</span>.
              These files will be unrecoverable.
            </div>
          </div>
          <label className="alm-approval-gate__ack">
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
            I understand and accept
          </label>
        </div>
      </div>
    );
  }

  // Tier 2: has trash/archive — AlertDialog confirmation
  if (hasTrashOrArchive) {
    return (
      <div className="alm-approval-gate">
        {hasDryRunFailure && (
          <p className="alm-approval-gate__block-msg">
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
    <div className="alm-approval-gate">
      {hasDryRunFailure && (
        <p className="alm-approval-gate__block-msg">
          Cannot approve: dry-run preconditions failed
        </p>
      )}
      <Btn variant="primary" disabled={hasDryRunFailure} onClick={onApprove}>
        Approve
      </Btn>
    </div>
  );
}
