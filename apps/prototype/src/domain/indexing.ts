/**
 * Indexing in place (spec 064). Pure functions that read the simulated disk
 * into the catalog. Indexing records metadata only: it never creates, renames,
 * moves or deletes source files (LIB-FR-02).
 *
 * Used by the demo seed (synchronously) and by the "index" operation
 * (progressively, a batch per tick), so both produce identical catalogs.
 */
import { correctedExposureS } from "./corrections"
import { isRetiredAsset } from "./derive"
import { angularSeparationDeg, normalizeName, SKY_OBJECTS } from "./sky"
import type {
  Asset,
  AssetCopy,
  AssetId,
  Association,
  CalibrationKind,
  Camera,
  Catalog,
  Disk,
  DiskFile,
  Evidence,
  IsoDateTime,
  Location,
  OpticalTrain,
  OpticalTrainId,
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
  /** Readable, supported image files. */
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
  readable.sort((a, b) => a.path.localeCompare(b.path))
  return { offline: false, readable, unsupported, unreadableFolders }
}

/** Night of an observation: the date of the evening it started (UTC − 12 h). */
export function nightOf(dateObs: IsoDateTime): string {
  return new Date(new Date(dateObs).getTime() - 12 * 3600 * 1000).toISOString().slice(0, 10)
}

export function assetIdForPath(path: string): AssetId {
  return `ast_${stableHash(path)}`
}

/** Session identity: metadata only, never the location, so copies elsewhere join the same session. */
function groupingKey(file: DiskFile): string {
  const h = file.header!
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

function ensureTargetFor(catalog: Catalog, name: string, now: IsoDateTime): Target | null {
  const existing = Object.values(catalog.targets).find((t) => matchesName(name, [t.name, ...t.aliases]))
  if (existing) return existing
  const sky = SKY_OBJECTS.find((o) => matchesName(name, [o.name, ...o.aliases]))
  if (!sky) return null
  const target: Target = {
    id: `tgt_${stableHash(sky.name)}`,
    name: sky.name,
    aliases: sky.aliases,
    ra: sky.ra,
    dec: sky.dec,
    sizeDeg: { width: sky.widthDeg, height: sky.heightDeg },
    coordinateSource: "catalog",
    resolver: null,
    notes: "",
    createdAt: now,
    revision: 1,
  }
  catalog.targets[target.id] = target
  return target
}

/** The reference object whose extent contains the pointing, nearest first. */
function objectAtPointing(ra: number, dec: number) {
  let best: { name: string; separation: number } | null = null
  for (const sky of SKY_OBJECTS) {
    const separation = angularSeparationDeg(ra, dec, sky.ra, sky.dec)
    const reach = Math.max(sky.widthDeg, sky.heightDeg) / 2 + 0.5
    if (separation <= reach && (!best || separation < best.separation)) best = { name: sky.name, separation }
  }
  return best
}

/**
 * LIB-FR-05: agreeing evidence permits association; unknown or conflicting
 * evidence is Needs review; a missing OBJECT with no other evidence stays
 * unresolved. OBJECT never supplies coordinates.
 */
export function associateTarget(catalog: Catalog, session: Session, now: IsoDateTime): Association<TargetId> {
  const evidence: Evidence[] = []
  const object = session.objectLabel
  const pointed = session.pointing ? objectAtPointing(session.pointing.ra, session.pointing.dec) : null
  const objectTarget = object ? ensureTargetFor(catalog, object, now) : null
  const pointedTarget = pointed ? ensureTargetFor(catalog, pointed.name, now) : null

  if (object) {
    evidence.push({
      source: "header",
      label: "OBJECT",
      value: object,
      agrees: pointedTarget ? objectTarget?.id === pointedTarget.id : objectTarget ? null : false,
    })
  } else {
    evidence.push({ source: "header", label: "OBJECT", value: "Missing", agrees: null })
  }
  if (session.pointing && pointed) {
    evidence.push({
      source: "pointing",
      label: "Pointing",
      value: `${pointed.separation.toFixed(2)}° from ${pointed.name} centre`,
      agrees: true,
    })
  } else if (session.pointing) {
    evidence.push({ source: "pointing", label: "Pointing", value: "Outside every known Target", agrees: false })
  } else {
    evidence.push({ source: "pointing", label: "Pointing", value: "No pointing in header", agrees: null })
  }

  if (pointedTarget && (!object || objectTarget?.id === pointedTarget.id)) {
    return { value: pointedTarget.id, status: "associated", evidence, confirmedAt: null }
  }
  if (pointedTarget && object) {
    return { value: pointedTarget.id, status: "needs-review", evidence, confirmedAt: null }
  }
  if (objectTarget) {
    return { value: objectTarget.id, status: "needs-review", evidence, confirmedAt: null }
  }
  return { value: null, status: "unresolved", evidence, confirmedAt: null }
}

function findOrDetectCamera(catalog: Catalog, header: NonNullable<DiskFile["header"]>): Camera | null {
  if (!header.instrument) return null
  const existing = Object.values(catalog.cameras).find((c) => matchesName(header.instrument!, [c.name, ...c.aliases]))
  if (existing) return existing
  const camera: Camera = {
    id: `cam_${stableHash(header.instrument)}`,
    name: header.instrument,
    aliases: [],
    source: "detected",
    widthPx: header.widthPx * header.binning,
    heightPx: header.heightPx * header.binning,
    pixelSizeUm: header.pixelSizeUm ?? 0,
    color: header.bayerPattern !== null,
  }
  catalog.cameras[camera.id] = camera
  return camera
}

function trainFor(catalog: Catalog, camera: Camera, telescope: Telescope): OpticalTrain {
  const existing = Object.values(catalog.opticalTrains).find(
    (t) => t.cameraId === camera.id && t.telescopeId === telescope.id,
  )
  if (existing) return existing
  // Trains created from headers stay "detected" until Confirm equipment promotes them (D11).
  const train: OpticalTrain = {
    id: `otr_${stableHash(`${camera.id}|${telescope.id}`)}`,
    name: `${telescope.name} / ${camera.name}`,
    source: "detected",
    cameraId: camera.id,
    telescopeId: telescope.id,
    effectiveFocalLengthMm: telescope.focalLengthMm,
    notes: "",
  }
  catalog.opticalTrains[train.id] = train
  return train
}

/**
 * Equipment association (D11): explicit camera/optical-train records with
 * confirmed versus observed evidence. Unknown header strings are detected as
 * new records; a focal-length-only match is Needs review, never assumed.
 */
export function associateEquipment(catalog: Catalog, header: NonNullable<DiskFile["header"]>): Association<OpticalTrainId> {
  const evidence: Evidence[] = [
    { source: "header", label: "INSTRUME", value: header.instrument ?? "Missing", agrees: header.instrument ? true : null },
    { source: "header", label: "TELESCOP", value: header.telescope ?? "Missing", agrees: header.telescope ? true : null },
    {
      source: "header",
      label: "FOCALLEN",
      value: header.focalLengthMm ? `${header.focalLengthMm} mm` : "Missing",
      agrees: header.focalLengthMm ? true : null,
    },
  ]
  const camera = findOrDetectCamera(catalog, header)
  if (!camera) return { value: null, status: "unresolved", evidence, confirmedAt: null }

  const telescopes = Object.values(catalog.telescopes)
  const named = header.telescope
    ? telescopes.find((t) => matchesName(header.telescope!, [t.name, ...t.aliases]))
    : undefined
  if (named) {
    const train = trainFor(catalog, camera, named)
    evidence.push({ source: "equipment-record", label: "Optical train", value: train.name, agrees: true })
    return { value: train.id, status: "associated", evidence, confirmedAt: null }
  }
  const byFocal = header.focalLengthMm
    ? telescopes.find((t) => Math.abs(t.focalLengthMm - header.focalLengthMm!) / t.focalLengthMm < 0.02)
    : undefined
  if (byFocal) {
    const train = trainFor(catalog, camera, byFocal)
    const telescopeEvidence = evidence[1]!
    telescopeEvidence.agrees = false
    evidence.push({
      source: "equipment-record",
      label: "Optical train",
      value: `${train.name} (focal length matches, telescope name does not)`,
      agrees: null,
    })
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
    const train = trainFor(catalog, camera, telescope)
    evidence.push({ source: "equipment-record", label: "Optical train", value: `${train.name} (detected)`, agrees: true })
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

/**
 * Read a batch of files of one location into the catalog. Existing assets
 * keep their identity, session and decisions; changed bytes update the
 * fingerprint, which makes earlier quality decisions "changed content". A
 * byte-identical file found elsewhere becomes another copy of its asset.
 * When one copy's bytes change while another copy keeps the recorded bytes,
 * the asset keeps its identity and the pair reads as conflicting copies
 * (LIB-AC-15): both stay registered and neither is used in place of the
 * other until their bytes agree again (D19).
 * Returns a new catalog object (collections are shallow-copied).
 */
export function readFiles(source: Catalog, location: Location, files: DiskFile[], now: IsoDateTime): Catalog {
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
  const keyToSession = new Map<string, SessionId>()
  const takenSessionIds = new Set<SessionId>()
  for (const session of Object.values(catalog.sessions)) {
    // A session whose frames are all retired never absorbs new files (D11).
    const retired =
      session.assetIds.length > 0 &&
      session.assetIds.every((id) => {
        const asset = catalog.assets[id]
        return asset !== undefined && isRetiredAsset(catalog, asset)
      })
    if (!session.supersededBy && !retired) keyToSession.set(sessionKeyOf(session), session.id)
    takenSessionIds.add(session.id)
    for (const previous of session.previousSessionIds) takenSessionIds.add(previous)
    if (session.supersededBy) takenSessionIds.add(session.supersededBy)
  }
  const touched = new Set<SessionId>()

  for (const file of files) {
    const header = file.header!
    const copy: AssetCopy = { locationId: location.id, volumeId: file.volumeId, path: file.path, sha256: file.sha256, presence: "observed", lastObservedAt: now }
    const existing = assetForFile(catalog, location, file)
    if (existing) {
      const known = existing.copies.some((c) => c.locationId === location.id && c.path === file.path)
      const copies = known
        ? existing.copies.map((c) => (c.locationId === location.id && c.path === file.path ? copy : c))
        : [...existing.copies, copy]
      // Re-reading the bytes finishes any pending verification of this decision.
      const quality = existing.quality.verificationPending ? { ...existing.quality, verificationPending: false } : existing.quality
      // The identity follows the bytes only while every copy outside a retired location agrees.
      const agreed = copies.every((c) => c.sha256 === file.sha256 || catalog.locations[c.locationId]?.retiredAt)
      catalog.assets[existing.id] = agreed ? { ...existing, sha256: file.sha256, sizeBytes: file.sizeBytes, copies, quality } : { ...existing, copies, quality }
      continue
    }
    // A retired asset can hold this path's id; a re-registered file gets its own.
    const pathId = assetIdForPath(file.path)
    const id = catalog.assets[pathId] ? assetIdForPath(`${location.id}|${file.path}`) : pathId
    const isMaster = header.imageType.startsWith("master-")
    if (isMaster && location.role === "calibration") {
      // Masters stored in a Calibration location are library masters.
      // Generated masters found elsewhere stay candidates until adopted (CAL-FR-06).
      const masterId = `mst_${stableHash(file.path)}`
      catalog.masters[masterId] = {
        id: masterId,
        kind: header.imageType.slice("master-".length) as CalibrationKind,
        path: file.path,
        cameraName: header.instrument,
        widthPx: header.widthPx,
        heightPx: header.heightPx,
        binning: header.binning,
        gain: header.gain,
        offset: header.offset,
        exposureS: header.imageType === "master-dark" ? header.exposureS : null,
        channel: header.filter,
        opticalTrainId: null,
        ccdTempC: header.ccdTempC,
        frameCount: null,
        createdAt: header.dateObs,
        state: "adopted",
        origin: { kind: "library", viewId: null, sourcePath: file.path },
        adoption: null,
      }
    }
    const key = groupingKey(file)
    let sessionId = isMaster ? undefined : keyToSession.get(key)
    if (!sessionId && !isMaster) {
      sessionId = freshSessionId(key, takenSessionIds)
      takenSessionIds.add(sessionId)
      keyToSession.set(key, sessionId)
      catalog.sessions[sessionId] = {
        id: sessionId,
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
        pointing: null,
        target: { value: null, status: "unresolved", evidence: [], confirmedAt: null },
        equipment: { value: null, status: "unresolved", evidence: [], confirmedAt: null },
        corrections: [],
        previousSessionIds: [],
        supersededBy: null,
        scope: "provisional",
      }
    }
    if (sessionId) {
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
    }
  }
  for (const sessionId of touched) catalog.sessions[sessionId] = rebuildSession(catalog, catalog.sessions[sessionId]!, now)
  return catalog
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

/** Synchronous full index of the given locations (seed construction). */
export function indexLocationsSync(source: Catalog, disk: Disk, locationIds: string[], now: IsoDateTime): Catalog {
  let catalog = source
  for (const locationId of locationIds) {
    const location = catalog.locations[locationId]
    if (!location) continue
    const listing = listLocation(disk, location)
    if (listing.offline) continue
    catalog = readFiles(catalog, location, listing.readable, now)
    catalog = settleLocationScan(catalog, disk, locationId, new Set(listing.readable.map((f) => f.path)), now)
  }
  return catalog
}
