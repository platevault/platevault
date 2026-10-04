/**
 * Cleanup plan for one View (spec 071 STO-FR-01..05, STO-FR-10; J27 S4-S11).
 * Derived from the disk and catalog on every render; nothing here writes.
 */
import { fileKey, filesUnder, volumeForPath } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import type { Catalog, Disk, DiskFile, Preparation, ResultRecord, View, VolumeId } from "@/domain/types"
import {
  assetsBySha,
  baseName,
  classifyOutputFile,
  dependentViews,
  type EntryKind,
  kindLabel,
  latestPreparation,
  OUTPUT_ROLE_LABEL,
  type OutputRole,
  preparedEntries,
  type RetainedProof,
  retainedOriginal,
  verifiedCopyOutside,
  viewPreparations,
} from "./files"

export type CleanupGroupId =
  | "calibrated"
  | "registered"
  | "intermediate"
  | "temp"
  | "prepared"
  | "replaced"
  | "duplicates"
  | "logs"
  | "candidates"
  | "unknown"
  | "keep"

export interface CleanupGroupMeta {
  label: string
  description: string
  /** Recognized regenerable groups start selected (STO-FR-01). */
  preselected: boolean
}

export const GROUPS: Record<CleanupGroupId, CleanupGroupMeta> = {
  calibrated: { label: "Calibrated intermediates", description: "Calibrated frames the application can regenerate.", preselected: true },
  registered: { label: "Registered intermediates", description: "Registered or aligned frames the application can regenerate.", preselected: true },
  intermediate: {
    label: "Other intermediates",
    description: "Other recognized processing intermediates, including stacking and calibration XISF files.",
    preselected: true,
  },
  temp: { label: "Temporary files and caches", description: "Temporary files and caches written during processing.", preselected: true },
  prepared: {
    label: "Prepared inputs",
    description: "Links, copies or clones PlateVault prepared for the application. Removing a copy or hardlink needs a verified retained original.",
    preselected: false,
  },
  replaced: {
    label: "Replaced preparation entries",
    description: "Entries of an earlier preparation of this View that a later preparation replaced (D09).",
    preselected: false,
  },
  duplicates: { label: "Verified duplicates", description: "Byte-identical copies of indexed frames. The kept copy is named for each file.", preselected: false },
  logs: { label: "Logs and manifests", description: "Application logs and the PlateVault handoff list.", preselected: false },
  candidates: { label: "Unaccepted result candidates", description: "Products you have not accepted as Results.", preselected: false },
  unknown: { label: "Unknown files", description: "Files PlateVault does not recognize. They stay unselected.", preselected: false },
  keep: {
    label: "Keep",
    description: "Accepted Results and calibration masters are protected. Removing one needs a separate selection, and the review names what depends on it.",
    preselected: false,
  },
}

export const GROUP_ORDER: CleanupGroupId[] = [
  "calibrated",
  "registered",
  "intermediate",
  "temp",
  "prepared",
  "replaced",
  "duplicates",
  "logs",
  "candidates",
  "unknown",
  "keep",
]

export interface CleanupEntry {
  key: string
  path: string
  volumeId: VolumeId
  group: CleanupGroupId
  role: string
  sizeBytes: number
  sha256: string
  inode: number
  linkKind: EntryKind | null
  /** Bytes a removal is expected to free; null when not guaranteed. */
  reclaimBytes: number | null
  reclaimNote: string
  references: string[]
  proof: RetainedProof | null
  /** Why removal would be refused right now, if it would. */
  blocked: string | null
  /** For protected products: the Views, Project and Target that depend on it. */
  dependents: string[]
  assetId: string | null
  resultId: string | null
}

export interface CleanupPlan {
  view: View
  preparation: Preparation
  viewPath: string
  outputPath: string
  complete: boolean
  directSource: boolean
  online: boolean
  entries: CleanupEntry[]
}

/** Groups a user may change now: before Complete only replaced entries (STO-FR-10). */
export function groupEligible(plan: CleanupPlan, group: CleanupGroupId): boolean {
  return plan.complete || group === "replaced"
}

function trashBlock(disk: Disk, file: DiskFile): string | null {
  if (disk.volumes[file.volumeId]?.trash === "unsupported") {
    return `OS Trash is unsupported on ${disk.volumes[file.volumeId]?.name ?? "this volume"}: removal there would delete immediately, so PlateVault refuses it.`
  }
  if (disk.readOnlyPaths.some((p) => isUnder(file.path, p))) return "Write permission removed: the file cannot be moved to the OS Trash."
  return null
}

export function cleanupPlan(disk: Disk, catalog: Catalog, view: View): CleanupPlan | null {
  const preparation = latestPreparation(catalog, view.id)
  if (!preparation) return null
  const viewPath = preparation.viewPath
  const outputPath = preparation.outputPath
  const volumeId = volumeForPath(disk, viewPath)
  const online = Boolean(volumeId && disk.volumes[volumeId]?.mounted)
  const project = view.projectId ? catalog.projects[view.projectId] : null
  const target = view.targetId ? catalog.targets[view.targetId] : null
  const results = Object.values(catalog.results)
  const acceptedByPath = new Map<string, ResultRecord>()
  for (const r of results) if (r.acceptance === "accepted") acceptedByPath.set(r.path, r)
  const masterSources = new Set<string>()
  for (const m of Object.values(catalog.masters)) {
    masterSources.add(m.origin.sourcePath)
    masterSources.add(m.path)
  }
  const bySha = assetsBySha(catalog)
  const otherViewsOf = (assetId: string) =>
    Object.values(catalog.views)
      .filter((v) => v.id !== view.id && (v.revisions.at(-1)?.included.includes(assetId) ?? false))
      .map((v) => `Also an input of View ${v.name}`)

  const entries: CleanupEntry[] = []
  const claimed = new Set<string>()
  const inodeCount = new Map<string, number>()
  for (const file of Object.values(disk.files)) {
    if (file.linkTarget) continue
    const key = `${file.volumeId}:${file.inode}`
    inodeCount.set(key, (inodeCount.get(key) ?? 0) + 1)
  }
  const sharesInode = (file: DiskFile) => (inodeCount.get(`${file.volumeId}:${file.inode}`) ?? 0) > 1

  function push(file: DiskFile, partial: Omit<CleanupEntry, "key" | "path" | "volumeId" | "sizeBytes" | "sha256" | "inode">) {
    const key = fileKey(file.volumeId, file.path)
    claimed.add(key)
    entries.push({ key, path: file.path, volumeId: file.volumeId, sizeBytes: file.sizeBytes, sha256: file.sha256, inode: file.inode, ...partial })
  }

  function addPrepared(prep: Preparation, group: "prepared" | "replaced") {
    for (const entry of preparedEntries(disk, catalog, prep)) {
      const proof = retainedOriginal(disk, catalog, entry, prep.viewPath)
      const isLink = entry.kind === "symlink"
      const reclaimBytes = isLink || entry.kind === "hardlink" || sharesInode(entry.file) ? 0 : entry.file.sizeBytes
      const reclaimNote = isLink
        ? "0 B: a link holds no image bytes"
        : entry.kind === "hardlink"
          ? "Shares bytes with the original; reclaim not guaranteed"
          : "Copy: its own bytes"
      const what = entry.folder === "lights" ? "light frame" : entry.folder === "calibration" ? "calibration input" : "product input"
      push(entry.file, {
        group,
        role: `Prepared ${what} (${entry.kind})`,
        linkKind: entry.kind,
        reclaimBytes,
        reclaimNote,
        references: entry.assetId ? otherViewsOf(entry.assetId) : [],
        proof,
        blocked: proof.state === "insufficient" || proof.state === "unavailable" ? proof.text : trashBlock(disk, entry.file),
        dependents: [],
        assetId: entry.assetId,
        resultId: entry.resultId,
      })
    }
  }

  if (online) {
    addPrepared(preparation, "prepared")
    for (const older of viewPreparations(catalog, view.id)) {
      if (older.id === preparation.id || older.viewPath === preparation.viewPath) continue
      addPrepared(older, "replaced")
    }
    const roleGroup: Record<OutputRole, CleanupGroupId> = {
      calibrated: "calibrated",
      registered: "registered",
      intermediate: "intermediate",
      temp: "temp",
      log: "logs",
      master: "keep",
      product: "candidates",
      unknown: "unknown",
    }
    for (const file of filesUnder(disk, viewPath)) {
      const key = fileKey(file.volumeId, file.path)
      if (claimed.has(key)) continue
      const accepted = acceptedByPath.get(file.path)
      const reclaimBytes = file.linkTarget || sharesInode(file) ? 0 : file.sizeBytes
      const reclaimNote = file.linkTarget ? "0 B: link" : sharesInode(file) ? "Shares bytes with another entry" : "Its own bytes"
      if (accepted || masterSources.has(file.path) || (file.header?.imageType.startsWith("master-") ?? false)) {
        const dependents = accepted
          ? [
              ...dependentViews(catalog, accepted.id).map((v) => `Input of View ${v.name}`),
              ...(project ? [`Accepted Result on Project ${project.name}`] : []),
              ...(target ? [`Accepted Result on Target ${target.name}`] : []),
            ]
          : ["Generated calibration master source: Calibration keeps it until adoption is reviewed"]
        push(file, {
          group: "keep",
          role: accepted ? `Accepted Result: ${kindLabel(accepted.kind, accepted.channel)}${accepted.contentState === "drifted" ? " (drifted)" : ""}` : OUTPUT_ROLE_LABEL.master,
          linkKind: null,
          reclaimBytes,
          reclaimNote,
          references: [],
          proof: null,
          blocked: trashBlock(disk, file),
          dependents,
          assetId: null,
          resultId: accepted?.id ?? null,
        })
        continue
      }
      const duplicateOf = !file.linkTarget ? bySha.get(file.sha256) : undefined
      if (duplicateOf) {
        const kept = verifiedCopyOutside(disk, duplicateOf, viewPath)
        push(file, {
          group: "duplicates",
          role: "Verified duplicate",
          linkKind: null,
          reclaimBytes,
          reclaimNote,
          references: [],
          proof: kept
            ? { state: "verified", text: `Verified copy kept: ${kept}`, keptPath: kept }
            : { state: "insufficient", text: "No verified copy outside this View exists now; this may be the last copy.", keptPath: null },
          blocked: kept ? trashBlock(disk, file) : "No verified copy outside this View exists now; this may be the last copy.",
          dependents: [],
          assetId: duplicateOf.id,
          resultId: null,
        })
        continue
      }
      const role = baseName(file.path) === "platevault-handoff.txt" ? "log" : classifyOutputFile(file, isUnder(file.path, outputPath) ? outputPath : viewPath)
      push(file, {
        group: roleGroup[role],
        role: baseName(file.path) === "platevault-handoff.txt" ? "PlateVault handoff list" : OUTPUT_ROLE_LABEL[role],
        linkKind: file.linkTarget ? "symlink" : null,
        reclaimBytes,
        reclaimNote,
        references: [],
        proof: null,
        blocked: trashBlock(disk, file),
        dependents: [],
        assetId: null,
        resultId: null,
      })
    }
  }

  return {
    view,
    preparation,
    viewPath,
    outputPath,
    complete: Boolean(view.completedAt),
    directSource: preparation.mode === "direct-source",
    online,
    entries,
  }
}

/** Entries selected by default: recognized regenerable groups, eligible now. */
export function defaultSelection(plan: CleanupPlan): string[] {
  return plan.entries.filter((e) => GROUPS[e.group].preselected && groupEligible(plan, e.group)).map((e) => e.key)
}

export interface TrashSupportRow {
  volumeId: VolumeId
  name: string
  supported: boolean
  movable: number
  blocked: number
}

/** Trash support per volume for the selected entries (STO-FR-04). */
export function trashSupport(disk: Disk, entries: CleanupEntry[]): TrashSupportRow[] {
  const rows = new Map<VolumeId, TrashSupportRow>()
  for (const entry of entries) {
    const volume = disk.volumes[entry.volumeId]
    const row = rows.get(entry.volumeId) ?? {
      volumeId: entry.volumeId,
      name: volume?.name ?? entry.volumeId,
      supported: volume?.trash === "supported",
      movable: 0,
      blocked: 0,
    }
    if (entry.blocked) row.blocked += 1
    else row.movable += 1
    rows.set(entry.volumeId, row)
  }
  return [...rows.values()]
}
