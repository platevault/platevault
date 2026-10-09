/**
 * Mark routing for S6 Review (D-W42, D-W54, PIX-FR-14, PIX-FR-17). Library
 * P/X/U goes through `markFrames` with the run that holds each frame, so a
 * Review all mark lands in that frame's own panel run; candidates and a
 * library session have no run and change library quality only. "Reject for
 * this Project" uses the Project-scoped reject; a session review has no
 * Project, so it refuses. Each call returns one result for the whole mark.
 */
import type { QualityValue, RunId } from "@/domain/types"
import { m } from "@/lib/i18n"
import { markFrames, rejectForProjectOnly } from "@/store/actions/library"
import { setProjectRejection } from "@/store/actions/projects"
import type { CommitResult } from "@/store/core"
import type { ReviewFrame, ReviewScope } from "./model"

/** The review word of each library mark; getters, so every read is in the chosen language. */
export const MARK_WORD: Record<QualityValue, string> = {
  get usable() {
    return m.review_picked()
  },
  get unusable() {
    return m.review_rejected()
  },
  get unreviewed() {
    return m.status_unreviewed()
  },
}

/** The frames a message names: the file name of one frame, else the count. */
export function framesWhat(frames: ReviewFrame[]): string {
  return frames.length === 1 ? frames[0]!.asset.fileName : m.review_frames_count({ count: frames.length })
}

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
  const project = scope.project
  if (!project) return { ok: false, reason: "refused", message: m.sessions_no_project(), reasons: [m.sessions_no_project()] }
  return firstFailure([...byRun(frames)].map(([runId, ids]) => (runId ? rejectForProjectOnly(runId, ids, rejected) : setProjectRejection(project.id, ids, rejected))))
}

/** "Rejected: 12 frames. Library scope. Removed from the run's draft as Rejected." The draft clause only when it changes. */
export function markAnnouncement(frames: ReviewFrame[], value: QualityValue): string {
  const open = frames.filter((f) => f.run !== null && f.run.completion === "open" && !f.run.trashedAt)
  const draft =
    value === "unusable"
      ? open.some((f) => f.member !== "rejected")
        ? m.review_mark_draft_removed()
        : null
      : open.some((f) => f.member === "rejected" && !f.quality.projectRejected)
        ? m.review_mark_draft_back()
        : open.some((f) => f.member === "rejected")
          ? m.review_mark_draft_still_out()
          : null
  const said = m.review_mark_announcement({ mark: MARK_WORD[value], what: framesWhat(frames) })
  return draft ? `${said} ${draft}` : said
}
