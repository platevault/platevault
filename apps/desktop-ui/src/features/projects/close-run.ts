/**
 * The Close project… this window started, per Project (065 PRJ-FR-14/25,
 * 071 STO-FR-08), outside any tab like the Apply run (`apply-run.ts`):
 * `project_close` resolves only once its archive settles or stops, so
 * leaving Wrap up and coming back keeps Stop and the report.
 *
 * - Running: the archive goes on; Stop asks it to halt before its next
 *   durable step.
 * - Settled: the call's result unchanged. A report whose archive did not
 *   settle (a stop) leaves the Project Closing; the next start resumes it.
 */
import type { QueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"
import { type ActionResult, type CloseReport_Serialize, type CloseRequest, library } from "@/api/ipc"
import { projectWrite } from "./queries"

export type CloseRun = { phase: "running" } | { phase: "settled"; result: ActionResult<CloseReport_Serialize> }

const runs = new Map<string, CloseRun>()
const listeners = new Set<() => void>()

function set(projectId: string, run: CloseRun | null) {
  if (run) runs.set(projectId, run)
  else runs.delete(projectId)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useCloseRun(projectId: string): CloseRun | null {
  return useSyncExternalStore(subscribe, () => runs.get(projectId) ?? null)
}

/** Close the Project as reviewed; resolves the call's result, which the run also keeps. */
export async function startClose(client: QueryClient, request: CloseRequest): Promise<ActionResult<CloseReport_Serialize>> {
  set(request.projectId, { phase: "running" })
  const result = await projectWrite(client, () => library.projectClose(request))
  // A refused Close changed nothing: the step shows the refusal beside Close project, not a report.
  set(request.projectId, result.ok ? { phase: "settled", result } : null)
  return result
}

/** Stop the running archive before its next durable step; a refusal (no Close runs here) is returned for its trigger to show. */
export async function stopClose(projectId: string): Promise<ActionResult<null> | void> {
  const result = await library.projectCloseStop(projectId)
  return result.ok ? undefined : result
}

/** Test seam: forget every run. */
export function resetCloseRuns(): void {
  runs.clear()
  for (const listener of listeners) listener()
}
