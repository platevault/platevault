/**
 * S17 Activity (`/activity`, slice E), carried over from v4: running,
 * paused and interrupted operations with their controls, then every
 * recorded outcome (operations, refusals, failed and refused writes, saves),
 * each linking to the surface that owns it (LIB-FR-10). A refusal names its
 * reasons, as the store recorded them. Right-click on an entry opens it or
 * shows its items.
 */
import { Activity as ActivityIcon } from "lucide-react"
import { Fragment, useState } from "react"
import { EmptyState } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { ContextMenuArea, type MenuEntry, menuKey } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { STEP_LABEL } from "@/domain/labels"
import type { ActivityEvent, ActivityKind, Operation, RunStep } from "@/domain/types"
import { formatCount, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { isSettled } from "@/store/operations"

/** Cells grow from the density row height so a two-line entry stays readable. */
const DENSITY_CELL = "py-[max(0.25rem,calc((var(--row-h)-1.25rem)/2))]"
/** The action cell holds 1.75rem buttons, so its padding makes the row exactly `--row-h`. */
const ACTION_CELL = "py-[max(0px,calc((var(--row-h)-1.75rem)/2))]"

type Filter = "all" | "operation" | "refused" | "write-failed" | "saved"

/** Absolute paths inside a detail sentence, without trailing punctuation. */
const PATH = /(\/Volumes\/\S*[^\s.,;:])/

/** "Refused" covers a contract refusal and a stale write refused as changed elsewhere. */
const FILTERS: Array<{ value: Filter; label: string; kinds: ActivityKind[] }> = [
  { value: "all", label: "All", kinds: [] },
  { value: "operation", label: "Operations", kinds: ["operation"] },
  { value: "refused", label: "Refusals", kinds: ["refusal", "write-refused"] },
  { value: "write-failed", label: "Not saved", kinds: ["write-failed"] },
  { value: "saved", label: "Saved", kinds: ["saved"] },
]

const SECTION: Record<string, string> = {
  projects: "Projects",
  targets: "Targets",
  plan: "Plan",
  sessions: "Sessions",
  calibration: "Calibration",
  storage: "Storage",
  activity: "Activity",
  import: "Import",
  setup: "Setup",
}

const SINGLE: Record<string, string> = { targets: "Target", sessions: "Session", projects: "Project" }

const SETTINGS_AREA: Record<string, string> = {
  appearance: "Appearance",
  locations: "Locations",
  equipment: "Equipment",
  "goal-templates": "Goal templates",
  naming: "Naming",
  sites: "Observing sites",
  targets: "Target lookup",
  applications: "Applications",
  calibration: "Calibration",
  about: "About",
}

/** The surface an entry opens, named on its button ("Open Equipment", "Open Calibrate"). */
export function destinationLabel(href: string): string {
  const [first = "", second, third, fourth, fifth] = href.split(/[?#]/)[0]!.split("/").filter(Boolean)
  if (first === "settings") return (second && SETTINGS_AREA[second]) ?? "Settings"
  if (first === "projects" && second) {
    if ((third === "runs" || third === "groups") && fourth) return fifth && fifth in STEP_LABEL ? STEP_LABEL[fifth as RunStep] : third === "runs" ? "run" : "run group"
    if (third === "trash") return "Project Trash"
    return "Project"
  }
  if (second && SINGLE[first]) return SINGLE[first]!
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
    case "write-refused":
    case "refusal":
      return <StatusBadge kind="item" value="blocked" label="Refused" />
    case "saved":
      return <StatusBadge kind="save" value="saved" />
  }
}

function Detail({ event }: { event: ActivityEvent }) {
  if (!event.detail) return null
  // A refusal's reasons are recorded joined by "; ": list each one.
  if (event.kind === "refusal" && event.detail.includes("; ")) {
    return (
      <ul className="list-disc pl-4 text-xs text-pretty text-muted-foreground compact:min-w-0 compact:truncate">
        {event.detail.split("; ").map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    )
  }
  return (
    <p className="text-xs text-pretty text-muted-foreground compact:min-w-0 compact:truncate" title={event.detail}>
      {/* Paths in the mono face; split() puts each captured path at an odd index. */}
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
  )
}

function ActivityRow({ event, operation, open, onToggle }: { event: ActivityEvent; operation: Operation | undefined; open: boolean; onToggle: () => void }) {
  const panelId = `activity-${event.id}-items`
  return (
    <Fragment>
      <tr {...menuKey(event.id)} className="h-(--row-h) border-b align-top last:border-0">
        <td className={cn("px-3 whitespace-nowrap", DENSITY_CELL)}>
          <time dateTime={event.at} className="text-xs text-muted-foreground tabular-nums">
            {formatDateTime(event.at)}
          </time>
        </td>
        <td className={cn("px-3 whitespace-nowrap", DENSITY_CELL)}>
          <Outcome event={event} operation={operation} />
        </td>
        <th scope="row" className={cn("min-w-40 px-3 text-left font-normal compact:w-full compact:max-w-0", DENSITY_CELL)}>
          <div className="compact:flex compact:min-w-0 compact:items-baseline compact:gap-2">
            <div className="font-medium text-pretty compact:shrink-0 compact:whitespace-nowrap">{event.title}</div>
            <Detail event={event} />
          </div>
        </th>
        <td className={cn("px-3", ACTION_CELL)}>
          <div className="flex justify-end gap-1">
            {operation && operation.items.length > 0 ? (
              <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
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
  const unsettled = Object.values(operations)
    .filter((op) => !isSettled(op.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const [filter, setFilter] = useState<Filter>("all")
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const current = FILTERS.find((f) => f.value === filter) ?? FILTERS[0]!
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, f.value === "all" ? activity.length : activity.filter((e) => f.kinds.includes(e.kind)).length])) as Record<Filter, number>
  const shown = filter === "all" ? activity : activity.filter((e) => current.kinds.includes(e.kind))
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const menu = (id: string): MenuEntry[] => {
    const event = shown.find((e) => e.id === id)
    if (!event) return []
    const operation = event.operationId ? operations[event.operationId] : undefined
    return [
      ...(event.href ? [{ label: `Open ${destinationLabel(event.href)}`, onSelect: () => void (window.location.hash = event.href!) }] : []),
      ...(operation && operation.items.length > 0 ? [{ label: expanded.has(id) ? "Hide items" : "Show items", onSelect: () => toggle(id) }] : []),
    ]
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Activity" />
      <PageBody>
        <Section id="in-progress" title="In progress">
          {unsettled.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing running</p>
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
            <ToggleGroup aria-label="Show entries" size="sm" variant="outline" spacing={0} value={[filter]} onValueChange={(value) => value[0] && setFilter(value[0] as Filter)} className="flex-wrap">
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
              title="No activity"
              action={
                <Button size="sm" render={<a href="#/" />}>
                  Go to Home
                </Button>
              }
            />
          ) : shown.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title={`No ${current.label.toLowerCase()}`}
              action={
                <Button size="sm" variant="outline" onClick={() => setFilter("all")}>
                  Show all
                </Button>
              }
            />
          ) : (
            <ContextMenuArea menu={menu} className="relative block overflow-x-auto rounded-lg border">
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
                    <ActivityRow key={event.id} event={event} operation={event.operationId ? operations[event.operationId] : undefined} open={expanded.has(event.id)} onToggle={() => toggle(event.id)} />
                  ))}
                </tbody>
              </table>
            </ContextMenuArea>
          )}
        </Section>
      </PageBody>
    </div>
  )
}
