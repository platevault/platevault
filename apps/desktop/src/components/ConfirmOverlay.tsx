// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * ConfirmOverlay — confirm-specialized wrapper over the shared {@link Modal}.
 *
 * Owns only the confirm affordance (title, optional message, cancel + confirm
 * buttons, danger variant); all dialog chrome, focus-trap, and dismissal come
 * from Modal so there is a single overlay implementation. The header ✕ is
 * hidden because the explicit Cancel button already provides dismissal.
 */

import type { ReactNode } from 'react';
import { Modal } from './Modal';
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
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      hideClose
      footer={
        <>
          <Btn variant="ghost" onClick={onClose}>
            {m.common_cancel()}
          </Btn>
          <Btn variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Btn>
        </>
      }
    >
      {description && <p className="alm-modal__message">{description}</p>}
      {children}
    </Modal>
  );
}
