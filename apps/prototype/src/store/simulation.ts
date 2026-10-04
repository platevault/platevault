/**
 * Prototype world controls (foundation-owned). These change the simulated
 * disk or arm faults so reviewers can reach offline, partial, drift,
 * collision and failed-write states. They never write the catalog directly;
 * PlateVault observes their effects the next time it reads the disk.
 */
import { arrivalFiles, VOLUME_IDS } from "@/domain/seed"
import { fakeSha256, makeFile, volumeForPath, writeFiles } from "@/domain/disk"
import type { SimulationFaults, VolumeId } from "@/domain/types"
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
  return first ? Boolean(store.getState().disk.files[first.path]) : false
}

/** Overwrite a file outside PlateVault: same path, new bytes (drift). */
export function modifyFileExternally(path: string) {
  store.setState((s) => {
    const file = s.disk.files[path]
    if (!file) return s
    const version = Number.parseInt(file.sha256.slice(0, 2), 16) + 1
    return { ...s, disk: { ...s.disk, files: { ...s.disk.files, [path]: { ...file, sha256: fakeSha256(path, version), modifiedAt: nowIso() } } } }
  })
}

/** Create an unrelated file outside PlateVault (destination collision). */
export function createExternalFile(path: string) {
  store.setState((s) => {
    const volumeId = volumeForPath(s.disk, path)
    if (!volumeId || s.disk.files[path]) return s
    const file = makeFile({ path, volumeId, sizeBytes: 1_024, kind: "other", modifiedAt: nowIso() })
    return { ...s, disk: writeFiles(s.disk, [file]) }
  })
}

/** Delete a file outside PlateVault, bypassing Trash (e.g. the original behind a hardlink). */
export function deleteFileExternally(path: string) {
  store.setState((s) => {
    if (!s.disk.files[path]) return s
    const { [path]: _removed, ...files } = s.disk.files
    return { ...s, disk: { ...s.disk, files } }
  })
}

export function setFault<K extends keyof SimulationFaults>(key: K, value: SimulationFaults[K]) {
  store.setState((s) => ({ ...s, faults: { ...s.faults, [key]: value } }))
}
