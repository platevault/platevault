/**
 * T5 prototype world controls. They stand in for things that happen outside
 * PlateVault in the journeys: the processing application writing its output
 * (J26 P1-P3), the P5 overwrite helper that keeps size and mtime, and putting
 * a file back from the OS Trash (J27 S9). They change the simulated disk only;
 * PlateVault observes the result the next time it reads.
 */
import { fakeSha256, fileAt, fileKey, makeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import type { Disk, DiskFile, FrameHeader, View } from "@/domain/types"
import { plural } from "@/lib/format"
import { nowIso, store } from "@/store/core"
import { baseName, latestPreparation, parentFolder } from "./files"

export type ControlOutcome = { ok: true; message: string } | { ok: false; message: string }

/** Write what Siril-like processing leaves in a View's output location (J26 P1, P2; J27 P1). */
export function simulateApplicationOutput(view: View): ControlOutcome {
  const state = store.getState()
  const preparation = latestPreparation(state.catalog, view.id)
  const out = preparation?.outputPath ?? view.outputPath
  if (!out) return { ok: false, message: "Prepare this View first: the application writes into its output location." }
  const volumeId = volumeForPath(state.disk, out)
  if (!volumeId || !state.disk.volumes[volumeId]?.mounted) return { ok: false, message: `Cannot write into ${out}: its volume is offline.` }
  const revision = view.revisions.at(-1)
  const lights = (revision?.included ?? []).map((id) => state.catalog.assets[id]).filter((a) => a !== undefined)
  if (lights.length === 0) return { ok: false, message: "This View has no included frames to process." }
  const now = nowIso()
  const files: DiskFile[] = []
  const add = (path: string, sizeBytes: number, kind: DiskFile["kind"], header: FrameHeader | null = null, growing = false) => {
    if (state.disk.files[fileKey(volumeId, path)]) return
    files.push(makeFile({ path, volumeId, sizeBytes, kind, header, growing, modifiedAt: now }))
  }
  const byChannel = new Map<string, typeof lights>()
  for (const asset of lights) {
    const channel = (asset.sessionId && state.catalog.sessions[asset.sessionId]?.channel) || asset.observed.filter || "L"
    byChannel.set(channel, [...(byChannel.get(channel) ?? []), asset])
  }
  for (const asset of lights) {
    // The night keeps names unique where file names repeat across nights.
    const night = (asset.sessionId && state.catalog.sessions[asset.sessionId]?.night) || "night"
    const stem = `${night}_${asset.fileName.replace(/\.(fits?|xisf)$/i, "")}`
    add(`${out}/calibrated/pp_${stem}.fit`, asset.sizeBytes * 2, "fits")
    add(`${out}/registered/r_pp_${stem}.fit`, asset.sizeBytes * 2, "fits")
  }
  add(`${out}/calibrated/pp_light.seq`, 18_200, "text")
  add(`${out}/registered/r_pp_light.seq`, 18_600, "text")
  add(`${out}/cache/star_lists.tmp`, 4_200_000, "other")
  add(`${out}/cache/registration.cache`, 1_100_000, "other")
  add(`${out}/cache/stacking.lock`, 64, "other")
  const sample = lights[0]!.observed
  const objectName = (view.targetId && state.catalog.targets[view.targetId]?.name) || sample.object || "Target"
  const safe = objectName.replace(/\s+/g, "")
  for (const [channel, assets] of byChannel) {
    add(`${out}/${safe}_${channel}_stacked.fit`, assets[0]!.sizeBytes * 2, "fits", {
      ...sample,
      imageType: "unknown",
      object: objectName,
      filter: channel,
      exposureS: assets.reduce((sum, a) => sum + a.observed.exposureS, 0),
    })
  }
  // A master flat generated from raw flats of the first channel (J26 P1, H4).
  const firstChannel = [...byChannel.keys()][0] ?? "L"
  add(`${out}/master/master_flat_${firstChannel}.fit`, sample.widthPx * sample.heightPx * 4, "fits", {
    ...sample,
    imageType: "master-flat",
    object: null,
    filter: firstChannel,
    exposureS: 1.5,
    ra: null,
    dec: null,
    rotationDeg: null,
    siteLat: null,
    siteLon: null,
  })
  add(`${out}/siril.log`, 96_000, "log")
  add(`${out}/session-export.bin`, 12_288, "other")
  add(`${out}/${safe}_HOO_drizzle.fit`, sample.widthPx * sample.heightPx * 4, "fits", null, true)
  if (files.length === 0) return { ok: false, message: `Nothing new to write: the application output already exists in ${out}.` }
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, files) }))
  return { ok: true, message: `Wrote ${files.length} files into ${out}. One file is still being written.` }
}

/** The application finishes writing every growing file under `folder`. */
export function finishWriting(folder: string): ControlOutcome {
  const growing = Object.values(store.getState().disk.files).filter((f) => f.growing && isUnder(f.path, folder))
  if (growing.length === 0) return { ok: false, message: "No file is being written there." }
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, growing.map((f) => ({ ...f, growing: false, modifiedAt: nowIso() }))) }))
  return { ok: true, message: `${growing.map((f) => baseName(f.path)).join(", ")} finished writing.` }
}

/** Save a final image outside the View (J26 P3, J27 P5). */
export function saveExternalImage(path: string): ControlOutcome {
  const disk = store.getState().disk
  if (!/\.(tiff?|png|jpe?g|fits?|xisf)$/i.test(path)) return { ok: false, message: "Path: use an image file name ending in .tif, .png, .jpg, .fit or .xisf." }
  const volumeId = volumeForPath(disk, path)
  if (!volumeId || !disk.volumes[volumeId]?.mounted) return { ok: false, message: `Path: no mounted volume holds ${parentFolder(path)}.` }
  if (fileAt(disk, path)) return { ok: false, message: `Path: ${path} already exists. Nothing was overwritten.` }
  const kind = /\.tiff?$/i.test(path) ? "tiff" : /\.xisf$/i.test(path) ? "xisf" : /\.fits?$/i.test(path) ? "fits" : "other"
  const file = makeFile({ path, volumeId, sizeBytes: 156_400_000, kind, modifiedAt: nowIso() })
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, [file]) }))
  return { ok: true, message: `Saved ${baseName(path)} in ${parentFolder(path)}.` }
}

/** The file at `path` and every other hardlink to its bytes (same volume and inode); a symlink is only itself. */
function linkedFiles(disk: Disk, file: DiskFile): DiskFile[] {
  if (file.linkTarget) return [file]
  return Object.values(disk.files).filter((f) => !f.linkTarget && f.volumeId === file.volumeId && f.inode === file.inode)
}

/**
 * J26/J28 P5 helper: overwrite a file in place with same-size bytes and put
 * its modification time back, so size and mtime match while content differs.
 * Every hardlink to the inode shows the new bytes. A second overwrite is
 * refused until the saved bytes are restored, so they are never lost.
 */
export function overwriteKeepingStat(path: string): ControlOutcome {
  const disk = store.getState().disk
  const file = fileAt(disk, path)
  if (!file) return { ok: false, message: `No file at ${path}.` }
  if (file.previousSha256) return { ok: false, message: `${baseName(path)} is already overwritten. Restore its saved bytes first; a second overwrite would lose them.` }
  const sha256 = fakeSha256(path, Number.parseInt(file.sha256.slice(0, 3), 16) + 7)
  const links = linkedFiles(disk, file)
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, links.map((f) => ({ ...f, previousSha256: f.sha256, sha256 }))) }))
  const others = links.length - 1
  return { ok: true, message: `Overwrote ${baseName(path)}${others > 0 ? ` and ${plural(others, "other hardlink")} to the same bytes` : ""}: same size and modification time, different bytes.` }
}

/** Put back the saved bytes and modification time (J26 S7a, J28 S9a), on every hardlink that shares them. */
export function restoreKeepingStat(path: string): ControlOutcome {
  const disk = store.getState().disk
  const file = fileAt(disk, path)
  if (!file?.previousSha256) return { ok: false, message: `${baseName(path)} has no saved bytes to restore.` }
  const links = linkedFiles(disk, file).filter((f) => f.previousSha256)
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, links.map((f): DiskFile => ({ ...f, sha256: f.previousSha256!, previousSha256: null }))) }))
  return { ok: true, message: `Restored the saved bytes of ${baseName(path)}.` }
}

/** Finder's Put Back for files this View sent to the OS Trash (J27 S9). */
export function putBackFromTrash(trashedAt: string, originalPath: string): ControlOutcome {
  const disk = store.getState().disk
  const entry = disk.trash.find((t) => t.trashedAt === trashedAt && t.originalPath === originalPath)
  if (!entry) return { ok: false, message: "That item is no longer in the OS Trash." }
  if (fileAt(disk, originalPath)) return { ok: false, message: `${originalPath} is occupied, so Put Back would overwrite it. Nothing changed.` }
  store.setState((s) => ({
    ...s,
    disk: { ...writeFiles(s.disk, [{ ...entry.file, path: originalPath }]), trash: s.disk.trash.filter((t) => t !== entry) },
  }))
  return { ok: true, message: `Put back ${baseName(originalPath)} to ${parentFolder(originalPath)}.` }
}
