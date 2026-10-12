/**
 * Storage derivations (foundation-owned). A footprint is the bytes of a
 * run's prepared copies: it matters for Clean up only, so it is shown on the
 * run's Done step and in Wrap up. Settings › Locations shows each location's
 * disk use (P-STO2). Duplicates are byte-identical live copies; a duplicate
 * scan (`duplicate-scan`) runs by itself after each index and import, and
 * the Duplicates review lists what it found that is still live. A run view's
 * links decide what may go to the OS Trash (`linkRefusal`, P-TRASH2).
 * Nothing here writes state.
 */
import { filesUnder, freeBytes, trashRefusal, volumeForPath } from "./disk"
import { runPreparations, runStepLink, type StepLink, type World } from "./derive"
import { isUnder } from "./indexing"
import { type MessageRef, msg } from "@/lib/i18n"
import type { Asset, AssetCopy, AssetId, Catalog, Disk, DiskFile, Location, LocationRole, Operation, Preparation, Run, RunId } from "./types"

export interface Footprint {
  /** Bytes the prepared folder holds itself: a Copies view's copies; symlinks count zero. */
  preparedBytes: number
  /** Bytes in the Results folder. */
  resultsBytes: number
  /** False when the folder's volume is not mounted: the bytes are unknown and read zero. */
  online: boolean
}

export function preparationFootprint(disk: Disk, preparation: Preparation): Footprint {
  const volumeId = volumeForPath(disk, preparation.folderPath)
  const online = Boolean(volumeId && disk.volumes[volumeId]?.mounted)
  if (!online) return { preparedBytes: 0, resultsBytes: 0, online }
  return {
    preparedBytes: filesUnder(disk, preparation.folderPath).reduce((sum, f) => sum + (f.linkTarget ? 0 : f.sizeBytes), 0),
    resultsBytes: filesUnder(disk, preparation.resultsPath).reduce((sum, f) => sum + f.sizeBytes, 0),
    online,
  }
}

/** A run's footprint over all its preparations: what its Clean up would free. */
export function runFootprint(disk: Disk, catalog: Catalog, runId: RunId): Footprint {
  return runPreparations(catalog, runId).reduce<Footprint>(
    (sum, p) => {
      const f = preparationFootprint(disk, p)
      return { preparedBytes: sum.preparedBytes + f.preparedBytes, resultsBytes: sum.resultsBytes + f.resultsBytes, online: sum.online && f.online }
    },
    { preparedBytes: 0, resultsBytes: 0, online: true },
  )
}

/** One run view's symlink to a catalogue file (P-PREP3). */
export interface RunViewLink {
  link: DiskFile
  run: Run
  /** In the latest view of a run that is not Complete: the file stays out of the OS Trash until that view is refreshed (P-TRASH2). */
  holds: boolean
}

/** Every run view's links, by the path each points at. */
export type RunViewLinks = Map<string, RunViewLink[]>

export function runViewLinks(catalog: Catalog, disk: Disk): RunViewLinks {
  const views = Object.values(catalog.runs).flatMap((run) => {
    const preps = runPreparations(catalog, run.id)
    return preps.map((prep, index) => ({ folder: prep.folderPath, run, holds: run.completion !== "complete" && index === preps.length - 1 }))
  })
  const out: RunViewLinks = new Map()
  if (views.length === 0) return out
  for (const file of Object.values(disk.files)) {
    if (!file.linkTarget) continue
    const view = views.find((v) => isUnder(file.path, v.folder))
    if (!view) continue
    const entry = { link: file, run: view.run, holds: view.holds }
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

/**
 * The guard every move to the OS Trash applies, in every flow and again for
 * each item as it moves: the disk's own refusal (`trashRefusal`), then the
 * run views (P-TRASH2). A file the latest view of a run that is not
 * Complete links to stays, "linked by {run}", leading to that run's
 * Prepare step; refreshing the view drops the link. Null when it may go.
 */
export function trashBlock(disk: Disk, links: RunViewLinks, path: string): TrashBlock | null {
  const reason = trashRefusal(disk, path)
  if (reason) return { reason }
  const run = links.get(path)?.find((l) => l.holds)?.run
  return run ? { reason: msg("domain_trash_linked_by", { name: run.name }), link: runStepLink(run, "prepare") } : null
}

/** Links in kept run views (a Complete run's view the user kept, a superseded revision): they leave with the paths. */
export function keptViewLinks(links: RunViewLinks, paths: Iterable<string>): DiskFile[] {
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
 * The copy a frame keeps (D-W74): a copy in library storage over one on a
 * capture card or elsewhere; then the one in the earliest-registered
 * location, then the copy found first. Only byte-identical copies take part.
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
 * The copy the review preselects to keep: the one in the earliest-registered
 * location, unless exactly one copy cannot go to the OS Trash
 * (`trashBlock`, say write permission removed or linked by a run): keeping
 * that one is the only choice that lets the others go.
 */
export function keepChoice(disk: Disk, links: RunViewLinks, group: DuplicateGroup): AssetCopy {
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

/** The duplicate scan that is running now, if any. */
export function runningDuplicateScan(operations: Record<string, Operation>): Operation | null {
  return Object.values(operations).find((op) => op.kind === "duplicate-scan" && (op.status === "running" || op.status === "paused")) ?? null
}
