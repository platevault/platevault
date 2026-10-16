import { describe, expect, it } from "vitest"
import { canJoinProject, type World } from "./derive"
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
  const ORDER: PendingWork["kind"][] = ["needs-target", "unreviewed", "needs-calibration", "not-in-project", "ready-to-add"]

  it("orders a Target, review, calibration, a Project, then Add to Project, and shows a session reviewed for several Projects once", () => {
    const rows = pendingWork(demo())
    expect(rows.length).toBeGreaterThan(0)
    const kinds = rows.map((r) => ORDER.indexOf(r.kind))
    expect([...kinds].sort((a, b) => a - b)).toEqual(kinds)
    const unreviewed = rows.filter((r) => r.kind === "unreviewed").map((r) => r.session.id)
    expect(new Set(unreviewed).size).toBe(unreviewed.length)
  })

  it("offers Add to Project only for Ready sessions with settled calibration; unsettled ones wait in Needs calibration", () => {
    const world = demo()
    const rows = pendingWork(world)
    for (const row of rows.filter((r) => r.kind === "ready-to-add")) expect(canJoinProject(world.catalog, row.session)).toBe(true)
    for (const row of rows.filter((r) => r.kind === "needs-calibration")) expect(canJoinProject(world.catalog, row.session)).toBe(false)
  })

  it("drops a ready-to-add session once its Project holds it, and lists it again after Remove", () => {
    const world = demo()
    const row = pendingWork(world).find((r) => r.kind === "ready-to-add")
    expect(row, "the demo library has a session ready to add").toBeDefined()
    const { session, projectId } = row as Extract<PendingWork, { kind: "ready-to-add" }>
    const project = world.catalog.projects[projectId]!
    const listed = (w: World) => pendingWork(w).some((r) => r.kind === "ready-to-add" && r.session.id === session.id)
    world.catalog.projects[projectId] = { ...project, inputs: [...project.inputs, { sessionId: session.id, groupId: project.groups[0]!.id, excluded: [], included: [] }] }
    expect(listed(world)).toBe(false)
    world.catalog.projects[projectId] = project
    expect(listed(world)).toBe(true)
  })
})

describe("openWork: open Projects and calibration, with their problems in context", () => {
  it("puts every Project problem, and those of the sessions it holds, on the Project's row", () => {
    const world = demo()
    const rows = openWork(world, NOW, TONIGHT)
    expect(rows.some((r) => r.kind === "project")).toBe(true)
    const issues = deriveIssues(world, NOW)
    for (const row of rows) {
      if (row.kind !== "project") continue
      const held = new Set(row.project.inputs.map((i) => i.sessionId))
      const own = issues.filter((i) => (i.owner.kind === "project" && i.owner.id === row.project.id) || (i.owner.kind === "session" && held.has(i.owner.id)))
      expect(row.issues.map((i) => i.id).sort()).toEqual(own.map((i) => i.id).sort())
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

  it("shows a nearly full location's free space with no low-space flag (D1 pending), and reads an offline one with its issue and no space", () => {
    const world = demo()
    const location = arrivalLocation(world)
    const volume = world.disk.volumes[location.volumeId]!
    const row = () => homeStatus(world, NOW).locations.find((r) => r.location.id === location.id)!
    const used = volume.capacityBytes - row().space!.freeBytes
    // 1 % free: low under any threshold the owner may choose, yet Home flags nothing until D1 is decided.
    world.disk.volumes[volume.id] = { ...volume, capacityBytes: Math.ceil(used / 0.99) }
    const free = world.disk.volumes[volume.id]!.capacityBytes - used
    expect(row().space).toEqual({ freeBytes: free })
    world.disk.volumes[volume.id] = { ...world.disk.volumes[volume.id]!, mounted: false }
    expect(row()).toMatchObject({ availability: "offline", space: null, issue: { kind: "location-offline" } })
    // Problems first: the offline location reads before every online one.
    const rows = homeStatus(world, NOW).locations
    expect(rows.findIndex((r) => r.location.id === location.id)).toBeLessThan(rows.findIndex((r) => r.availability === "online"))
  })
})
