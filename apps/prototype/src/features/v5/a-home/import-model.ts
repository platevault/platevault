/**
 * S13 Import model (slice A): the pure import plan the sheet previews and
 * the operation runs (D-W11, D-W12, D-W20, D-W24), plus the new-frame counts
 * the Removable devices and Saved sources rows show.
 *
 * The plan sorts every file under the source into exactly one bucket:
 * - a destination, resolved from the per-type naming template: lights go to
 *   Captures and become sessions, each filed under the Target it confirms
 *   (P-IMP2: prefilled from pointing, the footprint that contains it with the
 *   nearest centre; OBJECT is only a hint; Unclassified files it under the
 *   Unclassified folder); raw calibration frames go to Calibration
 *   (`Raw/…`) and each new raw session becomes a calibration process awaiting
 *   Stack (P-CAL3, routed by `readFiles`); a master stacked elsewhere goes
 *   straight to structured calibration storage (`masterStoragePath`) and is a
 *   library master;
 * - a hold: Unclassified (no frame type; typing it releases it) or still
 *   being written (held until it settles);
 * - a skip: a byte-identical duplicate of a library frame (SHA-256), a file
 *   already imported from this saved source (Import new), a non-image file,
 *   or a destination name already taken by different bytes.
 * Blockers are terse chips ("Astro-T7 offline"). Nothing here writes state.
 *
 * Merge framings imports a capture's framings as one session, and Re-split
 * returns the split (D-W107, LIB-AC-31). Import review previews what the
 * import's ingestion will do (`previewImport`): the same C ingestion
 * (`ingestFiles`) on a what-if copy of the library with the copies in place,
 * calibration locations first so lights see the batch's calibration, then
 * the choices made in review (`applyImportChoices`). The import operation
 * runs the same two steps on the real copies.
 */
import { type CalSource, calibrationSources, candidatesFor, confirmChoice, noChoice, PIN_KINDS, pickChoice, sourceKey } from "@/domain/calibration"
import { masterStoragePath } from "@/domain/calibration-process"
import type { World } from "@/domain/derive"
import { fileAt, freeBytes, makeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { framingOf, ingestFiles, isUnder, nightOf, sessionGroupingKey, splitByFraming, targetAtPointing } from "@/domain/indexing"
import { locationAvailability } from "@/domain/library"
import { headerNamingValues, namingTemplate, resolveNamingTemplate } from "@/domain/templates"
import type { Blocker } from "@/components/app/contracts"
import { formatBytes } from "@/lib/format"
import { m, type MessageRef, type Messages, msg, say } from "@/lib/i18n"
import type {
  AppSettings,
  AssetId,
  CalibrationKind,
  Catalog,
  Disk,
  DiskFile,
  ImageType,
  ImportSource,
  IsoDateTime,
  Location,
  LocationId,
  LocationRole,
  NamingFrameType,
  NamingToken,
  PinKind,
  Session,
  SessionId,
  TargetId,
  Volume,
} from "@/domain/types"
import type { PrototypeState } from "@/store/core"
import type { ImportCalibrationChoice, ImportDraft } from "@/store/slices/a"

export type ImportRole = Extract<LocationRole, "captures" | "calibration">

/** Frame types the user can type an Unclassified file as. */
export const TYPEABLE: ImageType[] = ["light", "flat", "dark", "bias", "dark-flat"]

/** A frame type's name, worded later (an import operation's item labels). */
export const TYPE_NAME: Record<ImageType, MessageRef> = {
  light: msg("import_type_light"),
  dark: msg("import_type_dark"),
  flat: msg("import_type_flat"),
  bias: msg("import_type_bias"),
  "dark-flat": msg("calibration_kind_dark_flat"),
  "master-dark": msg("import_type_master_dark"),
  "master-flat": msg("import_type_master_flat"),
  "master-bias": msg("calibration_caption_bias"),
  "master-dark-flat": msg("import_type_master_dark_flat"),
  unknown: msg("import_type_unclassified"),
}

/** A frame type's name, for the sheet. */
export function typeLabel(m: Messages, type: ImageType): string {
  return say(m, TYPE_NAME[type])
}

/** Where an imported frame ends up: a light session, a calibration process awaiting Stack, or a library master. */
export type ImportRoute = "sessions" | "stack" | "masters"

export function routeLabel(m: Messages, route: ImportRoute): string {
  const label: Record<ImportRoute, () => string> = {
    sessions: m.nav_sessions,
    stack: m.import_route_stack,
    masters: m.import_route_masters,
  }
  return label[route]()
}

export function routeFor(type: ImageType): ImportRoute {
  if (type === "light") return "sessions"
  return type.startsWith("master-") ? "masters" : "stack"
}

export interface PlanItem {
  file: DiskFile
  /** Effective frame type: the header's, or the one the user typed. */
  type: ImageType
  typed: boolean
  role: ImportRole
  location: Location
  /** Absolute destination folder, ending in "/". */
  destFolder: string
  destPath: string
  fallbacks: NamingToken[]
  /** The incoming session a light belongs to; null for calibration frames and masters. */
  session: IncomingSession | null
}

/** A Target an incoming session files under. */
export interface TargetChoice {
  id: TargetId
  name: string
}

/** An incoming light session (P-IMP2): its frames, grouped and split by framing as indexing does (LIB-AC-31), file under its Target. */
export interface IncomingSession {
  /** The session grouping key, with its framing after the first; the draft's Target and calibration choices are keyed by it. */
  key: string
  /** The capture's grouping key, shared by its framings: Merge framings and Re-split act on it. */
  captureKey: string
  /** 1 for the capture key's first framing, 2 for "framing 2" and so on (D-W107). */
  framing: number
  /** How many framings the capture splits into by the Settings margins; above 1 it can be merged. */
  framings: number
  /** The user merged the capture's framings: one session for all of them. */
  merged: boolean
  /** Frames with no RA/DEC: they never split and stay in this session [PROVISIONAL, C's rule]. */
  unpointed: number
  /** OBJECT: a hint only, never the Target. */
  objectLabel: string | null
  /** The Target whose footprint contains the session's pointing (nearest centre); null without one. */
  suggested: TargetChoice | null
  /** Where the frames file and what Import confirms; null files them as Unclassified. */
  target: TargetChoice | null
}

export interface DestinationGroup {
  key: string
  role: ImportRole
  route: ImportRoute
  location: Location
  /** Folder relative to the location root, as the template resolved it. */
  relative: string
  type: ImageType
  items: PlanItem[]
  bytes: number
  fallbacks: NamingToken[]
  /** Light groups are one incoming session each, so each carries its own Target. */
  session: IncomingSession | null
}

export interface UnclassifiedHold {
  /** Source folder the files share. */
  folder: string
  files: DiskFile[]
  objectLabel: string | null
}

export interface DestinationCheck {
  role: ImportRole
  location: Location | null
  volume: Volume | null
  neededBytes: number
  freeBytes: number
  writable: boolean
  /** Why this destination refuses the import, as a chip ("Cold-1 offline"); null when it is ready. */
  problem: string | null
}

export interface ImportPlan {
  sourcePath: string
  sourceLabel: string
  saved: ImportSource | null
  volume: Volume | null
  /** The source folder is on a mounted volume. */
  online: boolean
  /** Every folder the batch reads: the source, then the folders added to it ("Add calibration files…"). */
  folders: Array<{ path: string; extra: boolean; online: boolean }>
  items: PlanItem[]
  groups: DestinationGroup[]
  held: { unclassified: UnclassifiedHold[]; settling: DiskFile[] }
  skipped: {
    duplicate: Array<{ file: DiskFile; assetId: AssetId; sessionId: SessionId | null }>
    imported: DiskFile[]
    notImage: DiskFile[]
    nameTaken: Array<{ file: DiskFile; destPath: string }>
  }
  destinations: DestinationCheck[]
  /** Move needs a writable source with an OS Trash; `reason` is a chip ("No OS Trash"). */
  move: { allowed: boolean; reason: string | null }
  bytes: number
  /** Why Import is refused, one chip each. */
  blockers: Blocker[]
}

const NAMING_TYPE: Record<Exclude<ImageType, "unknown">, NamingFrameType> = {
  light: "light",
  flat: "flat",
  dark: "dark",
  bias: "bias",
  "dark-flat": "dark",
  "master-flat": "master-flat",
  "master-dark": "master-dark",
  "master-bias": "master-bias",
  "master-dark-flat": "master-dark-flat",
}

export function roleFor(type: ImageType): ImportRole {
  return type === "light" ? "captures" : "calibration"
}

function isImage(file: DiskFile): boolean {
  return (file.kind === "fits" || file.kind === "xisf") && file.header !== null
}

function joinPath(folder: string, rel: string): string {
  const clean = rel.replace(/^\/+/, "")
  return `${folder.replace(/\/+$/, "")}/${clean}`
}

/** Locations an import can write to for a role: registered, not retired. */
export function destinationLocations(catalog: Catalog, role: ImportRole): Location[] {
  return Object.values(catalog.locations)
    .filter((l) => l.role === role && !l.retiredAt)
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

function locationWritable(disk: Disk, location: Location): { writable: boolean; problem: string | null; volume: Volume | null } {
  const volume = disk.volumes[location.volumeId] ?? null
  if (locationAvailability(disk, location) !== "online" || !volume?.mounted) return { writable: false, volume, problem: m.issue_location_offline({ name: location.displayName }) }
  if (!volume.writable) return { writable: false, volume, problem: m.import_location_read_only({ name: volume.name }) }
  if (disk.readOnlyPaths.some((p) => isUnder(location.path, p))) return { writable: false, volume, problem: m.import_no_write_permission({ name: location.displayName }) }
  if (disk.deniedPaths.some((p) => isUnder(location.path, p))) return { writable: false, volume, problem: m.folder_picker_live_denied({ name: location.displayName }) }
  return { writable: true, volume, problem: null }
}

/** What the import plan and its preview read: the library, the disk and the settings. */
export type ImportWorld = Pick<PrototypeState, "catalog" | "disk" | "settings">

/** The chosen destination, else the first writable one of the role. */
export function chosenDestination(state: ImportWorld, draft: ImportDraft, role: ImportRole): Location | null {
  const id = role === "captures" ? draft.capturesLocationId : draft.calibrationLocationId
  const all = destinationLocations(state.catalog, role)
  return all.find((l) => l.id === id) ?? all.find((l) => locationWritable(state.disk, l).writable) ?? all[0] ?? null
}

export function sourcePathOf(state: ImportWorld, draft: ImportDraft): { path: string; label: string; saved: ImportSource | null } | null {
  if (!draft.source) return null
  if (draft.source.kind === "folder") return { path: draft.source.path, label: draft.source.path, saved: savedSourceAt(state.catalog, draft.source.path) }
  const saved = state.catalog.importSources[draft.source.id]
  return saved ? { path: saved.path, label: saved.name, saved } : null
}

export function savedSourceAt(catalog: Catalog, path: string): ImportSource | null {
  return Object.values(catalog.importSources).find((s) => s.path === path) ?? null
}

/** Every SHA-256 the library already holds, with the frame that holds it. */
function librarySha(catalog: Catalog): Map<string, { assetId: AssetId; sessionId: SessionId | null }> {
  const out = new Map<string, { assetId: AssetId; sessionId: SessionId | null }>()
  for (const asset of Object.values(catalog.assets)) {
    out.set(asset.sha256, { assetId: asset.id, sessionId: asset.sessionId })
    for (const copy of asset.copies) if (!out.has(copy.sha256)) out.set(copy.sha256, { assetId: asset.id, sessionId: asset.sessionId })
  }
  return out
}

/** Image files under a connected source folder (links are followed nowhere). */
function sourceFiles(disk: Disk, volume: Volume, path: string): DiskFile[] {
  return Object.values(disk.files)
    .filter((f) => f.volumeId === volume.id && isUnder(f.path, path) && f.path !== path && !f.linkTarget)
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * New frames under a source: images the library does not hold (SHA-256) and,
 * for a saved source, not imported from it before. Held files count: they
 * are new, only not ready yet. Zero when the source is not connected.
 */
export function freshFrameCount(state: PrototypeState, path: string): number {
  const volumeId = volumeForPath(state.disk, path)
  const volume = volumeId ? state.disk.volumes[volumeId] : undefined
  if (!volume?.mounted) return 0
  const known = librarySha(state.catalog)
  const before = new Set(savedSourceAt(state.catalog, path)?.importedSha256 ?? [])
  return sourceFiles(state.disk, volume, path).filter((f) => isImage(f) && !known.has(f.sha256) && !before.has(f.sha256)).length
}

/** The source folder can be read now: its volume is mounted and the folder is not denied. Import pauses as Interrupted when it cannot. */
export function sourceOnline(disk: Disk, path: string): boolean {
  const volumeId = volumeForPath(disk, path)
  return Boolean(volumeId && disk.volumes[volumeId]?.mounted) && !disk.deniedPaths.some((p) => isUnder(path, p))
}

/** Where a planned frame is written: the type's naming template, or structured storage for a master. A light resolves `{target}` to its session's Target. */
function destinationFor(state: ImportWorld, location: Location, file: DiskFile, type: Exclude<ImageType, "unknown">, target: string | null): { destFolder: string; destPath: string; fallbacks: NamingToken[] } {
  const header = file.header!
  if (routeFor(type) === "masters") {
    const kind = type.slice("master-".length) as CalibrationKind
    const ext = file.path.slice(file.path.lastIndexOf(".") + 1)
    const destPath = masterStoragePath(location, state.settings, kind, headerNamingValues(header, type), nightOf(header.dateObs), ext)
    const resolved = resolveNamingTemplate(namingTemplate(state.settings.naming, NAMING_TYPE[type]), headerNamingValues(header, type), state.settings.namingOmit)
    return { destFolder: destPath.slice(0, destPath.lastIndexOf("/") + 1), destPath, fallbacks: resolved.fallbacks }
  }
  const resolved = resolveNamingTemplate(namingTemplate(state.settings.naming, NAMING_TYPE[type]), headerNamingValues(header, type, target), state.settings.namingOmit)
  const destFolder = joinPath(location.path, resolved.path.endsWith("/") ? resolved.path : `${resolved.path}/`)
  // Unclassified is the user's choice, not missing metadata: the Target column shows it.
  const fallbacks = type === "light" ? resolved.fallbacks.filter((t) => t !== "target") : resolved.fallbacks
  return { destFolder, destPath: `${destFolder}${file.path.slice(file.path.lastIndexOf("/") + 1)}`, fallbacks }
}

/** A light's session grouping key; a file typed as a light groups as one. */
function lightKey(file: DiskFile): string {
  return sessionGroupingKey({ ...file.header!, imageType: "light" })
}

/**
 * The incoming light sessions (P-IMP2) of each light, by file path: grouped
 * by key, then split by framing with the Settings margins as intake splits
 * them (`splitByFraming`), unless the user merged the capture's framings;
 * each prefilled with the Target its mean pointing associates, unless the
 * draft chose another Target or Unclassified (null).
 */
function incomingSessions(state: ImportWorld, draft: ImportDraft, lights: DiskFile[]): Map<string, IncomingSession> {
  const { catalog } = state
  const byKey = new Map<string, DiskFile[]>()
  for (const file of lights) byKey.set(lightKey(file), [...(byKey.get(lightKey(file)) ?? []), file])
  const out = new Map<string, IncomingSession>()
  for (const [captureKey, all] of byKey) {
    const split = splitByFraming(all, (f) => framingOf(f.header!), state.settings.matching.framing)
    const merged = split.length > 1 && draft.merged.includes(captureKey)
    ;(merged ? [all] : split).forEach((files, i) => {
      const framing = i + 1
      const key = framing === 1 ? captureKey : `${captureKey}|framing ${framing}`
      const pointed = files.map((f) => f.header!).filter((h) => h.ra !== null && h.dec !== null)
      const suggested =
        pointed.length > 0 ? targetAtPointing(catalog, pointed.reduce((n, h) => n + h.ra!, 0) / pointed.length, pointed.reduce((n, h) => n + h.dec!, 0) / pointed.length) : null
      const chosen = key in draft.targets ? draft.targets[key] : suggested?.id
      const record = chosen ? catalog.targets[chosen] : undefined
      const target = !chosen ? null : chosen === suggested?.id ? suggested : record ? { id: record.id, name: record.name } : suggested
      const session: IncomingSession = {
        key,
        captureKey,
        framing,
        framings: split.length,
        merged,
        unpointed: files.length - pointed.length,
        objectLabel: files[0]!.header!.object,
        suggested,
        target,
      }
      for (const file of files) out.set(file.path, session)
    })
  }
  return out
}

/** Why Move cannot take files from this folder (a chip, "No OS Trash"); null when it can. */
function moveRefusal(disk: Disk, path: string): string | null {
  const volumeId = volumeForPath(disk, path)
  const volume = volumeId ? disk.volumes[volumeId] : undefined
  if (!volume?.mounted) return m.import_not_connected()
  if (!volume.writable || disk.readOnlyPaths.some((p) => isUnder(path, p))) return m.import_read_only_source()
  if (volume.trash === "unsupported") return m.import_no_os_trash()
  return null
}

export function planImport(state: ImportWorld, draft: ImportDraft): ImportPlan | null {
  const source = sourcePathOf(state, draft)
  if (!source) return null
  const { disk, catalog } = state
  const volumeId = volumeForPath(disk, source.path)
  const volume = volumeId ? (disk.volumes[volumeId] ?? null) : null
  const online = sourceOnline(disk, source.path)
  const extras = draft.extraFolders.filter((path) => !isUnder(path, source.path))
  const plan: ImportPlan = {
    sourcePath: source.path,
    sourceLabel: source.label,
    saved: source.saved,
    volume,
    online,
    folders: [{ path: source.path, extra: false, online }, ...extras.map((path) => ({ path, extra: true, online: sourceOnline(disk, path) }))],
    items: [],
    groups: [],
    held: { unclassified: [], settling: [] },
    skipped: { duplicate: [], imported: [], notImage: [], nameTaken: [] },
    destinations: [],
    move: { allowed: false, reason: null },
    bytes: 0,
    blockers: [],
  }
  const destinations: Record<ImportRole, Location | null> = { captures: chosenDestination(state, draft, "captures"), calibration: chosenDestination(state, draft, "calibration") }
  // The source's files, then those of each added folder; a file two folders hold is read once.
  const read = new Map<string, DiskFile>()
  for (const folder of online ? plan.folders : []) {
    const folderVolumeId = volumeForPath(disk, folder.path)
    const folderVolume = folderVolumeId ? disk.volumes[folderVolumeId] : undefined
    if (folder.online && folderVolume) for (const file of sourceFiles(disk, folderVolume, folder.path)) if (!read.has(file.path)) read.set(file.path, file)
  }
  const files = [...read.values()]
  const known = librarySha(catalog)
  const importedBefore = draft.newOnly && source.saved ? new Set(source.saved.importedSha256) : new Set<string>()
  const unclassified = new Map<string, DiskFile[]>()
  const groups = new Map<string, DestinationGroup>()
  // Destination paths this plan already writes, so two sources never land on one name.
  const planned = new Map<string, string>()
  const accepted: Array<{ file: DiskFile; type: Exclude<ImageType, "unknown">; typed: boolean; role: ImportRole; location: Location }> = []

  for (const file of files) {
    if (!isImage(file)) {
      plan.skipped.notImage.push(file)
      continue
    }
    if (file.growing) {
      plan.held.settling.push(file)
      continue
    }
    if (importedBefore.has(file.sha256)) {
      plan.skipped.imported.push(file)
      continue
    }
    const duplicate = known.get(file.sha256)
    if (duplicate) {
      plan.skipped.duplicate.push({ file, ...duplicate })
      continue
    }
    const header = file.header!
    const typedAs = header.imageType === "unknown" ? draft.typed[file.path] : undefined
    const type = typedAs ?? header.imageType
    if (type === "unknown") {
      const folder = file.path.slice(0, file.path.lastIndexOf("/"))
      unclassified.set(folder, [...(unclassified.get(folder) ?? []), file])
      continue
    }
    const role = roleFor(type)
    const location = destinations[role]
    if (location) accepted.push({ file, type, typed: typedAs !== undefined, role, location })
  }
  // A light's folder follows its session's Target, so sessions are known before any destination.
  const sessions = incomingSessions(
    state,
    draft,
    accepted.filter((a) => a.type === "light").map((a) => a.file),
  )
  for (const { file, type, typed, role, location } of accepted) {
    const session = type === "light" ? sessions.get(file.path)! : null
    const { destFolder, destPath, fallbacks } = destinationFor(state, location, file, type, session?.target?.name ?? null)
    const existing = fileAt(disk, destPath)?.sha256 ?? planned.get(destPath)
    if (existing !== undefined && existing !== file.sha256) {
      plan.skipped.nameTaken.push({ file, destPath })
      continue
    }
    planned.set(destPath, file.sha256)
    const item: PlanItem = { file, type, typed, role, location, destFolder, destPath, fallbacks, session }
    plan.items.push(item)
    plan.bytes += file.sizeBytes
    const key = session ? `${location.id}|${session.key}` : `${location.id}|${destFolder}|${type}`
    const group = groups.get(key) ?? { key, role, route: routeFor(type), location, relative: destFolder.slice(location.path.length + 1), type, items: [], bytes: 0, fallbacks: [], session }
    group.items.push(item)
    group.bytes += file.sizeBytes
    group.fallbacks = [...new Set([...group.fallbacks, ...fallbacks])]
    groups.set(key, group)
  }
  plan.held.unclassified = [...unclassified.entries()].map(([folder, list]) => ({ folder, files: list, objectLabel: list[0]?.header?.object ?? null }))
  const routeOrder: ImportRoute[] = ["sessions", "stack", "masters"]
  plan.groups = [...groups.values()].sort((a, b) => routeOrder.indexOf(a.route) - routeOrder.indexOf(b.route) || a.relative.localeCompare(b.relative))

  for (const role of ["captures", "calibration"] as const) {
    const location = destinations[role]
    const needed = plan.items.filter((i) => i.role === role).reduce((n, i) => n + i.file.sizeBytes, 0)
    if (!location) {
      const problem = needed === 0 ? null : role === "captures" ? m.import_no_captures_location() : m.import_no_calibration_location()
      plan.destinations.push({ role, location: null, volume: null, neededBytes: needed, freeBytes: 0, writable: false, problem })
      continue
    }
    const check = locationWritable(disk, location)
    const free = check.volume ? freeBytes(disk, check.volume.id) : 0
    const problem = needed === 0 ? null : (check.problem ?? (free < needed ? m.import_space_short({ name: check.volume?.name ?? location.displayName, size: formatBytes(needed - free) }) : null))
    plan.destinations.push({ role, location, volume: check.volume, neededBytes: needed, freeBytes: free, writable: check.writable, problem })
  }

  // Move sends every source it copied to the OS Trash, so each folder the batch reads must allow it.
  const refusal = plan.folders.map((f) => moveRefusal(disk, f.path)).find((r) => r !== null) ?? null
  plan.move = refusal ? { allowed: false, reason: refusal } : { allowed: true, reason: null }

  if (!online) plan.blockers.push({ label: volume?.mounted ? m.folder_picker_live_denied({ name: source.label }) : m.import_source_not_connected({ name: source.label }) })
  else if (plan.items.length === 0) plan.blockers.push({ label: plan.held.unclassified.length > 0 || plan.held.settling.length > 0 ? m.import_only_held() : m.import_nothing_new() })
  for (const folder of plan.folders) if (folder.extra && !folder.online) plan.blockers.push({ label: m.import_source_not_connected({ name: folder.path }) })
  for (const d of plan.destinations) if (d.problem) plan.blockers.push({ label: d.problem })
  if (draft.mode === "move" && !plan.move.allowed && plan.move.reason) plan.blockers.push({ label: m.import_move_blocked({ reason: plan.move.reason }) })
  return plan
}

// ---------------------------------------------------------------------------
// Ingestion: what Import does once its copies verified, previewed in review
// ---------------------------------------------------------------------------

/** Margins under which every frame of a capture is one framing (a rotation difference is at most 90°): a merged capture imports as one session (D-W107). */
const ONE_FRAMING = { centrePct: Number.POSITIVE_INFINITY, rotationDeg: 90 }

/** The verified copy Import writes at `dest`: the source's bytes and header. */
export function copiedFile(source: DiskFile, dest: string, volumeId: Volume["id"], at: IsoDateTime): DiskFile {
  return makeFile({ path: dest, volumeId, sizeBytes: source.sizeBytes, kind: source.kind, header: source.header, pixelTruth: source.pixelTruth, sha256: source.sha256, modifiedAt: at })
}

/** One file the import wrote: where, read as which type, and whether its capture's framings were merged. */
export interface ImportedEntry {
  dest: string
  locationId: LocationId
  type: ImageType
  merged: boolean
}

/** Copies of one location read in one ingestion; a merged capture's lights come in a batch of their own. */
export interface ImportBatch {
  location: Location
  files: DiskFile[]
  merged: boolean
}

/** The ingestion batches of the copies on `disk`. A typed Unclassified file is read as the type the user gave it. */
export function importBatches(catalog: Catalog, disk: Disk, entries: ImportedEntry[]): ImportBatch[] {
  const batches = new Map<string, ImportBatch>()
  for (const entry of entries) {
    const location = catalog.locations[entry.locationId]
    const file = fileAt(disk, entry.dest)
    if (!location || !file?.header) continue
    const key = `${location.id}|${entry.merged}`
    const batch = batches.get(key) ?? { location, files: [], merged: entry.merged }
    batch.files.push({ ...file, header: { ...file.header, imageType: entry.type } })
    batches.set(key, batch)
  }
  return [...batches.values()]
}

/**
 * Read the import's copies into the library through C's ingestion
 * (`ingestFiles`, which matches calibration after each batch): calibration
 * locations first, so lights are matched against the batch's calibration as
 * well as the library's, then captures, merged captures last with every
 * frame in one framing. Import never waits for calibration: whatever stays
 * unsettled waits in Needs calibration (LIB-FR-23).
 */
export function ingestImport(catalog: Catalog, disk: Disk, settings: Pick<AppSettings, "matching">, batches: ImportBatch[], at: IsoDateTime): Catalog {
  const order = (b: ImportBatch) => (b.location.role === "captures" ? 1 : 0) + (b.merged ? 1 : 0)
  const oneFraming = { matching: { ...settings.matching, framing: { ...settings.matching.framing, ...ONE_FRAMING } } }
  return [...batches]
    .filter((b) => b.files.length > 0)
    .sort((a, b) => order(a) - order(b))
    .reduce((next, b) => ingestFiles(next, disk, b.merged ? oneFraming : settings, b.location, b.files, at), catalog)
}

/** Calibration chosen in review for one incoming session, by kind. */
export type ImportChoices = Partial<Record<PinKind, ImportCalibrationChoice>>

/**
 * The calibration chosen in import review, applied to the sessions the
 * import filled (LIB-FR-23): Confirm turns the kind's suggestion into the
 * user's pin (`confirmChoice`; any other state stays), No settles it with no
 * reason, and Choose pins the picked source while it is still offered. A
 * kind with no choice keeps what matching gave it.
 */
export function applyImportChoices(catalog: Catalog, disk: Disk, settings: Pick<AppSettings, "matching">, picks: Array<{ sessionId: SessionId; choices: ImportChoices }>, at: IsoDateTime): Catalog {
  let sources: CalSource[] | null = null
  let sessions: Catalog["sessions"] | null = null
  for (const { sessionId, choices } of picks) {
    const session = catalog.sessions[sessionId]
    if (!session?.calibration) continue
    let calibration = session.calibration
    for (const kind of PIN_KINDS) {
      const choice = choices[kind]
      if (!choice) continue
      const current = calibration[kind]
      let next = current
      if (choice.state === "confirm") next = confirmChoice(current, at)
      else if (choice.state === "none") next = noChoice(at)
      else {
        sources ??= calibrationSources(catalog, disk)
        const key = sourceKey(choice.source)
        const candidate = candidatesFor(catalog, settings, session, kind, sources).find((c) => c.source.key === key)
        if (candidate) next = pickChoice(candidate, at)
      }
      if (next !== current) calibration = { ...calibration, [kind]: next }
    }
    if (calibration === session.calibration) continue
    sessions ??= { ...catalog.sessions }
    sessions[sessionId] = { ...session, calibration }
  }
  return sessions ? { ...catalog, sessions } : catalog
}

/** The session each copy at these paths was read into. */
export function sessionsAt(catalog: Catalog, paths: ReadonlySet<string>): Map<string, SessionId> {
  const out = new Map<string, SessionId>()
  for (const asset of Object.values(catalog.assets)) {
    if (!asset.sessionId) continue
    for (const copy of asset.copies) if (paths.has(copy.path)) out.set(copy.path, asset.sessionId)
  }
  return out
}

/** The incoming sessions' calibration choices from the draft, against the sessions their frames landed in. */
export function choicePicks(items: ReadonlyArray<{ destPath: string; sessionKey: string | null }>, landed: Map<string, SessionId>, calibration: ImportDraft["calibration"]): Array<{ sessionId: SessionId; choices: ImportChoices }> {
  const out = new Map<SessionId, ImportChoices>()
  for (const item of items) {
    const sessionId = landed.get(item.destPath)
    const choices = item.sessionKey ? calibration[item.sessionKey] : undefined
    if (sessionId && choices && !out.has(sessionId)) out.set(sessionId, choices)
  }
  return [...out].map(([sessionId, choices]) => ({ sessionId, choices }))
}

export interface ImportPreview {
  /** The library once the import ran, its copies in place: a what-if, never written. */
  world: Pick<World, "catalog" | "disk" | "settings">
  /** The session each incoming light session becomes, by its key. */
  sessionOf: Map<string, SessionId>
  /** Per calibration destination group (by key): the light sessions its sets would calibrate, those that wait and the incoming ones ("Used for"). */
  usedFor: Map<string, Session[]>
}

/**
 * What the import's ingestion will do, for import review: the same steps the
 * operation runs (`ingestImport`, then `applyImportChoices`) on a what-if
 * copy of the library with the copies written. Each incoming session shows
 * its darks, flats and bias as matching leaves them (pinned automatically,
 * suggested or not found) and each calibration set what it would calibrate.
 */
export function previewImport(state: ImportWorld, plan: ImportPlan, draft: ImportDraft, at: IsoDateTime): ImportPreview {
  const disk = writeFiles(
    state.disk,
    plan.items.map((i) => copiedFile(i.file, i.destPath, i.location.volumeId, at)),
  )
  const entries = plan.items.map((i): ImportedEntry => ({ dest: i.destPath, locationId: i.location.id, type: i.type, merged: i.session?.merged ?? false }))
  const ingested = ingestImport(state.catalog, disk, state.settings, importBatches(state.catalog, disk, entries), at)
  const landed = sessionsAt(ingested, new Set(plan.items.map((i) => i.destPath)))
  const items = plan.items.map((i) => ({ destPath: i.destPath, sessionKey: i.session?.key ?? null }))
  const catalog = applyImportChoices(ingested, disk, state.settings, choicePicks(items, landed, draft.calibration), at)
  const sessionOf = new Map<string, SessionId>()
  for (const item of plan.items) {
    const id = landed.get(item.destPath)
    if (item.session && id && !sessionOf.has(item.session.key)) sessionOf.set(item.session.key, id)
  }
  const usedFor = new Map<string, Session[]>()
  for (const group of plan.groups) {
    if (group.route === "sessions") continue
    const keys = new Set(group.items.flatMap((i) => batchSourceKeys(catalog, i.destPath, landed.get(i.destPath))))
    usedFor.set(group.key, sessionsCalibratedBy(state.catalog, catalog, keys))
  }
  return { world: { catalog, disk, settings: state.settings }, sessionOf, usedFor }
}

/** The calibration source a copy became: the master version at its path, or the raw calibration session it joined. */
function batchSourceKeys(catalog: Catalog, path: string, sessionId: SessionId | undefined): string[] {
  for (const master of Object.values(catalog.masters)) {
    const version = master.versions.find((v) => v.path === path)
    if (version) return [sourceKey({ type: "master", masterId: master.id, versionId: version.id })]
  }
  const session = sessionId ? catalog.sessions[sessionId] : undefined
  return session && session.imageType !== "light" ? [sourceKey({ type: "raw", sessionId: session.id })] : []
}

/** Light sessions whose pin or suggestion for a kind comes from these sources after the import and did not before: what a new set would calibrate. */
function sessionsCalibratedBy(before: Catalog, after: Catalog, keys: ReadonlySet<string>): Session[] {
  if (keys.size === 0) return []
  return Object.values(after.sessions)
    .filter((s) => {
      if (s.imageType !== "light" || s.supersededBy || !s.calibration) return false
      return PIN_KINDS.some((kind) => {
        const choice = s.calibration![kind]
        if ((choice.state !== "pinned" && choice.state !== "suggested") || !keys.has(sourceKey(choice.source))) return false
        const earlier = before.sessions[s.id]?.calibration?.[kind]
        return !earlier || ((earlier.state !== "pinned" && earlier.state !== "suggested") || sourceKey(earlier.source) !== sourceKey(choice.source))
      })
    })
    .sort((a, b) => a.night.localeCompare(b.night) || (a.channel ?? "").localeCompare(b.channel ?? ""))
}

/** The draft's choices for an incoming session after one kind is set; `null` clears it back to matching. */
export function withChoice(calibration: ImportDraft["calibration"], sessionKey: string, kind: PinKind, choice: ImportCalibrationChoice | null): ImportDraft["calibration"] {
  const { [kind]: _dropped, ...rest } = calibration[sessionKey] ?? {}
  const next: ImportChoices = choice ? { ...rest, [kind]: choice } : rest
  return { ...calibration, [sessionKey]: next }
}
