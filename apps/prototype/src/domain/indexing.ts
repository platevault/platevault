/**
 * Indexing in place (spec 064). Pure functions that read the simulated disk
 * into the catalog. Indexing records metadata only: it never creates, renames,
 * moves or deletes source files (LIB-FR-02).
 *
 * Used by the demo seed (synchronously) and by the "index" operation
 * (progressively, a batch per tick), so both produce identical catalogs.
 * Intake splits a night's frames into sessions by capture key and framing
 * (D-W107), and every ingestion matches calibration on the light sessions
 * still waiting (`ingestFiles`, CAL-FR-02). Raw calibration sessions are
 * routed into a calibration process awaiting Stack (P-CAL3,
 * `routeRawCalibration`); masters in a Calibration location become dated
 * versions of library masters (CAL-FR-14).
 */
import { formatDegrees } from "@/lib/format"
import { type MessageRef, msg, verbatim } from "@/lib/i18n"
import { calibrateSessions, emptyCalibration, factsOf, masterRecordKey, sameMasterCamera } from "./calibration"
import { routeRawCalibration } from "./calibration-process"
import { correctedExposureS } from "./corrections"
import { isRetiredAsset } from "./library"
import { angularSeparationDeg, BUNDLED_CATALOGUE, bundledEntryFor, normalizeName, targetFromEntry } from "./sky"
import type {
  AppSettings,
  Asset,
  AssetCopy,
  AssetId,
  Association,
  CalibrationKind,
  Camera,
  CameraId,
  Catalog,
  CatalogCorrection,
  CorrectionField,
  Disk,
  DiskFile,
  Evidence,
  FrameHeader,
  FramingMargins,
  IsoDateTime,
  Location,
  MasterVersion,
  NightDate,
  OpticalTrain,
  OpticalTrainId,
  RigVersion,
  RigVersionId,
  Session,
  SessionId,
  Target,
  TargetId,
  Telescope,
} from "./types"

/** Short stable hash for deterministic identities (FNV-1a, base36). */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function isUnder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`)
}

/** The denied folder that makes `path` unreadable, if any. */
export function deniedAncestor(disk: Disk, path: string): string | null {
  return disk.deniedPaths.find((denied) => isUnder(path, denied)) ?? null
}

export interface LocationListing {
  offline: boolean
  /** Readable, supported image files in capture order (DATE-OBS, then path), the order intake reads them in (D-W107). */
  readable: DiskFile[]
  unsupported: DiskFile[]
  /** Denied folders inside (or covering) the location. */
  unreadableFolders: string[]
}

/** What a scan of `location` can observe right now. */
export function listLocation(disk: Disk, location: Location): LocationListing {
  const volume = disk.volumes[location.volumeId]
  if (!volume?.mounted) return { offline: true, readable: [], unsupported: [], unreadableFolders: [] }
  const unreadableFolders = disk.deniedPaths.filter(
    (denied) => isUnder(denied, location.path) || isUnder(location.path, denied),
  )
  const readable: DiskFile[] = []
  const unsupported: DiskFile[] = []
  for (const file of Object.values(disk.files)) {
    if (file.volumeId !== location.volumeId || !isUnder(file.path, location.path)) continue
    if (file.linkTarget) continue
    if (unreadableFolders.some((folder) => isUnder(file.path, folder))) continue
    if ((file.kind === "fits" || file.kind === "xisf") && file.header) readable.push(file)
    else unsupported.push(file)
  }
  readable.sort((a, b) => a.header!.dateObs.localeCompare(b.header!.dateObs) || a.path.localeCompare(b.path))
  return { offline: false, readable, unsupported, unreadableFolders }
}

/** Night of an observation: the date of the evening it started (UTC − 12 h). */
export function nightOf(dateObs: IsoDateTime): string {
  return new Date(new Date(dateObs).getTime() - 12 * 3600 * 1000).toISOString().slice(0, 10)
}

export function assetIdForPath(path: string): AssetId {
  return `ast_${stableHash(path)}`
}

/** Session identity: metadata only, never the location, so copies elsewhere join the same session. Import groups incoming files the same way. */
export function sessionGroupingKey(h: FrameHeader): string {
  return [
    h.imageType,
    nightOf(h.dateObs),
    h.instrument ?? "",
    h.telescope ?? "",
    h.filter ?? "",
    h.exposureS,
    h.binning,
    h.gain ?? "",
    h.offset ?? "",
  ].join("|")
}

/**
 * Key of an existing session, from its effective metadata: a corrected
 * exposure regroups (LIB-FR-12), so a later file whose header reads the
 * corrected value joins it. New files group by their observed header.
 */
function sessionKeyOf(session: Session): string {
  return [
    session.imageType,
    session.night,
    session.cameraName ?? "",
    session.telescopeName ?? "",
    session.channel ?? "",
    correctedExposureS(session) ?? session.exposureS,
    session.binning,
    session.gain ?? "",
    session.offset ?? "",
  ].join("|")
}

/**
 * Id for a new session. The plain key hash comes first, so seed ids stay
 * stable; an id still in the catalog or named by lineage is never reused, so
 * superseded and corrected sessions keep theirs (LIB-AC-10, D15).
 */
function freshSessionId(key: string, taken: Set<SessionId>): SessionId {
  let id = `ses_${stableHash(key)}`
  for (let n = 1; taken.has(id); n += 1) id = `ses_${stableHash(`${key}#${n}`)}`
  return id
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}

function mostCommon(values: Array<string | null>): string | null {
  const counts = new Map<string, number>()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  for (const [value, count] of counts) if (count > bestCount) [best, bestCount] = [value, count]
  return best
}

function matchesName(name: string, candidates: string[]): boolean {
  const n = normalizeName(name)
  return candidates.some((candidate) => normalizeName(candidate) === n)
}

// ---------------------------------------------------------------------------
// Associations
// ---------------------------------------------------------------------------

/** The deterministic id of the Target a bundled designation becomes, so a preview can name it before indexing writes it. */
function bundledTargetId(designation: string): TargetId {
  return `tgt_${stableHash(designation)}`
}

function libraryTargetNamed(catalog: Catalog, name: string): Target | undefined {
  return Object.values(catalog.targets).find((t) => matchesName(name, [t.name, ...t.aliases]))
}

/** A new Target record for a bundled catalogue object, or null when the catalogue has no such object. */
export function bundledTarget(name: string, now: IsoDateTime): Target | null {
  const entry = bundledEntryFor(name)
  return entry ? targetFromEntry(entry, { id: bundledTargetId(entry.designation), at: now, resolver: null, favourite: false }) : null
}

function ensureTargetFor(catalog: Catalog, name: string, now: IsoDateTime): Target | null {
  const existing = libraryTargetNamed(catalog, name)
  if (existing) return existing
  const target = bundledTarget(name, now)
  if (target) catalog.targets[target.id] = target
  return target
}

/** How far from its centre a footprint reaches: half its larger side plus 0.5°, or 0.5° without a known size. */
function footprintReachDeg(sizeDeg: { width: number; height: number } | null): number {
  return (sizeDeg ? Math.max(sizeDeg.width, sizeDeg.height) / 2 : 0) + 0.5
}

/** The bundled object whose extent contains the pointing, nearest first. */
function objectAtPointing(ra: number, dec: number) {
  let best: { name: string; separation: number } | null = null
  for (const entry of BUNDLED_CATALOGUE) {
    const separation = angularSeparationDeg(ra, dec, entry.ra, entry.dec)
    if (separation <= footprintReachDeg(entry.sizeDeg) && (!best || separation < best.separation)) best = { name: entry.designation, separation }
  }
  return best
}

/**
 * The Target a pointing associates (LIB-FR-05), without writing: the library
 * record of the object whose footprint contains it (nearest centre wins), or
 * the record indexing adds for it. Import prefills its Target choice with it.
 */
export function targetAtPointing(catalog: Catalog, ra: number, dec: number): { id: TargetId; name: string } | null {
  const pointed = objectAtPointing(ra, dec)
  if (!pointed) return null
  const existing = libraryTargetNamed(catalog, pointed.name)
  return existing ? { id: existing.id, name: existing.name } : { id: bundledTargetId(pointed.name), name: pointed.name }
}

/**
 * Where a pointing sits against a Target's footprint: its distance from the
 * centre and whether the footprint contains it. Null without the Target's
 * coordinates or a pointing: unknown is never a mismatch.
 */
export function pointingAgainst(target: Target, pointing: Session["pointing"]): { separationDeg: number; inside: boolean } | null {
  if (!pointing || target.ra === null || target.dec === null) return null
  const separationDeg = angularSeparationDeg(pointing.ra, pointing.dec, target.ra, target.dec)
  return { separationDeg, inside: separationDeg <= footprintReachDeg(target.sizeDeg) }
}

/**
 * LIB-FR-05: the pointing inside a Target's footprint associates it; the
 * user's confirmation settles it. Without such a pointing the Target stays
 * unresolved. OBJECT is a label and filter only: it is never evidence, never
 * preselects and never counts towards confirmation.
 */
export function associateTarget(catalog: Catalog, session: Session, now: IsoDateTime): Association<TargetId> {
  const label = msg("evidence_source_pointing")
  if (!session.pointing) return { value: null, status: "unresolved", evidence: [{ source: "pointing", label, value: msg("indexing_pointing_none"), agrees: null }], confirmedAt: null }
  const pointed = objectAtPointing(session.pointing.ra, session.pointing.dec)
  const target = pointed ? ensureTargetFor(catalog, pointed.name, now) : null
  if (!pointed || !target) return { value: null, status: "unresolved", evidence: [{ source: "pointing", label, value: msg("indexing_pointing_outside_targets"), agrees: false }], confirmedAt: null }
  const evidence: Evidence[] = [{ source: "pointing", label, value: msg("indexing_pointing_from_centre", { angle: formatDegrees(pointed.separation, 2), name: pointed.name }), agrees: true }]
  return { value: target.id, status: "associated", evidence, confirmedAt: null }
}

/** Observed evidence stays as read; the confirmation is a separate user row. */
export function confirmedEvidence(evidence: Evidence[], label: MessageRef, value: MessageRef): Evidence[] {
  return [...evidence.filter((e) => e.source !== "user"), { source: "user", label, value, agrees: true }]
}

/**
 * The cameras a header's INSTRUME names: every camera of that model (two or
 * more when the rigs hold several of one model, each with its own physical
 * alias, LIB-FR-26), else one detected record.
 */
function camerasFor(catalog: Catalog, header: NonNullable<DiskFile["header"]>): Camera[] {
  if (!header.instrument) return []
  const existing = Object.values(catalog.cameras).filter((c) => matchesName(header.instrument!, [c.name, ...c.aliases]))
  if (existing.length > 0) return existing
  const camera: Camera = {
    id: `cam_${stableHash(header.instrument)}`,
    name: header.instrument,
    aliases: [],
    source: "detected",
    widthPx: header.widthPx * header.binning,
    heightPx: header.heightPx * header.binning,
    pixelSizeUm: header.pixelSizeUm ?? 0,
    kind: header.bayerPattern !== null ? "osc" : "mono",
    physicalAlias: null,
    noDarks: false,
    noBias: false,
  }
  catalog.cameras[camera.id] = camera
  return [camera]
}

/** The rig of one of these cameras (all one model) on the telescope, else a new detected rig with the first. */
function trainFor(catalog: Catalog, cameras: Camera[], telescope: Telescope, night: NightDate): OpticalTrain {
  const ids = new Set(cameras.map((c) => c.id))
  const existing = Object.values(catalog.opticalTrains).find((t) => t.cameraId !== null && ids.has(t.cameraId) && t.telescopeId === telescope.id)
  if (existing) return existing
  const camera = cameras[0]!
  // Trains created from headers stay "detected" until Confirm equipment promotes them (D11).
  const id = `otr_${stableHash(`${camera.id}|${telescope.id}`)}`
  const train: OpticalTrain = {
    id,
    name: `${telescope.name} / ${camera.name}`,
    source: "detected",
    cameraId: camera.id,
    telescopeId: telescope.id,
    effectiveFocalLengthMm: telescope.focalLengthMm,
    notes: "",
    filterIds: [],
    rotator: false,
    versionId: `rv_${stableHash(`${id}|1`)}`,
    versionFrom: night,
    history: [],
  }
  catalog.opticalTrains[train.id] = train
  return train
}

// ---------------------------------------------------------------------------
// Rig versions (PLAN-EQ-FR-07, LIB-FR-26)
// ---------------------------------------------------------------------------

/** The rig's current version as a record: its top-level optics. */
export function currentRigVersion(rig: OpticalTrain): RigVersion {
  return {
    id: rig.versionId,
    from: rig.versionFrom,
    cameraId: rig.cameraId,
    telescopeId: rig.telescopeId,
    reducerId: rig.reducerId ?? null,
    effectiveFocalLengthMm: rig.effectiveFocalLengthMm,
    filterIds: rig.filterIds,
    rotator: rig.rotator,
  }
}

/** Every version of the rig, oldest first. */
export function rigVersions(rig: OpticalTrain): RigVersion[] {
  return [...rig.history, currentRigVersion(rig)]
}

/** The version in effect on a night: the newest that started on or before it, else the oldest. */
export function rigVersionAt(rig: OpticalTrain, night: NightDate): RigVersion {
  const versions = rigVersions(rig)
  return [...versions].reverse().find((v) => v.from <= night) ?? versions[0]!
}

/** A version by id, current or earlier. */
export function rigVersionById(rig: OpticalTrain, versionId: RigVersionId): RigVersion | undefined {
  return rigVersions(rig).find((v) => v.id === versionId)
}

/**
 * The rig and version a session was captured with (LIB-FR-26): its settled
 * rig and recorded version, or the version in effect on its night while it
 * has none recorded. Null without a settled rig.
 */
export function sessionRigVersion(catalog: Catalog, session: Session): { rigId: OpticalTrainId; version: RigVersion } | null {
  const settled = session.equipment.status === "confirmed" || session.equipment.status === "associated"
  const rig = settled && session.equipment.value ? catalog.opticalTrains[session.equipment.value] : undefined
  if (!rig) return null
  const recorded = session.rigVersionId ? rigVersionById(rig, session.rigVersionId) : undefined
  return { rigId: rig.id, version: recorded ?? rigVersionAt(rig, session.night) }
}

/** The version a session records once its rig settles: kept while the rig stays the same, so a later rig edit never remaps it. */
export function capturedRigVersionId(catalog: Catalog, session: Session): RigVersionId | null {
  const settled = session.equipment.status === "confirmed" || session.equipment.status === "associated"
  const rig = settled && session.equipment.value ? catalog.opticalTrains[session.equipment.value] : undefined
  if (!rig) return null
  if (session.rigVersionId && rigVersionById(rig, session.rigVersionId)) return session.rigVersionId
  return rigVersionAt(rig, session.night).id
}

/** A header value as data, or "Missing" when the header lacks it. */
function headerValue(value: string | null | undefined): MessageRef {
  return value ? verbatim(value) : msg("status_missing")
}

/**
 * Equipment association (D11): explicit camera/optical-train records with
 * confirmed versus observed evidence. Unknown header strings are detected as
 * new records; a focal-length-only match is Needs review, never assumed.
 */
export function associateEquipment(catalog: Catalog, header: NonNullable<DiskFile["header"]>): Association<OpticalTrainId> {
  const evidence: Evidence[] = [
    { source: "header", label: verbatim("INSTRUME"), value: headerValue(header.instrument), agrees: header.instrument ? true : null },
    { source: "header", label: verbatim("TELESCOP"), value: headerValue(header.telescope), agrees: header.telescope ? true : null },
    {
      source: "header",
      label: verbatim("FOCALLEN"),
      value: headerValue(header.focalLengthMm ? `${header.focalLengthMm} mm` : null),
      agrees: header.focalLengthMm ? true : null,
    },
  ]
  const trainLabel = msg("domain_optical_train")
  const cameras = camerasFor(catalog, header)
  if (cameras.length === 0) return { value: null, status: "unresolved", evidence, confirmedAt: null }

  const telescopes = Object.values(catalog.telescopes)
  const named = header.telescope
    ? telescopes.find((t) => matchesName(header.telescope!, [t.name, ...t.aliases]))
    : undefined
  if (named) {
    const train = trainFor(catalog, cameras, named, nightOf(header.dateObs))
    evidence.push({ source: "equipment-record", label: trainLabel, value: verbatim(train.name), agrees: true })
    return { value: train.id, status: "associated", evidence, confirmedAt: null }
  }
  const byFocal = header.focalLengthMm
    ? telescopes.find((t) => Math.abs(t.focalLengthMm - header.focalLengthMm!) / t.focalLengthMm < 0.02)
    : undefined
  if (byFocal) {
    const train = trainFor(catalog, cameras, byFocal, nightOf(header.dateObs))
    const telescopeEvidence = evidence[1]!
    telescopeEvidence.agrees = false
    evidence.push({ source: "equipment-record", label: trainLabel, value: msg("indexing_train_focal_match", { name: train.name }), agrees: null })
    return { value: train.id, status: "needs-review", evidence, confirmedAt: null }
  }
  if (header.telescope && header.focalLengthMm) {
    const telescope: Telescope = {
      id: `tel_${stableHash(header.telescope)}`,
      name: header.telescope,
      aliases: [],
      source: "detected",
      focalLengthMm: header.focalLengthMm,
      apertureMm: null,
    }
    catalog.telescopes[telescope.id] = telescope
    const train = trainFor(catalog, cameras, telescope, nightOf(header.dateObs))
    evidence.push({ source: "equipment-record", label: trainLabel, value: msg("indexing_train_detected", { name: train.name }), agrees: true })
    return { value: train.id, status: "associated", evidence, confirmedAt: null }
  }
  return { value: null, status: "needs-review", evidence, confirmedAt: null }
}

// ---------------------------------------------------------------------------
// Reading files
// ---------------------------------------------------------------------------

function rebuildSession(catalog: Catalog, session: Session, now: IsoDateTime): Session {
  const assets = session.assetIds
    .map((id) => catalog.assets[id])
    .filter((a): a is Asset => Boolean(a))
    .sort((a, b) => a.observed.dateObs.localeCompare(b.observed.dateObs))
  const first = assets[0]!
  const last = assets[assets.length - 1]!
  const pointed = assets.filter((a) => a.observed.ra !== null && a.observed.dec !== null)
  const rotations = pointed.map((a) => a.observed.rotationDeg).filter((r): r is number => r !== null)
  const next: Session = {
    ...session,
    assetIds: assets.map((a) => a.id),
    startedAt: first.observed.dateObs,
    endedAt: last.observed.dateObs,
    objectLabel: mostCommon(assets.map((a) => a.observed.object)),
    ccdTempC: median(assets.map((a) => a.observed.ccdTempC).filter((t): t is number => t !== null)),
    pointing:
      pointed.length > 0
        ? {
            ra: pointed.reduce((sum, a) => sum + a.observed.ra!, 0) / pointed.length,
            dec: pointed.reduce((sum, a) => sum + a.observed.dec!, 0) / pointed.length,
            rotationDeg: rotations.length === pointed.length ? (median(rotations) ?? null) : null,
          }
        : null,
  }
  if (session.target.status !== "confirmed") next.target = associateTarget(catalog, next, now)
  if (session.equipment.status !== "confirmed") next.equipment = associateEquipment(catalog, first.observed)
  next.rigVersionId = capturedRigVersionId(catalog, next.equipment.value === session.equipment.value ? next : { ...next, rigVersionId: null })
  return next
}

/**
 * The asset a file belongs to: the asset with a copy at this path in this
 * location, else a byte-identical asset of the same image type (a copy or a
 * move elsewhere, LIB-AC-15), else none. A retired asset (its only present
 * copies are in retired locations) is never matched, by path or by bytes:
 * registering its folder again makes new assets that inherit no decision,
 * association or correction (D11).
 */
function assetForFile(catalog: Catalog, location: Location, file: DiskFile): Asset | undefined {
  let sameBytes: Asset | undefined
  for (const asset of Object.values(catalog.assets)) {
    if (isRetiredAsset(catalog, asset)) continue
    if (asset.copies.some((c) => c.locationId === location.id && c.path === file.path)) return asset
    if (!sameBytes && asset.sha256 === file.sha256 && asset.imageType === file.header!.imageType) sameBytes = asset
  }
  return sameBytes
}

// ---------------------------------------------------------------------------
// Framing (D-W107, LIB-FR-04)
// ---------------------------------------------------------------------------

/** Where a frame points: its centre and ROTATANG. */
export interface Framing {
  ra: number
  dec: number
  rotationDeg: number | null
}

/** The framing a header records; null without RA/DEC. */
export function framingOf(h: FrameHeader): Framing | null {
  if (h.ra === null || h.dec === null) return null
  return { ra: h.ra, dec: h.dec, rotationDeg: h.rotationDeg }
}

/** Rotation separation, treating a meridian flip as equivalent; null means the evidence is unknown. */
function rotationDifferenceDeg(a: Framing, b: Framing): number | null {
  if (a.rotationDeg === null || b.rotationDeg === null) return null
  const d = Math.abs(a.rotationDeg - b.rotationDeg) % 180
  return Math.min(d, 180 - d)
}

/**
 * The same framing (D-W107, PRJ-FR-31): the centres at most `centreArcmin`
 * apart, an angle whatever the field, and ROTATANG within `rotationDeg`, a
 * meridian flip (180°) counting as the same. Missing pointing or rotation
 * evidence never splits.
 */
export function sameFraming(a: Framing | null, b: Framing | null, margins: FramingMargins): boolean {
  if (!a || !b) return true
  if (angularSeparationDeg(a.ra, a.dec, b.ra, b.dec) * 60 > margins.centreArcmin) return false
  const rotationDifference = rotationDifferenceDeg(a, b)
  return rotationDifference === null || rotationDifference <= margins.rotationDeg
}

/** Frames in capture order (D-W107): by DATE-OBS, a tie keeping the order given. */
export function inCaptureOrder<T>(items: readonly T[], header: (item: T) => FrameHeader): T[] {
  return [...items].sort((a, b) => header(a).dateObs.localeCompare(header(b).dateObs))
}

/**
 * The framing a pointed frame joins (D-W107): the one whose anchor, its
 * first pointed frame in capture order, lies nearest within the margins,
 * the earlier framing on a full tie. A frame is compared with anchors only,
 * so a slow drift splits instead of chaining and a frame back at an earlier
 * framing rejoins it. A framing without an anchor (Framing unknown) never
 * takes a pointed frame.
 */
function nearestFraming<G extends { anchor: Framing | null }>(framings: readonly G[], framing: Framing, margins: FramingMargins): G | undefined {
  let nearest: G | undefined
  let nearestDeg = Number.POSITIVE_INFINITY
  let nearestRotationDeg: number | null = null
  for (const candidate of framings) {
    const anchor = candidate.anchor
    if (!anchor || !sameFraming(anchor, framing, margins)) continue
    const separation = angularSeparationDeg(anchor.ra, anchor.dec, framing.ra, framing.dec)
    const rotation = rotationDifferenceDeg(anchor, framing)
    if (separation > nearestDeg) continue
    if (separation === nearestDeg) {
      if (nearestRotationDeg !== null && (rotation === null || rotation >= nearestRotationDeg)) continue
      if (nearestRotationDeg === null && rotation === null) continue
    }
    nearest = candidate
    nearestDeg = separation
    nearestRotationDeg = rotation
  }
  return nearest
}

/**
 * Frames of one capture key split by framing (D-W107, LIB-FR-04), in capture
 * order: a pointed frame joins its nearest framing (`nearestFraming`), else
 * anchors the next ("framing 2"); frames with no pointing never join one and
 * form a session of their own, flagged Framing unknown. Import review
 * previews the same split (LIB-AC-31).
 */
export function splitByFraming<T>(items: readonly T[], header: (item: T) => FrameHeader, margins: FramingMargins): { framings: T[][]; unpointed: T[] } {
  const framings: Array<{ anchor: Framing; items: T[] }> = []
  const unpointed: T[] = []
  for (const item of inCaptureOrder(items, header)) {
    const framing = framingOf(header(item))
    if (!framing) {
      unpointed.push(item)
      continue
    }
    const joined = nearestFraming(framings, framing, margins)
    if (joined) joined.items.push(item)
    else framings.push({ anchor: framing, items: [item] })
  }
  return { framings: framings.map((f) => f.items), unpointed }
}

/** A light session's anchor (D-W107): the framing of its first pointed frame in capture order; null for one with no pointing (Framing unknown) and for calibration frames. */
function sessionAnchor(catalog: Catalog, session: Session): Framing | null {
  if (session.imageType !== "light") return null
  const pointed = session.assetIds.flatMap((id) => {
    const header = catalog.assets[id]?.observed
    return header && header.ra !== null && header.dec !== null ? [header] : []
  })
  const first = inCaptureOrder(pointed, (h) => h)[0]
  return first ? framingOf(first) : null
}

/** A session's framing: its mean pointing and rotation. */
export function sessionFraming(session: Session): Framing | null {
  if (!session.pointing) return null
  return { ra: session.pointing.ra, dec: session.pointing.dec, rotationDeg: session.pointing.rotationDeg }
}

// ---------------------------------------------------------------------------
// Library masters (CAL-FR-14)
// ---------------------------------------------------------------------------

/**
 * A master file in a Calibration location joins the library (CAL-FR-14): a
 * new dated version of the master whose settings and camera it shares
 * (`sameMasterCamera`), else a new master record linked to `cameraId`, the
 * camera the user confirmed at import (LIB-FR-26), or to none. Generated
 * masters found elsewhere stay candidates until adopted (CAL-FR-06).
 */
function addLibraryMaster(catalog: Catalog, file: DiskFile, header: FrameHeader, cameraId: CameraId | null): void {
  const kind = header.imageType.slice("master-".length) as CalibrationKind
  if (Object.values(catalog.masters).some((m) => m.versions.some((v) => v.path === file.path))) return
  const facts = factsOf(file, kind)
  const version: MasterVersion = {
    id: `mv_${stableHash(file.path)}`,
    path: file.path,
    sha256: file.sha256,
    capturedAt: header.dateObs,
    frameCount: header.ncombine,
    origin: { kind: "library", projectId: null, sourcePath: file.path, sessionId: null },
    adoption: null,
  }
  const record = Object.values(catalog.masters).find(
    (m) => !m.hiddenAt && m.state === "adopted" && masterRecordKey(m) === masterRecordKey(facts) && sameMasterCamera(catalog, header.instrument, m.cameraId, cameraId),
  )
  if (record) {
    catalog.masters[record.id] = { ...record, versions: [...record.versions, version].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)) }
    return
  }
  const train = kind === "flat" ? associateEquipment(catalog, header) : null
  const rig = train?.status === "associated" && train.value ? catalog.opticalTrains[train.value] : undefined
  const id = `mst_${stableHash(file.path)}`
  catalog.masters[id] = {
    id,
    kind,
    cameraName: header.instrument,
    cameraId,
    widthPx: header.widthPx,
    heightPx: header.heightPx,
    binning: header.binning,
    gain: header.gain,
    offset: header.offset,
    exposureS: kind === "dark" || kind === "dark-flat" ? header.exposureS : null,
    channel: header.filter,
    opticalTrainId: rig?.id ?? null,
    rigVersionId: rig ? rigVersionAt(rig, nightOf(header.dateObs)).id : null,
    ccdTempC: header.ccdTempC,
    rotationDeg: kind === "flat" ? header.rotationDeg : null,
    versions: [version],
    state: "adopted",
  }
}

// ---------------------------------------------------------------------------
// Reading files
// ---------------------------------------------------------------------------

function newSession(id: SessionId, header: FrameHeader, framing: number): Session {
  return {
    id,
    revision: 1,
    night: nightOf(header.dateObs),
    imageType: header.imageType,
    channel: header.filter,
    exposureS: header.exposureS,
    binning: header.binning,
    gain: header.gain,
    offset: header.offset,
    ccdTempC: header.ccdTempC,
    cameraName: header.instrument,
    telescopeName: header.telescope,
    assetIds: [],
    startedAt: header.dateObs,
    endedAt: header.dateObs,
    objectLabel: header.object,
    name: null,
    notes: "",
    pointing: null,
    target: { value: null, status: "unresolved", evidence: [], confirmedAt: null },
    equipment: { value: null, status: "unresolved", evidence: [], confirmedAt: null },
    corrections: [],
    previousSessionIds: [],
    supersededBy: null,
    reviewReset: false,
    scope: "provisional",
    framing,
    rigVersionId: null,
    calibration: header.imageType === "light" ? emptyCalibration() : null,
  }
}

/**
 * Read a batch of files of one location into the catalog. Existing assets
 * keep their identity, session and decisions; changed bytes update the
 * fingerprint, which makes earlier quality decisions "changed content". A
 * byte-identical file found elsewhere becomes another copy of its asset.
 * When one copy's bytes change while another copy keeps the recorded bytes,
 * the asset keeps its identity and the pair reads as conflicting copies
 * (LIB-AC-15): both stay registered and neither is used in place of the
 * other until their bytes agree again (D19). New light frames join the
 * session of their capture key and framing, read in capture order: a
 * pointed frame joins the framing whose first frame it lies nearest within
 * the margins, else starts the next one, and frames with no pointing form a
 * session of their own, Framing unknown (D-W107).
 * Returns a new catalog object (collections are shallow-copied). Every
 * ingestion goes through `ingestFiles`, which matches calibration after it.
 */
function readFiles(source: Catalog, location: Location, files: DiskFile[], now: IsoDateTime, margins: FramingMargins, masterCameras: ReadonlyMap<string, CameraId>): Catalog {
  const catalog: Catalog = {
    ...source,
    assets: { ...source.assets },
    sessions: { ...source.sessions },
    targets: { ...source.targets },
    cameras: { ...source.cameras },
    telescopes: { ...source.telescopes },
    opticalTrains: { ...source.opticalTrains },
    masters: { ...source.masters },
  }
  /** Live sessions by capture key, with the anchor a new frame is compared against (`sessionAnchor`). */
  const keyToSessions = new Map<string, Array<{ id: SessionId; anchor: Framing | null }>>()
  const takenSessionIds = new Set<SessionId>()
  for (const session of Object.values(catalog.sessions)) {
    // A session whose frames are all retired never absorbs new files (D11).
    const retired =
      session.assetIds.length > 0 &&
      session.assetIds.every((id) => {
        const asset = catalog.assets[id]
        return asset !== undefined && isRetiredAsset(catalog, asset)
      })
    if (!session.supersededBy && !retired) {
      const key = sessionKeyOf(session)
      keyToSessions.set(key, [...(keyToSessions.get(key) ?? []), { id: session.id, anchor: sessionAnchor(catalog, session) }].sort((a, b) => catalog.sessions[a.id]!.framing - catalog.sessions[b.id]!.framing))
    }
    takenSessionIds.add(session.id)
    for (const previous of session.previousSessionIds) takenSessionIds.add(previous)
    if (session.supersededBy) takenSessionIds.add(session.supersededBy)
  }
  const touched = new Set<SessionId>()

  // Capture order, lights with no pointing after the rest: the framings number ahead of the Framing unknown session, as import review lists them.
  const ordered = inCaptureOrder(files, (f) => f.header!)
  const unpointedLight = (f: DiskFile) => f.header!.imageType === "light" && framingOf(f.header!) === null
  for (const file of [...ordered.filter((f) => !unpointedLight(f)), ...ordered.filter(unpointedLight)]) {
    const header = file.header!
    const copy: AssetCopy = { locationId: location.id, volumeId: file.volumeId, path: file.path, sha256: file.sha256, presence: "observed", lastObservedAt: now }
    const existing = assetForFile(catalog, location, file)
    if (existing) {
      const known = existing.copies.some((c) => c.locationId === location.id && c.path === file.path)
      const copies = known
        ? existing.copies.map((c) => (c.locationId === location.id && c.path === file.path ? copy : c))
        : [...existing.copies, copy]
      // Re-reading the bytes finishes any pending verification of this decision.
      let quality = existing.quality.verificationPending ? { ...existing.quality, verificationPending: false } : existing.quality
      // Put back from the OS Trash and rescanned: the record returns as Unusable (D-W43).
      if (existing.trashed) quality = { value: "unusable", decidedAt: now, basisSha256: file.sha256 }
      // The identity follows the bytes only while every copy outside a retired location agrees.
      const agreed = copies.every((c) => c.sha256 === file.sha256 || catalog.locations[c.locationId]?.retiredAt)
      catalog.assets[existing.id] = agreed
        ? { ...existing, sha256: file.sha256, sizeBytes: file.sizeBytes, copies, quality, trashed: null }
        : { ...existing, copies, quality, trashed: null }
      continue
    }
    // A retired asset can hold this path's id; a re-registered file gets its own.
    const pathId = assetIdForPath(file.path)
    const id = catalog.assets[pathId] ? assetIdForPath(`${location.id}|${file.path}`) : pathId
    const isMaster = header.imageType.startsWith("master-")
    if (isMaster && location.role === "calibration") addLibraryMaster(catalog, file, header, masterCameras.get(file.path) ?? null)
    let sessionId: SessionId | undefined
    if (!isMaster) {
      const key = sessionGroupingKey(header)
      const anchor = header.imageType === "light" ? framingOf(header) : null
      const sessions = keyToSessions.get(key) ?? []
      sessionId = (anchor ? nearestFraming(sessions, anchor, margins) : sessions.find((s) => s.anchor === null))?.id
      if (!sessionId) {
        const n = sessions.length + 1
        sessionId = freshSessionId(n === 1 ? key : `${key}|framing ${n}`, takenSessionIds)
        takenSessionIds.add(sessionId)
        keyToSessions.set(key, [...sessions, { id: sessionId, anchor }])
        catalog.sessions[sessionId] = newSession(sessionId, header, n)
      }
      const session = catalog.sessions[sessionId]!
      catalog.sessions[sessionId] = { ...session, assetIds: [...session.assetIds, id] }
      touched.add(sessionId)
    }
    catalog.assets[id] = {
      id,
      fileName: file.path.slice(file.path.lastIndexOf("/") + 1),
      format: file.kind === "xisf" ? "xisf" : "fits",
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      observed: header,
      imageType: header.imageType,
      sessionId: sessionId ?? null,
      copies: [copy],
      quality: { value: "unreviewed", decidedAt: null, basisSha256: null },
      trashed: null,
    }
  }
  for (const sessionId of touched) catalog.sessions[sessionId] = rebuildSession(catalog, catalog.sessions[sessionId]!, now)
  catalog.calibrationProcesses = routeRawCalibration(catalog, touched, now)
  return catalog
}

/** The grouping values a correction carries into the capture key (`sessionKeyOf`), so correcting some frames re-splits their session (LIB-FR-12). */
export type RegroupField = Extract<CorrectionField, "exposure" | "filter">

/**
 * A regrouping correction of `field` on some frames of a session, the 064
 * contract's library_confirm_metadata (LIB-FR-12, D15): the session is
 * superseded and its frames split into successors by the corrected capture
 * key, the corrected frames in one and the rest in the other. The
 * predecessor keeps its record and frames for traceability; each successor
 * names it in `previousSessionIds`, and `supersededBy` names the successor
 * holding the first frame, which keeps the session's name and notes while
 * the others take the derived name (owner's answer, 2026-10-20). A
 * successor inherits the Target, rig, calibration and every frame's mark,
 * since all its frames share them, and its Review step reads Needs review
 * until Finish review (D-W100). Source headers never change. Returns the
 * successors, first-frame holder first; the catalog is mutated in place
 * (callers pass a copy, as `withCatalog` does).
 */
export function resplitSession(catalog: Catalog, sessionId: SessionId, corrected: ReadonlySet<AssetId>, correction: Omit<CatalogCorrection, "revision">, now: IsoDateTime): Session[] {
  const predecessor = catalog.sessions[sessionId]!
  const revision = predecessor.revision + 1
  const taken = new Set<SessionId>()
  for (const s of Object.values(catalog.sessions)) {
    taken.add(s.id)
    for (const previous of s.previousSessionIds) taken.add(previous)
  }
  const first = [...predecessor.assetIds].sort((a, b) => catalog.assets[a]!.observed.dateObs.localeCompare(catalog.assets[b]!.observed.dateObs))[0]!
  const parts = [predecessor.assetIds.filter((id) => !corrected.has(id)), predecessor.assetIds.filter((id) => corrected.has(id))].sort((a, b) => Number(b.includes(first)) - Number(a.includes(first)))
  const successors = parts.map((assetIds, i) => {
    const isCorrected = assetIds.some((id) => corrected.has(id))
    const draft: Session = {
      ...predecessor,
      revision,
      assetIds,
      channel: isCorrected && correction.field === "filter" ? correction.correctedValue : predecessor.channel,
      corrections: isCorrected ? [...predecessor.corrections, { ...correction, revision }] : predecessor.corrections,
      name: i === 0 ? predecessor.name : null,
      notes: i === 0 ? predecessor.notes : "",
      previousSessionIds: [predecessor.id],
      supersededBy: null,
      reviewReset: true,
    }
    const id = freshSessionId(sessionKeyOf(draft), taken)
    taken.add(id)
    return rebuildSession(catalog, { ...draft, id }, now)
  })
  for (const successor of successors) {
    catalog.sessions[successor.id] = successor
    for (const id of successor.assetIds) catalog.assets[id] = { ...catalog.assets[id]!, sessionId: successor.id }
  }
  catalog.sessions[sessionId] = { ...predecessor, supersededBy: successors[0]!.id }
  return successors
}

/** For an ingestion that links no master file to a camera: scans, and imports with no camera choice. */
export const NO_MASTER_CAMERAS: ReadonlyMap<string, CameraId> = new Map()

/**
 * Ingestion (LIB-FR-23, CAL-FR-02): read a batch of files of one location
 * into the catalog, then match calibration for every light session still
 * waiting, so later calibration fills what waits and never replaces a pin.
 * Indexing, Import and a calibration process's Register all go through here.
 * `masterCameras` links master files, by path, to the camera the user
 * confirmed at import (LIB-FR-26).
 */
export function ingestFiles(source: Catalog, disk: Disk, settings: Pick<AppSettings, "matching">, location: Location, files: DiskFile[], now: IsoDateTime, masterCameras: ReadonlyMap<string, CameraId>): Catalog {
  return calibrateSessions(readFiles(source, location, files, now, settings.matching.framing, masterCameras), disk, settings, now)
}

/**
 * A readable rescan of `locationId` starts: every decided asset with a copy
 * there waits for its rehash before its decision counts again (LIB-AC-14).
 */
export function markVerificationPending(source: Catalog, locationId: string): Catalog {
  let assets: Catalog["assets"] | null = null
  for (const asset of Object.values(source.assets)) {
    if (asset.quality.value === "unreviewed" || asset.quality.verificationPending) continue
    if (!asset.copies.some((c) => c.locationId === locationId)) continue
    assets ??= { ...source.assets }
    assets[asset.id] = { ...asset, quality: { ...asset.quality, verificationPending: true } }
  }
  return assets ? { ...source, assets } : source
}

/** Sessions with at least one asset copy in `locationId`. */
function sessionsInLocation(catalog: Catalog, locationId: string): Set<SessionId> {
  const ids = new Set<SessionId>()
  for (const asset of Object.values(catalog.assets)) {
    if (asset.sessionId && asset.copies.some((c) => c.locationId === locationId)) ids.add(asset.sessionId)
  }
  return ids
}

/**
 * A scan of `locationId` stopped before it finished (canceled, or the volume
 * went offline): provisional sessions and the location read "incomplete",
 * never complete (LIB-FR-03). Unobserved copies keep their last presence.
 */
export function markScanStopped(source: Catalog, locationId: string, now: IsoDateTime): Catalog {
  const location = source.locations[locationId]
  if (!location) return source
  const catalog: Catalog = { ...source, sessions: { ...source.sessions }, locations: { ...source.locations } }
  for (const id of sessionsInLocation(catalog, locationId)) {
    const session = catalog.sessions[id]!
    if (session.scope === "provisional") catalog.sessions[id] = { ...session, scope: "incomplete" }
  }
  catalog.locations[locationId] = { ...location, lastIndexedAt: now, scanScope: "incomplete" }
  return catalog
}

/**
 * Settle a location scan. Unobserved copies under unreadable or offline
 * scope become "unknown", never absent (LIB-FR-06); only a complete scan of a
 * readable folder records absence.
 */
export function settleLocationScan(
  source: Catalog,
  disk: Disk,
  locationId: string,
  observedPaths: Set<string>,
  now: IsoDateTime,
): Catalog {
  const location = source.locations[locationId]
  if (!location) return source
  const listing = listLocation(disk, location)
  if (listing.offline) return markScanStopped(source, locationId, now)
  const catalog: Catalog = { ...source, assets: { ...source.assets }, sessions: { ...source.sessions }, locations: { ...source.locations } }

  const incomplete = listing.unreadableFolders.length > 0
  const coversWhole = listing.unreadableFolders.some((folder) => isUnder(location.path, folder))
  const incompleteSessions = new Set<SessionId>()
  for (const asset of Object.values(catalog.assets)) {
    let changed = false
    const copies = asset.copies.map((copy) => {
      if (copy.locationId !== locationId || observedPaths.has(copy.path)) return copy
      const unreadable = listing.unreadableFolders.some((folder) => isUnder(copy.path, folder))
      if (unreadable && asset.sessionId) incompleteSessions.add(asset.sessionId)
      changed = true
      return { ...copy, presence: unreadable ? ("unknown" as const) : ("absent" as const) }
    })
    if (changed) catalog.assets[asset.id] = { ...asset, copies }
  }
  for (const id of sessionsInLocation(catalog, locationId)) {
    const session = catalog.sessions[id]!
    catalog.sessions[id] = { ...session, scope: incompleteSessions.has(id) ? "incomplete" : "complete" }
  }
  catalog.locations[locationId] = {
    ...location,
    access: coversWhole ? "denied" : "ok",
    lastIndexedAt: now,
    scanScope: incomplete ? "incomplete" : "complete",
    unreadablePaths: listing.unreadableFolders,
  }
  return catalog
}

/** Synchronous full index of the given locations (seed construction), through the same ingestion as the index operation. */
export function indexLocationsSync(source: Catalog, disk: Disk, settings: Pick<AppSettings, "matching">, locationIds: string[], now: IsoDateTime): Catalog {
  let catalog = source
  for (const locationId of locationIds) {
    const location = catalog.locations[locationId]
    if (!location) continue
    const listing = listLocation(disk, location)
    if (listing.offline) continue
    catalog = ingestFiles(catalog, disk, settings, location, listing.readable, now, NO_MASTER_CAMERAS)
    catalog = settleLocationScan(catalog, disk, locationId, new Set(listing.readable.map((f) => f.path)), now)
  }
  return catalog
}
