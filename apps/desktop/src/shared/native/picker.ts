/**
 * Native filesystem picker helpers.
 *
 * Wraps Tauri IPC commands (`native_directory_pick`, `native_file_pick`) with
 * last-path persistence and React hooks for loading/error state.
 *
 * When running outside Tauri (VITE_USE_MOCKS or browser-only builds), falls
 * back to `window.prompt`.
 */

import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a directory pick operation. */
export interface DirectoryPickResult {
  path: string | null;
  cancelled: boolean;
}

/** A file-type filter for the native file picker. */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Result of a file pick operation. */
export interface FilePickResult {
  path: string | null;
  selectedFilter: string | null;
  cancelled: boolean;
}

/** Affordance kinds for last-path persistence. */
export type LastPathKind = 'library_root' | 'master_calibration';

/** Error shape returned when a picker invocation fails (non-cancellation). */
export interface PickerError {
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Canonical calibration file filters (from data-model.md)
// ---------------------------------------------------------------------------

export const CALIBRATION_FILE_FILTERS: FileFilter[] = [
  { name: 'All supported astro images', extensions: ['xisf', 'fits', 'fit', 'fts', 'tif', 'tiff', 'png', 'jpg'] },
  { name: 'FITS', extensions: ['fit', 'fits', 'fts'] },
  { name: 'XISF', extensions: ['xisf'] },
  { name: 'TIFF', extensions: ['tif', 'tiff'] },
  { name: 'All files', extensions: ['*'] },
];

// ---------------------------------------------------------------------------
// Last-path localStorage helpers (T012)
// ---------------------------------------------------------------------------

const LAST_PATH_PREFIX = 'alm.lastPath.';

/**
 * Read the last-used path for a given affordance kind from localStorage.
 * Returns `undefined` if no stored path exists.
 */
export function getLastPath(kind: LastPathKind): string | undefined {
  try {
    const value = localStorage.getItem(`${LAST_PATH_PREFIX}${kind}`);
    return value ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Store the parent directory of the selected path as the last-used path for
 * the given affordance kind.
 */
export function setLastPath(kind: LastPathKind, selectedPath: string): void {
  try {
    const parent = parentDir(selectedPath);
    localStorage.setItem(`${LAST_PATH_PREFIX}${kind}`, parent);
  } catch {
    // localStorage unavailable or full -- proceed without persistence
  }
}

/** Extract the parent directory from a path (cross-platform). */
function parentDir(filePath: string): string {
  // Normalise forward slashes for splitting, then restore original separator
  const sep = filePath.includes('\\') ? '\\' : '/';
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 1) return filePath;
  parts.pop();
  const parent = parts.join(sep);
  // Preserve leading slash for Unix paths
  if (filePath.startsWith('/')) return `/${parent}`;
  return parent;
}

// ---------------------------------------------------------------------------
// Selected-filter persistence (T021)
// ---------------------------------------------------------------------------

const SELECTED_FILTER_KEY = 'alm.selectedFilter';

/**
 * Persist the selected file-type filter alongside the last pick, so
 * downstream forms can read the user's preference.
 */
export function setSelectedFilter(filterName: string): void {
  try {
    localStorage.setItem(SELECTED_FILTER_KEY, filterName);
  } catch {
    // proceed without persistence
  }
}

/** Read the last-selected file-type filter, if any. */
export function getSelectedFilter(): string | undefined {
  try {
    const value = localStorage.getItem(SELECTED_FILTER_KEY);
    return value ?? undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// isTauri helper
// ---------------------------------------------------------------------------

/**
 * Returns `true` when running inside Tauri, `false` for browser-only builds.
 * Uses `VITE_USE_MOCKS` as the authoritative signal -- when mocks are active,
 * we are not inside a real Tauri webview.
 */
function isTauri(): boolean {
  return import.meta.env.VITE_USE_MOCKS !== 'true';
}

// ---------------------------------------------------------------------------
// Core pick functions
// ---------------------------------------------------------------------------

/**
 * Open the OS-native directory picker.
 *
 * @param defaultPath  Initial directory the dialog opens in.  When omitted,
 *   the last-used path for the affordance `kind` (if provided) is used.
 * @param kind  Affordance kind for last-path persistence.
 */
export async function pickDirectory(
  defaultPath?: string,
  kind?: LastPathKind,
): Promise<DirectoryPickResult> {
  const resolvedDefault = defaultPath ?? (kind ? getLastPath(kind) : undefined);

  if (!isTauri()) {
    // Browser-only fallback
    const path = window.prompt('Enter folder path:', resolvedDefault ?? '');
    if (!path) return { path: null, cancelled: true };
    if (kind) setLastPath(kind, path);
    return { path, cancelled: false };
  }

  const requestId = crypto.randomUUID();

  try {
    const result = await invoke<DirectoryPickResult>('native_directory_pick', {
      requestId,
      defaultPath: resolvedDefault ?? null,
      contractVersion: '1.0.0',
    });

    // Tauri command returns the contract response shape directly
    if (result.cancelled || result.path === null) {
      return { path: null, cancelled: true };
    }

    if (kind) setLastPath(kind, result.path);
    return { path: result.path, cancelled: false };
  } catch (err: unknown) {
    // Distinguish cancellation from real errors. The Tauri side should
    // return a response with `cancelled: true`, but some backends throw
    // on user-cancel instead.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('cancelled') || message.includes('canceled')) {
      return { path: null, cancelled: true };
    }
    throw new PickerError_impl('picker.directory_failed', message);
  }
}

/**
 * Open the OS-native file picker with type filters.
 *
 * @param filters     File type filters shown in the dialog.
 * @param defaultPath Initial directory the dialog opens in.
 * @param kind        Affordance kind for last-path persistence.
 */
export async function pickFile(
  filters: FileFilter[],
  defaultPath?: string,
  kind?: LastPathKind,
): Promise<FilePickResult> {
  const resolvedDefault = defaultPath ?? (kind ? getLastPath(kind) : undefined);

  if (!isTauri()) {
    // Browser-only fallback
    const path = window.prompt('Enter file path:', resolvedDefault ?? '');
    if (!path) return { path: null, selectedFilter: null, cancelled: true };
    if (kind) setLastPath(kind, path);
    return { path, selectedFilter: null, cancelled: false };
  }

  const requestId = crypto.randomUUID();

  try {
    const result = await invoke<FilePickResult>('native_file_pick', {
      requestId,
      filters,
      defaultPath: resolvedDefault ?? null,
      contractVersion: '1.0.0',
    });

    if (result.cancelled || result.path === null) {
      return { path: null, selectedFilter: null, cancelled: true };
    }

    if (kind) setLastPath(kind, result.path);
    if (result.selectedFilter) setSelectedFilter(result.selectedFilter);
    return {
      path: result.path,
      selectedFilter: result.selectedFilter,
      cancelled: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('cancelled') || message.includes('canceled')) {
      return { path: null, selectedFilter: null, cancelled: true };
    }
    throw new PickerError_impl('picker.file_failed', message);
  }
}

// ---------------------------------------------------------------------------
// Error class (kept private, exposed via PickerError interface)
// ---------------------------------------------------------------------------

class PickerError_impl extends Error implements PickerError {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'PickerError';
    this.code = code;
  }
}

/** Type guard for picker errors. */
export function isPickerError(err: unknown): err is PickerError {
  return err instanceof PickerError_impl;
}

// ---------------------------------------------------------------------------
// React hooks (T011, T018)
// ---------------------------------------------------------------------------

export interface UseDirectoryPickerReturn {
  pick: (defaultPath?: string, kind?: LastPathKind) => Promise<DirectoryPickResult>;
  loading: boolean;
  error: PickerError | null;
  clearError: () => void;
}

/**
 * React hook wrapping `pickDirectory` with loading state and error handling.
 * Cancellation does NOT set the error state.
 */
export function useDirectoryPicker(): UseDirectoryPickerReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PickerError | null>(null);

  const pick = useCallback(
    async (defaultPath?: string, kind?: LastPathKind): Promise<DirectoryPickResult> => {
      setLoading(true);
      setError(null);
      try {
        const result = await pickDirectory(defaultPath, kind);
        return result;
      } catch (err: unknown) {
        const pickerErr: PickerError = isPickerError(err)
          ? err
          : { code: 'picker.unknown', message: err instanceof Error ? err.message : String(err) };
        setError(pickerErr);
        return { path: null, cancelled: false };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return { pick, loading, error, clearError };
}

export interface UseFilePickerReturn {
  pick: (
    filters: FileFilter[],
    defaultPath?: string,
    kind?: LastPathKind,
  ) => Promise<FilePickResult>;
  loading: boolean;
  error: PickerError | null;
  clearError: () => void;
}

/**
 * React hook wrapping `pickFile` with loading state and error handling.
 * Cancellation does NOT set the error state.
 */
export function useFilePicker(): UseFilePickerReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PickerError | null>(null);

  const pick = useCallback(
    async (
      filters: FileFilter[],
      defaultPath?: string,
      kind?: LastPathKind,
    ): Promise<FilePickResult> => {
      setLoading(true);
      setError(null);
      try {
        const result = await pickFile(filters, defaultPath, kind);
        return result;
      } catch (err: unknown) {
        const pickerErr: PickerError = isPickerError(err)
          ? err
          : { code: 'picker.unknown', message: err instanceof Error ? err.message : String(err) };
        setError(pickerErr);
        return { path: null, selectedFilter: null, cancelled: false };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const clearError = useCallback(() => setError(null), []);

  return { pick, loading, error, clearError };
}
