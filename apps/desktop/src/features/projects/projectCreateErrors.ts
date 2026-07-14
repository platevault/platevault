// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared `projects.create` error handling — spec 008 US1 / WP-008-B.
 *
 * Extracted from `CreateProjectDialog` (the original spec-008 US1 modal) so the
 * live wizard create path (`WizardPage`) can surface the same per-field error
 * mapping and live duplicate-name pre-check instead of one generic toast.
 * `CreateProjectDialog` remains a consumer of this module (its fate — restore
 * vs. delete — is a separate product decision, WP-008-A).
 *
 * `EditProjectPane` has its own `mapUpdateError()` — the `projects.update`
 * error codes/messages differ (e.g. `project.not_found`, `tool.locked`,
 * `lifecycle.read_only`) — so it intentionally is NOT merged into this module.
 */

import { m } from '@/lib/i18n';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { ProjectSummaryDto } from '@/bindings/index';

/** Which UI location a `projects.create` error code should be attached to. */
export type ProjectCreateErrorField = 'name' | 'tool' | 'path' | 'general';

/**
 * Map a `projects.create` error code to the field/step it belongs to, so a
 * caller with multiple steps/fields (e.g. the wizard) knows where to surface
 * it. Codes outside the known `name.*`/`tool.*`/`path.*` families (including
 * the generic fallback) map to `'general'`.
 */
export function projectCreateErrorField(code: string): ProjectCreateErrorField {
  if (code.startsWith('name.')) return 'name';
  if (code.startsWith('tool.')) return 'tool';
  if (code.startsWith('path.')) return 'path';
  return 'general';
}

/**
 * Map a `projects.create` error code to a user-facing message.
 *
 * Error codes surfaced: `name.empty`, `name.too_long`, `name.duplicate`,
 * `tool.unknown`, `path.invalid`, `path.collision`. Anything else falls back
 * to a generic message that still names the raw code for support/diagnosis.
 */
export function mapCreateProjectErrorCode(code: string): string {
  switch (code) {
    case 'name.empty':
      return m.projects_create_err_name_empty();
    case 'name.too_long':
      return m.projects_create_err_name_too_long();
    case 'name.duplicate':
      return m.projects_create_name_duplicate();
    case 'tool.unknown':
      return m.projects_create_err_tool_unknown();
    case 'path.invalid':
      return m.projects_create_err_path_invalid();
    case 'path.collision':
      return m.projects_create_err_path_collision();
    default:
      return m.projects_create_err_generic({ code });
  }
}

/**
 * Normalise a thrown `projects.create` error into a raw error code string.
 *
 * `unwrap()` (spec 037) throws the `ContractError_Serialize` payload itself on
 * an error result, so the common case is an object with a `.code` (the actual
 * error code, e.g. `"name.duplicate"`) and a `.message` (a raw diagnostic
 * string — never shown to the user). A caught value can also be a plain
 * string (some test doubles / mock rejections) or a native `Error`.
 */
export function createProjectErrorCode(err: unknown): string {
  if (typeof err === 'string') return err;
  if (
    err &&
    typeof err === 'object' &&
    typeof (err as { code?: unknown }).code === 'string'
  ) {
    return (err as { code: string }).code;
  }
  if (err instanceof Error) return err.message;
  return 'unknown';
}

/**
 * Live duplicate-name pre-check (spec 008 US1): queries the current project
 * list and does a case-insensitive match against the trimmed name. Non-fatal
 * on failure (offline/IPC error) — the backend still enforces uniqueness on
 * submit, so a failed pre-check just means the user finds out one step later.
 */
export async function findDuplicateProjectName(
  trimmedName: string,
): Promise<boolean> {
  try {
    const list: ProjectSummaryDto[] = unwrap(await commands.projectsList(null));
    return list.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase());
  } catch {
    return false;
  }
}
