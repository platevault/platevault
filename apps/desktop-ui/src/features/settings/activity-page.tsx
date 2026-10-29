/**
 * Activity (LIB-FR-03, J18): the durable operations the library recorded,
 * newest first: location scans (`library_list_operations`), frame
 * measurement runs (`pix_list_measurement_runs`) and calibration master
 * adoptions (`calibration_list_adoptions`), each with its state as the
 * library last recorded it, an interrupted one included. Nothing here is
 * made up: a row is one of those records.
 *
 * The library keeps no history of refusals and failed saves yet, so the
 * page names that gap instead of listing any.
 */
import { useQuery } from "@tanstack/react-query"
import { useRefreshOnEvent } from "@/api/events"
import { type AdoptionOperation_Serialize, MEASUREMENT_PROGRESS_EVENT, type MeasurementRun, SCAN_PROGRESS_EVENT, type ScanOperation } from "@/api/ipc"
import { libraryKey } from "@/api/query"
import { useMessages } from "@/app/preferences"
import type { Column } from "@/components/app/contracts"
import { DateText } from "@/components/app/data"
import { StatusBadge, type StatusValue } from "@/components/app/status"
import { ListPage } from "@/components/templates/list-page"
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { readError } from "./parts"
import { ACTIVITY_PAGE, adoptionsQuery, locationsQuery, measurementRunsQuery, scansQuery } from "./queries"

type Outcome = StatusValue<"operation">

interface Entry {
  id: string
  what: string
  outcome: Outcome
  startedAt: string
  finishedAt: string | null
}

const SCAN_OUTCOME: Record<ScanOperation["state"], Outcome> = { running: "running", completed: "succeeded", partial: "partial", failed: "failed", canceled: "canceled" }
const RUN_OUTCOME: Record<MeasurementRun["state"], Outcome> = { running: "running", completed: "succeeded", canceled: "canceled", interrupted: "interrupted", failed: "failed" }
const ADOPTION_OUTCOME: Record<AdoptionOperation_Serialize["state"], Outcome> = { running: "running", completed: "succeeded", failed: "failed", interrupted: "interrupted" }

/** Every listed operation as one entry, newest first. */
export function activityEntries(m: Messages, scans: ScanOperation[], runs: MeasurementRun[], adoptions: AdoptionOperation_Serialize[], names: ReadonlyMap<string, string>): Entry[] {
  const entries: Entry[] = [
    ...scans.map((s) => ({ id: `scan:${s.id}`, what: m.op_index_title_one({ name: names.get(s.locationId) ?? "–" }), outcome: SCAN_OUTCOME[s.state], startedAt: s.startedAt, finishedAt: s.finishedAt })),
    ...runs.map((r) => ({ id: `measure:${r.operationId}`, what: m.op_measure_title(), outcome: RUN_OUTCOME[r.state], startedAt: r.startedAt, finishedAt: r.finishedAt })),
    ...adoptions.map((a) => ({ id: `adopt:${a.id}`, what: m.activity_adopt_master(), outcome: ADOPTION_OUTCOME[a.state], startedAt: a.startedAt, finishedAt: a.finishedAt })),
  ]
  return entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

function columns(m: Messages): Column<Entry>[] {
  return [
    { id: "what", header: m.activity_what(), rowHeader: true, truncate: true, sortValue: (e) => e.what, cell: (e) => e.what },
    { id: "outcome", header: m.activity_outcome(), sortValue: (e) => e.outcome, cell: (e) => <StatusBadge kind="operation" value={e.outcome} /> },
    { id: "when", header: m.activity_when(), truncateMin: "date", sortValue: (e) => e.startedAt, cell: (e) => <DateText at={e.startedAt} /> },
    { id: "finished", header: m.status_finished(), truncateMin: "date", sortValue: (e) => e.finishedAt, cell: (e) => (e.finishedAt ? <DateText at={e.finishedAt} /> : "–") },
  ]
}

export function ActivityPage() {
  const m = useMessages()
  const scans = useQuery(scansQuery())
  const runs = useQuery(measurementRunsQuery())
  const adoptions = useQuery(adoptionsQuery())
  const locations = useQuery(locationsQuery())
  useRefreshOnEvent(SCAN_PROGRESS_EVENT, libraryKey("libraryListOperations"))
  useRefreshOnEvent(MEASUREMENT_PROGRESS_EVENT, libraryKey("pixListMeasurementRuns"))
  const reads = [scans, runs, adoptions, locations]
  const failed = reads.find((read) => read.isError)
  const names = new Map((locations.data ?? []).map((l) => [l.location.id, l.location.name]))
  const rows = scans.data && runs.data && adoptions.data ? activityEntries(m, scans.data, runs.data, adoptions.data, names) : []
  const full = [scans.data, runs.data, adoptions.data].some((list) => (list?.length ?? 0) >= ACTIVITY_PAGE)
  // astro-plan-wre19.24: the library records no refusals or failed saves yet.
  return (
    <ListPage
      title={m.nav_activity()}
      summary={m.activity_entry_count({ count: rows.length, n: formatCount(rows.length) })}
      notice={{ tone: "info", title: m.home_unavailable({ what: m.activity_filter_refusals() }), detail: full ? m.settings_gap_refusals_paged({ n: formatCount(ACTIVITY_PAGE) }) : m.settings_gap_refusals() }}
      table={{
        label: m.activity_caption(),
        rows,
        columns: columns(m),
        getRowId: (e) => e.id,
        toolbar: {},
        loading: !failed && rows.length === 0 && reads.some((read) => read.isPending),
        error: failed ? { message: readError(m, failed.error), onRetry: () => reads.forEach((read) => void read.refetch()) } : undefined,
        empty: m.activity_empty_operations(),
      }}
    />
  )
}
