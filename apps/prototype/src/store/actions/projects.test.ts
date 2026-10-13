import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { goalProgress, type GoalProgress, planningSite } from "@/domain/derive"
import { upcomingNight } from "@/domain/planning"
import { createSeed } from "@/domain/seed"
import { BUILT_IN_GOAL_TEMPLATES, DEFAULT_SUBJECT_CONDITIONS, qualityBarFor } from "@/domain/templates"
import type { Asset, Project, Session } from "@/domain/types"
import { nowIso, type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { markFrames } from "./library"
import { applyGoalTemplate, closingOnSuccess, createProject, recordWrapUpStep, reopenProject } from "./projects"
import { saveGoalTemplate } from "./settings"

// Goal conditions in the store (C7): Close freezes the goal figures, Reopen makes them live, templates carry conditions.
const M31 = "prj_m31"
const CYGNUS = "prj_cygnus"
const HOO_MOSAIC = "gtpl_user_hoo_mosaic"

let demo: PrototypeState
beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

const project = (id: string): Project => store.getState().catalog.projects[id]!
const progress = (id: string): GoalProgress[] => goalProgress(store.getState().catalog, project(id))
/** What the live library gives the Project, whatever its state. */
const live = (id: string): GoalProgress[] => goalProgress(store.getState().catalog, { ...project(id), state: "open", goalFreeze: null })
const figures = (list: GoalProgress[]) => list.map((p) => ({ goal: p.goal.id, inProject: p.inProject, captured: p.captured, belowBar: p.belowBar, met: p.met }))
const byGoal = (list: GoalProgress[], id: string) => list.find((p) => p.goal.id === id)!

/** M 31's frames of one channel in its run. */
function m31Frames(channel: string): string[] {
  const { catalog } = store.getState()
  return catalog.runs.run_m31!.revisions.at(-1)!.included.filter((id) => catalog.sessions[catalog.assets[id]!.sessionId!]!.channel === channel)
}

/** A later night of M 31 R lands in the library: a copy of the R session with new frames. */
function laterRFrames(): number {
  store.setState((s) => {
    const source = Object.values(s.catalog.sessions).find((x) => x.assetIds.includes(m31Frames("R")[0]!))!
    const sessionId = `${source.id}_later`
    const assets: Record<string, Asset> = {}
    for (const id of source.assetIds) assets[`${id}_later`] = { ...s.catalog.assets[id]!, id: `${id}_later`, sessionId }
    const session: Session = { ...source, id: sessionId, assetIds: Object.keys(assets) }
    return { ...s, catalog: { ...s.catalog, sessions: { ...s.catalog.sessions, [sessionId]: session }, assets: { ...s.catalog.assets, ...assets } } }
  })
  return m31Frames("R").length
}

/** Close M 31 the way Wrap up does: Trash skipped, then Archive with nothing to move (Close project). */
function closeM31() {
  expect(recordWrapUpStep(M31, "trash", { kind: "skipped" }).ok).toBe(true)
  expect(recordWrapUpStep(M31, "archive", { kind: "skipped" }).ok).toBe(true)
}

describe("Close freezes the goal figures (C7)", () => {
  it("keeps the figures from Close while later frames arrive and marks change", () => {
    const before = figures(progress(M31))
    closeM31()
    const closed = project(M31)
    expect(closed.state).toBe("done")
    expect(closed.goalFreeze?.at).toBe(closed.doneAt)
    expect(closed.goalFreeze?.goals.map((g) => g.goalId)).toEqual(closed.goals.map((g) => g.id))

    const added = laterRFrames()
    expect(markFrames(m31Frames("G"), "unusable", `/projects/${M31}`).ok).toBe(true)

    expect(progress(M31).every((p) => p.frozen)).toBe(true)
    expect(figures(progress(M31))).toEqual(before)
    // The live library has moved on: the frozen figures are not what it would give now.
    expect(byGoal(live(M31), "goal_m31_r").captured.frames).toBe(byGoal(progress(M31), "goal_m31_r").captured.frames + added)
    expect(byGoal(live(M31), "goal_m31_g").inProject.frames).toBe(0)
  })

  it("freezes when the Close project transfer succeeds", () => {
    const before = figures(progress(M31))
    expect(recordWrapUpStep(M31, "trash", { kind: "skipped" }).ok).toBe(true)
    const opId = "op_test_close_transfer"
    store.setState((s) => ({ ...s, operations: { ...s.operations, [opId]: { ...s.operations.op_cleanup_m31!, id: opId, kind: "archive", status: "running" } } }))
    expect(recordWrapUpStep(M31, "archive", { kind: "started", operationIds: [opId] }).ok).toBe(true)
    expect(project(M31).state).toBe("open")
    const transfer = closingOnSuccess({ kind: "archive", step: (s, op) => ({ ...s, operations: { ...s.operations, [op.id]: { ...op, status: "succeeded" } } }) })
    store.setState((s) => transfer.step(s, s.operations[opId]!))
    expect(project(M31).state).toBe("done")
    expect(project(M31).goalFreeze?.at).toBe(project(M31).doneAt)
    expect(markFrames(m31Frames("B"), "unusable", `/projects/${M31}`).ok).toBe(true)
    expect(figures(progress(M31))).toEqual(before)
  })

  it("refuses goal and template edits while closed", () => {
    closeM31()
    expect(applyGoalTemplate(M31, BUILT_IN_GOAL_TEMPLATES[0]!.id, project(M31).revision).ok).toBe(false)
  })
})

describe("Reopen makes the goal figures live again (C7)", () => {
  it("reads the library as it is now", () => {
    closeM31()
    const added = laterRFrames()
    expect(markFrames(m31Frames("G"), "unusable", `/projects/${M31}`).ok).toBe(true)
    const frozenR = byGoal(progress(M31), "goal_m31_r").captured.frames
    expect(reopenProject(M31).ok).toBe(true)
    expect(project(M31)).toMatchObject({ state: "open", doneAt: null, goalFreeze: null })
    expect(progress(M31).some((p) => p.frozen)).toBe(false)
    expect(byGoal(progress(M31), "goal_m31_r").captured.frames).toBe(frozenR + added)
    expect(byGoal(progress(M31), "goal_m31_g")).toMatchObject({ met: false, inProject: { frames: 0, seconds: 0 } })
  })

  it("freezes afresh at the next Close", () => {
    closeM31()
    expect(reopenProject(M31).ok).toBe(true)
    expect(markFrames(m31Frames("G"), "unusable", `/projects/${M31}`).ok).toBe(true)
    const reopened = figures(progress(M31))
    // After Reopen, Archive reads To do again: Close project closes it once more.
    expect(recordWrapUpStep(M31, "archive", { kind: "skipped" }).ok).toBe(true)
    expect(project(M31).state).toBe("done")
    expect(figures(progress(M31))).toEqual(reopened)
  })
})

describe("applying a goal template copies its conditions (C7)", () => {
  const tonight = () => upcomingNight(planningSite(store.getState())!, Date.parse(nowIso()))

  it("gives every subject the template's panel balance and a season pre-filled from its visibility", () => {
    expect(applyGoalTemplate(CYGNUS, HOO_MOSAIC, project(CYGNUS).revision).ok).toBe(true)
    const subjects = project(CYGNUS).subjects
    expect(subjects.map((s) => s.conditions?.panelBalancePct)).toEqual([15, 15])
    for (const s of subjects) expect(s.conditions?.window).toMatchObject({ kind: "season", from: tonight() })
    expect(project(CYGNUS).goals.every((g) => g.integrationS === 4 * 3600 && g.qualityBar?.kind === "usable-max-fwhm")).toBe(true)
  })

  it("copies a Finish by night, and a built-in template's defaults", () => {
    const { id } = saveGoalTemplate({ id: null, name: "Autumn", values: [{ channel: "Ha", integrationS: 3600, frameCount: null, qualityBar: qualityBarFor(null) }], conditions: { panelBalancePct: 20, window: { kind: "finish-by", night: "2026-12-31" } } })
    expect(applyGoalTemplate(CYGNUS, id, project(CYGNUS).revision).ok).toBe(true)
    expect(project(CYGNUS).subjects.map((s) => s.conditions)).toEqual([0, 1].map(() => ({ panelBalancePct: 20, window: { kind: "finish-by", night: "2026-12-31" } })))
    expect(applyGoalTemplate(CYGNUS, BUILT_IN_GOAL_TEMPLATES[0]!.id, project(CYGNUS).revision).ok).toBe(true)
    expect(project(CYGNUS).subjects.map((s) => s.conditions)).toEqual([DEFAULT_SUBJECT_CONDITIONS, DEFAULT_SUBJECT_CONDITIONS])
  })

  it("gives a new Project's subjects the conditions of the template its goals came from", () => {
    const template = store.getState().catalog.goalTemplates[HOO_MOSAIC]!
    const targetId = project(CYGNUS).subjects[0]!.targetId
    const input = { name: "Autumn HOO", notes: "", subjects: [{ targetId, mosaic: null }], rigIds: project(CYGNUS).rigIds, goals: template.values }
    const withTemplate = createProject({ ...input, templateId: HOO_MOSAIC })
    expect(withTemplate.result.ok).toBe(true)
    expect(project(withTemplate.projectId).subjects[0]!.conditions).toMatchObject({ panelBalancePct: 15, window: { kind: "season", from: tonight() } })
    const typedIn = createProject({ ...input, name: "Typed HOO" })
    expect(project(typedIn.projectId).subjects[0]!.conditions).toBeUndefined()
  })

  it("keeps a template's conditions when an editor saves only its values", () => {
    const template = store.getState().catalog.goalTemplates[HOO_MOSAIC]!
    expect(saveGoalTemplate({ id: HOO_MOSAIC, name: template.name, values: template.values.slice(0, 1) }).result.ok).toBe(true)
    expect(store.getState().catalog.goalTemplates[HOO_MOSAIC]!.conditions).toEqual({ panelBalancePct: 15, window: { kind: "season" } })
  })
})
