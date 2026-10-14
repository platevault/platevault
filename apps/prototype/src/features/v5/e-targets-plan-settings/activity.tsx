/**
 * S17 Activity (`/activity`, slice E) as a ListPage: one table of what runs
 * now and what was recorded (operations, refusals, failed and refused writes,
 * saves, delivered reminders), each opening the surface that owns it
 * (LIB-FR-10).
 *
 * - Running, paused and interrupted operations sit in the In progress group
 *   above the History, and open their panel (progress and controls) on first
 *   render. A row keeps its id when its operation settles, so it stays in
 *   place with its panel.
 * - The Entries facet filters by kind; Transfers are the imports, archive
 *   moves and OS Trash moves, since the Storage tab went (P-STO2).
 * - A row's ⋯ (and its right-click menu) opens the owning surface. The
 *   disclosure shows the full detail, a refusal's reasons as the store
 *   recorded them, and an operation's items.
 */
import { useNavigate } from "@tanstack/react-router"
import { Activity as ActivityIcon } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { EmptyState } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { CountBadge } from "@/components/app/pill"
import { StatusBadge } from "@/components/app/status"
import { ListPage } from "@/components/templates/list-page"
import { STEP_NAME } from "@/domain/labels"
import type { ActivityEvent, Operation, RunStep } from "@/domain/types"
import { formatCount, formatDateTime } from "@/lib/format"
import { m, type Messages, say } from "@/lib/i18n"
import { useStore } from "@/store/core"
import { isSettled } from "@/store/operations"

type Filter = "operation" | "transfer" | "refused" | "write-failed" | "saved"

/** Absolute paths inside a detail sentence, without trailing punctuation. */
const PATH = /(\/Volumes\/\S*[^\s.,;:])/

/** Operations that move or copy files: imports, archive and restore moves, OS Trash moves (P-STO2). */
const TRANSFER_KINDS: ReadonlySet<Operation["kind"]> = new Set(["import", "archive", "trash", "cleanup"])

/** One row: an operation that has not settled, or a recorded entry. */
interface ActivityRow {
  id: string
  at: string
  running: boolean
  event: ActivityEvent | null
  operation: Operation | undefined
}

/** "Refused" covers a contract refusal and a stale write refused as changed elsewhere. */
const FILTERS: Array<{ value: Filter; readonly label: string; readonly empty: string; test: (row: ActivityRow) => boolean }> = [
  { value: "operation", get label() { return m.activity_filter_operations() }, get empty() { return m.activity_empty_operations() }, test: (r) => r.running || r.event?.kind === "operation" },
  { value: "transfer", get label() { return m.storage_transfers() }, get empty() { return m.storage_no_transfers() }, test: (r) => (r.running || r.event?.kind === "operation") && r.operation !== undefined && TRANSFER_KINDS.has(r.operation.kind) },
  { value: "refused", get label() { return m.activity_filter_refusals() }, get empty() { return m.activity_empty_refusals() }, test: (r) => r.event?.kind === "refusal" || r.event?.kind === "write-refused" },
  { value: "write-failed", get label() { return m.status_not_saved() }, get empty() { return m.activity_empty_not_saved() }, test: (r) => r.event?.kind === "write-failed" },
  { value: "saved", get label() { return m.status_saved() }, get empty() { return m.activity_empty_saved() }, test: (r) => r.event?.kind === "saved" },
]

const SECTION: Record<string, () => string> = {
  projects: m.nav_projects,
  targets: m.nav_targets,
  plan: m.nav_plan,
  sessions: m.nav_sessions,
  calibration: m.nav_calibration,
  // `/storage` (S15) redirects to Settings › Locations (P-STO2).
  storage: m.common_locations,
  activity: m.nav_activity,
  import: m.shell_import,
  setup: m.activity_destination_setup,
}

const SINGLE: Record<string, () => string> = { targets: m.activity_destination_target, sessions: m.activity_destination_session, projects: m.activity_destination_project }

const SETTINGS_AREA: Record<string, () => string> = {
  appearance: m.settings_appearance,
  locations: m.common_locations,
  equipment: m.settings_equipment,
  "goal-templates": m.settings_goal_templates,
  naming: m.settings_naming,
  sites: m.settings_sites,
  targets: m.settings_target_lookup,
  applications: m.settings_applications,
  calibration: m.nav_calibration,
  about: m.activity_destination_about,
}

/** The surface an entry opens, named in its menu ("Open Equipment", "Open Calibrate"). */
export function destinationLabel(href: string): string {
  const [first = "", second, third, fourth, fifth] = href.split(/[?#]/)[0]!.split("/").filter(Boolean)
  if (first === "settings") return (second && SETTINGS_AREA[second]?.()) ?? m.nav_settings()
  if (first === "projects" && second) {
    if ((third === "runs" || third === "groups") && fourth) return fifth && fifth in STEP_NAME ? say(m, STEP_NAME[fifth as RunStep]) : third === "runs" ? m.activity_destination_run() : m.run_results_run_group()
    if (third === "trash") return m.activity_destination_trash()
    return m.activity_destination_project()
  }
  if (second && SINGLE[first]) return SINGLE[first]!()
  return SECTION[first]?.() ?? m.activity_destination_page()
}

/** A row's title: the entry's, else the running operation's. The Outcome column says how it settled, so the title does not repeat it. */
function rowTitle(m: Messages, row: ActivityRow): string {
  if (row.event) return say(m, row.event.title)
  return row.operation ? say(m, row.operation.title) : ""
}

/** The outcome badge and the word it sorts by. */
function outcome(m: Messages, row: ActivityRow): { word: string; badge: ReactNode } {
  const { event, operation } = row
  if (!event || event.kind === "operation") {
    // Indexing that left part of a location unread reads Incomplete scope, not a plain success (LIB-FR-06).
    const incomplete = event?.outcome === "incomplete-scope" || (!row.running && operation?.kind === "index" && operation.items.some((item) => item.status === "uncertain"))
    if (incomplete) return { word: "incomplete", badge: <StatusBadge kind="scanScope" value="incomplete" /> }
    // An entry keeps how its operation settled when the Operation record is no longer retained.
    const status = operation?.status ?? event?.status
    if (status) return { word: status, badge: <StatusBadge kind="operation" value={status} /> }
    return { word: "recorded", badge: <StatusBadge kind="processing" value="written" label={m.activity_recorded()} /> }
  }
  switch (event.kind) {
    case "write-failed":
      return { word: "failed", badge: <StatusBadge kind="save" value="failed" /> }
    case "write-refused":
    case "refusal":
      return { word: "refused", badge: <StatusBadge kind="item" value="blocked" label={m.activity_refused()} /> }
    case "saved":
      return { word: "saved", badge: <StatusBadge kind="save" value="saved" /> }
    case "reminder":
      return { word: "reminder", badge: <StatusBadge kind="reminders" value="enabled" label={m.plan_reminder_badge()} /> }
  }
}

/** A row's detail as one line of text, for the table cell. */
function detailText(m: Messages, row: ActivityRow): string {
  if (row.event?.detail) return say(m, row.event.detail)
  return row.operation?.summary ? say(m, row.operation.summary) : ""
}

/** The full detail under an open row: a refusal's reasons one per line, paths in the mono face. */
function Detail({ event }: { event: ActivityEvent }) {
  const m = useMessages()
  if (!event.detail) return null
  // A refusal records its reasons as one list joined by "; ": list each one.
  if (event.kind === "refusal" && "list" in event.detail && event.detail.list.length > 1) {
    return (
      <ul>
        {event.detail.list.map((ref, i) => (
          <li key={i}>{say(m, ref)}</li>
        ))}
      </ul>
    )
  }
  // split() puts each captured path at an odd index.
  return say(m, event.detail)
    .split(PATH)
    .map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))
}

function RowDetail({ row }: { row: ActivityRow }) {
  const m = useMessages()
  return (
    <>
      {row.event?.detail ? <KeyValueList items={[{ label: m.activity_detail(), value: <Detail event={row.event} /> }]} /> : null}
      {row.operation && (row.running || row.operation.items.length > 0) ? <OperationPanel operationId={row.operation.id} /> : null}
    </>
  )
}

export function ActivityPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const activity = useStore((s) => s.activity)
  const operations = useStore((s) => s.operations)
  const [filter, setFilter] = useState<Filter | "">("")

  // An operation records its entry as `act_<id>` when it settles, so its running row takes that id and keeps its place.
  const recorded = new Set(activity.map((event) => event.id))
  const running: ActivityRow[] = Object.values(operations)
    .filter((op) => !isSettled(op.status) && !recorded.has(`act_${op.id}`))
    .map((op) => ({ id: `act_${op.id}`, at: op.createdAt, running: true, event: null, operation: op }))
  const rows: ActivityRow[] = [
    ...running,
    ...activity.map((event) => ({ id: event.id, at: event.at, running: false, event, operation: event.operationId ? operations[event.operationId] : undefined })),
  ]
  const [openOnFirstRender] = useState(() => running.map((row) => row.id))
  const current = FILTERS.find((f) => f.value === filter)
  const shown = current ? rows.filter(current.test) : rows

  const columns: Column<ActivityRow>[] = [
    { id: "what", header: m.activity_what(), rowHeader: true, truncate: true, sortValue: (r) => rowTitle(m, r), cell: (r) => rowTitle(m, r) },
    { id: "outcome", header: m.activity_outcome(), sortValue: (r) => outcome(m, r).word, cell: (r) => outcome(m, r).badge },
    { id: "detail", header: m.activity_detail(), truncate: true, static: true, cell: (r) => detailText(m, r) },
    { id: "when", header: m.activity_when(), sortValue: (r) => r.at, cell: (r) => <time dateTime={r.at}>{formatDateTime(r.at)}</time> },
  ]
  const rowActions = (r: ActivityRow): MenuItem[] => {
    const href = r.event?.href
    return href ? [{ id: "open", label: m.activity_open_destination({ name: destinationLabel(href) }), run: () => void (window.location.hash = href) }] : []
  }
  const empty: Action = current
    ? { id: "show-all", label: m.plan_show_all(), run: () => setFilter("") }
    : { id: "go-home", label: m.shell_not_found_home(), run: () => void navigate({ to: "/" }) }

  return (
    <ListPage
      title={m.nav_activity()}
      summary={m.activity_entry_count({ count: rows.length, n: formatCount(rows.length) })}
      table={{
        label: m.activity_caption(),
        rows: shown,
        columns,
        getRowId: (r) => r.id,
        rowLabel: (r) => rowTitle(m, r),
        rowActions,
        initialSort: { columnId: "when", direction: "desc" },
        groups: {
          key: (r) => (r.running ? "running" : "history"),
          label: (key, group) => (
            <>
              {key === "running" ? m.activity_in_progress() : m.activity_history()} <CountBadge count={group.length} />
            </>
          ),
          compare: (a, b) => (a === b ? 0 : a === "running" ? -1 : 1),
        },
        expand: {
          isExpandable: (r) => Boolean(r.event?.detail) || (r.operation !== undefined && (r.running || r.operation.items.length > 0)),
          render: (r) => <RowDetail row={r} />,
          defaultExpanded: openOnFirstRender,
        },
        toolbar: {
          facets: {
            items: [
              {
                id: "entries",
                label: m.activity_facet_entries(),
                kind: "single",
                options: FILTERS.map((f) => ({ value: f.value, label: f.label, count: rows.filter(f.test).length })),
                value: filter,
              },
            ],
            onChange: (patch) => setFilter(typeof patch.entries === "string" ? (patch.entries as Filter | "") : ""),
          },
          matchCount: shown.length,
        },
        empty: <EmptyState icon={ActivityIcon} title={current ? current.empty : m.activity_empty()} action={<ActionButton action={empty} />} />,
      }}
    />
  )
}
