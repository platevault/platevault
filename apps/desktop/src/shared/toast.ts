/**
 * Minimal toast notification system.
 *
 * Provides an imperative `addToast()` API and a `useToasts()` hook for
 * rendering. Toasts auto-dismiss after a configurable duration.
 */

import { useSyncExternalStore, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastVariant = 'info' | 'error' | 'success' | 'warn';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Optional action button rendered in the toast. */
  action?: ToastAction;
  /** Timestamp when the toast was created (for ordering). */
  createdAt: number;
}

export interface AddToastOptions {
  message: string;
  variant?: ToastVariant;
  action?: ToastAction;
  /** Auto-dismiss delay in ms. Default 5000. Set 0 to require manual dismiss. */
  duration?: number;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type Listener = () => void;

let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function notify(): void {
  // Create a new array reference so useSyncExternalStore detects the change
  toasts = [...toasts];
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Toast[] {
  return toasts;
}

// ---------------------------------------------------------------------------
// Imperative API
// ---------------------------------------------------------------------------

/** Add a toast notification. Returns the toast id for manual dismissal. */
export function addToast(options: AddToastOptions): string {
  const id = crypto.randomUUID();
  const toast: Toast = {
    id,
    message: options.message,
    variant: options.variant ?? 'info',
    action: options.action,
    createdAt: Date.now(),
  };

  toasts = [...toasts, toast];
  notify();

  const duration = options.duration ?? 5000;
  if (duration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, duration);
  }

  return id;
}

/** Dismiss a toast by id. */
export function dismissToast(id: string): void {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx === -1) return;
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UseToastsReturn {
  toasts: Toast[];
  dismiss: (id: string) => void;
  add: (options: AddToastOptions) => string;
}

/** Hook: subscribe to the toast list for rendering. */
export function useToasts(): UseToastsReturn {
  const current = useSyncExternalStore(subscribe, getSnapshot);
  const dismiss = useCallback((id: string) => dismissToast(id), []);
  const add = useCallback((options: AddToastOptions) => addToast(options), []);
  return { toasts: current, dismiss, add };
}
