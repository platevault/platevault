import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import type { AssetId } from "@/domain/types"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { isSettled } from "@/store/operations"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { frameMeasureState, type MeasurePayload, measureHandler, startMeasurement } from "./measure"

let demo: PrototypeState
beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

/** Run the handler tick by tick until the operation settles. */
function runToEnd(id: string) {
  for (let i = 0; i < 100 && !isSettled(store.getState().operations[id]!.status); i++) store.setState((s) => measureHandler.step(s, s.operations[id]!))
}

describe("measureHandler", () => {
  it("measures a session's frames, re-uses valid records, and settles with every frame accounted for", () => {
    const { catalog } = store.getState()
    const session = Object.values(catalog.sessions).find((s) => s.imageType === "light" && s.assetIds.length >= 4 && s.assetIds.length <= 60)!
    const ids: AssetId[] = session.assetIds
    // Forget the records of half the frames, so the operation measures some and re-hashes the rest.
    const forgotten = ids.filter((_, i) => i % 2 === 0)
    store.setState((s) => {
      const measurements = { ...s.catalog.measurements }
      for (const id of forgotten) delete measurements[id]
      return { ...s, catalog: { ...s.catalog, measurements } }
    })
    const id = startMeasurement(session.id, ids)!
    expect(id).not.toBeNull()
    const started = store.getState().operations[id]!
    expect(started.kind).toBe("measure")
    expect(frameMeasureState(store.getState().catalog, forgotten[0]!, started)).toBe("pending")

    runToEnd(id)
    const op = store.getState().operations[id]!
    expect(["succeeded", "partial"]).toContain(op.status)
    const payload = op.payload as unknown as MeasurePayload
    expect(payload.verify).toEqual([])
    expect(payload.queue).toEqual([])
    expect(payload.measured + payload.reused + payload.skipped.length).toBe(payload.total)
    expect(payload.measured).toBeGreaterThanOrEqual(forgotten.length - payload.skipped.length)
    const { measurements, assets } = store.getState().catalog
    for (const frame of forgotten.filter((f) => !payload.skipped.includes(f))) {
      expect(measurements[frame]?.inputSha256).toBe(assets[frame]!.sha256)
      expect(frameMeasureState(store.getState().catalog, frame, op)).toBe("measured")
    }
  })

  it("starts nothing when there is nothing to measure", () => {
    expect(startMeasurement(Object.keys(store.getState().catalog.sessions)[0]!, [])).toBeNull()
  })
})
