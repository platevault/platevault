/**
 * The Project area's library reads and writes (src/api).
 *
 * Every read is a `libraryQuery`, so a write invalidates the reads it
 * changes by command name. A Project's desired state (groups, sessions,
 * captures, View settings) advances one revision, `ProjectDesired.revision`
 * from `project_inputs`: every desired-state write echoes it, and the
 * library refuses a stale one with `conflict` (065 PRJ-FR-31, 066
 * VSEL-FR-21). `projectWrite` refreshes the Project's reads after a write
 * succeeds and after a `conflict`, so the next attempt reads the current
 * revision instead of repeating the stale one; any other failure keeps the
 * reads and the draft as they are.
 *
 * The full Project record (name, notes, subjects with their Targets, rigs,
 * goals, closedAt) has no read yet (astro-plan-wre19.3, `project_get`). The
 * header reads `project_list`'s summary; `useProjectRecord` is the one place
 * that changes when the read lands. Until then it reports the record as
 * unavailable, and every edit that replaces a whole list (subjects, rigs,
 * goals, notes) is refused with that reason instead of guessing the list.
 */
import { type QueryClient, type QueryKey, useQuery } from "@tanstack/react-query"
import { type ActionResult, type LibraryCommand, type Project, type ProjectSummary } from "@/api/ipc"
import { libraryKey, libraryQuery } from "@/api/query"

/** How many Projects one `project_list` page reads: the list page and the header read the same page. */
export const PROJECT_PAGE = 1000

/** Every Project, open and closed, by name. */
export const projectsQuery = () => libraryQuery("projectList", null, true, 0, PROJECT_PAGE)

export const inputsQuery = (projectId: string) => libraryQuery("projectInputs", projectId)
export const progressQuery = (projectId: string) => libraryQuery("projectProgress", projectId)
export const wrapUpStatusQuery = (projectId: string) => libraryQuery("projectWrapUpStatus", projectId)
export const closedSnapshotQuery = (projectId: string) => libraryQuery("projectClosedSnapshot", projectId)
export const applyPreviewQuery = (projectId: string) => libraryQuery("projectApplyPreview", projectId)
export const previousItemsQuery = (projectId: string) => libraryQuery("projectPreviousItems", projectId)
export const candidatesQuery = (projectId: string) => libraryQuery("projectCandidates", projectId)
export const sessionQuery = (sessionId: string) => libraryQuery("librarySession", sessionId)
export const rigQuery = (rigId: string) => libraryQuery("rigFiltersGet", rigId)
export const locationsQuery = () => libraryQuery("libraryListLocations")

/**
 * The reads a Project write can change, by command: the Project's own, the
 * lists and counts that say which sessions a Project holds, and the issues
 * (View (previous)/ to review, failed work).
 */
const PROJECT_READS: readonly LibraryCommand[] = [
  "projectList",
  "projectInputs",
  "projectProgress",
  "projectCandidates",
  "projectApplyPreview",
  "projectPreviousItems",
  "projectWrapUpStatus",
  "projectClosedSnapshot",
  "projectCleanUpReview",
  "projectTrashReview",
  "projectWrapUpArchiveReview",
  "projectOutputRescan",
  "libraryListSessions",
  "librarySessionFilterCounts",
  "libraryIssues",
]

/** Refresh every read a Project write can change. */
export function invalidateProjectReads(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ predicate: (query) => isProjectRead(query.queryKey) })
}

function isProjectRead(key: QueryKey): boolean {
  return key[0] === "library" && PROJECT_READS.includes(key[1] as LibraryCommand)
}

/**
 * Run one Project write and refresh the reads it changes once it settles
 * with success or `conflict` (the reads are stale then). The result passes
 * through unchanged, so an Action's runner reports success only for
 * `{ ok: true }` and words the failure itself.
 */
export async function projectWrite<T>(client: QueryClient, write: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const result = await write()
  if (result.ok || (result.failure.source === "library" && result.failure.error.code === "conflict")) await invalidateProjectReads(client)
  return result
}

/** One Project's header: what `project_list` says of it. */
export type ProjectHeader = ProjectSummary

/** A Closing, Closed or Archived Project is locked for good: no edit, no Apply, no Wrap up step (PRJ-FR-32). */
export function isLocked(lifecycle: ProjectSummary["lifecycle"]): boolean {
  return lifecycle !== "open"
}

/** The Project `projectId` from the list read; `undefined` while it loads, `null` when no Project has that id. */
export function useProjectHeader(projectId: string): { header: ProjectHeader | null | undefined; error: unknown } {
  const list = useQuery(projectsQuery())
  const header = list.data ? (list.data.find((p) => p.id === projectId) ?? null) : undefined
  return { header, error: list.error }
}

/**
 * The full Project record, or `unavailable` while the library has no read
 * of it (astro-plan-wre19.3). Switch this one function to
 * `useQuery(libraryQuery("projectGet", projectId))` when `project_get`
 * lands; every caller already handles both states.
 */
export function useProjectRecord(_projectId: string): { state: "unavailable" } | { state: "ready"; project: Project } {
  return { state: "unavailable" }
}

/** The key of every read of `command` for one Project. */
export function projectKey(command: LibraryCommand, projectId: string): QueryKey {
  return [...libraryKey(command), projectId]
}
