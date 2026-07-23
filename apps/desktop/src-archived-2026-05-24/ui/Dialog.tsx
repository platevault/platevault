// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import type { ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  body: ReactNode;
  footer?: ReactNode;
}

export function Dialog({ open, onOpenChange, title, body, footer }: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        {/*
          Backdrop is a sibling of the popup — NOT a wrapper — so it cannot
          overlay the dialog content. z-index kept below --z-modal so the
          popup is always on top.
        */}
        <BaseDialog.Backdrop className="alm-dialog-overlay" />
        {/*
          keepMounted={false} ensures the popup is removed from the DOM when
          closed, which prevents any lingering focus-trap or scroll effects.
          The popup itself carries the --z-modal z-index via CSS; the
          container div is a plain fixed positioner with no scroll impact.
        */}
        <div className="alm-dialog-positioner" aria-modal="true">
          <BaseDialog.Popup className="alm-dialog">
            <div className="alm-dialog__head">
              <BaseDialog.Title className="alm-dialog__title">{title}</BaseDialog.Title>
            </div>
            <div className="alm-dialog__body">{body}</div>
            {footer ? <div className="alm-dialog__footer">{footer}</div> : null}
          </BaseDialog.Popup>
        </div>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
