/**
 * issueCopy words each issue kind as its own label and its one action, and
 * keeps drift in a session's frames apart from drift on an adopted master.
 * Expectations are catalogue copy (`m.*`), so they hold in any locale.
 */
import { describe, expect, it } from "vitest"
import { formatBytes } from "@/lib/format"
import { m, verbatim } from "@/lib/i18n"
import { type Issue, type IssueKind, issueCopy } from "./issue-copy"

function issue(kind: IssueKind, fields: Partial<Issue> = {}): Issue {
  return { id: `${kind}-1`, kind, severity: "warning", count: 2, name: "M31", owner: { kind: "library" }, to: "/sessions", dismissable: true, ...fields }
}

/** Every kind, with the label and action it reads as; keyed by IssueKind, so a new kind without a row fails typecheck. */
const WORDING: Record<IssueKind, [fields: Partial<Issue>, text: string, action: string]> = {
  "needs-target": [{}, m.issue_needs_target({ count: 2 }), m.verb_assign()],
  "not-in-project": [{}, m.issue_not_in_project({ count: 2 }), m.verb_add()],
  "needs-calibration": [{}, m.issue_needs_calibration({ count: 2 }), m.verb_review()],
  "pin-drift": [{}, m.issue_pin_drift({ name: "M31", count: 2 }), m.verb_open()],
  "location-denied": [{ name: "Archive NAS" }, m.issue_location_unreadable({ name: "Archive NAS" }), m.verb_fix()],
  "location-offline": [{ name: "Archive NAS" }, m.issue_location_offline({ name: "Archive NAS" }), m.common_locations()],
  "work-failed": [{ name: verbatim("Scan Captures") }, m.issue_failed({ name: "Scan Captures" }), m.nav_activity()],
  "work-interrupted": [{ name: verbatim("Scan Captures") }, m.issue_interrupted({ name: "Scan Captures" }), m.nav_activity()],
  "apply-refused": [{}, m.issue_apply_refused({ name: "M31" }), m.verb_open()],
  "previous-review": [{}, m.issue_previous_review({ name: "M31", count: 2 }), m.verb_review()],
  "master-offer": [{}, m.issue_master_offered({ count: 2 }), m.verb_review()],
  "calibration-waiting": [{}, m.issue_to_stack({ count: 2 }), m.verb_stack()],
  "calibration-failed": [{ name: "Darks 300 s" }, m.issue_failed({ name: "Darks 300 s" }), m.verb_open()],
  drift: [{}, m.issue_frames_changed({ count: 2, name: "M31" }), m.verb_review()],
  "master-drift": [{ name: "masterDark_300s" }, m.issue_master_changed({ name: "masterDark_300s" }), m.nav_calibration()],
  duplicates: [{ bytes: 2_400_000_000 }, m.issue_duplicates({ count: 2, bytes: formatBytes(2_400_000_000) }), m.verb_review()],
}

describe("issueCopy", () => {
  it.each(Object.entries(WORDING) as [IssueKind, (typeof WORDING)[IssueKind]][])("words %s", (kind, [fields, text, action]) => {
    expect(issueCopy(m, issue(kind, fields))).toEqual({ text, action })
  })

  it("words drift on an adopted master apart from drift in a session's frames", () => {
    const frames = issueCopy(m, issue("drift", { name: "masterDark_300s", count: 1 }))
    const master = issueCopy(m, issue("master-drift", { name: "masterDark_300s", count: 1 }))
    expect(master.text).not.toBe(frames.text)
    expect(master.action).toBe(m.nav_calibration())
    expect(frames.action).toBe(m.verb_review())
  })

  it("reads an absent name as empty, not as null", () => {
    expect(issueCopy(m, issue("location-offline", { name: null })).text).toBe(m.issue_location_offline({ name: "" }))
  })
})
