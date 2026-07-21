// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `projects.update` error-code → message mapping for EditProjectPane
 * (extracted, #1000).
 *
 * Intentionally keeps edit-specific wording where it is clearer than the
 * shared catalog (e.g. "This project is archived and cannot be edited." vs.
 * the generic "This item is read-only"); any other known code falls through
 * to the shared errors.ts catalog before the generic fallback, so
 * consolidation doesn't regress coverage for codes this switch never named.
 */

import { m } from '@/lib/i18n';
import type { ErrorCode } from '@/bindings/index';
import { ERROR_MESSAGES } from '@/lib/error-messages';

export function mapUpdateError(code: string): string {
  switch (code) {
    case 'project.not_found':
      return m.projects_edit_err_not_found();
    case 'name.empty':
      return m.projects_edit_err_name_empty();
    case 'name.too_long':
      return m.projects_edit_err_name_too_long();
    case 'name.duplicate':
      return m.projects_create_name_duplicate();
    case 'tool.unknown':
      return m.projects_edit_err_tool_unknown();
    case 'tool.locked':
      return m.projects_edit_err_tool_locked();
    case 'lifecycle.read_only':
      return m.projects_edit_err_read_only();
    case 'no_op':
      return m.projects_edit_err_no_op();
    default: {
      const resolve = ERROR_MESSAGES[code as ErrorCode] as
        | (() => string)
        | undefined;
      return resolve ? resolve() : m.projects_edit_err_generic();
    }
  }
}
