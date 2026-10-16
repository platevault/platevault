// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared error-normalisation helpers.
 *
 * Use these instead of ad-hoc `(err as Error).message`, `String(err)`, or
 * `err instanceof Error ? err.message : String(err)` patterns, which return
 * "[object Object]" when the caught value is a ContractError.
 */
import type { ContractError_Serialize as ContractError } from '@/bindings/index';
import { m } from '@/lib/i18n';
import { ERROR_MESSAGES, errorFallback } from './error-messages';

export type { ContractError };

/**
 * Record an error code that has no catalog mapping, for diagnosis (FR-010).
 * The user still sees only the safe generic fallback (FR-009/FR-011); this keeps
 * the precise code available internally so a missing translation is noticeable.
 */
function logUnmappedCode(code: string): void {
  console.error(`[errMessage] unmapped error code: ${code}`);
}

/**
 * Type guard: true when the thrown value looks like a `ContractError_Serialize`
 * (has a string `code` and `message`).
 */
export function isContractError(err: unknown): err is ContractError {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as Record<string, unknown>).code === 'string' &&
    typeof (err as Record<string, unknown>).message === 'string'
  );
}

/**
 * Extract a user-facing message from any thrown value. This is the single
 * translation point for backend errors (spec 046 FR-008): a ContractError's
 * `code` resolves to a friendly catalog message; its raw `message` (a backend
 * diagnostic string) and the raw code are NEVER shown to the user (FR-009).
 *
 * Priority:
 *  1. `export.unfinished_file` carrying `details.path` → the catalog message
 *     naming that path. It is the file the backend wrote, under the
 *     canonicalized parent, which the path the user chose may no longer reach
 *     once a symlink in it is retargeted.
 *  2. ContractError with a mapped code → catalog message `m.err_<code>()`
 *  3. ContractError with an unmapped/unknown code → generic catalog fallback,
 *     and the code is logged internally for diagnosis (FR-010, FR-011)
 *  4. native Error → `err.message`
 *  5. anything else → `String(err)`
 *
 * Never returns "[object Object]", a raw error code, or a backend exception
 * string for a ContractError.
 */
export function errMessage(err: unknown): string {
  if (isContractError(err)) {
    const leftover = unfinishedExportPath(err);
    if (leftover !== null) {
      return m.err_export_unfinished_file_at({ path: leftover });
    }
    // ERROR_MESSAGES is exhaustive over ErrorCode, but a runtime value could
    // still carry a code outside the union (e.g. a sub-enum string), so guard.
    const resolve = ERROR_MESSAGES[err.code] as (() => string) | undefined;
    if (resolve) return resolve();
    logUnmappedCode(err.code);
    return errorFallback();
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * The path an `export.unfinished_file` error reports in `details.path`, or
 * `null` for any other error or when the backend sent no usable path.
 */
function unfinishedExportPath(err: ContractError): string | null {
  if (err.code !== 'export.unfinished_file') return null;
  const { details } = err;
  if (typeof details !== 'object' || details === null) return null;
  const path = (details as Record<string, unknown>).path;
  return typeof path === 'string' && path.length > 0 ? path : null;
}

/**
 * Normalise any thrown value to a native `Error`, preserving the message.
 * Useful when an upstream API expects an `Error` instance.
 */
export function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(errMessage(err));
}
