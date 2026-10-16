/**
 * The OS Trash engine (foundation-owned; D-W26, D-W43, D-W57, D-W74).
 *
 * Every approved move to the OS Trash (Wrap up's Clean up and Trash offers,
 * Import Move sources, a calibration process's raws, a reviewed View
 * (previous) file, PlateVault's own unregistered copy at an adoption
 * destination) runs as one operation with visible per-item progress and
 * records one `TrashEpisode`. Nothing is ever deleted permanently: a file
 * goes to `disk.trash`, or it is kept and listed as refused with its reason
 * (`trashBlock`, asked again for every item; it keeps a file an open
 * Project's View links, P-TRASH2). A file's links in kept Views go with it.
 * A frame with copies in several locations moves every copy, and if any
 * copy is refused the whole frame is refused (D-W57).
 */
import { stepRecord } from "@/domain/calibration-process"
import { fileAt, filesUnder, removeFile } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import { unitCount } from "@/domain/labels"
import { keptViewLinks, type TrashItem, trashBlock, viewLinks, type ViewLinks } from "@/domain/storage"
import type { AssetId, CalibrationProcessId, Catalog, Disk, DiskFile, OperationId, OperationItem, OperationKind, OperationUnit, ProjectId, TrashEpisode, TrashEpisodeKind } from "@/domain/types"
import { fileName, formatBytes, formatCount } from "@/lib/format"
import { joinRefs, type MessageRef, msg, verbatim } from "@/lib/i18n"
import { nowIso, type PrototypeState, store } from "@/store/core"
import { addOperation, ensureTicker, type OperationHandler, patchOperation, settleOperation } from "@/store/operations"
import { freshId } from "./shared"

/** One path to move; defined in the domain so the pure Trash offers (`domain/archive.ts`) can build items. */
export type { TrashItem }

export interface MoveToOsTrash {
  kind: TrashEpisodeKind
  title: MessageRef
  projectId: ProjectId | null
  items: TrashItem[]
  /** Roots whose emptied folders leave the disk once the episode settles (a View, View (previous)/); a folder still holding a file stays. */
  pruneFolders?: string[]
  /** What one item is, for progress and the summary; "items" by default. */
  unit?: OperationUnit
  href: string
  /** The calibration process whose Raws step this move is (P-CAL3); the episode settles that step. */
  calibrationProcessId?: CalibrationProcessId
}

/** Clean up is its own operation kind, so Wrap up's Clean up step reads its state apart from other trash moves. */
function operationKind(kind: TrashEpisodeKind): OperationKind {
  return kind === "view-cleanup" ? "cleanup" : "trash"
}

interface TrashPayload extends Omit<MoveToOsTrash, "title" | "items"> {
  queue: TrashItem[][]
  done: TrashEpisode["items"]
  episodeId: string
}

/** Every file under a folder, as items; a folder on a volume that is not mounted is one refused item ("Offline"). */
export function folderItems(state: Pick<PrototypeState, "disk">, folder: string): TrashItem[] {
  const files = filesUnder(state.disk, folder)
  if (files.length > 0) return files.map((file) => ({ path: file.path }))
  const volume = Object.values(state.disk.volumes).find((v) => isUnder(folder, v.mountPath))
  return volume && !volume.mounted ? [{ path: folder, refusedReason: msg("run_cleanup_volume_offline", { name: volume.name }) }] : []
}

function groupItems(items: TrashItem[]): TrashItem[][] {
  const byAsset = new Map<string, TrashItem[]>()
  const groups: TrashItem[][] = []
  for (const item of items) {
    if (!item.assetId) {
      groups.push([item])
      continue
    }
    const group = byAsset.get(item.assetId)
    if (group) group.push(item)
    else {
      const fresh = [item]
      byAsset.set(item.assetId, fresh)
      groups.push(fresh)
    }
  }
  return groups
}

/** Start the move; returns the operation id. Settles with exact counts in Activity. */
export function moveToOsTrash(input: MoveToOsTrash): OperationId {
  let id = ""
  store.setState((s) => {
    const queued = queueOsTrash(s, input)
    id = queued.operationId
    return queued.state
  })
  ensureTicker()
  return id
}

/** The move as a state change, for a `commit` mutator or an operation step; the caller runs `ensureTicker()`. */
export function queueOsTrash(state: PrototypeState, input: MoveToOsTrash): { state: PrototypeState; operationId: OperationId } {
  const unit = input.unit ?? "items"
  const payload: TrashPayload = {
    kind: input.kind,
    projectId: input.projectId,
    pruneFolders: input.pruneFolders ?? [],
    unit,
    href: input.href,
    calibrationProcessId: input.calibrationProcessId,
    queue: groupItems(input.items),
    done: [],
    episodeId: freshId("trash", input.kind),
  }
  const added = addOperation(state, {
    kind: operationKind(input.kind),
    title: input.title,
    scope: { projectId: input.projectId ?? undefined },
    total: input.items.length,
    unit,
    items: input.items.map((item) => ({ id: item.path, label: verbatim(fileName(item.path)), path: item.path, status: "pending", phase: null, detail: item.refusedReason ?? null })),
    payload: payload as unknown as Record<string, unknown>,
    canCancel: false,
  })
  return { state: added.state, operationId: added.id }
}

function refusal(disk: Disk, links: ViewLinks, item: TrashItem): MessageRef | null {
  return item.refusedReason ?? trashBlock(disk, links, item.path)?.reason ?? null
}

function toTrash(disk: Disk, file: DiskFile, at: string): Disk {
  return { ...removeFile(disk, file.volumeId, file.path), trash: [...disk.trash, { file, originalPath: file.path, trashedAt: at }] }
}

const GROUPS_PER_TICK = 12

function trashStep(kind: OperationKind): OperationHandler {
  return {
    kind,
    step(state, op) {
      const payload = op.payload as unknown as TrashPayload
      const links = viewLinks(state.catalog, state.disk)
      let disk = state.disk
      const queue = [...payload.queue]
      const done = [...payload.done]
      const outcomes = new Map<string, Pick<OperationItem, "status" | "detail">>()
      const at = nowIso()
      for (const group of queue.splice(0, GROUPS_PER_TICK)) {
        const reasons = group.map((item) => refusal(disk, links, item))
        const firstRefusal = reasons.find((r) => r !== null) ?? null
        for (const [index, item] of group.entries()) {
          const file = fileAt(disk, item.path)
          const base = { path: item.path, volumeId: file?.volumeId ?? "", sizeBytes: file?.linkTarget ? 0 : (file?.sizeBytes ?? 0), assetId: item.assetId ?? null }
          if (firstRefusal !== null) {
            // D-W57: one refused copy keeps every copy of the frame.
            const reason = reasons[index] ?? msg("op_trash_other_copy_refused", { reason: firstRefusal })
            done.push({ ...base, outcome: "refused", reason })
            outcomes.set(item.path, { status: "blocked", detail: reason })
            continue
          }
          disk = toTrash(disk, file!, at)
          // P-TRASH2: the file's links in kept Views go with it.
          for (const link of keptViewLinks(links, [item.path])) if (fileAt(disk, link.path)) disk = toTrash(disk, link, at)
          done.push({ ...base, outcome: "trashed", reason: null })
          outcomes.set(item.path, { status: "done", detail: msg("op_trash_moved") })
        }
      }
      const items = op.items.map((item) => (outcomes.has(item.id) ? { ...item, ...outcomes.get(item.id)! } : item))
      let next: PrototypeState = patchOperation({ ...state, disk }, op.id, {
        items,
        progress: { ...op.progress, done: done.length },
        payload: { ...payload, queue, done } as unknown as Record<string, unknown>,
      })
      if (queue.length > 0) return next
      next = settleEpisode(next, op.id, { ...payload, queue, done })
      const trashed = done.filter((i) => i.outcome === "trashed")
      const refused = done.length - trashed.length
      const bytes = trashed.reduce((n, i) => n + i.sizeBytes, 0)
      const unit = payload.unit ?? "items"
      const summary = msg("op_trash_summary", { trashed: unitCount(unit, trashed.length), bytes: formatBytes(bytes), refused: unitCount(unit, refused) })
      return settleOperation(next, op.id, refused > 0 && trashed.length === 0 ? "failed" : refused > 0 ? "partial" : "succeeded", summary, payload.href)
    },
  }
}

/** Folders under the roots that no longer hold a file leave the disk; a folder with a refused entry stays. */
function pruneEmptiedFolders(disk: Disk, roots: string[]): Disk {
  if (roots.length === 0) return disk
  const files = Object.values(disk.files)
  const holdsFile = (folder: Disk["folders"][number]) => files.some((f) => f.volumeId === folder.volumeId && f.path !== folder.path && isUnder(f.path, folder.path))
  return { ...disk, folders: disk.folders.filter((folder) => !roots.some((root) => isUnder(folder.path, root)) || holdsFile(folder)) }
}

/**
 * A Project's `View (previous)/` record after files left it: trashed
 * leftovers drop out, and the record goes once the folder is empty
 * (provisional, D-W110). Kept leftovers stay, still not asked about.
 */
export function withPreviousReconciled(catalog: Catalog, disk: Disk, projectId: ProjectId | null): Catalog {
  const project = projectId ? catalog.projects[projectId] : undefined
  const previous = project?.previous
  if (!project || !previous) return catalog
  const leftovers = previous.leftovers.filter((l) => fileAt(disk, `${previous.folderPath}/${l.path}`) !== undefined)
  const empty = leftovers.length === 0 && filesUnder(disk, previous.folderPath).length === 0
  if (!empty && leftovers.length === previous.leftovers.length) return catalog
  return { ...catalog, projects: { ...catalog.projects, [project.id]: { ...project, previous: empty ? null : { ...previous, leftovers }, revision: project.revision + 1 } } }
}

/** Record the episode, mark Trashed frames, settle a calibration process's Raws step and reconcile View (previous)/. */
function settleEpisode(state: PrototypeState, operationId: OperationId, payload: TrashPayload): PrototypeState {
  const at = nowIso()
  const episode: TrashEpisode = { id: payload.episodeId, kind: payload.kind, at, projectId: payload.projectId, items: payload.done, operationId }
  let catalog: Catalog = { ...state.catalog, assets: { ...state.catalog.assets } }
  const trashedPaths = new Set(payload.done.filter((i) => i.outcome === "trashed").map((i) => i.path))
  for (const assetId of new Set(payload.done.map((i) => i.assetId).filter((id): id is AssetId => id !== null))) {
    const asset = catalog.assets[assetId]
    if (!asset) continue
    const remaining = asset.copies.filter((c) => !trashedPaths.has(c.path))
    if (remaining.length === asset.copies.length) continue
    // A frame whose every copy went is Trashed; a duplicate copy only leaves the copy list (D-W74).
    catalog.assets[assetId] = remaining.length === 0 ? { ...asset, trashed: { at, episodeId: episode.id } } : { ...asset, copies: remaining }
  }
  catalog.trashEpisodes = { ...catalog.trashEpisodes, [episode.id]: episode }
  const process = payload.calibrationProcessId ? catalog.calibrationProcesses[payload.calibrationProcessId] : undefined
  if (process) {
    const refused = payload.done.filter((i) => i.outcome === "refused")
    const raws = refused.length === 0 ? stepRecord("done", at) : stepRecord("failed", at, joinRefs([msg("op_trash_frames_kept", { count: refused.length, n: formatCount(refused.length) }), refused[0]!.reason ?? msg("wrapup_refused")], " · "))
    catalog.calibrationProcesses = {
      ...catalog.calibrationProcesses,
      [process.id]: { ...process, raws: refused.length === 0 ? "trashed" : null, operationId: null, steps: { ...process.steps, raws }, updatedAt: at },
    }
  }
  const disk = pruneEmptiedFolders(state.disk, payload.pruneFolders ?? [])
  catalog = withPreviousReconciled(catalog, disk, payload.projectId)
  return { ...state, catalog, disk }
}

/** Operation handlers the foundation owns; slices register their own kinds in their slice definitions. */
export const FOUNDATION_HANDLERS: OperationHandler[] = [trashStep("trash"), trashStep("cleanup")]
