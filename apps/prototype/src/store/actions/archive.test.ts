import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sessionsArchivePlan, type TrashOffer } from "@/domain/archive"
import { m, msg } from "@/lib/i18n"
import { createSeed } from "@/domain/seed"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { type ArchivePayload, offerFileRows, startArchiveTransfer } from "./archive"

let demo: PrototypeState
beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

describe("startArchiveTransfer", () => {
  it("starts one archive operation over the reviewed rows, one item per session", () => {
    const state = store.getState()
    const rows = sessionsArchivePlan(state, Object.values(state.catalog.sessions).filter((s) => s.imageType === "light")).rows.slice(0, 2)
    expect(rows.length).toBe(2)
    const id = startArchiveTransfer(null, rows, "archive")
    const op = store.getState().operations[id]!
    expect(op.kind).toBe("archive")
    expect(op.progress).toMatchObject({ done: 0, total: 2, unit: "sessions" })
    expect(op.status).toBe("running")
    expect(op.items.map((i) => i.id)).toEqual(rows.map((r) => r.session.id))
    expect(op.items.map((i) => i.path)).toEqual(rows.map((r) => r.folder))
    const payload = op.payload as unknown as ArchivePayload
    expect(payload).toMatchObject({ projectId: null, direction: "archive", moved: [], href: "/sessions" })
    expect(payload.queue.map((q) => q.sessionId)).toEqual(rows.map((r) => r.session.id))
  })

  it("names a Project's transfer after the Project and links back to it", () => {
    const state = store.getState()
    const project = Object.values(state.catalog.projects)[0]!
    const rows = sessionsArchivePlan(state, Object.values(state.catalog.sessions).filter((s) => s.imageType === "light")).rows.slice(0, 1)
    const id = startArchiveTransfer(project.id, rows, "restore")
    const op = store.getState().operations[id]!
    expect((op.payload as unknown as ArchivePayload).href).toBe(`/projects/${project.id}`)
    expect(op.scope.projectId).toBe(project.id)
  })
})

describe("offerFileRows", () => {
  it("lists each entry as a move to the Trash and each refusal as a kept row with its reason and link", () => {
    const link = { to: "/runs/$runId", params: { runId: "run_x" } }
    const offer: TrashOffer = {
      kind: "rejected-frames",
      title: "",
      count: 1,
      sizeBytes: 100,
      entries: [{ key: "a", label: "a.fits", path: "/Volumes/A/M31/a.fits", detail: null, sizeBytes: 100 }],
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
