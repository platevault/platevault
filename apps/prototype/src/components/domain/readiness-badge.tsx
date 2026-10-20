/**
 * ReadinessBadge (L2-domain, C10): where a session's intake stands, as one
 * status word wherever session rows appear (Sessions, a session's details
 * and intake, a Project's held sessions). A held session a reopened review
 * set back to Unreviewed reads Needs review in its Projects (D-W100).
 */
import { useMessages } from "@/app/preferences"
import { StatusBadge } from "@/components/app/status"
import type { SessionReadiness } from "@/domain/derive"

/** Where intake stands, as one status word: Ready, or the step it still needs (C10). The Sessions list, the detail and the intake show the same. */
export function ReadinessBadge({ readiness, unreviewed, trashed }: { readiness: SessionReadiness; unreviewed: number; trashed: boolean }) {
  const m = useMessages()
  if (trashed) return <StatusBadge kind="record" value="trashed" />
  if (readiness === "ready") return <StatusBadge kind="gate" value="ready" />
  const label = readiness === "needs-target" ? m.sessions_filter_needs_target() : readiness === "needs-rig" ? m.sessions_rig_needs_review() : m.flow_frames_unreviewed({ count: unreviewed })
  return <StatusBadge kind="gate" value="review" label={label} />
}
