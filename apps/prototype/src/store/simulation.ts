/**
 * Prototype world controls (foundation-owned). These change the simulated
 * disk, the simulated clock or arm faults so reviewers can reach offline,
 * partial, drift, restore, copy, collision and failed-write states. They never
 * write the catalog directly; PlateVault observes their effects the next time
 * it reads the disk.
 */
import { arrivalFiles, VOLUME_IDS } from "@/domain/seed"
import { fakeSha256, fileAt, fileKey, filesUnder, makeFile, removeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import type { DiskFile, SimulationFaults, VolumeId } from "@/domain/types"
import { nowIso, store } from "./core"

export function setVolumeMounted(volumeId: VolumeId, mounted: boolean) {
  store.setState((s) => {
    const volume = s.disk.volumes[volumeId]
    if (!volume || volume.mounted === mounted) return s
    let volumes = { ...s.disk.volumes, [volumeId]: { ...volume, mounted } }
    // Two volumes cannot be mounted at one path: mounting one unmounts the other.
    if (mounted) {
      for (const other of Object.values(volumes)) {
        if (other.id !== volumeId && other.mountPath === volume.mountPath && other.mounted) {
          volumes = { ...volumes, [other.id]: { ...other, mounted: false } }
        }
      }
    }
    return { ...s, disk: { ...s.disk, volumes } }
  })
}

/** J28: mount a different volume with the same name at the Archive path. */
export function swapArchiveImpostor(useImpostor: boolean) {
  setVolumeMounted(useImpostor ? VOLUME_IDS.impostor : VOLUME_IDS.archive, true)
}

export function setFolderAccess(path: string, denied: boolean) {
  store.setState((s) => {
    const has = s.disk.deniedPaths.includes(path)
    if (has === denied) return s
    const deniedPaths = denied ? [...s.disk.deniedPaths, path] : s.disk.deniedPaths.filter((p) => p !== path)
    return { ...s, disk: { ...s.disk, deniedPaths } }
  })
}

/** Remove or restore write permission on a folder or file (reads still work). */
export function setPathReadOnly(path: string, readOnly: boolean) {
  store.setState((s) => {
    const has = s.disk.readOnlyPaths.includes(path)
    if (has === readOnly) return s
    const readOnlyPaths = readOnly ? [...s.disk.readOnlyPaths, path] : s.disk.readOnlyPaths.filter((p) => p !== path)
    return { ...s, disk: { ...s.disk, readOnlyPaths } }
  })
}

/** J25: copy two new matching NGC 7000 sessions into Astro-T7/Captures. */
export function copyNewCaptures() {
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, arrivalFiles()) }))
}

export function newCapturesArrived(): boolean {
  const first = arrivalFiles()[0]
  return first ? Boolean(fileAt(store.getState().disk, first.path)) : false
}

/** Overwrite a file outside PlateVault: same path, new bytes (drift). The old bytes stay restorable. */
export function modifyFileExternally(path: string) {
  store.setState((s) => {
    const file = fileAt(s.disk, path)
    if (!file) return s
    const version = Number.parseInt(file.sha256.slice(0, 2), 16) + 1
    return { ...s, disk: writeFiles(s.disk, [{ ...file, previousSha256: file.sha256, sha256: fakeSha256(path, version), modifiedAt: nowIso() }]) }
  })
}

/** Put back the bytes a file had before its last external overwrite (J22 S15b, J24 S16, J26 S7a). */
export function restoreFileExternally(path: string): boolean {
  const file = fileAt(store.getState().disk, path)
  if (!file?.previousSha256) return false
  const restored: DiskFile = { ...file, sha256: file.previousSha256, previousSha256: null, modifiedAt: nowIso() }
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, [restored]) }))
  return true
}

export type CopyOutcome = { ok: true; copied: number; destination: string } | { ok: false; message: string }

/**
 * Copy a file or folder byte for byte into `destinationFolder` outside
 * PlateVault (J25 S1, J27 P6, STO-AC-08). Copies keep their sha256, header and
 * pixel facts and get their own inode. A folder copy keeps its name:
 * `/a/Ha` copied into `/b` becomes `/b/Ha/…`. Nothing is overwritten.
 */
export function copyFolderExternally(source: string, destinationFolder: string): CopyOutcome {
  const disk = store.getState().disk
  const single = fileAt(disk, source)
  const sources = single ? [single] : filesUnder(disk, source).filter((f) => !f.linkTarget)
  if (sources.length === 0) return { ok: false, message: `Nothing to copy: no file or folder with files at ${source}.` }
  const volumeId = volumeForPath(disk, destinationFolder)
  const volume = volumeId ? disk.volumes[volumeId] : undefined
  if (!volumeId || !volume?.mounted) return { ok: false, message: `Cannot copy to ${destinationFolder}: no mounted volume holds that path.` }
  if (disk.readOnlyPaths.some((p) => isUnder(destinationFolder, p))) return { ok: false, message: `Cannot copy to ${destinationFolder}: write permission is removed.` }
  const base = source.slice(0, source.lastIndexOf("/"))
  const copies = sources.map((file) =>
    makeFile({
      path: `${destinationFolder}${file.path.slice(base.length)}`,
      volumeId,
      sizeBytes: file.sizeBytes,
      kind: file.kind,
      header: file.header,
      pixelTruth: file.pixelTruth,
      sha256: file.sha256,
      modifiedAt: nowIso(),
    }),
  )
  const collision = copies.find((c) => disk.files[fileKey(volumeId, c.path)])
  if (collision) return { ok: false, message: `Not copied: ${collision.path} already exists. Nothing was overwritten.` }
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, copies) }))
  return { ok: true, copied: copies.length, destination: `${destinationFolder}${source.slice(base.length)}` }
}

/** Create an unrelated file outside PlateVault (destination collision). */
export function createExternalFile(path: string) {
  store.setState((s) => {
    const volumeId = volumeForPath(s.disk, path)
    if (!volumeId || !s.disk.volumes[volumeId]?.mounted || fileAt(s.disk, path)) return s
    const file = makeFile({ path, volumeId, sizeBytes: 1_024, kind: "other", modifiedAt: nowIso() })
    return { ...s, disk: writeFiles(s.disk, [file]) }
  })
}

/** Delete a file outside PlateVault, bypassing Trash (e.g. the original behind a hardlink). */
export function deleteFileExternally(path: string) {
  store.setState((s) => {
    const file = fileAt(s.disk, path)
    return file ? { ...s, disk: removeFile(s.disk, file.volumeId, path) } : s
  })
}

/** Set the simulated clock to `iso` (J29 P4). The offset is persisted, so it survives a reload. */
export function setClockTo(iso: string) {
  const offset = new Date(iso).getTime() - Date.now()
  store.setState((s) => ({ ...s, faults: { ...s.faults, clockOffsetMs: offset } }))
}

export function resetClock() {
  store.setState((s) => ({ ...s, faults: { ...s.faults, clockOffsetMs: 0 } }))
}

export function setFault<K extends keyof SimulationFaults>(key: K, value: SimulationFaults[K]) {
  store.setState((s) => ({ ...s, faults: { ...s.faults, [key]: value } }))
}
