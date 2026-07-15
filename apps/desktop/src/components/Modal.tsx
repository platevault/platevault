// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal — shared, parameterised dialog/overlay for the whole app.
 *
 * Wraps `@base-ui-components/react/dialog` (focus-trap + Escape) with the
 * app's standard chrome so feature code never re-implements an overlay:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ title · subtitle                        ✕    │  ← header (✕ top-right)
 *   ├─────────────────────────────────────────────┤
 *   │ children (scrolls)                          │  ← body
 *   ├─────────────────────────────────────────────┤
 *   │ footer (optional, pinned)                   │  ← footer
 *   └─────────────────────────────────────────────┘
 *
 * Dismissal: clicking the dimmed backdrop (when `closeOnBackdrop`), Escape, or
 * the ✕ closes it. base-ui's automatic `outside-press` is IGNORED — it
 * misclassifies clicks on inner controls that re-render/unmount (checkboxes,
 * foldouts) as outside presses, which would close the modal on every
 * interaction. Genuine outside dismissal is handled by the explicit backdrop
 * click below.
 *
 * Size presets cap the width (`auto` hugs content); the body scrolls within a
 * height cap so tall content never pushes the modal off-screen. This component
 * is the canonical replacement for the ad-hoc per-feature dialog wrappers.
 */

import { type ReactNode, type RefObject } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { m } from '@/lib/i18n';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'auto';

export interface ModalProps {
  /** Controlled open state. */
  open: boolean;
  /** Called when the modal requests close (backdrop / Escape / ✕). */
  onClose: () => void;
  /** Header title. When omitted, the header shows only the ✕. */
  title?: ReactNode;
  /** Secondary line beside the title (e.g. a count summary). */
  subtitle?: ReactNode;
  /**
   * Element to focus when the dialog opens (Base UI `Dialog.Popup`
   * `initialFocus`). DEFAULT (omitted): Base UI's own default — the first
   * tabbable element, which in this chrome is the header ✕ (#841: a bare
   * `autoFocus` on a body field races that default and can lose). Pass a ref
   * to the field that should actually receive focus instead of relying on
   * `autoFocus` inside `children`.
   */
  initialFocus?: RefObject<HTMLElement | null> | boolean;
  /** Modal body — scrolls within the height cap. */
  children: ReactNode;
  /** Optional pinned footer (e.g. action buttons). */
  footer?: ReactNode;
  /** Width preset. DEFAULT `md`. `auto` hugs content. */
  size?: ModalSize;
  /** Accessible label (defaults to the title when it is a string). */
  ariaLabel?: string;
  /** Dismiss on backdrop click. DEFAULT true. */
  closeOnBackdrop?: boolean;
  /** Hide the header ✕ (Escape/backdrop still close). DEFAULT false. */
  hideClose?: boolean;
  /** Extra class on the popup card. */
  className?: string;
  /** Extra class on the scrollable body. */
  bodyClassName?: string;
  /** Test id on the popup card. */
  'data-testid'?: string;
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  initialFocus,
  size = 'md',
  ariaLabel,
  closeOnBackdrop = true,
  hideClose = false,
  className,
  bodyClassName,
  'data-testid': testId,
}: ModalProps) {
  const label = ariaLabel ?? (typeof title === 'string' ? title : undefined);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen, eventDetails) => {
        if (isOpen) return;
        // Ignore `outside-press` — base-ui treats clicks on re-rendering inner
        // controls as outside presses, which would close the modal mid-edit.
        // Backdrop dismissal is wired explicitly below; Escape ('escape-key')
        // and the ✕ ('close-press') still close here.
        if (eventDetails?.reason === 'outside-press') return;
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className="alm-modal__backdrop"
          onClick={closeOnBackdrop ? onClose : undefined}
        />
        <Dialog.Popup
          className={`alm-modal alm-modal--${size}${className ? ` ${className}` : ''}`}
          aria-label={label}
          data-testid={testId}
          initialFocus={initialFocus}
        >
          <div className="alm-modal__header">
            {title != null ? (
              <Dialog.Title className="alm-modal__title">{title}</Dialog.Title>
            ) : (
              // Keep the close button right-aligned even without a title.
              <span className="alm-modal__title-spacer" />
            )}
            {subtitle != null && (
              <span className="alm-modal__subtitle">{subtitle}</span>
            )}
            {!hideClose && (
              <Dialog.Close
                className="alm-modal__close"
                aria-label={m.common_close()}
              >
                ✕
              </Dialog.Close>
            )}
          </div>

          <div
            className={`alm-modal__body${bodyClassName ? ` ${bodyClassName}` : ''}`}
          >
            {children}
          </div>

          {footer != null && <div className="alm-modal__footer">{footer}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
