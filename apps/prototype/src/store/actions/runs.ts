/**
 * Run lifecycle writes shared by every screen (foundation-owned): start a run
 * or run group, edit and save membership, setup, Complete and Reopen, Move to
 * Trash, Restore and Empty Trash (D-W3, D-W8, D-W34, D-W38, D-W49, D-W50,
 * D-W72). Step-specific writes (calibration decisions, Prepare, Results,
 * Clean up) belong to the run screens (slice C).
 */
import {
  completeRefusals,
  findSubject,
  groupHref,
  latestRevision,
  panelForSession,
  panelLabel,
  projectCandidates,
  rigName,
  runHref,
  runPipeline,
  runSetup,
  subjectName,
  trashRefusals,
} from "@/domain/derive"
import { addSessions, contentEquals, contentOf, describeDiff, diffContent, emptyContent, excludeFrames, removeSessions, restoreFrames } from "@/domain/membership"
import type {
  MembershipContent,
  OpticalTrainId,
  ProjectId,
  ResultId,
  Run,
  RunGroup,
  RunGroupId,
  RunId,
  RunSetup,
  RunStep,
  SelectionReason,
  SessionId,
} from "@/domain/types"
import { plural } from "@/lib/format"
import { type CommitResult, commit, nowIso, type PrototypeState, store, withCatalog } from "@/store/core"
import { freshId, MISSING, recordSaved, refuse } from "./shared"
import { moveToOsTrash, preparedEntryItems, resultItems } from "./trash"

function uniqueRunName(state: PrototypeState, projectId: ProjectId, base: string): string {
  const taken = new Set(Object.values(state.catalog.runs).filter((r) => r.projectId === projectId).map((r) => r.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) if (!taken.has(`${base} (${n})`)) return `${base} (${n})`
}

function newRun(fields: Pick<Run, "id" | "name" | "projectId" | "subjectId" | "panelId" | "groupId" | "rigId" | "setup">, draft: MembershipContent): Run {
  const now = nowIso()
  return {
    ...fields,
    revisions: [],
    draft: { ...draft, baseRevision: null, updatedAt: now },
    calibration: [],
    masterOffers: [],
    outputParent: null,
    completion: "open",
    completedAt: null,
    stageBeforeComplete: null,
    trashedAt: null,
    notes: "",
    createdAt: now,
    revision: 1,
  }
}

export interface StartRunOutcome {
  result: CommitResult
  runId: RunId | null
  /** Set for a mosaic subject: one panel run per panel, one shared setup (D-W38). */
  groupId: RunGroupId | null
}

export interface StartRunOptions {
  /** Start from a selection: only these candidates are preselected. */
  sessionIds?: SessionId[]
  /** Mosaic: the panels that get a panel run; every panel by default. */
  panelIds?: string[]
  /** Mosaic: the user's placement of a candidate, overriding its pointing; null leaves it out of every panel. */
  placements?: Record<SessionId, string | null>
}

/**
 * Start a processing run (PRJ-FR-10, D-W49, D-W50): one subject and one rig
 * of the Project, fixed for good. The draft starts with every available
 * candidate selected (or the chosen ones), each with its reason. A mosaic
 * subject creates a run group instead, one panel run per included panel,
 * with each candidate placed on a panel by its pointing or by the user;
 * flagged sessions are left for the user to place (D-W38).
 */
export function startRun(projectId: ProjectId, subjectId: string, rigId: OpticalTrainId, options: StartRunOptions = {}): StartRunOutcome {
  const state = store.getState()
  const { catalog, disk } = state
  const project = catalog.projects[projectId]
  const subject = project ? findSubject(project, subjectId) : undefined
  if (!project || !subject) return { result: MISSING, runId: null, groupId: null }
  if (!project.rigIds.includes(rigId)) return { result: refuse("Start run refused", [`${rigName(catalog, rigId)} is not one of ${project.name}'s rigs`], `/projects/${projectId}`), runId: null, groupId: null }
  if (project.state !== "open") return { result: refuse("Start run refused", [`${project.name} is Done; Reopen it first`], `/projects/${projectId}`), runId: null, groupId: null }
  const chosen = options.sessionIds ? new Set(options.sessionIds) : null
  const candidates = projectCandidates(catalog, project).filter((c) => c.subject.id === subjectId && c.rigId === rigId && (!chosen || chosen.has(c.session.id)))
  const setup: RunSetup = { profileId: null, inputMode: null, calibrationPolicy: "automatic" }
  const rigShort = catalog.opticalTrains[rigId]?.name.split(" / ")[0] ?? "rig"
  if (!subject.mosaic) {
    const id = freshId("run", `${projectId}|${subjectId}|${rigId}`)
    const reason = (detail: string): SelectionReason => ({ kind: "candidate", detail })
    const draft = addSessions(emptyContent(), disk, catalog, candidates.map((c) => ({ session: c.session, reason: reason(c.reason) })))
    const run = newRun({ id, name: uniqueRunName(state, projectId, `${subjectName(catalog, subject)} ${rigShort}`), projectId, subjectId, panelId: null, groupId: null, rigId, setup }, draft)
    const result = commit(`Start ${run.name}`, (s) => withCatalog(s, (c) => ({ ...c, runs: { ...c.runs, [id]: run } })), { href: runHref(run) })
    if (result.ok) recordSaved(`Run started: ${run.name}`, `${plural(candidates.length, "candidate session")} preselected on ${rigName(catalog, rigId)}.`, runHref(run))
    return { result, runId: result.ok ? id : null, groupId: null }
  }
  const included = options.panelIds ? new Set(options.panelIds) : null
  const panels = subject.mosaic.panels.filter((p) => !included || included.has(p.id))
  if (panels.length === 0) return { result: refuse("Start run group refused", ["no panel is included"], `/projects/${projectId}`), runId: null, groupId: null }
  const placements = options.placements ?? {}
  const groupId = freshId("grp", `${projectId}|${subjectId}|${rigId}`)
  const runs: Run[] = panels.map((panel) => {
    const placed = candidates.flatMap((c): Array<{ session: typeof c.session; reason: SelectionReason }> => {
      if (c.session.id in placements) {
        return placements[c.session.id] === panel.id ? [{ session: c.session, reason: { kind: "panel-assigned", detail: `${c.reason} · placed on ${panelLabel(panel)}` } }] : []
      }
      const p = panelForSession(catalog, subject, c.session, rigId)
      return p.panelId === panel.id ? [{ session: c.session, reason: { kind: "panel-pointing", detail: `${c.reason} · ${p.detail}` } }] : []
    })
    return newRun(
      { id: freshId("run", `${groupId}|${panel.id}`), name: `${subject.mosaic!.name} ${panelLabel(panel)}`, projectId, subjectId, panelId: panel.id, groupId, rigId, setup: null },
      addSessions(emptyContent(), disk, catalog, placed),
    )
  })
  const group: RunGroup = {
    id: groupId,
    name: uniqueRunName(state, projectId, subject.mosaic.name),
    projectId,
    subjectId,
    rigId,
    runIds: runs.map((r) => r.id),
    setup,
    outputParent: null,
    createdAt: nowIso(),
    revision: 1,
  }
  const href = groupHref(group)
  const result = commit(
    `Start ${group.name}`,
    (s) => withCatalog(s, (c) => ({ ...c, runGroups: { ...c.runGroups, [groupId]: group }, runs: { ...c.runs, ...Object.fromEntries(runs.map((r) => [r.id, r])) } })),
    { href },
  )
  if (result.ok) recordSaved(`Run group started: ${group.name}`, `${plural(runs.length, "panel run")} on ${rigName(catalog, rigId)}.`, href)
  return { result, runId: null, groupId: result.ok ? groupId : null }
}

export interface EditRunOptions {
  /** Record "label: run name" in Activity (default); a caller with its own message passes false. */
  record?: boolean
  /** The step the Activity link opens; Select by default. */
  step?: RunStep
  /** Another write committed together with the run patch, e.g. a remembered setting. */
  also?: (state: PrototypeState) => PrototypeState
}

/** Patch one run in one commit, guarded by its revision; every run write goes through here. */
export function editRun(runId: RunId, label: string, update: (run: Run, state: PrototypeState) => Run, options: EditRunOptions = {}): CommitResult {
  const run = store.getState().catalog.runs[runId]
  if (!run) return MISSING
  const href = runHref(run, options.step)
  const result = commit(
    label,
    (s) => {
      const next = withCatalog(s, (c) => ({ ...c, runs: { ...c.runs, [runId]: update(c.runs[runId]!, s) } }))
      return options.also ? options.also(next) : next
    },
    { expect: { collection: "runs", id: runId, revision: run.revision }, href },
  )
  if (result.ok && options.record !== false) recordSaved(`${label}: ${run.name}`, null, href)
  return result
}

/** Why a run's membership cannot change now (VSEL-FR-17, D-W72); null when it can. */
function membershipLock(run: Run): string | null {
  if (run.trashedAt) return `${run.name} is in the Project's Trash; Restore it first`
  if (run.completion === "complete") return `${run.name} is Complete; Reopen it to change its membership`
  return null
}

/**
 * Edit the working membership. The draft starts from the latest revision;
 * an edit that returns to it clears the draft. Saved revisions never change
 * in place (D-W34).
 */
export function updateRunDraft(runId: RunId, label: string, change: (content: MembershipContent, state: PrototypeState) => MembershipContent): CommitResult {
  const run = store.getState().catalog.runs[runId]
  if (!run) return MISSING
  const lock = membershipLock(run)
  if (lock) return refuse(`${label} refused`, [lock], runHref(run))
  return editRun(
    runId,
    label,
    (current, state) => {
      const base = latestRevision(current)
      const working = current.draft ?? base ?? emptyContent()
      const next = contentOf(change(contentOf(working), state))
      if (base && contentEquals(next, base)) return { ...current, draft: null }
      return { ...current, draft: { ...next, baseRevision: current.draft?.baseRevision ?? base?.revision ?? null, updatedAt: nowIso() } }
    },
    { record: false },
  )
}

export function addRunSessions(runId: RunId, sessionIds: SessionId[], reason: SelectionReason): CommitResult {
  return updateRunDraft(runId, `Add ${plural(sessionIds.length, "session")}`, (content, s) =>
    addSessions(content, s.disk, s.catalog, sessionIds.flatMap((id) => (s.catalog.sessions[id] ? [{ session: s.catalog.sessions[id]!, reason }] : []))),
  )
}

export function removeRunSessions(runId: RunId, sessionIds: SessionId[]): CommitResult {
  return updateRunDraft(runId, `Remove ${plural(sessionIds.length, "session")}`, (content, s) => removeSessions(content, s.catalog, sessionIds))
}

/** Exclude from run: run scope only; files and library quality stay as they are (VSEL-FR-10). */
export function excludeRunFrames(runId: RunId, assetIds: string[]): CommitResult {
  return updateRunDraft(runId, `Exclude ${plural(assetIds.length, "frame")}`, (content) => excludeFrames(content, assetIds))
}

export function restoreRunFrames(runId: RunId, assetIds: string[]): CommitResult {
  return updateRunDraft(runId, `Restore ${plural(assetIds.length, "frame")}`, (content, s) => restoreFrames(s.disk, s.catalog, content, assetIds))
}

/** Accepted Results of other runs as inputs, any Project and any rig (D-W4, D-W56). */
export function setProductInputs(runId: RunId, resultIds: ResultId[]): CommitResult {
  return updateRunDraft(runId, `Product inputs (${resultIds.length})`, (content) => ({ ...content, productInputs: [...new Set(resultIds)] }))
}

/** Save run: commit the draft as the next membership revision, with the changes it accepted (VSEL-FR-12, VSEL-FR-16). */
export function saveRun(runId: RunId): CommitResult {
  const { catalog } = store.getState()
  const run = catalog.runs[runId]
  if (!run) return MISSING
  if (!run.draft) return { ok: true }
  const lock = membershipLock(run)
  if (lock) return refuse("Save run refused", [lock], runHref(run))
  const base = latestRevision(run)
  const accepted = describeDiff(catalog, diffContent(base, run.draft))
  const revision = (base?.revision ?? 0) + 1
  const result = editRun(runId, `Save revision ${revision}`, (current) => ({
    ...current,
    revisions: [...current.revisions, { ...contentOf(current.draft!), revision, savedAt: nowIso(), accepted }],
    draft: null,
  }))
  return result
}

/** Back to the latest revision; nothing else changes. */
export function discardRunDraft(runId: RunId): CommitResult {
  return editRun(runId, "Discard changes", (current) => ({ ...current, draft: null }), { record: false })
}

export function renameRun(runId: RunId, name: string): CommitResult {
  return editRun(runId, "Rename run", (current) => ({ ...current, name: name.trim() }))
}

/**
 * Setup (profile, input mode, calibration policy). For a panel run the
 * group's shared setup changes, and with it every panel run (D-W38).
 */
export function setRunSetup(runId: RunId, patch: Partial<RunSetup>): CommitResult {
  const { catalog } = store.getState()
  const run = catalog.runs[runId]
  if (!run) return MISSING
  if (run.groupId) return setGroupSetup(run.groupId, patch)
  return editRun(runId, "Run setup", (current, s) => ({ ...current, setup: { ...runSetup(s.catalog, current), ...patch } }), { step: "prepare" })
}

export function setGroupSetup(groupId: RunGroupId, patch: Partial<RunSetup>): CommitResult {
  const group = store.getState().catalog.runGroups[groupId]
  if (!group) return MISSING
  const href = groupHref(group, "prepare")
  const result = commit(
    "Group setup",
    (s) => withCatalog(s, (c) => ({ ...c, runGroups: { ...c.runGroups, [groupId]: { ...c.runGroups[groupId]!, setup: { ...c.runGroups[groupId]!.setup, ...patch } } } })),
    { expect: { collection: "runGroups", id: groupId, revision: group.revision }, href },
  )
  if (result.ok) recordSaved(`Group setup: ${group.name}`, `Applies to ${plural(group.runIds.length, "panel run")}.`, href)
  return result
}

/**
 * Complete (RES-FR-06, RES-FR-07): records completion even with no accepted
 * Result and removes nothing. Refused only while an operation affecting the
 * run is Running. The current step is kept so Reopen returns there.
 */
export function completeRun(runId: RunId): CommitResult {
  const state = store.getState()
  const run = state.catalog.runs[runId]
  if (!run) return MISSING
  if (run.trashedAt) return refuse("Complete refused", [`${run.name} is in the Project's Trash`], runHref(run))
  const blockers = completeRefusals(state, run)
  if (blockers.length > 0) return refuse(`Complete ${run.name} refused`, blockers, runHref(run, "done"))
  const stage = runPipeline(state, run).current.id
  return editRun(runId, "Complete", (current) => ({ ...current, completion: "complete", completedAt: nowIso(), stageBeforeComplete: stage }), { step: "done" })
}

/** Reopen returns the run to the step it was in (D-W71 as kept by D-W72); returns that step. */
export function reopenRun(runId: RunId): { result: CommitResult; step: RunStep } {
  const run = store.getState().catalog.runs[runId]
  if (!run) return { result: MISSING, step: "select" }
  const step = run.stageBeforeComplete ?? "select"
  const result = editRun(runId, "Reopen", (current) => ({ ...current, completion: "open", completedAt: null, stageBeforeComplete: null }), { step })
  return { result, step }
}

/**
 * Move run to Trash (D-W72, RES-FR-10): soft delete at any stage. Refused
 * while an operation affecting the run is Running and while one of its
 * accepted Results is an input to another run; the refusal names each
 * blocker. Moves no file.
 */
export function trashRun(runId: RunId): CommitResult {
  const state = store.getState()
  const run = state.catalog.runs[runId]
  if (!run) return MISSING
  const blockers = trashRefusals(state, run)
  if (blockers.length > 0) return refuse(`Move ${run.name} to Trash refused`, blockers, runHref(run))
  return editRun(runId, "Move to Trash", (current) => ({ ...current, trashedAt: nowIso() }))
}

/** Restore brings the run back exactly as it was: membership, preparations, Results and stage (D-W72). */
export function restoreRun(runId: RunId): CommitResult {
  return editRun(runId, "Restore", (current) => ({ ...current, trashedAt: null }))
}

/**
 * Empty Trash (D-W72, RES-FR-10) for trashed runs of one Project: their
 * prepared folders go to the OS Trash, and their Results folders too when
 * ticked. Library frames and quality decisions are never touched. The run
 * records are removed once the Trash episode settles.
 */
export function emptyTrash(projectId: ProjectId, runIds: RunId[], tickedResults: RunId[]): CommitResult {
  const state = store.getState()
  const runs = runIds.map((id) => state.catalog.runs[id]).filter((r): r is Run => r !== undefined && r.projectId === projectId && r.trashedAt !== null)
  if (runs.length === 0) return refuse("Empty Trash refused", ["no trashed run was chosen"], `/projects/${projectId}/trash`)
  const items = runs.flatMap((run) => [...preparedEntryItems(state, run.id), ...(tickedResults.includes(run.id) ? resultItems(state, run.id) : [])])
  moveToOsTrash({
    kind: "empty-trash",
    title: `Empty Trash: ${plural(runs.length, "run")}`,
    projectId,
    runIds: runs.map((r) => r.id),
    items,
    removeRunIds: runs.map((r) => r.id),
    href: `/projects/${projectId}/trash`,
  })
  return { ok: true }
}
