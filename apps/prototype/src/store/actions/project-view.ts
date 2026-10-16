/**
 * The Project View lifecycle (F4: VSEL-FR-12 to VSEL-FR-21, PREP-FR-06 to
 * PREP-FR-19, RES-FR-01/02/11, CAL-FR-06): Apply, discarding the Project's
 * own pending edits, reviewing `View (previous)/`, Copy to Output, Output
 * records and the generated-master offers. Every plan, refusal and offer is
 * the domain's (`domain/project-view.ts`); this module only writes.
 *
 * Apply is one "apply" operation (`PROJECT_VIEW_HANDLERS`), phases:
 * - building: every planned entry is placed under `View (building)/` from
 *   its original only (`placeEntry`), never from the current View;
 * - verifying: every placed entry reads back as written and every original
 *   still holds the bytes the plan read (PREP-FR-09);
 * - waiting: a tool holds a file in the View (Windows): Apply waits there
 *   and continues by itself once it is released (PREP-FR-18);
 * - swapping: the new View swaps in. The old View's verified copies are
 *   deleted outright and its links removed; a copy that differs from what
 *   PlateVault placed, a copy whose original cannot be verified and each
 *   unticked file PlateVault didn't place stay in `View (previous)/`; ticked
 *   ones move into the new View (D-W110).
 * A failure or Cancel before the swap removes `View (building)/` and leaves
 * the old View exactly as it was. One PlateVault operation per Project at a
 * time (`projectOperation`, provisional).
 */
import { fileAt, filesUnder, freeBytes, makeFile, removeFile, trashRefusal, volumeForPath, writeFiles } from "@/domain/disk"
import { adoptionDestination, adoptionDestinationState, calibrationStorage } from "@/domain/calibration-process"
import { projectHref } from "@/domain/derive"
import { ingestFiles, isUnder } from "@/domain/indexing"
import { unitCount } from "@/domain/labels"
import {
  applyPlan,
  applyRefusalRef,
  appliedViewFor,
  copyToOutputRefusal,
  entryVerified,
  isDiscardable,
  type PendingChange,
  pendingChanges,
  type PlannedEntry,
  placeEntry,
  processingMasters,
  type ProjectPaths,
  projectPaths,
  SIRIL_TOOL,
  type SirilSet,
  toolFolder,
  unreviewedLeftovers,
  viewDrift,
} from "@/domain/project-view"
import type { DiskFile, InputMode, Operation, OperationId, OutputKind, PreviousLeftover, Project, ProjectId, ViewEntry, ViewLayout, VolumeId } from "@/domain/types"
import { fileName, formatCount } from "@/lib/format"
import { joinRefs, type MessageRef, msg, verbatim } from "@/lib/i18n"
import { type CommitResult, commit, nowIso, type PrototypeState, store, withCatalog } from "@/store/core"
import { addOperation, ensureTicker, type OperationHandler, patchOperation, settleOperation } from "@/store/operations"
import { editProject } from "./projects"
import { closedRefusal, MISSING, recordSaved, refuse } from "./shared"
import { moveToOsTrash } from "./trash"

const viewHref = (projectId: ProjectId) => projectHref(projectId, { stage: "view" })
const outputHref = (projectId: ProjectId) => projectHref(projectId, { stage: "output" })

/** Move a file to another path on its volume: the same bytes and inode. */
function moveFile(disk: PrototypeState["disk"], file: DiskFile, path: string): PrototypeState["disk"] {
  return writeFiles(removeFile(disk, file.volumeId, file.path), [{ ...file, path }])
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/** What the open Apply sheet shows the user: the plan it was built from, and the files PlateVault didn't place that the user ticked to keep in the new View. */
export interface ApplySheet {
  /** `ApplyPlan.fingerprint` when the sheet opened: Apply is refused when anything changed since (VSEL-FR-21, provisional). */
  fingerprint: string
  /** Paths under `View/` of the unplaced files to move into the new View; the rest stay in `View (previous)/`. */
  tickedUnplaced: string[]
}

export type ApplyPhase = "building" | "verifying" | "waiting" | "swapping"

interface ApplyPayload {
  projectId: ProjectId
  phase: ApplyPhase
  mode: InputMode
  paths: ProjectPaths
  layout: ViewLayout
  planned: PlannedEntry[]
  /** How many planned entries were placed so far, in order. */
  next: number
  placed: ViewEntry[]
  /** Siril's working sets to link into `Processing/Siril/` after the swap (PREP-FR-17, provisional); null for another application. */
  siril: SirilSet[] | null
  ticked: string[]
}

/** The phase a running Apply is in, for its progress row ("Waiting for a tool to release a file in View"). */
export function applyPhase(op: Operation): ApplyPhase | null {
  return op.kind === "apply" ? (op.payload as unknown as ApplyPayload).phase : null
}

/**
 * What a swap of the current View would leave in `View (previous)/`: copies
 * that differ from what PlateVault placed, copies whose original cannot be
 * verified, and the unplaced files left unticked (VSEL-FR-14, D-W110).
 */
export function outgoingSurvivors(state: Pick<PrototypeState, "disk">, project: Project, ticked: ReadonlyArray<string>): Array<Omit<PreviousLeftover, "kept">> {
  const view = project.view
  if (!view) return []
  const out: Array<Omit<PreviousLeftover, "kept">> = []
  for (const entry of view.entries) {
    if (entry.copySha256 === null) continue
    const file = fileAt(state.disk, `${view.folderPath}/${entry.path}`)
    if (!file) continue
    if (file.sha256 !== entry.copySha256) out.push({ path: entry.path, reason: "changed-copy", sizeBytes: file.sizeBytes })
    else if (fileAt(state.disk, entry.originalPath)?.sha256 !== entry.sha256) out.push({ path: entry.path, reason: "unverified-copy", sizeBytes: file.sizeBytes })
  }
  const keep = new Set(ticked)
  for (const file of viewDrift(state, project).unplaced) if (!keep.has(file.path)) out.push({ path: file.path, reason: "unplaced", sizeBytes: file.sizeBytes })
  return out
}

/**
 * Kept files already in `View (previous)/` while this Apply would leave more
 * there: refused until the kept files are moved out, or every file
 * PlateVault didn't place is ticked (stopgap: what a second swap does with
 * kept files is OPEN, decision record §9, so no merge is encoded here).
 */
function previousKeptRefusal(state: Pick<PrototypeState, "disk">, project: Project, ticked: ReadonlyArray<string>): MessageRef | null {
  const kept = project.previous?.leftovers.filter((l) => l.kept) ?? []
  if (kept.length === 0 || outgoingSurvivors(state, project, ticked).length === 0) return null
  return msg("apply_refused_previous_kept", { count: kept.length })
}

/**
 * Apply (VSEL-FR-14, PREP-FR-06): refused when the sheet is stale (it
 * refreshes with the latest changes), for every refusal the plan names, and
 * while kept files in `View (previous)/` would meet new ones. Otherwise the
 * "apply" operation starts; returns its id.
 */
export function startApply(projectId: ProjectId, sheet: ApplySheet): { result: CommitResult; operationId: OperationId | null } {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  if (!project) return { result: MISSING, operationId: null }
  const label = msg("common_apply_named", { name: project.name })
  const closed = closedRefusal(project, label)
  if (closed) return { result: closed, operationId: null }
  const plan = applyPlan(state, project)
  const title = msg("store_refused", { label })
  if (plan.fingerprint !== sheet.fingerprint) return { result: refuse(title, [msg("apply_refused_changed")], viewHref(projectId)), operationId: null }
  const reasons = plan.refusals.map(applyRefusalRef)
  const kept = previousKeptRefusal(state, project, sheet.tickedUnplaced)
  if (kept) reasons.push(kept)
  if (reasons.length > 0 || !plan.paths) return { result: refuse(title, reasons.length > 0 ? reasons : [msg("apply_refused_no_folder")], viewHref(projectId)), operationId: null }
  const payload: ApplyPayload = { projectId, phase: "building", mode: plan.mode, paths: plan.paths, layout: plan.plan.layout, planned: plan.plan.entries, next: 0, placed: [], siril: plan.siril, ticked: [...sheet.tickedUnplaced] }
  let operationId: OperationId | null = null
  const result = commit(
    label,
    (s) => {
      const added = addOperation(s, {
        kind: "apply",
        title: label,
        scope: { projectId, sessionIds: project.inputs.map((i) => i.sessionId) },
        total: plan.plan.entries.length,
        unit: "entries",
        items: plan.plan.entries.map((e) => ({ id: e.path, label: verbatim(fileName(e.path)), path: `${plan.paths!.view}/${e.path}`, status: "pending", phase: null, detail: null })),
        payload: payload as unknown as Record<string, unknown>,
        canCancel: true,
      })
      operationId = added.id
      return added.state
    },
    { href: viewHref(projectId) },
  )
  if (result.ok) ensureTicker()
  return { result, operationId: result.ok ? operationId : null }
}

/** Remove what a build wrote under `View (building)/`; the current View stays exactly as it was. */
function removeBuilding(state: PrototypeState, payload: ApplyPayload): PrototypeState {
  let disk = state.disk
  for (const file of filesUnder(disk, payload.paths.building)) disk = removeFile(disk, file.volumeId, file.path)
  return { ...state, disk }
}

function failApply(state: PrototypeState, op: Operation, payload: ApplyPayload, reason: MessageRef, itemId: string | null): PrototypeState {
  const next = patchOperation(removeBuilding(state, payload), op.id, {
    items: op.items.map((item) => (item.id === itemId ? { ...item, status: "failed", detail: reason } : item.status === "pending" || item.status === "running" ? { ...item, status: "skipped", detail: null } : item)),
    payload: payload as unknown as Record<string, unknown>,
  })
  return settleOperation(next, op.id, "failed", joinRefs([msg("op_apply_failed"), reason], " · "), viewHref(payload.projectId))
}

const BUILD_BATCH = 24

function build(state: PrototypeState, op: Operation, payload: ApplyPayload): PrototypeState {
  let disk = state.disk
  const at = nowIso()
  const placed = [...payload.placed]
  const done = new Map<string, MessageRef>()
  let next = payload.next
  for (const planned of payload.planned.slice(payload.next, payload.next + BUILD_BATCH)) {
    const result = placeEntry(disk, planned, payload.paths.building, payload.mode, at)
    if (!result.ok) return failApply({ ...state, disk }, op, { ...payload, placed, next }, result.reason, planned.path)
    disk = writeFiles(disk, [result.file])
    placed.push(result.entry)
    done.set(planned.path, result.entry.copySha256 === null ? msg("op_apply_linked") : msg("op_apply_copied"))
    next += 1
  }
  const phase: ApplyPhase = next >= payload.planned.length ? "verifying" : "building"
  return patchOperation({ ...state, disk }, op.id, {
    items: op.items.map((item) => (done.has(item.id) ? { ...item, status: "done", phase: "written", detail: done.get(item.id)! } : item)),
    progress: { ...op.progress, done: next },
    payload: { ...payload, phase, next, placed } as unknown as Record<string, unknown>,
  })
}

function verify(state: PrototypeState, op: Operation, payload: ApplyPayload): PrototypeState {
  const project = state.catalog.projects[payload.projectId]
  if (!project) return failApply(state, op, payload, msg("store_record_missing"), null)
  for (const entry of payload.placed) {
    if (fileAt(state.disk, entry.originalPath)?.sha256 !== entry.sha256) return failApply(state, op, payload, msg("op_prep_source_drift", { source: verbatim(entry.originalPath) }), entry.path)
    if (!entryVerified(state.disk, payload.paths.building, entry)) return failApply(state, op, payload, msg("op_prep_reread_failed", { path: `${payload.paths.building}/${entry.path}` }), entry.path)
  }
  const kept = previousKeptRefusal(state, project, payload.ticked)
  if (kept) return failApply(state, op, payload, kept, null)
  const phase: ApplyPhase = project.view && state.faults.viewFileHeld ? "waiting" : "swapping"
  const next = patchOperation(state, op.id, {
    items: op.items.map((item) => (item.status === "done" ? { ...item, phase: "verified", detail: msg("op_prep_written_verified") } : item)),
    payload: { ...payload, phase } as unknown as Record<string, unknown>,
  })
  return phase === "swapping" ? swap(next, next.operations[op.id]!, { ...payload, phase }) : next
}

/**
 * Siril's working sets after the swap (PREP-FR-17, provisional): the links
 * an earlier Apply placed in `Processing/Siril/` go, and each set's
 * `lights/`, `flats/`, `darks/` and `biases/` link the new View's entries.
 * Anything else there (Siril's own `process/`) stays.
 */
function linkSirilSets(disk: PrototypeState["disk"], volumeId: VolumeId, paths: ProjectPaths, sets: SirilSet[], at: string): PrototypeState["disk"] {
  const root = toolFolder(paths, SIRIL_TOOL)
  let next = disk
  for (const file of filesUnder(next, root)) if (file.linkTarget && isUnder(file.linkTarget, paths.view)) next = removeFile(next, file.volumeId, file.path)
  const links = sets.flatMap((set) =>
    set.links.map((link) => {
      const target = `${paths.view}/${link.target}`
      return makeFile({ path: `${root}/${set.name}/${link.folder}/${link.name}`, volumeId, sizeBytes: 0, kind: fileAt(next, target)?.kind ?? "fits", linkTarget: target, modifiedAt: at })
    }),
  )
  return writeFiles(next, links)
}

/** The swap (PREP-FR-06, D-W110): the new View in, the old one cleared into `View (previous)/`, the applied state recorded. */
function swap(state: PrototypeState, op: Operation, payload: ApplyPayload): PrototypeState {
  const project = state.catalog.projects[payload.projectId]!
  const at = nowIso()
  const { paths } = payload
  let disk = state.disk
  const survivors = outgoingSurvivors(state, project, payload.ticked)
  const toPrevious = new Set(survivors.map((s) => s.path))
  const old = project.view
  const ticked: string[] = []
  if (old) {
    const placed = new Set(old.entries.map((e) => e.path))
    for (const file of filesUnder(disk, old.folderPath)) {
      const relative = file.path.slice(old.folderPath.length + 1)
      if (toPrevious.has(relative)) disk = moveFile(disk, file, `${paths.previous}/${relative}`)
      else if (placed.has(relative)) disk = removeFile(disk, file.volumeId, file.path)
      else ticked.push(relative)
    }
  }
  // The ticked files PlateVault didn't place step aside while the new View swaps in (within this one step), then move into it;
  // one whose name the new View holds goes to View (previous)/ instead.
  const swapFolder = `${paths.root}/.platevault-swap`
  for (const relative of ticked) disk = moveFile(disk, fileAt(disk, `${paths.view}/${relative}`)!, `${swapFolder}/${relative}`)
  for (const file of filesUnder(disk, paths.building)) disk = moveFile(disk, file, `${paths.view}${file.path.slice(paths.building.length)}`)
  const clashes: Array<Omit<PreviousLeftover, "kept">> = []
  for (const relative of ticked) {
    const file = fileAt(disk, `${swapFolder}/${relative}`)!
    if (fileAt(disk, `${paths.view}/${relative}`)) {
      clashes.push({ path: relative, reason: "unplaced", sizeBytes: file.sizeBytes })
      disk = moveFile(disk, file, `${paths.previous}/${relative}`)
    } else disk = moveFile(disk, file, `${paths.view}/${relative}`)
  }
  const volumeId = volumeForPath(disk, paths.root)
  if (volumeId) for (const folder of [paths.view, paths.processing, paths.output]) disk = { ...disk, folders: disk.folders.some((f) => f.volumeId === volumeId && f.path === folder) ? disk.folders : [...disk.folders, { volumeId, path: folder }] }
  if (volumeId && payload.siril) disk = linkSirilSets(disk, volumeId, paths, payload.siril, at)
  const kept = project.previous?.leftovers.filter((l) => l.kept) ?? []
  const leftovers: PreviousLeftover[] = [...kept, ...[...survivors, ...clashes].map((l) => ({ ...l, kept: false }))]
  const previous = leftovers.length > 0 ? { folderPath: paths.previous, at, leftovers } : null
  const view = appliedViewFor(state, project, paths.view, payload.placed, payload.layout, at, op.id)
  const parent = paths.root.slice(0, paths.root.lastIndexOf("/"))
  let next: PrototypeState = {
    ...state,
    disk,
    settings: { ...state.settings, lastProcessingParent: parent },
    catalog: { ...state.catalog, projects: { ...state.catalog.projects, [project.id]: { ...project, folderPath: paths.root, view, previous, revision: project.revision + 1 } } },
  }
  next = patchOperation(next, op.id, { payload: { ...payload, phase: "swapping" } as unknown as Record<string, unknown>, progress: { ...op.progress, done: op.progress.total } })
  const left = leftovers.length - kept.length
  const summary = joinRefs([msg("op_apply_swapped", { entries: unitCount("entries", payload.placed.length) }), ...(left > 0 ? [msg("op_apply_left_previous", { count: left, n: formatCount(left) })] : [])], " · ")
  return settleOperation(next, op.id, "succeeded", summary, viewHref(project.id))
}

const applyHandler: OperationHandler = {
  kind: "apply",
  step(state, op) {
    const payload = op.payload as unknown as ApplyPayload
    if (payload.phase === "building") return build(state, op, payload)
    if (payload.phase === "verifying") return verify(state, op, payload)
    if (payload.phase === "waiting") return state.faults.viewFileHeld ? state : swap(state, op, { ...payload, phase: "swapping" })
    return state
  },
  cancel: (state, op) => removeBuilding(state, op.payload as unknown as ApplyPayload),
  href: (op) => viewHref((op.payload as unknown as ApplyPayload).projectId),
}

// ---------------------------------------------------------------------------
// Pending changes (VSEL-FR-12, D-W109)
// ---------------------------------------------------------------------------

/** Project with one of its own pending edits undone against the applied View. */
function undo(project: Project, change: PendingChange): Project {
  const view = project.view!
  const applied = (sessionId: string) => view.inputs.find((i) => i.sessionId === sessionId)
  switch (change.kind) {
    case "session-added":
      return { ...project, inputs: project.inputs.filter((i) => i.sessionId !== change.sessionId) }
    case "session-removed": {
      const input = applied(change.sessionId)
      return input ? { ...project, inputs: [...project.inputs, structuredClone(input)] } : project
    }
    case "session-moved":
      return { ...project, inputs: project.inputs.map((i) => (i.sessionId === change.sessionId ? { ...i, groupId: change.from } : i)) }
    case "frames-excluded":
    case "frames-included": {
      const input = applied(change.sessionId)
      return input ? { ...project, inputs: project.inputs.map((i) => (i.sessionId === change.sessionId ? { ...i, excluded: [...input.excluded], included: [...input.included] } : i)) } : project
    }
    case "group-renamed":
      return { ...project, groups: project.groups.map((g) => (g.id === change.groupId ? { ...g, name: change.from } : g)) }
    case "mode-changed":
      return { ...project, settings: { ...project.settings, mode: change.from } }
    case "application-changed":
      return { ...project, settings: { ...project.settings, profileId: change.from } }
    case "keywords-changed":
      return { ...project, settings: { ...project.settings, keywords: change.from } }
    default:
      return project
  }
}

/**
 * Discard (D-W109): undo the Project's own pending edits, all of them or the
 * ones named. A change that came from the Library or a session's
 * calibration is refused: it is fixed at its source, or by removing the
 * session. Groups the Project made since Apply that are left empty go.
 * Refused on a Closed Project, which has no pending changes to discard.
 */
export function discardChanges(projectId: ProjectId, changeIds: string[] | "all"): CommitResult {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  if (!project) return MISSING
  const label = msg("project_label_discard")
  const closed = closedRefusal(project, label)
  if (closed) return closed
  const changes = pendingChanges(state, project).filter((c) => changeIds === "all" || changeIds.includes(c.id))
  const fixedAtSource = changeIds === "all" ? [] : changes.filter((c) => !isDiscardable(c))
  if (fixedAtSource.length > 0) return refuse(msg("store_refused", { label }), fixedAtSource.map((c) => joinRefs([c.label, msg("project_reason_fix_at_source")], ": ")), viewHref(projectId))
  const own = changes.filter(isDiscardable)
  if (own.length === 0) return { ok: true }
  return editProject(projectId, label, project.revision, (p) => {
    const undone = own.reduce(undo, p)
    const applied = new Set(p.view?.groups.map((g) => g.id) ?? [])
    const used = new Set(undone.inputs.map((i) => i.groupId))
    return { ...undone, groups: undone.groups.filter((g) => applied.has(g.id) || used.has(g.id)) }
  })
}

// ---------------------------------------------------------------------------
// View (previous)/ (D-W110)
// ---------------------------------------------------------------------------

export type LeftoverDecision = "keep" | "move" | "trash"

/**
 * Review one file in `View (previous)/` (D-W110): Keep leaves it there and
 * it is not asked about again; Move puts it back into the View, refused when
 * the View holds that name; Trash moves it to the OS Trash after review. The
 * record goes once the folder is empty (provisional).
 */
export function reviewLeftover(projectId: ProjectId, path: string, decision: LeftoverDecision): CommitResult {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  const previous = project?.previous
  const leftover = previous?.leftovers.find((l) => l.path === path)
  if (!project || !previous || !leftover) return MISSING
  const label = decision === "keep" ? msg("project_label_keep_previous", { name: fileName(path) }) : decision === "move" ? msg("project_label_move_previous", { name: fileName(path) }) : msg("store_label_move_to_trash_named", { name: fileName(path) })
  const closed = closedRefusal(project, label)
  if (closed) return closed
  const href = viewHref(projectId)
  const source = `${previous.folderPath}/${path}`
  if (decision === "keep") return editProject(projectId, label, project.revision, (p) => ({ ...p, previous: p.previous ? { ...p.previous, leftovers: p.previous.leftovers.map((l) => (l.path === path ? { ...l, kept: true } : l)) } : null }))
  if (decision === "trash") {
    const reason = trashRefusal(state.disk, source)
    if (reason) return refuse(msg("store_refused", { label }), [reason], href)
    moveToOsTrash({ kind: "previous-leftovers", title: label, projectId, items: [{ path: source }], pruneFolders: [previous.folderPath], unit: "files", href })
    return { ok: true }
  }
  const view = project.view
  const file = fileAt(state.disk, source)
  if (!view || !file) return refuse(msg("store_refused", { label }), [msg("wrapup_refusal_not_found", { path: source })], href)
  const target = `${view.folderPath}/${path}`
  if (fileAt(state.disk, target)) return refuse(msg("store_refused", { label }), [msg("wrapup_refusal_file_exists", { path: target })], href)
  return commit(
    label,
    (s) => {
      const disk = moveFile(s.disk, fileAt(s.disk, source)!, target)
      const current = s.catalog.projects[projectId]!
      const leftovers = current.previous!.leftovers.filter((l) => l.path !== path)
      const empty = leftovers.length === 0 && filesUnder(disk, previous.folderPath).length === 0
      return { ...s, disk, catalog: { ...s.catalog, projects: { ...s.catalog.projects, [projectId]: { ...current, previous: empty ? null : { ...current.previous!, leftovers } } } } }
    },
    { expect: { collection: "projects", id: projectId, revision: project.revision }, href },
  )
}

/** The leftovers still to review, for the View step and the Apply refusal (re-exported for one import). */
export { unreviewedLeftovers }

// ---------------------------------------------------------------------------
// Output (RES-FR-01, RES-FR-02, RES-FR-08)
// ---------------------------------------------------------------------------

interface CopyPayload {
  projectId: ProjectId
  sourcePath: string
  sha256: string
  name: string
}

/**
 * Copy to Output (RES-FR-02): a verified copy of one Processing file into
 * `Output/<name>`; the source stays, nothing is overwritten. Refused while
 * the Project is closed, for a file outside `Processing/`, one still being
 * written or unreadable, and a name already taken (`copyToOutputRefusal`).
 */
export function copyToOutput(projectId: ProjectId, sourcePath: string, name: string): { result: CommitResult; operationId: OperationId | null } {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  if (!project) return { result: MISSING, operationId: null }
  const label = msg("output_copy_named", { name: fileName(sourcePath) })
  const reason = copyToOutputRefusal(state, project, sourcePath, name)
  if (reason) return { result: refuse(msg("store_refused", { label }), [reason], outputHref(projectId)), operationId: null }
  const source = fileAt(state.disk, sourcePath)!
  let operationId: OperationId | null = null
  const result = commit(
    label,
    (s) => {
      const added = addOperation(s, {
        kind: "copy-to-output",
        title: label,
        scope: { projectId },
        total: 1,
        unit: "files",
        items: [{ id: sourcePath, label: verbatim(fileName(sourcePath)), path: sourcePath, status: "pending", phase: null, detail: null }],
        payload: { projectId, sourcePath, sha256: source.sha256, name: name.trim() } satisfies CopyPayload as unknown as Record<string, unknown>,
        canCancel: false,
      })
      operationId = added.id
      return added.state
    },
    { href: outputHref(projectId) },
  )
  if (result.ok) ensureTicker()
  return { result, operationId: result.ok ? operationId : null }
}

const copyHandler: OperationHandler = {
  kind: "copy-to-output",
  step(state, op) {
    const payload = op.payload as unknown as CopyPayload
    const project = state.catalog.projects[payload.projectId]
    const href = outputHref(payload.projectId)
    const fail = (reason: MessageRef) =>
      settleOperation(patchOperation(state, op.id, { items: op.items.map((i) => ({ ...i, status: "failed", detail: reason })) }), op.id, "failed", reason, href)
    if (!project) return fail(msg("store_record_missing"))
    const reason = copyToOutputRefusal(state, project, payload.sourcePath, payload.name)
    if (reason) return fail(reason)
    const source = fileAt(state.disk, payload.sourcePath)!
    if (source.sha256 !== payload.sha256) return fail(msg("output_refused_changed"))
    if (state.faults.failNextHashVerification) return { ...fail(msg("store_cal_copy_not_verified")), faults: { ...state.faults, failNextHashVerification: false } }
    const paths = projectPaths(state, project)!
    const target = `${paths.output}/${payload.name}`
    const volumeId = volumeForPath(state.disk, target)
    if (!volumeId || !state.disk.volumes[volumeId]?.mounted) return fail(msg("output_refused_offline"))
    if (freeBytes(state.disk, volumeId) < source.sizeBytes) return fail(msg("output_refused_space"))
    const at = nowIso()
    const copy = makeFile({ path: target, volumeId, sizeBytes: source.sizeBytes, kind: source.kind, header: source.header, pixelTruth: source.pixelTruth, sha256: source.sha256, modifiedAt: at })
    const written = { ...state, disk: writeFiles(state.disk, [copy]) }
    const recorded = withCatalog(written, (c) => {
      const p = c.projects[payload.projectId]!
      return { ...c, projects: { ...c.projects, [p.id]: { ...p, output: { ...p.output, [payload.name]: { kind: null, channel: null, copiedFrom: payload.sourcePath, at } }, revision: p.revision + 1 } } }
    })
    const next = patchOperation(recorded, op.id, { items: op.items.map((i) => ({ ...i, status: "done", phase: "verified", detail: msg("op_prep_written_verified") })), progress: { ...op.progress, done: 1 } })
    return settleOperation(next, op.id, "succeeded", msg("output_copied", { name: payload.name }), href)
  },
}

/** A Result's Kind (RES-FR-01), chosen in its dropdown; null clears it. */
export function setOutputKind(projectId: ProjectId, path: string, kind: OutputKind | null): CommitResult {
  const project = store.getState().catalog.projects[projectId]
  if (!project) return MISSING
  return editProject(projectId, msg("output_label_kind", { name: fileName(path) }), project.revision, (p) => ({ ...p, output: { ...p.output, [path]: { kind, channel: p.output[path]?.channel ?? null, copiedFrom: p.output[path]?.copiedFrom ?? null, at: nowIso() } } }))
}

/** A Result's Channel (RES-FR-01); null clears it. */
export function setOutputChannel(projectId: ProjectId, path: string, channel: string | null): CommitResult {
  const project = store.getState().catalog.projects[projectId]
  if (!project) return MISSING
  return editProject(projectId, msg("output_label_channel", { name: fileName(path) }), project.revision, (p) => ({ ...p, output: { ...p.output, [path]: { kind: p.output[path]?.kind ?? null, channel, copiedFrom: p.output[path]?.copiedFrom ?? null, at: nowIso() } } }))
}

// ---------------------------------------------------------------------------
// Generated masters in Processing/ (CAL-FR-06, provisional)
// ---------------------------------------------------------------------------

/** Why adopting this generated master is refused now, or its fixed destination when it can go ahead. */
export type AdoptionCheck = { ok: true; destination: string; sha256: string } | { ok: false; reasons: MessageRef[]; ownCopy: string | null }

/**
 * Adopt's preview (CAL-FR-06): where the master goes in structured
 * calibration storage and the digest it holds now, or why it cannot be
 * added. PlateVault's own unregistered copy at the destination is named, so
 * the page can offer a reviewed Move to Trash before it retries (section 9).
 */
export function adoptionCheck(state: PrototypeState, projectId: ProjectId, path: string): AdoptionCheck {
  const project = state.catalog.projects[projectId]
  if (!project) return { ok: false, reasons: [msg("store_record_missing")], ownCopy: null }
  const offer = processingMasters(state, project).find((m) => m.file.path === path)
  if (!offer) return { ok: false, reasons: [msg("store_reason_already_answered")], ownCopy: null }
  if (offer.file.growing) return { ok: false, reasons: [msg("store_reason_still_being_written")], ownCopy: null }
  const storage = calibrationStorage(state.catalog)
  if (!storage) return { ok: false, reasons: [msg("import_no_calibration_location")], ownCopy: null }
  const volume = state.disk.volumes[storage.volumeId]
  if (!volume?.mounted) return { ok: false, reasons: [msg("issue_location_offline", { name: storage.displayName })], ownCopy: null }
  if (!volume.writable) return { ok: false, reasons: [msg("run_parent_read_only", { name: storage.displayName })], ownCopy: null }
  const destination = adoptionDestination(state.catalog, state.settings, offer.file, offer.kind)
  if (!destination) return { ok: false, reasons: [msg("store_cal_master_unreadable")], ownCopy: null }
  const at = adoptionDestinationState(state.catalog, state.disk, destination, offer.file.sha256)
  if (at.kind === "own-copy") return { ok: false, reasons: [msg("adopt_refused_own_copy", { path: destination })], ownCopy: destination }
  if (at.kind === "taken") return { ok: false, reasons: [msg("import_name_taken")], ownCopy: null }
  return { ok: true, destination, sha256: offer.file.sha256 }
}

/**
 * Add to library (CAL-FR-06): a verified copy of a generated master filed
 * into structured calibration storage as a dated version, with the
 * Project's file as its source; sessions still waiting are matched again,
 * pins never move. `confirmedSha256` is the digest the confirmation showed:
 * a master that changed since is refused. With `trashOwnCopy`, PlateVault's
 * own unregistered copy at the destination goes to the OS Trash first, as
 * the user reviewed it, and the adoption retries (section 9).
 */
export function adoptProcessingMaster(projectId: ProjectId, path: string, confirmedSha256: string, options: { trashOwnCopy?: boolean } = {}): CommitResult {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  if (!project) return MISSING
  const label = msg("store_label_add_named", { name: fileName(path) })
  const closed = closedRefusal(project, label)
  if (closed) return closed
  const title = msg("store_refused", { label })
  const href = outputHref(projectId)
  let check = adoptionCheck(state, projectId, path)
  let pre = state
  if (!check.ok && check.ownCopy && options.trashOwnCopy) {
    const own = fileAt(state.disk, check.ownCopy)!
    const reason = trashRefusal(state.disk, own.path)
    if (reason) return refuse(title, [reason], href)
    const at = nowIso()
    const episode = { id: `trash_${own.inode}_${Date.parse(at).toString(36)}`, kind: "unregistered-copy" as const, at, projectId, items: [{ path: own.path, volumeId: own.volumeId, sizeBytes: own.sizeBytes, assetId: null, outcome: "trashed" as const, reason: null }], operationId: null }
    pre = { ...state, disk: { ...removeFile(state.disk, own.volumeId, own.path), trash: [...state.disk.trash, { file: own, originalPath: own.path, trashedAt: at }] }, catalog: { ...state.catalog, trashEpisodes: { ...state.catalog.trashEpisodes, [episode.id]: episode } } }
    check = adoptionCheck(pre, projectId, path)
  }
  if (!check.ok) return refuse(title, check.reasons, href)
  if (state.faults.failNextHashVerification) {
    store.setState((s) => ({ ...s, faults: { ...s.faults, failNextHashVerification: false } }))
    return refuse(title, [msg("run_cal_master_changed"), msg("store_cal_copy_not_verified")], href)
  }
  if (check.sha256 !== confirmedSha256) return refuse(title, [msg("run_cal_master_changed"), msg("store_reason_sha_now", { hash: `${check.sha256.slice(0, 12)}…` })], href)
  const { destination } = check
  const result = commit(
    label,
    (s) => {
      const base = options.trashOwnCopy ? { ...s, disk: pre.disk, catalog: { ...s.catalog, trashEpisodes: pre.catalog.trashEpisodes } } : s
      const source = fileAt(base.disk, path)!
      const storage = calibrationStorage(base.catalog)!
      const at = nowIso()
      const copy = makeFile({ path: destination, volumeId: storage.volumeId, sizeBytes: source.sizeBytes, kind: source.kind, header: source.header, pixelTruth: source.pixelTruth, sha256: source.sha256, modifiedAt: at })
      const disk = writeFiles(base.disk, [copy])
      const ingested = ingestFiles(base.catalog, disk, base.settings, storage, [copy], at)
      const masters = { ...ingested.masters }
      for (const master of Object.values(masters)) {
        if (!master.versions.some((v) => v.path === destination)) continue
        masters[master.id] = {
          ...master,
          versions: master.versions.map((v) => (v.path === destination ? { ...v, origin: { kind: "generated", projectId, sourcePath: path, sessionId: null }, adoption: { destinationPath: destination, verifiedSha256: source.sha256, adoptedAt: at } } : v)),
        }
      }
      const current = ingested.projects[projectId]!
      const masterOffers = [...current.masterOffers.filter((o) => o.path !== path), { path, sha256: source.sha256, state: "adopted" as const, at }]
      return { ...base, disk, catalog: { ...ingested, masters, projects: { ...ingested.projects, [projectId]: { ...current, masterOffers } } } }
    },
    { expect: { collection: "projects", id: projectId, revision: project.revision }, href },
  )
  if (result.ok) recordSaved(msg("store_saved_added_to_library", { name: fileName(path) }), verbatim(destination), "/calibration")
  return result
}

/** Hide a generated-master offer: it is not offered again for that file and digest (CAL-FR-06). */
export function hideMasterOffer(projectId: ProjectId, path: string): CommitResult {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  if (!project) return MISSING
  const offer = processingMasters(state, project).find((m) => m.file.path === path)
  if (!offer) return refuse(msg("store_refused", { label: msg("output_label_hide_offer") }), [msg("store_reason_already_answered")], outputHref(projectId))
  return editProject(projectId, msg("output_label_hide_offer"), project.revision, (p) => ({ ...p, masterOffers: [...p.masterOffers.filter((o) => o.path !== path), { path, sha256: offer.file.sha256, state: "hidden", at: nowIso() }] }))
}

/** Offer a hidden generated master again. */
export function restoreMasterOffer(projectId: ProjectId, path: string): CommitResult {
  const project = store.getState().catalog.projects[projectId]
  if (!project) return MISSING
  if (!project.masterOffers.some((o) => o.path === path && o.state === "hidden")) return { ok: true }
  return editProject(projectId, msg("store_cal_restore_offer"), project.revision, (p) => ({ ...p, masterOffers: p.masterOffers.filter((o) => !(o.path === path && o.state === "hidden")) }))
}

/** Is this path inside the Project's `Processing/` folder? For the file picker that Copy to Output opens there (provisional). */
export function inProcessing(state: Pick<PrototypeState, "settings">, project: Project, path: string): boolean {
  const paths = projectPaths(state, project)
  return paths !== null && isUnder(path, paths.processing)
}

/** The Project View's operation handlers, registered by the store. */
export const PROJECT_VIEW_HANDLERS: OperationHandler[] = [applyHandler, copyHandler]
