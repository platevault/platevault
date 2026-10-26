/**
 * Issue words (plan §3.3 P14, F7): an issue's severity glyph and its terse
 * label with its one action, in the chosen language. There is no Issues
 * hub and no issue list in the status bar: the rows an issue is on show it
 * (Home's Project rows), and the status bar counts it by severity.
 */
import { Info, type LucideIcon, OctagonX, TriangleAlert } from "lucide-react"
import type { Issue, IssueSeverity } from "@/domain/issues"
import { formatBytes } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"

export const ISSUE_SEVERITY_ICON: Record<IssueSeverity, LucideIcon> = { danger: OctagonX, warning: TriangleAlert, info: Info }

/**
 * The issue's terse label and its one action, in the chosen language:
 * "2 need a Target", "Assign". The kind decides the wording; drift on an
 * adopted master differs from drift in a session's frames.
 */
export function issueCopy(m: Messages, issue: Issue): { text: string; action: string } {
  const { count } = issue
  const name = issue.name === null ? "" : typeof issue.name === "string" ? issue.name : say(m, issue.name)
  switch (issue.kind) {
    case "needs-target":
      return { text: m.issue_needs_target({ count }), action: m.verb_assign() }
    case "not-in-project":
      return { text: m.issue_not_in_project({ count }), action: m.verb_add() }
    case "needs-calibration":
      return { text: m.issue_needs_calibration({ count }), action: m.verb_review() }
    case "pin-drift":
      return { text: m.issue_pin_drift({ name, count }), action: m.verb_open() }
    case "location-denied":
      return { text: m.issue_location_unreadable({ name }), action: m.verb_fix() }
    case "location-offline":
      return { text: m.issue_location_offline({ name }), action: m.common_locations() }
    case "work-failed":
      return { text: m.issue_failed({ name }), action: m.nav_activity() }
    case "work-interrupted":
      return { text: m.issue_interrupted({ name }), action: m.nav_activity() }
    case "apply-refused":
      return { text: m.issue_apply_refused({ name }), action: m.verb_open() }
    case "previous-review":
      return { text: m.issue_previous_review({ name, count }), action: m.verb_review() }
    case "master-offer":
      return { text: m.issue_master_offered({ count }), action: m.verb_review() }
    case "calibration-waiting":
      return { text: m.issue_to_stack({ count }), action: m.verb_stack() }
    case "calibration-failed":
      return { text: m.issue_failed({ name }), action: m.verb_open() }
    case "drift":
      return issue.id.startsWith("drift:master:")
        ? { text: m.issue_master_changed({ name }), action: m.nav_calibration() }
        : { text: m.issue_frames_changed({ count, name }), action: m.verb_review() }
    case "duplicates":
      return { text: m.issue_duplicates({ count, bytes: formatBytes(issue.bytes ?? 0) }), action: m.verb_review() }
  }
}
