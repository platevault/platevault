/**
 * Storage derivations (foundation-owned). A View's footprint is the bytes
 * its copies hold: it matters for Apply's space check and for Clean up.
 * Settings › Locations shows each location's disk use (P-STO2). Duplicates
 * are byte-identical live copies; a duplicate scan (`duplicate-scan`) runs
 * by itself after each index and import, and the Duplicates review lists
 * what it found that is still live. The symlinks in Projects' Views decide
 * what may go to the OS Trash (`trashBlock`, P-TRASH2). Nothing here writes
 * state.
 */
import { filesUnder, freeBytes, trashRefusal, volumeForPath } from "./disk"
import { projectLink, type StepLink, type World } from "./derive"
import { isUnder } from "./indexing"
import { type MessageRef, msg } from "@/lib/i18n"
import type { Asset, AssetCopy, AssetId, Catalog, Disk, DiskFile, Location, LocationRole, Operation, Project, SessionId } from "./types"

export interface Footprint {
  /** Bytes the View holds itself: its copies, each inode once; symlinks count zero. */
  viewBytes: number
  /** Bytes `View (previous)/` still holds. */
  previousBytes: number
  /** False when the Project folder's volume is not mounted: the bytes are unknown and read zero. */
  online: boolean
}

function folderBytes(disk: Disk, folder: string): number {
  const inodes = new Set<number>()
  let bytes = 0
  for (const file of filesUnder(disk, folder)) {
    if (file.linkTarget || inodes.has(file.inode)) continue
    inodes.add(file.inode)
    bytes += file.sizeBytes
  }
  return bytes
}

/** A Project's View footprint (PREP-FR-04): what its copies and `View (previous)/` hold. */
export function viewFootprint(disk: Disk, project: Project): Footprint {
  const folder = project.view?.folderPath ?? null
  if (!folder) return { viewBytes: 0, previousBytes: 0, online: true }
  const volumeId = volumeForPath(disk, folder)
  const online = Boolean(volumeId && disk.volumes[volumeId]?.mounted)
  if (!online) return { viewBytes: 0, previousBytes: 0, online }
  return { viewBytes: folderBytes(disk, folder), previousBytes: project.previous ? folderBytes(disk, project.previous.folderPath) : 0, online }
}

/** One View's symlink to a catalogue original (PREP-FR-04). */
export interface ViewLink {
  link: DiskFile
  project: Project
  /** In the View of an open Project: the original stays out of the OS Trash while the View links it (P-TRASH2). A Closed Project's kept View holds nothing. */
  holds: boolean
}

/** Every View's links, by the path each points at. */
export type ViewLinks = Map<string, ViewLink[]>

export function viewLinks(catalog: Catalog, disk: Disk): ViewLinks {
  const views = Object.values(catalog.projects).flatMap((project) => (project.view ? [{ folder: project.view.folderPath, project, holds: project.state === "open" }] : []))
  const out: ViewLinks = new Map()
  if (views.length === 0) return out
  for (const file of Object.values(disk.files)) {
    if (!file.linkTarget) continue
    const view = views.find((v) => isUnder(file.path, v.folder))
    if (!view) continue
    const entry = { link: file, project: view.project, holds: view.holds }
    const list = out.get(file.linkTarget)
    if (list) list.push(entry)
    else out.set(file.linkTarget, [entry])
  }
  return out
}

/** Why a file can't go to the OS Trash now; `link` leads to where it can be resolved. */
export interface TrashBlock {
  reason: MessageRef
  link?: StepLink
}

/** One path to move to the OS Trash (`store/actions/trash.ts`). Items sharing an `assetId` move together or not at all. */
export interface TrashItem {
  path: string
  assetId?: AssetId
  /** Refused before the move, for example "Offline" for a folder that cannot be listed. */
  refusedReason?: MessageRef
}

/**
 * The guard every move to the OS Trash applies, in every flow and again for
 * each item as it moves: the disk's own refusal (`trashRefusal`), then the
 * Views (P-TRASH2). A file an open Project's View links to stays, "linked
 * by {Project}", leading to that Project; removing the session there and
 * applying drops the link. Null when it may go.
 */
export function trashBlock(disk: Disk, links: ViewLinks, path: string): TrashBlock | null {
  const reason = trashRefusal(disk, path)
  if (reason) return { reason }
  const project = links.get(path)?.find((l) => l.holds)?.project
  return project ? { reason: msg("domain_trash_linked_by", { name: project.name }), link: projectLink(project.id) } : null
}

/** Links in kept Views (a Closed Project's View the user kept): they leave with the paths. */
export function keptViewLinks(links: ViewLinks, paths: Iterable<string>): DiskFile[] {
  return [...new Set(paths)].flatMap((path) => (links.get(path) ?? []).filter((l) => !l.holds).map((l) => l.link))
}

export interface DiskUse {
  /** Bytes the location's own files hold: each inode once, links count zero. */
  footprintBytes: number
  /** Bytes in use on the location's volume. */
  usedBytes: number
  freeBytes: number
  capacityBytes: number
}

/** A location's disk use (P-STO2): its own footprint and its volume's used and free bytes. Null while the volume is not mounted. */
export function locationDiskUse(disk: Disk, location: Location): DiskUse | null {
  const volume = disk.volumes[location.volumeId]
  if (!volume?.mounted) return null
  const inodes = new Set<number>()
  let footprintBytes = 0
  for (const file of filesUnder(disk, location.path)) {
    if (file.linkTarget || inodes.has(file.inode)) continue
    inodes.add(file.inode)
    footprintBytes += file.sizeBytes
  }
  const free = freeBytes(disk, volume.id)
  return { footprintBytes, usedBytes: volume.capacityBytes - free, freeBytes: free, capacityBytes: volume.capacityBytes }
}

/** Copies that hold the asset now: not absent, not on a retired location. */
export function liveCopies(catalog: Catalog, asset: Asset): AssetCopy[] {
  return asset.copies.filter((c) => c.presence !== "absent" && !catalog.locations[c.locationId]?.retiredAt)
}

/** Library storage keeps its copy; archived frames live in the archive location after Archive (STO-FR-13). */
const LIBRARY_ROLES = new Set<LocationRole>(["captures", "calibration", "archive"])

/** A copy in library storage: a Captures, Calibration or Archive location, never one on a capture card (a removable volume). */
function isLibraryCopy(catalog: Catalog, disk: Disk, copy: AssetCopy): boolean {
  const location = catalog.locations[copy.locationId]
  return Boolean(location && LIBRARY_ROLES.has(location.role) && !disk.volumes[copy.volumeId]?.removable)
}

/**
 * The copy a frame keeps (D-W74, D-W116): a copy in library storage over one
 * on a capture card or elsewhere; then the one in the earliest-registered
 * location; on a tie there, the first-catalogued copy (the first in
 * `asset.copies`, which lists copies in the order indexing found them).
 * Only byte-identical copies take part; nothing is removed without review.
 */
export function keptCopy(catalog: Catalog, disk: Disk, asset: Asset): AssetCopy | null {
  return preferredCopy(catalog, disk, asset.copies.filter((c) => c.sha256 === asset.sha256))
}

function preferredCopy(catalog: Catalog, disk: Disk, copies: AssetCopy[]): AssetCopy | null {
  const rank = (copy: AssetCopy) => ({ library: isLibraryCopy(catalog, disk, copy) ? 0 : 1, registered: catalog.locations[copy.locationId]?.registeredAt ?? "9999" })
  return (
    [...copies].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      return ra.library - rb.library || ra.registered.localeCompare(rb.registered) || copies.indexOf(a) - copies.indexOf(b)
    })[0] ?? null
  )
}

export interface DuplicateGroup {
  assetId: AssetId
  fileName: string
  sha256: string
  sizeBytes: number
  /** Live byte-identical copies in library storage, the one in the earliest-registered location first. */
  copies: AssetCopy[]
  /** Bytes beyond the kept copy. */
  extraBytes: number
}

/** What a duplicate scan records per frame: the paths of its byte-identical live copies. */
export interface ScannedDuplicate {
  assetId: AssetId
  paths: string[]
}

/**
 * The frame's live byte-identical copies in library storage, limited to
 * `paths` when given; null unless at least two remain. A copy on a capture
 * card never counts, so a card never raises the duplicates warning (Round 6).
 */
function duplicateGroup(catalog: Catalog, disk: Disk, asset: Asset, paths?: ReadonlySet<string>): DuplicateGroup | null {
  if (asset.trashed) return null
  const copies = liveCopies(catalog, asset).filter((c) => c.sha256 === asset.sha256 && isLibraryCopy(catalog, disk, c) && (!paths || paths.has(c.path)))
  const kept = preferredCopy(catalog, disk, copies)
  if (!kept || copies.length < 2) return null
  return { assetId: asset.id, fileName: asset.fileName, sha256: asset.sha256, sizeBytes: asset.sizeBytes, copies: [kept, ...copies.filter((c) => c !== kept)], extraBytes: asset.sizeBytes * (copies.length - 1) }
}

/**
 * The copy the review preselects to keep: the frame's kept copy
 * (`keptCopy`), unless exactly one copy cannot go to the OS Trash
 * (`trashBlock`, say write permission removed or linked by an open
 * Project's View): keeping that one is the only choice that lets the others go.
 */
export function keepChoice(disk: Disk, links: ViewLinks, group: DuplicateGroup): AssetCopy {
  const stuck = group.copies.filter((c) => trashBlock(disk, links, c.path) !== null)
  return stuck.length === 1 ? stuck[0]! : group.copies[0]!
}

const byExtraBytes = (a: DuplicateGroup, b: DuplicateGroup) => b.extraBytes - a.extraBytes || a.fileName.localeCompare(b.fileName)

/** Byte-identical live copies of library frames across registered library locations: what a duplicate scan records. */
export function duplicateCopies(catalog: Catalog, disk: Disk): ScannedDuplicate[] {
  return Object.values(catalog.assets)
    .map((asset) => duplicateGroup(catalog, disk, asset))
    .filter((g): g is DuplicateGroup => g !== null)
    .map((g) => ({ assetId: g.assetId, paths: g.copies.map((c) => c.path) }))
}

export interface DuplicateFindings {
  /** The scan that found them. */
  scan: Operation
  /** Largest first. */
  groups: DuplicateGroup[]
  /** Extra copies: every copy beyond the one each frame keeps. */
  copies: number
  /** Bytes the extra copies hold. */
  bytes: number
}

/**
 * The latest succeeded duplicate scan, narrowed to copies still live: a copy
 * moved to the OS Trash since leaves its group, and a frame down to one copy
 * leaves the list, so a clean-up clears its findings without a new scan.
 * Null before a scan succeeded.
 */
export function duplicateFindings(world: World): DuplicateFindings | null {
  const scan = Object.values(world.operations)
    .filter((op) => op.kind === "duplicate-scan" && op.status === "succeeded")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (!scan) return null
  const found = (scan.payload.groups as ScannedDuplicate[] | undefined) ?? []
  const groups = found
    .map((g) => {
      const asset = world.catalog.assets[g.assetId]
      return asset ? duplicateGroup(world.catalog, world.disk, asset, new Set(g.paths)) : null
    })
    .filter((g): g is DuplicateGroup => g !== null)
    .sort(byExtraBytes)
  return { scan, groups, copies: groups.reduce((n, g) => n + g.copies.length - 1, 0), bytes: groups.reduce((n, g) => n + g.extraBytes, 0) }
}

/**
 * F5: per session, the extra copies (every copy beyond the one each frame
 * keeps) of its frames that the latest duplicate scan found and that are
 * still live, SHA-256-confirmed and in registered library storage
 * (`duplicateFindings`). Trashed frames never count. The Duplicates facet
 * and the row badge wherever session rows appear read it; totals count each
 * logical frame once regardless.
 */
export function sessionDuplicateCopies(world: World): Map<SessionId, number> {
  const out = new Map<SessionId, number>()
  for (const group of duplicateFindings(world)?.groups ?? []) {
    const sessionId = world.catalog.assets[group.assetId]?.sessionId
    if (sessionId) out.set(sessionId, (out.get(sessionId) ?? 0) + group.copies.length - 1)
  }
  return out
}

/** The duplicate scan that is running now, if any. */
export function runningDuplicateScan(operations: Record<string, Operation>): Operation | null {
  return Object.values(operations).find((op) => op.kind === "duplicate-scan" && (op.status === "running" || op.status === "paused")) ?? null
}
