/**
 * Project writes shared by every screen (foundation-owned). Each durable
 * change goes through `commit()` (D08); a Project edit writes only catalog
 * Project records and never changes files, runs or quality (PRJ-FR-05).
 */
import { markDoneBlockers, projectGoalSet, rigName, sessionRigId, sessionTargetId, subjectName } from "@/domain/derive"
import { WRAP_UP_LABEL } from "@/domain/labels"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import type { Goal, GoalTemplate, GoalTemplateId, GoalTemplateValue, LocationId, OpticalTrainId, Project, ProjectId, SessionId, Subject, TargetId, WrapUpStepId, WrapUpStepRecord } from "@/domain/types"
import { plural } from "@/lib/format"
import { type CommitResult, commit, nowIso, store, withCatalog } from "@/store/core"
import { freshId, MISSING, recordSaved, refuse } from "./shared"

const projectHref = (id: ProjectId) => `/projects/${id}`

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
  /** Copied in once; the copy stands alone and stays editable, and the Project keeps no link to it (D-W30). */
  goalTemplateId: GoalTemplateId | null
}

/** New Project (PRJ-FR-01): name, subjects, rigs and an optional goal template. Creates no run. */
export function createProject(input: NewProjectInput): { result: CommitResult; projectId: ProjectId } {
  const id = freshId("prj", input.name)
  const subjects: Subject[] = input.subjects.map((s) => ({ id: freshId("sub", s.targetId), targetId: s.targetId, mosaic: s.mosaic }))
  const template = goalTemplate(input.goalTemplateId)
  const project: Project = {
    id,
    name: input.name.trim(),
    notes: input.notes,
    subjects,
    rigIds: [...new Set(input.rigIds)],
    goals: subjects.flatMap((s) => goalsFromTemplate(template, s)),
    archiveLocationId: null,
    wrapUp: {},
    state: "open",
    doneAt: null,
    archive: null,
    rejections: {},
    createdAt: nowIso(),
    revision: 1,
  }
  const result = commit(`Create ${project.name}`, (s) => withCatalog(s, (c) => ({ ...c, projects: { ...c.projects, [id]: project } })), { href: projectHref(id) })
  if (result.ok) recordSaved(`Project created: ${project.name}`, `${plural(subjects.length, "subject")} · ${plural(project.rigIds.length, "rig")}`, projectHref(id))
  return { result, projectId: id }
}

function editProject(projectId: ProjectId, label: string, expectRevision: number, update: (project: Project) => Project): CommitResult {
  const project = store.getState().catalog.projects[projectId]
  if (!project) return MISSING
  const result = commit(
    label,
    (s) => withCatalog(s, (c) => ({ ...c, projects: { ...c.projects, [projectId]: update(c.projects[projectId]!) } })),
    { expect: { collection: "projects", id: projectId, revision: expectRevision }, href: projectHref(projectId) },
  )
  if (result.ok) recordSaved(`${label}: ${project.name}`, null, projectHref(projectId))
  return result
}

export function updateProjectDetails(projectId: ProjectId, details: { name: string; notes: string }, expectRevision: number): CommitResult {
  return editProject(projectId, "Project details", expectRevision, (p) => ({ ...p, name: details.name.trim(), notes: details.notes }))
}

/** Add a subject, with goals copied from the Project's goal set (`projectGoalSet`). */
export function addSubject(projectId: ProjectId, input: SubjectInput, expectRevision: number): CommitResult {
  const subject: Subject = { id: freshId("sub", input.targetId), targetId: input.targetId, mosaic: input.mosaic }
  return editProject(projectId, "Add subject", expectRevision, (p) =>
    p.subjects.some((s) => s.targetId === input.targetId) ? p : { ...p, subjects: [...p.subjects, subject], goals: [...p.goals, ...goalsFromValues(projectGoalSet(p), subject)] },
  )
}

/** Refused while any run uses the subject; the refusal names each run (D-W65). */
export function removeSubject(projectId: ProjectId, subjectId: string, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const users = Object.values(catalog.runs).filter((r) => r.projectId === projectId && r.subjectId === subjectId)
  if (users.length > 0) return refuse("Remove subject refused", users.map((r) => `${r.name} uses it`), projectHref(projectId))
  return editProject(projectId, "Remove subject", expectRevision, (p) => ({ ...p, subjects: p.subjects.filter((s) => s.id !== subjectId), goals: p.goals.filter((g) => g.subjectId !== subjectId) }))
}

/** Adding a rig changes candidates only, never a run's membership (PRJ-FR-02). */
export function addRig(projectId: ProjectId, rigId: OpticalTrainId, expectRevision: number): CommitResult {
  return editProject(projectId, "Add rig", expectRevision, (p) => (p.rigIds.includes(rigId) ? p : { ...p, rigIds: [...p.rigIds, rigId] }))
}

/** Refused while any run uses the rig; the refusal names each run (D-W65, PRJ-FR-02). */
export function removeRig(projectId: ProjectId, rigId: OpticalTrainId, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const users = Object.values(catalog.runs).filter((r) => r.projectId === projectId && r.rigId === rigId)
  if (users.length > 0) return refuse(`Remove ${rigName(catalog, rigId)} refused`, users.map((r) => `${r.name} uses it`), projectHref(projectId))
  return editProject(projectId, "Remove rig", expectRevision, (p) => ({ ...p, rigIds: p.rigIds.filter((id) => id !== rigId) }))
}

/** Replace the goal rows; goals never block a run and never mark the Project Done (PRJ-FR-04). */
export function setGoals(projectId: ProjectId, goals: Goal[], expectRevision: number): CommitResult {
  return editProject(projectId, "Goals", expectRevision, (p) => ({ ...p, goals }))
}

/** Apply a template: its values are copied in for every subject and replace the current goals (D-W30). */
export function applyGoalTemplate(projectId: ProjectId, templateId: GoalTemplateId, expectRevision: number): CommitResult {
  const template = goalTemplate(templateId)
  return editProject(projectId, `Apply ${template?.name ?? "template"}`, expectRevision, (p) => ({ ...p, goals: p.subjects.flatMap((s) => goalsFromTemplate(template, s)) }))
}

/** The archive destination for this Project (P-ARC1); null returns it to the Default archive location. */
export function setProjectArchiveLocation(projectId: ProjectId, locationId: LocationId | null): CommitResult {
  const { catalog } = store.getState()
  const project = catalog.projects[projectId]
  if (!project) return MISSING
  const location = locationId ? catalog.locations[locationId] : undefined
  if (locationId && (!location || location.role !== "archive" || location.retiredAt)) return refuse("Archive destination refused", ["not an archive location"], projectHref(projectId))
  return editProject(projectId, "Archive destination", project.revision, (p) => ({ ...p, archiveLocationId: locationId }))
}

/**
 * Record a Wrap up step as done or skipped (P-WRAP1), or clear it back to
 * to do with null. Refused until every run is Complete.
 */
export function setWrapUpStep(projectId: ProjectId, step: WrapUpStepId, state: WrapUpStepRecord["state"] | null): CommitResult {
  const { catalog } = store.getState()
  const project = catalog.projects[projectId]
  if (!project) return MISSING
  const open = markDoneBlockers(catalog, project)
  if (open.length > 0) return refuse(`${WRAP_UP_LABEL[step]} refused`, open.map((r) => `${r.name} is not Complete`), projectHref(projectId))
  const verb = state === "done" ? "done" : state === "skipped" ? "skipped" : "reset"
  return editProject(projectId, `${WRAP_UP_LABEL[step]} ${verb}`, project.revision, (p) => {
    const wrapUp = { ...p.wrapUp }
    if (state) wrapUp[step] = { state, at: nowIso() }
    else delete wrapUp[step]
    return { ...p, wrapUp }
  })
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
  if (!targetId || !rigId) return { result: refuse("Add to Project refused", [!targetId ? "the session has no confirmed Target" : "the session has no confirmed rig"], `/sessions/${sessionId}`), note: null }
  const addsRig = !project.rigIds.includes(rigId)
  const note = addsRig ? `Also adds the rig ${rigName(catalog, rigId)} to ${project.name}.` : null
  const subject: Subject = { id: freshId("sub", targetId), targetId, mosaic: null }
  const result = editProject(projectId, "Add to Project", project.revision, (p) => ({
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
 */
export function markProjectDone(projectId: ProjectId): CommitResult {
  const { catalog } = store.getState()
  const project = catalog.projects[projectId]
  if (!project) return MISSING
  const open = markDoneBlockers(catalog, project)
  if (open.length > 0) return refuse(`Mark ${project.name} Done refused`, open.map((r) => `${r.name} is not Complete: complete it or move it to Trash`), projectHref(projectId))
  return editProject(projectId, "Mark Done", project.revision, (p) => ({ ...p, state: "done", doneAt: nowIso() }))
}

/** Reopen moves no files; archived sessions keep reading Archived until restored (D-W69). */
export function reopenProject(projectId: ProjectId): CommitResult {
  const project = store.getState().catalog.projects[projectId]
  if (!project) return MISSING
  return editProject(projectId, "Reopen", project.revision, (p) => ({ ...p, state: "open", doneAt: null }))
}

/** Project-only reject or its undo (D-W42): never changes library quality, captured or other Projects. */
export function setProjectRejection(projectId: ProjectId, assetIds: string[], rejected: boolean): CommitResult {
  const project = store.getState().catalog.projects[projectId]
  if (!project) return MISSING
  const label = rejected ? `Reject ${plural(assetIds.length, "frame")} for ${project.name} only` : `Undo Project reject of ${plural(assetIds.length, "frame")}`
  const at = nowIso()
  return editProject(projectId, label, project.revision, (p) => {
    const rejections = { ...p.rejections }
    for (const id of assetIds) {
      if (rejected) rejections[id] = { at }
      else delete rejections[id]
    }
    return { ...p, rejections }
  })
}

/** "Target <subject> on <rig>" for a new Project prefilled from a session (Create Project, LIB-FR-17). */
export function prefillFromSession(sessionId: SessionId): NewProjectInput | null {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  const targetId = session ? sessionTargetId(session) : null
  if (!session || !targetId) return null
  const rigId = sessionRigId(session)
  const name = subjectName(catalog, { id: "", targetId, mosaic: null })
  return { name, notes: "", subjects: [{ targetId, mosaic: null }], rigIds: rigId ? [rigId] : [], goalTemplateId: null }
}
