/**
 * Simulated-disk helpers shared by seeds, prototype controls and operations.
 * These change the world outside PlateVault; only operations a user approved
 * (or prototype controls) call them.
 */
import { isUnder, stableHash } from "./indexing"
import type { Disk, DiskFile, DiskFileKind, DiskFolder, FrameHeader, IsoDateTime, PixelTruth, VolumeId } from "./types"

/** Key of a file record in `Disk.files`: the same path on two volumes is two records. */
export function fileKey(volumeId: VolumeId, path: string): string {
  return `${volumeId}:${path}`
}

/** The file at `path` on the volume mounted there, if any. */
export function fileAt(disk: Disk, path: string): DiskFile | undefined {
  const volumeId = volumeForPath(disk, path)
  return volumeId && disk.volumes[volumeId]?.mounted ? disk.files[fileKey(volumeId, path)] : undefined
}

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
    previousSha256: null,
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

/** Returns a new disk with the files written (overwrites the same path on the same volume). */
export function writeFiles(disk: Disk, files: DiskFile[]): Disk {
  const next = { ...disk.files }
  for (const file of files) next[fileKey(file.volumeId, file.path)] = file
  return { ...disk, files: next }
}

/** Returns a new disk without the file at `path` on `volumeId`. */
export function removeFile(disk: Disk, volumeId: VolumeId, path: string): Disk {
  const { [fileKey(volumeId, path)]: _removed, ...files } = disk.files
  return { ...disk, files }
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

/** Files under `folder` on the volume mounted there. */
export function filesUnder(disk: Disk, folder: string): DiskFile[] {
  const volumeId = volumeForPath(disk, folder)
  if (!volumeId || !disk.volumes[volumeId]?.mounted) return []
  return Object.values(disk.files).filter((f) => f.volumeId === volumeId && f.path !== folder && isUnder(f.path, folder))
}

/** Returns a new disk with an explicit (possibly empty) folder and its parents' existence implied. */
export function createFolder(disk: Disk, folder: DiskFolder): Disk {
  if (disk.folders.some((f) => f.volumeId === folder.volumeId && f.path === folder.path)) return disk
  return { ...disk, folders: [...disk.folders, folder] }
}

export interface FolderEntry {
  path: string
  name: string
  /** Read access denied: the folder is listed but its contents are not. */
  denied: boolean
}

/**
 * Immediate child folders of `parent` on the volume mounted there: explicit
 * folders plus every folder that holds a file. Sorted by name. Empty when the
 * parent is offline or denied.
 */
export function listFolders(disk: Disk, parent: string): FolderEntry[] {
  const volumeId = volumeForPath(disk, parent)
  if (!volumeId || !disk.volumes[volumeId]?.mounted) return []
  if (disk.deniedPaths.some((denied) => isUnder(parent, denied))) return []
  const prefix = parent.endsWith("/") ? parent : `${parent}/`
  const names = new Set<string>()
  const consider = (path: string) => {
    if (!path.startsWith(prefix)) return
    const rest = path.slice(prefix.length)
    const slash = rest.indexOf("/")
    if (slash > 0) names.add(rest.slice(0, slash))
  }
  for (const file of Object.values(disk.files)) if (file.volumeId === volumeId) consider(file.path)
  for (const folder of disk.folders) if (folder.volumeId === volumeId) consider(`${folder.path}/`)
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const path = `${prefix}${name}`
      return { path, name, denied: disk.deniedPaths.some((denied) => isUnder(path, denied)) }
    })
}
