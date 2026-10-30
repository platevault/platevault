/**
 * The library reads and writes of Home, Sessions, session intake and Import
 * (src/api). The Rust catalog is the truth: every read is a `libraryQuery`,
 * and a write refreshes the reads it can change once it settles.
 *
 * `homeWrite` refreshes after success and after `conflict`: a stale revision
 * means the read is old, so the next attempt must read the current one. Any
 * other failure keeps the reads, and the caller keeps the user's draft, as
 * they are. `importWrite` does the same for the import's own read: the page
 * shows an import only as `import_status` reads it, never from the reply to
 * the write, so a start or a Retry settles from the durable status.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query"
import type { ActionResult, ImportOperation_Serialize, LibraryCommand } from "@/api/ipc"
import { libraryQuery } from "@/api/query"

/** How many sessions one Sessions read lists; the page names the rest it does not show. */
export const SESSION_PAGE = 500

/** The Sessions filters the library computes (LIB-FR-17, LIB-FR-18), `null` for all light sessions. */
export type SessionFilter = "needs_target" | "not_in_any_project" | "needs_calibration" | "trashed"

export const locationsQuery = () => libraryQuery("libraryListLocations")
export const newCapturesQuery = () => libraryQuery("libraryNewCaptures")
/** One Captures location's last scan: `library_list_operations` lists newest first, so the first row is it. */
export const lastScanQuery = (locationId: string) => libraryQuery("libraryListOperations", locationId, 0, 1)
export const issuesQuery = () => libraryQuery("libraryIssues")
export const filterCountsQuery = () => libraryQuery("librarySessionFilterCounts")
export const sessionsQuery = (filter: SessionFilter | null) => libraryQuery("libraryListSessions", null, false, filter, 0, SESSION_PAGE)
export const sessionQuery = (sessionId: string) => libraryQuery("librarySession", sessionId)
export const admissionQuery = (sessionId: string) => libraryQuery("pixSessionIntake", sessionId)
export const rigQuery = (equipmentId: string) => libraryQuery("rigFiltersGet", equipmentId)
export const devicesQuery = () => libraryQuery("importDevicesList")
export const sourcesQuery = () => libraryQuery("importSourcesList")
export const importQuery = (importId: string) => libraryQuery("importStatus", importId)
/** Home's dashboard for tonight; the library computes Tonight under Home's stored criteria (criteria.ts). */
export const dashboardQuery = () => libraryQuery("homeDashboard", {})
/** Home's calendar: `nights` nights from `firstNight` (site-local evening dates), computed by the library under Home's stored criteria (PLAN-FR-12). */
export const calendarQuery = (firstNight: string, nights: number) => libraryQuery("planningCalendar", { firstNight, nights })

/** The reads a session or import write can change, by command. */
const LIBRARY_READS: readonly LibraryCommand[] = [
  "homeDashboard",
  // Home's criteria: a save or a conflict re-reads them, so the next save names the current revision.
  "planningHomeCriteria",
  "planningCalendar",
  // The Targets list reads Home's stored criteria and the sessions' Targets, so either write moves its rows.
  "planningTargetRows",
  "libraryListSessions",
  "librarySessionFilterCounts",
  "librarySession",
  "pixSessionIntake",
  "libraryIssues",
  "libraryNewCaptures",
  "libraryListOperations",
  "calibrationNeeds",
  "projectList",
  "projectCandidates",
  // Add to Project computes its addition at the Project's and the session's revisions; a write moves them.
  "projectPreviewSessionAddition",
]

function isLibraryRead(key: QueryKey): boolean {
  return key[0] === "library" && LIBRARY_READS.includes(key[1] as LibraryCommand)
}

/** Refresh every read a session or import write can change. */
export function invalidateLibraryReads(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ predicate: (query) => isLibraryRead(query.queryKey) })
}

/**
 * Run one write and refresh the reads it changes once it settles with
 * success or `conflict`. The result passes through unchanged, so an
 * Action's runner reports success only for `{ ok: true }` and words the
 * failure itself.
 */
export async function homeWrite<T>(client: QueryClient, write: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const result = await write()
  if (result.ok || (result.failure.source === "library" && result.failure.error.code === "conflict")) await invalidateLibraryReads(client)
  return result
}

/**
 * Run one import write and re-read the import's durable status once it
 * settles with success or `conflict`: the reply is never shown as the
 * import's state. Any other failure keeps the read and the user's draft.
 */
export async function importWrite(client: QueryClient, importId: string, write: () => Promise<ActionResult<ImportOperation_Serialize>>): Promise<ActionResult<ImportOperation_Serialize>> {
  const result = await write()
  if (result.ok || (result.failure.source === "library" && result.failure.error.code === "conflict")) await client.invalidateQueries({ queryKey: importQuery(importId).queryKey })
  return result
}
