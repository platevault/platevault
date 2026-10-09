/**
 * S13 Import model (slice A): the pure import plan the sheet previews and
 * the operation runs (D-W11, D-W12, D-W20, D-W24). The demo's saved source
 * is the ASIAIR SD card (Prototype › Insert ASIAIR card).
 *
 * The plan sorts every file under the source into exactly one bucket:
 * - a destination in Captures (lights) or Calibration (everything else),
 *   resolved from the per-type naming template;
 * - a hold: Unclassified (no frame type; typing it releases it) or still
 *   being written (held until it settles);
 * - a skip: a byte-identical duplicate of a library frame (SHA-256), a file
 *   already imported from this saved source (Import new), a non-image file,
 *   or a destination name already taken by different bytes.
 * Nothing here writes state.
 */
import { fileAt, freeBytes, volumeForPath } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import { locationAvailability } from "@/domain/library"
import { headerNamingValues, namingTemplate, resolveNamingTemplate } from "@/domain/templates"
import { formatBytes } from "@/lib/format"
import type {
  AssetId,
  Catalog,
  Disk,
  DiskFile,
  ImageType,
  ImportSource,
  Location,
  LocationRole,
  NamingFrameType,
  NamingToken,
  SessionId,
  Volume,
} from "@/domain/types"
import type { PrototypeState } from "@/store/core"
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
  "master-dark-flat": "Master dark flat",
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
    const resolved = resolveNamingTemplate(namingTemplate(settings.naming, NAMING_TYPE[type]), headerNamingValues(header, type))
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
    const problem = needed === 0 ? null : (check.problem ?? (free < needed ? `${check.volume?.name ?? location.displayName} has ${formatBytes(free)} free; this import needs ${formatBytes(needed)}` : null))
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
