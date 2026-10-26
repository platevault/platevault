/**
 * Issue words (plan §3.3 P14, F7): an issue's severity glyph and its terse
 * label with its one action, in the chosen language. There is no Issues
 * hub and no issue list in the status bar: the rows an issue is on show it
 * (Home's Project rows), and the status bar counts it by severity.
 */
import { Info, type LucideIcon, OctagonX, TriangleAlert } from "lucide-react"
import { formatBytes } from "@/lib/format"
import { type MessageRef, type Messages, say } from "@/lib/i18n"

export type IssueSeverity = "info" | "warning" | "danger"

/** What an issue is about; `issueCopy` words it by kind. */
export type IssueKind =
  | "needs-target"
  | "not-in-project"
  | "needs-calibration"
  | "pin-drift"
  | "location-denied"
  | "location-offline"
  | "work-failed"
  | "work-interrupted"
  | "apply-refused"
  | "previous-review"
  | "master-offer"
  | "calibration-waiting"
  | "calibration-failed"
  /** A session's frames changed on disk. */
  | "drift"
  /** An adopted master's file changed on disk. */
  | "master-drift"
  | "duplicates"

/** The row an issue belongs to (F7): a session, Project, location, master, calibration process or operation, or a Library count (no row). */
export type IssueOwner =
  | { kind: "library" }
  | { kind: "session"; id: string }
  | { kind: "project"; id: string }
  | { kind: "location"; id: string }
  | { kind: "master"; id: string }
  | { kind: "process"; id: string }
  | { kind: "operation"; id: string }

/**
 * One issue as a row, a menu and a count show it. The library has no issue
 * read (astro-plan-wre19): the feature that owns the row derives this view
 * from its own reads.
 */
export interface Issue {
  /** Stable while the issue lasts. */
  id: string
  kind: IssueKind
  severity: IssueSeverity
  /** How many things the issue covers (sessions, frames, files, extra duplicate copies). */
  count: number
  /** Bytes the issue covers: the extra copies of duplicates; absent for other kinds. */
  bytes?: number
  /** Value for the copy's `{name}`: the location, Project or session the issue is about; an operation's title is a ref. */
  name: string | MessageRef | null
  owner: IssueOwner
  /** Route the issue's one action opens (`/sessions`); `issueCopy` words the action ("Assign"). */
  to: string
  /** False for a Project's own waiting work: the Project waits on the user, and the issue is how they find it (P-ISS1). */
  dismissable: boolean
}

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
      return { text: m.issue_frames_changed({ count, name }), action: m.verb_review() }
    case "master-drift":
      return { text: m.issue_master_changed({ name }), action: m.nav_calibration() }
    case "duplicates":
      return { text: m.issue_duplicates({ count, bytes: formatBytes(issue.bytes ?? 0) }), action: m.verb_review() }
  }
}
