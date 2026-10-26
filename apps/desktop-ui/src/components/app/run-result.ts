/**
 * The run-result contract every action host shares (src/api/ipc.ts module
 * header). An `Action.run`, a dialog commit and a settings write return the
 * library call's `ActionResult` unchanged, or nothing for a local action. A
 * host reports success only for `{ ok: true }` or no result, keeps the draft
 * on a failure, and words the failure from the message catalogue by its code:
 * no English crosses IPC.
 *
 * How a host shows a failure follows the library's `retry` hint
 * (`failureRoute`):
 * - `retry`: the same call may succeed again. A dialog stays open with the
 *   error and its action; beside a trigger, an ActionError offers Retry.
 * - `review`: something changed (a stale revision). The dialog closes and the
 *   error names what to review; no Retry.
 * - `refused`: a rule refused the call and nothing was written. The dialog
 *   closes and a Refusal shows beside the trigger.
 */
import type { ActionResult, LibraryErrorCode, LibraryFailure } from "@/api/ipc"
import type { Messages } from "@/lib/i18n"

/** What a run returns: the library call's result unchanged, or nothing for a local action. */
export type RunResult = ActionResult<unknown> | void

/** A run's return value, synchronous or not. */
export type RunOutcome = RunResult | Promise<RunResult>

/** Why a run did not succeed: the library's failure, or a run that rejected instead of resolving its result. */
export type RunFailure = LibraryFailure | { source: "rejected"; detail: string }

/** A run once it settled: success, or the failure to show. */
export type Settled = { ok: true } | { ok: false; failure: RunFailure }

export type FailureRoute = "retry" | "review" | "refused"

export function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return value instanceof Promise
}

/** The settled form of a result: no result is a success. */
export function settled(result: RunResult): Settled {
  return !result || result.ok ? { ok: true } : { ok: false, failure: result.failure }
}

/** Settles a pending run; a rejection becomes a `rejected` failure, so a host never stays busy. */
export function settlePending(outcome: Promise<RunResult>): Promise<Settled> {
  return outcome.then(settled, (rejection: unknown) => ({
    ok: false,
    failure: { source: "rejected", detail: rejection instanceof Error ? rejection.message : String(rejection) },
  }))
}

/** How a host shows the failure: the library's own hint; a transport failure or a rejection may succeed on retry. */
export function failureRoute(failure: RunFailure): FailureRoute {
  if (failure.source !== "library") return "retry"
  return failure.error.retry === "none" ? "refused" : failure.error.retry
}

const LIBRARY_FAILURE: Record<LibraryErrorCode, (m: Messages) => string> = {
  invalid_input: (m) => m.action_failure_invalid_input(),
  not_found: (m) => m.action_failure_not_found(),
  conflict: (m) => m.action_failure_conflict(),
  identity_conflict: (m) => m.action_failure_identity_conflict(),
  access_denied: (m) => m.action_failure_access_denied(),
  source_unavailable: (m) => m.action_failure_source_unavailable(),
  unsupported_format: (m) => m.action_failure_unsupported_format(),
  metadata_unreadable: (m) => m.action_failure_metadata_unreadable(),
  provider_unavailable: (m) => m.action_failure_provider_unavailable(),
  persistence_failure: (m) => m.action_failure_persistence_failure(),
  no_byte_proof: (m) => m.action_failure_no_byte_proof(),
  symlinks_unavailable: (m) => m.action_failure_symlinks_unavailable(),
  links_unsupported: (m) => m.action_failure_links_unsupported(),
  canceled: (m) => m.action_failure_canceled(),
  correction_unpatchable: (m) => m.action_failure_correction_unpatchable(),
  correction_format_unpatchable: (m) => m.action_failure_correction_format_unpatchable(),
  session_not_ready: (m) => m.action_failure_session_not_ready(),
  input_write_risk: (m) => m.action_failure_input_write_risk(),
}

/** The failure in the reader's language. An IPC failure's or a rejection's `detail` is a log diagnostic, never shown. */
export function failureMessage(m: Messages, failure: RunFailure): string {
  return failure.source === "library" ? LIBRARY_FAILURE[failure.error.code](m) : m.action_failure_unreachable()
}
