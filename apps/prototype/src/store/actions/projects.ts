/**
 * Project writes shared by every screen (foundation-owned). Each durable
 * change goes through `commit()` (D08); a Project edit writes only catalog
 * Project records and never changes files, runs or quality (PRJ-FR-05).
 * Wrap up (C3, D4) records each step when Proceed starts its work and reads
 * it Finished once that work succeeds (`wrapUpFlowState`); Close project
 * closes the Project when its Archive transfer succeeds (`closingOnSuccess`).
 */
import { markDoneBlockers, projectGoalSet, rigName, rigRef, sessionRigId, sessionTargetId, subjectName, wrapUpFlowState } from "@/domain/derive"
import { WRAP_UP_NAME, WRAP_UP_STEPS } from "@/domain/labels"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import type {
  Catalog,
  Goal,
  GoalTemplate,
  GoalTemplateId,
  GoalTemplateValue,
  LocationId,
  OperationId,
  OpticalTrainId,
  Project,
  ProjectId,
  Run,
  SessionId,
  Subject,
  TargetId,
  WrapUpStepId,
  WrapUpStepRecord,
} from "@/domain/types"
import { joinRefs, m, type MessageRef, msg } from "@/lib/i18n"
import { type CommitResult, commit, nowIso, type PrototypeState, store, withCatalog } from "@/store/core"
import type { OperationHandler } from "@/store/operations"
import { closedRefusal, freshId, MISSING, recordSaved, refuse, refuseWithGate } from "./shared"

const projectHref = (id: ProjectId) => `/projects/${id}`

/** "<run> uses it": each run that holds a subject or rig a removal would take away (D-W65). */
const usesIt = (runs: Run[]): MessageRef[] => runs.map((r) => msg("store_reason_run_uses_it", { name: r.name }))

/** A built-in or user goal template by id. */
export function goalTemplate(id: GoalTemplateId | null): GoalTemplate | undefined {
  if (!id) return undefined
  return BUILT_IN_GOAL_TEMPLATES.find((t) => t.id === id) ?? store.getState().catalog.goalTemplates[id]
}

/** Goals from template values for one subject: per channel, and per panel for a mosaic (D-W29, D-W30). Every goal kind is copied. */
export function goalsFromValues(values: GoalTemplateValue[], subject: Subject): Goal[] {
  const panels = subject.mosaic ? subject.mosaic.panels.map((p) => p.id) : [null]
  return panels.flatMap((panelId) =>
    values.map((value) => ({
      id: freshId("goal", `${subject.id}|${panelId}|${value.channel}`),
      subjectId: subject.id,
      panelId,
      channel: value.channel,
      integrationS: value.integrationS,
      frameCount: value.frameCount,
      qualityBar: value.qualityBar,
    })),
  )
}

/** Goals from a template for one subject (`goalsFromValues` over its values). */
export function goalsFromTemplate(template: GoalTemplate | undefined, subject: Subject): Goal[] {
  return template ? goalsFromValues(template.values, subject) : []
}

export interface SubjectInput {
  targetId: TargetId
  mosaic: Subject["mosaic"]
}

export interface NewProjectInput {
  name: string
  notes: string
  subjects: SubjectInput[]
  rigIds: OpticalTrainId[]
  /** Goal values per channel, typed in or prefilled from a template; copied once, so the Project keeps no link to a template (D-W30). */
  goals: GoalTemplateValue[]
}

/** New Project (PRJ-FR-01): name, subjects, rigs and optional goals. Creates no run. */
export function createProject(input: NewProjectInput): { result: CommitResult; projectId: ProjectId } {
  const id = freshId("prj", input.name)
  const subjects: Subject[] = input.subjects.map((s) => ({ id: freshId("sub", s.targetId), targetId: s.targetId, mosaic: s.mosaic }))
  const project: Project = {
    id,
    name: input.name.trim(),
    notes: input.notes,
    subjects,
    rigIds: [...new Set(input.rigIds)],
    goals: subjects.flatMap((s) => goalsFromValues(input.goals, s)),
    archiveLocationId: null,
    wrapUp: {},
    state: "open",
    doneAt: null,
    archive: null,
    createdAt: nowIso(),
    revision: 1,
  }
  const result = commit(msg("store_label_create", { name: project.name }), (s) => withCatalog(s, (c) => ({ ...c, projects: { ...c.projects, [id]: project } })), { href: projectHref(id) })
  if (result.ok) recordSaved(msg("store_saved_project_created", { name: project.name }), joinRefs([msg("project_subjects_count", { count: subjects.length }), msg("project_rigs_count", { count: project.rigIds.length })], " · "), projectHref(id))
  return { result, projectId: id }
}

/** Commit one Project patch, guarded by its revision; only Reopen writes a closed Project, the rest go through `editProject`. */
function writeProject(projectId: ProjectId, label: MessageRef, expectRevision: number, update: (project: Project) => Project): CommitResult {
  const project = store.getState().catalog.projects[projectId]
  if (!project) return MISSING
  const result = commit(
    label,
    (s) => withCatalog(s, (c) => ({ ...c, projects: { ...c.projects, [projectId]: update(c.projects[projectId]!) } })),
    { expect: { collection: "projects", id: projectId, revision: expectRevision }, href: projectHref(projectId) },
  )
  if (result.ok) recordSaved(msg("store_saved_label_name", { label, name: project.name }), null, projectHref(projectId))
  return result
}

/** A Project edit: refused while the Project is closed (`closedRefusal`). */
function editProject(projectId: ProjectId, label: MessageRef, expectRevision: number, update: (project: Project) => Project): CommitResult {
  return closedRefusal(store.getState().catalog.projects[projectId], label) ?? writeProject(projectId, label, expectRevision, update)
}

/** Edit details (round 6): name and notes; a Project always keeps a name. */
export function updateProjectDetails(projectId: ProjectId, details: { name: string; notes: string }, expectRevision: number): CommitResult {
  const label = msg("store_label_project_details")
  if (!details.name.trim()) return refuse(msg("store_refused", { label }), [msg("store_reason_name_empty")], projectHref(projectId))
  return editProject(projectId, label, expectRevision, (p) => ({ ...p, name: details.name.trim(), notes: details.notes }))
}

/** Add a subject, with goals copied from the Project's goal set (`projectGoalSet`). */
export function addSubject(projectId: ProjectId, input: SubjectInput, expectRevision: number): CommitResult {
  const subject: Subject = { id: freshId("sub", input.targetId), targetId: input.targetId, mosaic: input.mosaic }
  return editProject(projectId, msg("store_label_add_subject"), expectRevision, (p) =>
    p.subjects.some((s) => s.targetId === input.targetId) ? p : { ...p, subjects: [...p.subjects, subject], goals: [...p.goals, ...goalsFromValues(projectGoalSet(p), subject)] },
  )
}

/** Runs of the Project that hold the subject, the Trash included (a restored run needs its subject). */
function subjectRuns(catalog: Catalog, projectId: ProjectId, subjectId: string): Run[] {
  return Object.values(catalog.runs).filter((r) => r.projectId === projectId && r.subjectId === subjectId)
}

/** Edit: point the subject at another Target; its goals stay. Refused while any run uses the subject (D-W65) or the Target is already a subject. */
export function changeSubjectTarget(projectId: ProjectId, subjectId: string, targetId: TargetId, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const project = catalog.projects[projectId]
  if (!project) return MISSING
  const label = msg("store_label_edit_subject")
  const users = subjectRuns(catalog, projectId, subjectId)
  if (users.length > 0) return refuse(msg("store_refused", { label }), usesIt(users), projectHref(projectId))
  const taken = project.subjects.find((s) => s.id !== subjectId && s.targetId === targetId)
  if (taken) return refuse(msg("store_refused", { label }), [msg("store_reason_already_subject", { name: subjectName(m, catalog, taken) })], projectHref(projectId))
  return editProject(projectId, label, expectRevision, (p) => ({ ...p, subjects: p.subjects.map((s) => (s.id === subjectId ? { ...s, targetId } : s)) }))
}

/** Refused while any run uses the subject; the refusal names each run (D-W65). */
export function removeSubject(projectId: ProjectId, subjectId: string, expectRevision: number): CommitResult {
  const users = subjectRuns(store.getState().catalog, projectId, subjectId)
  const label = msg("store_label_remove_subject")
  if (users.length > 0) return refuse(msg("store_refused", { label }), usesIt(users), projectHref(projectId))
  return editProject(projectId, label, expectRevision, (p) => ({ ...p, subjects: p.subjects.filter((s) => s.id !== subjectId), goals: p.goals.filter((g) => g.subjectId !== subjectId) }))
}

/**
 * Set a subject's mosaic panels (D-W38, D-W73): a Target subject becomes a
 * mosaic, or panels are added or removed. New panels get the Project's goal
 * set; a removed panel's goals go. Refused while a run uses a removed panel,
 * or a plain run uses a subject that would become a mosaic.
 */
export function setSubjectMosaic(projectId: ProjectId, subjectId: string, mosaic: NonNullable<Subject["mosaic"]>, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const project = catalog.projects[projectId]
  const subject = project?.subjects.find((s) => s.id === subjectId)
  if (!project || !subject) return MISSING
  const kept = new Set(mosaic.panels.map((p) => p.id))
  const users = Object.values(catalog.runs).filter((r) => r.projectId === projectId && r.subjectId === subjectId && (r.panelId === null || !kept.has(r.panelId)))
  const label = msg("rungroup_panels_label", { name: mosaic.name })
  if (users.length > 0) return refuse(msg("store_refused", { label }), usesIt(users), projectHref(projectId))
  const before = new Set(subject.mosaic?.panels.map((p) => p.id) ?? [])
  const added = mosaic.panels.filter((p) => !before.has(p.id))
  return editProject(projectId, label, expectRevision, (p) => ({
    ...p,
    subjects: p.subjects.map((s) => (s.id === subjectId ? { ...s, mosaic } : s)),
    goals: [
      ...p.goals.filter((g) => g.subjectId !== subjectId || (g.panelId !== null && kept.has(g.panelId))),
      ...goalsFromValues(projectGoalSet(p), { ...subject, mosaic: { ...mosaic, panels: added } }),
    ],
  }))
}

/** Adding a rig changes candidates only, never a run's membership (PRJ-FR-02). */
export function addRig(projectId: ProjectId, rigId: OpticalTrainId, expectRevision: number): CommitResult {
  return editProject(projectId, msg("project_add_rig"), expectRevision, (p) => (p.rigIds.includes(rigId) ? p : { ...p, rigIds: [...p.rigIds, rigId] }))
}

/** Runs of the Project on the rig, the Trash included (a restored run needs its rig): while any exist the rig cannot be removed. */
export function rigRuns(catalog: Catalog, projectId: ProjectId, rigId: OpticalTrainId): Run[] {
  return Object.values(catalog.runs).filter((r) => r.projectId === projectId && r.rigId === rigId)
}

/** Refused while any run uses the rig (`rigRuns`); the refusal names each run (D-W65, PRJ-FR-02). Candidates change, no file or run does. */
export function removeRig(projectId: ProjectId, rigId: OpticalTrainId, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const label = msg("project_remove_named", { name: rigRef(catalog, rigId) })
  const users = rigRuns(catalog, projectId, rigId)
  if (users.length > 0) return refuse(msg("store_refused", { label }), usesIt(users), projectHref(projectId))
  return editProject(projectId, label, expectRevision, (p) => ({ ...p, rigIds: p.rigIds.filter((id) => id !== rigId) }))
}

/** Replace the goal rows; goals never block a run and never mark the Project Done (PRJ-FR-04). */
export function setGoals(projectId: ProjectId, goals: Goal[], expectRevision: number): CommitResult {
  return editProject(projectId, msg("plan_goals"), expectRevision, (p) => ({ ...p, goals }))
}

/** Apply a template: its values are copied in for every subject and replace the current goals (D-W30). */
export function applyGoalTemplate(projectId: ProjectId, templateId: GoalTemplateId, expectRevision: number): CommitResult {
  const template = goalTemplate(templateId)
  return editProject(projectId, template ? msg("store_label_apply_named", { name: template.name }) : msg("goal_apply_template"), expectRevision, (p) => ({ ...p, goals: p.subjects.flatMap((s) => goalsFromTemplate(template, s)) }))
}

/** The archive destination for this Project (P-ARC1); null returns it to the Default archive location. */
export function setProjectArchiveLocation(projectId: ProjectId, locationId: LocationId | null): CommitResult {
  const { catalog } = store.getState()
  const project = catalog.projects[projectId]
  if (!project) return MISSING
  const location = locationId ? catalog.locations[locationId] : undefined
  const label = msg("store_label_archive_destination")
  if (locationId && (!location || location.role !== "archive" || location.retiredAt)) return refuse(msg("store_refused", { label }), [msg("store_reason_not_archive_location")], projectHref(projectId))
  return editProject(projectId, label, project.revision, (p) => ({ ...p, archiveLocationId: locationId }))
}

/**
 * Record a Wrap up step as done or skipped (P-WRAP1), or clear it back to
 * to do with null. Refused until every run is Complete.
 * @deprecated Settles on start and ignores the order (B 8b.8). Use
 * `recordWrapUpStep` (through `wrapUpFlow`) and `reopenWrapUpStep`; W3
 * migrates wrap-up.tsx and W4 removes this.
 */
export function setWrapUpStep(projectId: ProjectId, step: WrapUpStepId, state: WrapUpStepRecord["state"] | null): CommitResult {
  const { catalog } = store.getState()
  const project = catalog.projects[projectId]
  if (!project) return MISSING
  const open = markDoneBlockers(catalog, project)
  if (open.length > 0) return refuse(msg("store_refused", { label: WRAP_UP_NAME[step] }), open.map((r) => msg("store_reason_not_complete", { name: r.name })), projectHref(projectId))
  const label = state === "done" ? msg("store_label_step_done", { step: WRAP_UP_NAME[step] }) : state === "skipped" ? msg("store_label_step_skipped", { step: WRAP_UP_NAME[step] }) : msg("store_label_step_reset", { step: WRAP_UP_NAME[step] })
  return editProject(projectId, label, project.revision, (p) => {
    const wrapUp = { ...p.wrapUp }
    if (state) wrapUp[step] = { state, at: nowIso(), operationIds: [], redo: false }
    else delete wrapUp[step]
    return { ...p, wrapUp }
  })
}

/** What Proceed did on a Wrap up step: nothing was left, nothing was selected (Skipped, F4), or it started these operations. */
export type WrapUpOutcome = { kind: "nothing-left" } | { kind: "skipped" } | { kind: "started"; operationIds: OperationId[] }

/** The name a Wrap up write goes by: the step, or Close project on Archive (C2). */
function wrapUpLabel(step: WrapUpStepId): MessageRef {
  return step === "archive" ? msg("stepflow_close_project") : WRAP_UP_NAME[step]
}

/**
 * Why Proceed on a Wrap up step is refused now, before any work starts: the
 * Project is closed, a run is not Finished, an earlier step is neither
 * finished nor skipped (C3), or the step is settled or still running. Null
 * when it may proceed.
 */
export function wrapUpRefusal(projectId: ProjectId, step: WrapUpStepId): CommitResult | null {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  if (!project) return MISSING
  const label = wrapUpLabel(step)
  const closed = closedRefusal(project, label)
  if (closed) return closed
  const flow = wrapUpFlowState(state, project)
  const title = msg("store_refused", { label })
  const href = `${projectHref(projectId)}?stage=wrap-up`
  if (!flow.available) return refuse(title, flow.waitingOn.map((r) => msg("flow_reason_not_finished", { name: r.name })), href)
  const index = WRAP_UP_STEPS.indexOf(step)
  const earlier = flow.steps.slice(0, index).filter((s) => s.state !== "finished" && s.state !== "skipped")
  if (earlier.length > 0) return refuse(title, earlier.map((s) => msg("flow_reason_step_first", { step: WRAP_UP_NAME[s.id] })), href)
  const own = flow.steps[index]!
  if (own.state === "finished" || own.state === "skipped") return refuse(title, [msg("flow_reason_step_settled", { step: WRAP_UP_NAME[step] })], href)
  if (own.gate) return refuseWithGate(label, own.gate, href)
  return null
}

/**
 * Record what Proceed did on a Wrap up step (F2, F4, C3). Started work makes
 * the step Running until every operation succeeds; nothing selected records
 * Skipped; nothing left records it done. Archive is Close project (§5.5):
 * with no transfer the Project closes now, else when the transfer succeeds.
 */
export function recordWrapUpStep(projectId: ProjectId, step: WrapUpStepId, outcome: WrapUpOutcome): CommitResult {
  const refused = wrapUpRefusal(projectId, step)
  if (refused) return refused
  const project = store.getState().catalog.projects[projectId]!
  const at = nowIso()
  const record: WrapUpStepRecord = { state: outcome.kind === "skipped" ? "skipped" : "done", at, operationIds: outcome.kind === "started" ? outcome.operationIds : [], redo: false }
  const closesNow = step === "archive" && record.operationIds.length === 0
  const label = outcome.kind === "skipped" ? msg("store_label_step_skipped", { step: WRAP_UP_NAME[step] }) : msg("store_label_step_done", { step: wrapUpLabel(step) })
  return editProject(projectId, label, project.revision, (p) => ({ ...p, wrapUp: { ...p.wrapUp, [step]: record }, ...(closesNow ? { state: "done" as const, doneAt: at } : {}) }))
}

/**
 * Reopen step (F5, C3): until Close, a finished or skipped Wrap up step
 * returns to To do and every later settled step reads Redo. Refused while
 * a step's work still runs.
 */
export function reopenWrapUpStep(projectId: ProjectId, step: WrapUpStepId): CommitResult {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  if (!project) return MISSING
  const label = msg("store_label_step_reset", { step: WRAP_UP_NAME[step] })
  const closed = closedRefusal(project, label)
  if (closed) return closed
  const flow = wrapUpFlowState(state, project)
  const index = WRAP_UP_STEPS.indexOf(step)
  const own = flow.steps[index]!
  const href = `${projectHref(projectId)}?stage=wrap-up`
  if (own.state !== "finished" && own.state !== "skipped") return refuse(msg("store_refused", { label }), [msg("flow_reason_step_open", { step: WRAP_UP_NAME[step] })], href)
  const busy = flow.steps.find((s) => s.gate)?.gate
  if (busy) return refuseWithGate(label, busy, href)
  return editProject(projectId, label, project.revision, (p) => {
    const wrapUp = { ...p.wrapUp }
    delete wrapUp[step]
    for (const later of WRAP_UP_STEPS.slice(index + 1)) {
      const record = wrapUp[later]
      if (record) wrapUp[later] = { ...record, redo: true }
    }
    return { ...p, wrapUp }
  })
}

/** Close the Projects whose Close project transfer just succeeded: every Archive operation they started has succeeded. */
function closeWhenArchived(state: PrototypeState, operationId: OperationId): PrototypeState {
  if (state.operations[operationId]?.status !== "succeeded") return state
  let projects = state.catalog.projects
  for (const project of Object.values(projects)) {
    const record = project.wrapUp.archive
    if (project.state !== "open" || !record || record.state !== "done" || record.redo || !record.operationIds.includes(operationId)) continue
    if (!record.operationIds.every((id) => state.operations[id]?.status === "succeeded")) continue
    projects = { ...projects, [project.id]: { ...project, state: "done", doneAt: nowIso(), revision: project.revision + 1 } }
  }
  return projects === state.catalog.projects ? state : { ...state, catalog: { ...state.catalog, projects } }
}

/**
 * The archive handler with Close project's rule (§5.5, F2): the Project
 * closes when the transfer Close project started succeeds, not when it
 * starts. A failed or canceled transfer leaves it open, Archive to do.
 */
export function closingOnSuccess(handler: OperationHandler): OperationHandler {
  return { ...handler, step: (state, op) => closeWhenArchived(handler.step(state, op), op.id) }
}

/**
 * Add to Project for a "Not in any Project" session (D-W59, PRJ-FR-19): adds
 * its Target as a subject and, when the Project lacks it, its rig. The
 * returned note names the added rig; show it before saving.
 */
export function addSessionToProject(sessionId: SessionId, projectId: ProjectId): { result: CommitResult; note: string | null } {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  const project = catalog.projects[projectId]
  const targetId = session ? sessionTargetId(session) : null
  const rigId = session ? sessionRigId(session) : null
  if (!session || !project) return { result: MISSING, note: null }
  if (!targetId || !rigId) return { result: refuse(msg("store_refused", { label: msg("session_add_to_project") }), [!targetId ? msg("store_reason_no_confirmed_target") : msg("store_reason_no_confirmed_rig")], `/sessions/${sessionId}`), note: null }
  const addsRig = !project.rigIds.includes(rigId)
  const note = addsRig ? m.store_note_adds_rig({ rig: rigName(m, catalog, rigId), project: project.name }) : null
  const subject: Subject = { id: freshId("sub", targetId), targetId, mosaic: null }
  const result = editProject(projectId, msg("session_add_to_project"), project.revision, (p) => ({
    ...p,
    subjects: p.subjects.some((s) => s.targetId === targetId) ? p.subjects : [...p.subjects, subject],
    goals: p.subjects.some((s) => s.targetId === targetId) ? p.goals : [...p.goals, ...goalsFromValues(projectGoalSet(p), subject)],
    rigIds: addsRig ? [...p.rigIds, rigId] : p.rigIds,
  }))
  return { result, note }
}

/**
 * Mark Done (D-W26, PRJ-FR-14): refused while a run outside the Trash is not
 * Complete; the refusal names each run so the user completes or trashes it.
 * @deprecated Closes without checking the Wrap up steps. Close project is
 * Archive's Proceed (`recordWrapUpStep(…, "archive", …)`, C2, C3); W3
 * migrates wrap-up.tsx and W4 removes this.
 */
export function markProjectDone(projectId: ProjectId): CommitResult {
  const { catalog } = store.getState()
  const project = catalog.projects[projectId]
  if (!project) return MISSING
  const open = markDoneBlockers(catalog, project)
  if (open.length > 0) return refuse(msg("store_refused", { label: msg("store_label_mark_named_done", { name: project.name }) }), open.map((r) => msg("store_reason_not_complete_fix", { name: r.name })), projectHref(projectId))
  return editProject(projectId, msg("wrapup_mark_done"), project.revision, (p) => ({ ...p, state: "done", doneAt: nowIso() }))
}

/** Reopen moves no files; archived sessions keep reading Archived until restored (D-W69). */
export function reopenProject(projectId: ProjectId): CommitResult {
  const project = store.getState().catalog.projects[projectId]
  if (!project) return MISSING
  return writeProject(projectId, msg("project_reopen"), project.revision, (p) => ({ ...p, state: "open", doneAt: null }))
}

/**
 * @deprecated P-REJ2 dropped Project-only rejects: Reject is library-wide
 * (`markFrames` with "unusable"). Refused, writing nothing; W3 removes the
 * caller (d-review/marks.ts) and W4 this function.
 */
export function setProjectRejection(projectId: ProjectId, _assetIds: string[], _rejected: boolean): CommitResult {
  const project = store.getState().catalog.projects[projectId]
  if (!project) return MISSING
  return refuse(msg("store_refused", { label: msg("review_reject_for_project") }), [msg("flow_reason_reject_is_library_wide")], projectHref(projectId))
}

/** "Target <subject> on <rig>" for a new Project prefilled from a session (Create Project, LIB-FR-17). */
export function prefillFromSession(sessionId: SessionId): NewProjectInput | null {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  const targetId = session ? sessionTargetId(session) : null
  if (!session || !targetId) return null
  const rigId = sessionRigId(session)
  const name = subjectName(m, catalog, { id: "", targetId, mosaic: null })
  return { name, notes: "", subjects: [{ targetId, mosaic: null }], rigIds: rigId ? [rigId] : [], goals: [] }
}
