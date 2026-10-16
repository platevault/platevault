/**
 * Calibration matched at ingestion and pinned on the session (D-W101 to
 * D-W106, CAL-FR-02 to CAL-FR-08, CAL-FR-19 to CAL-FR-23). Pure: nothing
 * here writes state.
 *
 * Every new light session gets, per kind (darks, flats, bias), its best
 * source: one dated version of a library master, or a raw calibration
 * session. A source that passes every check inside its window is pinned
 * automatically; any other compatible source is a suggestion that needs
 * confirmation; a source that fails a hard check is never offered. A pin
 * changes only by Reassign; matching never replaces it, and calibration
 * that arrives later fills only sessions still waiting. Dark flats are
 * never matched. A Project never matches calibration itself: it reads its
 * sessions' pins (and a Closed Project its frozen snapshot).
 */
import { correctedExposureS } from "./corrections"
import { fileAt } from "./disk"
import { isUnder, nightOf, sessionRigVersion } from "./indexing"
import { preferredCopy } from "./library"
import type {
  AppSettings,
  AssetId,
  CalibrationChoice,
  CalibrationKind,
  CalibrationMaster,
  CalibrationSource,
  Camera,
  CameraId,
  Catalog,
  Disk,
  DiskFile,
  IsoDateTime,
  MasterVersion,
  MatchCriterion,
  MatchEvidence,
  NightDate,
  PinKind,
  RigVersionId,
  Session,
  SessionCalibration,
} from "./types"
import { fileName, formatDecimal, formatExposure, formatNight } from "@/lib/format"
import { joinRefs, type MessageRef, msg, verbatim } from "@/lib/i18n"

/** The calibration kinds the library lists, in order. Dark flats are indexed but never matched (CAL-FR-01). */
export const KINDS: CalibrationKind[] = ["dark", "flat", "bias"]

/** The kinds a light session pins, in order. */
export const PIN_KINDS: PinKind[] = ["dark", "flat", "bias"]

/** "Dark", "Flat", "Bias", "Dark flat". */
export const KIND_NAME: Record<CalibrationKind, MessageRef> = {
  dark: msg("calibration_kind_dark"),
  flat: msg("calibration_kind_flat"),
  bias: msg("calibration_kind_bias"),
  "dark-flat": msg("calibration_kind_dark_flat"),
}

/** The kind mid-sentence: "dark", "flat", "bias" ("Dark flat" keeps its capital: a lowercase copy would duplicate its catalogue value). */
export const KIND_NOUN: Record<CalibrationKind, MessageRef> = {
  dark: msg("run_cal_kind_dark"),
  flat: msg("run_cal_kind_flat"),
  bias: msg("run_cal_kind_bias"),
  "dark-flat": msg("calibration_kind_dark_flat"),
}

/** "No darks", "No flats", "No bias": the explicit choice that settles a kind with no reason (CAL-FR-05). */
export const NO_KIND_NAME: Record<PinKind, MessageRef> = {
  dark: msg("calibration_no_darks"),
  flat: msg("calibration_no_flats"),
  bias: msg("calibration_no_bias"),
}

/** "Waiting", "Suggested", "Pinned", "No": one kind's state on a session (LIB-FR-23). */
export const CHOICE_STATE_NAME: Record<CalibrationChoice["state"], MessageRef> = {
  waiting: msg("calibration_choice_waiting"),
  suggested: msg("calibration_choice_suggested"),
  pinned: msg("calibration_choice_pinned"),
  none: msg("calibration_choice_none"),
}

const MASTER_TYPE_NAME: Record<CalibrationKind, MessageRef> = {
  dark: msg("import_type_master_dark"),
  flat: msg("import_type_master_flat"),
  bias: msg("calibration_caption_bias"),
  "dark-flat": msg("import_type_master_dark_flat"),
}

const RAW_TYPE_NAME: Record<PinKind, MessageRef> = {
  dark: msg("import_type_dark"),
  flat: msg("import_type_flat"),
  bias: msg("import_type_bias"),
}

const DAY_MS = 86_400_000

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** A calibration source a light session can pin, with the facts the checks compare. */
export interface CalSource {
  source: CalibrationSource
  /** `sourceKey(source)`: stable across renders. */
  key: string
  kind: PinKind
  /** The master file's name, or the raw session's label facts. */
  name: string
  capturedAt: IsoDateTime
  night: NightDate
  cameraName: string | null
  /** The physical camera: a master's import link, or a raw session's rig camera. */
  cameraId: CameraId | null
  widthPx: number | null
  heightPx: number | null
  binning: number
  gain: number | null
  offset: number | null
  exposureS: number | null
  channel: string | null
  opticalTrainId: string | null
  rigVersionId: RigVersionId | null
  ccdTempC: number | null
  rotationDeg: number | null
  frameCount: number | null
  /** A master, which wins over a raw set when both match (CAL-FR-04). */
  isMaster: boolean
  imageTypeLabel: MessageRef
  /** The files the source places, with the SHA-256 the library holds for each. */
  files: Array<{ assetId: AssetId | null; path: string; sha256: string; sizeBytes: number }>
}

export function sourceKey(source: CalibrationSource): string {
  return source.type === "master" ? `m:${source.masterId}:${source.versionId}` : `r:${source.sessionId}`
}

/** Versions by capture date, newest first; no version is Latest (CAL-FR-14), this only orders them. */
export function versionsNewestFirst(master: Pick<CalibrationMaster, "versions">): MasterVersion[] {
  return [...master.versions].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
}

/** The newest version by capture date: what the Old badge reads (CAL-FR-15). */
export function newestVersion(master: Pick<CalibrationMaster, "versions">): MasterVersion | undefined {
  return versionsNewestFirst(master)[0]
}

export function masterVersion(master: CalibrationMaster | undefined, versionId: string): MasterVersion | undefined {
  return master?.versions.find((v) => v.id === versionId)
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}

/** One master version as a source. */
export function versionSource(catalog: Catalog, master: CalibrationMaster, version: MasterVersion): CalSource | null {
  if (master.kind === "dark-flat") return null
  const asset = Object.values(catalog.assets).find((a) => a.copies.some((c) => c.path === version.path))
  return {
    source: { type: "master", masterId: master.id, versionId: version.id },
    key: sourceKey({ type: "master", masterId: master.id, versionId: version.id }),
    kind: master.kind,
    name: fileName(version.path),
    capturedAt: version.capturedAt,
    night: nightOf(version.capturedAt),
    cameraName: master.cameraName,
    cameraId: master.cameraId,
    widthPx: master.widthPx,
    heightPx: master.heightPx,
    binning: master.binning,
    gain: master.gain,
    offset: master.offset,
    exposureS: master.exposureS,
    channel: master.channel,
    opticalTrainId: master.opticalTrainId,
    rigVersionId: master.rigVersionId,
    ccdTempC: master.ccdTempC,
    rotationDeg: master.rotationDeg,
    frameCount: version.frameCount,
    isMaster: true,
    imageTypeLabel: MASTER_TYPE_NAME[master.kind],
    files: [{ assetId: asset?.id ?? null, path: version.path, sha256: version.adoption?.verifiedSha256 ?? version.sha256, sizeBytes: asset?.sizeBytes ?? 0 }],
  }
}

const RAW_KINDS: ReadonlySet<string> = new Set(["dark", "flat", "bias"])

/** A raw calibration session as a source (CAL-FR-04): its live frames, for an application that builds its own masters. */
export function rawSource(catalog: Catalog, disk: Disk, session: Session): CalSource | null {
  if (!RAW_KINDS.has(session.imageType) || session.supersededBy) return null
  const assets = session.assetIds.map((id) => catalog.assets[id]).filter((a): a is NonNullable<typeof a> => a !== undefined && !a.trashed)
  if (assets.length === 0) return null
  const first = assets[0]!
  const kind = session.imageType as PinKind
  const rig = sessionRigVersion(catalog, session)
  return {
    source: { type: "raw", sessionId: session.id },
    key: sourceKey({ type: "raw", sessionId: session.id }),
    kind,
    name: `${formatNight(session.night)} · ${session.channel ?? formatExposure(session.exposureS)}`,
    capturedAt: session.startedAt,
    night: session.night,
    cameraName: session.cameraName,
    cameraId: rig?.version.cameraId ?? null,
    widthPx: first.observed.widthPx,
    heightPx: first.observed.heightPx,
    binning: session.binning,
    gain: session.gain,
    offset: session.offset,
    exposureS: kind === "dark" ? (correctedExposureS(session) ?? session.exposureS) : null,
    channel: kind === "flat" ? session.channel : null,
    opticalTrainId: rig?.rigId ?? null,
    rigVersionId: session.rigVersionId,
    ccdTempC: session.ccdTempC,
    rotationDeg: median(assets.map((a) => a.observed.rotationDeg).filter((r): r is number => r !== null)),
    frameCount: assets.length,
    isMaster: false,
    imageTypeLabel: RAW_TYPE_NAME[kind],
    files: assets.map((a) => {
      const copy = preferredCopy(disk, catalog, a)
      return { assetId: a.id, path: copy.path, sha256: a.sha256, sizeBytes: a.sizeBytes }
    }),
  }
}

export function sourceFor(catalog: Catalog, disk: Disk, source: CalibrationSource): CalSource | null {
  if (source.type === "raw") {
    const session = catalog.sessions[source.sessionId]
    return session ? rawSource(catalog, disk, session) : null
  }
  const master = catalog.masters[source.masterId]
  const version = masterVersion(master, source.versionId)
  return master && version ? versionSource(catalog, master, version) : null
}

/** "MasterDark_2026-09-08.xisf · 8 Sep", "18 Sep · Ha (raw)": a source as a list names it. */
export function sourceRef(catalog: Catalog, disk: Disk, source: CalibrationSource): MessageRef {
  const s = sourceFor(catalog, disk, source)
  if (!s) return msg("domain_calibration_source_missing")
  return s.isMaster ? joinRefs([verbatim(s.name), { night: s.night }], " · ") : msg("domain_calibration_source_raw", { name: s.name })
}

/**
 * The bytes at a path when they can be read now, else null: missing, on a
 * volume that is not mounted, or denied. Unreadable is unverified, never matched (D19).
 */
function readableSha(disk: Disk, path: string): string | null {
  const file = fileAt(disk, path)
  if (!file || disk.volumes[file.volumeId]?.mounted === false) return null
  if (disk.deniedPaths.some((denied) => isUnder(path, denied))) return null
  return file.sha256
}

/**
 * Why a master version's current bytes do not match their basis, or null
 * when they do (CAL-FR-08, D19): an adopted version is checked against its
 * adoption digest, a library one against the SHA-256 recorded when it was
 * indexed. A version that cannot be read is unverified, so never matched.
 */
export function versionDrift(disk: Disk, version: MasterVersion): MessageRef | null {
  const basis = version.adoption?.verifiedSha256 ?? version.sha256
  const current = readableSha(disk, version.path)
  if (current === null) return msg("domain_calibration_version_unverified", { path: version.path })
  if (current !== basis) return version.adoption ? msg("domain_calibration_version_drifted_adoption") : msg("domain_calibration_version_drifted")
  return null
}

/**
 * The sources matching may offer: every version of an adopted master that
 * is not hidden and reads its basis bytes, and every raw dark, flat and bias
 * session. Candidates and hidden masters never match (CAL-FR-16).
 */
export function calibrationSources(catalog: Catalog, disk: Disk): CalSource[] {
  const out: CalSource[] = []
  for (const master of Object.values(catalog.masters)) {
    if (master.state !== "adopted" || master.hiddenAt) continue
    for (const version of master.versions) {
      if (versionDrift(disk, version)) continue
      const source = versionSource(catalog, master, version)
      if (source) out.push(source)
    }
  }
  for (const session of Object.values(catalog.sessions)) {
    const source = rawSource(catalog, disk, session)
    if (source) out.push(source)
  }
  return out
}

// ---------------------------------------------------------------------------
// Checks (CAL-FR-19 to CAL-FR-21)
// ---------------------------------------------------------------------------

export interface LightGeometry {
  cameraName: string | null
  cameraId: CameraId | null
  widthPx: number | null
  heightPx: number | null
  binning: number
  gain: number | null
  offset: number | null
  exposureS: number
  channel: string | null
  opticalTrainId: string | null
  rigVersionId: RigVersionId | null
  /** The rig version has a rotator: a missing flat angle reads unknown. */
  rotator: boolean
  ccdTempC: number | null
  rotationDeg: number | null
  night: NightDate
  startedAt: IsoDateTime
}

export function lightGeometry(catalog: Catalog, session: Session): LightGeometry {
  const assets = session.assetIds.map((id) => catalog.assets[id]).filter((a) => a !== undefined)
  const first = assets[0]
  const rig = sessionRigVersion(catalog, session)
  return {
    cameraName: session.cameraName,
    cameraId: rig?.version.cameraId ?? null,
    widthPx: first?.observed.widthPx ?? null,
    heightPx: first?.observed.heightPx ?? null,
    binning: session.binning,
    gain: session.gain,
    offset: session.offset,
    exposureS: correctedExposureS(session) ?? session.exposureS,
    channel: session.channel,
    opticalTrainId: rig?.rigId ?? null,
    rigVersionId: session.rigVersionId,
    rotator: rig?.version.rotator ?? false,
    ccdTempC: session.ccdTempC,
    rotationDeg: session.pointing?.rotationDeg ?? median(assets.map((a) => a.observed.rotationDeg).filter((r): r is number => r !== null)),
    night: session.night,
    startedAt: session.startedAt,
  }
}

export function trainName(catalog: Catalog, id: string | null): string | null {
  return id ? (catalog.opticalTrains[id]?.name ?? id) : null
}

const value = (v: string | null) => (v === null ? msg("domain_not_recorded") : verbatim(v))

function criterion(name: MatchCriterion["name"], light: string | null, calibration: string | null): MatchCriterion {
  const result = light === null || calibration === null ? "unknown" : light === calibration ? "compatible" : "incompatible"
  return { name, result, lightValue: value(light), calibrationValue: value(calibration) }
}

const str = (v: number | string | null) => (v === null ? null : String(v))

/** Rotation difference in degrees, 0 to 180. */
export function angleDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function nightsApart(a: NightDate, b: NightDate): number {
  return Math.round(Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY_MS)
}

function daysApart(a: IsoDateTime, b: IsoDateTime): number {
  return Math.floor(Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS)
}

/**
 * The camera check (CAL-FR-21, LIB-FR-26): a source linked to a physical
 * camera matches only that camera. Otherwise it matches by model while the
 * rigs hold one camera of that model; with several, it is unknown until the
 * user links it, so it is only suggested.
 */
function cameraCriterion(catalog: Catalog, light: LightGeometry, source: Pick<CalSource, "cameraName" | "cameraId">): MatchCriterion {
  const lightCamera = light.cameraId ? catalog.cameras[light.cameraId] : undefined
  const lightName = lightCamera?.physicalAlias ?? light.cameraName
  if (source.cameraId) {
    const sourceCamera = catalog.cameras[source.cameraId]
    const sourceName = sourceCamera?.physicalAlias ?? sourceCamera?.name ?? source.cameraName
    if (!light.cameraId) return { name: "camera", result: "unknown", lightValue: value(lightName), calibrationValue: value(sourceName) }
    return { name: "camera", result: source.cameraId === light.cameraId ? "compatible" : "incompatible", lightValue: value(lightName), calibrationValue: value(sourceName) }
  }
  const base = criterion("camera", light.cameraName, source.cameraName)
  if (base.result !== "compatible") return base
  return camerasOfModel(catalog, light.cameraName).length > 1 ? { ...base, result: "unknown" } : base
}

/** The cameras in the rigs of one model, by its name or a header alias (LIB-FR-26). */
export function camerasOfModel(catalog: Pick<Catalog, "cameras">, model: string | null): Camera[] {
  if (!model) return []
  return Object.values(catalog.cameras).filter((c) => c.name === model || c.aliases.includes(model))
}

/**
 * Whether a master file of `model` linked to `cameraId` (null: not linked)
 * belongs with a master record linked to `recordCameraId` (LIB-FR-26): two
 * links must name the same camera; otherwise by model while the rigs hold
 * one camera of it. With several, an unlinked file joins only an unlinked
 * record, so a file from one camera never becomes a version of another's.
 */
export function sameMasterCamera(catalog: Pick<Catalog, "cameras">, model: string | null, recordCameraId: CameraId | null, cameraId: CameraId | null): boolean {
  if (recordCameraId && cameraId) return recordCameraId === cameraId
  return recordCameraId === cameraId || camerasOfModel(catalog, model).length < 2
}

/** Why a master file of `model` cannot be linked to `cameraId` at import (LIB-FR-26): a camera of another model, or none while the rigs hold several of that model. Null when it can. */
export function importCameraRefusal(catalog: Pick<Catalog, "cameras">, model: string | null, cameraId: CameraId | null): MessageRef | null {
  const cameras = camerasOfModel(catalog, model)
  if (cameraId) {
    const camera = catalog.cameras[cameraId]
    if (!camera) return msg("store_record_missing")
    return cameras.some((c) => c.id === cameraId) ? null : msg("store_cal_camera_other_model", { camera: verbatim(camera.physicalAlias ?? camera.name), model: verbatim(model ?? "–") })
  }
  if (cameras.length < 2) return null
  return msg("store_cal_camera_needed", { model: verbatim(model ?? "–"), cameras: verbatim(cameras.map((c) => c.physicalAlias ?? c.name).join(", ")) })
}

/** Temperature within the warning level (CAL-FR-21); past it the match is only suggested. */
function temperatureCriterion(light: number | null, source: number | null, warnC: number): MatchCriterion {
  const v = (t: number | null) => (t === null ? msg("domain_not_recorded") : verbatim(`${formatDecimal(t, 1)} °C`))
  if (light === null || source === null) return { name: "temperature", result: "unknown", lightValue: v(light), calibrationValue: v(source) }
  return { name: "temperature", result: Math.abs(light - source) <= warnC ? "compatible" : "warning", lightValue: v(light), calibrationValue: v(source) }
}

/** Flat rotation (CAL-FR-20): fine, warning, or not offered; a missing angle is unknown on a rig with a rotator. */
function rotationCriterion(light: LightGeometry, source: CalSource, flats: AppSettings["matching"]["flats"]): MatchCriterion {
  const v = (r: number | null) => (r === null ? msg("domain_not_recorded") : verbatim(`${formatDecimal(r, 1)}°`))
  if (light.rotationDeg === null || source.rotationDeg === null) {
    return { name: "rotation", result: light.rotator ? "unknown" : "compatible", lightValue: v(light.rotationDeg), calibrationValue: v(source.rotationDeg) }
  }
  const delta = angleDelta(light.rotationDeg, source.rotationDeg)
  const result = delta <= flats.fineDeg ? "compatible" : delta <= flats.warnDeg ? "warning" : "incompatible"
  return { name: "rotation", result, lightValue: v(light.rotationDeg), calibrationValue: v(source.rotationDeg) }
}

/**
 * Every check for one light session and one source. Flats: camera, optical
 * train, filter, binning, sensor size and the same rig version are hard;
 * rotation and the night window decide pin or suggestion. Darks and bias:
 * camera, gain, offset, binning and size (and exposure for darks) are hard;
 * temperature and the day window decide pin or suggestion.
 */
export function matchCriteria(catalog: Catalog, settings: Pick<AppSettings, "matching">, light: LightGeometry, source: CalSource): MatchCriterion[] {
  const lightDims = light.widthPx === null || light.heightPx === null ? null : `${light.widthPx} × ${light.heightPx}`
  const sourceDims = source.widthPx === null || source.heightPx === null ? null : `${source.widthPx} × ${source.heightPx}`
  const list: MatchCriterion[] = [
    cameraCriterion(catalog, light, source),
    criterion("dimensions", lightDims, sourceDims),
    criterion("binning", `${light.binning}×${light.binning}`, `${source.binning}×${source.binning}`),
    { name: "image-type", result: "compatible", lightValue: msg("import_type_light"), calibrationValue: source.imageTypeLabel },
  ]
  const { flats, darks, bias } = settings.matching
  if (source.kind === "flat") {
    list.push(criterion("channel", light.channel, source.channel))
    list.push(criterion("optical-train", trainName(catalog, light.opticalTrainId), trainName(catalog, source.opticalTrainId)))
    list.push(criterion("rig-version", light.rigVersionId, source.rigVersionId))
    list.push(rotationCriterion(light, source, flats))
    const apart = nightsApart(light.night, source.night)
    list.push({ name: "age", result: apart <= flats.windowNights ? "compatible" : "warning", lightValue: { night: light.night }, calibrationValue: { night: source.night } })
    return list
  }
  list.push(criterion("gain", str(light.gain), str(source.gain)))
  list.push(criterion("offset", str(light.offset), str(source.offset)))
  if (source.kind === "dark") list.push(criterion("exposure", formatExposure(light.exposureS), source.exposureS === null ? null : formatExposure(source.exposureS)))
  const window = source.kind === "dark" ? darks : bias
  list.push(temperatureCriterion(light.ccdTempC, source.ccdTempC, window.temperatureWarnC))
  const apart = daysApart(light.startedAt, source.capturedAt)
  list.push({ name: "age", result: apart <= window.windowDays ? "compatible" : "warning", lightValue: { night: light.night }, calibrationValue: { night: source.night } })
  return list
}

/** Criteria a failure of which keeps a source from ever being offered (CAL-FR-19, CAL-FR-21). */
const HARD: ReadonlySet<MatchCriterion["name"]> = new Set(["camera", "dimensions", "binning", "channel", "optical-train", "rig-version", "rotation", "gain", "offset", "exposure"])

export const CRITERION_NAME: Record<MatchCriterion["name"], MessageRef> = {
  camera: msg("domain_criterion_camera"),
  dimensions: msg("domain_criterion_dimensions"),
  binning: msg("domain_criterion_binning"),
  gain: msg("domain_criterion_gain"),
  offset: msg("domain_criterion_offset"),
  "image-type": msg("domain_criterion_image_type"),
  exposure: msg("domain_criterion_exposure"),
  channel: msg("domain_criterion_channel"),
  "optical-train": msg("domain_criterion_rig"),
  "rig-version": msg("domain_criterion_rig_version"),
  temperature: msg("domain_criterion_temperature"),
  rotation: msg("domain_criterion_rotation"),
  age: msg("domain_criterion_age"),
}

export interface MatchSummary {
  compatible: number
  warning: number
  incompatible: number
  unknown: number
  allCompatible: boolean
}

export function summarize(criteria: MatchCriterion[]): MatchSummary {
  const count = (result: MatchCriterion["result"]) => criteria.filter((c) => c.result === result).length
  const summary = { compatible: count("compatible"), warning: count("warning"), incompatible: count("incompatible"), unknown: count("unknown") }
  return { ...summary, allCompatible: summary.warning === 0 && summary.incompatible === 0 && summary.unknown === 0 }
}

const CRITERION_RESULT_KEY = { unknown: "domain_criterion_unknown", warning: "domain_criterion_warning", incompatible: "domain_criterion_incompatible" } as const

/** "All 9 checks pass", or the checks that do not: "Rotation warning, Temperature unknown". */
export function summaryRef(criteria: MatchCriterion[]): MessageRef {
  const bad = criteria.filter((c) => c.result !== "compatible")
  if (bad.length === 0) return msg("domain_criteria_all_compatible", { count: criteria.length })
  return joinRefs(
    bad.map((c) => msg(CRITERION_RESULT_KEY[c.result as keyof typeof CRITERION_RESULT_KEY], { criterion: CRITERION_NAME[c.name] })),
    ", ",
  )
}

/** A source a light session may take: pinned automatically, or only suggested (CAL-FR-02). Never-offered sources are left out. */
export interface PinCandidate {
  source: CalSource
  evidence: MatchEvidence
  verdict: "pin" | "suggest"
}

function evidenceOf(light: LightGeometry, source: CalSource, criteria: MatchCriterion[]): MatchEvidence {
  return {
    capturedAt: source.capturedAt,
    apart: source.kind === "flat" ? nightsApart(light.night, source.night) : daysApart(light.startedAt, source.capturedAt),
    rotationDeltaDeg: source.kind === "flat" && light.rotationDeg !== null && source.rotationDeg !== null ? angleDelta(light.rotationDeg, source.rotationDeg) : null,
    criteria,
    files: source.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
  }
}

/**
 * The ranking (CAL-FR-20, CAL-FR-21, CAL-FR-04): a pin before a
 * suggestion, a master before a raw set, then nearest by night (flats) or
 * capture time (darks, bias), then the smallest rotation difference, then
 * more frames. Negative when `a` ranks first.
 */
export function compareCandidates(a: PinCandidate, b: PinCandidate): number {
  return (
    Number(a.verdict === "suggest") - Number(b.verdict === "suggest") ||
    Number(b.source.isMaster) - Number(a.source.isMaster) ||
    a.evidence.apart - b.evidence.apart ||
    (a.evidence.rotationDeltaDeg ?? 0) - (b.evidence.rotationDeltaDeg ?? 0) ||
    (b.source.frameCount ?? 0) - (a.source.frameCount ?? 0) ||
    a.source.key.localeCompare(b.source.key)
  )
}

/** The sources one light session may take for one kind, best first; a hard-check failure is never offered. */
export function candidatesFor(catalog: Catalog, settings: Pick<AppSettings, "matching">, session: Session, kind: PinKind, sources: CalSource[]): PinCandidate[] {
  const light = lightGeometry(catalog, session)
  const out: PinCandidate[] = []
  for (const source of sources) {
    if (source.kind !== kind) continue
    const criteria = matchCriteria(catalog, settings, light, source)
    if (criteria.some((c) => c.result === "incompatible" && HARD.has(c.name))) continue
    const verdict = criteria.every((c) => c.result === "compatible") ? "pin" : "suggest"
    out.push({ source, evidence: evidenceOf(light, source, criteria), verdict })
  }
  return out.sort(compareCandidates)
}

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

export function emptyCalibration(): SessionCalibration {
  return { dark: { state: "waiting" }, flat: { state: "waiting" }, bias: { state: "waiting" } }
}

/** A suggestion the user confirmed: it counts as their pin from now on (LIB-FR-23). Any other choice stays as it is. */
export function confirmChoice(choice: CalibrationChoice, at: IsoDateTime): CalibrationChoice {
  return choice.state === "suggested" ? { state: "pinned", source: choice.source, evidence: choice.evidence, at, by: "user" } : choice
}

/** The user picks one candidate (Choose…, Reassign): pinned by the user with its evidence (LIB-FR-25). */
export function pickChoice(candidate: Pick<PinCandidate, "source" | "evidence">, at: IsoDateTime): CalibrationChoice {
  return { state: "pinned", source: candidate.source.source, evidence: candidate.evidence, at, by: "user" }
}

/** No darks, No flats or No bias: settles the kind with no reason (CAL-FR-05). */
export function noChoice(at: IsoDateTime): CalibrationChoice {
  return { state: "none", at, by: "user" }
}

/** Settled: every kind pinned or an explicit No (LIB-FR-23); a suggestion counts only once confirmed. */
export function isSettled(calibration: SessionCalibration | null): boolean {
  return calibration !== null && PIN_KINDS.every((kind) => calibration[kind].state === "pinned" || calibration[kind].state === "none")
}

/** The kinds still waiting or suggested, in order: "Choose its flats first". */
export function unsettledKinds(calibration: SessionCalibration | null): PinKind[] {
  if (!calibration) return []
  return PIN_KINDS.filter((kind) => calibration[kind].state === "waiting" || calibration[kind].state === "suggested")
}

/** A camera's "Don't use darks" / "Don't use bias" (CAL-FR-22): settled as No with no warning. */
function cameraDefault(catalog: Catalog, session: Session, kind: PinKind, at: IsoDateTime): CalibrationChoice | null {
  if (kind === "flat") return null
  const cameraId = sessionRigVersion(catalog, session)?.version.cameraId
  const camera = cameraId ? catalog.cameras[cameraId] : undefined
  if (!camera) return null
  return (kind === "dark" && camera.noDarks) || (kind === "bias" && camera.noBias) ? { state: "none", at, by: "camera-default" } : null
}

/** One kind's best match: a pin, a suggestion, or waiting when nothing compatible exists. */
export function matchChoice(catalog: Catalog, settings: Pick<AppSettings, "matching">, session: Session, kind: PinKind, at: IsoDateTime, sources: CalSource[]): CalibrationChoice {
  const preset = cameraDefault(catalog, session, kind, at)
  if (preset) return preset
  const best = candidatesFor(catalog, settings, session, kind, sources)[0]
  if (!best) return { state: "waiting" }
  return best.verdict === "pin" ? { state: "pinned", source: best.source.source, evidence: best.evidence, at, by: "matching" } : { state: "suggested", source: best.source.source, evidence: best.evidence }
}

/**
 * The session's calibration after matching (CAL-FR-02, LIB-FR-25): kinds
 * already pinned or No stay exactly as they are; kinds waiting or suggested
 * take the best match now, so later calibration fills only what still waits.
 */
export function matchSessionCalibration(catalog: Catalog, settings: Pick<AppSettings, "matching">, session: Session, at: IsoDateTime, sources: CalSource[]): SessionCalibration {
  const current = session.calibration ?? emptyCalibration()
  const next = { ...current }
  for (const kind of PIN_KINDS) {
    if (current[kind].state === "pinned" || current[kind].state === "none") continue
    next[kind] = matchChoice(catalog, settings, session, kind, at, sources)
  }
  return next
}

/**
 * Matching at ingestion (CAL-FR-02, LIB-FR-25): every live light session
 * with a kind still waiting or suggested takes its best match now, against
 * the library as it stands after the batch. Pins and Nos never change. A
 * session whose choices stay the same keeps its record (and revision).
 */
export function calibrateSessions(catalog: Catalog, disk: Disk, settings: Pick<AppSettings, "matching">, at: IsoDateTime): Catalog {
  let sources: CalSource[] | null = null
  let sessions = catalog.sessions
  for (const session of Object.values(catalog.sessions)) {
    if (session.imageType !== "light" || session.supersededBy) continue
    const current = session.calibration ?? emptyCalibration()
    if (session.calibration && PIN_KINDS.every((kind) => current[kind].state === "pinned" || current[kind].state === "none")) continue
    sources ??= calibrationSources(catalog, disk)
    const next = matchSessionCalibration(catalog, settings, session, at, sources)
    if (session.calibration && PIN_KINDS.every((kind) => sameChoice(current[kind], next[kind]))) continue
    if (sessions === catalog.sessions) sessions = { ...catalog.sessions }
    sessions[session.id] = { ...session, calibration: next }
  }
  return sessions === catalog.sessions ? catalog : { ...catalog, sessions }
}

/** Whether two choices are the same decision (state and source): a pending change compares them. */
export function sameChoice(a: CalibrationChoice, b: CalibrationChoice): boolean {
  if (a.state !== b.state) return false
  if (a.state === "pinned" || a.state === "suggested") return sourceKey(a.source) === sourceKey((b as typeof a).source)
  return true
}

// ---------------------------------------------------------------------------
// Pin health (D-W113, CAL-FR-08)
// ---------------------------------------------------------------------------

/** A pinned file now: as pinned, changed in place, gone, or on a volume that cannot be read now. */
export type PinHealth = "ok" | "changed" | "missing" | "unreadable"

/**
 * Whether a pin's files still hold the bytes recorded when it was pinned.
 * A changed or missing file keeps the pin: the session shows it, Apply
 * refuses with a link to reassign, and nothing switches by itself.
 */
export function pinHealth(disk: Disk, choice: CalibrationChoice): { state: PinHealth; path: string | null } {
  if (choice.state !== "pinned") return { state: "ok", path: null }
  for (const file of choice.evidence.files) {
    const found = fileAt(disk, file.path)
    if (!found) {
      const mounted = Object.values(disk.volumes).some((v) => v.mounted && isUnder(file.path, v.mountPath))
      return { state: mounted ? "missing" : "unreadable", path: file.path }
    }
    if (disk.volumes[found.volumeId]?.mounted === false || disk.deniedPaths.some((d) => isUnder(file.path, d))) return { state: "unreadable", path: file.path }
    if (found.sha256 !== file.sha256) return { state: "changed", path: file.path }
  }
  return { state: "ok", path: null }
}

export interface PinProblem {
  kind: PinKind
  state: Exclude<PinHealth, "ok">
  path: string
}

/** The pinned files of a session that changed, went missing or cannot be read now. */
export function sessionPinProblems(disk: Disk, calibration: SessionCalibration | null): PinProblem[] {
  if (!calibration) return []
  return PIN_KINDS.flatMap((kind) => {
    const health = pinHealth(disk, calibration[kind])
    return health.state === "ok" || !health.path ? [] : [{ kind, state: health.state, path: health.path }]
  })
}

// ---------------------------------------------------------------------------
// Calibration arriving later (LIB-FR-25)
// ---------------------------------------------------------------------------

export interface ArrivalUse {
  session: Session
  kind: PinKind
  candidate: PinCandidate
}

/**
 * What new calibration sets would calibrate, for Import review: "Used for:
 * Ha · 12 Oct, Ha · 13 Oct". `fills` are sessions still waiting or
 * suggested that a new set would pin or suggest; `noSessions` are sessions
 * set to No for that kind that it matches, offered unticked under "Also use
 * for these sessions". A pinned session is never listed.
 */
export function calibrationArrival(catalog: Catalog, settings: Pick<AppSettings, "matching">, incoming: CalSource[]): { fills: ArrivalUse[]; noSessions: ArrivalUse[] } {
  const fills: ArrivalUse[] = []
  const noSessions: ArrivalUse[] = []
  for (const session of Object.values(catalog.sessions)) {
    if (session.imageType !== "light" || session.supersededBy || !session.calibration) continue
    for (const kind of PIN_KINDS) {
      const state = session.calibration[kind].state
      if (state === "pinned") continue
      const candidate = candidatesFor(catalog, settings, session, kind, incoming)[0]
      if (!candidate) continue
      ;(state === "none" ? noSessions : fills).push({ session, kind, candidate })
    }
  }
  return { fills, noSessions }
}

// ---------------------------------------------------------------------------
// Master age and import matching (CAL-FR-13 to CAL-FR-15)
// ---------------------------------------------------------------------------

/** Kinds whose masters age (CAL-FR-15): darks and bias. Flats are exempt. */
const AGEING_KINDS: ReadonlySet<CalibrationKind> = new Set(["dark", "bias"])

/** Settings › Old masters after, by default (CAL-FR-15). A reminder badge only, never a matching window. */
export const DEFAULT_MASTER_MAX_AGE_DAYS = 90

/**
 * "Old · 120 d": a dark or bias master whose newest version is older than
 * `settings.masterMaxAgeDays`, a reminder to shoot new ones. Null for a
 * younger master and for every flat. It raises no issue on any other row.
 */
export function masterAge(master: Pick<CalibrationMaster, "kind" | "versions">, settings: Pick<AppSettings, "masterMaxAgeDays">, nowMs: number): { days: number; label: MessageRef } | null {
  const newest = newestVersion(master)
  if (!AGEING_KINDS.has(master.kind) || !newest) return null
  const days = Math.floor((nowMs - Date.parse(newest.capturedAt)) / DAY_MS)
  return days > settings.masterMaxAgeDays ? { days, label: msg("flow_master_old", { n: days }) } : null
}

/** What an imported master file is to the library (CAL-FR-13): new, a new version of a master with its settings, or bytes the library holds. */
export type MasterMatch = { kind: "new" } | { kind: "version"; master: CalibrationMaster } | { kind: "duplicate"; master: CalibrationMaster; version: MasterVersion }

export type MasterFacts = Pick<CalibrationMaster, "kind" | "cameraName" | "widthPx" | "heightPx" | "binning" | "gain" | "offset" | "exposureS" | "channel" | "ccdTempC">

/** The settings a master record matches (CAL-FR-14): camera, size, binning, gain and offset; exposure and temperature for darks; temperature for bias; the filter for flats. */
export function masterRecordKey(facts: MasterFacts): string {
  const exposure = facts.kind === "dark" ? facts.exposureS : null
  const temperature = facts.kind === "dark" || facts.kind === "bias" ? facts.ccdTempC : null
  const channel = facts.kind === "flat" || facts.kind === "dark-flat" ? (facts.channel ?? "").toLowerCase() : null
  return [facts.kind, facts.cameraName, facts.widthPx, facts.heightPx, facts.binning, facts.gain, facts.offset, exposure, temperature, channel].join("|")
}

/** The calibration kind of a master file's IMAGETYP; null when the file is not a master. */
export function masterKindOf(file: Pick<DiskFile, "header">): CalibrationKind | null {
  const type = file.header?.imageType ?? ""
  return type.startsWith("master-") ? (type.slice("master-".length) as CalibrationKind) : null
}

export function factsOf(file: DiskFile, kind: CalibrationKind): MasterFacts {
  const h = file.header!
  return { kind, cameraName: h.instrument, widthPx: h.widthPx, heightPx: h.heightPx, binning: h.binning, gain: h.gain, offset: h.offset, exposureS: h.exposureS, channel: h.filter, ccdTempC: h.ccdTempC }
}

/**
 * Import masters' preview (CAL-FR-13), per file: Duplicate when a version
 * holds the same bytes or path; New version of a master whose settings it
 * matches (not hidden) and whose camera it shares (`sameMasterCamera`, with
 * `cameraId` the camera the user linked the file to, or null); else New.
 * Null when the file is not a master.
 */
export function masterImportMatch(catalog: Catalog, disk: Disk, file: DiskFile, cameraId: CameraId | null): MasterMatch | null {
  const kind = masterKindOf(file)
  if (!kind || !file.header) return null
  for (const master of Object.values(catalog.masters)) {
    const version = master.versions.find((v) => v.path === file.path || v.origin.sourcePath === file.path || v.sha256 === file.sha256 || v.adoption?.verifiedSha256 === file.sha256 || fileAt(disk, v.path)?.sha256 === file.sha256)
    if (version) return { kind: "duplicate", master, version }
  }
  const key = masterRecordKey(factsOf(file, kind))
  const master = Object.values(catalog.masters).find((m) => !m.hiddenAt && m.state === "adopted" && masterRecordKey(m) === key && sameMasterCamera(catalog, file.header!.instrument, m.cameraId, cameraId))
  return master ? { kind: "version", master } : { kind: "new" }
}

/** "New", "New version of MasterDark 300 s", "Duplicate": the preview's Match cell. */
export function masterMatchRef(catalog: Catalog, match: MasterMatch): MessageRef {
  if (match.kind === "new") return msg("flow_match_new")
  return match.kind === "version" ? msg("flow_match_version_of", { master: masterRecordRef(catalog, match.master) }) : msg("flow_match_duplicate")
}

/** A master record's name: "Dark 300 s · ASI2600MM Pro", "Flat Ha · RedCat 51 / ASI2600MM". */
export function masterRecordRef(catalog: Catalog, master: CalibrationMaster): MessageRef {
  const detail = master.kind === "flat" ? (master.channel ?? "") : master.kind === "dark" && master.exposureS !== null ? formatExposure(master.exposureS) : ""
  const where = master.kind === "flat" ? (trainName(catalog, master.opticalTrainId) ?? master.cameraName) : (master.cameraId ? catalog.cameras[master.cameraId]?.physicalAlias : null) ?? master.cameraName
  return joinRefs([joinRefs([KIND_NAME[master.kind], ...(detail ? [verbatim(detail)] : [])], " "), ...(where ? [verbatim(where)] : [])], " · ")
}
