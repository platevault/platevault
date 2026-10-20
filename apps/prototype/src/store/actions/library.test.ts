import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { calibrateSessions } from "@/domain/calibration"
import { sessionIntakeLink, sessionReadiness } from "@/domain/derive"
import { qualityApplicability } from "@/domain/library"
import { applyPlan, pendingChanges } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import type { Project, Session } from "@/domain/types"
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

describe("a reopened review (D-W100, VSEL-FR-12, PIX-FR-18)", () => {
  const holding = (state: "open" | "closed", sessionId: string) =>
    Object.values(catalog().projects).filter((p) => (state === "open" ? p.state === "open" : p.state !== "open") && p.view !== null && p.inputs.some((i) => i.sessionId === sessionId))
  const reopened = (project: Project) => pendingChanges(store.getState(), catalog().projects[project.id]!).filter((c) => c.kind === "frames-unreviewed")
  const notReady = (project: Project) => applyPlan(store.getState(), catalog().projects[project.id]!).refusals.filter((r) => r.kind === "not-ready")

  it("reaches every open Project holding the session as the Library's pending change, the session reads Needs review, and Apply waits until it is Ready", () => {
    // Two open Projects with a View hold the session: Cygnus and a copy of it.
    const cygnus = catalog().projects[CYGNUS]!
    const copy: Project = { ...structuredClone(cygnus), id: `${cygnus.id}_copy` as Project["id"], name: `${cygnus.name} 2` }
    store.setState((s) => ({ ...s, catalog: { ...s.catalog, projects: { ...s.catalog.projects, [copy.id]: copy } } }))
    const session = catalog().sessions[cygnus.inputs.find((i) => sessionReadiness(catalog(), catalog().sessions[i.sessionId]!) === "ready")!.sessionId]!
    const open = holding("open", session.id)
    expect(open.map((p) => p.id)).toEqual(expect.arrayContaining([CYGNUS, copy.id]))
    const frame = session.assetIds.find((id) => catalog().assets[id]!.quality.value === "usable")!
    for (const project of open) {
      expect(reopened(project)).toEqual([])
      expect(notReady(project)).toEqual([])
    }

    expect(markFrames([frame], "unreviewed", `/sessions/${session.id}?step=review`).ok).toBe(true)
    expect(sessionReadiness(catalog(), catalog().sessions[session.id]!)).toBe("needs-review")
    for (const project of open) {
      expect(reopened(project)).toEqual([
        expect.objectContaining({ sessionId: session.id, assetIds: [frame], source: "library", label: expect.objectContaining({ key: "project_change_frames_unreviewed" }), link: sessionIntakeLink(session.id, "review") }),
      ])
      expect(notReady(project)).toEqual([{ kind: "not-ready", sessions: [expect.objectContaining({ id: session.id })] }])
    }

    // Ready again with the same mark: nothing pending from the review, and Apply no longer waits on it.
    expect(markFrames([frame], "usable", `/sessions/${session.id}?step=review`).ok).toBe(true)
    for (const project of open) {
      expect(reopened(project)).toEqual([])
      expect(notReady(project)).toEqual([])
    }
  })

  it("is no frame whose bytes changed after review: it keeps its decision (ChangedContent, LIB-FR-09), so no review set it back", () => {
    // The seed's M 31 L frame that changed on disk after review, in open M 31 LRGB.
    const m31 = catalog().projects.prj_m31!
    const drifted = m31.inputs.flatMap((i) => catalog().sessions[i.sessionId]!.assetIds).find((id) => qualityApplicability(catalog().assets[id]!) === "changed-content")!
    expect(catalog().assets[drifted]!.quality.value).toBe("usable")
    expect(reopened(m31)).toEqual([])
  })

  it("never reaches a Closed Project holding the session", () => {
    const session = lights((s) => holding("closed", s.id).length > 0)[0]!
    const closed = holding("closed", session.id)
    const frame = session.assetIds.find((id) => catalog().assets[id]!.quality.value !== "unreviewed")!
    expect(markFrames([frame], "unreviewed", `/sessions/${session.id}?step=review`).ok).toBe(true)
    for (const project of closed) expect(pendingChanges(store.getState(), catalog().projects[project.id]!)).toEqual([])
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
