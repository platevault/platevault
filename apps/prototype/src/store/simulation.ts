/**
 * Prototype world controls (foundation-owned). These change the simulated
 * disk, the simulated clock or arm faults so reviewers can reach offline,
 * partial, drift, restore, copy, collision, failed-write, tool-rerun and
 * held-file states. They never write the catalog directly; PlateVault
 * observes their effects the next time it reads the disk.
 */
import { useSyncExternalStore } from "react"
import { rawFrameIds } from "@/domain/calibration-process"
import { arrivalFiles, defaultFaults, deviceFiles, VOLUME_IDS } from "@/domain/seed"
import { fakeSha256, fileAt, fileKey, filesUnder, makeFile, removeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import { projectPaths, toolFolder } from "@/domain/project-view"
import type { CalibrationProcessId, Disk, DiskFile, ProjectId, QuickActionMode, SimulationFaults, VolumeId } from "@/domain/types"
import { type MessageRef, msg } from "@/lib/i18n"
import { nowIso, store } from "./core"
import { ensureTicker } from "./operations"

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

/**
 * An external tool reruns on a Project's View (PREP-FR-07, owner §1): it
 * writes only into its own `Processing/<tool>/` folder, overwriting its
 * earlier files there with new bytes and writing a master light per channel
 * and binning the View holds, named as WBPP does. `Output/` never changes,
 * so no Result is overwritten (RES-FR-02); a master it rewrote has a new
 * digest and is offered once more (CAL-FR-06). False when the Project has no
 * applied View or its volume is offline.
 */
export function rerunTool(projectId: ProjectId, tool = "WBPP"): boolean {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  const paths = project?.view ? projectPaths(state, project) : null
  const volumeId = paths ? volumeForPath(state.disk, paths.root) : null
  if (!project?.view || !paths || !volumeId || !state.disk.volumes[volumeId]?.mounted) return false
  const folder = toolFolder(paths, tool)
  const at = nowIso()
  const version = Date.parse(at)
  const rewritten = filesUnder(state.disk, folder)
    .filter((file) => !file.linkTarget)
    .map((file): DiskFile => ({ ...file, previousSha256: file.sha256, sha256: fakeSha256(file.path, version), modifiedAt: at }))
  const written = new Set(rewritten.map((file) => file.path))
  const masters = [
    ...new Set(
      project.view.inputs.flatMap((input) => {
        const session = state.catalog.sessions[input.sessionId]
        return session ? [`${folder}/master/masterLight_BIN-${session.binning}_FILTER-${session.channel ?? "none"}.xisf`] : []
      }),
    ),
  ]
    .filter((path) => !written.has(path))
    .map((path) => makeFile({ path, volumeId, sizeBytes: 104_390_000, kind: "xisf", sha256: fakeSha256(path, version), modifiedAt: at }))
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, [...rewritten, ...masters]) }))
  return true
}

/**
 * A tool holds a file in a View, or lets it go (Windows, PREP-FR-18): an
 * Apply that finished its build waits ("Waiting for a tool to release a file
 * in View") while it is held, and carries on by itself once it is released.
 */
export function setViewFileHeld(held: boolean) {
  setFault("viewFileHeld", held)
  if (!held) ensureTicker()
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

export type CopyOutcome = { ok: true; copied: number; destination: string } | { ok: false; field: "source" | "destination"; message: MessageRef }

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
  if (sources.length === 0) return { ok: false, field: "source", message: msg("simulation_copy_nothing", { path: source }) }
  const volumeId = volumeForPath(disk, destinationFolder)
  const volume = volumeId ? disk.volumes[volumeId] : undefined
  if (!volumeId || !volume?.mounted) return { ok: false, field: "destination", message: msg("simulation_copy_no_volume", { path: destinationFolder }) }
  if (disk.readOnlyPaths.some((p) => isUnder(destinationFolder, p))) return { ok: false, field: "destination", message: msg("simulation_copy_read_only", { path: destinationFolder }) }
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
  if (collision) return { ok: false, field: "destination", message: msg("simulation_copy_collision", { path: collision.path }) }
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

/** Delete a file outside PlateVault, bypassing Trash (e.g. the original behind a symlink). */
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

const quickActionMode = (): QuickActionMode => store.peek()?.faults.quickActions ?? defaultFaults().quickActions

/** The Quick actions switch (astro-plan-zzjlz), as every action runner reads it: its default, One-click, until the store holds data. */
export function useQuickActionMode(): QuickActionMode {
  return useSyncExternalStore(store.subscribe, quickActionMode, quickActionMode)
}

/**
 * Windows without Developer Mode (P-PREP3): on, the computer is Windows with
 * Developer Mode off; off, it is not Windows. PlateVault checks at once, as
 * it does at launch.
 */
export function setWindowsWithoutDeveloperMode(on: boolean) {
  const developerMode = on ? "off" : "not-windows"
  store.setState((s) => ({ ...s, faults: { ...s.faults, developerMode }, settings: { ...s.settings, developerModeCheck: developerMode } }))
}
