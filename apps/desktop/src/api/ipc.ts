/**
 * Single IPC dispatch point (spec 037).
 *
 * The generated tauri-specta bindings (`bindings/index.ts`) are post-processed
 * to import their `invoke` from THIS module instead of `@tauri-apps/api/core`
 * (see `apps/desktop/src-tauri/tests/bindings.rs`). That makes every generated
 * `commands.*` call inherit:
 *   - mock mode (`VITE_USE_MOCKS`) → `mocks.ts` `mockInvoke`, and
 *   - the spec-021 dev-tools recording proxy via `setInvokeOverride`.
 *
 * Keep this module dependency-light: it must not import `commands.ts` (which
 * imports from here), and it loads mocks / the real tauri core lazily.
 */

import { z } from 'zod';

// ── T118: Zod validation for dynamic/drift-prone IPC payloads ──────────────
//
// `ContractError` is the primary drift-prone payload at the IPC error seam.
// Its `details` field is typed `unknown` in the generated bindings and carries
// free-form JSON that the backend can change without a TS type update.
// We validate the mandatory envelope fields so a backend regression (e.g. a
// missing `code` or a renamed `message` key) is surfaced immediately as a
// clear validation error rather than a silent undefined downstream.
//
// Validation is NON-BREAKING: every currently-valid ContractError payload
// (all existing mocks and tests) satisfies this schema.  An entirely unknown
// error shape (e.g. a plain string from Tauri itself) is detected and
// rethrown with a descriptive message.

/** Zod schema for the mandatory `ContractError` envelope fields (T118). */
export const ContractErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  severity: z.string(),
  retryable: z.boolean(),
  // `details` is intentionally unknown/unconstrained — it is the free-form
  // blob we are watching for drift; we accept any JSON value here.
  details: z.unknown().optional(),
  fieldErrors: z.array(z.unknown()).optional(),
  recoveryActions: z.array(z.unknown()).optional(),
});

export type ValidatedContractError = z.infer<typeof ContractErrorSchema>;

/**
 * Validate a raw IPC error payload as a `ContractError`.
 * Returns the validated object on success; throws a descriptive
 * `IpcPayloadValidationError` on failure so drift is surfaced immediately.
 */
export function validateContractError(raw: unknown): ValidatedContractError {
  const result = ContractErrorSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  throw new IpcPayloadValidationError(
    'ContractError',
    result.error.flatten().fieldErrors,
    raw,
  );
}

/** Thrown when an IPC payload fails zod validation (T118). */
export class IpcPayloadValidationError extends Error {
  constructor(
    public readonly payloadType: string,
    public readonly fieldErrors: Record<string, string[] | undefined>,
    public readonly raw: unknown,
  ) {
    super(
      `IPC payload validation failed for ${payloadType}: ` +
        JSON.stringify(fieldErrors) +
        ` — raw: ${JSON.stringify(raw)}`,
    );
    this.name = 'IpcPayloadValidationError';
  }
}

const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';

/**
 * Optional recording-proxy override installed by the dev-tools bootRecorder
 * (spec 021, T075 / SC-002). Null in release builds (zero overhead).
 */
let _invokeOverride:
  | ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>)
  | null = null;

/** Install a recording proxy over the IPC dispatcher (dev-tools builds only). */
export function setInvokeOverride(
  fn:
    | ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>)
    | null,
): void {
  _invokeOverride = fn;
}

/**
 * Dispatch an IPC command. Signature-compatible with `@tauri-apps/api/core`'s
 * `invoke` so the generated bindings can call it unchanged.
 */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (_invokeOverride) {
    return _invokeOverride(cmd, args) as Promise<T>;
  }
  if (useMocks) {
    const { mockInvoke } = await import('./mocks');
    // `mockInvoke` returns `Promise<unknown>`; the caller picks the concrete `T`
    // from the generated bindings, so narrowing happens here at the boundary.
    return mockInvoke(cmd, args) as Promise<T>;
  }
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

/** A generated tauri-specta `Result` value. */
export type IpcResult<T, E = unknown> =
  | { status: 'ok'; data: T }
  | { status: 'error'; error: E };

/**
 * Translate a generated `Result` into the throw-on-error contract the app's
 * call sites expect: returns `data` on success, throws `error` otherwise.
 *
 * T118: When the error branch carries an object-shaped payload (i.e. a
 * `ContractError` from the backend), the mandatory envelope fields are validated
 * via zod before re-throwing.  This surfaces backend drift (e.g. a renamed `code`
 * key, a missing `message`) as a clear `IpcPayloadValidationError` rather than a
 * silent `undefined` somewhere downstream.
 *
 * Plain string errors (older commands) and `Error` instances are passed through
 * unchanged so no existing behaviour is broken.
 */
export function unwrap<T, E = unknown>(result: IpcResult<T, E>): T {
  if (result.status === 'ok') {
    return result.data;
  }
  const err = result.error;
  // Validate object-shaped errors as ContractError envelopes (T118).
  if (
    err !== null &&
    typeof err === 'object' &&
    !Array.isArray(err) &&
    !(err instanceof Error)
  ) {
    // Run validation; if it throws IpcPayloadValidationError we let that propagate
    // so the caller sees exactly what drifted.  On success we rethrow the original.
    validateContractError(err);
  }
  throw err;
}
