/**
 * User-facing error message map keyed by the generated ErrorCode union.
 *
 * Keys are checked against the real ErrorCode union so typos are caught at
 * build time. Add entries here when a new code needs a human-readable label.
 */
import type { ErrorCode } from '@/bindings/index';

export const ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  'path.not_exists': 'This directory does not exist',
  'path.not_directory': 'This path is not a directory',
  'path.permission_denied': 'Cannot read this directory — check permissions',
  'path.already_registered': 'This directory is already registered',
  'path.already_registered.different_kind':
    'This directory is registered under a different category',
};
