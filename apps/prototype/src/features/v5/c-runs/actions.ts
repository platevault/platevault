/**
 * Slice C store actions: calibration decisions and master offers, the run
 * folder parent, Prepare and Prepare all, Open (re-verifies first), Results
 * discovery, attach, inspect and accept, "Use as input to a new run", Clean
 * up and the group's Complete all. Every write goes through `commit()`; a
 * contract refusal names each blocker and records it in Activity. A few
 * clearly labelled prototype controls make the simulated disk change (an
 * application writing outputs, a source frame changing) so the review can
 * exercise discovery and re-verification.
 */
import { basisFiles, type CalSource } from "@/domain/calibration"
import { completeRefusals, groupPipeline, latestRevision, runPreparations, runSetup, workingContent } from "@/domain/derive"
import { createFolder, fakeSha256, fileAt, makeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { stableHash } from "@/domain/indexing"
import { RESULT_KIND_LABEL } from "@/domain/labels"
import { memberSessions } from "@/domain/membership"
import type {
  CalibrationAssignment,
  CalibrationInput,
  CalibrationKind,
  CalibrationMaster,
  CalibrationPolicy,
  DiskFile,
  InputMode,
  MatchCriterion,
  MetadataDecision,
  OperationItem,
  Preparation,
  ProfileId,
  ResultKind,
  ResultRecord,
  Run,
  RunGroup,
  RunSetup,
} from "@/domain/types"
import { plural } from "@/lib/format"
import { type CommitResult, commit, nowIso, type PrototypeState, store, updateSlice, withCatalog } from "@/store/core"
import { completeRun, setGroupSetup, setProductInputs, setRunSetup, startRun } from "@/store/actions/runs"
import { freshId, MISSING, recordSaved, refuse } from "@/store/actions/shared"
import { startOperation } from "@/store/operations"
import { cleanupReview, currentPreparation, DEFAULT_CHOICES, groupAssembledPath, livePanelRuns, type PrepareChoices, preparePlan, recognize, resultsFolders, runLock, scanResultsFolders, verifyPreparation } from "./model"
import type { CleanupPayload, PreparePayload } from "./operations"

const runHref = (run: Pick<Run, "id" | "projectId">, step: string) => `/projects/${run.projectId}/runs/${run.id}/${step}`
const groupHref = (group: Pick<RunGroup, "id" | "projectId">, step: string) => `/projects/${group.projectId}/groups/${group.id}/${step}`

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

function editRun(run: Run, label: string, update: (run: Run, state: PrototypeState) => Run, href: string, extra?: (state: PrototypeState) => PrototypeState): CommitResult {
  return commit(
    label,
    (s) => {
      const next = withCatalog(s, (c) => ({ ...c, runs: { ...c.runs, [run.id]: update(c.runs[run.id]!, s) } }))
      return extra ? extra(next) : next
    },
    { expect: { collection: "runs", id: run.id, revision: run.revision }, href },
  )
}

// ---------------------------------------------------------------------------
// Setup (D-W38, D-W55)
// ---------------------------------------------------------------------------

/** Complete panels refuse a shared setup change; a trashed panel is skipped (D-W75). */
export function groupSetupRefusals(state: PrototypeState, group: RunGroup): string[] {
  return livePanelRuns(state, group)
    .filter((r) => r.completion === "complete")
    .map((r) => `${r.name} is Complete; Reopen it before the shared setup changes`)
}

export function changeRunSetup(runId: string, patch: Partial<RunSetup>): CommitResult {
  const state = store.getState()
  const run = state.catalog.runs[runId]
  if (!run) return MISSING
  if (run.groupId) return changeGroupSetup(run.groupId, patch)
  const lock = runLock(run)
  if (lock) return refuse("Setup change refused", [lock], runHref(run, "prepare"))
  return setRunSetup(runId, patch)
}

export function changeGroupSetup(groupId: string, patch: Partial<RunSetup>): CommitResult {
  const state = store.getState()
  const group = state.catalog.runGroups[groupId]
  if (!group) return MISSING
  const blockers = groupSetupRefusals(state, group)
  if (blockers.length > 0) return refuse(`Shared setup change for ${group.name} refused`, blockers, groupHref(group, "prepare"))
  return setGroupSetup(groupId, patch)
}

export function setCalibrationPolicy(runId: string, policy: CalibrationPolicy): CommitResult {
  return changeRunSetup(runId, { calibrationPolicy: policy })
}

export function chooseProfile(runOrGroup: { runId?: string; groupId?: string }, profileId: ProfileId): CommitResult {
  const profile = store.getState().catalog.profiles[profileId]
  const patch: Partial<RunSetup> = { profileId }
  // A mode the profile cannot use is cleared rather than kept silently (PREP-FR-04).
  if (profile) {
    const current = runOrGroup.groupId ? store.getState().catalog.runGroups[runOrGroup.groupId]?.setup.inputMode : runOrGroup.runId ? runSetup(store.getState().catalog, store.getState().catalog.runs[runOrGroup.runId]!).inputMode : null
    if (current && !profile.capability.inputModes.includes(current)) patch.inputMode = null
  }
  return runOrGroup.groupId ? changeGroupSetup(runOrGroup.groupId, patch) : changeRunSetup(runOrGroup.runId!, patch)
}

export function chooseMode(runOrGroup: { runId?: string; groupId?: string }, mode: InputMode): CommitResult {
  return runOrGroup.groupId ? changeGroupSetup(runOrGroup.groupId, { inputMode: mode }) : changeRunSetup(runOrGroup.runId!, { inputMode: mode })
}

export function prepareChoices(state: PrototypeState, key: string): PrepareChoices {
  return state.slices.c.prepare[key] ?? DEFAULT_CHOICES
}

export function updatePrepareChoices(key: string, patch: Partial<PrepareChoices>) {
  updateSlice("c", (c) => ({ ...c, prepare: { ...c.prepare, [key]: { ...DEFAULT_CHOICES, ...c.prepare[key], ...patch } } }))
}

export function setOutputParent(target: { runId?: string; groupId?: string }, path: string): CommitResult {
  const state = store.getState()
  if (target.groupId) {
    const group = state.catalog.runGroups[target.groupId]
    if (!group) return MISSING
    const result = commit(
      "Output folder",
      (s) => ({ ...withCatalog(s, (c) => ({ ...c, runGroups: { ...c.runGroups, [group.id]: { ...c.runGroups[group.id]!, outputParent: path } } })), settings: { ...s.settings, lastOutputParent: path } }),
      { expect: { collection: "runGroups", id: group.id, revision: group.revision }, href: groupHref(group, "prepare") },
    )
    if (result.ok) recordSaved(`Output folder: ${group.name}`, path, groupHref(group, "prepare"))
    return result
  }
  const run = target.runId ? state.catalog.runs[target.runId] : undefined
  if (!run) return MISSING
  const lock = runLock(run)
  if (lock) return refuse("Output folder change refused", [lock], runHref(run, "prepare"))
  const result = editRun(run, "Output folder", (r) => ({ ...r, outputParent: path }), runHref(run, "prepare"), (s) => ({ ...s, settings: { ...s.settings, lastOutputParent: path } }))
  if (result.ok) recordSaved(`Output folder: ${run.name}`, path, runHref(run, "prepare"))
  return result
}

// ---------------------------------------------------------------------------
// Calibration decisions (CAL-FR-08, D-W5, D-W55)
// ---------------------------------------------------------------------------

function decide(runId: string, sessionId: string, kind: CalibrationKind, next: Omit<CalibrationAssignment, "id" | "lightSessionId" | "kind"> | null, label: string): CommitResult {
  const state = store.getState()
  const run = state.catalog.runs[runId]
  if (!run) return MISSING
  const lock = runLock(run)
  if (lock) return refuse(`${label} refused`, [lock], runHref(run, "calibrate"))
  const id = `cal_${runId}_${sessionId}_${kind}`
  const result = editRun(
    run,
    label,
    (r) => {
      const rest = r.calibration.filter((a) => !(a.lightSessionId === sessionId && a.kind === kind))
      return { ...r, calibration: next ? [...rest, { id, lightSessionId: sessionId, kind, ...next }] : rest }
    },
    runHref(run, "calibrate"),
  )
  if (result.ok) recordSaved(`${label}: ${run.name}`, null, runHref(run, "calibrate"))
  return result
}

function basisOf(input: CalibrationInput | null) {
  const s = store.getState()
  return { at: nowIso(), files: input ? basisFiles(s.catalog, s.disk, input) : [] }
}

/** Accept a compatible input: it records the basis, the SHA-256 each handed-off file has now. */
export function acceptCalibration(runId: string, sessionId: string, kind: CalibrationKind, source: CalSource, criteria: MatchCriterion[]): CommitResult {
  return decide(runId, sessionId, kind, { input: source.input, state: "accepted", criteria, exception: null, basis: basisOf(source.input) }, `Use ${source.name}`)
}

/** An exception: an incompatible input, or no input of this kind, with the user's reason (CAL-FR-08). */
export function calibrationException(runId: string, sessionId: string, kind: CalibrationKind, source: CalSource | null, criteria: MatchCriterion[], reason: string): CommitResult {
  const trimmed = reason.trim()
  if (!trimmed) {
    const run = store.getState().catalog.runs[runId]
    return refuse("Exception refused", ["An exception needs a reason"], run ? runHref(run, "calibrate") : null)
  }
  return decide(runId, sessionId, kind, { input: source?.input ?? null, state: "exception", criteria, exception: { reason: trimmed, at: nowIso() }, basis: basisOf(source?.input ?? null) }, source ? `Exception: ${source.name}` : `Exception: no ${kind}`)
}

export function deferCalibration(runId: string, sessionId: string, kind: CalibrationKind): CommitResult {
  return decide(runId, sessionId, kind, { input: null, state: "deferred", criteria: [], exception: null, basis: null }, `Defer ${kind}`)
}

/** Back to the automatic choice: the stored decision is removed. */
export function clearCalibration(runId: string, sessionId: string, kind: CalibrationKind): CommitResult {
  return decide(runId, sessionId, kind, null, `Automatic ${kind}`)
}

/** A master found in Results is offered once: Add to the calibration library, or Dismiss (D-W55). */
export function answerMasterOffer(runId: string, masterId: string, answer: "adopt" | "dismiss"): CommitResult {
  const state = store.getState()
  const run = state.catalog.runs[runId]
  const master = state.catalog.masters[masterId]
  if (!run || !master) return MISSING
  const href = runHref(run, "calibrate")
  if (!run.masterOffers.some((o) => o.masterId === masterId && o.state === "pending")) return refuse("Offer already answered", [`${fileName(master.path)} was offered once and already answered`], href)
  if (answer === "dismiss") {
    const result = editRun(run, "Dismiss master offer", (r) => ({ ...r, masterOffers: r.masterOffers.map((o) => (o.masterId === masterId ? { ...o, state: "declined", at: nowIso() } : o)) }), href)
    if (result.ok) recordSaved(`Dismissed ${fileName(master.path)}`, "It stays in the Results folder and is not offered again.", href)
    return result
  }
  const source = fileAt(state.disk, master.origin.sourcePath)
  if (!source) return refuse(`Add ${fileName(master.path)} refused`, [`${master.origin.sourcePath} cannot be read now`], href)
  if (source.growing) return refuse(`Add ${fileName(master.path)} refused`, ["The application is still writing it"], href)
  const location = Object.values(state.catalog.locations).find((l) => l.role === "calibration" && !l.retiredAt)
  if (!location) return refuse(`Add ${fileName(master.path)} refused`, ["No Calibration library location is registered; add one in Settings › Locations"], href)
  const volume = state.disk.volumes[location.volumeId]
  if (!volume?.mounted) return refuse(`Add ${fileName(master.path)} refused`, [`${location.displayName} is offline`], href)
  if (!volume.writable) return refuse(`Add ${fileName(master.path)} refused`, [`${location.displayName} is not writable`], href)
  const destinationPath = `${location.path}/Masters/${fileName(master.path)}`
  if (fileAt(state.disk, destinationPath)) return refuse(`Add ${fileName(master.path)} refused`, [`${destinationPath} already exists; nothing was overwritten`], href)
  const at = nowIso()
  const copy = makeFile({ path: destinationPath, volumeId: location.volumeId, sizeBytes: source.sizeBytes, kind: source.kind, header: source.header, sha256: source.sha256, modifiedAt: at })
  const result = editRun(
    run,
    "Add master to the calibration library",
    (r) => ({ ...r, masterOffers: r.masterOffers.map((o) => (o.masterId === masterId ? { ...o, state: "adopted", at } : o)) }),
    href,
    (s) => ({
      ...withCatalog(s, (c) => ({ ...c, masters: { ...c.masters, [masterId]: { ...c.masters[masterId]!, state: "adopted", path: destinationPath, adoption: { destinationPath, verifiedSha256: source.sha256, adoptedAt: at } } } })),
      disk: writeFiles(s.disk, [copy]),
    }),
  )
  if (result.ok) recordSaved(`Added ${fileName(master.path)} to the calibration library`, `Copied to ${destinationPath}; SHA-256 verified. The Results copy stays.`, "/calibration")
  return result
}

// ---------------------------------------------------------------------------
// Prepare (PREP-FR-04 to PREP-FR-13)
// ---------------------------------------------------------------------------

function blockingReasons(plan: ReturnType<typeof preparePlan>): string[] {
  const reasons = plan.checks.filter((c) => c.blocking && !c.ok).map((c) => `${c.label}: ${c.detail}`)
  if (reasons.length === 0 && plan.entries.every((e) => e.unavailable)) reasons.push("Every input is unreadable now; nothing could be prepared")
  return reasons
}

/** Start one preparation revision of a run as an operation; returns its operation id. */
export function startPrepare(runId: string, choices: PrepareChoices, options: { groupRevision?: number } = {}): { result: CommitResult; operationId: string | null } {
  const state = store.getState()
  const run = state.catalog.runs[runId]
  if (!run) return { result: MISSING, operationId: null }
  const plan = preparePlan(state, run, choices, options)
  const href = runHref(run, "prepare")
  if (!plan.ready || !plan.revision || !plan.profile || !plan.mode || !plan.layout.folderPath || !plan.layout.resultsPath) {
    return { result: refuse(`Prepare ${run.name} refused`, blockingReasons(plan), href), operationId: null }
  }
  const running = completeRefusals(state, run)
  if (running.length > 0) return { result: refuse(`Prepare ${run.name} refused`, running, href), operationId: null }
  const at = nowIso()
  const id = freshId("prep", `${run.id}|${plan.layout.prepRevision}`)
  const decisions: MetadataDecision[] = plan.diffs.flatMap((d) =>
    d.assetIds.map((assetId) => ({ assetId, field: d.field, observed: d.sourceValue, corrected: d.catalogValue, decision: plan.metadata[d.key]! })),
  )
  const record: Preparation = {
    id,
    runId: run.id,
    groupId: run.groupId,
    prepRevision: plan.layout.prepRevision,
    membershipRevision: plan.revision.revision,
    profileId: plan.profile.id,
    mode: plan.mode,
    linkType: plan.mode === "linked" ? plan.linkType : null,
    folderPath: plan.layout.folderPath,
    resultsPath: plan.layout.resultsPath,
    entryCount: plan.entries.filter((e) => e.kind !== "calibration").length,
    footprintBytes: 0,
    state: "running",
    operationId: null,
    preparedAssetIds: [],
    preparedResultIds: [],
    blocked: [],
    metadataDecisions: decisions,
    launches: [],
    unverified: null,
    createdAt: at,
    settledAt: null,
  }
  const result = commit(`Prepare ${run.name}`, (s) => ({
    ...withCatalog(s, (c) => ({ ...c, preparations: { ...c.preparations, [id]: record } })),
    settings: { ...s.settings, lastOutputParent: plan.layout.parent.path },
  }), { href })
  if (!result.ok) return { result, operationId: null }
  const payload: PreparePayload = {
    preparationId: id,
    runId: run.id,
    mode: plan.mode,
    linkType: plan.mode === "linked" ? plan.linkType : null,
    folderPath: plan.layout.folderPath,
    resultsPath: plan.layout.resultsPath,
    entries: Object.fromEntries(plan.entries.map((e) => [e.id, e])),
    snapshots: {},
    expected: {},
    href,
  }
  const items: OperationItem[] = plan.entries.map((e) => ({ id: e.id, label: e.label, path: e.sourcePath, status: "pending", phase: null, detail: null }))
  const operationId = startOperation({
    kind: "prepare",
    title: `Prepare ${run.name}${plan.layout.prepRevision > 1 ? ` (rev ${plan.layout.prepRevision})` : ""}`,
    scope: { runIds: [run.id], projectId: run.projectId },
    total: items.length,
    unit: "entries",
    items,
    payload: payload as unknown as Record<string, unknown>,
    canCancel: false,
  })
  store.setState((s) => withCatalog(s, (c) => ({ ...c, preparations: { ...c.preparations, [id]: { ...c.preparations[id]!, operationId } } })))
  return { result, operationId }
}

/**
 * Prepare all (PREP-FR-12): one review covering every live panel, each
 * prepared into the next group folder `<Mosaic> (rev N)/Panel N/`. Complete
 * and trashed panels are skipped; a panel that is not ready refuses the
 * whole group action and is named.
 */
export function prepareAll(groupId: string): { result: CommitResult; operationIds: string[] } {
  const state = store.getState()
  const group = state.catalog.runGroups[groupId]
  if (!group) return { result: MISSING, operationIds: [] }
  const panels = livePanelRuns(state, group).filter((r) => r.completion !== "complete")
  const href = groupHref(group, "prepare")
  if (panels.length === 0) return { result: refuse(`Prepare all ${group.name} refused`, ["Every panel outside the Trash is Complete; Reopen a panel first"], href), operationIds: [] }
  const groupRevision = Math.max(0, ...Object.values(state.catalog.preparations).filter((p) => p.groupId === group.id).map((p) => p.prepRevision)) + 1
  const choices = prepareChoices(state, group.id)
  const blockers: string[] = []
  for (const run of panels) {
    const plan = preparePlan(state, run, choices, { groupRevision })
    if (!plan.ready) blockers.push(...blockingReasons(plan).map((r) => `${run.name}: ${r}`))
  }
  if (blockers.length > 0) return { result: refuse(`Prepare all ${group.name} refused`, blockers, href), operationIds: [] }
  const operationIds: string[] = []
  for (const run of panels) {
    const { result, operationId } = startPrepare(run.id, choices, { groupRevision })
    if (!result.ok) return { result, operationIds }
    if (operationId) operationIds.push(operationId)
  }
  recordSaved(`Prepare all: ${group.name}`, `${plural(operationIds.length, "panel run")} into group revision ${groupRevision}.`, href)
  return { result: { ok: true }, operationIds }
}

function launchOutcome(state: PrototypeState, profileId: string): { outcome: "opened" | "missing-executable" | "launch-failed"; refusal: string | null } {
  const profile = state.catalog.profiles[profileId]
  if (!profile) return { outcome: "missing-executable", refusal: "The preparation's profile is no longer configured" }
  if (profile.executableState === "found") return { outcome: "opened", refusal: null }
  if (profile.executableState === "launch-fails") return { outcome: "launch-failed", refusal: `${profile.name} did not launch. Check it in Settings › Applications` }
  return { outcome: "missing-executable", refusal: `${profile.name} is not located. Locate the executable in Settings › Applications` }
}

/**
 * Open (PREP-FR-10): re-verify every entry the application will read, then
 * launch. Drift refuses the launch, names the changed items and marks the
 * preparation Unverified until a later Open finds the bytes back.
 */
export function openPreparation(runId: string): CommitResult {
  const state = store.getState()
  const run = state.catalog.runs[runId]
  if (!run) return MISSING
  const href = runHref(run, "prepare")
  const prep = currentPreparation(run, runPreparations(state.catalog, run.id))
  if (!prep) return refuse(`Open ${run.name} refused`, ["Prepare the latest revision first"], href)
  if (prep.state !== "prepared") return refuse(`Open ${run.name} refused`, [prep.state === "partial" ? `The preparation is Partial: ${plural(prep.blocked.length, "input")} could not be prepared. Prepare again once they are readable` : `The preparation is ${prep.state}`], href)
  const check = verifyPreparation(state, prep)
  const at = nowIso()
  if (check.changed.length > 0) {
    commit("Mark preparation unverified", (s) => withCatalog(s, (c) => ({ ...c, preparations: { ...c.preparations, [prep.id]: { ...c.preparations[prep.id]!, unverified: { at, changed: check.changed } } } })), { href })
    return refuse(`Open ${run.name} refused`, check.changed.slice(0, 6).map((c) => `${fileName(c.path)}: ${c.reason}`).concat(check.changed.length > 6 ? [`and ${plural(check.changed.length - 6, "more entry", "more entries")}`] : []), href)
  }
  const launch = launchOutcome(state, prep.profileId)
  const result = commit("Open in application", (s) => withCatalog(s, (c) => ({ ...c, preparations: { ...c.preparations, [prep.id]: { ...c.preparations[prep.id]!, unverified: null, launches: [...c.preparations[prep.id]!.launches, { at, outcome: launch.outcome }] } } })), { href })
  if (!result.ok) return result
  if (launch.refusal) return refuse(`Open ${run.name} refused`, [launch.refusal], href)
  recordSaved(`Opened ${run.name} in ${state.catalog.profiles[prep.profileId]?.name ?? "the application"}`, `${plural(check.checked, "entry", "entries")} re-verified before launch; ${prep.folderPath}.`, href)
  return result
}

/** Open the group folder (PREP-FR-13): only when every panel is verified; re-verifies each panel first. */
export function openGroupFolder(groupId: string): CommitResult {
  const state = store.getState()
  const group = state.catalog.runGroups[groupId]
  if (!group) return MISSING
  const href = groupHref(group, "prepare")
  const pipeline = groupPipeline(state, group)
  if (!pipeline.allVerified) {
    const waiting = pipeline.panels.filter((p) => !p.trashed && p.pipeline.steps[3]!.state !== "done").map((p) => `${p.run.name}: ${p.pipeline.steps[3]!.status}`)
    return refuse(`Open ${group.name} refused`, ["Every panel outside the Trash must be prepared and verified", ...waiting], href)
  }
  const at = nowIso()
  const changed: Array<{ prepId: string; run: Run; items: Array<{ path: string; reason: string }> }> = []
  const preps: Preparation[] = []
  for (const run of livePanelRuns(state, group)) {
    const prep = currentPreparation(run, runPreparations(state.catalog, run.id))
    if (!prep) continue
    preps.push(prep)
    const check = verifyPreparation(state, prep)
    if (check.changed.length > 0) changed.push({ prepId: prep.id, run, items: check.changed })
  }
  if (changed.length > 0) {
    commit("Mark preparations unverified", (s) => withCatalog(s, (c) => {
      const preparations = { ...c.preparations }
      for (const ch of changed) preparations[ch.prepId] = { ...preparations[ch.prepId]!, unverified: { at, changed: ch.items } }
      return { ...c, preparations }
    }), { href })
    return refuse(`Open ${group.name} refused`, changed.map((ch) => `${ch.run.name}: ${plural(ch.items.length, "entry", "entries")} changed (${fileName(ch.items[0]!.path)})`), href)
  }
  const launch = launchOutcome(state, preps[0]?.profileId ?? "")
  const result = commit("Open group folder", (s) => withCatalog(s, (c) => {
    const preparations = { ...c.preparations }
    for (const p of preps) preparations[p.id] = { ...preparations[p.id]!, unverified: null, launches: [...preparations[p.id]!.launches, { at, outcome: launch.outcome }] }
    return { ...c, preparations }
  }), { href })
  if (!result.ok) return result
  if (launch.refusal) return refuse(`Open ${group.name} refused`, [launch.refusal], href)
  const folder = preps[0]?.folderPath.slice(0, preps[0].folderPath.lastIndexOf("/")) ?? ""
  recordSaved(`Opened ${group.name}`, `Group folder ${folder}; ${plural(preps.length, "panel")} re-verified before launch.`, href)
  return result
}

// ---------------------------------------------------------------------------
// Results (RES-FR-01 to RES-FR-05, RES-FR-08, D-W4, D-W55, D-W56)
// ---------------------------------------------------------------------------

function newRecord(owner: { runId: string | null; groupId: string | null }, file: DiskFile, kind: ResultKind | null, channel: string | null, intermediate: boolean, discovered: ResultRecord["discovered"]): ResultRecord {
  return {
    id: `res_${stableHash(file.path)}`,
    runId: owner.runId,
    groupId: owner.groupId,
    path: file.path,
    kind,
    channel,
    intermediate,
    discovered,
    fromPrepRevision: null,
    processingState: file.growing ? "pending" : "written",
    association: discovered === "attached" ? "user-linked" : "tool-recorded",
    lineage: "unknown",
    acceptance: "candidate",
    acceptedAt: null,
    sha256: file.sha256,
    contentState: "unchanged",
    trashed: null,
  }
}

/**
 * Look in the recorded Results folder(s) only (RES-FR-01): new files become
 * candidates or intermediates, never accepted; a generated master becomes a
 * candidate master offered once on its run (D-W55). Returns the count found.
 */
export function discoverResults(target: { runId?: string; groupId?: string }): { result: CommitResult; found: number } {
  const state = store.getState()
  const run = target.runId ? state.catalog.runs[target.runId] : undefined
  const group = target.groupId ? state.catalog.runGroups[target.groupId] : undefined
  if (!run && !group) return { result: MISSING, found: 0 }
  const folders = run ? resultsFolders(state, run) : [groupAssembledPath(state, group!)].filter((p): p is string => p !== null)
  const scan = scanResultsFolders(state, folders, { assembled: !run })
  if (scan.files.length === 0) return { result: { ok: true }, found: 0 }
  const owner = run ? { runId: run.id, groupId: run.groupId } : { runId: null, groupId: group!.id }
  const records: ResultRecord[] = []
  const masters: CalibrationMaster[] = []
  for (const { file, kind } of scan.files) {
    if (kind.type === "product") records.push(newRecord(owner, file, kind.kind, kind.channel, kind.intermediate, "results-folder"))
    else if (kind.type === "master" && run) {
      const header = file.header
      const rig = state.catalog.opticalTrains[run.rigId]
      const camera = rig?.cameraId ? state.catalog.cameras[rig.cameraId] : undefined
      masters.push({
        id: `mst_${stableHash(file.path)}`,
        kind: kind.kind,
        path: file.path,
        cameraName: header?.instrument ?? camera?.name ?? null,
        widthPx: header?.widthPx ?? camera?.widthPx ?? 0,
        heightPx: header?.heightPx ?? camera?.heightPx ?? 0,
        binning: header?.binning ?? 1,
        gain: header?.gain ?? null,
        offset: header?.offset ?? null,
        exposureS: kind.kind === "dark" ? (header?.exposureS ?? 300) : null,
        channel: kind.channel,
        opticalTrainId: kind.kind === "flat" ? run.rigId : null,
        ccdTempC: header?.ccdTempC ?? null,
        frameCount: null,
        createdAt: file.modifiedAt,
        state: "candidate",
        origin: { kind: "generated", runId: run.id, sourcePath: file.path },
        adoption: null,
      })
    }
  }
  const href = run ? runHref(run, "results") : groupHref(group!, "results")
  const result = commit(
    "Discover Results",
    (s) => {
      let next = withCatalog(s, (c) => ({
        ...c,
        results: { ...c.results, ...Object.fromEntries(records.map((r) => [r.id, r])) },
        masters: { ...c.masters, ...Object.fromEntries(masters.map((m) => [m.id, m])) },
      }))
      if (run && masters.length > 0) {
        next = withCatalog(next, (c) => {
          const current = c.runs[run.id]!
          const offered = new Set(current.masterOffers.map((o) => o.masterId))
          const offers = masters.filter((m) => !offered.has(m.id)).map((m) => ({ masterId: m.id, state: "pending" as const, at: nowIso() }))
          return { ...c, runs: { ...c.runs, [run.id]: { ...current, masterOffers: [...current.masterOffers, ...offers] } } }
        })
      }
      return next
    },
    { href },
  )
  if (result.ok) {
    const candidates = records.filter((r) => !r.intermediate).length
    recordSaved(
      `Results found: ${run?.name ?? group!.name}`,
      [candidates > 0 ? plural(candidates, "candidate") : null, records.length - candidates > 0 ? plural(records.length - candidates, "intermediate") : null, masters.length > 0 ? plural(masters.length, "calibration master") : null].filter(Boolean).join(", ") + ". None is accepted until you accept it.",
      href,
    )
  }
  return { result, found: scan.files.length }
}

/** Attach a file saved elsewhere (RES-FR-02): User-linked, lineage Unknown. */
export function attachResult(target: { runId?: string; groupId?: string }, path: string, kind: ResultKind, channel: string | null): CommitResult {
  const state = store.getState()
  const run = target.runId ? state.catalog.runs[target.runId] : undefined
  const group = target.groupId ? state.catalog.runGroups[target.groupId] : undefined
  if (!run && !group) return MISSING
  const href = run ? runHref(run, "results") : groupHref(group!, "results")
  const title = `Attach ${fileName(path) || "Result"} refused`
  const trimmed = path.trim()
  if (!trimmed.startsWith("/")) return refuse(title, ["Enter the file's full path, starting with /"], href)
  if (run?.trashedAt) return refuse(title, [`${run.name} is in the Project's Trash`], href)
  const file = fileAt(state.disk, trimmed)
  if (!file) return refuse(title, [`Nothing readable at ${trimmed}: the file is missing or its volume is offline`], href)
  if (Object.values(state.catalog.results).some((r) => r.path === trimmed && !r.trashed)) return refuse(title, ["That file is already listed as a Result"], href)
  if (recognize(file, false).type === "ignored") return refuse(title, ["Logs and text files are not image products"], href)
  if (kind === "assembled-mosaic" && !group) return refuse(title, ["Assembled mosaic is a run group's Result; attach it on the run group"], href)
  const owner = run ? { runId: run.id, groupId: run.groupId } : { runId: null, groupId: group!.id }
  const record = newRecord(owner, file, kind, channel?.trim() || null, false, "attached")
  const result = commit("Attach Result", (s) => withCatalog(s, (c) => ({ ...c, results: { ...c.results, [record.id]: record } })), { href })
  if (result.ok) recordSaved(`Attached ${fileName(trimmed)}`, `${RESULT_KIND_LABEL[kind]}, User-linked to ${run?.name ?? group!.name}; lineage Unknown.`, href)
  return result
}

function editResult(resultId: string, label: string, update: (r: ResultRecord) => ResultRecord, href: string): CommitResult {
  return commit(label, (s) => withCatalog(s, (c) => ({ ...c, results: { ...c.results, [resultId]: update(c.results[resultId]!) } })), { href })
}

function resultHref(state: PrototypeState, record: ResultRecord): string {
  const run = record.runId ? state.catalog.runs[record.runId] : undefined
  if (run) return runHref(run, "results")
  const group = record.groupId ? state.catalog.runGroups[record.groupId] : undefined
  return group ? groupHref(group, "results") : "/projects"
}

/** Inspect again: record the identity of the bytes the file holds now. */
export function inspectResult(resultId: string): CommitResult {
  const state = store.getState()
  const record = state.catalog.results[resultId]
  if (!record) return MISSING
  const href = resultHref(state, record)
  const file = fileAt(state.disk, record.path)
  if (!file) return refuse(`Inspect ${fileName(record.path)} refused`, ["The file cannot be read now"], href)
  const result = editResult(resultId, "Inspect Result", (r) => ({ ...r, sha256: file.sha256, processingState: file.growing ? "pending" : "written", contentState: "unchanged" }), href)
  if (result.ok) recordSaved(`Inspected ${fileName(record.path)}`, `SHA-256 ${file.sha256.slice(0, 12)}… recorded.`, href)
  return result
}

/** Accept, bound to the current bytes (RES-FR-04, D19). */
export function acceptResult(resultId: string): CommitResult {
  const state = store.getState()
  const record = state.catalog.results[resultId]
  if (!record) return MISSING
  const href = resultHref(state, record)
  const title = `Accept ${fileName(record.path)} refused`
  if (record.intermediate) return refuse(title, ["Processing intermediates are never candidates"], href)
  const file = fileAt(state.disk, record.path)
  if (!file) return refuse(title, ["The file cannot be read now"], href)
  if (file.growing) return refuse(title, ["Pending: the application is still writing it"], href)
  if (file.sha256 !== record.sha256) return refuse(title, ["Its bytes changed since inspection (SHA-256 differs). Inspect it again first"], href)
  if (record.kind === null) return refuse(title, ["Choose its kind first"], href)
  const at = nowIso()
  const result = editResult(resultId, "Accept Result", (r) => ({ ...r, acceptance: "accepted", acceptedAt: at, processingState: "written" }), href)
  if (result.ok) recordSaved(`Accepted ${fileName(record.path)}`, `Bound to SHA-256 ${file.sha256.slice(0, 12)}…; protected Keep, never listed by Clean up.`, href)
  return result
}

export function setResultKind(resultId: string, kind: ResultKind): CommitResult {
  const state = store.getState()
  const record = state.catalog.results[resultId]
  if (!record) return MISSING
  return editResult(resultId, "Result kind", (r) => ({ ...r, kind }), resultHref(state, record))
}

/** "Use as input to a new run": a new run of any open Project gets the accepted product as an input (D-W4, D-W56). */
export function startRunWithResult(resultId: string, projectId: string, subjectId: string, rigId: string): { result: CommitResult; runId: string | null } {
  const state = store.getState()
  const record = state.catalog.results[resultId]
  const project = state.catalog.projects[projectId]
  if (!record || !project) return { result: MISSING, runId: null }
  const href = resultHref(state, record)
  const title = `Use ${fileName(record.path)} as an input refused`
  if (record.acceptance !== "accepted" || record.intermediate) return { result: refuse(title, ["Accept it first: only accepted products are inputs"], href), runId: null }
  const subject = project.subjects.find((s) => s.id === subjectId)
  if (subject?.mosaic) return { result: refuse(title, ["A mosaic subject starts a run group; add the product in a panel run's Select step"], href), runId: null }
  const started = startRun(projectId, subjectId, rigId)
  if (!started.result.ok || !started.runId) return { result: started.result, runId: null }
  const run = store.getState().catalog.runs[started.runId]
  const existing = run ? (workingContent(run)?.productInputs ?? []) : []
  const result = setProductInputs(started.runId, [...existing, resultId])
  return { result, runId: started.runId }
}

// ---------------------------------------------------------------------------
// Clean up (PREP-FR-14) and Complete all
// ---------------------------------------------------------------------------

export function startCleanup(runId: string, paths: string[]): { result: CommitResult; operationId: string | null } {
  const state = store.getState()
  const run = state.catalog.runs[runId]
  if (!run) return { result: MISSING, operationId: null }
  const href = runHref(run, "done")
  const title = `Clean up ${run.name} refused`
  if (run.trashedAt) return { result: refuse(title, [`${run.name} is in the Project's Trash; Empty Trash handles its folders`], href), operationId: null }
  if (run.completion !== "complete") return { result: refuse(title, ["Clean up comes after Complete: mark the run Complete first"], href), operationId: null }
  const running = completeRefusals(state, run)
  if (running.length > 0) return { result: refuse(title, running, href), operationId: null }
  const review = cleanupReview(state, run)
  const allowed = new Set(review.entries.map((e) => e.path))
  const chosen = paths.filter((p) => allowed.has(p))
  if (chosen.length === 0) return { result: refuse(title, ["No prepared entry is selected"], href), operationId: null }
  const payload: CleanupPayload = { runId, folders: [...new Set(review.entries.map((e) => e.prep.folderPath))], queue: chosen.map((path) => ({ path })), done: [], href }
  const operationId = startOperation({
    kind: "cleanup",
    title: `Clean up ${run.name}`,
    scope: { runIds: [run.id], projectId: run.projectId },
    total: chosen.length,
    unit: "entries",
    items: chosen.map((path) => ({ id: path, label: fileName(path), path, status: "pending", phase: null, detail: null })),
    payload: payload as unknown as Record<string, unknown>,
    canCancel: false,
  })
  return { result: { ok: true }, operationId }
}

/** Complete every live panel that is not Complete; a trashed panel is skipped (D-W75). */
export function completeAllPanels(groupId: string): CommitResult {
  const state = store.getState()
  const group = state.catalog.runGroups[groupId]
  if (!group) return MISSING
  const open = livePanelRuns(state, group).filter((r) => r.completion !== "complete")
  if (open.length === 0) return refuse(`Complete all ${group.name} refused`, ["Every panel outside the Trash is already Complete"], groupHref(group, "done"))
  const blockers = open.flatMap((r) => completeRefusals(state, r).map((reason) => `${r.name}: ${reason}`))
  if (blockers.length > 0) return refuse(`Complete all ${group.name} refused`, blockers, groupHref(group, "done"))
  for (const run of open) {
    const result = completeRun(run.id)
    if (!result.ok) return result
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Prototype controls: the simulated application and disk
// ---------------------------------------------------------------------------

function uniquePath(state: PrototypeState, path: string): string {
  if (!fileAt(state.disk, path)) return path
  const dot = path.lastIndexOf(".")
  for (let n = 2; n < 50; n += 1) {
    const candidate = `${path.slice(0, dot)} (${n})${path.slice(dot)}`
    if (!fileAt(state.disk, candidate)) return candidate
  }
  return `${path.slice(0, dot)} (${Date.now().toString(36)})${path.slice(dot)}`
}

/** Prototype: the application writes into the recorded Results folder (a stack, a file still being written, intermediates, a master dark). */
export function simulateApplicationOutput(target: { runId?: string; groupId?: string }): CommitResult {
  const state = store.getState()
  const run = target.runId ? state.catalog.runs[target.runId] : undefined
  const group = target.groupId ? state.catalog.runGroups[target.groupId] : undefined
  const folder = run ? resultsFolders(state, run)[0] : group ? groupAssembledPath(state, group) : null
  const href = run ? runHref(run, "results") : group ? groupHref(group, "results") : null
  if (!folder || (run && runPreparations(state.catalog, run.id).length === 0)) return refuse("Simulated output refused", ["Prepare the run first: the application writes into the recorded Results folder"], href)
  const volumeId = volumeForPath(state.disk, folder)
  if (!volumeId || !state.disk.volumes[volumeId]?.mounted) return refuse("Simulated output refused", [`${folder} is offline`], href)
  const at = nowIso()
  const files: DiskFile[] = []
  if (run) {
    const content = latestRevision(run)
    const members = content ? memberSessions(state.catalog, content) : []
    const channels = [...new Set(members.map((m) => m.session.channel ?? "L"))]
    for (const channel of channels) files.push(makeFile({ path: uniquePath(state, `${folder}/master/masterLight_BIN-1_FILTER-${channel}_mono.xisf`), volumeId, sizeBytes: 208_000_000, kind: "xisf", modifiedAt: at, sha256: fakeSha256(`${folder}/${channel}/${at}`) }))
    const first = members[0]?.included[0] ? state.catalog.assets[members[0].included[0]] : undefined
    const stem = first ? first.fileName.replace(/\.(fits?|xisf)$/i, "") : "Light_0001"
    files.push(makeFile({ path: uniquePath(state, `${folder}/calibrated/${stem}_c.xisf`), volumeId, sizeBytes: 104_000_000, kind: "xisf", modifiedAt: at }))
    files.push(makeFile({ path: uniquePath(state, `${folder}/registered/${stem}_c_r.xisf`), volumeId, sizeBytes: 104_000_000, kind: "xisf", modifiedAt: at }))
    files.push(makeFile({ path: uniquePath(state, `${folder}/master/masterDark_BIN-1_EXPOSURE-300.00s.xisf`), volumeId, sizeBytes: 104_000_000, kind: "xisf", modifiedAt: at }))
    files.push(makeFile({ path: uniquePath(state, `${folder}/${run.name} stack.xisf`), volumeId, sizeBytes: 52_000_000, kind: "xisf", modifiedAt: at, growing: true }))
  } else if (group) {
    files.push(makeFile({ path: uniquePath(state, `${folder}/${group.name} assembled.xisf`), volumeId, sizeBytes: 620_000_000, kind: "xisf", modifiedAt: at }))
  }
  const result = commit("Prototype: application output", (s) => ({ ...s, disk: createFolder(writeFiles(s.disk, files), { volumeId, path: folder }) }), { href: href ?? undefined })
  if (result.ok) recordSaved("Prototype: the application wrote outputs", `${plural(files.length, "file")} in ${folder}.`, href)
  return result
}

/** Prototype: a file still being written finishes; its listing is inspected again on settle. */
export function finishWriting(resultId: string): CommitResult {
  const state = store.getState()
  const record = state.catalog.results[resultId]
  if (!record) return MISSING
  const file = fileAt(state.disk, record.path)
  if (!file?.growing) return { ok: true }
  const sha256 = fakeSha256(record.path, 2)
  const done = { ...file, growing: false, sha256, sizeBytes: file.sizeBytes * 4, modifiedAt: nowIso() }
  return commit(
    "Prototype: file finished writing",
    (s) => ({ ...withCatalog(s, (c) => ({ ...c, results: { ...c.results, [resultId]: { ...c.results[resultId]!, processingState: "written", sha256 } } })), disk: writeFiles(s.disk, [done]) }),
    { href: resultHref(state, record) },
  )
}

/** Prototype: record a catalog OBJECT correction on the run's first member session (PREP-FR-03). */
export function simulateObjectCorrection(runId: string): CommitResult {
  const state = store.getState()
  const run = state.catalog.runs[runId]
  if (!run) return MISSING
  const content = latestRevision(run)
  const member = content ? memberSessions(state.catalog, content)[0] : undefined
  const href = runHref(run, "prepare")
  if (!member) return refuse("Simulated correction refused", ["The run has no saved member session"], href)
  const session = member.session
  const target = session.target.value ? state.catalog.targets[session.target.value] : undefined
  const corrected = target?.name ?? "NGC 7000"
  const header = state.catalog.assets[member.included[0]!]?.observed.object ?? null
  const observed = header && header !== corrected ? header : corrected.replace(/\s+/g, "")
  if (session.corrections.some((c) => c.field === "target" && c.correctedValue === corrected)) return refuse("Simulated correction refused", ["This session already carries that correction"], href)
  return commit(
    "Prototype: catalog correction",
    (s) => withCatalog(s, (c) => ({ ...c, sessions: { ...c.sessions, [session.id]: { ...c.sessions[session.id]!, corrections: [...c.sessions[session.id]!.corrections, { id: freshId("cor", session.id), field: "target", observedValue: observed, correctedValue: corrected, at: nowIso(), revision: session.revision }] } } })),
    { href },
  )
}

/** Prototype: an external tool rewrites one prepared source frame, so the next Open finds drift. */
export function simulateSourceDrift(runId: string): CommitResult {
  const state = store.getState()
  const run = state.catalog.runs[runId]
  if (!run) return MISSING
  const href = runHref(run, "prepare")
  const prep = currentPreparation(run, runPreparations(state.catalog, run.id))
  const assetId = prep?.preparedAssetIds[0]
  const asset = assetId ? state.catalog.assets[assetId] : undefined
  const path = asset?.copies.find((c) => fileAt(state.disk, c.path))?.path
  const file = path ? fileAt(state.disk, path) : undefined
  if (!file || !path) return refuse("Simulated change refused", ["No readable prepared source frame"], href)
  const changed = { ...file, previousSha256: file.sha256, sha256: fakeSha256(path, 9), modifiedAt: nowIso() }
  return commit("Prototype: source frame changed", (s) => ({ ...s, disk: writeFiles(s.disk, [changed]) }), { href })
}
