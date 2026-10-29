/**
 * The library IPC boundary and the action-result contract.
 *
 * Every call from this frontend to the rebuilt library runtime goes through
 * this module. It wraps the generated client,
 * `apps/desktop/src/bindings/library-index.ts`, which
 * `library_specta_builder()` exports from the command list that the
 * `platevault-library` host registers (`library_shell.rs`). No other module
 * imports the generated file: its DTO types and event names are re-exported
 * from here. Nothing here dispatches to a mock or validates through the
 * legacy `ContractError` shape.
 *
 * Contract for components and features:
 *
 * - `library.<command>(...args)` calls one registered command and resolves an
 *   `ActionResult`. It never rejects. An `Action.run` returns that result
 *   unchanged, so its runner reports success only for `{ ok: true }`.
 * - `{ ok: false, failure }` carries a `LibraryFailure`:
 *   - `source: "library"`: the library answered with its structured
 *     `ErrorResponse` and wrote nothing. No English crosses IPC: word the
 *     failure from the message catalogue by `error.code`. `retry` names the
 *     next step (`retry`, `review` or `none`); `identity`, `scope`,
 *     `currentRevision`, `successors`, `window` and `correction` name what
 *     the failure concerns.
 *   - `source: "ipc"`: no structured answer came back. The call failed in
 *     transport or in argument decoding, or the command is unknown to the
 *     host. `detail` is an English diagnostic for logs, never for display.
 * - A failure keeps the draft. Never show a result before `{ ok: true }`, and
 *   invalidate the affected queries only after it.
 * - `data(pending)` turns an `ActionResult` into its data or a thrown
 *   `LibraryError`, for a TanStack `queryFn` or `mutationFn`. `failureOf`
 *   reads the `LibraryFailure` back from a query or mutation error.
 * - Pass the revision, identity, digest and reviewed basis a command's
 *   request carries exactly as the previous read returned them; the library
 *   refuses a stale one with `conflict`.
 */
import { isTauri } from "@tauri-apps/api/core"
import * as generated from "../../../desktop/src/bindings/library-index"
import type { ErrorResponse, RetryAction } from "../../../desktop/src/bindings/library-index"

export type * from "../../../desktop/src/bindings/library-index"
export {
  APPLY_WAITING_EVENT,
  IMPORT_DEVICES_EVENT,
  MEASUREMENT_PROGRESS_EVENT,
  NATIVE_QUIT_CONFIRM_EVENT,
  NEW_CAPTURES_EVENT,
  SCAN_PROGRESS_EVENT,
} from "../../../desktop/src/bindings/library-index"

type Commands = typeof generated.commands

/** A command the library host registers, by its generated client name. */
export type LibraryCommand = keyof Commands

/** The arguments of `command`. */
export type LibraryArgs<C extends LibraryCommand> = Parameters<Commands[C]>

type Settled<C extends LibraryCommand> = Awaited<ReturnType<Commands[C]>>

type OkData<R> = R extends { status: "ok"; data: infer T } ? T : never

/** What `command` returns when it succeeds: the envelope's `data`, or the bare value of a command that cannot fail. */
export type LibraryData<C extends LibraryCommand> = [Settled<C>] extends [{ status: "ok" | "error" }]
  ? OkData<Settled<C>>
  : Settled<C>

/** Why a library call did not succeed. */
export type LibraryFailure =
  | { source: "library"; command: LibraryCommand; error: ErrorResponse }
  | { source: "ipc"; command: LibraryCommand; detail: string }

/** The outcome of one library call, as an action's `run` returns it. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; failure: LibraryFailure }

/** A `LibraryFailure` thrown for TanStack Query, which expects a failed read or write to reject. */
export class LibraryError extends Error {
  readonly failure: LibraryFailure

  constructor(failure: LibraryFailure) {
    super(`${failure.command}: ${failure.source === "library" ? failure.error.code : failure.detail}`)
    this.name = "LibraryError"
    this.failure = failure
  }
}

type LibraryClient = {
  readonly [C in LibraryCommand]: (...args: LibraryArgs<C>) => Promise<ActionResult<LibraryData<C>>>
}

/** Every registered command, resolving an `ActionResult` instead of rejecting. */
export const library: LibraryClient = Object.freeze(
  Object.fromEntries(
    Object.entries(generated.commands).map(([command, call]) => [
      command,
      (...args: unknown[]) =>
        settle(command as LibraryCommand, () => (call as (...callArgs: unknown[]) => Promise<unknown>)(...args)),
    ]),
  ),
) as LibraryClient

/** The data of a successful call; a failed one throws its `LibraryError`. */
export async function data<T>(pending: Promise<ActionResult<T>>): Promise<T> {
  const result = await pending
  if (result.ok) return result.data
  throw new LibraryError(result.failure)
}

/** True inside the desktop shell, where the library host answers; false in a browser preview or a test that sets up no shell. */
export function inShell(): boolean {
  return isTauri()
}

/** The `LibraryFailure` a query or mutation failed with; null for any other error. */
export function failureOf(error: unknown): LibraryFailure | null {
  return error instanceof LibraryError ? error.failure : null
}

/**
 * Settle one generated call. A fallible command's generated wrapper resolves
 * `{ status, data | error }` for any rejection that is not a JS `Error`, so a
 * Tauri string rejection, such as an unknown command, arrives as `error` too:
 * only a structured `ErrorResponse` counts as the library's answer. A
 * command that cannot fail resolves its data bare and rejects only in
 * transport.
 */
async function settle<T>(command: LibraryCommand, call: () => Promise<unknown>): Promise<ActionResult<T>> {
  let answer: unknown
  try {
    answer = await call()
  } catch (rejection) {
    return { ok: false, failure: failure(command, rejection) }
  }
  if (!isEnvelope(answer)) return { ok: true, data: answer as T }
  if (answer.status === "ok") return { ok: true, data: answer.data as T }
  return { ok: false, failure: failure(command, answer.error) }
}

type Envelope = { status: "ok"; data: unknown } | { status: "error"; error: unknown }

/** The generated wrapper's result object: exactly `status` plus `data` or `error`. */
function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null) return false
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes("status")) return false
  const { status } = value as { status: unknown }
  return (status === "ok" && keys.includes("data")) || (status === "error" && keys.includes("error"))
}

function failure(command: LibraryCommand, rejection: unknown): LibraryFailure {
  return isErrorResponse(rejection)
    ? { source: "library", command, error: rejection }
    : { source: "ipc", command, detail: describe(rejection) }
}

const RETRY_ACTIONS: Record<RetryAction, true> = { retry: true, review: true, none: true }

/** The library's structured answer: a string code, a known next step and its successor list. */
function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== "object" || value === null) return false
  const { code, retry, successors } = value as Record<string, unknown>
  return (
    typeof code === "string" &&
    typeof retry === "string" &&
    Object.hasOwn(RETRY_ACTIONS, retry) &&
    Array.isArray(successors)
  )
}

function describe(rejection: unknown): string {
  if (rejection instanceof Error) return rejection.message
  if (typeof rejection === "string") return rejection
  try {
    return JSON.stringify(rejection) ?? String(rejection)
  } catch {
    return String(rejection)
  }
}
