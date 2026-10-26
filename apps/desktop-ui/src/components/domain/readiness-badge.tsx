/**
 * ReadinessBadge (L2-domain, C10): where a session's intake stands, as one
 * status word wherever session rows appear (Sessions, a session's details
 * and intake, a Project's held sessions). A held session a reopened review
 * set back to Unreviewed, or a re-split successor whose Review was reset,
 * reads Needs review in its Projects (D-W100, LIB-FR-12).
 */
import type { SessionReadiness } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { StatusBadge } from "@/components/app/status"

/** Where intake stands, as one status word: Ready, or the step it still needs (C10), from the library's `SessionReadiness`. The Sessions list, the detail and the intake show the same. */
export function ReadinessBadge({ readiness, unreviewed, trashed }: { readiness: SessionReadiness; unreviewed: number; trashed: boolean }) {
  const m = useMessages()
  if (trashed) return <StatusBadge kind="record" value="trashed" />
  if (readiness === "ready") return <StatusBadge kind="gate" value="ready" />
  const review = unreviewed > 0 ? m.flow_frames_unreviewed({ count: unreviewed }) : m.status_needs_review()
  const label = readiness === "needs_target" ? m.sessions_filter_needs_target() : readiness === "needs_rig" ? m.sessions_rig_needs_review() : review
  return <StatusBadge kind="gate" value="review" label={label} />
}
