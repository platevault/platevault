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
 * Restore offer: a dismissed master offer becomes pending again. Dismiss is
 * the run's Calibrate step answer (`answerMasterOffer`).
 */
import {
  awaitingStackProcess,
  CALIBRATION_STEPS,
  calibrationStorage,
  findStackedMaster,
  masterStoragePath,
  processForSession,
  processName,
  rawFrameIds,
  sessionMasterValues,
  stackOutputFolder,
  stackRefusals,
  stepRecord,
} from "@/domain/calibration-process"
import { KIND_LABEL } from "@/domain/calibration"
import { createFolder, fileAt, makeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { isUnder, nightOf, readFiles, stableHash } from "@/domain/indexing"
import { headerNamingValues } from "@/domain/templates"
import type { CalibrationKind, CalibrationProcess, CalibrationProcessId, CalibrationStepId, CalibrationStepRecord, MasterId, OperationId, ProfileId, RunId, SessionId } from "@/domain/types"
import { fileName, plural } from "@/lib/format"
import { type CommitResult, commit, nowIso, type PrototypeState, store } from "@/store/core"
import { addOperation, ensureTicker, type OperationHandler, patchOperation, settleOperation } from "@/store/operations"
import { editRun } from "./runs"
import { freshId, refuse } from "./shared"
import { queueOsTrash } from "./trash"

const HREF = "/calibration"

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

function fail(state: PrototypeState, process: CalibrationProcess, step: CalibrationStepId, reason: string): StepResult {
  return { state: setStep(state, process, step, stepRecord("failed", nowIso(), reason)), outcome: "failed" }
}

/** Detect: the master the tool wrote into the output folder. While watching, nothing there yet means wait, not failure. */
function detect(state: PrototypeState, process: CalibrationProcess, watching: boolean): StepResult {
  const folder = process.outputFolder
  if (!folder) return fail(state, process, "detect", "No output folder")
  const volumeId = volumeForPath(state.disk, folder)
  const volume = volumeId ? state.disk.volumes[volumeId] : undefined
  if (!volume?.mounted) return watching ? { state, outcome: "wait" } : fail(state, process, "detect", `${volume?.name ?? "Output folder"} offline`)
  const file = findStackedMaster(state.disk, folder, process.kind)
  if (!file) return watching ? { state, outcome: "wait" } : fail(state, process, "detect", "Tool output not found")
  const detected = { path: file.path, sha256: file.sha256, ncombine: file.header?.ncombine ?? null }
  return { state: setStep(state, process, "detect", stepRecord("done", nowIso()), { detected }), outcome: "done" }
}

/** Import: copy the detected master into structured calibration storage, laid out per kind; the copy is verified. */
function importStep(state: PrototypeState, process: CalibrationProcess): StepResult {
  const detected = process.detected
  if (!detected) return fail(state, process, "import", "Nothing detected")
  const storage = calibrationStorage(state.catalog)
  if (!storage) return fail(state, process, "import", "No Calibration location")
  const source = fileAt(state.disk, detected.path)
  if (!source?.header) return fail(state, process, "import", "Master not readable")
  if (source.sha256 !== detected.sha256) return fail(state, process, "import", "Master changed after Detect")
  const session = process.sessionId ? state.catalog.sessions[process.sessionId] : undefined
  const values = session ? sessionMasterValues(state.catalog, session, process.kind) : headerNamingValues(source.header, `master-${process.kind}`)
  const night = session?.night ?? nightOf(source.header.dateObs)
  const ext = source.path.slice(source.path.lastIndexOf(".") + 1)
  const path = masterStoragePath(storage, state.settings.naming, process.kind, values, night, ext)
  const volumeId = volumeForPath(state.disk, path)
  if (!volumeId || !state.disk.volumes[volumeId]?.mounted) return fail(state, process, "import", `${storage.displayName} offline`)
  if (state.disk.deniedPaths.some((p) => isUnder(path, p))) return fail(state, process, "import", "Access denied")
  if (state.disk.readOnlyPaths.some((p) => isUnder(path, p))) return fail(state, process, "import", "Write permission removed")
  const existing = fileAt(state.disk, path)
  if (existing && existing.sha256 !== source.sha256) return fail(state, process, "import", "Name taken")
  let next = state
  if (!existing) {
    if (state.faults.failNextHashVerification) {
      next = { ...state, faults: { ...state.faults, failNextHashVerification: false } }
      return fail(next, process, "import", "Copy did not verify")
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
  if (!storage || !file) return fail(state, process, "register", "Master missing from storage")
  const at = nowIso()
  const catalog = readFiles(state.catalog, storage, [file], at)
  const id: MasterId = `mst_${stableHash(file.path)}`
  const master = catalog.masters[id]
  if (!master) return fail(state, process, "register", "Not a master")
  const session = process.sessionId ? catalog.sessions[process.sessionId] : undefined
  const rigId = session && (session.equipment.status === "confirmed" || session.equipment.status === "associated") ? session.equipment.value : null
  catalog.masters[id] = {
    ...master,
    frameCount: process.detected?.ncombine ?? master.frameCount ?? (session ? session.assetIds.length : null),
    opticalTrainId: process.kind === "flat" ? (rigId ?? master.opticalTrainId) : null,
    origin: { kind: session ? "stacked" : "imported", runId: null, sourcePath: process.detected?.path ?? file.path, sessionId: process.sessionId },
    adoption: { destinationPath: file.path, verifiedSha256: file.sha256, adoptedAt: at },
  }
  return { state: setStep({ ...state, catalog }, process, "register", stepRecord("done", at), { masterId: id }), outcome: "done" }
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
    title: `Trash raws of ${processName(state.catalog, process)}`,
    projectId: null,
    runIds: [],
    items,
    noun: { one: "frame", many: "frames" },
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
  if (failed) return settleOperation(next, op.id, "failed", `${process.steps[failed].reason ?? "Failed"} at ${failed}.`, HREF)
  return settleOperation(next, op.id, "succeeded", `${fileName(process.storagePath ?? "")} registered from ${plural(frames, "frame")}.`, HREF)
}

const watchHandler: OperationHandler = {
  kind: "stack-master",
  survivesRestart: true,
  step: (state, op) => {
    const { processId } = op.payload as unknown as WatchPayload
    const process = state.catalog.calibrationProcesses[processId]
    if (!process) return settleOperation(state, op.id, "failed", "The calibration process is no longer recorded.", HREF)
    if (process.steps.detect.state !== "running") return settleWatch(state, processId)
    const next = advance(state, processId, "detect", true)
    return next === state ? state : settleWatch(next, processId)
  },
  cancel: (state, op) => {
    const { processId } = op.payload as unknown as WatchPayload
    const process = state.catalog.calibrationProcesses[processId]
    if (!process || process.steps.detect.state !== "running") return state
    const steps = { ...process.steps, stack: stepRecord("todo", nowIso(), "Canceled"), detect: stepRecord("todo") }
    return writeProcess(state, { ...process, steps, operationId: null })
  },
  href: () => HREF,
}

/** Stack (P-CAL3): hand a raw calibration session to a tool profile and watch its output folder. Returns the watch operation id. */
export function startStack(sessionId: SessionId, profileId: ProfileId | null): { result: CommitResult; operationId: OperationId | null } {
  const state = store.getState()
  const reasons = stackRefusals(state.catalog, state.settings, sessionId, profileId)
  if (reasons.length > 0 || !profileId) return { result: refuse("Stack blocked", reasons, HREF), operationId: null }
  const profile = state.catalog.profiles[profileId]!
  let operationId: OperationId | null = null
  const result = commit(
    `Stack with ${profile.name}`,
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
          title: `Stack ${processName(s.catalog, base)}`,
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

function processOrRefuse(processId: CalibrationProcessId, title: string): CalibrationProcess | CommitResult {
  return store.getState().catalog.calibrationProcesses[processId] ?? refuse(title, ["process not found"], HREF)
}

const isProcess = (value: CalibrationProcess | CommitResult): value is CalibrationProcess => "steps" in value

/** Detect master: look in the output folder now. It also runs by itself whenever the folder changes while watching. */
export function detectMasters(processId: CalibrationProcessId): CommitResult {
  const process = processOrRefuse(processId, "Detect blocked")
  if (!isProcess(process)) return process
  if (process.steps.stack.state !== "done") return refuse("Detect blocked", ["Stack first"], HREF)
  if (process.steps.detect.state === "done") return refuse("Detect blocked", ["master already detected"], HREF)
  const result = commit(
    "Detect master",
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
  const process = processOrRefuse(processId, "Import blocked")
  if (!isProcess(process)) return process
  if (process.steps.detect.state !== "done") return refuse("Import blocked", ["nothing detected yet"], HREF)
  if (process.steps.register.state === "done") return refuse("Import blocked", ["master already registered"], HREF)
  const result = commit(
    "Import master",
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

function rawsRefusals(process: CalibrationProcess): string[] {
  const reasons: string[] = []
  if (!process.sessionId) reasons.push("no raw frames")
  if (process.steps.register.state !== "done") reasons.push("master not registered yet")
  if (process.steps.raws.state === "running") reasons.push("already moving to the OS Trash")
  if (process.raws === "trashed") reasons.push("raws already in the OS Trash")
  return reasons
}

/** Trash raws: move a process's raw frames to the OS Trash, whatever the setting says. */
export function discardRaws(processId: CalibrationProcessId): CommitResult {
  const process = processOrRefuse(processId, "Trash raws blocked")
  if (!isProcess(process)) return process
  const reasons = rawsRefusals(process)
  if (reasons.length > 0) return refuse("Trash raws blocked", reasons, HREF)
  const result = commit("Trash raws", (s) => raws(s, s.catalog.calibrationProcesses[processId]!, "trash").state, { href: HREF })
  if (result.ok) ensureTicker()
  return result
}

/** Keep raws: the raw frames stay where they are; Raws is done. */
export function keepRaws(processId: CalibrationProcessId): CommitResult {
  const process = processOrRefuse(processId, "Keep raws blocked")
  if (!isProcess(process)) return process
  const reasons = rawsRefusals(process)
  if (reasons.length > 0) return refuse("Keep raws blocked", reasons, HREF)
  if (process.raws === "kept") return { ok: true }
  return commit("Keep raws", (s) => setStep(s, s.catalog.calibrationProcesses[processId]!, "raws", stepRecord("done", nowIso()), { raws: "kept" }), { href: HREF })
}

/** Import a master stacked elsewhere directly into structured calibration storage: Stack and Detect are skipped. */
export function importMasterFile(path: string): { result: CommitResult; processId: CalibrationProcessId | null } {
  const state = store.getState()
  const file = fileAt(state.disk, path)
  const imageType = file?.header?.imageType ?? ""
  const reasons: string[] = []
  if (!file) reasons.push(`${path} cannot be read`)
  else if (!imageType.startsWith("master-")) reasons.push("not a master (IMAGETYP)")
  else if (Object.values(state.catalog.masters).some((m) => m.path === path || m.origin.sourcePath === path)) reasons.push("already in the library")
  if (reasons.length > 0 || !file) return { result: refuse("Import blocked", reasons, HREF), processId: null }
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
  const result = commit(`Import ${KIND_LABEL[process.kind].toLowerCase()} master`, (s) => advance(writeProcess(s, process), id, "import", false), { href: HREF })
  return { result, processId: result.ok ? id : null }
}

/** Settings › Keep raw calibration frames (off by default: raws go to the OS Trash once their master registers). */
export function setKeepRawCalibration(keep: boolean): CommitResult {
  return commit("Keep raw calibration frames", (s) => ({ ...s, settings: { ...s.settings, keepRawCalibration: keep } }), { href: "/settings" })
}

/** Restore offer (P-CAL2): a dismissed master offer is offered again on the run's Calibrate step. */
export function restoreMasterOffer(runId: RunId, masterId: MasterId): CommitResult {
  const run = store.getState().catalog.runs[runId]
  const offer = run?.masterOffers.find((o) => o.masterId === masterId)
  if (!run || !offer) return refuse("Restore offer refused", ["the offer is no longer recorded"], HREF)
  if (offer.state !== "dismissed") return { ok: true }
  return editRun(runId, "Restore master offer", (r) => ({ ...r, masterOffers: r.masterOffers.map((o) => (o.masterId === masterId ? { ...o, state: "pending", at: nowIso() } : o)) }), { step: "calibrate" })
}

export const CALIBRATION_HANDLERS: OperationHandler[] = [watchHandler]
