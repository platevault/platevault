/**
 * Maps a target-operation `ContractError.code` to a user-readable, localized
 * message.
 *
 * Extracted from `TargetDetailV2.tsx` so the mapping can be unit-tested directly
 * (see `target-identity.test.ts`) instead of via a hand-copied mirror that
 * silently drifts from production.
 */

import { m } from '@/lib/i18n';
import type { ContractError } from '@/lib/errors';

/**
 * Map a target `ContractError.code` to a user-readable, localized message.
 * Returns `fallback` for any unrecognized code.
 */
export function errorMessage(err: ContractError, fallback: string): string {
  switch (err.code) {
    case 'alias.blank':
      return m.targets_detail_alias_blank();
    case 'alias.not_found':
      return m.targets_detail_alias_not_found();
    case 'alias.not_removable':
      return m.targets_detail_alias_not_removable();
    case 'target.not_found':
      return m.targets_detail_target_not_found();
    case 'target.invalid_id':
      return m.targets_detail_invalid_target_id();
    case 'note.content_too_large':
      return m.err_note_content_too_large();
    default:
      return fallback;
  }
}
