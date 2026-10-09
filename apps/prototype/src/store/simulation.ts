/**
 * Prototype world controls (foundation-owned). These change the simulated
 * disk, the simulated clock or arm faults so reviewers can reach offline,
 * partial, drift, restore, copy, collision and failed-write states. They never
 * write the catalog directly; PlateVault observes their effects the next time
 * it reads the disk.
 */
import { rawFrameIds } from "@/domain/calibration-process"
import { arrivalFiles, deviceFiles, VOLUME_IDS } from "@/domain/seed"
import { fakeSha256, fileAt, fileKey, filesUnder, makeFile, removeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import type { CalibrationProcessId, Disk, DiskFile, SimulationFaults, VolumeId } from "@/domain/types"
import { nowIso, store } from "./core"

const WBPP_PREFIX = { dark: "masterDark", flat: "masterFlat", bias: "masterBias", "dark-flat": "masterDarkFlat" } as const

/**
 * P-CAL3: the tool a calibration process handed its raws to finishes and
 * writes the master into the output folder (IMAGETYP master, NCOMBINE = the
 * raw frames), named as WBPP does. PlateVault's watch detects it on its own.
 */
export function toolFinishedStacking(processId: CalibrationProcessId): boolean {
  const state = store.getState()
  const process = state.catalog.calibrationProcesses[processId]
  const session = process?.sessionId ? state.catalog.sessions[process.sessionId] : undefined
  const first = session ? state.catalog.assets[session.assetIds[0]!]?.observed : undefined
  const volumeId = process?.outputFolder ? volumeForPath(state.disk, process.outputFolder) : null
  if (!process?.outputFolder || !first || !volumeId) return false
  const at = nowIso()
  const detail = process.kind === "flat" ? `_FILTER-${first.filter ?? "none"}` : process.kind === "bias" ? "" : `_EXPOSURE-${first.exposureS.toFixed(2)}s`
  const path = `${process.outputFolder}/${WBPP_PREFIX[process.kind]}_BIN-${first.binning}${detail}.xisf`
  const header = { ...first, imageType: `master-${process.kind}` as const, object: null, dateObs: at, ra: null, dec: null, rotationDeg: null, ncombine: rawFrameIds(state.catalog, process).length }
  const file = makeFile({ path, volumeId, sizeBytes: first.widthPx * first.heightPx * 4 + 23_040, kind: "xisf", header, sha256: fakeSha256(path, Date.parse(at)), modifiedAt: at })
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, [file]) }))
  return true
}

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

/** S13 Import: the OS mounts a removable device (USB / SD) with the files its capture application wrote. */
export function connectDevice(volumeId: VolumeId) {
  store.setState((s) => {
    const volume = s.disk.volumes[volumeId]
    if (!volume?.removable || volume.mounted) return s
    const disk: Disk = { ...s.disk, volumes: { ...s.disk.volumes, [volumeId]: { ...volume, mounted: true } } }
    const hasFiles = Object.values(disk.files).some((f) => f.volumeId === volumeId)
    return { ...s, disk: hasFiles ? disk : writeFiles(disk, deviceFiles(s.disk, volumeId)) }
  })
}

/** The device is ejected; its files stay on it for the next connect. */
export function ejectDevice(volumeId: VolumeId) {
  if (store.getState().disk.volumes[volumeId]?.removable) setVolumeMounted(volumeId, false)
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

export type CopyOutcome = { ok: true; copied: number; destination: string } | { ok: false; field: "source" | "destination"; message: string }

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
  if (sources.length === 0) return { ok: false, field: "source", message: `Nothing to copy: no file or folder with files at ${source}.` }
  const volumeId = volumeForPath(disk, destinationFolder)
  const volume = volumeId ? disk.volumes[volumeId] : undefined
  if (!volumeId || !volume?.mounted) return { ok: false, field: "destination", message: `Cannot copy to ${destinationFolder}: no mounted volume holds that path.` }
  if (disk.readOnlyPaths.some((p) => isUnder(destinationFolder, p))) return { ok: false, field: "destination", message: `Cannot copy to ${destinationFolder}: write permission is removed.` }
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
  if (collision) return { ok: false, field: "destination", message: `Not copied: ${collision.path} already exists. Nothing was overwritten.` }
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
