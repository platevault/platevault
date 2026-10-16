import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { filesUnder } from "@/domain/disk"
import { applyPlan, projectPaths } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import type { Operation, Project } from "@/domain/types"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { cancelOperation, isSettled, registerOperationHandlers } from "@/store/operations"
import { deleteFileExternally, setViewFileHeld } from "@/store/simulation"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { type ApplyPhase, applyPhase, PROJECT_VIEW_HANDLERS, startApply } from "./project-view"

// "NGC 7000 HOO" has an applied View with pending changes (a session added since, three Ha frames marked Unusable) and
// the user's notes.txt in View, a file PlateVault didn't place.
const CYGNUS = "prj_cygnus"
const apply = PROJECT_VIEW_HANDLERS.find((h) => h.kind === "apply")!

let demo: PrototypeState
beforeAll(() => {
  registerOperationHandlers(PROJECT_VIEW_HANDLERS)
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

const project = (): Project => store.getState().catalog.projects[CYGNUS]!
const paths = () => projectPaths(store.getState(), project())!
const operation = (id: string): Operation => store.getState().operations[id]!
/** Every file under a folder as the disk holds it: path, bytes and link. */
const folder = (path: string) => filesUnder(store.getState().disk, path).map((f) => ({ path: f.path, sha256: f.sha256, linkTarget: f.linkTarget ?? null })).sort((a, b) => a.path.localeCompare(b.path))

function start(): string {
  const plan = applyPlan(store.getState(), project())
  expect(plan.refusals).toEqual([])
  const { result, operationId } = startApply(CYGNUS, { fingerprint: plan.fingerprint, tickedUnplaced: [] })
  expect(result).toEqual({ ok: true })
  return operationId!
}

/** One tick of the "apply" handler; returns the phase it is in after it. */
function tick(id: string): ApplyPhase | null {
  store.setState((s) => apply.step(s, s.operations[id]!))
  return applyPhase(operation(id))
}

/** Tick until the operation settles or reaches `phase`; returns every phase seen, in order, once each. */
function runUntil(id: string, phase: ApplyPhase | null = null): ApplyPhase[] {
  const seen: ApplyPhase[] = [applyPhase(operation(id))!]
  for (let i = 0; i < 200 && !isSettled(operation(id).status) && seen.at(-1) !== phase; i++) {
    const now = tick(id)
    if (now && now !== seen.at(-1)) seen.push(now)
  }
  return seen
}

describe("Apply builds from the originals, verifies, waits for a held View file, then swaps (PREP-FR-06, PREP-FR-18)", () => {
  it("waits after the build while a tool holds a View file, keeps the current View meanwhile, and swaps once it is released", () => {
    const before = { view: project().view, files: folder(paths().view) }
    setViewFileHeld(true)
    const id = start()
    expect(runUntil(id, "waiting")).toEqual(["building", "verifying", "waiting"])
    // Held: it stays waiting, running, with the current View exactly as it was and the new one built beside it.
    for (let i = 0; i < 5; i++) expect(tick(id)).toBe("waiting")
    expect(operation(id).status).toBe("running")
    expect(project().view).toEqual(before.view)
    expect(folder(paths().view)).toEqual(before.files)
    expect(folder(paths().building).length).toBeGreaterThan(0)

    setViewFileHeld(false)
    runUntil(id)
    expect(operation(id).status).toBe("succeeded")
    const after = project()
    expect(after.view?.operationId).toBe(id)
    expect(after.revision).toBeGreaterThan(demo.catalog.projects[CYGNUS]!.revision)
    expect(folder(paths().building)).toEqual([])
    // The new View holds what the plan placed; the old one went to View (previous)/, the unticked notes.txt with it.
    expect(folder(paths().view).map((f) => f.path)).toEqual(after.view!.entries.map((e) => `${paths().view}/${e.path}`).sort((a, b) => a.localeCompare(b)))
    expect(after.previous?.leftovers).toContainEqual(expect.objectContaining({ path: "notes.txt", reason: "unplaced", kept: false }))
  })

  it("goes straight from verifying to the swap when no file is held", () => {
    const id = start()
    expect(runUntil(id)).toEqual(["building", "verifying", "swapping"])
    expect(operation(id).status).toBe("succeeded")
  })

  it("refuses a sheet whose plan changed after it opened", () => {
    const { result, operationId } = startApply(CYGNUS, { fingerprint: "stale", tickedUnplaced: [] })
    expect(result).toMatchObject({ ok: false, reason: "refused" })
    expect(operationId).toBeNull()
  })
})

describe("a failed or canceled Apply leaves the current View intact (PREP-FR-06)", () => {
  it("fails when an original goes missing during the build, removes View (building)/ and changes nothing in the current View", () => {
    const before = { view: project().view, previous: project().previous, files: folder(paths().view) }
    const id = start()
    const planned = (operation(id).payload as { planned: Array<{ originalPath: string }> }).planned
    deleteFileExternally(planned.at(-1)!.originalPath)
    runUntil(id)
    expect(operation(id).status).toBe("failed")
    expect(folder(paths().building)).toEqual([])
    expect(folder(paths().view)).toEqual(before.files)
    expect(project().view).toEqual(before.view)
    expect(project().previous).toEqual(before.previous)
  })

  it("Cancel while it waits for a held file keeps the old View", () => {
    const before = { view: project().view, files: folder(paths().view) }
    setViewFileHeld(true)
    const id = start()
    runUntil(id, "waiting")
    cancelOperation(id)
    expect(operation(id).status).toBe("canceled")
    expect(folder(paths().building)).toEqual([])
    expect(folder(paths().view)).toEqual(before.files)
    expect(project().view).toEqual(before.view)
  })
})
