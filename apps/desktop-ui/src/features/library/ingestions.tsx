/**
 * Home's Pending ingestions (PRJ-FR-17 section 1): per Captures location,
 * new files since its last scan, a location never scanned or whose last
 * scan did not finish, and stopped or failed imports with Retry. A running
 * import changes its own row ("Importing 142 files · 40%").
 *
 * Offline is not absence: a Captures location that is offline, missing or
 * unreadable keeps its row with that state, since its new files cannot be
 * counted; it never reads as "Everything is imported".
 *
 * Sources, all durable reads: `library_list_locations`,
 * `library_new_captures` (refreshed on its event), each Captures
 * location's own last scan (`library_list_operations` for that location,
 * one row), and `import_list` for every running, interrupted, failed or
 * partial import, re-read each second while one runs.
 */
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { FolderPlus } from "lucide-react"
import { type ImportListEntry, type ImportSummary, type Location, library, NEW_CAPTURES_EVENT, type ScanOperation } from "@/api/ipc"
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
import { readError } from "./parts"
import { homeWrite, importListQuery, importWrite, lastScanQuery, locationsQuery, newCapturesQuery, PENDING_IMPORT_STATES } from "./queries"

/** Rows a Home section shows before "All N ›" (C8). */
export const ROWS = 5

export type IngestionRow =
  | { kind: "location"; location: Location; state: { kind: "offline" } | { kind: "scanning" } | { kind: "never-scanned" } | { kind: "incomplete" } | { kind: "new-files"; count: number } }
  | { kind: "import"; entry: ImportListEntry }

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
export function importPercent(s: ImportSummary): number {
  const done = s.imported + s.failed + s.uncertain
  const total = done + s.pending
  return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
}

function importText(m: Messages, entry: ImportListEntry): string {
  const s = entry.summary
  switch (entry.state) {
    case "running": {
      const approved = s.imported + s.pending + s.failed + s.uncertain
      return m.home_importing({ count: approved, files: formatCount(approved), percent: importPercent(s) })
    }
    case "interrupted":
      return m.home_import_stopped()
    case "failed":
      return m.home_import_failed()
    case "partial":
      return m.home_import_partial()
    case "settled":
      // Home never asks for a cleanly settled import (PENDING_IMPORT_STATES).
      return m.status_finished()
  }
}

/** The operation status a stopped or settled import's badge shows; a running one reads as its progress. */
const IMPORT_BADGE = { interrupted: "interrupted", failed: "failed", partial: "partial", settled: "succeeded" } as const

function ingestionText(m: Messages, row: IngestionRow): string {
  if (row.kind === "import") return importText(m, row.entry)
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
  return row.kind === "location" ? `location:${row.location.id}` : `import:${row.entry.id}`
}

const locationLink = (locationId: string): StepLink => ({ to: "/settings/locations", search: { locationId } })
const importRunLink = (importId: string): StepLink => ({ to: "/import", search: { step: "run", import: importId } })

/** The section's rows: imports as the library lists them, most recently updated first, then the locations in name order. */
export function useIngestions() {
  const locations = useQuery(locationsQuery())
  const captures = useQuery(newCapturesQuery())
  const imports = useQuery({
    ...importListQuery(PENDING_IMPORT_STATES),
    refetchInterval: (query) => (query.state.data?.some((entry) => entry.state === "running") ? 1000 : false),
  })
  const captureLocations = (locations.data ?? []).map((state) => state.location).filter((l) => l.role === "captures" && l.lifecycle === "active")
  const scans = useQueries({ queries: captureLocations.map((l) => lastScanQuery(l.id)) })
  useRefreshOnEvent(NEW_CAPTURES_EVENT, libraryKey("libraryNewCaptures"))
  const importRows: IngestionRow[] = (imports.data ?? []).map((entry) => ({ kind: "import", entry }))
  const newFiles = new Map((captures.data?.locations ?? []).map((c) => [c.locationId, c.newFiles]))
  const lastScan = new Map(captureLocations.map((l, i) => [l.id, scans[i]?.data?.[0]]))
  const locationRows = [...captureLocations]
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((location) => locationIngestion(location, lastScan.get(location.id), newFiles.get(location.id) ?? 0) ?? [])
  // An unreadable import list is a failed read, never "nothing stopped".
  const error = locations.error ?? captures.error ?? imports.error ?? scans.find((s) => s.error)?.error ?? null
  const loading = locations.isPending || captures.isPending || imports.isPending || scans.some((s) => s.isPending)
  const refetch = () => void Promise.all([locations.refetch(), captures.refetch(), imports.refetch(), ...scans.map((s) => s.refetch())])
  return { rows: [...importRows, ...locationRows], loading, error, hasCaptures: captureLocations.length > 0, refetch }
}

export function IngestionsTable({ ingestions }: { ingestions: ReturnType<typeof useIngestions> }) {
  const m = useMessages()
  const follow = useFollowLink()
  const client = useQueryClient()
  const { rows, loading, error, hasCaptures, refetch } = ingestions
  const rowName = (r: IngestionRow) => (r.kind === "location" ? r.location.name : r.entry.sourcePath.display)
  const columns: Column<IngestionRow>[] = [
    { id: "location", header: m.home_column_location(), rowHeader: true, truncate: true, sortValue: rowName, cell: rowName },
    {
      id: "state",
      header: m.home_column_state(),
      sortValue: (r) => ingestionText(m, r),
      cell: (r) => {
        if (r.kind === "location" && r.state.kind === "offline") return <StatusBadge kind="availability" value={r.location.availability === "unreadable" ? "unreadable" : r.location.availability === "missing" ? "absent" : "offline"} />
        if (r.kind === "import" && r.entry.state !== "running") return <StatusBadge kind="operation" value={IMPORT_BADGE[r.entry.state]} label={ingestionText(m, r)} />
        return ingestionText(m, r)
      },
    },
  ]
  const primary = (r: IngestionRow): Action | null => {
    if (r.kind === "import") {
      // Only an interrupted import resumes; a settled one has an outcome for every item, which its page shows.
      if (r.entry.state !== "interrupted") return null
      const importId = r.entry.id
      return {
        id: "retry",
        label: m.verb_retry(),
        run: async () => {
          const result = await importWrite(client, importId, () => library.importRetry(importId))
          if (result.ok) follow(importRunLink(importId))
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
  // Every source above answered with nothing waiting (PRJ-FR-22): an offline location keeps its own row.
  const empty = hasCaptures ? (
    m.home_everything_imported()
  ) : (
    <EmptyState icon={FolderPlus} title={m.home_add_captures_location()} action={<ActionButton action={{ id: "add-location", label: m.storage_add_location(), run: () => follow({ to: "/settings/locations", search: { add: "captures" } }) }} />} />
  )
  const open = (r: IngestionRow) => follow(r.kind === "location" ? locationLink(r.location.id) : importRunLink(r.entry.id))
  return (
    <BoxTable
      label={m.home_ingestions()}
      rows={rows.slice(0, ROWS)}
      columns={columns}
      getRowId={rowId}
      rowLabel={rowName}
      primaryRowAction={primary}
      rowActions={(r) => [{ id: "open", label: m.verb_open(), run: () => open(r) }]}
      onRowClick={open}
      loading={loading}
      error={error ? { message: readError(m, error), onRetry: refetch } : undefined}
      empty={empty}
    />
  )
}
