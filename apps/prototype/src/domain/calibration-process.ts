/**
 * The calibration process (P-CAL3; foundation-owned). Runs are assigned
 * masters only, and raw calibration frames exist only as input to a process:
 *
 * 1. Import or indexing routes each raw calibration session into a process
 *    awaiting Stack (`routeRawCalibration`, called by `readFiles`).
 * 2. Stack hands the raws to a tool profile (Siril, PixInsight) with an
 *    output folder (`stackOutputFolder`).
 * 3. Detect watches that folder for the master: IMAGETYP master of the
 *    process's kind, done writing; NCOMBINE is its frame count
 *    (`findStackedMaster`).
 * 4. Import copies it into structured calibration storage, laid out per kind
 *    by the master naming templates (`masterStoragePath`).
 * 5. Register records the master with lineage to its raw session.
 * 6. Raws: the raw frames go to the OS Trash, or stay when
 *    `settings.keepRawCalibration` is on.
 *
 * A master stacked elsewhere is a process without a session: Stack and
 * Detect are skipped and Raws does not apply. Every step keeps its state and
 * failure reason, so a process resumes at its first step that is not done.
 * Nothing here writes state; the actions are in `src/store/actions/calibration.ts`.
 */
import { KIND_NAME } from "./calibration"
import { filesUnder } from "./disk"
import { namingTemplate, namingValues, type NamingValues, resolveNamingTemplate } from "./templates"
import type {
  ApplicationProfile,
  AppSettings,
  CalibrationKind,
  CalibrationMaster,
  CalibrationProcess,
  CalibrationProcessId,
  CalibrationStepId,
  CalibrationStepRecord,
  CalibrationStepState,
  Catalog,
  Disk,
  DiskFile,
  IsoDateTime,
  Location,
  MasterId,
  NamingFrameType,
  ProfileId,
  Session,
  SessionId,
} from "./types"
import { fileName, formatExposure } from "@/lib/format"
import { joinRefs, m, type MessageRef, type Messages, msg, nightRef, say, verbatim } from "@/lib/i18n"

export const CALIBRATION_STEPS: CalibrationStepId[] = ["stack", "detect", "import", "register", "raws"]

/** "Stack", "Detect", "Import", "Register", "Raws". */
export const CALIBRATION_STEP_NAME: Record<CalibrationStepId, MessageRef> = {
  stack: msg("calibration_step_stack"),
  detect: msg("calibration_step_detect"),
  import: msg("calibration_step_import"),
  register: msg("calibration_step_register"),
  raws: msg("calibration_step_raws"),
}

/** A master's file name kind, data on disk in every language: `MasterDark_2026-09-08.xisf`. */
const MASTER_FILE_KIND: Record<CalibrationKind, string> = { dark: "Dark", flat: "Flat", bias: "Bias", "dark-flat": "DarkFlat" }

const RAW_KINDS = new Set<string>(["dark", "flat", "bias", "dark-flat"])

/** Image types that are raw calibration frames: input to a calibration process, never a run input. */
export function isRawCalibrationType(imageType: string): imageType is CalibrationKind {
  return RAW_KINDS.has(imageType)
}

export function stepRecord(state: CalibrationStepState, at: IsoDateTime | null = null, reason: MessageRef | null = null): CalibrationStepRecord {
  return { state, at, reason }
}

/** One process per raw session, keyed by it. */
export function processIdFor(sessionId: SessionId): CalibrationProcessId {
  return `cpr_${sessionId}`
}

/** A raw calibration session's process, awaiting Stack. */
export function awaitingStackProcess(session: Session, now: IsoDateTime): CalibrationProcess {
  return {
    id: processIdFor(session.id),
    kind: session.imageType as CalibrationKind,
    sessionId: session.id,
    profileId: null,
    outputFolder: null,
    detected: null,
    storagePath: null,
    masterId: null,
    raws: null,
    steps: { stack: stepRecord("todo"), detect: stepRecord("todo"), import: stepRecord("todo"), register: stepRecord("todo"), raws: stepRecord("todo") },
    operationId: null,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Import and indexing route raw calibration frames here: each of `sessionIds`
 * that is a current raw calibration session without a process gets one
 * awaiting Stack. Returns the same record when nothing is new.
 */
export function routeRawCalibration(catalog: Catalog, sessionIds: Iterable<SessionId>, now: IsoDateTime): Catalog["calibrationProcesses"] {
  let processes = catalog.calibrationProcesses
  for (const id of sessionIds) {
    const session = catalog.sessions[id]
    if (!session || session.supersededBy || !isRawCalibrationType(session.imageType) || processes[processIdFor(id)]) continue
    if (processes === catalog.calibrationProcesses) processes = { ...processes }
    processes[processIdFor(id)] = awaitingStackProcess(session, now)
  }
  return processes
}

/** The raw frames of a process outside the Trash. */
export function rawFrameIds(catalog: Catalog, process: CalibrationProcess): string[] {
  const session = process.sessionId ? catalog.sessions[process.sessionId] : undefined
  return session ? session.assetIds.filter((id) => catalog.assets[id] && !catalog.assets[id]!.trashed) : []
}

export type ProcessStatus = "awaiting-stack" | "stacking" | "importing" | "trashing-raws" | "failed" | "done"

export interface ProcessView {
  process: CalibrationProcess
  session: Session | null
  /** "Flat Ha · 19 Sep", "Dark 120 s · 8 Sep". */
  name: MessageRef
  status: ProcessStatus
  /** The first step that is neither done nor skipped; null once finished. */
  current: CalibrationStepId | null
  failure: { step: CalibrationStepId; reason: MessageRef } | null
  /** Raw frames outside the Trash. */
  frames: number
  master: CalibrationMaster | null
}

/** "Flat Ha · 19 Sep", "Dark 120 s · 8 Sep", "Bias · 8 Sep"; a master from elsewhere reads its file name. */
export function processRef(catalog: Catalog, process: CalibrationProcess): MessageRef {
  const kind = KIND_NAME[process.kind]
  const session = process.sessionId ? catalog.sessions[process.sessionId] : undefined
  if (!session) return process.detected ? joinRefs([kind, verbatim(fileName(process.detected.path))], " · ") : msg("domain_process_imported", { kind })
  const detail = process.kind === "flat" ? session.channel : process.kind === "bias" ? null : formatExposure(session.exposureS)
  return joinRefs([detail ? joinRefs([kind, verbatim(detail)], " ") : kind, nightRef(session.night)], " · ")
}

export function processName(m: Messages, catalog: Catalog, process: CalibrationProcess): string {
  return say(m, processRef(catalog, process))
}

export function processView(catalog: Catalog, process: CalibrationProcess): ProcessView {
  const current = CALIBRATION_STEPS.find((s) => process.steps[s].state !== "done" && process.steps[s].state !== "skipped") ?? null
  const failed = CALIBRATION_STEPS.find((s) => process.steps[s].state === "failed")
  const failure = failed ? { step: failed, reason: process.steps[failed].reason ?? msg("status_failed") } : null
  let status: ProcessStatus
  if (failure) status = "failed"
  else if (current === null) status = "done"
  else if (current === "stack") status = "awaiting-stack"
  else if (current === "detect") status = "stacking"
  else if (current === "raws") status = "trashing-raws"
  else status = "importing"
  return {
    process,
    session: process.sessionId ? (catalog.sessions[process.sessionId] ?? null) : null,
    name: processRef(catalog, process),
    status,
    current,
    failure,
    frames: rawFrameIds(catalog, process).length,
    master: process.masterId ? (catalog.masters[process.masterId] ?? null) : null,
  }
}

const STATUS_ORDER: ProcessStatus[] = ["failed", "awaiting-stack", "stacking", "importing", "trashing-raws", "done"]

/**
 * Every current process, those that need the user first (failed, then
 * awaiting Stack), newest night first within a status. A process whose raw
 * session was regrouped before Stack started is left out: its successor has
 * its own.
 */
export function calibrationProcesses(catalog: Catalog): ProcessView[] {
  const out: ProcessView[] = []
  for (const process of Object.values(catalog.calibrationProcesses)) {
    const session = process.sessionId ? catalog.sessions[process.sessionId] : undefined
    if (process.sessionId && (!session || (session.supersededBy && process.steps.stack.state === "todo"))) continue
    out.push(processView(catalog, process))
  }
  const night = (v: ProcessView) => v.session?.night ?? v.process.createdAt.slice(0, 10)
  return out.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || night(b).localeCompare(night(a)))
}

export function processForSession(catalog: Catalog, sessionId: SessionId): CalibrationProcess | null {
  return catalog.calibrationProcesses[processIdFor(sessionId)] ?? null
}

/** The process a master was registered by, if any: its lineage. */
export function processForMaster(catalog: Catalog, masterId: MasterId): CalibrationProcess | null {
  return Object.values(catalog.calibrationProcesses).find((p) => p.masterId === masterId) ?? null
}

/** Profiles that can stack masters (Siril, PixInsight), set up or not. */
export function stackProfiles(catalog: Catalog): ApplicationProfile[] {
  return Object.values(catalog.profiles).filter((p) => p.capability.masterStacking)
}

/** Structured calibration storage: the first Calibration location that is not retired. */
export function calibrationStorage(catalog: Catalog): Location | null {
  return Object.values(catalog.locations).find((l) => l.role === "calibration" && !l.retiredAt) ?? null
}

/** Where Stack asks the tool to write: `<output parent or calibration storage>/Stacking/<process>`; the folder name is data, worded once. */
export function stackOutputFolder(catalog: Catalog, settings: AppSettings, process: CalibrationProcess): string | null {
  const root = settings.lastOutputParent ?? calibrationStorage(catalog)?.path ?? null
  if (!root) return null
  const name = processName(m, catalog, process).replace(/ · /g, " ").replace(/[\\/:*?"<>|]/g, "-")
  return `${root}/Stacking/${name}`
}

/** Why Stack is refused for a session and profile; empty when it can start. */
export function stackRefusals(catalog: Catalog, settings: AppSettings, sessionId: SessionId, profileId: ProfileId | null): MessageRef[] {
  const session = catalog.sessions[sessionId]
  if (!session || !isRawCalibrationType(session.imageType)) return [msg("domain_stack_not_raw")]
  const reasons: MessageRef[] = []
  const process = processForSession(catalog, sessionId) ?? awaitingStackProcess(session, session.endedAt)
  if (process.steps.detect.state === "running") reasons.push(msg("domain_stack_already_stacking"))
  else if (process.steps.register.state === "done") reasons.push(msg("domain_stack_master_registered"))
  const profile = profileId ? catalog.profiles[profileId] : undefined
  if (!profile) reasons.push(msg("domain_stack_no_profile"))
  else if (!profile.capability.masterStacking) reasons.push(msg("domain_stack_cannot_stack", { name: profile.name }))
  else if (profile.executableState !== "found") reasons.push(msg("domain_stack_not_set_up", { name: profile.name }))
  if (rawFrameIds(catalog, process).length === 0) reasons.push(msg("domain_stack_no_frames"))
  if (!stackOutputFolder(catalog, settings, process)) reasons.push(msg("run_parent_none"))
  return reasons
}

/**
 * The master a tool wrote into `folder`: IMAGETYP master of `kind`, no longer
 * being written. Its NCOMBINE header is the frame count. Newest first.
 */
export function findStackedMaster(disk: Disk, folder: string, kind: CalibrationKind): DiskFile | null {
  const imageType = `master-${kind}`
  const found = filesUnder(disk, folder).filter((f) => f.header?.imageType === imageType && !f.growing)
  return found.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))[0] ?? null
}

/** Naming token values of a raw session's master: its camera settings, night, filter and rig. */
export function sessionMasterValues(catalog: Catalog, session: Session, kind: CalibrationKind): NamingValues {
  const rigId = session.equipment.status === "confirmed" || session.equipment.status === "associated" ? session.equipment.value : null
  return namingValues({
    target: null,
    filter: session.channel,
    night: session.night,
    frameType: `master-${kind}`,
    camera: session.cameraName,
    exposureS: kind === "bias" ? null : session.exposureS,
    gain: session.gain,
    offset: session.offset,
    binning: session.binning,
    ccdTempC: session.ccdTempC,
    train: (rigId ? catalog.opticalTrains[rigId]?.name : null) ?? session.telescopeName,
  })
}

/**
 * The structured-storage path of a master (P-CAL3): `<storage>/<template>/Master<Kind>_<night>.<ext>`,
 * the folder from the kind's master naming template, e.g.
 * `Darks/ZWO ASI2600MM Pro/300s_g100_o50_-10C/MasterDark_2026-09-08.xisf`.
 */
export function masterStoragePath(storage: Location, naming: AppSettings["naming"], kind: CalibrationKind, values: NamingValues, night: string, ext: string): string {
  const { path } = resolveNamingTemplate(namingTemplate(naming, `master-${kind}` as NamingFrameType), values)
  const folder = path.endsWith("/") ? path.slice(0, -1) : path
  return `${storage.path}/${folder}/Master${MASTER_FILE_KIND[kind]}_${night}.${ext}`
}
