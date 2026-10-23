import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { canJoinProject, goalProgress, type GoalProgress, isLocked, planningSite, projectGoalSet, projectSessionIds, sessionTargetId } from "@/domain/derive"
import { openWork } from "@/domain/home"
import { upcomingNight } from "@/domain/planning"
import { projectNext } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import { BUILT_IN_GOAL_TEMPLATES, DEFAULT_SUBJECT_CONDITIONS, qualityBarFor } from "@/domain/templates"
import type { Asset, Goal, Project, Session } from "@/domain/types"
import { m, msg, say } from "@/lib/i18n"
import { type CommitResult, nowIso, type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { markFrames } from "./library"
import { discardChanges, startApply } from "./project-view"
import * as projects from "./projects"
import { saveGoalTemplate } from "./settings"

const { addSessions, applyGoalTemplate, closingOnSuccess, createProject, recordWrapUpStep, renameGroup, reopenWrapUpStep, setGoals, setProjectSettings } = projects

// Goal conditions in the store (C7): Close freezes the goal figures and there is no Reopen; templates carry conditions.
const M31 = "prj_m31"
const CYGNUS = "prj_cygnus"
const HOO_MOSAIC = "gtpl_user_hoo_mosaic"

// A template's season starts on the first night its subject is visible from tonight, and the seed's Cygnus subjects
// are autumn targets: freeze Date on the seed's own day, so "the season starts tonight" holds in any month.
const SEED_DAY = Date.parse("2026-10-13T12:00:00Z")
let demo: PrototypeState
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(SEED_DAY)
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
afterAll(() => {
  vi.useRealTimers()
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

const project = (id: string): Project => store.getState().catalog.projects[id]!
const progress = (id: string): GoalProgress[] => goalProgress(store.getState().catalog, project(id))
/** What the live library gives the Project, whatever its state. */
const live = (id: string): GoalProgress[] => goalProgress(store.getState().catalog, { ...project(id), state: "open", snapshot: null })
const figures = (list: GoalProgress[]) => list.map((p) => ({ goal: p.goal.id, inProject: p.inProject, captured: p.captured, belowBar: p.belowBar, met: p.met }))
const byGoal = (list: GoalProgress[], id: string) => list.find((p) => p.goal.id === id)!
const refusedReasons = (result: CommitResult): string[] => {
  if (result.ok || result.reason !== "refused") throw new Error(`expected a refusal, got ${JSON.stringify(result)}`)
  return result.reasons
}

/** M 31's frames of one channel among the sessions it holds. */
function m31Frames(channel: string): string[] {
  const { catalog } = store.getState()
  return project(M31).inputs.flatMap((input) => {
    const session = catalog.sessions[input.sessionId]!
    return session.channel === channel ? session.assetIds : []
  })
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
    expect(closed.state).toBe("closed")
    expect(closed.snapshot?.at).toBe(closed.closedAt)
    expect(closed.snapshot?.goals.map((g) => g.goalId)).toEqual(closed.goals.map((g) => g.id))

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
    expect(project(M31).state).toBe("closed")
    expect(project(M31).snapshot?.at).toBe(project(M31).closedAt)
    expect(markFrames(m31Frames("B"), "unusable", `/projects/${M31}`).ok).toBe(true)
    expect(figures(progress(M31))).toEqual(before)
  })

  it("freezes the calibration each held session used, so a later reassignment never reaches the Closed Project", () => {
    closeM31()
    const closed = project(M31)
    expect(Object.keys(closed.snapshot!.calibration).sort()).toEqual([...new Set(closed.inputs.map((i) => i.sessionId))].sort())
    for (const input of closed.inputs) expect(closed.snapshot!.calibration[input.sessionId]).toEqual(store.getState().catalog.sessions[input.sessionId]!.calibration)
  })
})

describe("there is no Reopen: a Closed Project is locked for good (PRJ-FR-25)", () => {
  it("offers no Reopen and stays locked", () => {
    expect("reopenProject" in projects).toBe(false)
    closeM31()
    expect(isLocked(project(M31))).toBe(true)
  })

  it("refuses every edit, Apply, Discard and Wrap up step, naming the Closed Project, and writes nothing", () => {
    closeM31()
    const closed = project(M31)
    const named = say(m, msg("store_reason_project_closed", { project: closed.name }))
    const session = Object.values(store.getState().catalog.sessions).find((s) => s.imageType === "light" && !closed.inputs.some((i) => i.sessionId === s.id))!
    const writes: CommitResult[] = [
      setGoals(M31, [], closed.revision),
      applyGoalTemplate(M31, BUILT_IN_GOAL_TEMPLATES[0]!.id, closed.revision),
      addSessions(M31, [session.id]),
      setProjectSettings(M31, { mode: "symlink" }),
      renameGroup(M31, closed.groups[0]!.id, "Renamed"),
      startApply(M31, { fingerprint: "", tickedUnplaced: [] }).result,
      discardChanges(M31, "all"),
      reopenWrapUpStep(M31, "trash"),
      recordWrapUpStep(M31, "archive", { kind: "skipped" }),
    ]
    for (const result of writes) expect(refusedReasons(result)).toContain(named)
    expect(project(M31)).toEqual(closed)
  })
})

describe("Project keyword overrides (PRJ-FR-28)", () => {
  it("refuses keyword names that cannot name View folders and saves valid ones", () => {
    expect(refusedReasons(setProjectSettings(CYGNUS, { keywords: { group: "GROUP", panel: "group" } }))).toEqual([
      m.settings_keyword_same({ kind: m.common_mosaic_panel(), name: "GROUP" }),
      m.settings_keyword_same({ kind: m.naming_keyword_group(), name: "group" }),
    ])
    expect(refusedReasons(setProjectSettings(CYGNUS, { keywords: { group: "RIG_SET", panel: "TILE" } }))).toEqual([m.settings_keyword_underscore({ name: "RIG_SET" })])
    expect(project(CYGNUS).settings.keywords).toBeNull()
    expect(setProjectSettings(CYGNUS, { keywords: { group: "RIG-SET", panel: "TILE" } }).ok).toBe(true)
    expect(project(CYGNUS).settings.keywords).toEqual({ group: "RIG-SET", panel: "TILE" })
  })
})

describe("a removed subject's goals stay hidden until it comes back (D-W128)", () => {
  const MOSAIC = "prj_ic5070"
  const now = () => Date.parse(nowIso())
  const next = (id: string) => projectNext(store.getState(), project(id), now())?.label ?? null
  const WRAP_UP = msg("wrapup_action")
  const openGoals = (id: string) => {
    const row = openWork(store.getState(), now(), "2026-10-13").find((r) => r.kind === "project" && r.project.id === id)
    return row?.kind === "project" ? row.goals.total : null
  }
  const goalsOf = (id: string, targetId: string) => {
    const subject = project(id).subjects.find((s) => s.targetId === targetId)
    return project(id).goals.filter((g) => g.subjectId === subject?.id)
  }
  /** The goals as kept: everything but the subject id, which a subject added back changes. */
  const kept = (goals: Goal[]) => goals.map(({ subjectId: _, ...goal }) => goal)
  const remove = (id: string, targetId: string) => projects.removeSubject(id, project(id).subjects.find((s) => s.targetId === targetId)!.id, project(id).revision)

  /** IC 5070's Target joins M 31 as a subject with goals from M 31's goal set, each then edited to an hour more. */
  function editedSecondSubject(): { targetId: string; edited: Goal[] } {
    const targetId = project(MOSAIC).subjects[0]!.targetId
    expect(projects.addSubject(M31, targetId, project(M31).revision).ok).toBe(true)
    const ids = new Set(goalsOf(M31, targetId).map((g) => g.id))
    expect(ids.size).toBeGreaterThan(0)
    expect(setGoals(M31, project(M31).goals.map((g) => (ids.has(g.id) ? { ...g, integrationS: (g.integrationS ?? 0) + 3600 } : g)), project(M31).revision).ok).toBe(true)
    return { targetId, edited: goalsOf(M31, targetId) }
  }

  it("counts them in no Project progress, Home Open work or Next step, and changes no session", () => {
    // M 31's own goals all met, so its Next is Wrap up while only they count.
    expect(setGoals(M31, project(M31).goals.map((g) => (g.id === "goal_m31_l" ? { ...g, integrationS: 60 } : g)), project(M31).revision).ok).toBe(true)
    expect(progress(M31).every((p) => p.met)).toBe(true)
    expect(next(M31)).toEqual(WRAP_UP)
    const own = { progress: progress(M31).length, open: openGoals(M31)!, inputs: project(M31).inputs }

    const { targetId, edited } = editedSecondSubject()
    expect(progress(M31)).toHaveLength(own.progress + edited.length)
    expect(openGoals(M31)).toBe(own.open + edited.length)
    expect(next(M31)).not.toEqual(WRAP_UP)

    expect(remove(M31, targetId).ok).toBe(true)
    const hidden = new Set(edited.map((g) => g.id))
    expect(project(M31).goals.some((g) => hidden.has(g.id))).toBe(false)
    expect(progress(M31).some((p) => hidden.has(p.goal.id))).toBe(false)
    expect(progress(M31)).toHaveLength(own.progress)
    expect(openGoals(M31)).toBe(own.open)
    expect(next(M31)).toEqual(WRAP_UP)
    expect(project(M31).inputs).toEqual(own.inputs)
    expect(project(M31).hiddenGoals?.map((g) => g.id)).toEqual(edited.map((g) => g.id))
  })

  it("restores the edited goals, not the template's, when added back as a subject or through one of its sessions", () => {
    const { targetId, edited } = editedSecondSubject()
    const inputs = project(M31).inputs
    const template = projectGoalSet(project(M31)).map((v) => v.integrationS)
    expect(edited.map((g) => g.integrationS)).not.toEqual(template)

    expect(remove(M31, targetId).ok).toBe(true)
    expect(projects.addSubject(M31, targetId, project(M31).revision).ok).toBe(true)
    expect(kept(goalsOf(M31, targetId))).toEqual(kept(edited))
    expect(project(M31).hiddenGoals).toEqual([])
    expect(project(M31).inputs).toEqual(inputs)

    expect(remove(M31, targetId).ok).toBe(true)
    const { catalog } = store.getState()
    const held = projectSessionIds(project(M31))
    const session = Object.values(catalog.sessions).find((s) => sessionTargetId(s) === targetId && !held.has(s.id) && canJoinProject(catalog, s))!
    expect(projects.addSessionToProject(session.id, M31).result.ok).toBe(true)
    expect(kept(goalsOf(M31, targetId))).toEqual(kept(edited))
    expect(project(M31).hiddenGoals).toEqual([])
  })

  it("drops a kept panel goal whose group is gone or no longer a panel when its subject comes back", () => {
    const targetId = project(MOSAIC).subjects[0]!.targetId
    const [p1, p2] = project(MOSAIC).groups
    const created = projects.createGroup(MOSAIC, "Panel 4", false)
    const p4 = created.groupId!
    expect(projects.setGroupPanel(MOSAIC, p4, true).ok).toBe(true)
    expect(setGoals(MOSAIC, project(MOSAIC).goals.map((g) => (g.groupId === p2!.id && g.channel === "Ha" ? { ...g, integrationS: 7 * 3600 } : g)), project(MOSAIC).revision).ok).toBe(true)
    const before = project(MOSAIC).goals
    expect(before.some((g) => g.groupId === p4)).toBe(true)

    expect(remove(MOSAIC, targetId).ok).toBe(true)
    expect(project(MOSAIC).goals).toEqual([])
    expect(projects.setGroupPanel(MOSAIC, p1!.id, false).ok).toBe(true)
    expect(projects.removeGroup(MOSAIC, p4).ok).toBe(true)
    expect(projects.addSubject(MOSAIC, targetId, project(MOSAIC).revision).ok).toBe(true)
    expect(kept(goalsOf(MOSAIC, targetId))).toEqual(kept(before.filter((g) => g.groupId !== p1!.id && g.groupId !== p4)))
    expect(project(MOSAIC).hiddenGoals).toEqual([])
  })

  it("restores them onto a subject re-pointed at their Target; the goals they replace are kept hidden under the old Target (owner, 2026-10-20)", () => {
    const { targetId, edited } = editedSecondSubject()
    expect(remove(M31, targetId).ok).toBe(true)
    const own = project(M31).subjects[0]!
    // An Ha goal no restored goal replaces: it stays on the subject.
    const ha: Goal = { id: "goal_m31_ha", subjectId: own.id, groupId: null, channel: "Ha", integrationS: 3600, frameCount: null, qualityBar: null }
    expect(setGoals(M31, [...project(M31).goals, ha], project(M31).revision).ok).toBe(true)
    const replaced = project(M31).goals.filter((g) => g.id !== ha.id)
    const inputs = project(M31).inputs

    expect(projects.changeSubjectTarget(M31, own.id, targetId, project(M31).revision).ok).toBe(true)
    expect(project(M31).subjects).toHaveLength(1)
    expect(goalsOf(M31, targetId)).toEqual([ha, ...edited.map((g) => ({ ...g, subjectId: own.id }))])
    expect(project(M31).hiddenGoals).toEqual(replaced.map(({ subjectId: _, ...g }) => ({ ...g, targetId: own.targetId })))
    expect(project(M31).inputs).toEqual(inputs)

    // M 31's Target added back gets the replaced goals, not the goal set's.
    expect(projects.addSubject(M31, own.targetId, project(M31).revision).ok).toBe(true)
    expect(kept(goalsOf(M31, own.targetId))).toEqual(kept(replaced))
    expect(project(M31).hiddenGoals).toEqual([])
  })
})

describe("applying a goal template copies its conditions (C7)", () => {
  const tonight = () => upcomingNight(planningSite(store.getState())!, Date.parse(nowIso()))

  it("gives every subject the template's panel balance and a season pre-filled from its visibility", () => {
    expect(applyGoalTemplate(CYGNUS, HOO_MOSAIC, project(CYGNUS).revision).ok).toBe(true)
    const subjects = project(CYGNUS).subjects
    expect(subjects.map((s) => s.conditions?.panelBalancePct)).toEqual(subjects.map(() => 15))
    for (const s of subjects) expect(s.conditions?.window).toMatchObject({ kind: "season", from: tonight() })
    expect(project(CYGNUS).goals.every((g) => g.integrationS === 4 * 3600 && g.qualityBar?.kind === "usable-max-fwhm")).toBe(true)
  })

  it("copies a Finish by night, and a built-in template's defaults", () => {
    const { id } = saveGoalTemplate({ id: null, name: "Autumn", values: [{ channel: "Ha", integrationS: 3600, frameCount: null, qualityBar: qualityBarFor(null) }], conditions: { panelBalancePct: 20, window: { kind: "finish-by", night: "2026-12-31" } } })
    expect(applyGoalTemplate(CYGNUS, id, project(CYGNUS).revision).ok).toBe(true)
    const subjects = project(CYGNUS).subjects
    expect(subjects.map((s) => s.conditions)).toEqual(subjects.map(() => ({ panelBalancePct: 20, window: { kind: "finish-by", night: "2026-12-31" } })))
    expect(applyGoalTemplate(CYGNUS, BUILT_IN_GOAL_TEMPLATES[0]!.id, project(CYGNUS).revision).ok).toBe(true)
    expect(project(CYGNUS).subjects.map((s) => s.conditions)).toEqual(subjects.map(() => DEFAULT_SUBJECT_CONDITIONS))
  })

  it("gives a new Project's subjects the conditions of the template its goals came from", () => {
    const template = store.getState().catalog.goalTemplates[HOO_MOSAIC]!
    const targetId = project(CYGNUS).subjects[0]!.targetId
    const input = { name: "Autumn HOO", notes: "", subjects: [targetId], rigIds: project(CYGNUS).rigIds, goals: template.values }
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
