import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { currentRigVersion, sessionRigVersion } from "@/domain/indexing"
import { createSeed, PROFILE_IDS } from "@/domain/seed"
import type { CalibrationChoice, Session } from "@/domain/types"
import { m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import {
  addApplicationProfile,
  addRigVersion,
  removeApplicationProfile,
  setCameraAlias,
  setCameraCalibrationDefaults,
  setDefaultInputMode,
  setGroupKeyword,
  setMatchingSettings,
  checkExecutable,
} from "./settings"

// The demo's rigs: RedCat (two versions), Esprit and FRA400; two ASI2600MM cameras of one model, the second with "Don't use darks".
const REDCAT = "otr_redcat"
const FIRST_2600 = "cam_2600"
const SECOND_2600 = "cam_2600b"
const CYGNUS = "prj_cygnus"

let demo: PrototypeState
beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

const catalog = () => store.getState().catalog
const refusal = (result: ReturnType<typeof setGroupKeyword>): string[] => {
  if (result.ok || result.reason !== "refused") throw new Error("expected a refusal")
  return result.reasons
}
const added = () => addApplicationProfile({ name: "  Astro Pixel Processor ", executablePath: "/Applications/APP.app", launchArgs: "--batch" })
/** Light sessions captured with this camera, by their rig version. */
const sessionsOf = (cameraId: string): Session[] => Object.values(catalog().sessions).filter((s) => s.imageType === "light" && s.calibration && sessionRigVersion(catalog(), s)?.version.cameraId === cameraId)
const pins = (): Record<string, CalibrationChoice[]> =>
  Object.fromEntries(Object.values(catalog().sessions).flatMap((s) => (s.calibration ? [[s.id, Object.values(s.calibration).filter((c) => c.state === "pinned" || c.state === "none")]] : [])))

describe("application profiles", () => {
  it("adds a generic, unverified profile and returns its id", () => {
    const { result, id } = added()
    expect(result.ok).toBe(true)
    const profile = catalog().profiles[id]!
    expect(profile).toMatchObject({ id, application: "generic", name: "Astro Pixel Processor", executablePath: "/Applications/APP.app", launchArgs: "--batch" })
    expect(profile.capability.verified).toBe(false)
    // No bundle sits at that path on the simulated computer.
    expect(profile.executableState).toBe("missing")
    expect(addApplicationProfile({ name: "Other", executablePath: null, launchArgs: "" }).id).not.toBe(id)
  })

  it("removes an added profile that no Project uses", () => {
    const { id } = added()
    expect(removeApplicationProfile(id).ok).toBe(true)
    expect(catalog().profiles[id]).toBeUndefined()
  })

  it("refuses to remove a built-in profile", () => {
    const result = removeApplicationProfile(PROFILE_IDS.siril)
    expect(result).toMatchObject({ ok: false, reason: "refused", reasons: [m.status_built_in()] })
    expect(catalog().profiles[PROFILE_IDS.siril]).toBeDefined()
  })

  it("refuses to remove a profile a Project hands its View to, naming the Project", () => {
    const { id } = added()
    const project = catalog().projects[CYGNUS]!
    store.setState((s) => ({ ...s, catalog: { ...s.catalog, projects: { ...s.catalog.projects, [CYGNUS]: { ...project, settings: { ...project.settings, profileId: id } } } } }))
    const reasons = refusal(removeApplicationProfile(id))
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain(m.equipment_used_by_projects({ count: 1 }))
    expect(reasons[0]).toContain(project.name)
    expect(catalog().profiles[id]).toBeDefined()
  })

  it("returns MISSING for an unknown executable profile", () => {
    expect(checkExecutable("missing-profile")).toEqual(expect.objectContaining({ ok: false, reason: "stale" }))
    expect(store.getState()).toEqual(demo)
  })
})

describe("Project defaults and keywords (PREP-FR-04, PRJ-FR-28)", () => {
  it("sets the View mode new Projects start with", () => {
    expect(setDefaultInputMode("copy").ok).toBe(true)
    expect(store.getState().settings.defaultInputMode).toBe("copy")
  })

  it("saves one trimmed grouping keyword and keeps the others", () => {
    expect(setGroupKeyword("group", " SET ").ok).toBe(true)
    expect(setGroupKeyword("panel", "MOSAIC-TILE").ok).toBe(true)
    expect(store.getState().settings.keywords).toEqual({ group: "SET", panel: "MOSAIC-TILE" })
  })

  it("allows hyphens after the first letter and refuses _ as a name WBPP cannot hold", () => {
    expect(refusal(setGroupKeyword("group", "MY_GROUP"))).toEqual([m.settings_keyword_underscore({ name: "MY_GROUP" })])
    expect(refusal(setGroupKeyword("group", "-GROUP"))).toEqual([m.settings_keyword_invalid({ name: "-GROUP" })])
    expect(refusal(setGroupKeyword("group", "GROUP 1"))).toEqual([m.settings_keyword_invalid({ name: "GROUP 1" })])
    expect(setGroupKeyword("group", "RIG-SET").ok).toBe(true)
  })

  it("refuses a name another grouping keyword or the View already uses, or one WBPP would read inside another", () => {
    expect(refusal(setGroupKeyword("group", "Panel"))).toEqual([m.settings_keyword_same({ kind: m.common_mosaic_panel(), name: "Panel" })])
    expect(refusal(setGroupKeyword("group", "NIGHT"))).toEqual([m.settings_keyword_reserved({ name: "NIGHT" })])
    expect(refusal(setGroupKeyword("group", "MY-PANEL"))).toEqual([m.settings_keyword_overlap({ inner: "PANEL", outer: "MY-PANEL" })])
    expect(refusal(setGroupKeyword("panel", "GROUP-X"))).toEqual([m.settings_keyword_overlap({ inner: "GROUP", outer: "GROUP-X" })])
    expect(refusal(setGroupKeyword("group", "SET-NIGHT"))).toEqual([m.settings_keyword_overlap({ inner: "NIGHT", outer: "SET-NIGHT" })])
    expect(store.getState().settings.keywords).toEqual({ group: "GROUP", panel: "PANEL" })
  })
})

describe("matching thresholds (D-W114)", () => {
  it("clamps each threshold to its range and keeps every pin and No", () => {
    const before = pins()
    expect(setMatchingSettings({ flats: { windowNights: 60.4 }, darks: { windowDays: -5 }, framing: { overlapPct: 140 } }).ok).toBe(true)
    const { matching } = store.getState().settings
    expect(matching.flats.windowNights).toBe(60)
    expect(matching.darks.windowDays).toBe(0)
    expect(matching.framing.overlapPct).toBe(100)
    for (const [id, choices] of Object.entries(before)) expect(Object.values(catalog().sessions[id]!.calibration!).filter((c) => c.state === "pinned" || c.state === "none")).toEqual(expect.arrayContaining(choices))
  })

  it("refuses a lower bound past its upper one", () => {
    const before = store.getState().settings.matching
    expect(refusal(setMatchingSettings({ flats: { fineDeg: 6, warnDeg: 5 } }))).toHaveLength(1)
    expect(refusal(setMatchingSettings({ framing: { panelOverlapMinPct: 50, panelOverlapMaxPct: 40 } }))).toHaveLength(1)
    expect(store.getState().settings.matching).toEqual(before)
  })
})

describe("rig versions (PLAN-EQ-FR-07, LIB-FR-26)", () => {
  it("freezes the current version and applies the new optics from a later night; sessions keep the version they recorded", () => {
    const rig = catalog().opticalTrains[REDCAT]!
    const recorded = Object.fromEntries(Object.values(catalog().sessions).filter((s) => s.equipment.value === REDCAT).map((s) => [s.id, s.rigVersionId]))
    expect(Object.keys(recorded).length).toBeGreaterThan(0)
    const optics = { ...currentRigVersion(rig), effectiveFocalLengthMm: 200 }
    expect(addRigVersion(REDCAT, "2026-11-01", optics).ok).toBe(true)
    const next = catalog().opticalTrains[REDCAT]!
    expect(next).toMatchObject({ versionFrom: "2026-11-01", effectiveFocalLengthMm: 200 })
    expect(next.versionId).not.toBe(rig.versionId)
    expect(next.history).toEqual([...rig.history, currentRigVersion(rig)])
    for (const [id, versionId] of Object.entries(recorded)) expect(catalog().sessions[id]!.rigVersionId).toBe(versionId)
  })

  it("refuses a version from the current one's first night or earlier, and writes nothing for the same optics", () => {
    const rig = catalog().opticalTrains[REDCAT]!
    expect(refusal(addRigVersion(REDCAT, rig.versionFrom, { ...currentRigVersion(rig), effectiveFocalLengthMm: 200 }))).toHaveLength(1)
    expect(addRigVersion(REDCAT, "2026-11-01", currentRigVersion(rig)).ok).toBe(true)
    expect(catalog().opticalTrains[REDCAT]).toEqual(rig)
  })
})

describe("cameras (LIB-FR-26, CAL-FR-22)", () => {
  it("keeps physical aliases unique and required while two cameras share a model", () => {
    expect(setCameraAlias(FIRST_2600, "  Mono A ").ok).toBe(true)
    expect(catalog().cameras[FIRST_2600]!.physicalAlias).toBe("Mono A")
    expect(refusal(setCameraAlias(SECOND_2600, "mono a"))).toHaveLength(1)
    expect(refusal(setCameraAlias(SECOND_2600, " "))).toHaveLength(1)
    expect(catalog().cameras[SECOND_2600]!.physicalAlias).toBe("2600MM #2")
  })

  it("Don't use darks settles the camera's waiting darks as No, and turning it off sends those Nos back to matching", () => {
    const sessions = sessionsOf(SECOND_2600)
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.every((s) => s.calibration!.dark.state === "none")).toBe(true)
    expect(setCameraCalibrationDefaults(SECOND_2600, { noDarks: false }).ok).toBe(true)
    expect(catalog().cameras[SECOND_2600]!.noDarks).toBe(false)
    for (const s of sessionsOf(SECOND_2600)) {
      const dark = s.calibration!.dark
      const before = sessions.find((x) => x.id === s.id)!.calibration!.dark
      if (before.state === "none" && before.by === "camera-default") expect(dark.state).not.toBe("none")
    }
    expect(setCameraCalibrationDefaults(SECOND_2600, { noDarks: true }).ok).toBe(true)
    for (const s of sessionsOf(SECOND_2600)) {
      const dark = s.calibration!.dark
      if (dark.state !== "pinned") expect(dark).toMatchObject({ state: "none", by: "camera-default" })
    }
  })
})
