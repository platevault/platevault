/**
 * Simulated-disk helpers shared by seeds, prototype controls and operations.
 * These change the world outside PlateVault; only operations a user approved
 * (or prototype controls) call them.
 */
import { stableHash } from "./indexing"
import type { Disk, DiskFile, DiskFileKind, FrameHeader, IsoDateTime, PixelTruth, VolumeId } from "./types"

/** Deterministic 64-hex content digest for a path and a content version. */
export function fakeSha256(path: string, version = 0): string {
  let out = ""
  let seed = `${path}#${version}`
  while (out.length < 64) {
    seed = stableHash(seed) + seed.length
    out += stableHash(seed).padStart(7, "0")
  }
  return Array.from(out.slice(0, 64), (ch) => (Number.parseInt(ch, 36) % 16).toString(16)).join("")
}

export interface NewFile {
  path: string
  volumeId: VolumeId
  sizeBytes: number
  kind: DiskFileKind
  header?: FrameHeader | null
  pixelTruth?: PixelTruth | null
  linkTarget?: string | null
  inode?: number
  sha256?: string
  growing?: boolean
  modifiedAt: IsoDateTime
}

export function makeFile(spec: NewFile): DiskFile {
  return {
    path: spec.path,
    volumeId: spec.volumeId,
    sizeBytes: spec.sizeBytes,
    sha256: spec.sha256 ?? fakeSha256(spec.path),
    // A path-derived inode stays unique across reloads; hardlinks pass the source inode.
    inode: spec.inode ?? Number.parseInt(stableHash(spec.path), 36),
    kind: spec.kind,
    header: spec.header ?? null,
    linkTarget: spec.linkTarget ?? null,
    growing: spec.growing ?? false,
    modifiedAt: spec.modifiedAt,
    pixelTruth: spec.pixelTruth ?? null,
  }
}

/** Returns a new disk with the files written (overwrites same paths). */
export function writeFiles(disk: Disk, files: DiskFile[]): Disk {
  const next = { ...disk.files }
  for (const file of files) next[file.path] = file
  return { ...disk, files: next }
}

/** Free bytes on a volume, from capacity minus stored image bytes (links count zero). */
export function freeBytes(disk: Disk, volumeId: VolumeId): number {
  const volume = disk.volumes[volumeId]
  if (!volume) return 0
  const seenInodes = new Set<number>()
  let used = 0
  for (const file of Object.values(disk.files)) {
    if (file.volumeId !== volumeId || file.linkTarget || seenInodes.has(file.inode)) continue
    seenInodes.add(file.inode)
    used += file.sizeBytes
  }
  return Math.max(0, volume.capacityBytes - used)
}

/** The volume whose mount path contains `path`, mounted volumes first. */
export function volumeForPath(disk: Disk, path: string): VolumeId | null {
  const candidates = Object.values(disk.volumes)
    .filter((v) => path === v.mountPath || path.startsWith(`${v.mountPath}/`))
    .sort((a, b) => Number(b.mounted) - Number(a.mounted) || b.mountPath.length - a.mountPath.length)
  return candidates[0]?.id ?? null
}

export function filesUnder(disk: Disk, folder: string): DiskFile[] {
  const prefix = folder.endsWith("/") ? folder : `${folder}/`
  return Object.values(disk.files).filter((f) => f.path.startsWith(prefix))
}
