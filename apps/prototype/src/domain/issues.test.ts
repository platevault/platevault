import { beforeAll, describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import { issueCopy } from "@/components/app/issue-row"
import { oldMastersInUse, type World } from "./derive"
import { deriveIssues, isDismissable } from "./issues"
import { createSeed } from "./seed"

// C9, Q9 (b) C: an old dark, bias or dark flat raises an issue only while an open Project's unfinished run hands it off.
const LATER = Date.now() + 400 * 86_400_000

let demo: World
beforeAll(() => {
  const seed = createSeed("demo")
  demo = { catalog: seed.catalog, disk: seed.disk, operations: seed.operations, settings: seed.settings, faults: seed.faults }
})

const oldIssues = (world: World, nowMs: number) => deriveIssues(world, nowMs).filter((i) => i.kind === "master-old")

describe("old masters in use (C9)", () => {
  it("raises one warning per old master an open Project's unfinished run hands off, linking to the Calibration library", () => {
    const inUse = oldMastersInUse(demo, LATER).filter(({ runs }) => runs.some((r) => demo.catalog.projects[r.projectId]?.state === "open"))
    expect(inUse.length).toBeGreaterThan(0)
    const issues = oldIssues(demo, LATER)
    expect(issues.map((i) => i.about).sort()).toEqual(inUse.map(({ master }) => master.id).sort())
    for (const issue of issues) {
      const entry = inUse.find(({ master }) => master.id === issue.about)!
      expect(issue).toMatchObject({ group: "calibration", severity: "warning", link: { to: "/calibration" } })
      expect(issue.count).toBe(entry.runs.filter((r) => demo.catalog.projects[r.projectId]?.state === "open").length)
      expect(isDismissable(issue)).toBe(true)
      expect(issueCopy(m, issue).text).toContain(String(issue.name))
    }
  })

  it("raises nothing once every run that hands the master off is finished", () => {
    const runs = Object.fromEntries(Object.entries(demo.catalog.runs).map(([id, run]) => [id, { ...run, completion: "complete" as const }]))
    expect(oldIssues({ ...demo, catalog: { ...demo.catalog, runs } }, LATER)).toEqual([])
  })

  it("raises nothing while the masters are within the age limit", () => {
    const young = { ...demo, settings: { ...demo.settings, masterMaxAgeDays: 100_000 } }
    expect(oldIssues(young, LATER)).toEqual([])
  })
})
