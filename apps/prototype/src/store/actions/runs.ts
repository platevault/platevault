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
  panelRef,
  projectCandidates,
  rigRef,
  runHref,
  runPipeline,
  runSetup,
  subjectRef,
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
import { formatCount } from "@/lib/format"
import { joinRefs, m, type MessageRef, msg, say, verbatim } from "@/lib/i18n"
import { type CommitResult, commit, nowIso, type PrototypeState, store, withCatalog } from "@/store/core"
import { freshId, MISSING, recordSaved, refuse } from "./shared"
import { moveToOsTrash, preparedEntryItems, resultItems } from "./trash"

/** Names the Project's runs and run groups already use: a new run or group never repeats one. */
function takenNames(state: PrototypeState, projectId: ProjectId): Set<string> {
  const runs = Object.values(state.catalog.runs).filter((r) => r.projectId === projectId)
  const groups = Object.values(state.catalog.runGroups).filter((g) => g.projectId === projectId)
  return new Set([...runs, ...groups].map((r) => r.name))
}

/** `base`, or "base (2)", "base (3)" … when taken; the name is added to `taken`. */
function uniqueName(taken: Set<string>, base: string): string {
  let name = base
  for (let n = 2; taken.has(name); n += 1) name = `${base} (${n})`
  taken.add(name)
  return name
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
  if (!project.rigIds.includes(rigId)) {
    return { result: refuse(msg("store_refused", { label: msg("startrun_title") }), [msg("store_reason_rig_not_in_project", { rig: rigRef(catalog, rigId), project: project.name })], `/projects/${projectId}`), runId: null, groupId: null }
  }
  if (project.state !== "open") return { result: refuse(msg("store_refused", { label: msg("startrun_title") }), [msg("store_reason_project_done", { project: project.name })], `/projects/${projectId}`), runId: null, groupId: null }
  const chosen = options.sessionIds ? new Set(options.sessionIds) : null
  const candidates = projectCandidates(catalog, project).filter((c) => c.subject.id === subjectId && c.rigId === rigId && (!chosen || chosen.has(c.session.id)))
  const setup: RunSetup = { profileId: null, inputMode: null, calibrationPolicy: "automatic" }
  const taken = takenNames(state, projectId)
  // A new run's name is data from here on: worded once, in the language of the moment.
  const rigShort = say(m, rigRef(catalog, rigId)).split(" / ")[0]!
  if (!subject.mosaic) {
    const id = freshId("run", `${projectId}|${subjectId}|${rigId}`)
    const draft = addSessions(emptyContent(), disk, catalog, candidates.map((c) => ({ session: c.session, reason: { kind: "candidate", detail: c.reason } })))
    const run = newRun({ id, name: uniqueName(taken, `${say(m, subjectRef(catalog, subject))} ${rigShort}`), projectId, subjectId, panelId: null, groupId: null, rigId, setup }, draft)
    const result = commit(msg("store_label_start", { name: run.name }), (s) => withCatalog(s, (c) => ({ ...c, runs: { ...c.runs, [id]: run } })), { href: runHref(run) })
    if (result.ok) {
      recordSaved(msg("store_saved_run_started", { name: run.name }), msg("store_run_started_detail", { count: candidates.length, n: formatCount(candidates.length), rig: rigRef(catalog, rigId) }), runHref(run))
    }
    return { result, runId: result.ok ? id : null, groupId: null }
  }
  const included = options.panelIds ? new Set(options.panelIds) : null
  const panels = subject.mosaic.panels.filter((p) => !included || included.has(p.id))
  if (panels.length === 0) return { result: refuse(msg("store_refused", { label: msg("store_label_start_group") }), [msg("store_reason_no_panel")], `/projects/${projectId}`), runId: null, groupId: null }
  const placements = options.placements ?? {}
  const groupId = freshId("grp", `${projectId}|${subjectId}|${rigId}`)
  const groupName = uniqueName(taken, subject.mosaic.name)
  const runs: Run[] = panels.map((panel) => {
    const placed = candidates.flatMap((c): Array<{ session: typeof c.session; reason: SelectionReason }> => {
      if (c.session.id in placements) {
        return placements[c.session.id] === panel.id ? [{ session: c.session, reason: { kind: "panel-assigned", detail: joinRefs([c.reason, msg("store_placed_on", { panel: panelRef(panel) })], " · ") } }] : []
      }
      const p = panelForSession(catalog, subject, c.session, rigId)
      return p.panelId === panel.id ? [{ session: c.session, reason: { kind: "panel-pointing", detail: joinRefs([c.reason, p.detail], " · ") } }] : []
    })
    return newRun(
      { id: freshId("run", `${groupId}|${panel.id}`), name: uniqueName(taken, `${groupName} ${say(m, panelRef(panel))}`), projectId, subjectId, panelId: panel.id, groupId, rigId, setup: null },
      addSessions(emptyContent(), disk, catalog, placed),
    )
  })
  const group: RunGroup = {
    id: groupId,
    name: groupName,
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
    msg("store_label_start", { name: group.name }),
    (s) => withCatalog(s, (c) => ({ ...c, runGroups: { ...c.runGroups, [groupId]: group }, runs: { ...c.runs, ...Object.fromEntries(runs.map((r) => [r.id, r])) } })),
    { href },
  )
  if (result.ok) recordSaved(msg("store_saved_group_started", { name: group.name }), msg("store_group_started_detail", { count: runs.length, n: formatCount(runs.length), rig: rigRef(catalog, rigId) }), href)
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
export function editRun(runId: RunId, label: MessageRef, update: (run: Run, state: PrototypeState) => Run, options: EditRunOptions = {}): CommitResult {
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
  if (result.ok && options.record !== false) recordSaved(joinRefs([label, verbatim(run.name)], ": "), null, href)
  return result
}

/** Why a run's membership cannot change now (VSEL-FR-17, D-W72); null when it can. */
function membershipLock(run: Run): MessageRef | null {
  if (run.trashedAt) return msg("store_lock_trashed", { name: run.name })
  if (run.completion === "complete") return msg("store_lock_complete", { name: run.name })
  return null
}

/**
 * Edit the working membership. The draft starts from the latest revision;
 * an edit that returns to it clears the draft. Saved revisions never change
 * in place (D-W34).
 */
export function updateRunDraft(runId: RunId, label: MessageRef, change: (content: MembershipContent, state: PrototypeState) => MembershipContent): CommitResult {
  const run = store.getState().catalog.runs[runId]
  if (!run) return MISSING
  const lock = membershipLock(run)
  if (lock) return refuse(msg("store_refused", { label }), [lock], runHref(run))
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
  return updateRunDraft(runId, msg("store_label_add_sessions", { count: sessionIds.length, n: formatCount(sessionIds.length) }), (content, s) =>
    addSessions(content, s.disk, s.catalog, sessionIds.flatMap((id) => (s.catalog.sessions[id] ? [{ session: s.catalog.sessions[id]!, reason }] : []))),
  )
}

export function removeRunSessions(runId: RunId, sessionIds: SessionId[]): CommitResult {
  return updateRunDraft(runId, msg("store_label_remove_sessions", { count: sessionIds.length, n: formatCount(sessionIds.length) }), (content, s) => removeSessions(content, s.catalog, sessionIds))
}

/** Exclude from run: run scope only; files and library quality stay as they are (VSEL-FR-10). */
export function excludeRunFrames(runId: RunId, assetIds: string[]): CommitResult {
  return updateRunDraft(runId, msg("store_label_exclude_frames", { count: assetIds.length, n: formatCount(assetIds.length) }), (content) => excludeFrames(content, assetIds))
}

export function restoreRunFrames(runId: RunId, assetIds: string[]): CommitResult {
  return updateRunDraft(runId, msg("store_label_restore_frames", { count: assetIds.length, n: formatCount(assetIds.length) }), (content, s) => restoreFrames(s.disk, s.catalog, content, assetIds))
}

/** Accepted Results of other runs as inputs, any Project and any rig (D-W4, D-W56). */
export function setProductInputs(runId: RunId, resultIds: ResultId[]): CommitResult {
  return updateRunDraft(runId, msg("store_label_product_inputs", { count: resultIds.length }), (content) => ({ ...content, productInputs: [...new Set(resultIds)] }))
}

/** Save run: commit the draft as the next membership revision, with the changes it accepted (VSEL-FR-12, VSEL-FR-16). */
export function saveRun(runId: RunId): CommitResult {
  const { catalog } = store.getState()
  const run = catalog.runs[runId]
  if (!run) return MISSING
  if (!run.draft) return { ok: true }
  const lock = membershipLock(run)
  if (lock) return refuse(msg("store_refused", { label: msg("domain_next_save_run") }), [lock], runHref(run))
  const base = latestRevision(run)
  const accepted = describeDiff(catalog, diffContent(base, run.draft))
  const revision = (base?.revision ?? 0) + 1
  const result = editRun(runId, msg("run_save_revision", { revision }), (current) => ({
    ...current,
    revisions: [...current.revisions, { ...contentOf(current.draft!), revision, savedAt: nowIso(), accepted }],
    draft: null,
  }))
  return result
}

/** Back to the latest revision; nothing else changes. */
export function discardRunDraft(runId: RunId): CommitResult {
  return editRun(runId, msg("store_label_discard"), (current) => ({ ...current, draft: null }), { record: false })
}

export function renameRun(runId: RunId, name: string): CommitResult {
  return editRun(runId, msg("store_label_rename_run"), (current) => ({ ...current, name: name.trim() }))
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
  return editRun(runId, msg("store_label_run_setup"), (current, s) => ({ ...current, setup: { ...runSetup(s.catalog, current), ...patch } }), { step: "prepare" })
}

export function setGroupSetup(groupId: RunGroupId, patch: Partial<RunSetup>): CommitResult {
  const group = store.getState().catalog.runGroups[groupId]
  if (!group) return MISSING
  const href = groupHref(group, "prepare")
  const result = commit(
    msg("store_label_group_setup"),
    (s) => withCatalog(s, (c) => ({ ...c, runGroups: { ...c.runGroups, [groupId]: { ...c.runGroups[groupId]!, setup: { ...c.runGroups[groupId]!.setup, ...patch } } } })),
    { expect: { collection: "runGroups", id: groupId, revision: group.revision }, href },
  )
  if (result.ok) recordSaved(joinRefs([msg("store_label_group_setup"), verbatim(group.name)], ": "), msg("store_group_setup_detail", { count: group.runIds.length, n: formatCount(group.runIds.length) }), href)
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
  if (run.trashedAt) return refuse(msg("store_refused", { label: msg("run_complete") }), [msg("store_reason_in_trash", { name: run.name })], runHref(run))
  const blockers = completeRefusals(state, run)
  if (blockers.length > 0) return refuse(msg("store_refused", { label: msg("store_label_complete_named", { name: run.name }) }), blockers, runHref(run, "done"))
  const stage = runPipeline(state, run).current.id
  return editRun(runId, msg("run_complete"), (current) => ({ ...current, completion: "complete", completedAt: nowIso(), stageBeforeComplete: stage }), { step: "done" })
}

/** Reopen returns the run to the step it was in (D-W71 as kept by D-W72); returns that step. */
export function reopenRun(runId: RunId): { result: CommitResult; step: RunStep } {
  const run = store.getState().catalog.runs[runId]
  if (!run) return { result: MISSING, step: "select" }
  const step = run.stageBeforeComplete ?? "select"
  const result = editRun(runId, msg("project_reopen"), (current) => ({ ...current, completion: "open", completedAt: null, stageBeforeComplete: null }), { step })
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
  if (blockers.length > 0) return refuse(msg("store_refused", { label: msg("store_label_move_to_trash_named", { name: run.name }) }), blockers, runHref(run))
  return editRun(runId, msg("run_move_to_trash"), (current) => ({ ...current, trashedAt: nowIso() }))
}

/** Restore brings the run back exactly as it was: membership, preparations, Results and stage (D-W72). */
export function restoreRun(runId: RunId): CommitResult {
  return editRun(runId, msg("project_restore"), (current) => ({ ...current, trashedAt: null }))
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
  if (runs.length === 0) return refuse(msg("store_refused", { label: msg("trash_empty") }), [msg("store_reason_no_trashed_run")], `/projects/${projectId}/trash`)
  const items = runs.flatMap((run) => [...preparedEntryItems(state, run.id), ...(tickedResults.includes(run.id) ? resultItems(state, run.id) : [])])
  moveToOsTrash({
    kind: "empty-trash",
    title: joinRefs([msg("trash_empty"), msg("store_runs_count", { count: runs.length, n: formatCount(runs.length) })], ": "),
    projectId,
    runIds: runs.map((r) => r.id),
    items,
    removeRunIds: runs.map((r) => r.id),
    href: `/projects/${projectId}/trash`,
  })
  return { ok: true }
}
