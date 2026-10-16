import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { calibrateSessions } from "@/domain/calibration"
import { pendingChanges } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import type { Session } from "@/domain/types"
import { nowIso, type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { confirmRig, markFrames } from "./library"

const REDCAT = "otr_redcat"
const CYGNUS = "prj_cygnus"
const OIII = "prj_ngc_oiii"

let demo: PrototypeState
beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

const catalog = () => store.getState().catalog
const lights = (pick: (s: Session) => boolean) => Object.values(catalog().sessions).filter((s) => s.imageType === "light" && !s.supersededBy && pick(s))
const libraryChanges = (projectId: string) => pendingChanges(store.getState(), catalog().projects[projectId]!).filter((c) => c.source === "library")

describe("library marks (PIX-FR-13, D-W54)", () => {
  it("are never locked by a Project: an open Project shows the change as pending from the Library", () => {
    const view = catalog().projects[CYGNUS]!.view!
    const placed = new Set(view.entries.flatMap((e) => (e.source.type === "asset" ? [e.source.assetId] : [])))
    const frame = [...placed].find((id) => catalog().assets[id]!.quality.value === "usable")!
    const rejects = () => libraryChanges(CYGNUS).some((c) => c.kind === "frames-rejected" && c.assetIds.includes(frame))
    expect(rejects()).toBe(false)
    expect(markFrames([frame], "unusable", "/sessions").ok).toBe(true)
    expect(catalog().assets[frame]!.quality.value).toBe("unusable")
    expect(rejects()).toBe(true)
  })

  it("never reach a Closed Project", () => {
    const closed = catalog().projects[OIII]!
    const frame = catalog().sessions[closed.inputs[0]!.sessionId]!.assetIds[0]!
    expect(markFrames([frame], "unusable", "/sessions").ok).toBe(true)
    expect(catalog().projects[OIII]).toEqual(closed)
    expect(pendingChanges(store.getState(), closed)).toEqual([])
  })
})

describe("Confirm rig (LIB-FR-05, LIB-FR-26, CAL-FR-02)", () => {
  it("records the rig version in effect on the session's night and matches its calibration as ingestion would", () => {
    // A RedCat session from before its second version (1 Oct) whose flats matching pinned at ingestion; take its rig, version and flats away again.
    const session = lights((s) => s.equipment.value === REDCAT && s.night < "2026-10-01" && s.calibration?.flat.state === "pinned" && s.calibration.flat.by === "matching")[0]!
    const pinned = session.calibration!.flat
    const unsettled: Session = { ...session, equipment: { ...session.equipment, value: null, status: "unresolved", confirmedAt: null }, rigVersionId: null, calibration: { ...session.calibration!, flat: { state: "waiting" } } }
    store.setState((s) => ({ ...s, catalog: { ...s.catalog, sessions: { ...s.catalog.sessions, [session.id]: unsettled } } }))
    expect(confirmRig(session.id, REDCAT, session.revision).ok).toBe(true)
    const next = catalog().sessions[session.id]!
    expect(next.equipment).toMatchObject({ value: REDCAT, status: "confirmed" })
    expect(next.rigVersionId).toBe("rv_redcat_1")
    expect(next.revision).toBe(session.revision + 1)
    expect(next.calibration!.flat).toMatchObject({ state: "pinned", source: pinned.state === "pinned" ? pinned.source : null, by: "matching" })
    // Matching already ran: matching again changes nothing.
    const state = store.getState()
    expect(calibrateSessions(state.catalog, state.disk, state.settings, nowIso())).toBe(state.catalog)
  })

  it("keeps frames with no pointing in one session", () => {
    // 26 Sep OIII: the capture wrote no RA/DEC, so intake has no framing to split by.
    const [session] = lights((s) => s.night === "2026-09-26" && s.channel === "OIII" && s.pointing === null)
    expect(session).toBeDefined()
    const siblings = (s: Session) => lights((x) => x.night === s.night && x.channel === s.channel && x.exposureS === s.exposureS && x.cameraName === s.cameraName)
    expect(siblings(session!).map((s) => s.id)).toEqual([session!.id])
    expect(confirmRig(session!.id, REDCAT, session!.revision).ok).toBe(true)
    expect(siblings(session!).map((s) => s.id)).toEqual([session!.id])
    expect(catalog().sessions[session!.id]!).toMatchObject({ assetIds: session!.assetIds, framing: 1 })
  })
})
