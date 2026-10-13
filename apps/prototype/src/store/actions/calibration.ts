/**
 * Calibration writes (foundation-owned; P-CAL2, P-CAL3).
 *
 * The calibration process (`domain/calibration-process.ts`):
 * - `startStack` hands a raw calibration session to a tool profile and starts
 *   a `stack-master` operation that watches the output folder. When the
 *   master appears (Prototype › "Tool finished stacking") the watch detects
 *   it by itself, then Import, Register and Raws run in order.
 * - `detectMasters`, `importMaster`, `discardRaws` and `keepRaws` resume a
 *   process by hand at their step. Every step records its state; a failed
 *   step records its reason and nothing after it runs.
 * - `importMasterFile` imports a master stacked elsewhere directly into
 *   structured calibration storage.
 * - `setKeepRawCalibration` is the Settings toggle: off (the default) moves
 *   the raws to the OS Trash once their master registers.
 *
 * Dismiss and Restore (P-CAL2): `dismissMaster` takes an unused master out
 * of the library's list (it is never matched while dismissed), and
 * `restoreMaster` brings it back. A run's master offer is dismissed on its
 * Calibrate step (`dismissMasterOffer`); `restoreMasterOffer` makes it pending
 * again.
 *
 * No silent re-rank (round 6): every write that makes a master matchable
 * (Register, Restore, adopting an offer) first records each run's current
 * automatic choices (`pinAutomaticChoices`), so a run keeps its masters and a
 * better one shows as "Better match available".
 */
import {
  awaitingStackProcess,
  CALIBRATION_STEP_NAME,
  CALIBRATION_STEPS,
  calibrationStorage,
  findStackedMaster,
  masterStoragePath,
  processForSession,
  processRef,
  rawFrameIds,
  sessionMasterValues,
  stackOutputFolder,
  stackRefusals,
  stepRecord,
} from "@/domain/calibration-process"
import { automaticAssignments, calibrationPlan, KIND_NOUN, type MasterMatch, masterImportMatch, repointAssignments, replacementRefusal } from "@/domain/calibration"
import { dismissBlockers, masterUsage } from "@/domain/calibration-library"
import { createFolder, fileAt, makeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { isUnder, nightOf, readFiles, stableHash } from "@/domain/indexing"
import { masterReplacementRuns, runSetup, workingContent } from "@/domain/derive"
import { unitCount } from "@/domain/labels"
import { headerNamingValues } from "@/domain/templates"
import type { CalibrationKind, CalibrationMaster, CalibrationProcess, CalibrationProcessId, CalibrationStepId, CalibrationStepRecord, MasterId, OperationId, ProfileId, RunId, SessionId } from "@/domain/types"
import { fileName } from "@/lib/format"
import { type MessageRef, msg, verbatim } from "@/lib/i18n"
import { type CommitResult, commit, nowIso, type PrototypeState, store, withCatalog } from "@/store/core"
import { addOperation, ensureTicker, type OperationHandler, patchOperation, settleOperation } from "@/store/operations"
import { editRun } from "./runs"
import { freshId, MISSING, recordSaved, refuse } from "./shared"
import { queueOsTrash } from "./trash"

const HREF = "/calibration"

const DETECT_BLOCKED = msg("store_blocked", { label: CALIBRATION_STEP_NAME.detect })
const IMPORT_BLOCKED = msg("store_blocked", { label: CALIBRATION_STEP_NAME.import })

/**
 * Record every automatic choice runs show now as their assignment, before a
 * master joins the matched set: a run with masters assigned keeps them, and
 * a better master is offered instead of taking over (no silent re-rank). A
 * Complete run shows none: it recorded its choices on Complete.
 */
export function pinAutomaticChoices(state: PrototypeState): PrototypeState {
  const { catalog, disk } = state
  const at = nowIso()
  let runs: PrototypeState["catalog"]["runs"] | null = null
  for (const run of Object.values(catalog.runs)) {
    if (runSetup(catalog, run).calibrationPolicy !== "automatic") continue
    const pins = automaticAssignments(catalog, disk, run.id, calibrationPlan(catalog, disk, run, "automatic", workingContent(run)), at)
    if (pins.length === 0) continue
    runs ??= { ...catalog.runs }
    runs[run.id] = { ...run, calibration: [...run.calibration, ...pins] }
  }
  return runs ? { ...state, catalog: { ...catalog, runs } } : state
}

interface WatchPayload {
  processId: CalibrationProcessId
}

/** "done": the next step may run; "wait": the step runs on (watching, or an OS Trash move); "failed": it recorded its reason. */
type Outcome = "done" | "wait" | "failed"

interface StepResult {
  state: PrototypeState
  outcome: Outcome
}

function writeProcess(state: PrototypeState, process: CalibrationProcess): PrototypeState {
  return { ...state, catalog: { ...state.catalog, calibrationProcesses: { ...state.catalog.calibrationProcesses, [process.id]: { ...process, updatedAt: nowIso() } } } }
}

function setStep(state: PrototypeState, process: CalibrationProcess, step: CalibrationStepId, record: CalibrationStepRecord, patch: Partial<CalibrationProcess> = {}): PrototypeState {
  return writeProcess(state, { ...process, ...patch, steps: { ...process.steps, [step]: record } })
}

function fail(state: PrototypeState, process: CalibrationProcess, step: CalibrationStepId, reason: MessageRef): StepResult {
  return { state: setStep(state, process, step, stepRecord("failed", nowIso(), reason)), outcome: "failed" }
}

/** Detect: the master the tool wrote into the output folder. While watching, nothing there yet means wait, not failure. */
function detect(state: PrototypeState, process: CalibrationProcess, watching: boolean): StepResult {
  const folder = process.outputFolder
  if (!folder) return fail(state, process, "detect", msg("run_parent_none"))
  const volumeId = volumeForPath(state.disk, folder)
  const volume = volumeId ? state.disk.volumes[volumeId] : undefined
  if (!volume?.mounted) return watching ? { state, outcome: "wait" } : fail(state, process, "detect", volume ? msg("issue_location_offline", { name: volume.name }) : msg("store_cal_output_folder_offline"))
  const file = findStackedMaster(state.disk, folder, process.kind)
  if (!file) return watching ? { state, outcome: "wait" } : fail(state, process, "detect", msg("store_cal_tool_output_not_found"))
  const detected = { path: file.path, sha256: file.sha256, ncombine: file.header?.ncombine ?? null }
  return { state: setStep(state, process, "detect", stepRecord("done", nowIso()), { detected }), outcome: "done" }
}

/** Import: copy the detected master into structured calibration storage, laid out per kind; the copy is verified. */
function importStep(state: PrototypeState, process: CalibrationProcess): StepResult {
  const detected = process.detected
  if (!detected) return fail(state, process, "import", msg("store_cal_nothing_detected"))
  const storage = calibrationStorage(state.catalog)
  if (!storage) return fail(state, process, "import", msg("import_no_calibration_location"))
  const source = fileAt(state.disk, detected.path)
  if (!source?.header) return fail(state, process, "import", msg("store_cal_master_unreadable"))
  if (source.sha256 !== detected.sha256) return fail(state, process, "import", msg("store_cal_master_changed"))
  const session = process.sessionId ? state.catalog.sessions[process.sessionId] : undefined
  const values = session ? sessionMasterValues(state.catalog, session, process.kind) : headerNamingValues(source.header, `master-${process.kind}`)
  const night = session?.night ?? nightOf(source.header.dateObs)
  const ext = source.path.slice(source.path.lastIndexOf(".") + 1)
  const path = masterStoragePath(storage, state.settings.naming, process.kind, values, night, ext)
  const volumeId = volumeForPath(state.disk, path)
  if (!volumeId || !state.disk.volumes[volumeId]?.mounted) return fail(state, process, "import", msg("issue_location_offline", { name: storage.displayName }))
  if (state.disk.deniedPaths.some((p) => isUnder(path, p))) return fail(state, process, "import", msg("status_access_denied"))
  if (state.disk.readOnlyPaths.some((p) => isUnder(path, p))) return fail(state, process, "import", msg("store_cal_write_permission_removed"))
  const existing = fileAt(state.disk, path)
  if (existing && existing.sha256 !== source.sha256) return fail(state, process, "import", msg("import_name_taken"))
  let next = state
  if (!existing) {
    if (state.faults.failNextHashVerification) {
      next = { ...state, faults: { ...state.faults, failNextHashVerification: false } }
      return fail(next, process, "import", msg("store_cal_copy_not_verified"))
    }
    const copy = makeFile({ path, volumeId, sizeBytes: source.sizeBytes, kind: source.kind, header: source.header, sha256: source.sha256, pixelTruth: source.pixelTruth, modifiedAt: nowIso() })
    next = { ...state, disk: writeFiles(state.disk, [copy]) }
  }
  return { state: setStep(next, process, "import", stepRecord("done", nowIso()), { storagePath: path }), outcome: "done" }
}

/** Register: index the stored master and record its lineage to the raw session it was stacked from. */
function register(state: PrototypeState, process: CalibrationProcess): StepResult {
  const storage = calibrationStorage(state.catalog)
  const file = process.storagePath ? fileAt(state.disk, process.storagePath) : undefined
  if (!storage || !file) return fail(state, process, "register", msg("store_cal_master_missing"))
  const at = nowIso()
  const pinned = pinAutomaticChoices(state)
  const catalog = readFiles(pinned.catalog, storage, [file], at)
  const id: MasterId = `mst_${stableHash(file.path)}`
  const master = catalog.masters[id]
  if (!master) return fail(state, process, "register", msg("store_cal_not_a_master"))
  const session = process.sessionId ? catalog.sessions[process.sessionId] : undefined
  const rigId = session && (session.equipment.status === "confirmed" || session.equipment.status === "associated") ? session.equipment.value : null
  catalog.masters[id] = {
    ...master,
    frameCount: process.detected?.ncombine ?? master.frameCount ?? (session ? session.assetIds.length : null),
    opticalTrainId: process.kind === "flat" ? (rigId ?? master.opticalTrainId) : null,
    origin: { kind: session ? "stacked" : "imported", runId: null, sourcePath: process.detected?.path ?? file.path, sessionId: process.sessionId },
    adoption: { destinationPath: file.path, verifiedSha256: file.sha256, adoptedAt: at },
  }
  return { state: setStep({ ...pinned, catalog }, process, "register", stepRecord("done", at), { masterId: id }), outcome: "done" }
}

/** Raws: kept when the setting says so, otherwise moved to the OS Trash (the episode settles the step). */
function raws(state: PrototypeState, process: CalibrationProcess, force: "trash" | null = null): StepResult {
  const at = nowIso()
  if (!process.sessionId) return { state: setStep(state, process, "raws", stepRecord("skipped", at)), outcome: "done" }
  if (force === null && state.settings.keepRawCalibration) return { state: setStep(state, process, "raws", stepRecord("done", at), { raws: "kept" }), outcome: "done" }
  const ids = rawFrameIds(state.catalog, process)
  if (ids.length === 0) return { state: setStep(state, process, "raws", stepRecord("done", at), { raws: "trashed" }), outcome: "done" }
  const items = ids.flatMap((assetId) => state.catalog.assets[assetId]!.copies.map((c) => ({ path: c.path, assetId })))
  const queued = queueOsTrash(state, {
    kind: "calibration-raws",
    title: msg("store_cal_trash_raws_title", { name: processRef(state.catalog, process) }),
    projectId: null,
    runIds: [],
    items,
    unit: "frames",
    href: HREF,
    calibrationProcessId: process.id,
  })
  return { state: setStep(queued.state, process, "raws", stepRecord("running", at), { operationId: queued.operationId }), outcome: "wait" }
}

/**
 * Run the process from `from` until a step waits or fails. Done and skipped
 * steps are passed over, so a resumed process continues where it stopped.
 */
function advance(state: PrototypeState, id: CalibrationProcessId, from: CalibrationStepId, watching: boolean): PrototypeState {
  let next = state
  for (const step of CALIBRATION_STEPS.slice(CALIBRATION_STEPS.indexOf(from))) {
    const process = next.catalog.calibrationProcesses[id]
    if (!process) return next
    const current = process.steps[step].state
    if (current === "done" || current === "skipped") continue
    if (step === "stack") return next
    const result = step === "detect" ? detect(next, process, watching) : step === "import" ? importStep(next, process) : step === "register" ? register(next, process) : raws(next, process)
    next = result.state
    if (result.outcome !== "done") return next
  }
  return next
}

/** Settle the output-folder watch once Detect is no longer running: the master registered, or a step failed. */
function settleWatch(state: PrototypeState, id: CalibrationProcessId): PrototypeState {
  const process = state.catalog.calibrationProcesses[id]
  const op = Object.values(state.operations).find((o) => o.kind === "stack-master" && o.status === "running" && (o.payload as unknown as WatchPayload).processId === id)
  if (!process || !op || process.steps.detect.state === "running") return state
  const failed = CALIBRATION_STEPS.find((s) => process.steps[s].state === "failed")
  const frames = process.detected?.ncombine ?? 0
  const next = patchOperation(writeProcess(state, { ...process, operationId: process.steps.raws.state === "running" ? process.operationId : null }), op.id, { progress: { done: frames, total: frames, unit: "frames" } })
  if (failed) return settleOperation(next, op.id, "failed", msg("store_cal_failed_at", { reason: process.steps[failed].reason ?? msg("status_failed"), step: CALIBRATION_STEP_NAME[failed] }), HREF)
  return settleOperation(next, op.id, "succeeded", msg("store_cal_registered_from", { file: fileName(process.storagePath ?? ""), frames: unitCount("frames", frames) }), HREF)
}

const watchHandler: OperationHandler = {
  kind: "stack-master",
  survivesRestart: true,
  step: (state, op) => {
    const { processId } = op.payload as unknown as WatchPayload
    const process = state.catalog.calibrationProcesses[processId]
    if (!process) return settleOperation(state, op.id, "failed", msg("store_cal_process_missing"), HREF)
    if (process.steps.detect.state !== "running") return settleWatch(state, processId)
    const next = advance(state, processId, "detect", true)
    return next === state ? state : settleWatch(next, processId)
  },
  cancel: (state, op) => {
    const { processId } = op.payload as unknown as WatchPayload
    const process = state.catalog.calibrationProcesses[processId]
    if (!process || process.steps.detect.state !== "running") return state
    const steps = { ...process.steps, stack: stepRecord("todo", nowIso(), msg("status_canceled")), detect: stepRecord("todo") }
    return writeProcess(state, { ...process, steps, operationId: null })
  },
  href: () => HREF,
}

/** Stack (P-CAL3): hand a raw calibration session to a tool profile and watch its output folder. Returns the watch operation id. */
export function startStack(sessionId: SessionId, profileId: ProfileId | null): { result: CommitResult; operationId: OperationId | null } {
  const state = store.getState()
  const reasons = stackRefusals(state.catalog, state.settings, sessionId, profileId)
  if (reasons.length > 0 || !profileId) return { result: refuse(msg("store_blocked", { label: msg("verb_stack") }), reasons, HREF), operationId: null }
  const profile = state.catalog.profiles[profileId]!
  let operationId: OperationId | null = null
  const result = commit(
    msg("store_cal_stack_with", { name: profile.name }),
    (s) => {
      const session = s.catalog.sessions[sessionId]!
      const at = nowIso()
      const base = processForSession(s.catalog, sessionId) ?? awaitingStackProcess(session, at)
      const folder = stackOutputFolder(s.catalog, s.settings, base)!
      const volumeId = volumeForPath(s.disk, folder)
      const disk = volumeId ? createFolder(s.disk, { volumeId, path: folder }) : s.disk
      const added = addOperation(
        { ...s, disk },
        {
          kind: "stack-master",
          title: msg("store_cal_stack_title", { name: processRef(s.catalog, base) }),
          scope: { sessionIds: [sessionId] },
          total: 0,
          unit: "frames",
          payload: { processId: base.id } as WatchPayload as unknown as Record<string, unknown>,
          canCancel: true,
        },
      )
      operationId = added.id
      const steps = { stack: stepRecord("done", at), detect: stepRecord("running", at), import: stepRecord("todo"), register: stepRecord("todo"), raws: stepRecord("todo") }
      return writeProcess(added.state, { ...base, profileId, outputFolder: folder, detected: null, storagePath: null, masterId: null, raws: null, steps, operationId: added.id })
    },
    { href: HREF },
  )
  if (!result.ok) return { result, operationId: null }
  ensureTicker()
  return { result, operationId }
}

function processOrRefuse(processId: CalibrationProcessId, title: MessageRef): CalibrationProcess | CommitResult {
  return store.getState().catalog.calibrationProcesses[processId] ?? refuse(title, [msg("store_cal_process_not_found")], HREF)
}

const isProcess = (value: CalibrationProcess | CommitResult): value is CalibrationProcess => "steps" in value

/** Detect master: look in the output folder now. It also runs by itself whenever the folder changes while watching. */
export function detectMasters(processId: CalibrationProcessId): CommitResult {
  const process = processOrRefuse(processId, DETECT_BLOCKED)
  if (!isProcess(process)) return process
  if (process.steps.stack.state !== "done") return refuse(DETECT_BLOCKED, [msg("store_cal_stack_first")], HREF)
  if (process.steps.detect.state === "done") return refuse(DETECT_BLOCKED, [msg("store_cal_already_detected")], HREF)
  const result = commit(
    msg("store_cal_detect_master"),
    (s) => {
      const current = s.catalog.calibrationProcesses[processId]!
      const reset = setStep(s, current, "detect", stepRecord("running", nowIso()))
      return settleWatch(advance(reset, processId, "detect", false), processId)
    },
    { href: HREF },
  )
  if (result.ok) ensureTicker()
  return result
}

/** Import master: resume Import and Register (and then Raws) after a failure. */
export function importMaster(processId: CalibrationProcessId): CommitResult {
  const process = processOrRefuse(processId, IMPORT_BLOCKED)
  if (!isProcess(process)) return process
  if (process.steps.detect.state !== "done") return refuse(IMPORT_BLOCKED, [msg("store_cal_nothing_detected_yet")], HREF)
  if (process.steps.register.state === "done") return refuse(IMPORT_BLOCKED, [msg("domain_stack_master_registered")], HREF)
  const result = commit(
    msg("store_cal_import_master"),
    (s) => {
      let current = s.catalog.calibrationProcesses[processId]!
      for (const step of ["import", "register"] as const) if (current.steps[step].state === "failed") current = { ...current, steps: { ...current.steps, [step]: stepRecord("todo") } }
      return advance(writeProcess(s, current), processId, "import", false)
    },
    { href: HREF },
  )
  if (result.ok) ensureTicker()
  return result
}

function rawsRefusals(process: CalibrationProcess): MessageRef[] {
  const reasons: MessageRef[] = []
  if (!process.sessionId) reasons.push(msg("store_cal_no_raw_frames"))
  if (process.steps.register.state !== "done") reasons.push(msg("store_cal_not_registered_yet"))
  if (process.steps.raws.state === "running") reasons.push(msg("store_cal_already_trashing"))
  if (process.raws === "trashed") reasons.push(msg("store_cal_raws_in_trash"))
  return reasons
}

/** Trash raws: move a process's raw frames to the OS Trash, whatever the setting says. */
export function discardRaws(processId: CalibrationProcessId): CommitResult {
  const blocked = msg("store_blocked", { label: msg("calibration_trash_raws") })
  const process = processOrRefuse(processId, blocked)
  if (!isProcess(process)) return process
  const reasons = rawsRefusals(process)
  if (reasons.length > 0) return refuse(blocked, reasons, HREF)
  const result = commit(msg("calibration_trash_raws"), (s) => raws(s, s.catalog.calibrationProcesses[processId]!, "trash").state, { href: HREF })
  if (result.ok) ensureTicker()
  return result
}

/** Keep raws: the raw frames stay where they are; Raws is done. */
export function keepRaws(processId: CalibrationProcessId): CommitResult {
  const blocked = msg("store_blocked", { label: msg("calibration_keep_raws") })
  const process = processOrRefuse(processId, blocked)
  if (!isProcess(process)) return process
  const reasons = rawsRefusals(process)
  if (reasons.length > 0) return refuse(blocked, reasons, HREF)
  if (process.raws === "kept") return { ok: true }
  return commit(msg("calibration_keep_raws"), (s) => setStep(s, s.catalog.calibrationProcesses[processId]!, "raws", stepRecord("done", nowIso()), { raws: "kept" }), { href: HREF })
}

/** Import a master stacked elsewhere directly into structured calibration storage: Stack and Detect are skipped. */
export function importMasterFile(path: string): { result: CommitResult; processId: CalibrationProcessId | null } {
  const state = store.getState()
  const file = fileAt(state.disk, path)
  const imageType = file?.header?.imageType ?? ""
  const reasons: MessageRef[] = []
  if (!file) reasons.push(msg("store_cal_path_unreadable", { path }))
  else if (!imageType.startsWith("master-")) reasons.push(msg("store_cal_not_master_imagetyp"))
  else if (Object.values(state.catalog.masters).some((m) => m.path === path || m.origin.sourcePath === path)) reasons.push(msg("store_cal_already_in_library"))
  if (reasons.length > 0 || !file) return { result: refuse(IMPORT_BLOCKED, reasons, HREF), processId: null }
  const at = nowIso()
  const id = freshId("cpr", path)
  const process: CalibrationProcess = {
    id,
    kind: imageType.slice("master-".length) as CalibrationKind,
    sessionId: null,
    profileId: null,
    outputFolder: null,
    detected: { path, sha256: file.sha256, ncombine: file.header?.ncombine ?? null },
    storagePath: null,
    masterId: null,
    raws: null,
    steps: { stack: stepRecord("skipped", at), detect: stepRecord("done", at), import: stepRecord("todo"), register: stepRecord("todo"), raws: stepRecord("skipped", at) },
    operationId: null,
    createdAt: at,
    updatedAt: at,
  }
  const result = commit(msg("store_cal_import_kind_master", { kind: KIND_NOUN[process.kind] }), (s) => advance(writeProcess(s, process), id, "import", false), { href: HREF })
  return { result, processId: result.ok ? id : null }
}

/** One file Import masters or Replace… handled (C9): its preview match, the outcome, the master it registered and the runs it re-pointed. */
export interface MasterImportOutcome {
  path: string
  match: MasterMatch | null
  result: CommitResult
  masterId: MasterId | null
  repointed: RunId[]
}

/** Import one file and run Import and Register; the registered master, or the refusal or failed step that stopped it. */
function importAndRegister(path: string): { result: CommitResult; masterId: MasterId | null } {
  const imported = importMasterFile(path)
  if (!imported.result.ok || !imported.processId) return { result: imported.result, masterId: null }
  const process = store.getState().catalog.calibrationProcesses[imported.processId]
  if (process?.masterId) return { result: imported.result, masterId: process.masterId }
  const failed = process ? CALIBRATION_STEPS.map((step) => process.steps[step]).find((r) => r.state === "failed") : undefined
  return { result: refuse(IMPORT_BLOCKED, [failed?.reason ?? msg("store_cal_master_missing")], HREF), masterId: null }
}

/**
 * Replace (C9): unfinished runs that hand off `oldId` now hand off `newId`,
 * each assignment keeping its state with the new master's basis; finished
 * runs keep what they recorded (D5). The old master leaves the list as
 * replaced and is never matched again. Automatic choices are recorded
 * first, so no run re-ranks by itself.
 */
function replaceWith(oldId: MasterId, newId: MasterId): { result: CommitResult; repointed: RunId[] } {
  const state = store.getState()
  const old = state.catalog.masters[oldId]
  if (!old) return { result: MISSING, repointed: [] }
  const repointed = masterReplacementRuns(state, oldId).map((r) => r.id)
  const at = nowIso()
  const result = commit(
    msg("flow_label_replace_master", { name: fileName(old.path) }),
    (s) => {
      const pinned = pinAutomaticChoices(s)
      return withCatalog(pinned, (c) => {
        const runs = { ...c.runs }
        for (const id of repointed) runs[id] = { ...runs[id]!, calibration: repointAssignments(c, pinned.disk, runs[id]!, oldId, newId, at) }
        return { ...c, runs, masters: { ...c.masters, [oldId]: { ...c.masters[oldId]!, dismissedAt: at, replacedBy: newId } } }
      })
    },
    { href: HREF },
  )
  if (result.ok) recordSaved(msg("flow_saved_master_replaced", { name: fileName(old.path), count: repointed.length }), null, HREF)
  return { result, repointed: result.ok ? repointed : [] }
}

/**
 * Import masters (C9): each selected file by its preview match
 * (`masterImportMatch`). New imports it; Replaces imports it and replaces the
 * master it matched; Duplicate and a file that is not a master are refused.
 */
export function importMasterFiles(paths: string[]): MasterImportOutcome[] {
  return paths.map((path): MasterImportOutcome => {
    const { catalog, disk } = store.getState()
    const file = fileAt(disk, path)
    const match = file ? masterImportMatch(catalog, disk, file) : null
    if (match?.kind === "duplicate") return { path, match, result: refuse(IMPORT_BLOCKED, [msg("store_cal_already_in_library")], HREF), masterId: null, repointed: [] }
    const imported = importAndRegister(path)
    if (!imported.masterId || match?.kind !== "replaces") return { path, match, ...imported, repointed: [] }
    const replaced = replaceWith(match.master.id, imported.masterId)
    return { path, match, result: replaced.result, masterId: imported.masterId, repointed: replaced.repointed }
  })
}

/**
 * Replace… on a master (C9): the file goes through the same matching; a
 * duplicate, a file of another kind or one that is not a master is refused.
 * Otherwise it is imported and the master replaced (`replaceWith`); the
 * confirm lists `masterReplacementRuns` first.
 */
export function replaceMaster(masterId: MasterId, path: string): MasterImportOutcome {
  const { catalog, disk } = store.getState()
  const master = catalog.masters[masterId]
  if (!master) return { path, match: null, result: MISSING, masterId: null, repointed: [] }
  const file = fileAt(disk, path)
  const match = file ? masterImportMatch(catalog, disk, file) : null
  const refusal = file ? replacementRefusal(catalog, disk, master, file) : msg("store_cal_path_unreadable", { path })
  if (refusal) return { path, match, result: refuse(msg("store_refused", { label: msg("flow_label_replace_master", { name: fileName(master.path) }) }), [refusal], HREF), masterId: null, repointed: [] }
  const imported = importAndRegister(path)
  if (!imported.masterId) return { path, match, ...imported, repointed: [] }
  const replaced = replaceWith(masterId, imported.masterId)
  return { path, match, result: replaced.result, masterId: imported.masterId, repointed: replaced.repointed }
}

/** Settings › Old masters after (C9): darks, bias and dark flats older than this many days read "Old · {n} d". */
export function setMasterMaxAgeDays(days: number): CommitResult {
  if (!Number.isInteger(days) || days < 1) return refuse(msg("store_refused", { label: msg("flow_settings_master_age") }), [msg("flow_reason_whole_days")], "/settings/calibration")
  return commit(msg("flow_settings_master_age"), (s) => ({ ...s, settings: { ...s.settings, masterMaxAgeDays: days } }), { href: "/settings/calibration" })
}

/** Settings › Keep raw calibration frames (off by default: raws go to the OS Trash once their master registers). */
export function setKeepRawCalibration(keep: boolean): CommitResult {
  return commit(msg("settings_keep_raws"), (s) => ({ ...s, settings: { ...s.settings, keepRawCalibration: keep } }), { href: "/settings/calibration" })
}

/** Restore offer (P-CAL2): a dismissed master offer is offered again on the run's Calibrate step. */
export function restoreMasterOffer(runId: RunId, masterId: MasterId): CommitResult {
  const run = store.getState().catalog.runs[runId]
  const offer = run?.masterOffers.find((o) => o.masterId === masterId)
  if (!run || !offer) return refuse(msg("store_refused", { label: msg("store_cal_restore_offer") }), [msg("store_cal_offer_missing")], HREF)
  if (offer.state !== "dismissed") return { ok: true }
  return editRun(runId, msg("store_cal_restore_master_offer"), (r) => ({ ...r, masterOffers: r.masterOffers.map((o) => (o.masterId === masterId ? { ...o, state: "pending", at: nowIso() } : o)) }), { step: "calibrate" })
}

/** Patch one master in one commit; a saved change is recorded in Activity under `saved`. `before` runs on the state first (pinning automatic choices). */
function editMaster(masterId: MasterId, label: MessageRef, saved: MessageRef, update: (master: CalibrationMaster) => CalibrationMaster, before: (state: PrototypeState) => PrototypeState = (s) => s): CommitResult {
  const result = commit(label, (s) => withCatalog(before(s), (c) => ({ ...c, masters: { ...c.masters, [masterId]: update(c.masters[masterId]!) } })), { href: HREF })
  if (result.ok) recordSaved(saved, null, HREF)
  return result
}

/** Take a master out of the library's list and out of matching (P-CAL2); refused while a run uses or offers it. */
function hide(masterId: MasterId, label: MessageRef, saved: (name: string) => MessageRef): CommitResult {
  const { catalog, disk } = store.getState()
  const master = catalog.masters[masterId]
  if (!master) return MISSING
  const blockers = dismissBlockers(catalog, masterUsage(catalog, disk), masterId)
  if (blockers.length > 0) return refuse(msg("store_refused", { label }), blockers.map((run) => verbatim(run.name)), HREF)
  if (master.dismissedAt) return { ok: true }
  return editMaster(masterId, label, saved(fileName(master.path)), (current) => ({ ...current, dismissedAt: nowIso() }))
}

/** Hide (C2, P-CAL2): the master leaves the library's list for Show hidden and is never matched; Restore brings it back. */
export function hideMaster(masterId: MasterId): CommitResult {
  return hide(masterId, msg("calibration_hide_master"), (name) => msg("calibration_hid_master", { name }))
}

/**
 * Dismiss (P-CAL2), worded as before.
 * @deprecated C2 renames the verb to Hide: use `hideMaster`. P8 migrates the Calibration page and W4 removes this.
 */
export function dismissMaster(masterId: MasterId): CommitResult {
  return hide(masterId, msg("calibration_dismiss_master"), (name) => msg("store_saved_dismissed", { name }))
}

/** Restore (P-CAL2): a dismissed master is back in the library's list and matched again. */
export function restoreMaster(masterId: MasterId): CommitResult {
  const master = store.getState().catalog.masters[masterId]
  if (!master) return MISSING
  if (!master.dismissedAt) return { ok: true }
  return editMaster(masterId, msg("calibration_restore_master"), msg("calibration_restored_master", { name: fileName(master.path) }), ({ dismissedAt: _dismissed, ...current }) => current, pinAutomaticChoices)
}

export const CALIBRATION_HANDLERS: OperationHandler[] = [watchHandler]
