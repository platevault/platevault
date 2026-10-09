/**
 * Mark routing for S6 Review (D-W42, D-W54, PIX-FR-14, PIX-FR-17). Library
 * P/X/U goes through `markFrames` with the run that holds each frame, so a
 * Review all mark lands in that frame's own panel run; candidates have no run
 * and change library quality only. "Reject for this Project only" uses the
 * Project-scoped reject. Each call returns one result for the whole mark.
 */
import type { QualityValue, RunId } from "@/domain/types"
import { plural } from "@/lib/format"
import { markFrames, rejectForProjectOnly } from "@/store/actions/library"
import { setProjectRejection } from "@/store/actions/projects"
import type { CommitResult } from "@/store/core"
import type { ReviewFrame, ReviewScope } from "./model"

export const MARK_WORD: Record<QualityValue, string> = { usable: "Picked", unusable: "Rejected", unreviewed: "Unreviewed" }

function byRun(frames: ReviewFrame[]): Map<RunId | null, string[]> {
  const out = new Map<RunId | null, string[]>()
  for (const f of frames) out.set(f.run?.id ?? null, [...(out.get(f.run?.id ?? null) ?? []), f.asset.id])
  return out
}

function firstFailure(results: CommitResult[]): CommitResult {
  return results.find((r) => !r.ok) ?? { ok: true }
}

export function markLibrary(scope: ReviewScope, frames: ReviewFrame[], value: QualityValue): CommitResult {
  if (scope.readOnlyReason) return { ok: false, reason: "refused", message: scope.readOnlyReason, reasons: [scope.readOnlyReason] }
  return firstFailure([...byRun(frames)].map(([runId, ids]) => markFrames(ids, value, runId, scope.href)))
}

export function setProjectOnlyReject(scope: ReviewScope, frames: ReviewFrame[], rejected: boolean): CommitResult {
  if (scope.readOnlyReason) return { ok: false, reason: "refused", message: scope.readOnlyReason, reasons: [scope.readOnlyReason] }
  return firstFailure([...byRun(frames)].map(([runId, ids]) => (runId ? rejectForProjectOnly(runId, ids, rejected) : setProjectRejection(scope.project.id, ids, rejected))))
}

/** "Rejected: 12 frames. Library scope. Removed from the run's draft as Rejected." The draft clause only when it changes. */
export function markAnnouncement(frames: ReviewFrame[], value: QualityValue): string {
  const what = frames.length === 1 ? frames[0]!.asset.fileName : plural(frames.length, "frame")
  const open = frames.filter((f) => f.run !== null && f.run.completion === "open" && !f.run.trashedAt)
  const draft =
    value === "unusable"
      ? open.some((f) => f.member !== "rejected")
        ? " Removed from the run's draft as Rejected."
        : ""
      : open.some((f) => f.member === "rejected" && !f.quality.projectRejected)
        ? " Back in the run's draft."
        : open.some((f) => f.member === "rejected")
          ? " Still out of the run's draft: rejected for this Project."
          : ""
  return `${MARK_WORD[value]}: ${what}. Library scope.${draft}`
}
