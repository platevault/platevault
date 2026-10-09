/**
 * S13 Import model (slice A): the pure import plan the sheet previews and
 * the operation runs (D-W11, D-W12, D-W20, D-W24), plus the simulated
 * ASIAIR card the demo's saved source points at.
 *
 * The plan sorts every file under the source into exactly one bucket:
 * - a destination in Captures (lights) or Calibration (everything else),
 *   resolved from the per-type naming template;
 * - a hold: Unclassified (no frame type; typing it releases it) or still
 *   being written (held until it settles);
 * - a skip: a byte-identical duplicate of a library frame (SHA-256), a file
 *   already imported from this saved source (Import new), a non-image file,
 *   or a destination name already taken by different bytes.
 * Nothing here writes state except `insertCard` and `settleGrowingFiles`,
 * which change the simulated world outside PlateVault.
 */
import { fileAt, freeBytes, makeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { isUnder, nightOf, stableHash } from "@/domain/indexing"
import { locationAvailability } from "@/domain/library"
import { namingTemplate, resolveNamingTemplate, type NamingValues } from "@/domain/templates"
import type {
  AssetId,
  Catalog,
  Disk,
  DiskFile,
  FrameHeader,
  ImageType,
  ImportSource,
  Location,
  LocationRole,
  NamingFrameType,
  NamingToken,
  SessionId,
  Volume,
} from "@/domain/types"
import { nowIso, type PrototypeState, store } from "@/store/core"
import type { ImportDraft } from "@/store/slices/a"

export type ImportRole = Extract<LocationRole, "captures" | "calibration">

/** Frame types the user can type an Unclassified file as. */
export const TYPEABLE: Array<{ value: ImageType; label: string }> = [
  { value: "light", label: "Light" },
  { value: "flat", label: "Flat" },
  { value: "dark", label: "Dark" },
  { value: "bias", label: "Bias" },
  { value: "dark-flat", label: "Dark flat" },
]

export const TYPE_LABEL: Record<ImageType, string> = {
  light: "Light",
  dark: "Dark",
  flat: "Flat",
  bias: "Bias",
  "dark-flat": "Dark flat",
  "master-dark": "Master dark",
  "master-flat": "Master flat",
  "master-bias": "Master bias",
  unknown: "Unclassified",
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
}

export interface DestinationGroup {
  key: string
  role: ImportRole
  location: Location
  /** Folder relative to the location root, as the template resolved it. */
  relative: string
  type: ImageType
  items: PlanItem[]
  bytes: number
  fallbacks: NamingToken[]
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
  /** Why this destination refuses the import; null when it is ready. */
  problem: string | null
}

export interface ImportPlan {
  sourcePath: string
  sourceLabel: string
  saved: ImportSource | null
  volume: Volume | null
  /** The source folder is on a mounted volume. */
  online: boolean
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
  move: { allowed: boolean; reason: string | null }
  bytes: number
  /** Reasons the Import button is refused, each naming its fix. */
  blockers: string[]
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
}

export function roleFor(type: ImageType): ImportRole {
  return type === "light" ? "captures" : "calibration"
}

function isImage(file: DiskFile): boolean {
  return (file.kind === "fits" || file.kind === "xisf") && file.header !== null
}

function namingValues(header: FrameHeader, type: ImageType): NamingValues {
  return {
    target: header.object,
    filter: header.filter,
    date: header.dateObs ? nightOf(header.dateObs) : null,
    frame_type: type,
    camera: header.instrument,
    exposure: `${Number(header.exposureS.toPrecision(6))}s`,
    gain: header.gain === null ? null : String(header.gain),
    binning: `${header.binning}x${header.binning}`,
    set_temp: header.ccdTempC === null ? null : `${Math.round(header.ccdTempC)}C`,
  }
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
  if (locationAvailability(disk, location) !== "online" || !volume?.mounted) return { writable: false, volume, problem: `${location.displayName} is offline: connect ${volume?.name ?? "its volume"} or choose another location` }
  if (!volume.writable) return { writable: false, volume, problem: `${volume.name} is read-only: choose another ${location.role} location` }
  if (disk.readOnlyPaths.some((p) => isUnder(location.path, p))) return { writable: false, volume, problem: `${location.displayName} has no write permission: choose another location` }
  if (disk.deniedPaths.some((p) => isUnder(location.path, p))) return { writable: false, volume, problem: `${location.displayName} is access-denied: choose another location` }
  return { writable: true, volume, problem: null }
}

/** The chosen destination, else the first writable one of the role. */
export function chosenDestination(state: PrototypeState, draft: ImportDraft, role: ImportRole): Location | null {
  const id = role === "captures" ? draft.capturesLocationId : draft.calibrationLocationId
  const all = destinationLocations(state.catalog, role)
  return all.find((l) => l.id === id) ?? all.find((l) => locationWritable(state.disk, l).writable) ?? all[0] ?? null
}

export function sourcePathOf(state: PrototypeState, draft: ImportDraft): { path: string; label: string; saved: ImportSource | null } | null {
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

export function planImport(state: PrototypeState, draft: ImportDraft): ImportPlan | null {
  const source = sourcePathOf(state, draft)
  if (!source) return null
  const { disk, catalog, settings } = state
  const volumeId = volumeForPath(disk, source.path)
  const volume = volumeId ? (disk.volumes[volumeId] ?? null) : null
  const online = Boolean(volume?.mounted) && !disk.deniedPaths.some((p) => isUnder(source.path, p))
  const plan: ImportPlan = {
    sourcePath: source.path,
    sourceLabel: source.label,
    saved: source.saved,
    volume,
    online,
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
  const files = online && volume ? Object.values(disk.files).filter((f) => f.volumeId === volume.id && isUnder(f.path, source.path) && f.path !== source.path && !f.linkTarget).sort((a, b) => a.path.localeCompare(b.path)) : []
  const known = librarySha(catalog)
  const importedBefore = draft.newOnly && source.saved ? new Set(source.saved.importedSha256) : new Set<string>()
  const unclassified = new Map<string, DiskFile[]>()
  const groups = new Map<string, DestinationGroup>()

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
    if (!location) continue
    const resolved = resolveNamingTemplate(namingTemplate(settings.naming, NAMING_TYPE[type]), namingValues(header, type))
    const destFolder = joinPath(location.path, resolved.path.endsWith("/") ? resolved.path : `${resolved.path}/`)
    const destPath = `${destFolder}${file.path.slice(file.path.lastIndexOf("/") + 1)}`
    const existing = fileAt(disk, destPath)
    if (existing && existing.sha256 !== file.sha256) {
      plan.skipped.nameTaken.push({ file, destPath })
      continue
    }
    const item: PlanItem = { file, type, typed: typedAs !== undefined, role, location, destFolder, destPath, fallbacks: resolved.fallbacks }
    plan.items.push(item)
    plan.bytes += file.sizeBytes
    const key = `${location.id}|${destFolder}|${type}`
    const group = groups.get(key) ?? { key, role, location, relative: destFolder.slice(location.path.length + 1), type, items: [], bytes: 0, fallbacks: [] }
    group.items.push(item)
    group.bytes += file.sizeBytes
    group.fallbacks = [...new Set([...group.fallbacks, ...resolved.fallbacks])]
    groups.set(key, group)
  }
  plan.held.unclassified = [...unclassified.entries()].map(([folder, list]) => ({ folder, files: list, objectLabel: list[0]?.header?.object ?? null }))
  plan.groups = [...groups.values()].sort((a, b) => a.role.localeCompare(b.role) || a.relative.localeCompare(b.relative))

  for (const role of ["captures", "calibration"] as const) {
    const location = destinations[role]
    const needed = plan.items.filter((i) => i.role === role).reduce((n, i) => n + i.file.sizeBytes, 0)
    if (!location) {
      plan.destinations.push({ role, location: null, volume: null, neededBytes: needed, freeBytes: 0, writable: false, problem: needed > 0 ? `No ${role === "captures" ? "Captures" : "Calibration"} location: add one in Settings › Locations` : null })
      continue
    }
    const check = locationWritable(disk, location)
    const free = check.volume ? freeBytes(disk, check.volume.id) : 0
    const problem = needed === 0 ? null : (check.problem ?? (free < needed ? `${check.volume?.name ?? location.displayName} has ${formatGb(free)} free; this import needs ${formatGb(needed)}` : null))
    plan.destinations.push({ role, location, volume: check.volume, neededBytes: needed, freeBytes: free, writable: check.writable, problem })
  }

  if (!volume?.mounted) plan.move = { allowed: false, reason: "The source is not connected" }
  else if (!volume.writable || disk.readOnlyPaths.some((p) => isUnder(source.path, p))) plan.move = { allowed: false, reason: `${volume.name} is read-only, so its files cannot go to the OS Trash. Copy works.` }
  else if (volume.trash === "unsupported") plan.move = { allowed: false, reason: `${volume.name} has no OS Trash, and PlateVault never deletes permanently. Copy works.` }
  else plan.move = { allowed: true, reason: null }

  if (!online) plan.blockers.push(volume?.mounted ? `${source.label} is access-denied: choose another folder` : `${source.label} is not connected`)
  else if (plan.items.length === 0) plan.blockers.push(plan.held.unclassified.length > 0 ? "Nothing to import yet: type the Unclassified files or wait for held files to settle" : "Nothing new to import from this source")
  for (const d of plan.destinations) if (d.problem) plan.blockers.push(d.problem)
  if (draft.mode === "move" && !plan.move.allowed && plan.move.reason) plan.blockers.push(`Move is unavailable: ${plan.move.reason}`)
  return plan
}

function formatGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`
}

// ---------------------------------------------------------------------------
// The simulated ASIAIR card behind the demo's saved source "ASIAIR SD card".
// Inserting it is a change to the world outside PlateVault (the OS mounts it).
// ---------------------------------------------------------------------------

export const CARD_VOLUME: Volume = {
  id: "vol_asiair",
  name: "ASIAIR",
  mountPath: "/Volumes/ASIAIR",
  volumeUuid: "A51A-0001",
  mounted: true,
  writable: true,
  trash: "supported",
  capacityBytes: 128_000_000_000,
  links: { symlink: false, hardlink: false, clone: false },
  network: false,
}

const REDCAT_HEADER: Omit<FrameHeader, "imageType" | "object" | "filter" | "exposureS" | "dateObs" | "ra" | "dec" | "rotationDeg"> = {
  instrument: "ZWO ASI2600MM Pro",
  telescope: "RedCat 51",
  focalLengthMm: 250,
  binning: 1,
  gain: 100,
  offset: 50,
  ccdTempC: -10,
  widthPx: 6248,
  heightPx: 4176,
  pixelSizeUm: 3.76,
  bayerPattern: null,
  siteLat: 52.09,
  siteLon: 5.12,
}

const FRAME_BYTES = 6248 * 4176 * 2 + 11_520

interface CardSet {
  dir: string
  prefix: string
  count: number
  start: string
  type: ImageType
  object: string | null
  filter: string | null
  exposureS: number
  pointing: { ra: number; dec: number } | null
  /** The last file is still being written by the capture device. */
  lastGrowing?: boolean
}

function cardSet(spec: CardSet): DiskFile[] {
  const start = Date.parse(spec.start)
  return Array.from({ length: spec.count }, (_, i) => {
    const dateObs = new Date(start + i * (spec.exposureS + 12) * 1000).toISOString()
    const path = `${CARD_VOLUME.mountPath}/${spec.dir}/${spec.prefix}_${String(i + 1).padStart(4, "0")}.fit`
    const jitter = (Number.parseInt(stableHash(path), 36) % 100) / 100
    return makeFile({
      path,
      volumeId: CARD_VOLUME.id,
      sizeBytes: FRAME_BYTES,
      kind: "fits",
      header: {
        ...REDCAT_HEADER,
        imageType: spec.type,
        object: spec.object,
        filter: spec.filter,
        exposureS: spec.exposureS,
        dateObs,
        ra: spec.pointing ? spec.pointing.ra + (jitter - 0.5) * 0.02 : null,
        dec: spec.pointing ? spec.pointing.dec + (jitter - 0.5) * 0.02 : null,
        rotationDeg: spec.pointing ? 90 : null,
      },
      pixelTruth: spec.type === "light" ? { fwhmPx: 2.4 + jitter * 0.6, eccentricity: 0.36 + jitter * 0.12, starCount: 1500 + Math.round(jitter * 600), background: 820 + jitter * 120, saturatedStars: Math.round(jitter * 3), invalidSamples: 0, trailed: false } : null,
      growing: spec.lastGrowing === true && i === spec.count - 1,
      modifiedAt: dateObs,
    })
  })
}

const NGC7000 = { ra: 314.75, dec: 44.53 }

/** The card's files: new NGC 7000 lights, flats, a type-less set, a file still being written and library duplicates. */
function cardFiles(disk: Disk): DiskFile[] {
  const files = [
    ...cardSet({ dir: "Autorun/Light/NGC 7000", prefix: "Light_NGC7000_300s_Ha_20261006", count: 16, start: "2026-10-06T19:30:00Z", type: "light", object: "NGC 7000", filter: "Ha", exposureS: 300, pointing: NGC7000, lastGrowing: true }),
    ...cardSet({ dir: "Autorun/Light/NGC 7000", prefix: "Light_NGC7000_300s_OIII_20261006", count: 12, start: "2026-10-06T21:10:00Z", type: "light", object: "NGC 7000", filter: "OIII", exposureS: 300, pointing: NGC7000 }),
    ...cardSet({ dir: "Autorun/Flat", prefix: "Flat_RedCat_Ha_20261007", count: 20, start: "2026-10-07T05:20:00Z", type: "flat", object: null, filter: "Ha", exposureS: 1.5, pointing: null }),
    // IMAGETYP missing: the files are held as Unclassified until typed.
    ...cardSet({ dir: "Plan/M 33", prefix: "Capture_M33_120s_L_20261006", count: 6, start: "2026-10-06T23:40:00Z", type: "unknown", object: "M 33", filter: "L", exposureS: 120, pointing: { ra: 23.462, dec: 30.66 } }),
    makeFile({ path: `${CARD_VOLUME.mountPath}/Log/Autorun_Log_2026-10-06.txt`, volumeId: CARD_VOLUME.id, sizeBytes: 48_200, kind: "text", modifiedAt: "2026-10-07T05:40:00Z" }),
  ]
  // The 2 Oct Ha session was imported from this card before and is still on it: byte-identical duplicates.
  const earlier = Object.values(disk.files)
    .filter((f) => f.path.startsWith("/Volumes/Astro-T7/Captures/NGC7000/2026-10-02/Ha/"))
    .map((f) => ({ ...f, volumeId: CARD_VOLUME.id, path: `${CARD_VOLUME.mountPath}/Autorun/Light/NGC 7000/${f.path.slice(f.path.lastIndexOf("/") + 1)}`, inode: f.inode + 7 }))
  return [...files, ...earlier]
}

export function isCardInserted(disk: Disk): boolean {
  return disk.volumes[CARD_VOLUME.id]?.mounted === true
}

/** Simulate inserting the ASIAIR card: the OS mounts it with the files the device wrote. */
export function insertCard() {
  store.setState((s) => {
    const existing = s.disk.volumes[CARD_VOLUME.id]
    const disk: Disk = { ...s.disk, volumes: { ...s.disk.volumes, [CARD_VOLUME.id]: { ...(existing ?? CARD_VOLUME), mounted: true } } }
    const hasFiles = Object.values(disk.files).some((f) => f.volumeId === CARD_VOLUME.id)
    return { ...s, disk: hasFiles ? disk : writeFiles(disk, cardFiles(s.disk)) }
  })
}

/** The capture device finished writing: the held files stop growing (their bytes settle). */
export function settleGrowingFiles(paths: string[]) {
  store.setState((s) => {
    const files = { ...s.disk.files }
    let changed = false
    for (const [key, file] of Object.entries(files)) {
      if (file.growing && paths.includes(file.path)) {
        files[key] = { ...file, growing: false, modifiedAt: nowIso() }
        changed = true
      }
    }
    return changed ? { ...s, disk: { ...s.disk, files } } : s
  })
}
