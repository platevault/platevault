/**
 * ConfirmOverlay — modal overlay for confirmation actions (inbox confirm,
 * delete, archive).
 *
 * Uses @base-ui-components/react/dialog for the modal, which provides built-in
 * focus trapping and Escape-to-close behavior.
 */

import { type ReactNode } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { Btn } from '@/ui';
import { m } from '@/lib/i18n';

export interface ConfirmOverlayProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  children?: ReactNode;
}

export function ConfirmOverlay({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = m.common_confirm(),
  confirmVariant = 'primary',
  children,
}: ConfirmOverlayProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="alm-confirm-overlay__backdrop" />
        <Dialog.Popup className="alm-confirm-overlay" aria-label={title}>
          {/* Header */}
          <div className="alm-confirm-overlay__header">
            <Dialog.Title className="alm-confirm-overlay__title">
              {title}
            </Dialog.Title>
            {description && (
              <Dialog.Description className="alm-confirm-overlay__description">
                {description}
              </Dialog.Description>
            )}
          </div>

          {/* Scrollable body */}
          {children && (
            <div className="alm-confirm-overlay__body">
              {children}
            </div>
          )}

          {/* Footer */}
          <div className="alm-confirm-overlay__footer">
            <Btn variant="ghost" onClick={onClose}>
              {m.common_cancel()}
            </Btn>
            <Btn variant={confirmVariant} onClick={onConfirm}>
              {confirmLabel}
            </Btn>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
