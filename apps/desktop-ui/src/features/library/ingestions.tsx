/**
 * Home's Pending ingestions (PRJ-FR-17 section 1): per Captures location,
 * new files since its last scan, a location never scanned or whose last
 * scan did not finish, and stopped imports with Retry. A running import
 * changes its own row ("Importing 142 files · 40%").
 *
 * Offline is not absence: a Captures location that is offline, missing or
 * unreadable keeps its row with that state, since its new files cannot be
 * counted; it never reads as "Everything is imported".
 *
 * Sources, all durable reads: `library_list_locations`,
 * `library_new_captures` (refreshed on its event), each Captures
 * location's own last scan (`library_list_operations` for that location,
 * one row), and each import the issues name as left
 * unfinished (`work-interrupted`, read through `import_status`; an owner
 * that is no import, a measurement run, reads `not_found` and has no row
 * here). Running imports come from `home_dashboard`'s Running work, so they
 * show once that read answers; a failed or partial
 * settled import is listed nowhere until the import list of
 * astro-plan-wre19.10 exists.
 */
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { FolderPlus } from "lucide-react"
import { type ImportOperation_Serialize, failureOf, type HomeDashboard_Serialize, type Location, library, NEW_CAPTURES_EVENT, type ScanOperation } from "@/api/ipc"
import { useRefreshOnEvent } from "@/api/events"
import { libraryKey } from "@/api/query"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, StepLink } from "@/components/app/contracts"
import { EmptyState } from "@/components/app/feedback"
import { useFollowLink } from "@/components/app/links"
import { StatusBadge } from "@/components/app/status"
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { Unavailable, readError } from "./parts"
import { homeWrite, importQuery, importWrite, issuesQuery, lastScanQuery, locationsQuery, newCapturesQuery } from "./queries"

/** Rows a Home section shows before "All N ›" (C8). */
export const ROWS = 5

export type IngestionRow =
  | { kind: "location"; location: Location; state: { kind: "offline" } | { kind: "scanning" } | { kind: "never-scanned" } | { kind: "incomplete" } | { kind: "new-files"; count: number } }
  | { kind: "import"; importId: string; operation: ImportOperation_Serialize | null; running: boolean }

/** A location's row, or none when nothing waits there. A scan that read only part of the location did not finish. */
export function locationIngestion(location: Location, lastScan: ScanOperation | undefined, newFiles: number): IngestionRow | null {
  if (location.role !== "captures" || location.lifecycle !== "active") return null
  const row = (state: Extract<IngestionRow, { kind: "location" }>["state"]): IngestionRow => ({ kind: "location", location, state })
  if (location.availability !== "available") return row({ kind: "offline" })
  if (!lastScan) return row({ kind: "never-scanned" })
  if (lastScan.state === "running") return row({ kind: "scanning" })
  if (lastScan.state !== "completed" || lastScan.incompleteScopes.length > 0) return row({ kind: "incomplete" })
  return newFiles > 0 ? row({ kind: "new-files", count: newFiles }) : null
}

/** The import's progress over the items it approved: settled ones of every approved one. */
export function importPercent(op: ImportOperation_Serialize): number {
  const s = op.summary
  const done = s.imported + s.failed + s.uncertain
  const total = done + s.pending
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
}

function ingestionText(m: Messages, row: IngestionRow): string {
  if (row.kind === "import") {
    if (!row.operation) return m.home_import_stopped()
    const approved = row.operation.summary.imported + row.operation.summary.pending + row.operation.summary.failed + row.operation.summary.uncertain
    if (row.running) return m.home_importing({ count: approved, files: formatCount(approved), percent: importPercent(row.operation) })
    return m.home_import_stopped()
  }
  switch (row.state.kind) {
    case "offline":
      return m.status_offline()
    case "scanning":
      return m.home_scanning()
    case "never-scanned":
      return m.home_never_scanned()
    case "incomplete":
      return m.home_scan_unfinished()
    case "new-files":
      return m.home_new_files({ count: row.state.count, files: formatCount(row.state.count) })
  }
}

function rowId(row: IngestionRow): string {
  return row.kind === "location" ? `location:${row.location.id}` : `import:${row.importId}`
}

const locationLink = (locationId: string): StepLink => ({ to: "/settings/locations", search: { locationId } })
const importRunLink = (importId: string): StepLink => ({ to: "/import", search: { step: "run", import: importId } })

/** The section's rows: unfinished and running imports first, then the locations in name order. */
export function useIngestions(dashboard: HomeDashboard_Serialize | null) {
  const locations = useQuery(locationsQuery())
  const captures = useQuery(newCapturesQuery())
  const issues = useQuery(issuesQuery())
  const captureLocations = (locations.data ?? []).map((state) => state.location).filter((l) => l.role === "captures" && l.lifecycle === "active")
  const scans = useQueries({ queries: captureLocations.map((l) => lastScanQuery(l.id)) })
  useRefreshOnEvent(NEW_CAPTURES_EVENT, libraryKey("libraryNewCaptures"))
  const running = (dashboard?.runningWork ?? []).flatMap((work) => (work.kind === "import" ? [work.importId] : []))
  const stopped = (issues.data?.issues ?? []).flatMap((issue) => (issue.kind === "work-interrupted" && issue.owner.kind === "operation" ? [issue.owner.id] : []))
  const importIds = [...new Set([...running, ...stopped])]
  const imports = useQueries({
    queries: importIds.map((id) => ({ ...importQuery(id), refetchInterval: running.includes(id) ? 1000 : (false as const) })),
  })
  const importRows: IngestionRow[] = importIds.flatMap((importId, index): IngestionRow[] => {
    const read = imports[index]
    const failure = failureOf(read?.error)
    // A work-interrupted owner that is a measurement run is no import.
    if (failure?.source === "library" && failure.error.code === "not_found") return []
    const operation = read?.data ?? null
    if (operation && operation.state !== "running" && operation.state !== "interrupted") return []
    return [{ kind: "import", importId, operation, running: running.includes(importId) || operation?.state === "running" }]
  })
  const newFiles = new Map((captures.data?.locations ?? []).map((c) => [c.locationId, c.newFiles]))
  const lastScan = new Map(captureLocations.map((l, i) => [l.id, scans[i]?.data?.[0]]))
  const locationRows = [...captureLocations]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((location) => locationIngestion(location, lastScan.get(location.id), newFiles.get(location.id) ?? 0) ?? [])
  // An unreadable issues read hides stopped imports: it is a failed read, never "nothing stopped".
  const error = locations.error ?? captures.error ?? issues.error ?? scans.find((s) => s.error)?.error ?? null
  const loading = locations.isPending || captures.isPending || issues.isPending || scans.some((s) => s.isPending)
  const refetch = () => void Promise.all([locations.refetch(), captures.refetch(), issues.refetch(), ...scans.map((s) => s.refetch())])
  return { rows: [...importRows, ...locationRows], loading, error, hasCaptures: captureLocations.length > 0, refetch }
}

export function IngestionsTable({ ingestions, dashboardReady }: { ingestions: ReturnType<typeof useIngestions>; dashboardReady: boolean }) {
  const m = useMessages()
  const follow = useFollowLink()
  const client = useQueryClient()
  const { rows, loading, error, hasCaptures, refetch } = ingestions
  const columns: Column<IngestionRow>[] = [
    {
      id: "location",
      header: m.home_column_location(),
      rowHeader: true,
      truncate: true,
      sortValue: (r) => (r.kind === "location" ? r.location.name : (r.operation?.sourcePath.display ?? r.importId)),
      cell: (r) => (r.kind === "location" ? r.location.name : (r.operation?.sourcePath.display ?? "–")),
    },
    {
      id: "state",
      header: m.home_column_state(),
      sortValue: (r) => ingestionText(m, r),
      cell: (r) => {
        if (r.kind === "location" && r.state.kind === "offline") return <StatusBadge kind="availability" value={r.location.availability === "unreadable" ? "unreadable" : r.location.availability === "missing" ? "absent" : "offline"} />
        if (r.kind === "import" && !r.running) return <StatusBadge kind="operation" value="interrupted" label={ingestionText(m, r)} />
        return ingestionText(m, r)
      },
    },
  ]
  const primary = (r: IngestionRow): Action | null => {
    if (r.kind === "import") {
      if (r.running) return null
      return {
        id: "retry",
        label: m.verb_retry(),
        run: async () => {
          const result = await importWrite(client, r.importId, () => library.importRetry(r.importId))
          if (result.ok) follow(importRunLink(r.importId))
          return result
        },
      }
    }
    switch (r.state.kind) {
      case "new-files":
        return { id: "import", label: m.import_open(), opensDialog: true, run: () => follow({ to: "/import", search: { location: r.location.id } }) }
      case "never-scanned":
      case "incomplete":
        return {
          id: r.state.kind === "never-scanned" ? "scan" : "rescan",
          label: r.state.kind === "never-scanned" ? m.home_scan() : m.location_rescan(),
          run: () => homeWrite(client, () => library.libraryStartScan(r.location.id)),
        }
      case "offline":
      case "scanning":
        return null
    }
  }
  // "Everything is imported." (PRJ-FR-22) is a claim this section cannot back yet: running imports wait on
  // astro-plan-wre19.9 and failed or partial imports on the import list of astro-plan-wre19.10. Switch to
  // m.home_everything_imported() once both land; until then the empty text says only what was read.
  const empty = hasCaptures ? (
    m.home_no_new_files()
  ) : (
    <EmptyState icon={FolderPlus} title={m.home_add_captures_location()} action={<ActionButton action={{ id: "add-location", label: m.storage_add_location(), run: () => follow({ to: "/settings/locations", search: { add: "captures" } }) }} />} />
  )
  return (
    <>
      <BoxTable
        label={m.home_ingestions()}
        rows={rows.slice(0, ROWS)}
        columns={columns}
        getRowId={rowId}
        rowLabel={(r) => (r.kind === "location" ? r.location.name : (r.operation?.sourcePath.display ?? r.importId))}
        primaryRowAction={primary}
        rowActions={(r) => [{ id: "open", label: m.verb_open(), run: () => follow(r.kind === "location" ? locationLink(r.location.id) : importRunLink(r.importId)) }]}
        onRowClick={(r) => follow(r.kind === "location" ? locationLink(r.location.id) : importRunLink(r.importId))}
        loading={loading}
        error={error ? { message: readError(m, error), onRetry: refetch } : undefined}
        empty={empty}
      />
      {/* Running imports arrive with home_dashboard's Running work; until it answers they are not known. */}
      {dashboardReady ? null : <Unavailable what={m.home_running_imports()} />}
    </>
  )
}
