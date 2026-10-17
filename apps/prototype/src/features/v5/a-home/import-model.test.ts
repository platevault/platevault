import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { canJoinProject, calibrationQueue } from "@/domain/derive"
import { createSeed } from "@/domain/seed"
import { cancelOperation, isSettled, settleOperation } from "@/store/operations"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { msg, m } from "@/lib/i18n"
import { emptyImportDraft, type ImportDraft } from "@/store/slices/a"
import { type DestinationGroup, type ImportPlan, planImport, previewImport } from "./import-model"
import { importHandler, startImport } from "./import-run"

const AT = "2026-10-08T09:00:00.000Z"
let demo: PrototypeState

beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

/** The demo's ASIAIR card as the source: Ha and OIII lights of 6 Oct (the last 4 OIII re-pointed), Ha flats. */
function card(patch: Partial<ImportDraft> = {}): ImportDraft {
  return { ...emptyImportDraft(), source: { kind: "saved", id: "src_asiair" }, ...patch }
}

function lightsOf(plan: ImportPlan, filter: string): DestinationGroup[] {
  return plan.groups.filter((g) => g.session && g.items[0]!.file.header!.filter === filter).sort((a, b) => a.session!.framing - b.session!.framing)
}

/** Start the import and run its handler tick by tick until it settles. */
function runImport(draft: ImportDraft) {
  const plan = planImport(m, store.getState(), draft)!
  expect(plan.blockers).toEqual([])
  const id = startImport(plan, draft)
  for (let i = 0; i < 300 && !isSettled(store.getState().operations[id]!.status); i++) store.setState((s) => importHandler.step(s, s.operations[id]!))
  expect(store.getState().operations[id]!.status).toBe("succeeded")
}

function importedOiii() {
  return Object.values(store.getState().catalog.sessions).filter((s) => s.imageType === "light" && s.night === "2026-10-06" && s.channel === "OIII")
}

describe("Import review: sessions split by framing, merge and re-split (LIB-AC-31)", () => {
  it("shows the re-pointed frames as framing 2; Merge shows one session, Re-split the two again, and nothing is written", () => {
    const state = store.getState()
    const split = lightsOf(planImport(m, state, card())!, "OIII")
    expect(split.map((g) => [g.session!.framing, g.items.length])).toEqual([
      [1, 8],
      [2, 4],
    ])
    const captureKey = split[0]!.session!.captureKey
    const merged = lightsOf(planImport(m, state, card({ merged: [captureKey] }))!, "OIII")
    expect(merged.map((g) => [g.session!.framing, g.session!.merged, g.session!.framings, g.items.length])).toEqual([[1, true, 2, 12]])
    expect(lightsOf(planImport(m, state, card({ merged: [] }))!, "OIII")).toHaveLength(2)
    expect(store.getState().catalog).toBe(state.catalog)
  })

  it("imports a merged capture as one session, and a split one as two", () => {
    const captureKey = lightsOf(planImport(m, store.getState(), card())!, "OIII")[0]!.session!.captureKey
    runImport(card({ merged: [captureKey] }))
    expect(importedOiii().map((s) => s.assetIds.length)).toEqual([12])
    store.replace(structuredClone(demo))
    runImport(card())
    expect(
      importedOiii()
        .map((s) => s.assetIds.length)
        .sort((a, b) => a - b),
    ).toEqual([4, 8])
  })
})

describe("Import review: calibration of the new sessions (LIB-AC-25, LIB-AC-26)", () => {
  it("reads each new session's darks, flats and bias as ingestion leaves them, and what the batch's flats calibrate", () => {
    const state = store.getState()
    const draft = card()
    const plan = planImport(m, state, draft)!
    const preview = previewImport(state, plan, draft, AT)
    const session = (g: DestinationGroup) => preview.world.catalog.sessions[preview.sessionOf.get(g.session!.key)!]!
    const ha = session(lightsOf(plan, "Ha")[0]!)
    const oiii = session(lightsOf(plan, "OIII")[0]!)
    expect(ha.calibration).toMatchObject({ dark: { state: "pinned", by: "matching" }, flat: { state: "pinned", by: "matching" }, bias: { state: "pinned", by: "matching" } })
    expect(oiii.calibration!.flat.state).toBe("waiting")
    // The batch's Ha flats: the new Ha lights and a library Ha session that waits for flats.
    const flats = plan.groups.find((g) => g.type === "flat")!
    const used = preview.usedFor.get(flats.key)!
    expect(used.map((s) => s.id)).toContain(ha.id)
    expect(used.some((s) => state.catalog.sessions[s.id] !== undefined && s.channel === "Ha")).toBe(true)
    expect(used.some((s) => s.channel === "OIII")).toBe(false)
    expect(store.getState().catalog).toBe(state.catalog)
  })

  it("never waits for calibration: unsettled sessions import into Needs calibration and cannot join a Project", () => {
    runImport(card())
    const oiii = importedOiii()
    expect(oiii.length).toBe(2)
    const queue = new Set(calibrationQueue(store.getState().catalog, store.getState().disk).map((s) => s.id))
    for (const s of oiii) {
      expect(queue.has(s.id)).toBe(true)
      expect(canJoinProject(store.getState().catalog, s)).toBe(false)
    }
  })

  it("applies No flats chosen in review to the imported session, which is then settled", () => {
    const first = lightsOf(planImport(m, store.getState(), card())!, "OIII")[0]!.session!
    runImport(card({ calibration: { [first.key]: { flat: { state: "none" } } } }))
    const [eight, four] = importedOiii().sort((a, b) => b.assetIds.length - a.assetIds.length)
    expect(eight!.calibration!.flat).toMatchObject({ state: "none", by: "user" })
    expect(four!.calibration!.flat.state).toBe("waiting")
  })

  it("does not start a Trash operation when Cancel wins the move hand-off window", () => {
    vi.useFakeTimers()
    try {
      const draft = card({ mode: "move" })
      const plan = planImport(m, store.getState(), draft)!
      expect(plan.blockers).toEqual([])
      const id = startImport(plan, draft)
      for (let i = 0; i < 300 && (store.getState().operations[id]!.payload as unknown as { phase: string }).phase !== "trash"; i++) {
        store.setState((s) => importHandler.step(s, s.operations[id]!))
      }
      store.setState((s) => importHandler.step(s, s.operations[id]!))
      const pending = store.getState().operations[id]!
      expect((pending.payload as unknown as { phase: string }).phase).toBe("trash")
      expect((pending.payload as unknown as { trashRequested: boolean }).trashRequested).toBe(true)
      const operationCount = Object.keys(store.getState().operations).length
      cancelOperation(id)
      const canceled = store.getState().operations[id]!
      const withCanceledTimer = settleOperation(store.getState(), id, "succeeded", msg("op_no_duplicates"))
      expect(withCanceledTimer).toBe(store.getState())

      vi.advanceTimersByTime(0)
      expect(store.getState().operations[id]!.status).toBe("canceled")
      expect(Object.keys(store.getState().operations)).toHaveLength(operationCount)
      expect(store.getState().activity.filter((event) => event.operationId === id)).toHaveLength(1)
      expect(store.getState().disk.trash).toHaveLength(demo.disk.trash.length)
      expect(canceled.settledAt).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
