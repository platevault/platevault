/**
 * Quality and membership labels for S6 Review (D-W42, PIX-FR-14): glyph plus
 * word, as in v4. Picked, Rejected and Unreviewed are the review words for
 * library Usable, Unusable and Unreviewed; a reject always names its scope.
 */
import { StatusBadge } from "@/components/app/status"
import type { MemberState } from "@/domain/membership"
import type { ReviewFrame } from "./model"

export function qualityWord(frame: ReviewFrame): string {
  const { library, project } = frame.rejectedBy
  if (library && project) return "Rejected · Library and this Project"
  if (library) return "Rejected · Library"
  if (project) return "Rejected · This Project"
  if (frame.quality.library === "usable") return "Picked"
  if (frame.quality.library === "changed-content") return "Unreviewed · changed content"
  if (frame.quality.library === "verification-pending") return "Unreviewed · verification pending"
  return "Unreviewed"
}

/** `short` drops the detail after a reject's scope; `compact` (thumbnails) keeps only the word, plus "Project" for a Project-only reject. */
export function QualityLabel({ frame, short = false, compact = false }: { frame: ReviewFrame; short?: boolean; compact?: boolean }) {
  const { library, project } = frame.rejectedBy
  const word = qualityWord(frame)
  const label = compact
    ? project && !library
      ? "Rejected · Project"
      : frame.bucket === "picked"
        ? "Picked"
        : frame.bucket === "rejected"
          ? "Rejected"
          : "Unreviewed"
    : short
      ? word.replace(" · Library and this Project", " · both").replace(" · changed content", "").replace(" · verification pending", "")
      : word
  const title = compact ? word : project && !library ? `Library: ${frame.quality.library === "usable" ? "Picked" : "Unreviewed"}` : undefined
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

export const MEMBER_WORD: Record<MemberState, string> = {
  included: "Included",
  rejected: "Out of draft · Rejected",
  excluded: "Excluded from run",
  unresolved: "Unresolved",
}
