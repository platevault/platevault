/**
 * Toast notification container.
 *
 * Renders at the bottom-right corner of the viewport. Mount once in the app
 * shell (e.g. in `Shell.tsx` or `main.tsx`).
 */

import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { useToasts, type Toast as ToastType } from '@/shared/toast';

const VARIANT_CLASS: Record<string, string> = {
  info: 'alm-toast__item--info',
  error: 'alm-toast__item--error',
  success: 'alm-toast__item--success',
  warn: 'alm-toast__item--warn',
};

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastType;
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      role="alert"
      className={`alm-toast__item ${VARIANT_CLASS[toast.variant] ?? ''}`}
    >
      <span className="alm-toast__message">{toast.message}</span>
      <div className="alm-toast__controls">
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            className="alm-toast__action-btn"
          >
            {toast.action.label}
          </button>
        )}
        <button
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          className="alm-toast__dismiss-btn"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export interface ToastContainerProps extends HTMLAttributes<HTMLDivElement> {}

export const ToastContainer = forwardRef<HTMLDivElement, ToastContainerProps>(
  function ToastContainer({ className, style, ...rest }, ref) {
    const { toasts, dismiss } = useToasts();

    if (toasts.length === 0) return null;

    const cls = ['alm-toast__container', className].filter(Boolean).join(' ');

    return (
      <div ref={ref} style={style} className={cls} aria-live="polite" {...rest}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    );
  }
);
ToastContainer.displayName = 'ToastContainer';
