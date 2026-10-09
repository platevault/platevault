/**
 * Measurement status and the Measure frames control (PIX-FR-01, PIX-AC-01,
 * PIX-AC-06): Review opens idle; only this control starts, resumes or
 * finishes measuring, the current frame first. One line, so the list and the
 * preview keep their room. A Review all measures each panel run's frames.
 */
import { useId } from "react"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { Operation } from "@/domain/types"
import { type MeasurePayload, startMeasurement, unfinishedCount } from "@/features/t3/measure"
import { plural } from "@/lib/format"
import { cancelOperation, isSettled } from "@/store/operations"
import type { ReviewFrame, ReviewScope } from "./model"

/** Readable frames that still need a built-in value, grouped by the key their measurement runs under. */
export function measureTargets(scope: ReviewScope): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const f of scope.frames) {
    if (f.availability !== "available" || f.member === "unresolved") continue
    const key = f.run?.id ?? scope.key
    out.set(key, [...(out.get(key) ?? []), f.asset.id])
  }
  return out
}

export function startScopeMeasurement(scope: ReviewScope): number {
  let started = 0
  for (const [key, ids] of measureTargets(scope)) if (startMeasurement(key, ids)) started += 1
  return started
}

export function MeasureBar({ scope, frames }: { scope: ReviewScope; frames: ReviewFrame[] }) {
  const reasonId = useId()
  const active = scope.ops.filter((op) => !isSettled(op.status))
  const notMeasured = frames.filter((f) => f.availability === "available" && f.member !== "unresolved" && f.measure !== "measured").length
  const unreadable = frames.filter((f) => f.availability !== "available").length
  if (active.length > 0) {
    const done = active.reduce((n, op) => n + op.progress.done, 0)
    const total = active.reduce((n, op) => n + op.progress.total, 0)
    const verifying = active.some((op) => (op.payload as unknown as MeasurePayload).verify.length > 0)
    const paused = active.every((op) => op.status !== "running")
    return (
      <div className="flex min-h-8 shrink-0 items-center gap-3 border-b border-separator px-3 py-1">
        <Progress value={total > 0 ? (done / total) * 100 : 0} aria-label="Measurement progress" getAriaValueText={() => `${done} of ${total} frames`} className="min-w-40 flex-1 gap-0.5">
          <span className="text-xs tabular-nums" aria-hidden="true">
            {paused ? (active.some((op) => op.status === "interrupted") ? "Measurement interrupted by a restart" : "Measurement paused") : verifying ? "Verifying cached values" : "Measuring frames"}: {done} of {total} · current frame first
          </span>
        </Progress>
        {paused ? (
          <Button size="sm" onClick={() => startScopeMeasurement(scope)}>
            Resume
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => active.forEach((op) => cancelOperation(op.id))}>
          Cancel
        </Button>
      </div>
    )
  }
  const last: Operation | undefined = [...scope.ops].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)
  const unfinished = scope.ops.reduce((n, op) => n + unfinishedCount(op), 0)
  const disabledReason = scope.readOnlyReason
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-separator px-3 py-1 text-xs">
      <p className="min-w-0 flex-1 text-pretty text-muted-foreground">
        {last ? <StatusBadge kind="operation" value={last.status} className="mr-2" /> : null}
        {last?.status === "canceled" ? `Measurement canceled; ${unfinished} not measured. ` : last?.summary ? `${last.summary} ` : null}
        {notMeasured === 0
          ? "Every readable frame has a built-in value."
          : last
            ? `${plural(notMeasured, "frame")} not measured.`
            : `${plural(notMeasured, "frame")} not measured yet. Only Measure frames starts it; browsing and filtering never measure.`}
        {unreadable > 0 ? ` ${plural(unreadable, "frame")} cannot be read now and stay Not measured.` : ""}
      </p>
      {notMeasured > 0 ? (
        <>
          <Button
            size="sm"
            onClick={() => startScopeMeasurement(scope)}
            disabled={disabledReason !== null}
            focusableWhenDisabled
            aria-describedby={disabledReason ? reasonId : undefined}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            Measure frames
          </Button>
          {disabledReason ? (
            <span id={reasonId} className="sr-only">
              {disabledReason}
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
