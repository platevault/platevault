/**
 * The Settings, setup and Activity reads and writes (src/api). The Rust
 * catalog and the library's settings are the truth: every section reads
 * them here and shows nothing it did not read.
 *
 * `settingsWrite` runs one write and, once it settles with success or
 * `conflict`, refreshes every library read: a setting reaches other areas
 * (a rig the Targets Fit, a location Home's ingestions), and a stale
 * revision means the read is old, so the next attempt names the current
 * one. Only mounted reads are read again. Any other failure keeps the reads
 * as they are, and the caller keeps the user's draft.
 */
import type { QueryClient } from "@tanstack/react-query"
import type { ActionResult } from "@/api/ipc"
import { libraryQuery } from "@/api/query"

/** How many durable operations one Activity read lists per kind; the page names the rest it does not show. */
export const ACTIVITY_PAGE = 200

export const locationsQuery = () => libraryQuery("libraryListLocations")
/** Every location's scans, newest first: Activity's list. */
export const scansQuery = () => libraryQuery("libraryListOperations", null, 0, ACTIVITY_PAGE)
/** One location's newest scan: `library_list_operations` lists newest first, so its one row is it. */
export const lastScanQuery = (locationId: string) => libraryQuery("libraryListOperations", locationId, 0, 1)
export const rigsQuery = () => libraryQuery("libraryListRigFilters")
export const camerasQuery = () => libraryQuery("libraryListCameras")
export const workflowQuery = () => libraryQuery("workflowSettingsGet")
export const namingQuery = () => libraryQuery("namingGet")
export const sitesQuery = () => libraryQuery("planningListSites")
export const goalTemplatesQuery = () => libraryQuery("goalTemplateList")
export const profilesQuery = () => libraryQuery("prepareProfiles")
export const measurementRunsQuery = () => libraryQuery("pixListMeasurementRuns", 0, ACTIVITY_PAGE)
export const adoptionsQuery = () => libraryQuery("calibrationListAdoptions", null, 0, ACTIVITY_PAGE)

/** Refresh every mounted library read. */
export function invalidateSettingsReads(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: ["library"] })
}

/** True for the library's stale-revision answer. */
export function isConflict(result: ActionResult<unknown>): boolean {
  return !result.ok && result.failure.source === "library" && result.failure.error.code === "conflict"
}

/**
 * Run one settings write and refresh the reads once it settles with success
 * or `conflict`. The result passes through unchanged, so an Action's runner
 * or a dialog reports success only for `{ ok: true }` and keeps the draft
 * otherwise.
 */
export async function settingsWrite<T>(client: QueryClient, write: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const result = await write()
  if (result.ok || isConflict(result)) await invalidateSettingsReads(client)
  return result
}
