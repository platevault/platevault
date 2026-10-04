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

function Outcome({ event, operation }: { event: ActivityEvent; operation: Operation | undefined }) {
  switch (event.kind) {
    case "operation":
      return operation ? <StatusBadge kind="operation" value={operation.status} /> : <StatusBadge kind="operation" value="succeeded" label="Recorded" />
    case "write-failed":
      return <StatusBadge kind="save" value="failed" />
    case "write-refused":
      return <StatusBadge kind="save" value="stale" />
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
      <tr className="border-b align-top last:border-0">
        <td className="px-3 py-2">
          <time dateTime={event.at} className="text-xs text-muted-foreground tabular-nums">
            {formatDateTime(event.at)}
          </time>
        </td>
        <td className="px-3 py-2">
          <Outcome event={event} operation={operation} />
        </td>
        <th scope="row" className="min-w-0 px-3 py-2 text-left font-normal">
          <div className="font-medium text-pretty">{event.title}</div>
          {event.detail ? (
            <p className="text-xs text-pretty text-muted-foreground">
              {/* Paths in the mono face (HLD §7); split() puts each captured path at an odd index. */}
              {event.detail.split(PATH).map((part, i) =>
                i % 2 === 1 ? (
                  <span key={i} className="font-mono break-all">
                    {part}
                  </span>
                ) : (
                  part
                ),
              )}
            </p>
          ) : null}
        </th>
        <td className="px-3 py-2">
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
                <Button size="sm" variant="outline" render={<a href="#/targets" />}>
                  Go to Targets
                </Button>
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
            <div className="rounded-lg border">
              <table className="w-full table-fixed text-sm">
                <caption className="sr-only">Activity history, newest first</caption>
                <colgroup>
                  <col className="w-36" />
                  <col className="w-36" />
                  <col />
                  <col className="w-48" />
                </colgroup>
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
