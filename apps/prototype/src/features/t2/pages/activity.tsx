/**
 * Activity (`/activity`): running, paused and interrupted work with its
 * controls, then every recorded outcome (operations, failed and refused
 * writes, refusals, saves) linking to the surface that owns it
 * (LIB-FR-10; HLD seam 16).
 */
import { Activity as ActivityIcon } from "lucide-react"
import { Fragment, useState } from "react"
import { EmptyState } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { ActivityEvent, ActivityKind, Operation } from "@/domain/types"
import { formatCount, formatDateTime } from "@/lib/format"
import { useStore } from "@/store/core"
import { isSettled } from "@/store/operations"
import { cn } from "@/lib/utils"
import { DENSITY_CELL } from "../parts"

/** The action cell holds 1.75rem buttons, so its padding makes the row exactly `--row-h`. */
const ACTION_CELL = "py-[max(0px,calc((var(--row-h)-1.75rem)/2))]"

type Filter = "all" | "operation" | "write-failed" | "refused" | "saved"

/** Absolute paths inside a detail sentence, without trailing punctuation. */
const PATH = /(\/Volumes\/\S*[^\s.,;:])/

/** History filters (wireframe §8). "Refused" covers a stale write refused as changed elsewhere and a refused action. */
const FILTERS: Array<{ value: Filter; label: string; kinds: ActivityKind[] }> = [
  { value: "all", label: "All", kinds: [] },
  { value: "operation", label: "Operations", kinds: ["operation"] },
  { value: "write-failed", label: "Not saved", kinds: ["write-failed"] },
  { value: "refused", label: "Refused", kinds: ["write-refused", "refusal"] },
  { value: "saved", label: "Saved", kinds: ["saved"] },
]

/** Workspace areas by their route segment, as the View workspace names them. */
const VIEW_AREA: Record<string, string> = {
  sessions: "View sessions",
  frames: "Frames",
  refresh: "Refresh",
  calibration: "Calibration",
  prepare: "Prepare",
  results: "Results",
  cleanup: "Cleanup",
}

const SECTION: Record<string, string> = {
  targets: "Targets",
  sessions: "Sessions",
  projects: "Projects",
  views: "Views",
  calibration: "Calibration",
  storage: "Storage",
  plans: "Plans",
  activity: "Activity",
  setup: "Setup",
}

const SINGLE: Record<string, string> = { targets: "Target", sessions: "Session", projects: "Project", calibration: "Calibration item" }

const STORAGE_AREA: Record<string, string> = { archive: "Archive", filing: "Filing", transfers: "Transfer" }

const SETTINGS_AREA: Record<string, string> = {
  appearance: "Appearance",
  locations: "Locations",
  equipment: "Equipment",
  sites: "Observing sites",
  targets: "Target lookup",
  applications: "Applications",
  about: "About",
}

/** The surface an entry opens, named on its button ("Open Locations"). */
function destinationLabel(href: string): string {
  const [first = "", second, third] = href.split(/[?#]/)[0]!.split("/").filter(Boolean)
  if (first === "settings") return (second && SETTINGS_AREA[second]) ?? "Settings"
  if (first === "views" && second && second !== "new") return (third && VIEW_AREA[third]) ?? "View"
  if (first === "storage" && second) return STORAGE_AREA[second] ?? "Storage"
  if (first === "targets" && second && third === "plan") return "Target plan"
  if (second && SINGLE[first] && second !== "new") return SINGLE[first]!
  return SECTION[first] ?? "page"
}

function Outcome({ event, operation }: { event: ActivityEvent; operation: Operation | undefined }) {
  switch (event.kind) {
    case "operation": {
      // Indexing that left part of a location unread reads Incomplete scope, not a plain success (LIB-FR-06).
      const incomplete = event.outcome === "incomplete-scope" || (operation?.kind === "index" && operation.items.some((item) => item.status === "uncertain"))
      if (incomplete) return <StatusBadge kind="scanScope" value="incomplete" />
      return operation ? <StatusBadge kind="operation" value={operation.status} /> : <StatusBadge kind="processing" value="written" label="Recorded" />
    }
    case "write-failed":
      return <StatusBadge kind="save" value="failed" />
    // A refused write is a failed write: the destructive tone, like Not saved.
    case "write-refused":
    case "refusal":
      return <StatusBadge kind="item" value="blocked" label="Refused" />
    case "saved":
      return <StatusBadge kind="save" value="saved" />
  }
}

function ActivityRow({ event, operation }: { event: ActivityEvent; operation: Operation | undefined }) {
  const [open, setOpen] = useState(false)
  const panelId = `activity-${event.id}-items`
  return (
    <Fragment>
      <tr className="h-(--row-h) border-b align-top last:border-0">
        <td className={cn("px-3 whitespace-nowrap", DENSITY_CELL)}>
          <time dateTime={event.at} className="text-xs text-muted-foreground tabular-nums">
            {formatDateTime(event.at)}
          </time>
        </td>
        <td className={cn("px-3 whitespace-nowrap", DENSITY_CELL)}>
          <Outcome event={event} operation={operation} />
        </td>
        {/* Compact density: title and detail share one line; the detail truncates and keeps its full text as a tooltip. */}
        <th scope="row" className={cn("min-w-40 px-3 text-left font-normal compact:w-full compact:max-w-0", DENSITY_CELL)}>
          <div className="compact:flex compact:min-w-0 compact:items-baseline compact:gap-2">
            <div className="font-medium text-pretty compact:shrink-0 compact:whitespace-nowrap">{event.title}</div>
            {event.detail ? (
              <p className="text-xs text-pretty text-muted-foreground compact:min-w-0 compact:truncate" title={event.detail}>
                {/* Paths in the mono face (HLD §7); split() puts each captured path at an odd index. */}
                {event.detail.split(PATH).map((part, i) =>
                  i % 2 === 1 ? (
                    <span key={i} className="font-mono break-all compact:break-normal">
                      {part}
                    </span>
                  ) : (
                    part
                  ),
                )}
              </p>
            ) : null}
          </div>
        </th>
        <td className={cn("px-3", ACTION_CELL)}>
          <div className="flex justify-end gap-1">
            {operation && operation.items.length > 0 ? (
              <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
                {open ? "Hide items" : "Show items"}
              </Button>
            ) : null}
            {event.href ? (
              <Button size="sm" variant="outline" className="whitespace-nowrap" render={<a href={`#${event.href}`} />}>
                Open {destinationLabel(event.href)}
                <span className="sr-only">: {event.title}</span>
              </Button>
            ) : null}
          </div>
        </td>
      </tr>
      {operation && open ? (
        <tr className="border-b last:border-0">
          <td colSpan={4} className="px-3 pb-3" id={panelId}>
            <OperationPanel operationId={operation.id} />
          </td>
        </tr>
      ) : null}
    </Fragment>
  )
}

export function ActivityPage() {
  const activity = useStore((s) => s.activity)
  const operations = useStore((s) => s.operations)
  const hasLocations = useStore((s) => Object.keys(s.catalog.locations).length > 0)
  const unsettled = Object.values(operations)
    .filter((op) => !isSettled(op.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const [filter, setFilter] = useState<Filter>("all")
  const current = FILTERS.find((f) => f.value === filter) ?? FILTERS[0]!
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, f.value === "all" ? activity.length : activity.filter((e) => f.kinds.includes(e.kind)).length])) as Record<Filter, number>
  const shown = filter === "all" ? activity : activity.filter((e) => current.kinds.includes(e.kind))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Activity" description="Running work, refusals, failed writes and outcomes. Every entry links to the surface that owns it." />
      <PageBody>
        <Section id="in-progress" title="In progress">
          {unsettled.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is running.</p>
          ) : (
            <div className="space-y-3">
              {unsettled.map((op) => (
                <OperationPanel key={op.id} operationId={op.id} />
              ))}
            </div>
          )}
        </Section>
        <Section
          id="history"
          title="History"
          actions={
            <ToggleGroup
              aria-label="Show entries"
              size="sm"
              variant="outline"
              spacing={0}
              value={[filter]}
              onValueChange={(value) => value[0] && setFilter(value[0] as Filter)}
              className="flex-wrap"
            >
              {FILTERS.map((f) => (
                <ToggleGroupItem key={f.value} value={f.value}>
                  {f.label} <span className="text-muted-foreground tabular-nums">{formatCount(counts[f.value])}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          }
        >
          {activity.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title="No activity yet"
              description="Indexing, saves, failed writes and refusals appear here as they happen."
              action={
                // First run: the one next step every library page names (no location yet: add one).
                hasLocations ? (
                  <Button size="sm" render={<a href="#/targets" />}>
                    Go to Targets
                  </Button>
                ) : (
                  <Button size="sm" render={<a href="#/settings/locations" />}>
                    Add a capture location
                  </Button>
                )
              }
            />
          ) : shown.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title={`No ${current.label} entries`}
              description="Nothing of this kind has been recorded."
              action={
                <Button size="sm" variant="outline" onClick={() => setFilter("all")}>
                  Show all
                </Button>
              }
            />
          ) : (
            // Auto layout: the What column keeps its share as text grows (WCAG 1.4.4). A too-narrow frame scrolls
            // the table, not the page; `relative` keeps the sr-only labels inside that frame.
            <div className="relative overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <caption className="sr-only">Activity history, newest first</caption>
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="h-(--row-h) px-3 text-left font-medium">
                      When
                    </th>
                    <th scope="col" className="px-3 text-left font-medium">
                      Outcome
                    </th>
                    <th scope="col" className="px-3 text-left font-medium">
                      What
                    </th>
                    <th scope="col" className="px-3 text-right font-medium">
                      Open
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((event) => (
                    <ActivityRow key={event.id} event={event} operation={event.operationId ? operations[event.operationId] : undefined} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </PageBody>
    </div>
  )
}
