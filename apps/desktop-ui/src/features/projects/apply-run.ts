/**
 * The Apply a Project runs now, as this window started it (066 VSEL-FR-14,
 * 069 PREP-FR-09/18). `project_apply` returns as soon as the library
 * reserved the Project, Running with the operation id, and the build runs
 * on; the run lives here, outside any tab, and follows the durable
 * `project_apply_status` by that id, so switching tabs or closing the sheet
 * never loses its state or its outcome.
 *
 * - Starting: `project_apply` is in flight; there is no id to cancel yet.
 * - Running: the build goes on. `progress.waiting` is the folder a tool
 *   holds in View and since when, as the status reads it; a
 *   `project_apply_waiting` event only asks for a fresh read. Cancel asks by
 *   the id and reads Running with Cancel requested until the build stops.
 *   A status read that failed leaves it Running, with `readFailure` until a
 *   read succeeds, and the next read goes ahead: it says nothing of how the
 *   build goes.
 * - Stopped: nothing runs it; the next start restores the old View or
 *   finishes it. `error` is why its run broke off; null when the app closed
 *   during it.
 * - Settled: only `{ ok: true }` with outcome `applied` is a success;
 *   `failed`, `canceled` and every refusal (a stale sheet's `conflict`, a
 *   blocker) are reported as such, never as applied.
 */
import type { QueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import { type ActionResult, type ApplyProgress, type ApplyReport_Serialize, type ApplyRequest, type ApplyStatus_Serialize, type ApplyWaiting, type ErrorResponse, type LibraryFailure, library } from "@/api/ipc"
import { invalidateProjectReads, projectWrite } from "./queries"

export type ApplyRun =
  | { phase: "starting" }
  | { phase: "running"; progress: ApplyProgress; cancelRequested: boolean; readFailure: LibraryFailure | null }
  | { phase: "stopped"; progress: ApplyProgress; error: ErrorResponse | null }
  | { phase: "settled"; result: ActionResult<ApplyReport_Serialize> }

/** How often a running Apply's durable status is read. */
export const APPLY_STATUS_POLL_MS = 1000

const runs = new Map<string, ApplyRun>()
const polls = new Map<string, ReturnType<typeof setTimeout>>()
const clients = new Map<string, QueryClient>()
const listeners = new Set<() => void>()

function set(projectId: string, run: ApplyRun | null) {
  if (run) runs.set(projectId, run)
  else runs.delete(projectId)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The Apply of `projectId` this window started, or null. */
export function useApplyRun(projectId: string): ApplyRun | null {
  return useSyncExternalStore(subscribe, () => runs.get(projectId) ?? null)
}

/** Read the status again after `APPLY_STATUS_POLL_MS`, replacing any read already scheduled. */
function poll(projectId: string) {
  clearTimeout(polls.get(projectId))
  polls.set(
    projectId,
    setTimeout(() => void refresh(projectId), APPLY_STATUS_POLL_MS),
  )
}

/** Take in a status read: keep following a running Apply; a settled one re-reads the Project. */
function follow(projectId: string, status: ApplyStatus_Serialize) {
  if (status.state === "running") {
    set(projectId, { phase: "running", progress: status.progress, cancelRequested: status.cancelRequested, readFailure: null })
    poll(projectId)
    return
  }
  clearTimeout(polls.get(projectId))
  polls.delete(projectId)
  set(projectId, status.state === "stopped" ? { phase: "stopped", progress: status.progress, error: status.error } : { phase: "settled", result: { ok: true, data: status.report } })
  const client = clients.get(projectId)
  clients.delete(projectId)
  if (client) void invalidateProjectReads(client)
}

/** Read the running Apply's durable status now. A failed read is shown beside Cancel and read again, never taken for an outcome: the build goes on. */
async function refresh(projectId: string) {
  const run = runs.get(projectId)
  if (run?.phase !== "running") return
  const result = await library.projectApplyStatus(run.progress.operationId)
  // A run dismissed or replaced meanwhile keeps what it holds now.
  const now = runs.get(projectId)
  if (now?.phase !== "running" || now.progress.operationId !== run.progress.operationId) return
  if (result.ok) follow(projectId, result.data)
  else {
    set(projectId, { ...now, readFailure: result.failure })
    poll(projectId)
  }
}

/** Start the Apply the sheet reviewed: its revision, basis digest and ticked files, exactly as the sheet read them. */
export function startApply(client: QueryClient, request: ApplyRequest): void {
  const projectId = request.projectId
  const current = runs.get(projectId)?.phase
  if (current === "starting" || current === "running") return
  set(projectId, { phase: "starting" })
  clients.set(projectId, client)
  void projectWrite(client, () => library.projectApply(request)).then((result) => {
    if (result.ok) follow(projectId, result.data)
    else {
      clients.delete(projectId)
      set(projectId, { phase: "settled", result })
    }
  })
}

/** A waiting event: the wait for a tool began or ended, so read the status again. */
export function applyWaiting(event: ApplyWaiting): void {
  const run = runs.get(event.projectId)
  if (run?.phase === "running" && run.progress.operationId === event.operationId) void refresh(event.projectId)
}

/**
 * Ask the running Apply to stop. It stops where it is safe and keeps the old
 * View, or finishes once the new View is being installed: the settled
 * report says which. Cancel itself never reads as an outcome; a refused
 * Cancel is returned for its trigger to show.
 */
export async function cancelApply(projectId: string): Promise<ActionResult<null> | void> {
  const run = runs.get(projectId)
  if (run?.phase !== "running") return { ok: false, failure: { source: "ipc", command: "projectApplyCancel", detail: "no running Apply" } }
  const result = await library.projectApplyCancel(run.progress.operationId)
  if (!result.ok) return result
  if (runs.get(projectId)?.phase === "running") follow(projectId, result.data)
}

/** Put a settled or stopped run away. */
export function dismissApply(projectId: string): void {
  const phase = runs.get(projectId)?.phase
  if (phase === "settled" || phase === "stopped") set(projectId, null)
}

/** Test seam: forget every run. */
export function resetApplyRuns(): void {
  for (const poll of polls.values()) clearTimeout(poll)
  polls.clear()
  clients.clear()
  runs.clear()
  for (const listener of listeners) listener()
}
