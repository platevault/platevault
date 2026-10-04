/**
 * Activity (`/activity`): running, paused and interrupted work with its
 * controls, then every recorded outcome (operations, failed and refused
 * writes, refusals, saves) linking to the surface that owns it
 * (LIB-FR-10; HLD seam 16).
 */
import { Activity as ActivityIcon } from "lucide-react"
import { useState } from "react"
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

type Filter = "all" | ActivityKind

/** Absolute paths inside a detail sentence, without trailing punctuation. */
const PATH = /(\/Volumes\/\S*[^\s.,;:])/

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "operation", label: "Operations" },
  { value: "write-failed", label: "Not saved" },
  { value: "write-refused", label: "Changed elsewhere" },
  { value: "refusal", label: "Blocked" },
  { value: "saved", label: "Saved" },
]

function Outcome({ event, operation }: { event: ActivityEvent; operation: Operation | undefined }) {
  switch (event.kind) {
    case "operation":
      return operation ? <StatusBadge kind="operation" value={operation.status} /> : <StatusBadge kind="operation" value="succeeded" label="Recorded" />
    case "write-failed":
      return <StatusBadge kind="save" value="failed" />
    case "write-refused":
      return <StatusBadge kind="save" value="stale" />
    case "refusal":
      return <StatusBadge kind="item" value="blocked" />
    case "saved":
      return <StatusBadge kind="save" value="saved" />
  }
}

function ActivityRow({ event, operation }: { event: ActivityEvent; operation: Operation | undefined }) {
  const [open, setOpen] = useState(false)
  const panelId = `activity-${event.id}-items`
  return (
    <li className="space-y-2 px-3 py-2">
      <div className="grid grid-cols-[9rem_8.5rem_minmax(0,1fr)_auto] items-start gap-3 text-sm">
        <time dateTime={event.at} className="text-xs text-muted-foreground tabular-nums">
          {formatDateTime(event.at)}
        </time>
        <span>
          <Outcome event={event} operation={operation} />
        </span>
        <div className="min-w-0">
          <div className="font-medium text-pretty">{event.title}</div>
          {event.detail ? (
            <p className="text-xs text-pretty text-muted-foreground">
              {/* Paths in the mono face (HLD §7); split() puts each captured path at an odd index. */}
              {event.detail.split(PATH).map((part, i) =>
                i % 2 === 1 ? (
                  <span key={i} className="font-mono">
                    {part}
                  </span>
                ) : (
                  part
                ),
              )}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          {operation && operation.items.length > 0 ? (
            <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
              {open ? "Hide items" : "Show items"}
            </Button>
          ) : null}
          {event.href ? (
            <Button size="sm" variant="outline" render={<a href={`#${event.href}`} />}>
              Open<span className="sr-only"> {event.title}</span>
            </Button>
          ) : null}
        </div>
      </div>
      {operation && open ? (
        <div id={panelId}>
          <OperationPanel operationId={operation.id} />
        </div>
      ) : null}
    </li>
  )
}

export function ActivityPage() {
  const activity = useStore((s) => s.activity)
  const operations = useStore((s) => s.operations)
  const unsettled = Object.values(operations)
    .filter((op) => !isSettled(op.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const [filter, setFilter] = useState<Filter>("all")
  const counts = Object.fromEntries(FILTERS.map((f) => [f.value, f.value === "all" ? activity.length : activity.filter((e) => e.kind === f.value).length])) as Record<Filter, number>
  const shown = filter === "all" ? activity : activity.filter((e) => e.kind === filter)

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
                <Button size="sm" variant="outline" render={<a href="#/targets" />}>
                  Go to Targets
                </Button>
              }
            />
          ) : shown.length === 0 ? (
            <EmptyState
              icon={ActivityIcon}
              title={`No entries in “${FILTERS.find((f) => f.value === filter)?.label}”`}
              description="Nothing of this kind has been recorded."
              action={
                <Button size="sm" variant="outline" onClick={() => setFilter("all")}>
                  Show all entries
                </Button>
              }
            />
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Activity history, newest first">
              {shown.map((event) => (
                <ActivityRow key={event.id} event={event} operation={event.operationId ? operations[event.operationId] : undefined} />
              ))}
            </ul>
          )}
        </Section>
      </PageBody>
    </div>
  )
}
