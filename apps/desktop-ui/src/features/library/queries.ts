/**
 * The library reads and writes of Home, Sessions, session intake and Import
 * (src/api). The Rust catalog is the truth: every read is a `libraryQuery`,
 * and a write refreshes the reads it can change once it settles.
 *
 * `homeWrite` refreshes after success and after `conflict`: a stale revision
 * means the read is old, so the next attempt must read the current one. Any
 * other failure keeps the reads, and the caller keeps the user's draft, as
 * they are. Imports settle from their durable `import_status`, never from
 * the reply to the write that started them.
 */
import { type QueryClient, type QueryKey, queryOptions, skipToken } from "@tanstack/react-query"
import { type ActionResult, data, type ImportOperation_Serialize, library, type LibraryCommand, type PlanCriteria } from "@/api/ipc"
import { libraryKey, libraryQuery } from "@/api/query"

/** How many sessions one Sessions read lists; the page names the rest it does not show. */
export const SESSION_PAGE = 500

/** The Sessions filters the library computes (LIB-FR-17, LIB-FR-18), `null` for all light sessions. */
export type SessionFilter = "needs_target" | "not_in_any_project" | "needs_calibration" | "trashed"

export const locationsQuery = () => libraryQuery("libraryListLocations")
export const newCapturesQuery = () => libraryQuery("libraryNewCaptures")
/** The latest scans, newest first: enough to know each location's last one. */
export const scansQuery = () => libraryQuery("libraryListOperations", null, 0, 200)
export const issuesQuery = () => libraryQuery("libraryIssues")
export const filterCountsQuery = () => libraryQuery("librarySessionFilterCounts")
export const sessionsQuery = (filter: SessionFilter | null) => libraryQuery("libraryListSessions", null, false, filter, 0, SESSION_PAGE)
export const sessionQuery = (sessionId: string) => libraryQuery("librarySession", sessionId)
export const admissionQuery = (sessionId: string) => libraryQuery("pixSessionIntake", sessionId)
export const rigQuery = (equipmentId: string) => libraryQuery("rigFiltersGet", equipmentId)
export const devicesQuery = () => libraryQuery("importDevicesList")
export const sourcesQuery = () => libraryQuery("importSourcesList")
export const importQuery = (importId: string) => libraryQuery("importStatus", importId)
/** Home's dashboard for `criteria`; it reads nothing while the Home criteria are unavailable (criteria.ts). */
export function dashboardQuery(criteria: PlanCriteria | null) {
  return queryOptions({
    queryKey: [...libraryKey("homeDashboard"), criteria] as const,
    queryFn: criteria ? () => data(library.homeDashboard({ criteria })) : skipToken,
  })
}

/** The reads a session or import write can change, by command. */
const LIBRARY_READS: readonly LibraryCommand[] = [
  "homeDashboard",
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
 * Run one import write. The import's own read takes the answer (it is the
 * import's state at its new revision); after a `conflict` the import is
 * read again, since the user saw an older revision.
 */
export async function importWrite(client: QueryClient, importId: string, write: () => Promise<ActionResult<ImportOperation_Serialize>>): Promise<ActionResult<ImportOperation_Serialize>> {
  const result = await write()
  const key = importQuery(importId).queryKey
  if (result.ok) client.setQueryData(key, result.data)
  else if (result.failure.source === "library" && result.failure.error.code === "conflict") await client.invalidateQueries({ queryKey: key })
  return result
}
