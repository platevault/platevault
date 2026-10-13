/**
 * Measurement status and Measure frames (PIX-FR-01, PIX-AC-01, PIX-AC-06):
 * Review opens idle; only this control starts, resumes or cancels
 * measuring, the current frame first. It sits in the workspace's status
 * line, so the list and the plate keep their room. The start and the
 * summary are announced (WCAG 4.1.3); the running count reads in the line.
 */
import { useEffect, useRef } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { announce } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import type { Operation } from "@/domain/types"
import { say } from "@/lib/i18n"
import { type MeasurePayload, startMeasurement, unfinishedCount } from "@/store/actions/measure"
import { cancelOperation, isSettled } from "@/store/operations"
import type { ReviewFrame, ReviewScope } from "./model"

/** Readable frames that still need a built-in value, the current frame first. */
function measureTargets(scope: ReviewScope, currentId: string | null): string[] {
  const ids = scope.frames.filter((f) => f.availability === "available").map((f) => f.asset.id)
  return currentId && ids.includes(currentId) ? [currentId, ...ids.filter((id) => id !== currentId)] : ids
}

/** The measurement items of the status line. `blocked` keeps Measure frames focusable but unavailable. */
export function MeasureStatus({ scope, frames, currentId, blocked }: { scope: ReviewScope; frames: ReviewFrame[]; currentId: string | null; blocked: Action["unavailable"] }) {
  const m = useMessages()
  const active = scope.ops.filter((op) => !isSettled(op.status))
  const running = active.length > 0
  const notMeasured = frames.filter((f) => f.availability === "available" && f.measure !== "measured").length
  const unreadable = frames.filter((f) => f.availability !== "available").length
  const last: Operation | undefined = scope.ops.at(-1)
  const unfinished = scope.ops.reduce((n, op) => n + unfinishedCount(op), 0)
  const coverage = notMeasured === 0 ? m.measure_all_have_value() : `${m.measure_frames_not_measured({ count: notMeasured })}.`
  const summary = last?.status === "canceled" ? m.measure_canceled_summary({ count: unfinished }) : last?.summary ? `${say(m, last.summary)} ${coverage}` : coverage

  // The summary is announced once a measurement settles.
  const wasRunning = useRef(running)
  useEffect(() => {
    if (wasRunning.current && !running) announce(summary)
    wasRunning.current = running
  }, [running, summary])

  const start: Action = {
    id: "measure-frames",
    label: m.measure_frames_action(),
    unavailable: blocked,
    run: () => {
      const ids = measureTargets(scope, currentId)
      if (startMeasurement(scope.key, ids)) announce(m.measure_started({ count: ids.length }))
    },
  }

  if (running) {
    const done = active.reduce((n, op) => n + op.progress.done, 0)
    const total = active.reduce((n, op) => n + op.progress.total, 0)
    const verifying = active.some((op) => (op.payload as unknown as MeasurePayload).verify.length > 0)
    const paused = active.every((op) => op.status !== "running")
    const word = paused ? (active.some((op) => op.status === "interrupted") ? m.measure_interrupted_restart() : m.status_paused()) : verifying ? m.measure_verifying_cached() : m.measure_measuring()
    const cancel: Action = { id: "measure-cancel", label: m.verb_cancel(), run: () => active.forEach((op) => cancelOperation(op.id)) }
    return (
      <>
        <StatusBadge kind="operation" value="running" label={m.measure_progress_text({ word, done, total })} />
        {paused ? <ActionButton action={{ ...start, label: m.verb_resume() }} /> : null}
        <ActionButton action={cancel} />
      </>
    )
  }
  return (
    <>
      {last ? <StatusBadge kind="operation" value={last.status} /> : null}
      {notMeasured === 0 ? m.measure_all_measured() : m.measure_frames_not_measured({ count: notMeasured })}
      {unreadable > 0 ? ` · ${m.measure_frames_unreadable({ count: unreadable })}` : null}
      {notMeasured > 0 ? <ActionButton action={start} /> : null}
    </>
  )
}
