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
 * Return the last name of a wire path: a root-relative path from the backend
 * (`relativePath`, `relativeFilePath`, a plan item's `fromPath`).
 *
 * `/` is the only separator in wire text (`fs_pathsafe::wire_path`). On macOS
 * and Linux a `\` is part of a name and stays in it (bd astro-plan-3pvvc), so
 * `folder/a\b.fits` ends in `a\b.fits`, not `b.fits`. Returns the whole path
 * when it ends in `/`.
 */
export function wireBasename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1) || path;
}

/** The separators of a native path: both under a Windows path, `/` otherwise. */
function nativeSeparators(path: string): RegExp {
  return isWindowsPath(path) ? /[/\\]/ : /\//;
}

/**
 * A native path written with `/` as its only separator, so it can be split
 * the way wire text is: under a Windows path (drive or UNC share) every `\`
 * becomes `/`; any other path is returned as it is, because there `\` is part
 * of a name (bd astro-plan-3pvvc).
 */
export function nativeWithSlashes(path: string): string {
  return isWindowsPath(path) ? path.replace(/\\/g, '/') : path;
}

/**
 * Return the last name of a native path, such as a source root from the
 * folder picker. A Windows path (drive or UNC share) splits on `/` and `\`;
 * any other path only on `/`, because there `\` is part of a name. For a path
 * from the backend use {@link wireBasename}.
 *
 * Previously duplicated in `features/inbox/inboxDetailHelpers.ts` and
 * `features/inbox/planPanelHelpers.ts` (both had identical bodies).
 *
 * Note: `InboxControls.tsx` has a distinct null-safe/trailing-slash-trim
 * variant (`basename(p: string | null | undefined): string | null`) that
 * keeps its own copy intentionally.
 */
export function basename(path: string): string {
  const parts = path.split(nativeSeparators(path));
  return parts[parts.length - 1] || path;
}

/**
 * Return the second-to-last name of a native path (the basename's parent
 * directory name), splitting as {@link basename} does. Returns an empty
 * string when the path has fewer than two names.
 *
 * Previously only in `features/inbox/inboxDetailHelpers.ts`.
 */
export function parentSegment(path: string): string {
  const parts = path.split(nativeSeparators(path)).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}
