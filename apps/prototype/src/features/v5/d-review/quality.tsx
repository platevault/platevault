/**
 * Quality labels for Review (PIX-FR-14): glyph plus word. The words are the
 * STATUS registry's Usable, Unusable and Unreviewed (W5, C10); a decision
 * that no longer applies to the current bytes reads Unreviewed with its
 * reason.
 */
import { useMessages } from "@/app/preferences"
import { StatusBadge } from "@/components/app/status"
import type { Messages } from "@/lib/i18n"
import type { ReviewFrame } from "./model"

/** The frame's quality in words; `short` drops the reason after Unreviewed. */
export function qualityWord(m: Messages, frame: ReviewFrame, short = false): string {
  const { library } = frame.quality
  if (library === "unusable") return m.status_unusable()
  if (library === "usable") return m.status_usable()
  if (!short && library === "changed-content") return m.review_quality_unreviewed_changed()
  if (!short && library === "verification-pending") return m.review_quality_unreviewed_pending()
  return m.status_unreviewed()
}

/** The quality badge; `short` drops the reason after Unreviewed (table cells, thumbnails). */
export function QualityLabel({ frame, short = false }: { frame: ReviewFrame; short?: boolean }) {
  const m = useMessages()
  const { library } = frame.quality
  return <StatusBadge kind="quality" value={library} label={qualityWord(m, frame, short)} />
}
