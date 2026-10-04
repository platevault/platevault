/**
 * Operation progress and outcome (foundation-owned). Shows Running with
 * progress, per-item outcomes, the single settled status and the actions
 * that are safe for the kind (Pause, Resume, Cancel, Retry). A start
 * acknowledgment is never shown as success (PREP-FR-09).
 */
import { useState } from "react"
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
}

const ITEM_ORDER: OperationItemStatus[] = ["blocked", "failed", "uncertain", "running", "pending", "done", "skipped"]

export function OperationPanel({ operationId, onRetry, itemLimit = 8 }: OperationPanelProps) {
  const op = useStore((s) => s.operations[operationId])
  const [showAll, setShowAll] = useState(false)
  if (!op) return null
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
          <h3 id={`${op.id}-title`} className="text-sm font-semibold">
            {op.title}
          </h3>
          <StatusBadge kind="operation" value={op.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {op.status === "running" && op.canPause ? (
            <Button size="sm" variant="outline" onClick={() => pauseOperation(op.id)}>
              Pause
            </Button>
          ) : null}
          {op.status === "paused" || op.status === "interrupted" ? (
            <Button size="sm" variant="outline" onClick={() => resumeOperation(op.id)}>
              {op.status === "paused" ? "Resume" : "Retry"}
            </Button>
          ) : null}
          {!settled && op.canCancel ? (
            <Button size="sm" variant="outline" onClick={() => cancelOperation(op.id)}>
              Cancel
            </Button>
          ) : null}
          {settled && (op.status === "failed" || op.status === "partial") && onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
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
