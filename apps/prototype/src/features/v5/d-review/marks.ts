/**
 * Mark routing for Review (D-W54, PIX-FR-14, PIX-FR-17, P-REJ2). P, X and U
 * set library quality through `markFrames`, which is library-wide: X marks a
 * frame Unusable everywhere and takes it out of every open run's draft. The
 * store refuses a mark while an unfinished run's prepared view holds the
 * session (C10). Each call returns one result for the whole mark.
 */
import type { QualityValue } from "@/domain/types"
import { m } from "@/lib/i18n"
import { markFrames } from "@/store/actions/library"
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

export function markLibrary(scope: ReviewScope, frames: ReviewFrame[], value: QualityValue): CommitResult {
  return markFrames(
    frames.map((f) => f.asset.id),
    value,
    scope.href,
  )
}

/** "Rejected: 12 frames. Library scope." */
export function markAnnouncement(frames: ReviewFrame[], value: QualityValue): string {
  return m.review_mark_announcement({ mark: MARK_WORD[value], what: framesWhat(frames) })
}
