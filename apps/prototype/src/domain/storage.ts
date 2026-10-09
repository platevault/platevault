/**
 * Storage derivations (foundation-owned). A footprint is the bytes of a
 * run's prepared copies: it matters for Clean up only, so it is shown on the
 * run's Done step and in Wrap up, never in the Storage overview. Duplicates
 * are byte-identical live copies; Storage lists them only after a Scan for
 * duplicates operation (`duplicate-scan`). Nothing here writes state.
 */
import { filesUnder, volumeForPath } from "./disk"
import { runPreparations } from "./derive"
import type { Asset, AssetCopy, Catalog, Disk, Operation, Preparation, RunId } from "./types"

export interface Footprint {
  /** Bytes the prepared folder holds itself; links count zero. */
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

/** Copies that hold the asset now: not absent, not on a retired location. */
export function liveCopies(catalog: Catalog, asset: Asset): AssetCopy[] {
  return asset.copies.filter((c) => c.presence !== "absent" && !catalog.locations[c.locationId]?.retiredAt)
}

export interface DuplicateGroup {
  assetId: string
  fileName: string
  sha256: string
  paths: string[]
  /** Bytes beyond the first copy. */
  extraBytes: number
}

/** Byte-identical live copies of library frames, the result a duplicate scan records. */
export function duplicateCopies(catalog: Catalog): DuplicateGroup[] {
  const out: DuplicateGroup[] = []
  for (const asset of Object.values(catalog.assets)) {
    if (asset.trashed) continue
    const copies = liveCopies(catalog, asset)
    if (copies.length < 2) continue
    out.push({ assetId: asset.id, fileName: asset.fileName, sha256: asset.sha256, paths: copies.map((c) => c.path), extraBytes: asset.sizeBytes * (copies.length - 1) })
  }
  return out.sort((a, b) => b.extraBytes - a.extraBytes || a.fileName.localeCompare(b.fileName))
}

export interface DuplicateScanResult {
  operation: Operation
  /** Null while the scan runs. */
  groups: DuplicateGroup[] | null
  extraBytes: number
}

/** The latest Scan for duplicates, if one ran; Storage lists its groups. */
export function lastDuplicateScan(operations: Record<string, Operation>): DuplicateScanResult | null {
  const latest = Object.values(operations)
    .filter((op) => op.kind === "duplicate-scan")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  if (!latest) return null
  const groups = (latest.payload.groups as DuplicateGroup[] | undefined) ?? null
  return { operation: latest, groups, extraBytes: groups?.reduce((n, g) => n + g.extraBytes, 0) ?? 0 }
}
