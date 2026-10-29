/**
 * The Apply a Project runs now, as this window started it (066 VSEL-FR-14,
 * 069 PREP-FR-09/18). `project_apply` resolves only once the build settles,
 * so the run lives here, outside any tab: switching tabs or closing the
 * sheet never loses its outcome.
 *
 * - Running: the build goes on. `operationId` is what Cancel needs; the
 *   library names it in each `project_apply_waiting` event and in the Apply
 *   sheet's `operation_running` blocker, and Cancel stays unavailable until
 *   one of them has (the start is never acknowledged on its own). `held` is
 *   the file a tool holds in View while the Apply waits for it.
 * - Settled: the call's result unchanged. Only `{ ok: true }` with outcome
 *   `applied` is a success; `failed`, `canceled` and every refusal (a stale
 *   sheet's `conflict`, a blocker) are reported as such, never as applied.
 */
import type { QueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import { type ActionResult, type ApplyReport_Serialize, type ApplyRequest, type ApplyWaiting, library, type NativePathWire } from "@/api/ipc"
import { projectWrite } from "./queries"

export type ApplyRun =
  | { phase: "running"; operationId: string | null; held: NativePathWire | null; canceling: boolean }
  | { phase: "settled"; result: ActionResult<ApplyReport_Serialize> }

const runs = new Map<string, ApplyRun>()
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

/** Start the Apply the sheet reviewed: its revision, basis digest and ticked files, exactly as the sheet read them. */
export function startApply(client: QueryClient, request: ApplyRequest): void {
  const projectId = request.projectId
  if (runs.get(projectId)?.phase === "running") return
  set(projectId, { phase: "running", operationId: null, held: null, canceling: false })
  void projectWrite(client, () => library.projectApply(request)).then((result) => set(projectId, { phase: "settled", result }))
}

/** A waiting event: the run's operation id, and the file a tool holds (null: it no longer waits). */
export function applyWaiting(event: ApplyWaiting): void {
  const run = runs.get(event.projectId)
  if (run?.phase !== "running") return
  set(event.projectId, { ...run, operationId: event.operationId, held: event.held })
}

/** The operation id the Apply sheet's `operation_running` blocker names for a run that has none yet. */
export function applyOperationFound(projectId: string, operationId: string): void {
  const run = runs.get(projectId)
  if (run?.phase !== "running" || run.operationId !== null) return
  set(projectId, { ...run, operationId })
}

/**
 * Ask the running Apply to stop. It stops where it is safe and keeps the old
 * View, or finishes once the new View is being installed: the settled
 * report says which. A refused cancel (it already ended) leaves the run as
 * the build reports it.
 */
export async function cancelApply(projectId: string): Promise<ActionResult<null> | void> {
  const run = runs.get(projectId)
  if (run?.phase !== "running" || run.operationId === null) return
  set(projectId, { ...run, canceling: true })
  const result = await library.projectApplyCancel(run.operationId)
  const now = runs.get(projectId)
  if (result.ok) return
  if (now?.phase === "running") set(projectId, { ...now, canceling: false })
  return result
}

/** Put a settled run's report away. */
export function dismissApply(projectId: string): void {
  if (runs.get(projectId)?.phase === "settled") set(projectId, null)
}

/** Test seam: forget every run. */
export function resetApplyRuns(): void {
  runs.clear()
  for (const listener of listeners) listener()
}
