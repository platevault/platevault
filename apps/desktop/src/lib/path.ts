// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared path utilities used across the inbox, sessions, and calibration
 * features. These helpers handle cross-platform path joining and segmentation
 * where the backend guarantees forward-slash-normalized relative paths while
 * the OS root may use backslashes (Windows).
 */

/** Whether `path` is a Windows absolute path: a drive (`C:\`, `C:/`) or a UNC share. */
function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/**
 * Resolve a reveal target path: the OS-native source root joined with a
 * forward-slash relative path.
 *
 * Backend contract: `/` is the only separator in `relativePath`
 * (`fs_pathsafe::wire_path`). On Windows the backend has already turned
 * every `\` into `/`, and the root (`source.path`, from the folder picker)
 * uses backslashes, so under a Windows root every `/` or `\` is a separator
 * and is rewritten to the root's own separator: the Windows select-item shell
 * call rejects forward slashes. On macOS and Linux `\` is an ordinary name
 * character the backend keeps (bd astro-plan-3pvvc), so under any other root
 * only `/` separates. `pathe.join` is unsuitable here because it rewrites
 * backslashes to forward slashes.
 *
 * This is the canonical implementation. It was previously duplicated as
 * `resolveRevealPath` in `features/sessions/revealInventory.ts` and
 * `resolveInboxRevealPath` in `features/inbox/inboxDetailHelpers.ts` (both
 * had identical bodies; the inbox copy accepted only `string`, this one
 * accepts the wider `string | null | undefined` union that the sessions copy
 * already used).
 */
export function resolveRevealPath(
  rootPath: string,
  relativePath: string | null | undefined,
): string {
  if (!relativePath) return rootPath;
  if (!isWindowsPath(rootPath)) {
    const root = rootPath.replace(/\/+$/, '');
    const rel = relativePath.replace(/^\/+/, '').replace(/\/+/g, '/');
    return `${root}/${rel}`;
  }
  const sep = rootPath.includes('\\') ? '\\' : '/';
  const root = rootPath.replace(/[/\\]+$/, '');
  const rel = relativePath.replace(/^[/\\]+/, '').replace(/[/\\]+/g, sep);
  return `${root}${sep}${rel}`;
}

/**
 * Return the last path segment (filename or directory name) of a
 * forward-slash or back-slash-separated path.
 *
 * Previously duplicated in `features/inbox/inboxDetailHelpers.ts` and
 * `features/inbox/planPanelHelpers.ts` (both had identical bodies).
 *
 * Note: `InboxControls.tsx` has a distinct null-safe/trailing-slash-trim
 * variant (`basename(p: string | null | undefined): string | null`) that
 * keeps its own copy intentionally.
 */
export function basename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/**
 * Return the second-to-last path segment (the basename's parent directory
 * name). Returns an empty string when the path has fewer than two segments.
 *
 * Previously only in `features/inbox/inboxDetailHelpers.ts`.
 */
export function parentSegment(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}
