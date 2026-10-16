import { beforeAll, describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import { issueCopy } from "@/components/app/issue-row"
import { calibrationQueue, type World } from "./derive"
import { fileAt, writeFiles } from "./disk"
import { deriveIssues, isDismissable, issuesFor } from "./issues"
import { createSeed } from "./seed"
import type { Session } from "./types"

// Far past every master's age limit: an old master is a library badge, never an issue (CAL-FR-15).
const LATER = Date.now() + 400 * 86_400_000

let demo: World
beforeAll(() => {
  const seed = createSeed("demo")
  demo = { catalog: seed.catalog, disk: seed.disk, operations: seed.operations, settings: seed.settings, faults: seed.faults }
})

/** A light session with a pinned calibration file, and that file. */
function pinnedSession(world: World): { session: Session; path: string } {
  for (const session of Object.values(world.catalog.sessions)) {
    const pinned = session.calibration && Object.values(session.calibration).find((c) => c.state === "pinned")
    if (pinned && pinned.state === "pinned" && pinned.evidence.files[0]) return { session, path: pinned.evidence.files[0].path }
  }
  throw new Error("the demo library pins no calibration file")
}

describe("deriveIssues on the Project model (F7)", () => {
  it("words every issue the demo raises, with its one action", () => {
    const issues = deriveIssues(demo, LATER)
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) {
      const copy = issueCopy(m, issue)
      expect(copy.text, issue.kind).toBeTruthy()
      expect(copy.action, issue.kind).toBeTruthy()
    }
  })

  it("raises no issue for an old master, however old", () => {
    expect(deriveIssues(demo, LATER).filter((i) => i.owner.kind === "master" && i.kind !== "drift")).toEqual([])
  })

  it("keeps a Project's own waiting work undismissable and on its row", () => {
    const issues = deriveIssues(demo, LATER)
    const waiting = issues.filter((i) => i.kind === "apply-refused" || i.kind === "previous-review")
    expect(waiting.length).toBeGreaterThan(0)
    for (const issue of waiting) {
      expect(isDismissable(issue)).toBe(false)
      expect(issue.owner.kind).toBe("project")
      expect(issuesFor(issues, { kind: "project", id: issue.about! })).toContainEqual(issue)
    }
    for (const issue of issues.filter((i) => !waiting.includes(i))) expect(isDismissable(issue)).toBe(true)
  })

  it("raises pin drift on the session when a pinned file changes, and puts the session in Needs calibration with its pin kept", () => {
    const { session, path } = pinnedSession(demo)
    const file = fileAt(demo.disk, path)!
    const drifted: World = { ...demo, disk: writeFiles(demo.disk, [{ ...file, sha256: `${file.sha256}-changed` }]) }
    const issue = deriveIssues(drifted, LATER).find((i) => i.kind === "pin-drift" && i.about === session.id)
    expect(issue).toMatchObject({ severity: "danger", owner: { kind: "session", id: session.id }, link: { to: "/sessions/$sessionId", params: { sessionId: session.id } } })
    expect(calibrationQueue(drifted.catalog, drifted.disk).map((s) => s.id)).toContain(session.id)
    expect(drifted.catalog.sessions[session.id]!.calibration).toEqual(session.calibration)
    expect(deriveIssues(demo, LATER).some((i) => i.kind === "pin-drift" && i.about === session.id)).toBe(false)
  })
})
