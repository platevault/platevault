/**
 * T5 file helpers: View folders, output discovery and prepared entries.
 *
 * Everything here reads the simulated disk and the catalog; nothing writes.
 * Prepared entries follow the T4 layout under `preparation.viewPath`:
 * `lights/`, `calibration/` and `products/` hold one entry per input, and
 * `platevault-handoff.txt` at the root is the exact path list (not an entry).
 */
import { fileKey, filesUnder, volumeForPath } from "@/domain/disk"
import { isUnder, stableHash } from "@/domain/indexing"
import type {
  Asset,
  AssetId,
  Catalog,
  CalibrationMaster,
  Disk,
  DiskFile,
  MasterId,
  Preparation,
  ResultId,
  ResultKind,
  ResultRecord,
  View,
  ViewId,
} from "@/domain/types"
import type { Inspection } from "@/store/slices/t5"

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1)
}

export function parentFolder(path: string): string {
  return path.slice(0, path.lastIndexOf("/"))
}

/** Preparations of a View, oldest first. */
export function viewPreparations(catalog: Catalog, viewId: ViewId): Preparation[] {
  return Object.values(catalog.preparations)
    .filter((p) => p.viewId === viewId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function latestPreparation(catalog: Catalog, viewId: ViewId): Preparation | null {
  return viewPreparations(catalog, viewId).at(-1) ?? null
}

/** The recorded output location: the latest preparation's, else the View's own. */
export function outputLocation(catalog: Catalog, view: View): string | null {
  return latestPreparation(catalog, view.id)?.outputPath ?? view.outputPath ?? null
}

/** Membership the View works from: the latest committed revision. */
export function latestMembership(view: View) {
  return view.revisions.at(-1) ?? null
}

export type FileAvailability = "available" | "offline" | "absent"

/** A path's availability: its volume mounted and the file present. */
export function pathAvailability(disk: Disk, path: string): { availability: FileAvailability; file: DiskFile | undefined } {
  const volumeId = volumeForPath(disk, path)
  const volume = volumeId ? disk.volumes[volumeId] : undefined
  if (!volume?.mounted) return { availability: "offline", file: undefined }
  const file = disk.files[fileKey(volume.id, path)]
  return { availability: file ? "available" : "absent", file }
}

export function volumeNameFor(disk: Disk, path: string): string {
  const volumeId = volumeForPath(disk, path)
  return (volumeId && disk.volumes[volumeId]?.name) || "Unknown volume"
}

// ---------------------------------------------------------------------------
// Output discovery (RES-FR-01, H1)
// ---------------------------------------------------------------------------

export type OutputRole = "calibrated" | "registered" | "intermediate" | "temp" | "log" | "master" | "product" | "unknown"

export const OUTPUT_ROLE_LABEL: Record<OutputRole, string> = {
  calibrated: "Calibrated intermediate",
  registered: "Registered intermediate",
  intermediate: "Other intermediate",
  temp: "Temporary file or cache",
  log: "Log or manifest",
  master: "Generated calibration master",
  product: "Result candidate",
  unknown: "Unknown file",
}

const IMAGE_EXT = /\.(fits?|fts|xisf)$/
const FINAL_EXT = /\.(tiff?|png|jpe?g)$/

/** Role of a file found in a View folder, from its path, name and header. */
export function classifyOutputFile(file: DiskFile, root: string): OutputRole {
  const rel = (isUnder(file.path, root) ? file.path.slice(root.length + 1) : baseName(file.path)).toLowerCase()
  const name = baseName(rel)
  if (file.header?.imageType.startsWith("master-")) return "master"
  if (/^master[-_]?(flat|dark|bias|darkflat|dark-flat)/.test(name)) return "master"
  if (/(^|\/)(cache|tmp|temp)\//.test(rel) || /\.(tmp|temp|cache|part|lock)$/.test(name)) return "temp"
  if (/\.log$/.test(name) || /(manifest|handoff)/.test(name)) return "log"
  if (/(^|\/)(registered|aligned)\//.test(rel) || /^r_/.test(name) || /_r\.(xisf|fits?)$/.test(name)) return "registered"
  if (/(^|\/)calibrated\//.test(rel) || /^pp_/.test(name) || /_c\.(xisf|fits?)$/.test(name)) return "calibrated"
  if (
    /\.(seq|xdrz|drz|lnorm|xnml)$/.test(name) ||
    /(^|\/)(process|debayered|cosmetized|fastintegration|normalized)\//.test(rel) ||
    /_(cc|d|n)\.(xisf|fits?)$/.test(name)
  )
    return "intermediate"
  if (FINAL_EXT.test(name)) return "product"
  if (IMAGE_EXT.test(name) && /(stack|masterlight|integration|result|drizzle|mosaic|panel)/.test(name)) return "product"
  return "unknown"
}

export interface OutputFile {
  file: DiskFile
  role: OutputRole
}

export interface OutputInventory {
  root: string
  availability: "online" | "offline"
  files: OutputFile[]
}

export function outputInventory(disk: Disk, root: string): OutputInventory {
  const volumeId = volumeForPath(disk, root)
  if (!volumeId || !disk.volumes[volumeId]?.mounted) return { root, availability: "offline", files: [] }
  const files = filesUnder(disk, root)
    .map((file) => ({ file, role: classifyOutputFile(file, root) }))
    .sort((a, b) => a.file.path.localeCompare(b.file.path))
  return { root, availability: "online", files }
}

/** Kind and channel inferred for a discovered product (shown as "where known"). */
export function inferProduct(file: DiskFile): { kind: ResultKind | null; channel: string | null } {
  const name = baseName(file.path)
  const channel =
    file.header?.filter ?? name.match(/FILTER-([A-Za-z0-9]+)/)?.[1] ?? name.match(/[_-](Ha|OIII|SII|L|R|G|B|HOO|SHO)(?=[_.-])/)?.[1] ?? null
  if (FINAL_EXT.test(name.toLowerCase())) return { kind: "final-image", channel }
  if (/(mosaic|panel)/i.test(name)) return { kind: "mosaic-panel", channel }
  return { kind: "linear-integration", channel }
}

export function resultIdFor(viewId: ViewId, path: string): ResultId {
  return `res_${stableHash(`${viewId}|${path}`)}`
}

export const RESULT_KIND_LABEL: Record<ResultKind, string> = {
  "final-image": "Final image",
  "linear-integration": "Linear integration",
  "channel-product": "Channel product",
  "mosaic-panel": "Mosaic panel",
}

export function kindLabel(kind: ResultKind | null, channel: string | null): string {
  if (!kind) return "Kind not set"
  return channel ? `${RESULT_KIND_LABEL[kind]} · ${channel}` : RESULT_KIND_LABEL[kind]
}

export interface ResultRow {
  id: ResultId
  viewId: ViewId
  path: string
  fileName: string
  record: ResultRecord | null
  file: DiskFile | undefined
  availability: FileAvailability
  kind: ResultKind | null
  channel: string | null
  discovered: ResultRecord["discovered"]
  processingState: ResultRecord["processingState"]
  association: ResultRecord["association"]
  lineage: ResultRecord["lineage"]
  acceptance: ResultRecord["acceptance"]
  acceptedAt: string | null
  /** SHA-256 recorded at acceptance; null for candidates. */
  acceptedSha: string | null
  /** SHA-256 of the bytes on disk now; null when unavailable. */
  currentSha: string | null
}

/** Why a product's bytes no longer match its inspection, or null when they still do (RES-AC-10). */
export function inspectionDrift(inspection: Inspection | undefined, file: DiskFile | undefined): string | null {
  if (!inspection) return "Not inspected: inspect it before accepting."
  if (!file || file.path !== inspection.path) return "Changed since inspection: the file is no longer at the inspected path. Inspect it again."
  if (file.growing) return "Changed since inspection: the file is being written again. Inspect it again once it is written."
  if (file.sha256 !== inspection.sha256) {
    return `Changed since inspection: its bytes no longer match the SHA-256 recorded when you inspected it (${inspection.sha256.slice(0, 12)}… now ${file.sha256.slice(0, 12)}…). Inspect it again.`
  }
  if (file.sizeBytes !== inspection.sizeBytes || file.inode !== inspection.inode || file.modifiedAt !== inspection.modifiedAt) {
    return "Changed since inspection: its size, modification time or file identity changed. Inspect it again."
  }
  return null
}

function rowFromRecord(disk: Disk, record: ResultRecord): ResultRow {
  const { availability, file } = pathAvailability(disk, record.path)
  return {
    id: record.id,
    viewId: record.viewId,
    path: record.path,
    fileName: baseName(record.path),
    record,
    file,
    availability,
    kind: record.kind,
    channel: record.channel,
    discovered: record.discovered,
    processingState: file?.growing ? "pending" : record.processingState === "pending" && file ? "written" : record.processingState,
    association: record.association,
    lineage: record.lineage,
    acceptance: record.acceptance,
    acceptedAt: record.acceptedAt,
    acceptedSha: record.acceptance === "accepted" ? record.sha256 : null,
    currentSha: file?.sha256 ?? null,
  }
}

/**
 * Result rows of a View: recorded Results (attached or accepted) plus product
 * candidates found in the recorded output location. A file in the folder is
 * never accepted by being there, and its lineage stays Unknown.
 */
export function resultRowsForView(disk: Disk, catalog: Catalog, view: View): ResultRow[] {
  const records = Object.values(catalog.results).filter((r) => r.viewId === view.id)
  const rows = records.map((record) => rowFromRecord(disk, record))
  const known = new Set(records.map((r) => r.path))
  const root = outputLocation(catalog, view)
  if (root) {
    for (const { file, role } of outputInventory(disk, root).files) {
      const pending = file.growing && role !== "master" && role !== "log" && role !== "temp"
      if ((role !== "product" && !pending) || known.has(file.path)) continue
      const inferred = inferProduct(file)
      rows.push({
        id: resultIdFor(view.id, file.path),
        viewId: view.id,
        path: file.path,
        fileName: baseName(file.path),
        record: null,
        file,
        availability: "available",
        kind: file.growing ? null : inferred.kind,
        channel: inferred.channel,
        discovered: "output-location",
        processingState: file.growing ? "pending" : "written",
        association: "tool-recorded",
        lineage: "unknown",
        acceptance: "candidate",
        acceptedAt: null,
        acceptedSha: null,
        currentSha: file.sha256,
      })
    }
  }
  return rows.sort((a, b) => a.fileName.localeCompare(b.fileName))
}

/** Accepted Results whose View lists them as product inputs (RES-AC-04). */
export function dependentViews(catalog: Catalog, resultId: ResultId): View[] {
  return Object.values(catalog.views).filter((v) => {
    const content = v.draft ?? latestMembership(v)
    return content?.productInputs.includes(resultId)
  })
}

// ---------------------------------------------------------------------------
// Prepared entries (T4 layout) and retained-original proof (STO-FR-04)
// ---------------------------------------------------------------------------

export type EntryKind = "symlink" | "hardlink" | "copy"

export interface PreparedEntry {
  file: DiskFile
  folder: "lights" | "calibration" | "products"
  kind: EntryKind
  assetId: AssetId | null
  masterId: MasterId | null
  resultId: ResultId | null
  preparationId: string
}

const ENTRY_FOLDERS = ["lights", "calibration", "products"] as const

function entryKind(entry: DiskFile, preparation: Preparation, sources: DiskFile[]): EntryKind {
  if (entry.linkTarget) return "symlink"
  if (preparation.mode === "linked" && preparation.linkType === "hardlink") return "hardlink"
  if (sources.some((s) => s.inode === entry.inode && s.path !== entry.path)) return "hardlink"
  return "copy"
}

/** Source files currently on disk for an asset's recorded copies. */
export function assetCopyFiles(disk: Disk, asset: Asset): DiskFile[] {
  return asset.copies.map((c) => disk.files[fileKey(c.volumeId, c.path)]).filter((f): f is DiskFile => f !== undefined)
}

/** `<dir>/<dir>/<file>`: the last two folders and the name, as T4 lays out entries. */
function tailPath(path: string): string {
  return path.split("/").slice(-3).join("/")
}

/**
 * Prepared input entries of one preparation, matched by path under the View
 * folder: `lights/<dir>/<dir>/<file>` (or the flat `lights/<file>` of older
 * preparations), the same under `calibration/` and `products/`.
 */
export function preparedEntries(disk: Disk, catalog: Catalog, preparation: Preparation): PreparedEntry[] {
  if (preparation.mode === "direct-source") return []
  type Source = { asset?: Asset; master?: CalibrationMaster; result?: ResultRecord }
  const byRel = new Map<string, Source>()
  const index = (folder: string, path: string, source: Source) => {
    byRel.set(`${folder}/${tailPath(path)}`, source)
    if (!byRel.has(`${folder}/${baseName(path)}`)) byRel.set(`${folder}/${baseName(path)}`, source)
  }
  for (const id of preparation.preparedAssetIds) {
    const asset = catalog.assets[id]
    if (asset) for (const copy of asset.copies) index("lights", copy.path, { asset })
  }
  for (const master of Object.values(catalog.masters)) {
    index("calibration", master.path, { master })
    index("calibration", master.origin.sourcePath, { master })
  }
  for (const assignment of catalog.views[preparation.viewId]?.calibration ?? []) {
    if (assignment.input?.type !== "raw-set") continue
    for (const id of catalog.sessions[assignment.input.sessionId]?.assetIds ?? []) {
      const asset = catalog.assets[id]
      if (asset) for (const copy of asset.copies) index("calibration", copy.path, { asset })
    }
  }
  for (const id of preparation.preparedResultIds) {
    const result = catalog.results[id]
    if (result) index("products", result.path, { result })
  }
  const entries: PreparedEntry[] = []
  for (const folder of ENTRY_FOLDERS) {
    const root = `${preparation.viewPath}/${folder}`
    for (const file of filesUnder(disk, root)) {
      const rel = file.path.slice(preparation.viewPath.length + 1)
      const source = byRel.get(`${folder}/${tailPath(rel)}`) ?? byRel.get(`${folder}/${baseName(rel)}`) ?? {}
      const sources = source.asset ? assetCopyFiles(disk, source.asset) : []
      entries.push({
        file,
        folder,
        kind: entryKind(file, preparation, sources),
        assetId: source.asset?.id ?? null,
        masterId: source.master?.id ?? null,
        resultId: source.result?.id ?? null,
        preparationId: preparation.id,
      })
    }
  }
  return entries
}

export interface RetainedProof {
  state: "not-needed" | "verified" | "insufficient" | "unavailable"
  text: string
  keptPath: string | null
}

/**
 * Proof that removing a prepared entry keeps the original bytes (STO-FR-04,
 * STO-AC-04). A link holds no bytes. A hardlink or copy needs a byte-identical
 * copy outside the View folder that exists right now.
 */
export function retainedOriginal(disk: Disk, catalog: Catalog, entry: PreparedEntry, viewPath: string): RetainedProof {
  if (entry.kind === "symlink") return { state: "not-needed", text: "Link holds no image bytes; its target is not followed.", keptPath: null }
  if (entry.assetId) {
    const asset = catalog.assets[entry.assetId]
    if (!asset) return { state: "insufficient", text: "Insufficient retained-original proof: the frame is not in the catalog.", keptPath: null }
    let offlineVolume: string | null = null
    for (const copy of asset.copies) {
      if (isUnder(copy.path, viewPath)) continue
      const volume = disk.volumes[copy.volumeId]
      if (!volume?.mounted) {
        offlineVolume = volume?.name ?? "its volume"
        continue
      }
      const file = disk.files[fileKey(copy.volumeId, copy.path)]
      if (file && file.sha256 === asset.sha256 && file.path !== entry.file.path) {
        return { state: "verified", text: `Retained original verified: ${copy.path}`, keptPath: copy.path }
      }
    }
    if (offlineVolume) return { state: "unavailable", text: `Original on ${offlineVolume} is offline; it cannot be verified now.`, keptPath: null }
    return {
      state: "insufficient",
      text: "Insufficient retained-original proof: no other copy of these bytes exists. This entry may hold the last copy.",
      keptPath: null,
    }
  }
  if (entry.masterId) {
    const master = catalog.masters[entry.masterId]
    const found = master ? pathAvailability(disk, master.path) : null
    if (found?.availability === "available") return { state: "verified", text: `Master kept: ${master!.path}`, keptPath: master!.path }
    if (found?.availability === "offline") return { state: "unavailable", text: "The calibration master is offline; it cannot be verified now.", keptPath: null }
    return { state: "insufficient", text: "Insufficient retained-original proof: the calibration master was not found.", keptPath: null }
  }
  if (entry.resultId) {
    const result = catalog.results[entry.resultId]
    const found = result ? pathAvailability(disk, result.path) : null
    if (found?.file && found.file.sha256 === result!.sha256) return { state: "verified", text: `Accepted Result kept: ${result!.path}`, keptPath: result!.path }
    if (found?.availability === "offline") return { state: "unavailable", text: "The accepted Result is offline; it cannot be verified now.", keptPath: null }
    return { state: "insufficient", text: "Insufficient retained-original proof: the accepted Result's bytes were not found unchanged.", keptPath: null }
  }
  return { state: "insufficient", text: "Insufficient retained-original proof: PlateVault cannot tell which input this entry holds.", keptPath: null }
}

/** Assets by content identity, for duplicate detection. */
export function assetsBySha(catalog: Catalog): Map<string, Asset> {
  const map = new Map<string, Asset>()
  for (const asset of Object.values(catalog.assets)) map.set(asset.sha256, asset)
  return map
}

/** A verified copy of `asset` outside `excludeFolder` that exists now. */
export function verifiedCopyOutside(disk: Disk, asset: Asset, excludeFolder: string): string | null {
  for (const copy of asset.copies) {
    if (isUnder(copy.path, excludeFolder)) continue
    const file = disk.volumes[copy.volumeId]?.mounted ? disk.files[fileKey(copy.volumeId, copy.path)] : undefined
    if (file && file.sha256 === asset.sha256) return copy.path
  }
  return null
}
