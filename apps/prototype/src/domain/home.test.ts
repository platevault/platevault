import { describe, expect, it } from "vitest"
import type { World } from "./derive"
import { writeFiles } from "./disk"
import { homeStatus, newFileCount, openWork, pendingIngestions, type PendingWork, pendingWork } from "./home"
import { isUnder } from "./indexing"
import { deriveIssues } from "./issues"
import { arrivalFiles, createSeed } from "./seed"
import type { Location, Operation } from "./types"

const TONIGHT = "2026-10-13"
const NOW = Date.parse(`${TONIGHT}T12:00:00Z`)

/** A fresh demo library, so each test edits its own. */
function demo(): World {
  return structuredClone(createSeed("demo"))
}

/** The Captures location the simulated new captures arrive in. */
function arrivalLocation(world: World): Location {
  const path = arrivalFiles()[0]!.path
  return Object.values(world.catalog.locations).find((l) => l.role === "captures" && isUnder(path, l.path))!
}

function settle(world: World, op: Operation, status: Operation["status"]): void {
  world.operations[op.id] = { ...op, status, settledAt: status === "running" || status === "paused" ? null : "2026-10-13T12:00:00.000Z" }
}

describe("pendingIngestions: what came into the Captures locations", () => {
  it("counts the image files under a location that no library copy holds: the new files since its last scan", () => {
    const world = demo()
    const location = arrivalLocation(world)
    expect(newFileCount(world, location)).toBe(0)
    world.disk = writeFiles(world.disk, arrivalFiles())
    expect(newFileCount(world, location)).toBe(arrivalFiles().length)
    expect(pendingIngestions(world).find((r) => r.location.id === location.id)?.state).toEqual({ kind: "new-files", count: arrivalFiles().length })
  })

  it("shows a running scan with its progress, a stopped one with Retry, and a location never scanned", () => {
    const world = demo()
    const scan = Object.values(world.operations).find((op) => op.kind === "index" && op.status === "running")!
    const locationId = scan.scope.locationIds![0]!
    const row = () => pendingIngestions(world).find((r) => r.location.id === locationId)
    expect(row()?.state).toMatchObject({ kind: "importing", operation: { id: scan.id } })
    settle(world, scan, "canceled")
    expect(row()?.state).toMatchObject({ kind: "stopped", operation: { id: scan.id } })
    settle(world, scan, "succeeded")
    world.catalog.locations[locationId] = { ...world.catalog.locations[locationId]!, scanScope: "never" }
    expect(row()?.state).toEqual({ kind: "never-scanned" })
  })

  it("lists Captures locations only, problems first", () => {
    const world = demo()
    world.disk = writeFiles(world.disk, arrivalFiles())
    const scan = Object.values(world.operations).find((op) => op.kind === "index" && op.status === "running")!
    settle(world, scan, "failed")
    const rows = pendingIngestions(world)
    expect(rows.every((r) => r.location.role === "captures")).toBe(true)
    expect(rows[0]!.state.kind).toBe("stopped")
  })
})

describe("pendingWork: what needs sorting", () => {
  const ORDER: PendingWork["kind"][] = ["needs-target", "unreviewed", "not-in-project", "ready-to-add", "clean-up"]

  it("orders a Target, review, a Project, a run, then Clean up, and shows a session reviewed for several Projects once", () => {
    const rows = pendingWork(demo())
    expect(rows.length).toBeGreaterThan(0)
    const kinds = rows.map((r) => ORDER.indexOf(r.kind))
    expect([...kinds].sort((a, b) => a - b)).toEqual(kinds)
    const unreviewed = rows.filter((r) => r.kind === "unreviewed").map((r) => r.session.id)
    expect(new Set(unreviewed).size).toBe(unreviewed.length)
  })

  it("lists a Finished run whose prepared view is still on disk, with the bytes its copies hold", () => {
    const rows = pendingWork(demo()).filter((r) => r.kind === "clean-up")
    for (const row of rows) {
      expect(row.run.completion).toBe("complete")
      expect(row.entries).toBeGreaterThan(0)
      expect(row.bytes).toBeGreaterThanOrEqual(0)
    }
  })

  it("drops a ready-to-add session once an open run of its Project holds it in its draft, and lists it again without", () => {
    const world = demo()
    const row = pendingWork(world).find((r) => r.kind === "ready-to-add")
    expect(row, "the demo library has a session ready to add").toBeDefined()
    const { session, projectId } = row as Extract<PendingWork, { kind: "ready-to-add" }>
    const run = Object.values(world.catalog.runs).find((r) => r.projectId === projectId && r.completion === "open" && !r.trashedAt)!
    const saved = run.revisions.at(-1)!
    const draft = { ...saved, baseRevision: saved.revision, updatedAt: "2026-10-13T12:00:00.000Z", sessions: [...saved.sessions, { sessionId: session.id, reason: saved.sessions[0]!.reason }] }
    const listed = (w: World) => pendingWork(w).some((r) => r.kind === "ready-to-add" && r.session.id === session.id)
    world.catalog.runs[run.id] = { ...run, draft }
    expect(listed(world)).toBe(false)
    world.catalog.runs[run.id] = { ...run, draft: null }
    expect(listed(world)).toBe(true)
  })
})

describe("openWork: open Projects and calibration, with their problems in context", () => {
  it("puts every run problem on the row of the run's Project", () => {
    const world = demo()
    const rows = openWork(world, NOW, TONIGHT)
    expect(rows.some((r) => r.kind === "project")).toBe(true)
    for (const issue of deriveIssues(world, NOW).filter((i) => i.kind === "run-blocked" || i.kind === "calibration-review")) {
      const projectId = world.catalog.runs[issue.about!]!.projectId
      const row = rows.find((r) => r.kind === "project" && r.project.id === projectId)
      expect(row?.issues.map((i) => i.id)).toContain(issue.id)
    }
  })

  it("ranks a deadline or season first, by priority then nights left", () => {
    const rows = openWork(demo(), NOW, TONIGHT)
    const ranked = rows.filter((r) => r.window !== null)
    expect(rows.slice(0, ranked.length)).toEqual(ranked)
    for (let i = 1; i < ranked.length; i += 1) expect(ranked[i - 1]!.priority).toBeGreaterThanOrEqual(ranked[i]!.priority)
  })

  it("leaves out finished calibration processes", () => {
    const rows = openWork(demo(), NOW, TONIGHT)
    expect(rows.filter((r) => r.kind === "calibration").every((r) => r.kind === "calibration" && r.view.status !== "done")).toBe(true)
  })
})

describe("homeStatus: locations and background jobs", () => {
  it("leaves imports and scans to Pending ingestions", () => {
    const world = demo()
    const { jobs } = homeStatus(world, NOW)
    expect(jobs.some((op) => op.kind === "index" || op.kind === "import")).toBe(false)
    expect(Object.values(world.operations).some((op) => op.kind === "index" && op.status === "running")).toBe(true)
  })

  it("flags a location low on space below the share, and reads an offline one with its issue and no space", () => {
    const world = demo()
    const location = arrivalLocation(world)
    const volume = world.disk.volumes[location.volumeId]!
    const row = () => homeStatus(world, NOW).locations.find((r) => r.location.id === location.id)!
    expect(row().space?.low).toBe(false)
    const used = volume.capacityBytes - row().space!.freeBytes
    // 1 % free: low under any threshold the owner may choose.
    world.disk.volumes[volume.id] = { ...volume, capacityBytes: Math.ceil(used / 0.99) }
    expect(row().space?.low).toBe(true)
    world.disk.volumes[volume.id] = { ...world.disk.volumes[volume.id]!, mounted: false }
    expect(row()).toMatchObject({ availability: "offline", space: null, issue: { kind: "location-offline" } })
    // Problems first: the offline location reads before every online one.
    const rows = homeStatus(world, NOW).locations
    expect(rows.findIndex((r) => r.location.id === location.id)).toBeLessThan(rows.findIndex((r) => r.availability === "online"))
  })
})
