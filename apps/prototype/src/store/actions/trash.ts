/**
 * The OS Trash engine (foundation-owned; D-W43, D-W57, D-W72, D-W74).
 *
 * Every approved move to the OS Trash (Done / Archive offers, Empty Trash,
 * Import Move sources) runs as one "trash" operation with visible progress
 * and records one `TrashEpisode`. Nothing is ever deleted permanently: a file
 * goes to `disk.trash`, or it is kept and listed as refused with its reason.
 * A frame with copies in several locations moves every copy, and if any copy
 * is refused the whole frame is refused (D-W57).
 */
import { fileAt, filesUnder, removeFile } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import type { AssetId, Disk, OperationId, ProjectId, ResultId, RunId, TrashEpisode, TrashEpisodeKind } from "@/domain/types"
import { formatBytes, plural } from "@/lib/format"
import { nowIso, type PrototypeState } from "@/store/core"
import { type OperationHandler, patchOperation, settleOperation, startOperation } from "@/store/operations"
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
  href: string
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
  const payload: TrashPayload = {
    kind: input.kind,
    projectId: input.projectId,
    runIds: input.runIds,
    removeRunIds: input.removeRunIds ?? [],
    href: input.href,
    queue: groupItems(input.items),
    done: [],
    episodeId: freshId("trash", input.title),
  }
  return startOperation({
    kind: "trash",
    title: input.title,
    scope: { runIds: input.runIds, projectId: input.projectId ?? undefined },
    total: input.items.length,
    unit: "items",
    payload: payload as unknown as Record<string, unknown>,
    canCancel: false,
  })
}

function refusal(disk: Disk, item: TrashItem): string | null {
  if (item.refusedReason) return item.refusedReason
  if (disk.readOnlyPaths.some((p) => isUnder(item.path, p))) return "Write permission removed; kept in place"
  const file = fileAt(disk, item.path)
  if (!file) return "Not found at its recorded path"
  const volume = disk.volumes[file.volumeId]
  if (!volume?.mounted) return `${volume?.name ?? "Its volume"} is offline`
  if (volume.trash === "unsupported") return `${volume.name} has no OS Trash; kept, nothing deleted`
  return null
}

const GROUPS_PER_TICK = 12

const trashHandler: OperationHandler = {
  kind: "trash",
  step(state, op) {
    const payload = op.payload as unknown as TrashPayload
    let disk = state.disk
    const queue = [...payload.queue]
    const done = [...payload.done]
    const at = nowIso()
    for (const group of queue.splice(0, GROUPS_PER_TICK)) {
      const reasons = group.map((item) => refusal(disk, item))
      const firstRefusal = reasons.find((r) => r !== null) ?? null
      for (const [index, item] of group.entries()) {
        const file = fileAt(disk, item.path)
        const base = { path: item.path, volumeId: file?.volumeId ?? "", sizeBytes: file?.linkTarget ? 0 : (file?.sizeBytes ?? 0), assetId: item.assetId ?? null, resultId: item.resultId ?? null }
        if (firstRefusal !== null) {
          // D-W57: one refused copy keeps every copy of the frame.
          done.push({ ...base, outcome: "refused", reason: reasons[index] ?? `Another copy was refused: ${firstRefusal}` })
          continue
        }
        disk = { ...removeFile(disk, file!.volumeId, item.path), trash: [...disk.trash, { file: file!, originalPath: item.path, trashedAt: at }] }
        done.push({ ...base, outcome: "trashed", reason: null })
      }
    }
    let next: PrototypeState = patchOperation({ ...state, disk }, op.id, {
      progress: { ...op.progress, done: done.length },
      payload: { ...payload, queue, done } as unknown as Record<string, unknown>,
    })
    if (queue.length > 0) return next
    next = settleEpisode(next, op.id, { ...payload, queue, done })
    const trashed = done.filter((i) => i.outcome === "trashed")
    const refused = done.length - trashed.length
    const bytes = trashed.reduce((n, i) => n + i.sizeBytes, 0)
    const summary = `${plural(trashed.length, "item")} moved to the OS Trash (${formatBytes(bytes)}); ${plural(refused, "item")} kept with a reason. Nothing was deleted permanently.`
    return settleOperation(next, op.id, refused > 0 && trashed.length === 0 ? "failed" : refused > 0 ? "partial" : "succeeded", summary, payload.href)
  },
}

/** Record the episode, mark Trashed frames and Results, and remove emptied runs. */
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
  return { ...state, catalog }
}

/** Operation handlers the foundation owns; slices register their own kinds in their slice definitions. */
export const FOUNDATION_HANDLERS: OperationHandler[] = [trashHandler]
