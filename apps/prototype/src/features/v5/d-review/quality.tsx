/**
 * Quality and membership labels for S6 Review (D-W42, PIX-FR-14): glyph plus
 * word, as in v4. Picked, Rejected and Unreviewed are the review words for
 * library Usable, Unusable and Unreviewed; a reject always names its scope.
 */
import { useMessages } from "@/app/preferences"
import { StatusBadge } from "@/components/app/status"
import type { MemberState } from "@/domain/membership"
import type { Messages } from "@/lib/i18n"
import type { ReviewFrame } from "./model"

/** The frame's quality in words; `short` drops the detail after a reject's scope and after Unreviewed. */
export function qualityWord(m: Messages, frame: ReviewFrame, short = false): string {
  const { library, project } = frame.rejectedBy
  if (library && project) return short ? m.review_quality_rejected_both_short() : m.review_quality_rejected_both()
  if (library) return m.review_quality_rejected_library()
  if (project) return m.review_quality_rejected_project()
  if (frame.quality.library === "usable") return m.review_picked()
  if (!short && frame.quality.library === "changed-content") return m.review_quality_unreviewed_changed()
  if (!short && frame.quality.library === "verification-pending") return m.review_quality_unreviewed_pending()
  return m.status_unreviewed()
}

/** `short` drops the detail after a reject's scope; `compact` (thumbnails) keeps only the word, plus "Project" for a Project-only reject. */
export function QualityLabel({ frame, short = false, compact = false }: { frame: ReviewFrame; short?: boolean; compact?: boolean }) {
  const m = useMessages()
  const { library, project } = frame.rejectedBy
  const word = qualityWord(m, frame)
  const label = compact
    ? project && !library
      ? m.review_quality_rejected_project_compact()
      : frame.bucket === "picked"
        ? m.review_picked()
        : frame.bucket === "rejected"
          ? m.review_rejected()
          : m.status_unreviewed()
    : short
      ? qualityWord(m, frame, true)
      : word
  const title = compact ? word : project && !library ? m.review_quality_library_title({ word: frame.quality.library === "usable" ? m.review_picked() : m.status_unreviewed() }) : undefined
  const value = library
    ? ("unusable" as const)
    : project
      ? ("project-rejected" as const)
      : frame.quality.library === "usable"
        ? ("usable" as const)
        : frame.quality.library === "changed-content"
          ? ("changed-content" as const)
          : frame.quality.library === "verification-pending"
            ? ("verification-pending" as const)
            : ("unreviewed" as const)
  return (
    <span title={title}>
      <StatusBadge kind="quality" value={value} label={label} />
    </span>
  )
}

/** A frame's state in the run's draft, in words. */
export function memberWord(m: Messages, member: MemberState): string {
  switch (member) {
    case "included":
      return m.review_member_included()
    case "rejected":
      return m.review_member_rejected()
    case "excluded":
      return m.review_member_excluded()
    case "unresolved":
      return m.status_unresolved()
  }
}
