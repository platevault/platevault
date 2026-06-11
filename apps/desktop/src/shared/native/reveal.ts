/**
 * Reveal-in-OS helper.
 *
 * Wraps the Tauri `native_reveal` IPC command that opens the user's file
 * browser at a given path with the target item selected.
 *
 * When running outside Tauri (mocks / browser-only builds), logs to the
 * console and returns a stub response.
 */

import { useState, useCallback } from 'react';
import { commands } from '@/bindings';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid entity kinds for audit correlation (must match Rust EntityKind enum). */
export type EntityKind = 'inbox_item' | 'inventory_row' | 'project_manifest' | 'master_calibration' | 'registered_source' | 'other';

/** Context passed alongside the reveal request for audit correlation. */
export interface RevealContext {
  entityKind?: EntityKind;
  entityId?: string;
}

/** Result of a reveal operation. */
export interface RevealResult {
  revealed: boolean;
  selection: string;
}

/** Error shape for reveal failures. */
export interface RevealError {
  code: string;
  message: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

class RevealError_impl extends Error implements RevealError {
  code: string;
  path: string;
  constructor(code: string, message: string, path: string) {
    super(message);
    this.name = 'RevealError';
    this.code = code;
    this.path = path;
  }
}

/** Type guard for reveal errors. */
export function isRevealError(err: unknown): err is RevealError {
  return err instanceof RevealError_impl;
}

// ---------------------------------------------------------------------------
// isTauri helper
// ---------------------------------------------------------------------------

function isTauri(): boolean {
  return import.meta.env.VITE_USE_MOCKS !== 'true';
}

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Open the OS file browser at `path` with the target selected.
 *
 * @param path  Absolute path to reveal.
 * @param ctx   Optional audit context (entity kind + id).
 */
export async function revealInOs(
  path: string,
  ctx?: RevealContext,
): Promise<RevealResult> {
  if (!isTauri()) {
    console.info('[reveal-stub]', path, ctx);
    return { revealed: true, selection: 'target' };
  }

  const requestId = crypto.randomUUID();

  const response = await commands.nativeReveal({
    requestId,
    path,
    entityKind: ctx?.entityKind ?? null,
    entityId: ctx?.entityId ?? null,
  });

  if (response.status === 'error') {
    const message = response.error;
    if (message.includes('path.not_exists') || message.includes('not found') || message.includes('does not exist')) {
      throw new RevealError_impl('path.not_exists', `Path does not exist: ${path}`, path);
    }
    throw new RevealError_impl('os.command_failed', message, path);
  }

  return response.data;
}

// ---------------------------------------------------------------------------
// Clipboard helper (for "Copy path" action on errors)
// ---------------------------------------------------------------------------

/** Copy text to clipboard. Returns `true` on success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// React hook (T025)
// ---------------------------------------------------------------------------

export interface UseRevealInOsReturn {
  reveal: (path: string, ctx?: RevealContext) => Promise<RevealResult | null>;
  loading: boolean;
  error: RevealError | null;
  clearError: () => void;
}

/**
 * React hook wrapping `revealInOs` with loading/error state.
 *
 * On `path.not_exists` or `os.command_failed`, surfaces the error so callers
 * can render a toast with a "Copy path" action (T029).
 */
export function useRevealInOs(): UseRevealInOsReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RevealError | null>(null);

  const reveal = useCallback(
    async (path: string, ctx?: RevealContext): Promise<RevealResult | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await revealInOs(path, ctx);
        return result;
      } catch (err: unknown) {
        const revErr: RevealError = isRevealError(err)
          ? err
          : {
              code: 'os.command_failed',
              message: err instanceof Error ? err.message : String(err),
              path,
            };
        setError(revErr);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return { reveal, loading, error, clearError };
}
