/**
 * Operation progress and outcome (foundation-owned). Shows Running with
 * progress, per-item outcomes, the single settled status and the actions
 * that are safe for the kind (Pause, Resume, Cancel, Retry). A start
 * acknowledgment is never shown as success (PREP-FR-09).
 */
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Progress, ProgressValue } from "@/components/ui/progress"
import type { OperationId, OperationItemStatus } from "@/domain/types"
import { formatCount, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { cancelOperation, isSettled, pauseOperation, resumeOperation } from "@/store/operations"
import { PathText } from "./data"
import { StatusBadge } from "./status"

export interface OperationPanelProps {
  operationId: OperationId
  /** Retry for settled failed/partial outcomes; the owning track decides how. */
  onRetry?: () => void
  /** Items listed before "Show all". */
  itemLimit?: number
  /** Heading level of the panel title; 2 when the panel sits directly under the page h1. Default 3. */
  headingLevel?: 2 | 3 | 4
}

const ITEM_ORDER: OperationItemStatus[] = ["blocked", "failed", "uncertain", "running", "pending", "done", "skipped"]

export function OperationPanel({ operationId, onRetry, itemLimit = 8, headingLevel = 3 }: OperationPanelProps) {
  const op = useStore((s) => s.operations[operationId])
  const [showAll, setShowAll] = useState(false)
  const controls = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const keepFocus = useRef(false)
  // Pause, Resume, Retry and Cancel replace themselves when the status changes (WCAG 2.4.3):
  // move focus to the replacement control, else to the panel title, never to the page body.
  useEffect(() => {
    if (!keepFocus.current) return
    keepFocus.current = false
    if (controls.current?.contains(document.activeElement)) return
    ;(controls.current?.querySelector<HTMLElement>("button:not([disabled])") ?? heading.current)?.focus()
  }, [op?.id, op?.status])
  if (!op) return null
  const act = (action: () => void) => () => {
    keepFocus.current = true
    action()
  }
  const Heading = headingLevel === 2 ? "h2" : headingLevel === 4 ? "h4" : "h3"
  const settled = isSettled(op.status)
  const value = op.progress.total > 0 ? Math.min(100, (op.progress.done / op.progress.total) * 100) : settled ? 100 : null
  const items = [...op.items].sort((a, b) => ITEM_ORDER.indexOf(a.status) - ITEM_ORDER.indexOf(b.status))
  const shown = showAll ? items : items.slice(0, itemLimit)
  const counts = op.items.reduce<Partial<Record<OperationItemStatus, number>>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <section aria-labelledby={`${op.id}-title`} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Heading ref={heading} id={`${op.id}-title`} tabIndex={-1} className="text-sm font-semibold outline-none">
            {op.title}
          </Heading>
          <StatusBadge kind="operation" value={op.status} />
        </div>
        <div ref={controls} className="flex flex-wrap gap-2">
          {op.status === "running" && op.canPause ? (
            <Button size="sm" variant="outline" onClick={act(() => pauseOperation(op.id))}>
              Pause
            </Button>
          ) : null}
          {op.status === "paused" || op.status === "interrupted" ? (
            <Button size="sm" variant="outline" onClick={act(() => resumeOperation(op.id))}>
              {op.status === "paused" ? "Resume" : "Retry"}
            </Button>
          ) : null}
          {!settled && op.canCancel ? (
            <Button size="sm" variant="outline" onClick={act(() => cancelOperation(op.id))}>
              Cancel
            </Button>
          ) : null}
          {settled && (op.status === "failed" || op.status === "partial") && onRetry ? (
            <Button size="sm" variant="outline" onClick={act(onRetry)}>
              Retry
            </Button>
          ) : null}
        </div>
      </div>

      <Progress
        value={value}
        aria-label={`${op.title} progress`}
        getAriaValueText={(formatted) =>
          `${formatCount(op.progress.done)} of ${formatCount(op.progress.total)} ${op.progress.unit}, ${formatted}`
        }
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
          {formatCount(op.progress.done)} of {formatCount(op.progress.total)} {op.progress.unit}
        </span>
        <ProgressValue className="text-xs" aria-hidden="true" />
      </Progress>

      <p className="sr-only" aria-live="polite">
        {settled ? `${op.title}: ${op.summary ?? op.status}` : ""}
      </p>

      {op.summary ? <p className="text-sm text-pretty">{op.summary}</p> : null}

      {op.items.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground tabular-nums">
            {(Object.keys(counts) as OperationItemStatus[])
              .sort((a, b) => ITEM_ORDER.indexOf(a) - ITEM_ORDER.indexOf(b))
              .map((status) => `${counts[status]} ${status}`)
              .join(" · ")}
          </p>
          <ul className="divide-y border-t">
            {shown.map((item) => (
              <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 py-1.5 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{item.label}</div>
                  {item.path ? <PathText path={item.path} className="text-muted-foreground" /> : null}
                  {item.detail ? <div className="text-xs text-pretty text-muted-foreground">{item.detail}</div> : null}
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
              {showAll ? "Show fewer" : `Show all ${formatCount(items.length)} items`}
            </Button>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Started {formatDateTime(op.createdAt)}
        {op.settledAt ? ` · settled ${formatDateTime(op.settledAt)}` : ""}
      </p>
    </section>
  )
}
