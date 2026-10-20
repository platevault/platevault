/**
 * Project writes shared by every screen (foundation-owned; F4 Project model,
 * PRJ-FR-01 to PRJ-FR-31). Each durable change goes through `commit()`
 * (D08) and is refused while the Project is Closed or Archived
 * (`closedRefusal`: locked for good, no Reopen). A Project edit writes only
 * the Project record: its inputs, groups and settings are the desired state,
 * and the View changes only when the user applies them
 * (`store/actions/project-view.ts`).
 *
 * - Inputs (PRJ-FR-08): only Ready sessions with settled calibration join
 *   (`canJoinProject`); a suggestion never adds itself. A session joins the
 *   group with its optics and framing, else a new group with its default
 *   name (`groupPlacement`).
 * - Groups (PRJ-FR-27 to PRJ-FR-29): create, rename, split, move sessions,
 *   mark as a mosaic panel; a group holds whole sessions only.
 * - Duplicate (PRJ-FR-30): copies what the user chose and no files; the copy
 *   is fully independent and reads the sessions' current pins.
 * - Wrap up (C3, PRJ-FR-14): Clean up → Trash → Archive, each recorded when
 *   Proceed starts its work and Finished once that work succeeds
 *   (`wrapUpFlowState`); Close project closes the Project when its archive
 *   transfer succeeds, or at once with nothing to move, freezing its goals
 *   and calibration (`closeSnapshot`).
 */
import { canJoinProject, closeSnapshot, joinBlocker, planningSite, projectGoalSet, projectSessionIds, sessionRigId, sessionTargetId, subjectCentre, subjectName } from "@/domain/derive"
import { WRAP_UP_NAME, WRAP_UP_STEPS } from "@/domain/labels"
import { sessionRef } from "@/domain/membership"
import { defaultCriteria, seasonWindow, upcomingNight } from "@/domain/planning"
import { groupPlacement, splitGroupName, wrapUpFlowState } from "@/domain/project-view"
import { BUILT_IN_GOAL_TEMPLATES, subjectConditionsFrom } from "@/domain/templates"
import type {
  AssetId,
  Catalog,
  Goal,
  GoalTemplate,
  GoalTemplateId,
  GoalTemplateValue,
  HiddenGoal,
  IsoDateTime,
  LocationId,
  OperationId,
  OpticalTrainId,
  Project,
  ProjectGroup,
  ProjectGroupId,
  ProjectId,
  ProjectInput,
  ProjectSettings,
  SessionId,
  Subject,
  SubjectConditions,
  SubjectId,
  TargetId,
  WrapUpStepId,
  WrapUpStepRecord,
} from "@/domain/types"
import { joinRefs, m, type MessageRef, msg } from "@/lib/i18n"
import { type CommitResult, commit, nowIso, type PrototypeState, store } from "@/store/core"
import type { OperationHandler } from "@/store/operations"
import { keywordRefusals } from "./settings"
import { closedRefusal, freshId, MISSING, recordSaved, refuse, refuseWithGate } from "./shared"

const projectHref = (id: ProjectId) => `/projects/${id}`

/** A built-in or user goal template by id. */
export function goalTemplate(id: GoalTemplateId | null): GoalTemplate | undefined {
  if (!id) return undefined
  return BUILT_IN_GOAL_TEMPLATES.find((t) => t.id === id) ?? store.getState().catalog.goalTemplates[id]
}

/** Goals from template values for one subject (D-W29, D-W30): per channel, and per panel group for a mosaic. Every goal kind is copied. */
export function goalsFromValues(values: GoalTemplateValue[], subjectId: string, panelGroupIds: ProjectGroupId[] = []): Goal[] {
  const groups: Array<ProjectGroupId | null> = panelGroupIds.length > 0 ? panelGroupIds : [null]
  return groups.flatMap((groupId) =>
    values.map((value) => ({
      id: freshId("goal", `${subjectId}|${groupId}|${value.channel}`),
      subjectId,
      groupId,
      channel: value.channel,
      integrationS: value.integrationS,
      frameCount: value.frameCount,
      qualityBar: value.qualityBar,
    })),
  )
}

/** The panel groups of a Project, whose goals are per panel (PRJ-FR-29). */
function panelIds(project: Pick<Project, "groups">): ProjectGroupId[] {
  return project.groups.filter((g) => g.panel).map((g) => g.id)
}

/**
 * The conditions a template gives one subject (C7, `subjectConditionsFrom`):
 * a "Season" rule is pre-filled from the subject's visibility at the planning
 * site from tonight on, and leaves no window without a site or coordinates.
 */
function conditionsFromTemplate(state: Pick<PrototypeState, "catalog" | "settings" | "faults">, template: GoalTemplate | undefined, subject: Subject): SubjectConditions {
  return subjectConditionsFrom(template, () => {
    const site = planningSite(state)
    const centre = subjectCentre(state.catalog, subject)
    return site && centre ? seasonWindow(centre, site, defaultCriteria(site), upcomingNight(site, Date.parse(nowIso()))) : null
  })
}

/** Each subject with the template's conditions (C7); without a template the subjects stay as they are. */
function withTemplateConditions(subjects: Subject[], template: GoalTemplate | undefined): Subject[] {
  if (!template) return subjects
  const state = store.getState()
  return subjects.map((s) => ({ ...s, conditions: conditionsFromTemplate(state, template, s) }))
}

/** The Project closed at `at` (PRJ-FR-25): its goals and the calibration of each held session frozen as they stand. Every close goes through here. */
function closedProject(catalog: Catalog, project: Project, at: IsoDateTime): Project {
  return { ...project, state: project.archive ? "archived" : "closed", closedAt: at, snapshot: closeSnapshot(catalog, project, at) }
}

export interface NewProjectInput {
  name: string
  notes: string
  /** The Targets it is for (D-W9); a mosaic is not chosen up front (PRJ-FR-29). */
  subjects: TargetId[]
  rigIds: OpticalTrainId[]
  /** Goal values per channel, typed in or prefilled from a template; copied once, so the Project keeps no link to a template (D-W30). */
  goals: GoalTemplateValue[]
  /** The template the goal values were prefilled from: its conditions are copied to each subject (C7). Absent or null: the subjects keep the defaults. */
  templateId?: GoalTemplateId | null
}

/** A new open Project with nothing held yet and the Settings defaults: the View mode, Settings' keywords, no application. */
function newProject(id: ProjectId, fields: Pick<Project, "name" | "notes" | "subjects" | "rigIds" | "goals"> & Partial<Project>): Project {
  return {
    id,
    inputs: [],
    groups: [],
    settings: { profileId: null, mode: store.getState().settings.defaultInputMode, processingParent: null, keywords: null },
    folderPath: null,
    view: null,
    previous: null,
    output: {},
    masterOffers: [],
    archiveLocationId: null,
    wrapUp: {},
    state: "open",
    closedAt: null,
    snapshot: null,
    archive: null,
    createdAt: nowIso(),
    revision: 1,
    ...fields,
  }
}

/** New Project (PRJ-FR-01): name, subjects, rigs and optional goals. It holds no session until the user adds one. */
export function createProject(input: NewProjectInput): { result: CommitResult; projectId: ProjectId } {
  const id = freshId("prj", input.name)
  const subjects: Subject[] = withTemplateConditions(
    [...new Set(input.subjects)].map((targetId) => ({ id: freshId("sub", targetId), targetId })),
    goalTemplate(input.templateId ?? null),
  )
  const project = newProject(id, { name: input.name.trim(), notes: input.notes, subjects, rigIds: [...new Set(input.rigIds)], goals: subjects.flatMap((s) => goalsFromValues(input.goals, s.id)) })
  const result = commit(msg("store_label_create", { name: project.name }), (s) => ({ ...s, catalog: { ...s.catalog, projects: { ...s.catalog.projects, [id]: project } } }), { href: projectHref(id) })
  if (result.ok) recordSaved(msg("store_saved_project_created", { name: project.name }), joinRefs([msg("project_subjects_count", { count: subjects.length }), msg("project_rigs_count", { count: project.rigIds.length })], " · "), projectHref(id))
  return { result, projectId: id }
}

/** Commit one Project patch, guarded by its revision. */
function writeProject(projectId: ProjectId, label: MessageRef, expectRevision: number, update: (project: Project) => Project): CommitResult {
  const project = store.getState().catalog.projects[projectId]
  if (!project) return MISSING
  const result = commit(label, (s) => ({ ...s, catalog: { ...s.catalog, projects: { ...s.catalog.projects, [projectId]: update(s.catalog.projects[projectId]!) } } }), {
    expect: { collection: "projects", id: projectId, revision: expectRevision },
    href: projectHref(projectId),
  })
  if (result.ok) recordSaved(msg("store_saved_label_name", { label, name: project.name }), null, projectHref(projectId))
  return result
}

/** A Project edit: refused while the Project is Closed or Archived (`closedRefusal`). */
export function editProject(projectId: ProjectId, label: MessageRef, expectRevision: number, update: (project: Project) => Project): CommitResult {
  return closedRefusal(store.getState().catalog.projects[projectId], label) ?? writeProject(projectId, label, expectRevision, update)
}

/** The Project as it stands now with its revision, or MISSING. */
function current(projectId: ProjectId): Project | CommitResult {
  return store.getState().catalog.projects[projectId] ?? MISSING
}

const isProject = (value: Project | CommitResult): value is Project => "inputs" in value

/** Edit details (round 6): name and notes; a Project always keeps a name. */
export function updateProjectDetails(projectId: ProjectId, details: { name: string; notes: string }, expectRevision: number): CommitResult {
  const label = msg("store_label_project_details")
  if (!details.name.trim()) return refuse(msg("store_refused", { label }), [msg("store_reason_name_empty")], projectHref(projectId))
  return editProject(projectId, label, expectRevision, (p) => ({ ...p, name: details.name.trim(), notes: details.notes }))
}

/**
 * The goals `targetId` had when its subject was removed, given back to
 * `subjectId` with their ids and edited values, less a panel goal whose group
 * is gone or no longer a panel (D-W128), and the hidden goals left after. Null
 * when the Target has none hidden.
 */
function restoredGoals(p: Project, targetId: TargetId, subjectId: SubjectId): { goals: Goal[]; hiddenGoals: HiddenGoal[] } | null {
  const hidden = p.hiddenGoals ?? []
  const kept = hidden.filter((h) => h.targetId === targetId)
  if (kept.length === 0) return null
  const panels = panelIds(p)
  return {
    goals: kept.filter((h) => h.groupId === null || panels.includes(h.groupId)).map(({ targetId: _, ...goal }) => ({ ...goal, subjectId })),
    hiddenGoals: hidden.filter((h) => h.targetId !== targetId),
  }
}

/**
 * `subject` joins the Project. A Target removed before gets its kept goals back
 * (`restoredGoals`, D-W128); any other Target gets goals copied from the
 * Project's goal set (`projectGoalSet`), per panel in a mosaic. No session
 * membership changes.
 */
function withSubject(p: Project, subject: Subject): Project {
  const restored = restoredGoals(p, subject.targetId, subject.id)
  const goals = restored?.goals ?? goalsFromValues(projectGoalSet(p), subject.id, panelIds(p))
  return { ...p, subjects: [...p.subjects, subject], goals: [...p.goals, ...goals], hiddenGoals: restored?.hiddenGoals ?? p.hiddenGoals }
}

/** Add a subject (`withSubject`); a Target that is already a subject changes nothing. */
export function addSubject(projectId: ProjectId, targetId: TargetId, expectRevision: number): CommitResult {
  const subject: Subject = { id: freshId("sub", targetId), targetId }
  return editProject(projectId, msg("store_label_add_subject"), expectRevision, (p) => (p.subjects.some((s) => s.targetId === targetId) ? p : withSubject(p, subject)))
}

/** `goals` kept hidden by `targetId`, their subject's Target (D-W128). */
function hiddenBy(goals: Goal[], targetId: TargetId): HiddenGoal[] {
  return goals.map(({ subjectId: _, ...goal }) => ({ ...goal, targetId }))
}

/**
 * Point the subject at another Target; its goals stay. A Target with goals
 * kept hidden gets them back on this subject, as adding it would (D-W128,
 * owner 2026-10-20). The old Target stops being a subject, so the subject's
 * goals a restored one replaces (same panel group and channel) are kept
 * hidden under it. Sessions the Project holds stay held: only suggestions
 * change (F8 as amended). Refused when the Target is already a subject.
 */
export function changeSubjectTarget(projectId: ProjectId, subjectId: string, targetId: TargetId, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const project = catalog.projects[projectId]
  if (!project) return MISSING
  const label = msg("store_label_edit_subject")
  const taken = project.subjects.find((s) => s.id !== subjectId && s.targetId === targetId)
  if (taken) return refuse(msg("store_refused", { label }), [msg("store_reason_already_subject", { name: subjectName(m, catalog, taken) })], projectHref(projectId))
  return editProject(projectId, label, expectRevision, (p) => {
    const was = p.subjects.find((s) => s.id === subjectId)
    if (!was) return p
    const subjects = p.subjects.map((s) => (s.id === subjectId ? { ...s, targetId } : s))
    const restored = restoredGoals(p, targetId, subjectId)
    if (!restored) return { ...p, subjects }
    const replaced = (g: Goal) => g.subjectId === subjectId && restored.goals.some((r) => r.groupId === g.groupId && r.channel === g.channel)
    return {
      ...p,
      subjects,
      goals: [...p.goals.filter((g) => !replaced(g)), ...restored.goals],
      hiddenGoals: [...restored.hiddenGoals, ...hiddenBy(p.goals.filter(replaced), was.targetId)],
    }
  })
}

/**
 * Remove a subject. Its goals are kept hidden by its Target, counted and shown
 * nowhere until it is added back (D-W128); the sessions the Project holds stay
 * held, only suggestions change.
 */
export function removeSubject(projectId: ProjectId, subjectId: string, expectRevision: number): CommitResult {
  return editProject(projectId, msg("store_label_remove_subject"), expectRevision, (p) => {
    const subject = p.subjects.find((s) => s.id === subjectId)
    if (!subject) return p
    const hidden = hiddenBy(p.goals.filter((g) => g.subjectId === subjectId), subject.targetId)
    return { ...p, subjects: p.subjects.filter((s) => s.id !== subjectId), goals: p.goals.filter((g) => g.subjectId !== subjectId), hiddenGoals: [...(p.hiddenGoals ?? []), ...hidden] }
  })
}

/** Adding a rig changes suggestions only (PRJ-FR-02). */
export function addRig(projectId: ProjectId, rigId: OpticalTrainId, expectRevision: number): CommitResult {
  return editProject(projectId, msg("project_add_rig"), expectRevision, (p) => (p.rigIds.includes(rigId) ? p : { ...p, rigIds: [...p.rigIds, rigId] }))
}

/** Removing a rig changes suggestions only: sessions on it the Project holds stay held (PRJ-FR-02). */
export function removeRig(projectId: ProjectId, rigId: OpticalTrainId, expectRevision: number): CommitResult {
  return editProject(projectId, msg("store_label_remove_rig"), expectRevision, (p) => ({ ...p, rigIds: p.rigIds.filter((id) => id !== rigId) }))
}

/** Replace the goal rows; goals stay editable while the Project is open and never block anything (PRJ-FR-04). */
export function setGoals(projectId: ProjectId, goals: Goal[], expectRevision: number): CommitResult {
  return editProject(projectId, msg("plan_goals"), expectRevision, (p) => ({ ...p, goals }))
}

/** Apply a template: its values are copied in for every subject (per panel in a mosaic) and replace the current goals (D-W30); its conditions replace each subject's (C7). */
export function applyGoalTemplate(projectId: ProjectId, templateId: GoalTemplateId, expectRevision: number): CommitResult {
  const template = goalTemplate(templateId)
  return editProject(projectId, template ? msg("common_apply_named", { name: template.name }) : msg("goal_apply_template"), expectRevision, (p) => ({
    ...p,
    subjects: withTemplateConditions(p.subjects, template),
    goals: template ? p.subjects.flatMap((s) => goalsFromValues(template.values, s.id, panelIds(p))) : p.goals,
  }))
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
 * The View settings (VSEL-FR-16, PREP-FR-04, PREP-FR-06): application, mode,
 * Processing parent and keywords. A change reaches the View on the next
 * Apply; the Processing parent is fixed once the first Apply placed the
 * Project folder.
 */
export function setProjectSettings(projectId: ProjectId, patch: Partial<ProjectSettings>): CommitResult {
  const project = current(projectId)
  if (!isProject(project)) return project
  const label = msg("project_view_settings")
  if (patch.processingParent !== undefined && project.folderPath && patch.processingParent !== project.settings.processingParent) {
    return refuse(msg("store_refused", { label }), [msg("project_reason_folder_fixed", { path: project.folderPath })], projectHref(projectId))
  }
  const keywordReasons = patch.keywords ? keywordRefusals(patch.keywords) : []
  if (keywordReasons.length > 0) return refuse(msg("store_refused", { label }), keywordReasons, projectHref(projectId))
  return editProject(projectId, label, project.revision, (p) => ({ ...p, settings: { ...p.settings, ...patch } }))
}

// ---------------------------------------------------------------------------
// Inputs and groups (PRJ-FR-08, PRJ-FR-27 to PRJ-FR-31)
// ---------------------------------------------------------------------------

/** The inputs and groups after `sessionIds` join: each into `groupId`, or its placement (an existing group with its optics and framing, else a new group). */
function joined(state: PrototypeState, project: Project, sessionIds: SessionId[], groupId: ProjectGroupId | null): Pick<Project, "inputs" | "groups"> {
  let draft: Pick<Project, "inputs" | "groups"> = { inputs: [...project.inputs], groups: [...project.groups] }
  const held = projectSessionIds(project)
  const at = nowIso()
  for (const sessionId of sessionIds) {
    const session = state.catalog.sessions[sessionId]
    if (!session || held.has(sessionId)) continue
    held.add(sessionId)
    let target = groupId
    if (!target) {
      const placement = groupPlacement(m, state, draft, session)
      target = placement.groupId
      if (!target) {
        const group: ProjectGroup = { id: freshId("grp", `${project.id}|${placement.name}`), name: placement.name, panel: placement.panel, createdAt: at }
        draft = { ...draft, groups: [...draft.groups, group] }
        target = group.id
      }
    }
    draft = { ...draft, inputs: [...draft.inputs, { sessionId, groupId: target, excluded: [], included: [] }] }
  }
  return draft
}

/**
 * Add sessions (PRJ-FR-08): only Ready sessions with settled calibration
 * join; the refusal names each other one and what it waits on ("18 Sep Ha:
 * Choose its flats first"). Each joins `groupId`, or the group its optics
 * and framing place it in, creating one with its default name when none fits.
 */
export function addSessions(projectId: ProjectId, sessionIds: SessionId[], groupId: ProjectGroupId | null = null): CommitResult {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  if (!project) return MISSING
  const label = msg("store_label_add_sessions", { count: sessionIds.length, n: { count: sessionIds.length } })
  if (groupId && !project.groups.some((g) => g.id === groupId)) return MISSING
  const blocked = sessionIds.flatMap((id) => {
    const session = state.catalog.sessions[id]
    if (!session) return [msg("store_record_missing")]
    if (canJoinProject(state.catalog, session)) return []
    return [joinRefs([sessionRef(session), joinBlocker(state.catalog, session) ?? msg("store_record_missing")], ": ")]
  })
  if (blocked.length > 0) return closedRefusal(project, label) ?? refuse(msg("store_refused", { label }), blocked, projectHref(projectId))
  return editProject(projectId, label, project.revision, (p) => ({ ...p, ...joined(store.getState(), p, sessionIds, groupId) }))
}

/** Remove sessions: their frames leave the View on the next Apply; files, the library and other Projects never change. */
export function removeSessions(projectId: ProjectId, sessionIds: SessionId[]): CommitResult {
  const project = current(projectId)
  if (!isProject(project)) return project
  const gone = new Set(sessionIds)
  return editProject(projectId, msg("store_label_remove_sessions", { count: sessionIds.length, n: { count: sessionIds.length } }), project.revision, (p) => ({ ...p, inputs: p.inputs.filter((i) => !gone.has(i.sessionId)) }))
}

/** Move whole sessions into another group (PRJ-FR-27); the folder they sit in changes on the next Apply. */
export function moveSessions(projectId: ProjectId, sessionIds: SessionId[], groupId: ProjectGroupId): CommitResult {
  const project = current(projectId)
  if (!isProject(project)) return project
  const group = project.groups.find((g) => g.id === groupId)
  if (!group) return MISSING
  const moving = new Set(sessionIds)
  return editProject(projectId, msg("project_label_move_sessions", { count: sessionIds.length, group: group.name }), project.revision, (p) => ({ ...p, inputs: p.inputs.map((i) => (moving.has(i.sessionId) ? { ...i, groupId } : i)) }))
}

function nameRefusal(project: Project, name: string, except: ProjectGroupId | null): MessageRef | null {
  const clean = name.trim()
  if (!clean) return msg("store_reason_name_empty")
  return project.groups.some((g) => g.id !== except && g.name === clean) ? msg("project_reason_group_name_taken", { name: clean }) : null
}

/** Create an empty group (PRJ-FR-27), named by the user; a panel group makes the Project a mosaic (PRJ-FR-29). */
export function createGroup(projectId: ProjectId, name: string, panel: boolean): { result: CommitResult; groupId: ProjectGroupId | null } {
  const project = current(projectId)
  if (!isProject(project)) return { result: project, groupId: null }
  const label = msg("project_label_create_group", { name: name.trim() })
  const reason = nameRefusal(project, name, null)
  if (reason) return { result: closedRefusal(project, label) ?? refuse(msg("store_refused", { label }), [reason], projectHref(projectId)), groupId: null }
  const group: ProjectGroup = { id: freshId("grp", `${projectId}|${name}`), name: name.trim(), panel, createdAt: nowIso() }
  const result = editProject(projectId, label, project.revision, (p) => ({ ...p, groups: [...p.groups, group] }))
  return { result, groupId: result.ok ? group.id : null }
}

/** Rename a group; its folder changes on the next Apply (PRJ-FR-27). Names stay unique within the Project. */
export function renameGroup(projectId: ProjectId, groupId: ProjectGroupId, name: string): CommitResult {
  const project = current(projectId)
  if (!isProject(project)) return project
  const label = msg("project_label_rename_group")
  const reason = nameRefusal(project, name, groupId)
  if (reason) return closedRefusal(project, label) ?? refuse(msg("store_refused", { label }), [reason], projectHref(projectId))
  return editProject(projectId, label, project.revision, (p) => ({ ...p, groups: p.groups.map((g) => (g.id === groupId ? { ...g, name: name.trim() } : g)) }))
}

/**
 * Mark a group as a mosaic panel, or not (PRJ-FR-29): a panel uses the
 * PANEL keyword, and a Project with one is a mosaic, with per-panel goals.
 * A newly marked panel gets the Project's goal set; marking the first panel
 * replaces the subject-wide goals, and unmarking the last brings them back.
 */
export function setGroupPanel(projectId: ProjectId, groupId: ProjectGroupId, panel: boolean): CommitResult {
  const project = current(projectId)
  if (!isProject(project)) return project
  return editProject(projectId, panel ? msg("project_group_mark_panel") : msg("project_group_unmark_panel"), project.revision, (p) => {
    const was = p.groups.find((g) => g.id === groupId)
    if (!was || was.panel === panel) return p
    const groups = p.groups.map((g) => (g.id === groupId ? { ...g, panel } : g))
    const panels = groups.filter((g) => g.panel).length
    const values = projectGoalSet(p)
    const perSubject = (ids: ProjectGroupId[]) => p.subjects.flatMap((s) => goalsFromValues(values, s.id, ids))
    const goals = panel
      ? [...p.goals.filter((g) => panels > 1 || g.groupId !== null), ...perSubject([groupId])]
      : [...p.goals.filter((g) => g.groupId !== groupId), ...(panels === 0 ? perSubject([]) : [])].filter((g) => panels === 0 || g.groupId !== null)
    return { ...p, groups, goals }
  })
}

/** Split a group (PRJ-FR-27): `sessionIds` move into a new group, named "<Group> · 2" unless the user names it. */
export function splitGroup(projectId: ProjectId, groupId: ProjectGroupId, sessionIds: SessionId[], name: string | null = null): { result: CommitResult; groupId: ProjectGroupId | null } {
  const project = current(projectId)
  if (!isProject(project)) return { result: project, groupId: null }
  const source = project.groups.find((g) => g.id === groupId)
  if (!source) return { result: MISSING, groupId: null }
  const chosen = name ?? splitGroupName(m, project, source)
  const label = msg("project_label_split_group", { name: source.name })
  const reason = nameRefusal(project, chosen, null)
  if (reason) return { result: closedRefusal(project, label) ?? refuse(msg("store_refused", { label }), [reason], projectHref(projectId)), groupId: null }
  const group: ProjectGroup = { id: freshId("grp", `${projectId}|${chosen}`), name: chosen.trim(), panel: source.panel, createdAt: nowIso() }
  const moving = new Set(sessionIds)
  const result = editProject(projectId, label, project.revision, (p) => ({
    ...p,
    groups: [...p.groups, group],
    inputs: p.inputs.map((i) => (i.groupId === groupId && moving.has(i.sessionId) ? { ...i, groupId: group.id } : i)),
  }))
  return { result, groupId: result.ok ? group.id : null }
}

/** Remove an empty group; refused while it holds a session (move or remove them first). */
export function removeGroup(projectId: ProjectId, groupId: ProjectGroupId): CommitResult {
  const project = current(projectId)
  if (!isProject(project)) return project
  const label = msg("project_group_remove")
  const holding = project.inputs.filter((i) => i.groupId === groupId).length
  if (holding > 0) return closedRefusal(project, label) ?? refuse(msg("store_refused", { label }), [msg("project_reason_group_holds", { count: holding })], projectHref(projectId))
  return editProject(projectId, label, project.revision, (p) => ({ ...p, groups: p.groups.filter((g) => g.id !== groupId), goals: p.goals.filter((g) => g.groupId !== groupId) }))
}

/** One input with `update` applied, the others as they are. */
function withInput(project: Project, sessionId: SessionId, update: (input: ProjectInput) => ProjectInput): Project {
  return { ...project, inputs: project.inputs.map((i) => (i.sessionId === sessionId ? update(i) : i)) }
}

/** Leave frames out of this Project only, or take them back (VSEL-FR-10): the library and other Projects never change. */
export function setFramesExcluded(projectId: ProjectId, sessionId: SessionId, assetIds: AssetId[], excluded: boolean): CommitResult {
  const project = current(projectId)
  if (!isProject(project)) return project
  const ids = new Set(assetIds)
  const label = excluded ? msg("project_label_exclude_frames", { count: ids.size, n: { count: ids.size } }) : msg("project_label_include_frames", { count: ids.size, n: { count: ids.size } })
  return editProject(projectId, label, project.revision, (p) =>
    withInput(p, sessionId, (i) => ({ ...i, excluded: excluded ? [...new Set([...i.excluded, ...ids])] : i.excluded.filter((id) => !ids.has(id)) })),
  )
}

/** Include library-Unusable frames in this Project explicitly, or stop (VSEL-FR-15); the library decision stays. */
export function setUnusableIncluded(projectId: ProjectId, sessionId: SessionId, assetIds: AssetId[], included: boolean): CommitResult {
  const project = current(projectId)
  if (!isProject(project)) return project
  const ids = new Set(assetIds)
  const label = included ? msg("project_label_use_unusable", { count: ids.size, n: { count: ids.size } }) : msg("project_label_drop_unusable", { count: ids.size, n: { count: ids.size } })
  return editProject(projectId, label, project.revision, (p) =>
    withInput(p, sessionId, (i) => ({ ...i, included: included ? [...new Set([...i.included, ...ids])] : i.included.filter((id) => !ids.has(id)) })),
  )
}

// ---------------------------------------------------------------------------
// Duplicate (PRJ-FR-30, D-W112)
// ---------------------------------------------------------------------------

/** What Duplicate copies: each part the user ticked. Files are never copied. */
export interface DuplicateChoice {
  name: string
  sessions: boolean
  /** Groups and their names and panel marks; with sessions, each session stays in its group. */
  groups: boolean
  goals: boolean
  notes: boolean
  /** Application, mode and keywords; the Processing parent too, the Project folder never. */
  settings: boolean
}

/**
 * Duplicate (PRJ-FR-30): a new open Project with what the user chose and no
 * files: no View, Output, Processing or link back. The copy reads each
 * session's current pins, never the original's Close snapshot (D-W112), and
 * its first Apply builds its own View from the originals. Works on a Closed
 * Project too: that is how its work goes on.
 */
export function duplicateProject(projectId: ProjectId, choice: DuplicateChoice): { result: CommitResult; projectId: ProjectId | null } {
  const source = store.getState().catalog.projects[projectId]
  if (!source) return { result: MISSING, projectId: null }
  const label = msg("common_duplicate_title", { name: source.name })
  const name = choice.name.trim()
  if (!name) return { result: refuse(msg("store_refused", { label }), [msg("store_reason_name_empty")], projectHref(projectId)), projectId: null }
  const id = freshId("prj", name)
  const groupIds = new Map(source.groups.map((g) => [g.id, freshId("grp", `${id}|${g.name}`)]))
  const subjects = source.subjects.map((s) => ({ ...s, id: freshId("sub", s.targetId) }))
  const subjectIds = new Map(source.subjects.map((s, i) => [s.id, subjects[i]!.id]))
  const groups: ProjectGroup[] = choice.groups ? source.groups.map((g) => ({ ...g, id: groupIds.get(g.id)!, createdAt: nowIso() })) : []
  const project = newProject(id, {
    name,
    notes: choice.notes ? source.notes : "",
    subjects,
    rigIds: [...source.rigIds],
    goals: choice.goals ? source.goals.map((g) => ({ ...g, id: freshId("goal", `${id}|${g.id}`), subjectId: subjectIds.get(g.subjectId) ?? g.subjectId, groupId: g.groupId && choice.groups ? (groupIds.get(g.groupId) ?? null) : null })) : [],
    groups,
    settings: choice.settings ? { ...structuredClone(source.settings) } : { profileId: null, mode: store.getState().settings.defaultInputMode, processingParent: null, keywords: null },
    archiveLocationId: source.archiveLocationId,
  })
  let duplicate = project
  if (choice.sessions) {
    const sessionIds = source.inputs.map((i) => i.sessionId)
    if (choice.groups) duplicate = { ...duplicate, inputs: source.inputs.map((i) => ({ ...structuredClone(i), groupId: groupIds.get(i.groupId)! })) }
    else duplicate = { ...duplicate, ...joined(store.getState(), duplicate, sessionIds, null) }
  }
  const result = commit(label, (s) => ({ ...s, catalog: { ...s.catalog, projects: { ...s.catalog.projects, [id]: duplicate } } }), { href: projectHref(id) })
  if (result.ok) recordSaved(msg("project_saved_duplicated", { name: source.name, copy: name }), null, projectHref(id))
  return { result, projectId: result.ok ? id : null }
}

// ---------------------------------------------------------------------------
// Wrap up (PRJ-FR-14, C3, F2, F4, F5) and Close (PRJ-FR-25)
// ---------------------------------------------------------------------------

/** What Proceed did on a Wrap up step: nothing was left, nothing was selected (Skipped, F4), or it started these operations. */
export type WrapUpOutcome = { kind: "nothing-left" } | { kind: "skipped" } | { kind: "started"; operationIds: OperationId[] }

/** The name a Wrap up write goes by: the step, or Close project on Archive (C2). */
function wrapUpLabel(step: WrapUpStepId): MessageRef {
  return step === "archive" ? msg("stepflow_close_project") : WRAP_UP_NAME[step]
}

/**
 * Why Proceed on a Wrap up step is refused now, before any work starts: the
 * Project is closed, Wrap up is not available (`wrapUpGate`: a change is
 * pending or another operation works on it), an earlier step is neither
 * finished nor skipped (C3), or the step is settled or still running. Null
 * when it may proceed. `starting` names the operations this step's Proceed
 * has just started: the check reads the Project as it was before them, so
 * the step's own work never refuses its record.
 */
export function wrapUpRefusal(projectId: ProjectId, step: WrapUpStepId, starting: ReadonlyArray<OperationId> = []): CommitResult | null {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  if (!project) return MISSING
  const label = wrapUpLabel(step)
  const closed = closedRefusal(project, label)
  if (closed) return closed
  const operations = starting.length === 0 ? state.operations : Object.fromEntries(Object.entries(state.operations).filter(([id]) => !starting.includes(id)))
  const flow = wrapUpFlowState({ ...state, operations }, project)
  const title = msg("store_refused", { label })
  const href = `${projectHref(projectId)}?stage=wrap-up`
  if (flow.unavailable) return refuseWithGate(label, flow.unavailable, href)
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
 * it Skipped; nothing left records it done. Archive is Close project: with
 * no transfer the Project closes now, else when the transfer succeeds.
 */
export function recordWrapUpStep(projectId: ProjectId, step: WrapUpStepId, outcome: WrapUpOutcome): CommitResult {
  const refused = wrapUpRefusal(projectId, step, outcome.kind === "started" ? outcome.operationIds : [])
  if (refused) return refused
  const project = store.getState().catalog.projects[projectId]!
  const at = nowIso()
  const record: WrapUpStepRecord = { state: outcome.kind === "skipped" ? "skipped" : "done", at, operationIds: outcome.kind === "started" ? outcome.operationIds : [], redo: false }
  const closesNow = step === "archive" && record.operationIds.length === 0
  const label = outcome.kind === "skipped" ? msg("store_label_step_skipped", { step: WRAP_UP_NAME[step] }) : msg("store_label_step_done", { step: wrapUpLabel(step) })
  return writeProject(projectId, label, project.revision, (p) => {
    const recorded = { ...p, wrapUp: { ...p.wrapUp, [step]: record } }
    return closesNow ? closedProject(store.getState().catalog, recorded, at) : recorded
  })
}

/**
 * Reopen step (F5, C3): until Close, a finished or skipped Wrap up step
 * returns to To do and later settled steps read Redo. Refused while a step's
 * work still runs. Close itself is never undone (no Reopen, provisional).
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
  return writeProject(projectId, label, project.revision, (p) => {
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
    projects = { ...projects, [project.id]: { ...closedProject(state.catalog, project, nowIso()), revision: project.revision + 1 } }
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

// ---------------------------------------------------------------------------
// From a session (Home, Sessions)
// ---------------------------------------------------------------------------

/**
 * Add to Project for a "Not in any Project" session (D-W59, PRJ-FR-19):
 * adds its Target as a subject (`withSubject`, so a removed one gets its kept
 * goals back, D-W128) and its rig when the Project lacks them, then the
 * session itself, which must be Ready and settled. The returned note names
 * the added rig to show before saving.
 */
export function addSessionToProject(sessionId: SessionId, projectId: ProjectId): { result: CommitResult; note: string | null } {
  const state = store.getState()
  const { catalog } = state
  const session = catalog.sessions[sessionId]
  const project = catalog.projects[projectId]
  if (!session || !project) return { result: MISSING, note: null }
  const label = msg("session_add_to_project")
  const targetId = sessionTargetId(session)
  const rigId = sessionRigId(session)
  const href = `/sessions/${sessionId}`
  if (!targetId || !rigId) return { result: refuse(msg("store_refused", { label }), [!targetId ? msg("store_reason_no_confirmed_target") : msg("store_reason_no_confirmed_rig")], href), note: null }
  if (!canJoinProject(catalog, session)) return { result: closedRefusal(project, label) ?? refuse(msg("store_refused", { label }), [joinBlocker(catalog, session) ?? msg("store_record_missing")], href), note: null }
  const addsRig = !project.rigIds.includes(rigId)
  const note = addsRig ? m.store_note_adds_rig({ rig: catalog.opticalTrains[rigId]?.name ?? rigId, project: project.name }) : null
  const subject: Subject = { id: freshId("sub", targetId), targetId }
  const result = editProject(projectId, label, project.revision, (p) => {
    const withTarget = p.subjects.some((s) => s.targetId === targetId) ? p : withSubject(p, subject)
    const withRig = addsRig ? { ...withTarget, rigIds: [...withTarget.rigIds, rigId] } : withTarget
    return { ...withRig, ...joined(store.getState(), withRig, [sessionId], null) }
  })
  return { result, note }
}

/** "Target <subject> on <rig>" for a new Project prefilled from a session (Create Project, LIB-FR-17). */
export function prefillFromSession(sessionId: SessionId): NewProjectInput | null {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  const targetId = session ? sessionTargetId(session) : null
  if (!session || !targetId) return null
  const rigId = sessionRigId(session)
  const name = subjectName(m, catalog, { id: "", targetId })
  return { name, notes: "", subjects: [targetId], rigIds: rigId ? [rigId] : [], goals: [] }
}
