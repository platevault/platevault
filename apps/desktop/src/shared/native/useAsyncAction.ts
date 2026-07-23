// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Generic loading/error wrapper for a single fire-and-forget async action.
 *
 * Extracted from the 3 near-identical hooks in this directory (`useRevealInOs`,
 * `useDirectoryPicker`, `useFilePicker` — spec 004) that each hand-rolled the
 * same `useState(loading) + useState(error) + try/catch/finally` shape,
 * differing only in the wrapped function, the error-mapping, and the
 * on-error fallback return value.
 */
import { useState, useCallback } from 'react';

export interface UseAsyncActionReturn<Args extends unknown[], R, E> {
  run: (...args: Args) => Promise<R>;
  loading: boolean;
  error: E | null;
  clearError: () => void;
}

/**
 * @param fn        The async action to wrap.
 * @param mapError  Normalises a caught value into this hook's error shape.
 * @param fallback  Value `run` resolves to when `fn` throws (after `error` is set).
 *
 * `fn`, `mapError`, and `fallback` are expected to be referentially stable
 * (module-level functions / plain values, as every current call site passes) —
 * `run` captures them once, matching the original hooks' `useCallback(…, [])`.
 */
export function useAsyncAction<Args extends unknown[], R, E>(
  fn: (...args: Args) => Promise<R>,
  // Receives the call args too — e.g. `useRevealInOs` needs the `path` arg to
  // fill an unmapped error's `path` field.
  mapError: (err: unknown, ...args: Args) => E,
  fallback: R,
): UseAsyncActionReturn<Args, R, E> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<E | null>(null);

  const run = useCallback(
    async (...args: Args): Promise<R> => {
      setLoading(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (err: unknown) {
        setError(mapError(err, ...args));
        return fallback;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return { run, loading, error, clearError };
}
