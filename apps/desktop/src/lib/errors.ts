/**
 * Shared error-normalisation helpers.
 *
 * Use these instead of ad-hoc `(err as Error).message`, `String(err)`, or
 * `err instanceof Error ? err.message : String(err)` patterns, which return
 * "[object Object]" when the caught value is a ContractError.
 */
import type { ContractError_Serialize as ContractError } from '@/bindings/index';
import { ERROR_MESSAGES } from './error-messages';

export type { ContractError };

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
 * Extract a user-facing message from any thrown value.
 *
 * Priority:
 *  1. ContractError with a known code → `ERROR_MESSAGES[code]`
 *  2. ContractError with an unknown code → `err.message`
 *  3. native Error → `err.message`
 *  4. anything else → `String(err)`
 *
 * Never returns "[object Object]".
 */
export function errMessage(err: unknown): string {
  if (isContractError(err)) {
    return ERROR_MESSAGES[err.code] ?? err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Normalise any thrown value to a native `Error`, preserving the message.
 * Useful when an upstream API expects an `Error` instance.
 */
export function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(errMessage(err));
}
