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
import { useMessages } from "@/app/preferences"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { Operation } from "@/domain/types"
import { type MeasurePayload, startMeasurement, unfinishedCount } from "@/features/t3/measure"
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
  const m = useMessages()
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
  const notMeasuredText = m.measure_frames_not_measured({ count: notMeasured })
  const coverage = notMeasured === 0 ? m.measure_all_have_value() : `${notMeasuredText}.`
  const summary = last?.status === "canceled" ? m.measure_canceled_summary({ count: unfinished }) : last?.summary ? `${last.summary} ${coverage}` : coverage

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
    if (startScopeMeasurement(scope) > 0) setSaid(m.measure_started({ count: total }))
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
    const word = paused ? (active.some((op) => op.status === "interrupted") ? m.measure_interrupted_restart() : m.status_paused()) : verifying ? m.measure_verifying_cached() : m.measure_measuring()
    return (
      <span className="flex min-w-0 items-center gap-2">
        {status}
        <Progress value={total > 0 ? (done / total) * 100 : 0} aria-label={m.measure_progress_label()} getAriaValueText={() => m.sessions_import_progress({ done, total })} className="w-24 shrink-0" />
        <span className="min-w-0 truncate tabular-nums">{m.measure_progress_text({ word, done, total })}</span>
        {paused ? (
          <Button size="xs" variant="outline" onClick={start}>
            {m.verb_resume()}
          </Button>
        ) : null}
        <Button ref={cancelRef} size="xs" variant="outline" onClick={() => active.forEach((op) => cancelOperation(op.id))}>
          {m.verb_cancel()}
        </Button>
      </span>
    )
  }
  const disabledReason = scope.readOnlyReason
  return (
    <span className="flex min-w-0 items-center gap-2">
      {status}
      {last ? <StatusBadge kind="operation" value={last.status} className="shrink-0" /> : null}
      <span className="min-w-0 truncate" title={unreadable > 0 ? `${summary} ${m.measure_frames_unreadable({ count: unreadable })}` : summary}>
        {notMeasured === 0 ? m.measure_all_measured() : notMeasuredText}
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
            title={disabledReason ? m.measure_blocked({ reason: disabledReason }) : undefined}
            className="shrink-0 aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            {m.measure_frames_action()}
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
