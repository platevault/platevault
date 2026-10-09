/**
 * Measurement status and the Measure frames control (PIX-FR-01, PIX-AC-01,
 * PIX-AC-06): Review opens idle; only this control starts, resumes or
 * finishes measuring, the current frame first. It sits in Review's status
 * line, so the list and the preview keep their room. A Review all measures
 * each panel run's frames.
 *
 * Focus and announcements (WCAG 2.4.3, 4.1.3): Measure frames hands focus to
 * the Cancel button that replaces it, and back to the status line when the
 * measurement settles. The start and the summary are announced in a
 * role=status region; the progress bar carries the running count.
 */
import { type RefObject, useEffect, useId, useRef, useState } from "react"
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

/** The measurement part of Review's status line; `home` is the focusable status line focus returns to. */
export function MeasureBar({ scope, frames, home }: { scope: ReviewScope; frames: ReviewFrame[]; home: RefObject<HTMLElement | null> }) {
  const reasonId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const handOff = useRef(false)
  const [said, setSaid] = useState("")
  const active = scope.ops.filter((op) => !isSettled(op.status))
  const running = active.length > 0
  const notMeasured = frames.filter((f) => f.availability === "available" && f.member !== "unresolved" && f.measure !== "measured").length
  const unreadable = frames.filter((f) => f.availability !== "available").length
  const last: Operation | undefined = [...scope.ops].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1)
  const unfinished = scope.ops.reduce((n, op) => n + unfinishedCount(op), 0)
  const summary =
    last?.status === "canceled"
      ? `Measurement canceled; ${unfinished} not measured.`
      : `${last?.summary ? `${last.summary} ` : ""}${notMeasured === 0 ? "Every readable frame has a built-in value." : `${plural(notMeasured, "frame")} not measured.`}`

  // Focus follows the control that replaced the one you pressed, then settles on the status line.
  const wasRunning = useRef(running)
  useEffect(() => {
    if (running && handOff.current) {
      handOff.current = false
      cancelRef.current?.focus()
    }
    if (wasRunning.current && !running) {
      setSaid(summary)
      const focus = document.activeElement
      if (!focus || focus === document.body || home.current?.contains(focus)) home.current?.focus()
    }
    wasRunning.current = running
  }, [running, summary, home])

  const start = () => {
    const total = [...measureTargets(scope).values()].reduce((n, ids) => n + ids.length, 0)
    handOff.current = true
    if (startScopeMeasurement(scope) > 0) setSaid(`Measuring ${plural(total, "frame")}, the current frame first.`)
    else handOff.current = false
  }

  const status = (
    <span role="status" className="sr-only">
      {said}
    </span>
  )

  if (running) {
    const done = active.reduce((n, op) => n + op.progress.done, 0)
    const total = active.reduce((n, op) => n + op.progress.total, 0)
    const verifying = active.some((op) => (op.payload as unknown as MeasurePayload).verify.length > 0)
    const paused = active.every((op) => op.status !== "running")
    const word = paused ? (active.some((op) => op.status === "interrupted") ? "Interrupted by a restart" : "Paused") : verifying ? "Verifying cached values" : "Measuring"
    return (
      <span className="flex min-w-0 items-center gap-2">
        {status}
        <Progress value={total > 0 ? (done / total) * 100 : 0} aria-label="Measurement progress" getAriaValueText={() => `${done} of ${total} frames`} className="w-24 shrink-0" />
        <span className="min-w-0 truncate tabular-nums">
          {word}: {done} of {total}
        </span>
        {paused ? (
          <Button size="xs" variant="outline" onClick={start}>
            Resume
          </Button>
        ) : null}
        <Button ref={cancelRef} size="xs" variant="outline" onClick={() => active.forEach((op) => cancelOperation(op.id))}>
          Cancel
        </Button>
      </span>
    )
  }
  const disabledReason = scope.readOnlyReason
  return (
    <span className="flex min-w-0 items-center gap-2">
      {status}
      {last ? <StatusBadge kind="operation" value={last.status} className="shrink-0" /> : null}
      <span className="min-w-0 truncate" title={`${summary}${unreadable > 0 ? ` ${plural(unreadable, "frame")} unreadable.` : ""}`}>
        {notMeasured === 0 ? "All measured" : `${plural(notMeasured, "frame")} not measured`}
      </span>
      {notMeasured > 0 ? (
        <>
          <Button
            size="xs"
            variant="outline"
            onClick={start}
            disabled={disabledReason !== null}
            focusableWhenDisabled
            aria-describedby={disabledReason ? reasonId : undefined}
            title={disabledReason ? `Measuring blocked · ${disabledReason}` : undefined}
            className="shrink-0 aria-disabled:pointer-events-none aria-disabled:opacity-50"
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
    </span>
  )
}
