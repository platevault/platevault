/**
 * Library call outcomes for the catalogue's action, dialog and save
 * specimens, and for component tests: a success, and a structured library
 * failure as `src/api/ipc.ts` resolves it. Catalogue and test only.
 */
import type { ActionResult, ErrorResponse, LibraryCommand, LibraryErrorCode, RetryAction } from "@/api/ipc"

/** A call that succeeded with no data the caller reads. */
export const SUCCEEDED: ActionResult<null> = { ok: true, data: null }

/** The library's structured refusal of `command` with `code`; `retry` is the library's next-step hint. */
export function libraryFailure(code: LibraryErrorCode, retry: RetryAction, command: LibraryCommand = "libraryUpdateLocation"): ActionResult<never> {
  const error: ErrorResponse = { code, identity: null, scope: null, retry, currentRevision: null, successors: [], window: null, correction: null }
  return { ok: false, failure: { source: "library", command, error } }
}

/** Resolves `result` after `ms`, so a specimen shows its pending state first. */
export function after<T>(ms: number, result: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(result), ms))
}
