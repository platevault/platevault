/**
 * The OS Trash engine (foundation-owned; D-W26, D-W43, D-W57, D-W72, D-W74).
 *
 * Every approved move to the OS Trash (Done / Archive offers, Empty Trash,
 * Import Move sources, a run's Clean up) runs as one operation with visible
 * per-item progress and records one `TrashEpisode`. Nothing is ever deleted
 * permanently: a file goes to `disk.trash`, or it is kept and listed as
 * refused with its reason (`trashRefusal`, asked again for every item). A
 * frame with copies in several locations moves every copy, and if any copy
 * is refused the whole frame is refused (D-W57).
 */
import { stepRecord } from "@/domain/calibration-process"
import { fileAt, filesUnder, removeFile, trashRefusal } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import type { AssetId, CalibrationProcessId, Disk, OperationId, OperationItem, OperationKind, ProjectId, ResultId, RunId, TrashEpisode, TrashEpisodeKind } from "@/domain/types"
import { formatBytes, plural } from "@/lib/format"
import { nowIso, type PrototypeState, store } from "@/store/core"
import { addOperation, ensureTicker, type OperationHandler, patchOperation, settleOperation } from "@/store/operations"
import { freshId } from "./shared"

/** One path to move. Items sharing an `assetId` move together or not at all. */
export interface TrashItem {
  path: string
  assetId?: AssetId
  resultId?: ResultId
  /** Refused before the move, for example "Offline" for a folder that cannot be listed. */
  refusedReason?: string
}

export interface MoveToOsTrash {
  kind: TrashEpisodeKind
  title: string
  projectId: ProjectId | null
  runIds: RunId[]
  items: TrashItem[]
  /** Run records removed once the episode settles (Empty Trash). */
  removeRunIds?: RunId[]
  /** Roots whose emptied folders leave the disk once the episode settles (a run's prepared folders); a folder still holding a file stays. */
  pruneFolders?: string[]
  /** What one item is, for progress and the summary; "item" by default. */
  noun?: { one: string; many: string }
  href: string
  /** The calibration process whose Raws step this move is (P-CAL3); the episode settles that step. */
  calibrationProcessId?: CalibrationProcessId
}

/** A run's Clean up is its own operation kind, so its step reads its state apart from other trash moves. */
function operationKind(kind: TrashEpisodeKind): OperationKind {
  return kind === "run-cleanup" ? "cleanup" : "trash"
}

interface TrashPayload extends Omit<MoveToOsTrash, "title" | "items"> {
  queue: TrashItem[][]
  done: TrashEpisode["items"]
  episodeId: string
}

/** Prepared entries of a run: every file in its preparation folders (PREP-FR-14). */
export function preparedEntryItems(state: PrototypeState, runId: RunId): TrashItem[] {
  const out: TrashItem[] = []
  for (const prep of Object.values(state.catalog.preparations)) {
    if (prep.runId !== runId) continue
    const files = filesUnder(state.disk, prep.folderPath)
    if (files.length === 0 && !fileAt(state.disk, prep.folderPath)) {
      const volume = Object.values(state.disk.volumes).find((v) => isUnder(prep.folderPath, v.mountPath))
      if (volume && !volume.mounted) out.push({ path: prep.folderPath, refusedReason: `${volume.name} is offline` })
      continue
    }
    for (const file of files) out.push({ path: file.path })
  }
  return out
}

/** A run's Results folder content as known to the catalog. */
export function resultItems(state: PrototypeState, runId: RunId): TrashItem[] {
  return Object.values(state.catalog.results)
    .filter((r) => r.runId === runId && !r.trashed)
    .map((r) => ({ path: r.path, resultId: r.id }))
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
  const noun = input.noun ?? { one: "item", many: "items" }
  const payload: TrashPayload = {
    kind: input.kind,
    projectId: input.projectId,
    runIds: input.runIds,
    removeRunIds: input.removeRunIds ?? [],
    pruneFolders: input.pruneFolders ?? [],
    noun,
    href: input.href,
    calibrationProcessId: input.calibrationProcessId,
    queue: groupItems(input.items),
    done: [],
    episodeId: freshId("trash", input.title),
  }
  const added = addOperation(state, {
    kind: operationKind(input.kind),
    title: input.title,
    scope: { runIds: input.runIds, projectId: input.projectId ?? undefined },
    total: input.items.length,
    unit: noun.many,
    items: input.items.map((item) => ({ id: item.path, label: item.path.slice(item.path.lastIndexOf("/") + 1), path: item.path, status: "pending", phase: null, detail: item.refusedReason ?? null })),
    payload: payload as unknown as Record<string, unknown>,
    canCancel: false,
  })
  return { state: added.state, operationId: added.id }
}

function refusal(disk: Disk, item: TrashItem): string | null {
  return item.refusedReason ?? trashRefusal(disk, item.path)
}

const GROUPS_PER_TICK = 12

function trashStep(kind: OperationKind): OperationHandler {
  return {
    kind,
    step(state, op) {
      const payload = op.payload as unknown as TrashPayload
      let disk = state.disk
      const queue = [...payload.queue]
      const done = [...payload.done]
      const outcomes = new Map<string, Pick<OperationItem, "status" | "detail">>()
      const at = nowIso()
      for (const group of queue.splice(0, GROUPS_PER_TICK)) {
        const reasons = group.map((item) => refusal(disk, item))
        const firstRefusal = reasons.find((r) => r !== null) ?? null
        for (const [index, item] of group.entries()) {
          const file = fileAt(disk, item.path)
          const base = { path: item.path, volumeId: file?.volumeId ?? "", sizeBytes: file?.linkTarget ? 0 : (file?.sizeBytes ?? 0), assetId: item.assetId ?? null, resultId: item.resultId ?? null }
          if (firstRefusal !== null) {
            // D-W57: one refused copy keeps every copy of the frame.
            const reason = reasons[index] ?? `Another copy was refused: ${firstRefusal}`
            done.push({ ...base, outcome: "refused", reason })
            outcomes.set(item.path, { status: "blocked", detail: reason })
            continue
          }
          disk = { ...removeFile(disk, file!.volumeId, item.path), trash: [...disk.trash, { file: file!, originalPath: item.path, trashedAt: at }] }
          done.push({ ...base, outcome: "trashed", reason: null })
          outcomes.set(item.path, { status: "done", detail: "Moved to the OS Trash" })
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
      const noun = payload.noun ?? { one: "item", many: "items" }
      const summary = `${plural(trashed.length, noun.one, noun.many)} moved to the OS Trash (${formatBytes(bytes)}); ${plural(refused, noun.one, noun.many)} kept with a reason. Nothing was deleted permanently.`
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

/** Record the episode, mark Trashed frames and Results, remove emptied runs, and settle a calibration process's Raws step. */
function settleEpisode(state: PrototypeState, operationId: OperationId, payload: TrashPayload): PrototypeState {
  const at = nowIso()
  const episode: TrashEpisode = {
    id: payload.episodeId,
    kind: payload.kind,
    at,
    projectId: payload.projectId,
    runIds: payload.runIds,
    items: payload.done,
    operationId,
  }
  const catalog = { ...state.catalog, assets: { ...state.catalog.assets }, results: { ...state.catalog.results } }
  const trashedPaths = new Set(payload.done.filter((i) => i.outcome === "trashed").map((i) => i.path))
  for (const assetId of new Set(payload.done.map((i) => i.assetId).filter((id): id is AssetId => id !== null))) {
    const asset = catalog.assets[assetId]
    if (!asset) continue
    const remaining = asset.copies.filter((c) => !trashedPaths.has(c.path))
    if (remaining.length === asset.copies.length) continue
    // A frame whose every copy went is Trashed; a duplicate copy only leaves the copy list (D-W74).
    catalog.assets[assetId] = remaining.length === 0 ? { ...asset, trashed: { at, episodeId: episode.id } } : { ...asset, copies: remaining }
  }
  for (const item of payload.done) {
    if (item.outcome !== "trashed" || !item.resultId) continue
    const result = catalog.results[item.resultId]
    if (result) catalog.results[item.resultId] = { ...result, trashed: { at, episodeId: episode.id } }
  }
  const remove = new Set(payload.removeRunIds ?? [])
  if (remove.size > 0) {
    catalog.runs = Object.fromEntries(Object.entries(catalog.runs).filter(([id]) => !remove.has(id)))
    catalog.preparations = Object.fromEntries(Object.entries(catalog.preparations).filter(([, p]) => !remove.has(p.runId)))
    catalog.results = Object.fromEntries(Object.entries(catalog.results).filter(([, r]) => !r.runId || !remove.has(r.runId) || r.trashed))
    catalog.runGroups = Object.fromEntries(Object.entries(catalog.runGroups).map(([id, g]) => [id, { ...g, runIds: g.runIds.filter((r) => !remove.has(r)) }]))
  }
  catalog.trashEpisodes = { ...catalog.trashEpisodes, [episode.id]: episode }
  const process = payload.calibrationProcessId ? catalog.calibrationProcesses[payload.calibrationProcessId] : undefined
  if (process) {
    const refused = payload.done.filter((i) => i.outcome === "refused")
    const raws = refused.length === 0 ? stepRecord("done", at) : stepRecord("failed", at, `${plural(refused.length, "frame")} kept · ${refused[0]!.reason ?? "refused"}`)
    catalog.calibrationProcesses = {
      ...catalog.calibrationProcesses,
      [process.id]: { ...process, raws: refused.length === 0 ? "trashed" : null, operationId: null, steps: { ...process.steps, raws }, updatedAt: at },
    }
  }
  return { ...state, catalog, disk: pruneEmptiedFolders(state.disk, payload.pruneFolders ?? []) }
}

/** Operation handlers the foundation owns; slices register their own kinds in their slice definitions. */
export const FOUNDATION_HANDLERS: OperationHandler[] = [trashStep("trash"), trashStep("cleanup")]
