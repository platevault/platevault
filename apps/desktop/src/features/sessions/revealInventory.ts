// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sessions row-Reveal IPC helper (spec 037 caller migration).
 *
 * Moves the inventory-row reveal glue off the hand-written `@/api/commands`
 * wrapper onto the generated `commands.nativeReveal` binding (FR-004: the
 * behaviour is moved, not dropped). The native reveal is tagged with an
 * `inventory_row` audit context so spec-004 / spec-006 FR-007 audit
 * correlation is preserved, and the generated `Result` is unwrapped into the
 * throw-on-error contract the caller toasts on.
 */

import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';

/**
 * Resolve a session's reveal target: the source root joined with the session's
 * frame folder (`relativePath`, #567), so reveal opens the session's actual
 * frame folder instead of the shared library root. Falls back to the root when
 * the session has no relative path (legacy/unscanned sessions).
 *
 * Backend contract: `relativePath` is ALWAYS forward-slash, even on Windows —
 * the scanner normalizes separators (`crates/app/inbox/src/scan.rs`
 * `replace('\\', "/")`) — while the root (`source.path`) is native (backslash
 * on Windows, from the folder picker). The joined path is handed to the
 * OS-native reveal command, whose Windows select-item shell call rejects
 * forward slashes, so every separator (boundary AND internal) is rewritten to
 * the root's native one. `pathe.join` is unsuitable here because it rewrites
 * backslashes to forward slashes.
 */
export function resolveRevealPath(
  rootPath: string,
  relativePath: string | null | undefined,
): string {
  if (!relativePath) return rootPath;
  const sep = rootPath.includes('\\') ? '\\' : '/';
  const root = rootPath.replace(/[/\\]+$/, '');
  const rel = relativePath.replace(/^[/\\]+/, '').replace(/[/\\]+/g, sep);
  return `${root}${sep}${rel}`;
}

export async function revealInventoryPath(args: {
  path: string;
  sessionId?: string;
}): Promise<void> {
  unwrap(
    await commands.nativeReveal({
      requestId: crypto.randomUUID(),
      path: args.path,
      entityKind: 'inventory_row',
      entityId: args.sessionId ?? null,
    }),
  );
}
