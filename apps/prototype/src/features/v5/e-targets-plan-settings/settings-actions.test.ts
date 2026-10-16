import { beforeEach, describe, expect, it } from "vitest"
import { rigBands, unknownFilterValues } from "@/domain/derive"
import { rigVersions, sessionRigVersion } from "@/domain/indexing"
import { shiftNight } from "@/domain/planning"
import { createSeed } from "@/domain/seed"
import type { OpticalTrain } from "@/domain/types"
import { setCameraAlias } from "@/store/actions/settings"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { cameraLabel, camerasNeedingAlias, filterName, type RigInput, removeEquipment, rigVersionSessionCounts, saveCamera, saveFilter, saveRig } from "./settings-actions"

const RIG = "otr_esprit"
/** A night after every seed rig version began, so an edit there starts a new version. */
const LATER = "2026-10-12"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

/** The rig as the dialog would save it, with `patch` applied. */
function asInput(rig: OpticalTrain, patch: Partial<RigInput>): RigInput {
  return { name: rig.name, cameraId: rig.cameraId!, telescopeId: rig.telescopeId!, reducerId: rig.reducerId ?? null, focalLengthMm: rig.effectiveFocalLengthMm, filterIds: rig.filterIds, rotator: rig.rotator, from: LATER, ...patch }
}

const rigNow = () => store.getState().catalog.opticalTrains[RIG]!

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
    const rig = rigNow()
    const oiii = Object.values(store.getState().catalog.filters).find((f) => f.name === "OIII")!
    expect(saveRig(RIG, asInput(rig, { filterIds: [] })).result.ok).toBe(true)
    expect(rigBands(store.getState().catalog, rigNow())).toEqual(["R", "G", "B"])
    expect(saveRig(RIG, asInput(rig, { filterIds: [oiii.id], from: "2026-10-13" })).result.ok).toBe(true)
    expect(rigBands(store.getState().catalog, rigNow())).toEqual(["R", "G", "B", "OIII"])
  })

  it("Remove is refused while any version of a rig carries the filter, and removes a filter no rig ever carried", () => {
    const { catalog } = store.getState()
    const lExtreme = Object.values(catalog.filters).find((f) => f.name === "L-eXtreme")!
    expect(removeEquipment("filter", lExtreme.id)).toMatchObject({ ok: false, reason: "refused" })
    expect(saveRig(RIG, asInput(rigNow(), { filterIds: [] })).result.ok).toBe(true)
    // The earlier version still records the filter its sessions were captured with (PLAN-EQ-FR-07).
    expect(removeEquipment("filter", lExtreme.id)).toMatchObject({ ok: false, reason: "refused" })
    const spare = saveFilter(null, { name: "Spare", matches: ["Spare"], bands: ["L"] }).id
    expect(removeEquipment("filter", spare).ok).toBe(true)
    expect(store.getState().catalog.filters[spare]).toBeUndefined()
  })
})

describe("Settings › Equipment: rig versions (PLAN-EQ-FR-07)", () => {
  it("an edit to what a rig is made of starts a new version from the night named; the earlier one stays as it was", () => {
    const before = rigNow()
    expect(saveRig(RIG, asInput(before, { rotator: !before.rotator })).result.ok).toBe(true)
    const after = rigNow()
    expect(after.versionFrom).toBe(LATER)
    expect(after.versionId).not.toBe(before.versionId)
    expect(rigVersions(after).map((v) => v.id)).toEqual([...rigVersions(before).map((v) => v.id), after.versionId])
    expect(after.history.at(-1)).toMatchObject({ id: before.versionId, from: before.versionFrom, rotator: before.rotator })
  })

  it("a rename starts no version, and an edit dated on or before the current version's first night is refused", () => {
    const before = rigNow()
    expect(saveRig(RIG, asInput(before, { name: "Esprit wide" })).result.ok).toBe(true)
    expect(rigNow()).toMatchObject({ name: "Esprit wide", versionId: before.versionId, history: before.history })
    expect(saveRig(RIG, asInput(rigNow(), { rotator: !before.rotator, from: before.versionFrom })).result).toMatchObject({ ok: false, reason: "refused" })
    expect(rigNow().versionId).toBe(before.versionId)
  })

  it("a new camera from a night leaves every session's captured version, its pins and every Project as they were (LIB-AC-29, PLAN-EQ-AC-08)", () => {
    const before = store.getState().catalog
    const rig = rigNow()
    const held = Object.values(before.sessions).filter((s) => !s.supersededBy && sessionRigVersion(before, s)?.rigId === RIG)
    expect(held.length).toBeGreaterThan(0)
    expect(saveRig(RIG, asInput(rig, { cameraId: "cam_2600b" })).result.ok).toBe(true)
    const after = store.getState().catalog
    expect(after.opticalTrains[RIG]).toMatchObject({ cameraId: "cam_2600b", versionFrom: LATER })
    expect(after.opticalTrains[RIG]!.history.at(-1)).toMatchObject({ id: rig.versionId, cameraId: rig.cameraId })
    for (const session of held) {
      const now = after.sessions[session.id]!
      expect(now.rigVersionId).toBe(session.rigVersionId)
      expect(sessionRigVersion(after, now)?.version.id).toBe(sessionRigVersion(before, session)?.version.id)
      expect(now.calibration).toEqual(session.calibration)
    }
    expect(after.projects).toEqual(before.projects)
    // The version table counts the sessions each version holds: the edit moved none onto the new one.
    const counts = rigVersionSessionCounts(after, RIG)
    expect(counts.get(rig.versionId)).toBe(held.length)
    expect(counts.get(after.opticalTrains[RIG]!.versionId)).toBeUndefined()
  })

  it("provisional: a version dated before a session's night leaves the version that session recorded (PLAN-EQ-AC-09)", () => {
    const rig = rigNow()
    const { catalog } = store.getState()
    const later = Object.values(catalog.sessions).find((s) => !s.supersededBy && s.rigVersionId === rig.versionId && s.night > shiftNight(rig.versionFrom, 1))
    expect(later).toBeDefined()
    expect(saveRig(RIG, asInput(rig, { rotator: !rig.rotator, from: shiftNight(rig.versionFrom, 1) })).result.ok).toBe(true)
    const now = store.getState().catalog
    expect(now.sessions[later!.id]!.rigVersionId).toBe(rig.versionId)
    expect(sessionRigVersion(now, now.sessions[later!.id]!)?.version.id).toBe(rig.versionId)
  })
})

describe("Settings › Equipment: camera alias and calibration defaults (PLAN-EQ-FR-08)", () => {
  it("a second camera of a model is refused until both have their own alias, adding nothing (PLAN-EQ-AC-10)", () => {
    const first = store.getState().catalog.cameras.cam_533!
    const count = () => Object.values(store.getState().catalog.cameras).filter((c) => c.name === first.name).length
    const input = { name: first.name, kind: first.kind, widthPx: first.widthPx, heightPx: first.heightPx, pixelSizeUm: first.pixelSizeUm, physicalAlias: "", noDarks: false, noBias: false }
    expect(saveCamera(null, input).result).toMatchObject({ ok: false, reason: "refused" })
    expect(saveCamera(null, { ...input, physicalAlias: "2600MM #1" }).result).toMatchObject({ ok: false, reason: "refused" })
    // Its own alias is not enough while the first ASI533MC still has none: the dialog asks for that one too.
    expect(camerasNeedingAlias(store.getState().catalog, "", first.name).map((c) => c.id)).toEqual([first.id])
    expect(saveCamera(null, { ...input, physicalAlias: "533 B" }).result).toMatchObject({ ok: false, reason: "refused" })
    expect(count()).toBe(1)
    expect(setCameraAlias(first.id, "533 A").ok).toBe(true)
    const saved = saveCamera(null, { ...input, physicalAlias: "533 B" })
    expect(saved.result.ok).toBe(true)
    expect(store.getState().catalog.cameras[saved.id]).toMatchObject({ name: first.name, physicalAlias: "533 B" })
    expect(count()).toBe(2)
    expect(cameraLabel(store.getState().catalog.cameras[saved.id]!)).toBe(`${first.name} · 533 B`)
  })

  it("Don't use bias settles the camera's unpinned bias as No by the camera default, and keeps every pin", () => {
    const catalog = () => store.getState().catalog
    const camera = catalog().cameras.cam_533!
    const sessions = () => Object.values(catalog().sessions).filter((s) => !s.supersededBy && s.calibration && sessionRigVersion(catalog(), s)?.version.cameraId === camera.id)
    const before = new Map(sessions().map((s) => [s.id, s.calibration!.bias]))
    expect(before.size).toBeGreaterThan(0)
    const input = { name: camera.name, kind: camera.kind, widthPx: camera.widthPx, heightPx: camera.heightPx, pixelSizeUm: camera.pixelSizeUm, physicalAlias: camera.physicalAlias ?? "", noDarks: camera.noDarks, noBias: true }
    expect(saveCamera(camera.id, input).result.ok).toBe(true)
    expect(catalog().cameras[camera.id]!.noBias).toBe(true)
    for (const session of sessions()) {
      const was = before.get(session.id)!
      const bias = session.calibration!.bias
      if (was.state === "pinned" || (was.state === "none" && was.by === "user")) expect(bias).toEqual(was)
      else expect(bias).toMatchObject({ state: "none", by: "camera-default" })
    }
  })
})

describe("Settings › Equipment: same-named filters read apart", () => {
  it("the demo has no two filters with one name: the rigs that carry the same Ha share one record", () => {
    const filters = Object.values(store.getState().catalog.filters)
    const names = filters.map((f) => f.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    const ha = filters.find((f) => f.name === "Ha")!
    const carriers = Object.values(store.getState().catalog.opticalTrains).filter((r) => r.filterIds.includes(ha.id))
    expect(carriers.map((r) => r.id).sort()).toEqual(["otr_fra400", "otr_redcat"])
  })

  it("two filters named Ha each add their FILTER matches, so their items differ", () => {
    expect(saveFilter(null, { name: "Ha", matches: ["Ha 3nm"], bands: ["Ha"] }).result.ok).toBe(true)
    const filters = Object.values(store.getState().catalog.filters)
    const has = filters.filter((f) => f.name === "Ha")
    expect(has).toHaveLength(2)
    const labels = has.map((f) => filterName(f, has))
    expect(new Set(labels).size).toBe(2)
    expect(labels).toEqual(expect.arrayContaining(["Ha · Ha, H-alpha", "Ha · Ha 3nm"]))
    const oiii = filters.find((f) => f.name === "OIII")!
    expect(filterName(oiii, filters)).toBe("OIII")
  })
})
