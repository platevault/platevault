import type { ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";
import type { ButtonVariant } from "./Button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  confirmVariant?: ButtonVariant;
  onConfirm: () => void;
  cancelLabel?: string;
}

/**
 * Generic destructive-confirm dialog.
 * Footer: Cancel (ghost, left) + Confirm (right, configurable variant).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel = "Confirm",
  confirmVariant = "primary",
  onConfirm,
  cancelLabel = "Cancel",
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      body={body}
      footer={
        <>
          <Button variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
        </>
      }
    />
  );
}
