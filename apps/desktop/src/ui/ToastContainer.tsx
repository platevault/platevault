/**
 * Toast notification container.
 *
 * Renders at the bottom-right corner of the viewport. Mount once in the app
 * shell (e.g. in `Shell.tsx` or `main.tsx`).
 */

import { forwardRef } from 'react';
import type { HTMLAttributes } from 'react';
import { useToasts, type Toast as ToastType } from '@/shared/toast';

const CONTAINER_STYLE: React.CSSProperties = {
  position: 'fixed',
  bottom: 'var(--alm-space-4, 16px)',
  right: 'var(--alm-space-4, 16px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--alm-space-2, 8px)',
  zIndex: 9999,
  pointerEvents: 'none',
  maxWidth: 400,
};

const VARIANT_STYLES: Record<string, React.CSSProperties> = {
  info: {
    background: 'var(--alm-surface, #1e1e2e)',
    borderLeft: '3px solid var(--alm-info, #60a5fa)',
  },
  error: {
    background: 'var(--alm-surface, #1e1e2e)',
    borderLeft: '3px solid var(--alm-danger, #dc2626)',
  },
  success: {
    background: 'var(--alm-surface, #1e1e2e)',
    borderLeft: '3px solid var(--alm-ok, #22c55e)',
  },
  warn: {
    background: 'var(--alm-surface, #1e1e2e)',
    borderLeft: '3px solid var(--alm-warn, #f59e0b)',
  },
};

const TOAST_STYLE: React.CSSProperties = {
  padding: 'var(--alm-space-3, 12px) var(--alm-space-4, 16px)',
  borderRadius: 'var(--alm-radius-sm, 4px)',
  border: '1px solid var(--alm-border, #333)',
  color: 'var(--alm-text, #e0e0e0)',
  fontSize: 'var(--alm-text-sm, 13px)',
  lineHeight: 1.5,
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--alm-space-3, 12px)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
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
      style={{ ...TOAST_STYLE, ...VARIANT_STYLES[toast.variant] }}
    >
      <span style={{ flex: 1 }}>{toast.message}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-space-2, 8px)', flexShrink: 0 }}>
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            style={{
              background: 'transparent',
              border: '1px solid var(--alm-border, #444)',
              borderRadius: 'var(--alm-radius-sm, 4px)',
              color: 'var(--alm-text, #e0e0e0)',
              fontSize: 'var(--alm-text-xs, 11px)',
              padding: '2px 8px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {toast.action.label}
          </button>
        )}
        <button
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--alm-text-muted, #888)',
            fontSize: 14,
            cursor: 'pointer',
            lineHeight: 1,
            padding: 0,
          }}
        >
          &times;
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

    const cls = className ? `${className}` : undefined;
    const mergedStyle = style ? { ...CONTAINER_STYLE, ...style } : CONTAINER_STYLE;

    return (
      <div ref={ref} style={mergedStyle} className={cls} aria-live="polite" {...rest}>
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    );
  }
);
ToastContainer.displayName = 'ToastContainer';
