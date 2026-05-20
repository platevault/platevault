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
        <BaseDialog.Backdrop className="alm-dialog-overlay" />
        <BaseDialog.Popup className="alm-dialog">
          <div className="alm-dialog__head">
            <BaseDialog.Title className="alm-dialog__title">{title}</BaseDialog.Title>
          </div>
          <div className="alm-dialog__body">{body}</div>
          {footer ? <div className="alm-dialog__footer">{footer}</div> : null}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
