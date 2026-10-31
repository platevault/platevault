/**
 * The Targets area's library reads and writes (src/api).
 *
 * Every read is a `libraryQuery`, so a write refreshes the reads it changes
 * by command name. The library computes every planning value: the Targets
 * rows, their night's Moon and darkness under Home's stored criteria
 * (`planning_target_rows`), one Target's row under the same context
 * (`targets_get`), a Target's windows (`planning_compute_windows`),
 * its goal gaps (`planning_target_gaps`) and tonight's goal grades
 * (`planning_tonight`). Nothing here derives a window, an altitude or an
 * offset.
 *
 * `targetsWrite` refreshes the reads after a write succeeds and after a
 * `conflict` (a stale revision or digest), so the next attempt names the
 * revision read now instead of repeating the stale one; any other failure
 * keeps the reads and the draft as they are.
 */
import { type QueryClient, type QueryKey, queryOptions, skipToken } from "@tanstack/react-query"
import { type ActionResult, data, library, type LibraryArgs, type LibraryCommand, type PlanCriteria, type RigSelection, type TargetsQuery_Deserialize } from "@/api/ipc"
import { libraryQuery } from "@/api/query"

/** `libraryQuery` while its arguments are known; until then the query waits and reads nothing. */
export function libraryQueryWhen<C extends LibraryCommand>(command: C, args: LibraryArgs<C> | null) {
  return queryOptions({
    queryKey: ["library", command, ...(args ?? [])] as readonly unknown[],
    queryFn: args ? () => data(library[command](...args)) : skipToken,
  })
}

/** How many rows one Targets page reads; the summary says when the list holds more. */
export const TARGET_PAGE = 1000

/** How many nights a Target's Plan area plans: the chosen night and the six after it. */
export const PLAN_NIGHTS = 7

/** How many reminder subscriptions one status read lists. */
const REMINDER_PAGE = 500

export const sitesQuery = () => libraryQuery("planningListSites")
/** The saved rigs by name: the rig selector's single rigs. */
export const equipmentQuery = () => libraryQuery("libraryListEquipment")
export const targetRowsQuery = (query: TargetsQuery_Deserialize) => libraryQuery("planningTargetRows", query)
export const presetsQuery = (rigs: RigSelection) => libraryQuery("targetsPresetsList", rigs)
export const searchQuery = (text: string) => libraryQuery("targetsSearch", text)
export const windowsQuery = (targetId: string, siteId: string, firstNight: string, criteria: PlanCriteria) =>
  libraryQuery("planningComputeWindows", { targetId, siteId, firstNight, nights: PLAN_NIGHTS, criteria })
export const gapsQuery = (targetId: string) => libraryQuery("planningTargetGaps", targetId)
export const tonightQuery = (night: string | null) => libraryQuery("planningTonight", { night })
export const reminderStatusQuery = () => libraryQuery("planningReminderStatus", 0, REMINDER_PAGE)
/** The stored lead time a new reminder starts from (PLAN-FR-06). */
export const reminderLeadTimeQuery = () => libraryQuery("planningReminderLeadTime")

/** My targets under Home's stored criteria: the palette lists a Target among these rows. */
export function myTargetsRequest(siteId: string | null = null, night: string | null = null): TargetsQuery_Deserialize {
  return { show: "my_targets", siteId, night, limit: TARGET_PAGE }
}

/**
 * The reads a Targets write can change: the lists and search results that
 * show a favourite or a preset, every planning read (a criteria or Moon
 * limits change moves them), the reminder state, Home's Tonight, which
 * names favourites, and the Projects list's rows, whose "Plan tonight"
 * reads tonight's windows.
 */
const TARGET_READS: readonly LibraryCommand[] = [
  "planningTargetRows",
  "targetsGet",
  "targetsSearch",
  "targetsPresetsList",
  "planningComputeWindows",
  "planningTargetGaps",
  "planningTonight",
  "planningCalendar",
  "planningReminderStatus",
  "planningReviewReminders",
  "planningReviewCalendarExport",
  "workflowSettingsGet",
  "homeDashboard",
  "projectRows",
]

function isTargetRead(key: QueryKey): boolean {
  return key[0] === "library" && TARGET_READS.includes(key[1] as LibraryCommand)
}

/** Refresh every read a Targets write can change. */
export function invalidateTargetReads(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ predicate: (query) => isTargetRead(query.queryKey) })
}

/** True for the library's stale-revision answer. */
export function isConflict(result: ActionResult<unknown>): boolean {
  return !result.ok && result.failure.source === "library" && result.failure.error.code === "conflict"
}

/**
 * Run one Targets write and refresh the reads it changes once it settles
 * with success or `conflict`. The result passes through unchanged, so an
 * Action's runner reports success only for `{ ok: true }`.
 */
export async function targetsWrite<T>(client: QueryClient, write: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const result = await write()
  if (result.ok || isConflict(result)) await invalidateTargetReads(client)
  return result
}
