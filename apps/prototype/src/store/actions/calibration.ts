/**
 * Calibration writes (foundation-owned; P-CAL2, P-CAL3, CAL-FR-13 to
 * CAL-FR-17, LIB-FR-23 to LIB-FR-26).
 *
 * The calibration process (`domain/calibration-process.ts`):
 * - `startStack` hands a raw calibration session to a tool profile and starts
 *   a `stack-master` operation that watches the output folder. When the
 *   master appears (Prototype › "Tool finished stacking") the watch detects
 *   it by itself, then Import, Register and Raws run in order.
 * - `detectMasters`, `importMaster`, `discardRaws` and `keepRaws` resume a
 *   process by hand at their step. Every step records its state; a failed
 *   step records its reason and nothing after it runs.
 * - Register indexes the stored master through `ingestFiles`: a new dated
 *   version of the master record whose settings it matches, else a new
 *   record, with its origin ("stacked" from its raw session, or "imported")
 *   on the version. Ingestion then fills only the light sessions still
 *   waiting; a pin never moves (CAL-FR-14).
 * - `importMasterFiles` imports masters stacked elsewhere by their preview
 *   match (`masterImportMatch`): New and New version import, Duplicate is
 *   refused. `addMasterVersion` imports one file as a new version of the
 *   master it names, which repoints nothing.
 * - `setKeepRawCalibration` is the Settings toggle: off (the default) moves
 *   the raws to the OS Trash once their master registers.
 *
 * The library: `setMasterCamera` links a master to one physical camera
 * (LIB-FR-26). `hideMaster` and `trashMaster` act on the whole master and
 * are refused while an open or Closed Project uses it through its sessions
 * (`masterProjects`, provisional CAL-FR-16/17); otherwise every session that
 * pins it (or has it suggested) goes back to waiting, with no automatic
 * re-match, and needs calibration again. `restoreMaster` makes a hidden
 * master matchable again.
 *
 * Session pins (LIB-FR-23, LIB-FR-25): Confirm a suggestion, Choose or
 * Reassign a source, set No darks / No flats / No bias, and "Also use for
 * these sessions" for sessions set to No. A pin changes only by these
 * writes; one whose file changed or went missing stays and puts its session
 * in Needs calibration (`needsCalibration`) until it is reassigned or the
 * file is back. Open Projects read the new pins as labelled pending changes;
 * a Closed Project keeps its frozen snapshot.
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
import {
  calibrateSessions,
  calibrationSources,
  candidatesFor,
  confirmChoice,
  importCameraRefusal,
  KIND_NOUN,
  type MasterMatch,
  masterImportMatch,
  masterKindOf,
  masterRecordRef,
  NO_KIND_NAME,
  noChoice,
  type PinCandidate,
  PIN_KINDS,
  pickChoice,
  pinHealth,
  sourceFor,
  sourceKey,
  sourceRef,
} from "@/domain/calibration"
import { masterPins, masterProjects } from "@/domain/calibration-library"
import { createFolder, fileAt, makeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { ingestFiles, isUnder, NO_MASTER_CAMERAS, nightOf } from "@/domain/indexing"
import { unitCount } from "@/domain/labels"
import { sessionRef } from "@/domain/membership"
import { type TrashItem, trashBlock, viewLinks } from "@/domain/storage"
import { headerNamingValues } from "@/domain/templates"
import type {
  CalibrationChoice,
  CalibrationProcess,
  CalibrationProcessId,
  CalibrationSource,
  CalibrationStepId,
  CalibrationStepRecord,
  CameraId,
  Catalog,
  MasterId,
  MasterVersionId,
  OperationId,
  PinKind,
  ProfileId,
  Session,
  SessionCalibration,
  SessionId,
} from "@/domain/types"
import { fileName, formatCount } from "@/lib/format"
import { joinRefs, type MessageRef, msg, verbatim } from "@/lib/i18n"
import { type CommitOptions, type CommitResult, commit, nowIso, type PrototypeState, store, withCatalog } from "@/store/core"
import { addOperation, ensureTicker, type OperationHandler, patchOperation, settleOperation } from "@/store/operations"
import { freshId, MISSING, recordSaved, refuse } from "./shared"
import { queueOsTrash } from "./trash"

const HREF = "/calibration"

const DETECT_BLOCKED = msg("store_blocked", { label: CALIBRATION_STEP_NAME.detect })
const IMPORT_BLOCKED = msg("store_blocked", { label: CALIBRATION_STEP_NAME.import })

// ---------------------------------------------------------------------------
// The calibration process (P-CAL3)
// ---------------------------------------------------------------------------

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
  const path = masterStoragePath(storage, state.settings, process.kind, values, night, ext)
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

/**
 * Register: ingest the stored master (CAL-FR-14), which makes it a new dated
 * version of the master whose settings it matches, or a new master, and
 * fills the light sessions still waiting. The version records where it came
 * from: stacked from its raw session, or imported.
 */
function register(state: PrototypeState, process: CalibrationProcess): StepResult {
  const storage = calibrationStorage(state.catalog)
  const file = process.storagePath ? fileAt(state.disk, process.storagePath) : undefined
  if (!storage || !file) return fail(state, process, "register", msg("store_cal_master_missing"))
  const at = nowIso()
  const cameras: ReadonlyMap<string, CameraId> = process.cameraId ? new Map([[file.path, process.cameraId]]) : NO_MASTER_CAMERAS
  const catalog = ingestFiles(state.catalog, state.disk, state.settings, storage, [file], at, cameras)
  const master = Object.values(catalog.masters).find((m) => m.versions.some((v) => v.path === file.path))
  const version = master?.versions.find((v) => v.path === file.path)
  if (!master || !version) return fail(state, process, "register", msg("store_cal_not_a_master"))
  const session = process.sessionId ? catalog.sessions[process.sessionId] : undefined
  const registered = {
    ...version,
    frameCount: version.frameCount ?? (session ? session.assetIds.length : null),
    origin: { kind: session ? ("stacked" as const) : ("imported" as const), projectId: null, sourcePath: process.detected?.path ?? file.path, sessionId: process.sessionId },
    adoption: { destinationPath: file.path, verifiedSha256: file.sha256, adoptedAt: at },
  }
  const masters = { ...catalog.masters, [master.id]: { ...master, versions: master.versions.map((v) => (v.id === version.id ? registered : v)) } }
  return { state: setStep({ ...state, catalog: { ...catalog, masters } }, process, "register", stepRecord("done", at), { masterId: master.id, versionId: version.id }), outcome: "done" }
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
      return writeProcess(added.state, { ...base, profileId, outputFolder: folder, detected: null, storagePath: null, masterId: null, versionId: null, raws: null, steps, operationId: added.id })
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

// ---------------------------------------------------------------------------
// Import masters (CAL-FR-13, CAL-FR-14)
// ---------------------------------------------------------------------------

/** One file Import masters or Add version handled: its preview match, the outcome, and the master and version it registered. */
export interface MasterImportOutcome {
  path: string
  match: MasterMatch | null
  result: CommitResult
  masterId: MasterId | null
  versionId: MasterVersionId | null
}

/**
 * Import one master file stacked elsewhere into structured calibration
 * storage as a process without a session (Stack and Detect skipped, Raws
 * does not apply), then Register it, linked to `cameraId` (LIB-FR-26). The
 * camera must be of the file's model, and one is needed while the rigs hold
 * several cameras of that model. `accept` refuses a match the caller does
 * not take; a file that is not a master, or a Duplicate, is always refused.
 * A failed step stays recorded on its process.
 */
function importOne(path: string, cameraId: CameraId | null, label: MessageRef, accept: (match: Exclude<MasterMatch, { kind: "duplicate" }>) => MessageRef | null): MasterImportOutcome {
  const { catalog, disk } = store.getState()
  const file = fileAt(disk, path)
  const match = file ? masterImportMatch(catalog, disk, file, cameraId) : null
  const kind = file ? masterKindOf(file) : null
  const outcome = (result: CommitResult, masterId: MasterId | null = null, versionId: MasterVersionId | null = null): MasterImportOutcome => ({ path, match, result, masterId, versionId })
  if (!file) return outcome(refuse(label, [msg("store_cal_path_unreadable", { path })], HREF))
  if (!match || !kind) return outcome(refuse(label, [msg("store_cal_not_master_imagetyp")], HREF))
  if (match.kind === "duplicate") return outcome(refuse(label, [msg("store_cal_already_in_library")], HREF))
  const cameraRefusal = importCameraRefusal(catalog, file.header?.instrument ?? null, cameraId)
  if (cameraRefusal) return outcome(refuse(label, [cameraRefusal], HREF))
  const refusal = accept(match)
  if (refusal) return outcome(refuse(label, [refusal], HREF))
  const at = nowIso()
  const id = freshId("cpr", path)
  const process: CalibrationProcess = {
    id,
    kind,
    sessionId: null,
    profileId: null,
    outputFolder: null,
    detected: { path, sha256: file.sha256, ncombine: file.header?.ncombine ?? null },
    cameraId,
    storagePath: null,
    masterId: null,
    versionId: null,
    raws: null,
    steps: { stack: stepRecord("skipped", at), detect: stepRecord("done", at), import: stepRecord("todo"), register: stepRecord("todo"), raws: stepRecord("skipped", at) },
    operationId: null,
    createdAt: at,
    updatedAt: at,
  }
  const result = commit(msg("store_cal_import_kind_master", { kind: KIND_NOUN[kind] }), (s) => advance(writeProcess(s, process), id, "import", false), { href: HREF })
  if (!result.ok) return outcome(result)
  const registered = store.getState().catalog.calibrationProcesses[id]
  if (registered?.masterId) return outcome(result, registered.masterId, registered.versionId)
  const failed = registered ? CALIBRATION_STEPS.map((step) => registered.steps[step]).find((r) => r.state === "failed") : undefined
  return outcome(refuse(label, [failed?.reason ?? msg("store_cal_master_missing")], HREF))
}

/** One file Import masters imports, and the camera the user linked it to (null: none chosen, it matches by model). */
export interface MasterImportFile {
  path: string
  cameraId: CameraId | null
}

/**
 * Import masters (CAL-FR-13): each selected file by its preview match
 * (`masterImportMatch`) with the camera chosen for it. New becomes a master
 * record linked to that camera; New version joins the record whose settings
 * and camera it shares as a dated version, which repoints no session;
 * Duplicate and a file that is not a master are refused. Light sessions
 * still waiting are filled; a pin never moves.
 */
export function importMasterFiles(files: MasterImportFile[]): MasterImportOutcome[] {
  return files.map((f) => importOne(f.path, f.cameraId, IMPORT_BLOCKED, () => null))
}

/**
 * Add version… on a master (CAL-FR-14): the file is imported as a new dated
 * version of this master. It repoints nothing: every session keeps the
 * version it pins, and only sessions still waiting take a match. Refused
 * unless the preview matches it as a new version of this very master.
 */
export function addMasterVersion(masterId: MasterId, path: string): MasterImportOutcome {
  const { catalog } = store.getState()
  const master = catalog.masters[masterId]
  if (!master) return { path, match: null, result: MISSING, masterId: null, versionId: null }
  const name = masterRecordRef(catalog, master)
  const label = msg("store_refused", { label: msg("store_cal_label_add_version", { master: name }) })
  return importOne(path, master.cameraId, label, (match) => (match.kind === "version" && match.master.id === masterId ? null : msg("store_cal_not_version_of", { master: name })))
}

/** Calibration settings › Old masters after (C9): darks and bias whose newest version is older than this many days read "Old · {n} d". */
export function setMasterMaxAgeDays(days: number): CommitResult {
  if (!Number.isInteger(days) || days < 1) return refuse(msg("store_refused", { label: msg("flow_settings_master_age") }), [msg("flow_reason_whole_days")], HREF)
  return commit(msg("flow_settings_master_age"), (s) => ({ ...s, settings: { ...s.settings, masterMaxAgeDays: days } }), { href: HREF })
}

/** Calibration settings › Keep raw calibration frames (off by default: raws go to the OS Trash once their master registers). */
export function setKeepRawCalibration(keep: boolean): CommitResult {
  return commit(msg("settings_keep_raws"), (s) => ({ ...s, settings: { ...s.settings, keepRawCalibration: keep } }), { href: HREF })
}

// ---------------------------------------------------------------------------
// The calibration library (CAL-FR-14 to CAL-FR-17, LIB-FR-26)
// ---------------------------------------------------------------------------

/**
 * Link a master to one physical camera (LIB-FR-26), or back to matching by
 * model (null): with two cameras of one model, darks and bias match only the
 * camera they are linked to, and a confirmed link is the explicit match.
 * Refused for a camera of another model. Sessions still waiting or
 * suggested are matched again; a pin never moves.
 */
export function setMasterCamera(masterId: MasterId, cameraId: CameraId | null): CommitResult {
  const { catalog } = store.getState()
  const master = catalog.masters[masterId]
  const camera = cameraId ? catalog.cameras[cameraId] : null
  if (!master || camera === undefined) return MISSING
  const name = masterRecordRef(catalog, master)
  const label = msg("store_cal_label_camera", { master: name })
  const model = master.cameraName
  if (camera && model && camera.name !== model && !camera.aliases.includes(model)) {
    return refuse(msg("store_refused", { label }), [msg("store_cal_camera_other_model", { camera: verbatim(camera.physicalAlias ?? camera.name), model: verbatim(model) })], HREF)
  }
  if (master.cameraId === cameraId) return { ok: true }
  const result = commit(
    label,
    (s) => {
      const linked = { ...s.catalog, masters: { ...s.catalog.masters, [masterId]: { ...s.catalog.masters[masterId]!, cameraId } } }
      return { ...s, catalog: calibrateSessions(linked, s.disk, s.settings, nowIso()) }
    },
    { href: HREF },
  )
  if (result.ok) recordSaved(camera ? msg("store_cal_camera_linked", { master: name, camera: verbatim(camera.physicalAlias ?? camera.name) }) : msg("store_cal_camera_unlinked", { master: name }), null, HREF)
  return result
}

/** Refused while an open or Closed Project uses the master through its sessions, naming them (provisional CAL-FR-16/17); null otherwise. */
function masterInUse(catalog: Catalog, masterId: MasterId, label: MessageRef): CommitResult | null {
  const projects = masterProjects(catalog, masterPins(catalog), masterId)
  return projects.length > 0 ? refuse(msg("store_refused", { label }), projects.map((p) => verbatim(p.name)), HREF) : null
}

/** Whether `choice` pins or suggests a version of `masterId`. */
function namesMaster(choice: CalibrationChoice, masterId: MasterId): boolean {
  return (choice.state === "pinned" || choice.state === "suggested") && choice.source.type === "master" && choice.source.masterId === masterId
}

/**
 * Every current session that pins or is suggested a version of `masterId`
 * goes back to waiting for that kind, with no automatic re-match
 * (provisional): it needs calibration again. Returns the catalog and how
 * many sessions changed.
 */
function releaseMaster(catalog: Catalog, masterId: MasterId): { catalog: Catalog; released: number } {
  let sessions = catalog.sessions
  let released = 0
  for (const session of Object.values(catalog.sessions)) {
    const current = session.calibration
    if (session.supersededBy || !current) continue
    const kinds = PIN_KINDS.filter((kind) => namesMaster(current[kind], masterId))
    if (kinds.length === 0) continue
    if (sessions === catalog.sessions) sessions = { ...catalog.sessions }
    const calibration: SessionCalibration = { ...current }
    for (const kind of kinds) calibration[kind] = { state: "waiting" }
    sessions[session.id] = { ...session, calibration }
    released += 1
  }
  return { catalog: released === 0 ? catalog : { ...catalog, sessions }, released }
}

function releasedDetail(released: number): MessageRef | null {
  return released === 0 ? null : msg("store_cal_sessions_need_calibration", { count: released, n: formatCount(released) })
}

/**
 * Hide (CAL-FR-16): the master leaves the library's list for Show hidden and
 * is never matched; Restore brings it back. Refused while a Project uses it
 * (`masterInUse`); otherwise its sessions go back to waiting (`releaseMaster`).
 */
export function hideMaster(masterId: MasterId): CommitResult {
  const { catalog } = store.getState()
  const master = catalog.masters[masterId]
  if (!master) return MISSING
  const label = msg("calibration_hide_master")
  const used = masterInUse(catalog, masterId, label)
  if (used) return used
  if (master.hiddenAt) return { ok: true }
  const released = releaseMaster(catalog, masterId).released
  const at = nowIso()
  const result = commit(
    label,
    (s) =>
      withCatalog(s, (c) => {
        const next = releaseMaster(c, masterId).catalog
        return { ...next, masters: { ...next.masters, [masterId]: { ...next.masters[masterId]!, hiddenAt: at } } }
      }),
    { href: HREF },
  )
  if (result.ok) recordSaved(msg("calibration_hid_master", { name: masterRecordRef(catalog, master) }), releasedDetail(released), HREF)
  return result
}

/** Restore (CAL-FR-16): a hidden master is back in the library's list and matched again; no session moves by itself. */
export function restoreMaster(masterId: MasterId): CommitResult {
  const { catalog } = store.getState()
  const master = catalog.masters[masterId]
  if (!master) return MISSING
  if (!master.hiddenAt) return { ok: true }
  const result = commit(
    msg("calibration_restore_master"),
    (s) =>
      withCatalog(s, (c) => {
        const { hiddenAt: _hidden, ...current } = c.masters[masterId]!
        return { ...c, masters: { ...c.masters, [masterId]: current } }
      }),
    { href: HREF },
  )
  if (result.ok) recordSaved(msg("calibration_restored_master", { name: masterRecordRef(catalog, master) }), null, HREF)
  return result
}

/**
 * Move to Trash (CAL-FR-17): every version's file goes to the OS Trash and
 * the master leaves the library. Refused while a Project uses it
 * (`masterInUse`), and when a version's file cannot go now (offline,
 * read-only, linked by an open Project's View), so no master is left half
 * moved; a version whose file is already gone has nothing to move. Its
 * sessions go back to waiting (`releaseMaster`). Returns the move's
 * operation id.
 */
export function trashMaster(masterId: MasterId): { result: CommitResult; operationId: OperationId | null } {
  const { catalog, disk } = store.getState()
  const master = catalog.masters[masterId]
  if (!master) return { result: MISSING, operationId: null }
  const name = masterRecordRef(catalog, master)
  const label = msg("store_label_move_to_trash_named", { name })
  const used = masterInUse(catalog, masterId, label)
  if (used) return { result: used, operationId: null }
  const links = viewLinks(catalog, disk)
  const items: TrashItem[] = []
  const blocked: MessageRef[] = []
  for (const version of master.versions) {
    const block = trashBlock(disk, links, version.path)
    if (!block) {
      const asset = Object.values(catalog.assets).find((a) => a.copies.some((c) => c.path === version.path))
      items.push(asset ? { path: version.path, assetId: asset.id } : { path: version.path })
      continue
    }
    const volumeId = volumeForPath(disk, version.path)
    const gone = !fileAt(disk, version.path) && volumeId !== null && disk.volumes[volumeId]?.mounted === true
    if (!gone) blocked.push(joinRefs([verbatim(fileName(version.path)), block.reason], " · "))
  }
  if (blocked.length > 0) return { result: refuse(msg("store_refused", { label }), blocked, HREF), operationId: null }
  const released = releaseMaster(catalog, masterId).released
  let operationId: OperationId | null = null
  const result = commit(
    label,
    (s) => {
      const next = releaseMaster(s.catalog, masterId).catalog
      const { [masterId]: _trashed, ...masters } = next.masters
      const queued = queueOsTrash({ ...s, catalog: { ...next, masters } }, { kind: "calibration-master", title: label, projectId: null, items, unit: "files", href: HREF })
      operationId = queued.operationId
      return queued.state
    },
    { href: HREF },
  )
  if (!result.ok) return { result, operationId: null }
  ensureTicker()
  if (released > 0) recordSaved(label, releasedDetail(released), HREF)
  return { result, operationId }
}

// ---------------------------------------------------------------------------
// Session pins (LIB-FR-23, LIB-FR-25)
// ---------------------------------------------------------------------------

/** One kind of one light session: what Confirm and No act on, singly or as a batch from the Needs calibration queue. */
export interface SessionKind {
  sessionId: SessionId
  kind: PinKind
}

type LightSession = Session & { calibration: SessionCalibration }

/** A current light session, the only kind that pins calibration. */
function lightSession(catalog: Catalog, sessionId: SessionId): LightSession | null {
  const session = catalog.sessions[sessionId]
  return session && !session.supersededBy && session.calibration ? (session as LightSession) : null
}

const sessionsHref = (sessionIds: ReadonlyArray<SessionId>) => (sessionIds.length === 1 ? `/sessions/${sessionIds[0]}` : "/sessions")

/** The candidate `source` is for one session and kind now (`candidatesFor`), or undefined when it is not offered: a hard check fails, or the source is hidden, changed or gone. */
function offered(state: PrototypeState, session: Session, kind: PinKind, source: CalibrationSource): PinCandidate | undefined {
  const key = sourceKey(source)
  return candidatesFor(state.catalog, state.settings, session, kind, calibrationSources(state.catalog, state.disk)).find((c) => c.source.key === key)
}

function notOffered(state: PrototypeState, session: Session, source: CalibrationSource): MessageRef {
  return msg("store_cal_not_offered", { source: sourceRef(state.catalog, state.disk, source), session: sessionRef(session) })
}

interface ChoiceWrite {
  sessionId: SessionId
  kind: PinKind
  choice: CalibrationChoice
}

/** Write session choices in one commit; one saved entry counts the sessions. */
function writeChoices(label: MessageRef, writes: ChoiceWrite[], href: string, expect?: CommitOptions["expect"]): CommitResult {
  if (writes.length === 0) return { ok: true }
  const result = commit(
    label,
    (s) =>
      withCatalog(s, (c) => {
        const sessions = { ...c.sessions }
        for (const { sessionId, kind, choice } of writes) {
          const session = sessions[sessionId]!
          sessions[sessionId] = { ...session, calibration: { ...session.calibration!, [kind]: choice } }
        }
        return { ...c, sessions }
      }),
    { href, expect },
  )
  const count = new Set(writes.map((w) => w.sessionId)).size
  if (result.ok) recordSaved(msg("store_cal_saved_sessions", { count, n: formatCount(count) }), null, href)
  return result
}

/**
 * Confirm (LIB-FR-23): each kind's suggestion becomes the user's pin with its
 * evidence (`confirmChoice`); a kind with no suggestion stays as it is.
 * Refused, nothing written, when a suggested file changed or went missing
 * since it was suggested: that pin would need calibration at once.
 */
export function confirmCalibration(picks: SessionKind[]): CommitResult {
  const state = store.getState()
  const label = msg("store_cal_label_confirm")
  const href = sessionsHref(picks.map((p) => p.sessionId))
  const at = nowIso()
  const writes: ChoiceWrite[] = []
  const reasons: MessageRef[] = []
  for (const { sessionId, kind } of picks) {
    const session = lightSession(state.catalog, sessionId)
    if (!session) return MISSING
    const current = session.calibration[kind]
    if (current.state !== "suggested") continue
    const choice = confirmChoice(current, at)
    const health = pinHealth(state.disk, choice)
    if ((health.state === "changed" || health.state === "missing") && health.path) reasons.push(msg("store_cal_suggestion_drifted", { path: verbatim(fileName(health.path)), session: sessionRef(session) }))
    else writes.push({ sessionId, kind, choice })
  }
  if (reasons.length > 0) return refuse(msg("store_refused", { label }), reasons, href)
  return writeChoices(label, writes, href)
}

/**
 * Choose… and Reassign (LIB-FR-25): the session pins `source` for `kind`,
 * by the user, with its evidence now (`pickChoice`), whatever it held
 * before (waiting, a suggestion, a pin, No). A suggested-only match counts
 * as confirmed. Refused when the source is not offered for the session.
 */
export function pickCalibration(sessionId: SessionId, kind: PinKind, source: CalibrationSource, expectRevision: number): CommitResult {
  const state = store.getState()
  const session = lightSession(state.catalog, sessionId)
  if (!session) return MISSING
  const label = msg("store_cal_label_choose", { kind: KIND_NOUN[kind], session: sessionRef(session) })
  const href = sessionsHref([sessionId])
  const candidate = offered(state, session, kind, source)
  if (!candidate) return refuse(msg("store_refused", { label }), [notOffered(state, session, source)], href)
  return writeChoices(label, [{ sessionId, kind, choice: pickChoice(candidate, nowIso()) }], href, { collection: "sessions", id: sessionId, revision: expectRevision })
}

/** No darks, No flats or No bias (CAL-FR-05): settles each kind with no reason, by the user, over whatever it held. */
export function setNoCalibration(picks: SessionKind[]): CommitResult {
  const { catalog } = store.getState()
  if (picks.some((p) => !lightSession(catalog, p.sessionId))) return MISSING
  const at = nowIso()
  return writeChoices(
    msg("store_cal_label_no"),
    picks.map(({ sessionId, kind }) => ({ sessionId, kind, choice: noChoice(at) })),
    sessionsHref(picks.map((p) => p.sessionId)),
  )
}

/**
 * Also use for these sessions (LIB-FR-25): sessions set to No for the
 * source's kind that it matches (`calibrationArrival`'s `noSessions`) pin it,
 * by the user. Refused, nothing written, for a session not set to No or one
 * the source is not offered for.
 */
export function alsoUseCalibration(source: CalibrationSource, sessionIds: SessionId[]): CommitResult {
  const state = store.getState()
  const calSource = sourceFor(state.catalog, state.disk, source)
  if (!calSource) return MISSING
  const kind = calSource.kind
  const label = msg("calibration_also_use_title")
  const href = sessionsHref(sessionIds)
  const at = nowIso()
  const writes: ChoiceWrite[] = []
  const reasons: MessageRef[] = []
  for (const sessionId of sessionIds) {
    const session = lightSession(state.catalog, sessionId)
    if (!session) return MISSING
    if (session.calibration[kind].state !== "none") {
      reasons.push(msg("store_cal_not_no", { session: sessionRef(session), choice: NO_KIND_NAME[kind] }))
      continue
    }
    const candidate = offered(state, session, kind, source)
    if (candidate) writes.push({ sessionId, kind, choice: pickChoice(candidate, at) })
    else reasons.push(notOffered(state, session, source))
  }
  if (reasons.length > 0) return refuse(msg("store_refused", { label }), reasons, href)
  return writeChoices(label, writes, href)
}

export const CALIBRATION_HANDLERS: OperationHandler[] = [watchHandler]
