import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { fileAt, filesUnder } from "@/domain/disk"
import { applyPlan, processingMasters, projectPaths } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import type { Operation, Project } from "@/domain/types"
import { m, say } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { cancelOperation, isSettled, registerOperationHandlers } from "@/store/operations"
import { createExternalFile, deleteFileExternally, setViewFileHeld } from "@/store/simulation"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { adoptionCheck, adoptProcessingMaster, type ApplyPhase, applyPhase, PROJECT_VIEW_HANDLERS, reviewLeftover, startApply } from "./project-view"
import { setFramesExcluded } from "./projects"

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

describe("View (previous)/ holds kept files (D-W110; stopgap while the merge rule is open, decision record §9)", () => {
  /** Apply once, keep the unticked notes.txt it left in View (previous)/, then make the next Apply's change and a new unplaced file. */
  function keptThenChanged(): string {
    runUntil(start())
    expect(reviewLeftover(CYGNUS, "notes.txt", "keep")).toEqual({ ok: true })
    const input = project().inputs[0]!
    expect(setFramesExcluded(CYGNUS, input.sessionId, [store.getState().catalog.sessions[input.sessionId]!.assetIds[0]!], true)).toEqual({ ok: true })
    createExternalFile(`${paths().view}/tool-log.txt`)
    return "tool-log.txt"
  }

  it("refuses an Apply that would leave more files beside the kept ones, and keeps the current View", () => {
    const unplaced = keptThenChanged()
    const before = { view: project().view, files: folder(paths().view) }
    const plan = applyPlan(store.getState(), project())
    expect(plan.refusals).toEqual([])
    const { result, operationId } = startApply(CYGNUS, { fingerprint: plan.fingerprint, tickedUnplaced: [] })
    expect(result).toMatchObject({ ok: false, reason: "refused", reasons: [m.apply_refused_previous_kept({ count: 1 })] })
    expect(operationId).toBeNull()
    expect(project().view).toEqual(before.view)
    expect(folder(paths().view)).toEqual(before.files)
    expect(project().previous?.leftovers).toContainEqual(expect.objectContaining({ path: "notes.txt", kept: true }))
    expect(fileAt(store.getState().disk, `${paths().view}/${unplaced}`)).toBeDefined()
  })

  it("goes ahead once every file PlateVault didn't place is ticked, so nothing new joins the kept files", () => {
    const unplaced = keptThenChanged()
    const plan = applyPlan(store.getState(), project())
    const { result, operationId } = startApply(CYGNUS, { fingerprint: plan.fingerprint, tickedUnplaced: [unplaced] })
    expect(result).toEqual({ ok: true })
    expect(runUntil(operationId!).at(-1)).toBe("swapping")
    expect(operation(operationId!).status).toBe("succeeded")
  })
})

describe("adopting a generated master refuses PlateVault's own unregistered copy (CAL-FR-06, decision record §9)", () => {
  const generated = () => processingMasters(store.getState(), project()).find((o) => o.kind === "flat")!.file

  it("names the copy at the destination and adds nothing", () => {
    const check = adoptionCheck(store.getState(), CYGNUS, generated().path)
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(check.ownCopy).not.toBeNull()
    expect(check.reasons.map((r) => say(m, r))).toEqual([m.adopt_refused_own_copy({ path: check.ownCopy! })])
    const masters = store.getState().catalog.masters
    expect(adoptProcessingMaster(CYGNUS, generated().path, generated().sha256)).toMatchObject({ ok: false, reason: "refused" })
    expect(store.getState().catalog.masters).toEqual(masters)
    expect(fileAt(store.getState().disk, check.ownCopy!)).toBeDefined()
  })

  it("moves the reviewed copy to the OS Trash, then adds the master as a dated version", () => {
    const check = adoptionCheck(store.getState(), CYGNUS, generated().path)
    const own = check.ok ? null : check.ownCopy
    const file = generated()
    expect(adoptProcessingMaster(CYGNUS, file.path, file.sha256, { trashOwnCopy: true })).toEqual({ ok: true })
    const state = store.getState()
    expect(state.disk.trash.some((t) => t.originalPath === own)).toBe(true)
    const version = Object.values(state.catalog.masters).flatMap((mst) => mst.versions).find((v) => v.origin.sourcePath === file.path)
    expect(version).toMatchObject({ origin: { kind: "generated", projectId: CYGNUS }, adoption: { destinationPath: own, verifiedSha256: file.sha256 } })
    expect(project().masterOffers).toContainEqual(expect.objectContaining({ path: file.path, state: "adopted" }))
  })
})
