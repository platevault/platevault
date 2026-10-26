/**
 * Operation progress and outcome (foundation-owned). Shows Running with
 * progress, per-item outcomes, the single settled status and the actions
 * the owner offers (Pause, Resume, Cancel, Retry). A start acknowledgment is
 * never shown as success (PREP-FR-09). `OperationLine` is the same status and
 * actions on one fixed-height line, for a pane header where a panel would
 * push the page down.
 *
 * The panel shows the operation it is given and calls back for each action;
 * the owner runs the library call and passes the operation's next state. An
 * action the operation's kind does not allow is one the owner leaves out.
 */
import { type RefObject, useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import { Progress, ProgressValue } from "@/components/ui/progress"
import { formatCount, formatDateTime } from "@/lib/format"
import { type MessageRef, type Messages, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { titleWhenCut } from "./cut-title"
import { PathText } from "./data"
import { StatusBadge, type StatusValue, statusMeta } from "./status"

export type OperationStatus = StatusValue<"operation">
export type OperationItemStatus = StatusValue<"item">

/** What an operation counts, as a plural noun beside its totals: "12 of 40 frames". */
export type OperationUnit = "files" | "frames" | "entries" | "prepared-entries" | "sessions" | "items"

export interface OperationItemView {
  id: string
  /** Usually a file or location name, as data (`verbatim`). */
  label: MessageRef
  path: string | null
  status: OperationItemStatus
  /** Kind-specific phase, for example "destination-verified". */
  phase: string | null
  detail: MessageRef | null
}

/**
 * One operation as the panel shows it. The library has no general operation
 * read (astro-plan-wre19): the owning feature maps its own run state (a
 * scan, a measurement run, a Project operation) onto this view. Copy is a
 * `MessageRef`, worded at render, so it follows a language switch.
 */
export interface OperationView {
  id: string
  title: MessageRef
  status: OperationStatus
  progress: { done: number; total: number; unit: OperationUnit }
  items: readonly OperationItemView[]
  summary: MessageRef | null
  createdAt: string
  settledAt: string | null
}

/** The actions the owner offers; each shows only in the states it applies to, and only when given. */
export interface OperationActions {
  /** Pause a running operation. */
  onPause?: () => void
  /** Resume a paused operation, or retry an interrupted one. */
  onResume?: () => void
  /** Cancel an operation that has not settled. */
  onCancel?: () => void
  /** Retry for settled failed/partial outcomes; the owning track decides how. */
  onRetry?: () => void
}

export interface OperationPanelProps extends OperationActions {
  operation: OperationView
  /** Items listed before "Show all". */
  itemLimit?: number
  /** Heading level of the panel title; 2 when the panel sits directly under the page h1. Default 3. */
  headingLevel?: 2 | 3 | 4
}

const ITEM_ORDER: OperationItemStatus[] = ["blocked", "failed", "uncertain", "running", "pending", "done", "skipped"]

const UNSETTLED: readonly OperationStatus[] = ["running", "paused", "interrupted"]

/** Whether the operation has its one outcome: not running, paused or interrupted. */
function isSettled(status: OperationStatus): boolean {
  return !UNSETTLED.includes(status)
}

const UNIT_NAME: Record<OperationUnit, (m: Messages) => string> = {
  files: (m) => m.op_unit_files(),
  frames: (m) => m.op_unit_frames(),
  entries: (m) => m.op_unit_entries(),
  "prepared-entries": (m) => m.op_unit_prepared_entries(),
  sessions: (m) => m.op_unit_sessions(),
  items: (m) => m.op_unit_items(),
}

export function OperationPanel({ operation: op, itemLimit = 8, headingLevel = 3, ...actions }: OperationPanelProps) {
  const m = useMessages()
  const [showAll, setShowAll] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const Heading = headingLevel === 2 ? "h2" : headingLevel === 4 ? "h4" : "h3"
  const settled = isSettled(op.status)
  const value = op.progress.total > 0 ? Math.min(100, (op.progress.done / op.progress.total) * 100) : settled ? 100 : null
  const items = [...op.items].sort((a, b) => ITEM_ORDER.indexOf(a.status) - ITEM_ORDER.indexOf(b.status))
  const shown = showAll ? items : items.slice(0, itemLimit)
  const counts = op.items.reduce<Partial<Record<OperationItemStatus, number>>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, {})
  const title = say(m, op.title)
  const summary = op.summary ? say(m, op.summary) : null
  const unit = UNIT_NAME[op.progress.unit](m)

  return (
    <section aria-labelledby={`${op.id}-title`} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Heading ref={heading} id={`${op.id}-title`} tabIndex={-1} className="text-sm font-semibold outline-none">
            {title}
          </Heading>
          <StatusBadge kind="operation" value={op.status} />
        </div>
        <OperationControls op={op} actions={actions} fallback={heading} />
      </div>

      <Progress
        value={value}
        aria-label={m.operation_progress_label({ title })}
        getAriaValueText={(formatted) => m.operation_progress_value({ done: formatCount(op.progress.done), total: formatCount(op.progress.total), unit, percent: formatted ?? "" })}
        className={cn(
          // The bar ends in the colour of the outcome; a partial run never reads as success.
          op.status === "succeeded" && "[&_[data-slot=progress-indicator]]:bg-success",
          (op.status === "partial" || op.status === "interrupted") && "[&_[data-slot=progress-indicator]]:bg-warning",
          op.status === "failed" && "[&_[data-slot=progress-indicator]]:bg-destructive",
          (op.status === "canceled" || op.status === "paused") && "[&_[data-slot=progress-indicator]]:bg-muted-foreground",
        )}
      >
        {/* Plain text, not ProgressLabel: the label would replace the bar's stable name with a changing count. */}
        <span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">
          {m.operation_progress_count({ done: formatCount(op.progress.done), total: formatCount(op.progress.total), unit })}
        </span>
        <ProgressValue className="text-xs" aria-hidden="true" />
      </Progress>

      <SettledAnnouncement op={op} title={title} summary={summary} />

      {summary ? <p className="text-sm text-pretty">{summary}</p> : null}

      {op.items.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground tabular-nums">
            {(Object.keys(counts) as OperationItemStatus[])
              .sort((a, b) => ITEM_ORDER.indexOf(a) - ITEM_ORDER.indexOf(b))
              .map((status) => `${counts[status]} ${statusMeta("item", status).label}`)
              .join(" · ")}
          </p>
          <ul className="divide-y border-t">
            {shown.map((item) => (
              <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 py-1.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{say(m, item.label)}</div>
                  {item.path ? <PathText path={item.path} className="text-muted-foreground" /> : null}
                  {item.detail ? <div className="text-xs text-pretty text-muted-foreground">{say(m, item.detail)}</div> : null}
                </div>
                <div className="flex items-center gap-2">
                  {item.phase ? <span className="text-xs text-muted-foreground">{item.phase}</span> : null}
                  <StatusBadge kind="item" value={item.status} />
                </div>
              </li>
            ))}
          </ul>
          {items.length > itemLimit ? (
            <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
              {showAll ? m.operation_show_fewer() : m.operation_show_all({ count: formatCount(items.length) })}
            </Button>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {m.operation_started({ date: formatDateTime(op.createdAt) })}
        {op.settledAt ? ` · ${m.operation_settled({ date: formatDateTime(op.settledAt) })}` : ""}
      </p>
    </section>
  )
}

export interface OperationLineProps extends OperationActions {
  operation: OperationView
  className?: string
}

/** One line: title, status, percent (or when it settled) and the actions; the line keeps one height in every state. */
export function OperationLine({ operation: op, className, ...actions }: OperationLineProps) {
  const m = useMessages()
  const name = useRef<HTMLSpanElement>(null)
  const title = say(m, op.title)
  const summary = op.summary ? say(m, op.summary) : null
  const percent = op.progress.total > 0 ? `${Math.round(Math.min(1, op.progress.done / op.progress.total) * 100)}%` : null
  return (
    <div className={cn("flex h-6 min-w-0 items-center gap-2 text-xs", className)} data-operation-line={op.id}>
      <span ref={name} tabIndex={-1} className="min-w-0 truncate font-medium outline-none" onPointerEnter={titleWhenCut}>
        {title}
      </span>
      <StatusBadge kind="operation" value={op.status} />
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {isSettled(op.status) && op.settledAt ? formatDateTime(op.settledAt) : percent}
      </span>
      <OperationControls op={op} actions={actions} fallback={name} size="xs" />
      <SettledAnnouncement op={op} title={title} summary={summary} />
    </div>
  )
}

function SettledAnnouncement({ op, title, summary }: { op: OperationView; title: string; summary: string | null }) {
  return (
    <p className="sr-only" aria-live="polite">
      {isSettled(op.status) ? `${title}: ${summary ?? statusMeta("operation", op.status).label}` : ""}
    </p>
  )
}

/**
 * Pause, Resume, Cancel and Retry, as the owner offers them. They replace
 * themselves when the status changes (WCAG 2.4.3): focus moves to the
 * replacement control, else to `fallback`, never to the page body.
 */
function OperationControls({ op, actions, fallback, size = "sm" }: { op: OperationView; actions: OperationActions; fallback: RefObject<HTMLElement | null>; size?: "sm" | "xs" }) {
  const { onPause, onResume, onCancel, onRetry } = actions
  const m = useMessages()
  const controls = useRef<HTMLDivElement>(null)
  const keepFocus = useRef(false)
  useEffect(() => {
    if (!keepFocus.current) return
    keepFocus.current = false
    if (controls.current?.contains(document.activeElement)) return
    ;(controls.current?.querySelector<HTMLElement>("button:not([disabled])") ?? fallback.current)?.focus()
  }, [op.id, op.status, fallback])
  const act = (action: () => void) => () => {
    keepFocus.current = true
    action()
  }
  const settled = isSettled(op.status)
  return (
    <div ref={controls} className={cn("flex shrink-0", size === "sm" ? "flex-wrap gap-2" : "gap-1")}>
      {op.status === "running" && onPause ? (
        <Button size={size} variant="outline" onClick={act(onPause)}>
          {m.verb_pause()}
        </Button>
      ) : null}
      {(op.status === "paused" || op.status === "interrupted") && onResume ? (
        <Button size={size} variant="outline" onClick={act(onResume)}>
          {op.status === "paused" ? m.verb_resume() : m.verb_retry()}
        </Button>
      ) : null}
      {!settled && onCancel ? (
        <Button size={size} variant="outline" onClick={act(onCancel)}>
          {m.verb_cancel()}
        </Button>
      ) : null}
      {settled && (op.status === "failed" || op.status === "partial") && onRetry ? (
        <Button size={size} variant="outline" onClick={act(onRetry)}>
          {m.verb_retry()}
        </Button>
      ) : null}
    </div>
  )
}
