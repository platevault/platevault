import { beforeEach, describe, expect, it } from "vitest"
import { rigBands, unknownFilterValues } from "@/domain/derive"
import { createSeed } from "@/domain/seed"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { removeEquipment, saveFilter, saveRig } from "./settings-actions"

const RIG = "otr_esprit"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

describe("Settings › Equipment: filters are records a rig selects (ngm9g)", () => {
  it("Add Halpha to a rig creates the record and puts it on that rig (PLAN-EQ-AC-03)", () => {
    const { result, id } = saveFilter(null, { name: "Halpha", matches: ["Halpha"], bands: ["Ha"] }, RIG)
    expect(result.ok).toBe(true)
    const { catalog } = store.getState()
    expect(catalog.filters[id]).toMatchObject({ name: "Halpha", matches: ["Halpha"], bands: ["Ha"] })
    expect(catalog.opticalTrains[RIG]!.filterIds).toContain(id)
    expect(unknownFilterValues(catalog, RIG)).not.toContain("Halpha")
  })

  it("a rig's selected filters set its bands; an OSC rig without filters still captures R, G and B", () => {
    const { catalog } = store.getState()
    const rig = catalog.opticalTrains[RIG]!
    const ha = Object.values(catalog.filters).find((f) => f.name === "OIII")!
    saveRig(RIG, { name: rig.name, cameraId: rig.cameraId!, telescopeId: rig.telescopeId!, reducerId: null, focalLengthMm: rig.effectiveFocalLengthMm, filterIds: [] })
    expect(rigBands(store.getState().catalog, store.getState().catalog.opticalTrains[RIG]!)).toEqual(["R", "G", "B"])
    saveRig(RIG, { name: rig.name, cameraId: rig.cameraId!, telescopeId: rig.telescopeId!, reducerId: null, focalLengthMm: rig.effectiveFocalLengthMm, filterIds: [ha.id] })
    expect(rigBands(store.getState().catalog, store.getState().catalog.opticalTrains[RIG]!)).toEqual(["R", "G", "B", "OIII"])
  })

  it("Remove is refused while a rig carries the filter, and removes it once none does", () => {
    const { catalog } = store.getState()
    const lExtreme = Object.values(catalog.filters).find((f) => f.name === "L-eXtreme")!
    expect(removeEquipment("filter", lExtreme.id)).toMatchObject({ ok: false, reason: "refused" })
    const rig = catalog.opticalTrains[RIG]!
    saveRig(RIG, { name: rig.name, cameraId: rig.cameraId!, telescopeId: rig.telescopeId!, reducerId: null, focalLengthMm: rig.effectiveFocalLengthMm, filterIds: [] })
    expect(removeEquipment("filter", lExtreme.id).ok).toBe(true)
    expect(store.getState().catalog.filters[lExtreme.id]).toBeUndefined()
  })
})
