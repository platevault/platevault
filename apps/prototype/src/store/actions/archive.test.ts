import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sessionsArchivePlan, type TrashOffer } from "@/domain/archive"
import { projectHref } from "@/domain/derive"
import { fileAt } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import { createSeed } from "@/domain/seed"
import { m, msg } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { isSettled } from "@/store/operations"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { setVolumeMounted } from "@/store/simulation"
import { type ArchivePayload, archiveHandler, offerFileRows, startArchiveTransfer } from "./archive"

/** "NGC 7000 OIII test": Closed, its View's symlinks kept by Clean up, its session held by no open Project. */
const OIII = "prj_ngc_oiii"

let demo: PrototypeState
beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

/** Run the handler tick by tick until the operation settles. */
function runToEnd(id: string) {
  for (let i = 0; i < 100 && !isSettled(store.getState().operations[id]!.status); i++) store.setState((s) => archiveHandler.step(s, s.operations[id]!))
}

describe("startArchiveTransfer", () => {
  it("starts one archive operation over the reviewed rows, one item per session", () => {
    const state = store.getState()
    const rows = sessionsArchivePlan(state, Object.values(state.catalog.sessions).filter((s) => s.imageType === "light")).rows.slice(0, 2)
    expect(rows.length).toBe(2)
    const id = startArchiveTransfer(null, rows)
    const op = store.getState().operations[id]!
    expect(op.kind).toBe("archive")
    expect(op.progress).toMatchObject({ done: 0, total: 2, unit: "sessions" })
    expect(op.status).toBe("running")
    expect(op.items.map((i) => i.id)).toEqual(rows.map((r) => r.session.id))
    expect(op.items.map((i) => i.path)).toEqual(rows.map((r) => r.folder))
    const payload = op.payload as unknown as ArchivePayload
    expect(payload).toMatchObject({ projectId: null, moved: [], repointed: {}, href: "/sessions" })
    expect(payload.queue.map((q) => q.sessionId)).toEqual(rows.map((r) => r.session.id))
  })

  it("names a Project's transfer after the Project and links back to its Wrap up", () => {
    const state = store.getState()
    const project = Object.values(state.catalog.projects)[0]!
    const rows = sessionsArchivePlan(state, Object.values(state.catalog.sessions).filter((s) => s.imageType === "light")).rows.slice(0, 1)
    const id = startArchiveTransfer(project.id, rows)
    const op = store.getState().operations[id]!
    expect((op.payload as unknown as ArchivePayload).href).toBe(projectHref(project.id, { stage: "wrap-up" }))
    expect(op.scope.projectId).toBe(project.id)
  })
})

describe("archive repoints a Closed Project's kept View (D-W111)", () => {
  it("rebuilds the kept symlinks to the archived originals, records it in Activity and leaves the locked Project as it was", () => {
    const project = store.getState().catalog.projects[OIII]!
    expect(project.state).toBe("closed")
    const sessionIds = [...new Set(project.inputs.map((i) => i.sessionId))]
    // Its originals sit on Cold-1, offline in the demo: connect it so the transfer can read them.
    for (const sessionId of sessionIds) for (const assetId of store.getState().catalog.sessions[sessionId]!.assetIds) for (const copy of store.getState().catalog.assets[assetId]!.copies) setVolumeMounted(copy.volumeId, true)
    const before = store.getState()
    const links = Object.values(before.disk.files).filter((f) => f.linkTarget && isUnder(f.path, project.view!.folderPath))
    expect(links.length).toBeGreaterThan(0)
    const plan = sessionsArchivePlan(before, sessionIds.map((id) => before.catalog.sessions[id]!))
    expect(plan.rows.map((r) => r.session.id)).toEqual(sessionIds)
    expect(plan.repoints).toEqual([{ project, links: expect.any(Number) }])
    const moved = new Map(plan.rows.flatMap((r) => r.moves.map((move) => [move.from.path, move.to.path] as const)))
    const repointed = links.filter((link) => moved.has(link.linkTarget!))
    expect(repointed.length).toBeGreaterThan(0)

    const id = startArchiveTransfer(null, plan.rows)
    runToEnd(id)
    const after = store.getState()
    expect(after.operations[id]!.status).toBe("succeeded")
    for (const link of links) {
      const now = fileAt(after.disk, link.path)!
      expect(now.linkTarget).toBe(moved.get(link.linkTarget!) ?? link.linkTarget)
      expect(fileAt(after.disk, now.linkTarget!)).toBeDefined()
    }
    expect(after.catalog.projects[OIII]).toEqual(project)
    expect(after.activity.find((a) => a.operationId === id && a.kind === "saved")).toMatchObject({
      title: { params: { name: project.name } },
      detail: { params: { count: repointed.length } },
      href: projectHref(OIII, { stage: "view" }),
    })
  })
})

describe("offerFileRows", () => {
  it("lists each entry as a move to the Trash and each refusal as a kept row with its reason and link", () => {
    const link = { to: "/projects/$projectId", params: { projectId: "prj_x" } }
    const offer: TrashOffer = {
      kind: "rejected-frames",
      title: "",
      count: 1,
      sizeBytes: 100,
      entries: [{ key: "a", label: "a.fits", path: "/Volumes/A/M31/a.fits", detail: null, sizeBytes: 100, preselected: true }],
      refusals: [
        { key: "b", label: "b.fits", path: "/Volumes/A/M31/b.fits", reason: msg("wrapup_refusal_archive_moving"), link },
        { key: "c", label: "c.fits", path: null, reason: msg("wrapup_refusal_outside_captures") },
      ],
      items: [],
      keptLinks: 0,
    }
    const rows = offerFileRows(m, offer)
    expect(rows.moved).toEqual([{ file: "a.fits", from: "/Volumes/A/M31", action: "trash", size: 100 }])
    expect(rows.kept).toEqual([
      { file: "b.fits", from: "/Volumes/A/M31", action: "trash", size: 0, status: { label: m.wrapup_refusal_archive_moving(), link } },
      { file: "c.fits", from: "", action: "trash", size: 0, status: { label: m.wrapup_refusal_outside_captures() } },
    ])
  })
})
