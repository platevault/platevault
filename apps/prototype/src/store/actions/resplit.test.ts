/**
 * A regrouping correction that re-splits a held session (LIB-FR-12, D-W100;
 * owner's answers of 2026-10-19 and 2026-10-20): the 064 contract's
 * library_confirm_metadata on some of a session's frames.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sessionIntakeLink, sessionIntakeState, sessionReadiness } from "@/domain/derive"
import { frameOut, framesRef, sessionLongRef } from "@/domain/membership"
import { applyPlan, pendingChanges } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import type { AssetId, Project, ProjectInput, Session, SessionId } from "@/domain/types"
import { msg } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { isSettled, registerOperationHandlers } from "@/store/operations"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { confirmMetadata, editSessionDetails, finishReview } from "./library"
import { discardChanges, PROJECT_VIEW_HANDLERS, startApply } from "./project-view"
import { removeSessions } from "./projects"

const CYGNUS = "prj_cygnus"
const OIII = "prj_ngc_oiii"
const apply = PROJECT_VIEW_HANDLERS.find((h) => h.kind === "apply")!

let demo: PrototypeState
beforeAll(() => {
  registerOperationHandlers(PROJECT_VIEW_HANDLERS)
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

const catalog = () => store.getState().catalog
const project = (id: string): Project => catalog().projects[id]!
const successorsOf = (id: SessionId): Session[] => Object.values(catalog().sessions).filter((s) => s.previousSessionIds.includes(id))
const byCapture = (session: Session): AssetId[] => [...session.assetIds].sort((a, b) => catalog().assets[a]!.observed.dateObs.localeCompare(catalog().assets[b]!.observed.dateObs))
const notReady = (id: string) => applyPlan(store.getState(), project(id)).refusals.filter((r) => r.kind === "not-ready")
const resplits = (id: string) => pendingChanges(store.getState(), project(id)).filter((c) => c.kind === "session-resplit")
const removals = (id: string) => pendingChanges(store.getState(), project(id)).filter((c) => c.kind === "session-removed")
const framesIn = (input: ProjectInput) => catalog().sessions[input.sessionId]!.assetIds.filter((id) => frameOut(catalog(), input, id) === null)
const placedFrames = (id: string) => new Set(project(id).view!.entries.flatMap((e) => (e.role === "light" && e.source.type === "asset" ? [e.source.assetId] : [])))

/** A Ready session Cygnus holds with at least three frames, held also by a second open Project (a copy of Cygnus with its View). */
function heldTwice(): { session: Session; open: string[] } {
  const cygnus = project(CYGNUS)
  const copy: Project = { ...structuredClone(cygnus), id: `${cygnus.id}_copy` as Project["id"], name: `${cygnus.name} 2` }
  store.setState((s) => ({ ...s, catalog: { ...s.catalog, projects: { ...s.catalog.projects, [copy.id]: copy } } }))
  const input = cygnus.inputs.find((i) => {
    const s = catalog().sessions[i.sessionId]!
    return sessionReadiness(catalog(), s) === "ready" && s.assetIds.length >= 3
  })!
  return { session: catalog().sessions[input.sessionId]!, open: [CYGNUS, copy.id] }
}
function matchingSession(source: Session, anchorAssetId: AssetId): Session {
  const id = `${source.id}_matching`
  const first = catalog().assets[anchorAssetId]!
  const assetId = `${first.id}_matching`
  const correction = { id: `cor_${id}`, field: "exposure" as const, observedValue: String(source.exposureS), correctedValue: String(source.exposureS * 2), at: source.startedAt, revision: 1 }
  const candidate: Session = { ...structuredClone(source), id, assetIds: [assetId], exposureS: source.exposureS * 2, corrections: [correction], previousSessionIds: [], supersededBy: null, reviewReset: false, startedAt: first.observed.dateObs, endedAt: first.observed.dateObs }
  store.setState((state) => ({ ...state, catalog: { ...state.catalog, assets: { ...state.catalog.assets, [assetId]: { ...first, id: assetId, sessionId: id, observed: { ...first.observed, filter: source.channel, exposureS: source.exposureS * 2 } } }, sessions: { ...state.catalog.sessions, [id]: candidate } } }))
  return catalog().sessions[id]!
}

/** Correct the exposure of `assetIds` to twice the session's: a grouping value, so those frames regroup (LIB-FR-12). */
function correctExposure(session: Session, assetIds: AssetId[]) {
  return confirmMetadata(session.id, assetIds, "exposure", String(session.exposureS * 2), catalog().sessions[session.id]!.revision)
}

function runApply(id: string) {
  const plan = applyPlan(store.getState(), project(id))
  expect(plan.refusals).toEqual([])
  const { result, operationId } = startApply(id, { fingerprint: plan.fingerprint, tickedUnplaced: plan.drift.unplaced.map((f) => f.path) })
  expect(result.ok).toBe(true)
  for (let i = 0; i < 200 && !isSettled(store.getState().operations[operationId!]!.status); i++) store.setState((s) => apply.step(s, s.operations[operationId!]!))
  expect(store.getState().operations[operationId!]!.status).toBe("succeeded")
}

describe("a regrouping correction re-splits a held session (LIB-FR-12, D-W100)", () => {
  it("leaves every successor in each open Project holding it, each labelled as the Library's pending change, and no frame leaves", () => {
    const { session, open } = heldTwice()
    const groupOf = Object.fromEntries(open.map((id) => [id, project(id).inputs.find((i) => i.sessionId === session.id)!.groupId]))
    const corrected = byCapture(session).slice(-2)
    expect(correctExposure(session, corrected).ok).toBe(true)

    const successors = successorsOf(session.id)
    expect(successors).toHaveLength(2)
    expect(catalog().sessions[session.id]!.supersededBy).not.toBeNull()
    expect(successors.flatMap((s) => s.assetIds).sort()).toEqual([...session.assetIds].sort())
    expect(successors.find((s) => s.assetIds.every((id) => corrected.includes(id)))!.assetIds.sort()).toEqual([...corrected].sort())
    for (const id of corrected) expect(successors.map((s) => s.id)).toContain(catalog().assets[id]!.sessionId)
    for (const id of open) {
      const inputs = project(id).inputs
      expect(inputs.some((i) => i.sessionId === session.id)).toBe(false)
      for (const successor of successors) expect(inputs.find((i) => i.sessionId === successor.id)).toMatchObject({ groupId: groupOf[id] })
      expect(resplits(id)).toEqual(
        expect.arrayContaining(
          successors.map((s) =>
            expect.objectContaining({ kind: "session-resplit", sessionId: s.id, from: session.id, source: "library", label: expect.objectContaining({ key: "project_change_session_resplit" }), link: sessionIntakeLink(s.id, "review") }),
          ),
        ),
      )
      expect(resplits(id)).toHaveLength(2)
      // The re-split is the Library's change, not the Project adding and removing sessions.
      expect(pendingChanges(store.getState(), project(id)).filter((c) => (c.kind === "session-added" || c.kind === "session-removed") && [session.id, ...successors.map((s) => s.id)].includes(c.sessionId))).toEqual([])
    }
  })

  it("refuses Apply until every successor is Ready, then the Project holds every successor", () => {
    const { session, open } = heldTwice()
    expect(notReady(CYGNUS)).toEqual([])
    const predecessorInput = project(CYGNUS).inputs.find((i) => i.sessionId === session.id)!
    expect(correctExposure(session, byCapture(session).slice(-2)).ok).toBe(true)
    const [first, second] = successorsOf(session.id)
    for (const successor of [first!, second!]) {
      // Each successor keeps its frames' marks, Target and rig, and its Review step reads Needs review.
      expect(sessionReadiness(catalog(), successor)).toBe("needs-review")
      expect(sessionIntakeState(store.getState(), successor).current).toBe("review")
    }
    for (const id of open) expect(notReady(id)).toEqual([{ kind: "not-ready", sessions: expect.arrayContaining([expect.objectContaining({ id: first!.id }), expect.objectContaining({ id: second!.id })]) }])

    expect(finishReview(first!.id, catalog().sessions[first!.id]!.revision).ok).toBe(true)
    expect(sessionReadiness(catalog(), catalog().sessions[first!.id]!)).toBe("ready")
    for (const id of open) expect(notReady(id)).toEqual([{ kind: "not-ready", sessions: [expect.objectContaining({ id: second!.id })] }])

    expect(finishReview(second!.id, catalog().sessions[second!.id]!.revision).ok).toBe(true)
    for (const id of open) expect(notReady(id)).toEqual([])

    runApply(CYGNUS)
    const view = project(CYGNUS).view!
    expect(view.inputs.map((i) => i.sessionId)).toEqual(expect.arrayContaining([first!.id, second!.id]))
    expect(view.inputs.some((i) => i.sessionId === session.id)).toBe(false)
    expect(resplits(CYGNUS)).toEqual([])
    // No frame silently leaves: the successors' frames in for the Project are the predecessor's, and each is placed.
    const placed = new Set(view.entries.flatMap((e) => (e.role === "light" && e.source.type === "asset" ? [e.source.assetId] : [])))
    const held = project(CYGNUS).inputs.filter((i) => i.sessionId === first!.id || i.sessionId === second!.id)
    const inFor = held.flatMap((input) => catalog().sessions[input.sessionId]!.assetIds.filter((id) => frameOut(catalog(), input, id) === null))
    expect([...inFor].sort()).toEqual(session.assetIds.filter((id) => frameOut(catalog(), predecessorInput, id) === null).sort())
    for (const id of inFor) expect(placed.has(id)).toBe(true)
  })

  it("gives the successor holding the original first frame the session's name and notes; the others get automatic names", () => {
    const { session } = heldTwice()
    expect(editSessionDetails(session.id, { name: "Veil first light", notes: "Thin cloud after 02:00" }, session.revision).ok).toBe(true)
    const named = catalog().sessions[session.id]!
    const order = byCapture(named)
    // The first frame is among the corrected ones, so the name follows the frame, not the uncorrected rest.
    expect(correctExposure(named, [order[0]!, order[1]!]).ok).toBe(true)
    const successors = successorsOf(session.id)
    const holder = successors.find((s) => s.assetIds.includes(order[0]!))!
    expect(holder).toMatchObject({ name: "Veil first light", notes: "Thin cloud after 02:00" })
    for (const other of successors.filter((s) => s.id !== holder.id)) expect(other).toMatchObject({ name: null, notes: "" })
  })

  it("never changes a Closed Project holding the session", () => {
    const closed = project(OIII)
    expect(closed.state).not.toBe("open")
    const session = catalog().sessions[closed.inputs[0]!.sessionId]!
    expect(correctExposure(session, byCapture(session).slice(-1)).ok).toBe(true)
    expect(successorsOf(session.id).length).toBeGreaterThan(1)
    expect(project(OIII)).toEqual(closed)
    expect(pendingChanges(store.getState(), project(OIII))).toEqual([])
  })

  it("Finish review is the Review step's Proceed and refuses while a frame is Unreviewed", () => {
    const { session } = heldTwice()
    expect(correctExposure(session, byCapture(session).slice(-2)).ok).toBe(true)
    const [successor] = successorsOf(session.id)
    const state = sessionIntakeState(store.getState(), successor!)
    expect(state.steps.find((s) => s.id === "review")).toMatchObject({ gate: null, summary: expect.objectContaining({ key: "status_needs_review" }) })
    const frame = successor!.assetIds[0]!
    store.setState((s) => ({ ...s, catalog: { ...s.catalog, assets: { ...s.catalog.assets, [frame]: { ...s.catalog.assets[frame]!, quality: { value: "unreviewed", decidedAt: null, basisSha256: null } } } } }))
    expect(finishReview(successor!.id, successor!.revision)).toMatchObject({ ok: false, reason: "refused" })
    expect(catalog().sessions[successor!.id]!.reviewReset).toBe(true)
  })

  it("lists removing a successor before Apply as the Project's pending change naming it and its frames; Discard restores it, and Apply holds only what was kept", () => {
    const { session } = heldTwice()
    expect(correctExposure(session, byCapture(session).slice(-2)).ok).toBe(true)
    const [kept, removed] = successorsOf(session.id)
    const held = project(CYGNUS).inputs.find((i) => i.sessionId === removed!.id)!
    expect(framesIn(held).length).toBeGreaterThan(0)

    expect(removeSessions(CYGNUS, [removed!.id]).ok).toBe(true)
    // No frame silently leaves (owner's answer, 2026-10-19): the removal is the Project's own, named with its frames.
    expect(removals(CYGNUS)).toEqual([
      expect.objectContaining({
        kind: "session-removed",
        sessionId: removed!.id,
        source: "project",
        label: msg("project_change_successor_removed", { session: sessionLongRef(removed!), from: sessionLongRef(catalog().sessions[session.id]!), frames: framesRef(framesIn(held).length) }),
      }),
    ])
    expect(resplits(CYGNUS).map((c) => c.sessionId)).toEqual([kept!.id])

    // Discard (D-W109) restores the successor as the re-split left it.
    expect(discardChanges(CYGNUS, removals(CYGNUS).map((c) => c.id)).ok).toBe(true)
    expect(project(CYGNUS).inputs.find((i) => i.sessionId === removed!.id)).toEqual(held)
    expect(removals(CYGNUS)).toEqual([])
    expect(resplits(CYGNUS)).toHaveLength(2)

    expect(removeSessions(CYGNUS, [removed!.id]).ok).toBe(true)
    expect(finishReview(kept!.id, catalog().sessions[kept!.id]!.revision).ok).toBe(true)
    runApply(CYGNUS)
    expect(project(CYGNUS).view!.inputs.map((i) => i.sessionId)).toEqual(expect.arrayContaining([kept!.id]))
    expect(project(CYGNUS).view!.inputs.some((i) => i.sessionId === removed!.id || i.sessionId === session.id)).toBe(false)
    const placed = placedFrames(CYGNUS)
    for (const id of framesIn(project(CYGNUS).inputs.find((i) => i.sessionId === kept!.id)!)) expect(placed.has(id)).toBe(true)
    for (const id of removed!.assetIds) expect(placed.has(id)).toBe(false)
    expect(pendingChanges(store.getState(), project(CYGNUS))).toEqual([])
  })
  it("joins a corrected successor into a matching session and labels Projects holding either", () => {
    const { session, open } = heldTwice()
    const target = matchingSession(session, byCapture(session).slice(-1)[0]!)
    const corrected = byCapture(session).slice(-1)
    expect(target.exposureS).toBe(session.exposureS * 2)
    expect(target.channel).toBe(session.channel)
    expect(target.night).toBe(session.night)
    expect(catalog().assets[target.assetIds[0]!]!.observed.ra).toBe(catalog().assets[corrected[0]!]!.observed.ra)
    const originalInput = structuredClone(project(CYGNUS).inputs.find((input) => input.sessionId === session.id)!)
    const targetInput: ProjectInput = { ...originalInput, sessionId: target.id }
    const targetOnly: Project = {
      ...structuredClone(project(CYGNUS)),
      id: `${CYGNUS}_target_only` as Project["id"],
      name: "Target only",
      inputs: [targetInput],
      view: { ...project(CYGNUS).view!, inputs: [targetInput], calibration: { [target.id]: structuredClone(target.calibration!) }, entries: project(CYGNUS).view!.entries.filter((entry) => entry.source.type === "asset" && target.assetIds.includes(entry.source.assetId)) },
    }
    store.setState((state) => ({ ...state, catalog: { ...state.catalog, projects: { ...state.catalog.projects, [targetOnly.id]: targetOnly } } }))

    expect(correctExposure(session, corrected).ok).toBe(true)
    const joined = successorsOf(session.id).find((successor) => successor.previousSessionIds.includes(target.id))!
    expect(joined.assetIds).toContain(corrected[0])
    expect(joined.previousSessionIds).toEqual(expect.arrayContaining([session.id, target.id]))
    expect(joined.reviewReset).toBe(true)
    expect(catalog().sessions[session.id]!.supersededBy).toBe(joined.id)
    expect(catalog().sessions[target.id]!.supersededBy).toBe(joined.id)
    expect(sessionReadiness(catalog(), joined)).toBe("needs-review")
    for (const id of open) {
      expect(project(id).inputs.some((input) => input.sessionId === joined.id)).toBe(true)
      expect(pendingChanges(store.getState(), project(id))).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: joined.id, from: session.id, source: "library", kind: "session-resplit" })]))
      expect(notReady(id)).toEqual([{ kind: "not-ready", sessions: expect.arrayContaining([expect.objectContaining({ id: joined.id })]) }])
    }
    expect(project(targetOnly.id).inputs.some((input) => input.sessionId === joined.id)).toBe(true)
    expect(pendingChanges(store.getState(), project(targetOnly.id))).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: joined.id, from: target.id, source: "library", kind: "session-resplit" })]))
    expect(notReady(targetOnly.id)).toEqual([{ kind: "not-ready", sessions: expect.arrayContaining([expect.objectContaining({ id: joined.id })]) }])
  })
})
