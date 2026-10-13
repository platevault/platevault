/**
 * Slice B's "archive" operation handler: Archive at Wrap up and Restore of
 * archived sessions after Reopen (STO-FR-13, D-W69, P-ARC1), one reviewed
 * transfer per approval; `startArchiveTransfer` (store/actions/archive.ts)
 * starts one. Each session moves whole or stays: every frame is verified
 * (volume, bytes against the reviewed digest, a free destination) before
 * any frame of that session moves. Prepared links pointing at a moved copy
 * are rebuilt to its new path, so no run reference dangles (STO-FR-06). The
 * slice registry imports this module for the handler.
 */
import type { ArchiveMove } from "@/domain/archive"
import { fileKey, removeFile, writeFiles } from "@/domain/disk"
import { stableHash } from "@/domain/indexing"
import { unitCount } from "@/domain/labels"
import type { Catalog, Disk, OperationId } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { joinRefs, type MessageRef, msg } from "@/lib/i18n"
import type { ArchivePayload, TransferDirection } from "@/store/actions/archive"
import { nowIso, type PrototypeState, withCatalog } from "@/store/core"
import { type OperationHandler, patchOperation, settleOperation } from "@/store/operations"

/** Re-verify a session's moves immediately before they run (D19); the first failure keeps the whole session. */
function verify(state: PrototypeState, moves: ArchiveMove[]): MessageRef | null {
  for (const move of moves) {
    const source = state.disk.volumes[move.from.volumeId]
    if (!source?.mounted) return msg("op_archive_went_offline", { name: source ? source.name : msg("wrapup_its_volume") })
    const file = state.disk.files[fileKey(move.from.volumeId, move.from.path)]
    if (!file) return msg("wrapup_refusal_not_found", { path: move.from.path })
    const asset = state.catalog.assets[move.assetId]
    if (!asset || file.sha256 !== asset.sha256) return msg("op_archive_changed", { path: move.from.path })
    const destination = state.disk.volumes[move.to.volumeId]
    if (!destination?.mounted) return msg("wrapup_refusal_not_mounted", { name: destination ? destination.name : msg("op_archive_destination_volume") })
    if (!destination.writable) return msg("wrapup_refusal_not_writable", { name: destination.name })
    if (state.disk.files[fileKey(move.to.volumeId, move.to.path)]) return msg("wrapup_refusal_file_exists", { path: move.to.path })
  }
  return null
}

function applyMoves(state: PrototypeState, moves: ArchiveMove[], direction: TransferDirection): PrototypeState {
  let disk: Disk = state.disk
  const assets = { ...state.catalog.assets }
  const origins = { ...state.slices.b.archiveOrigins }
  const at = nowIso()
  const rebuilt = new Map<string, string>()
  for (const move of moves) {
    const file = disk.files[fileKey(move.from.volumeId, move.from.path)]!
    disk = removeFile(disk, move.from.volumeId, move.from.path)
    disk = writeFiles(disk, [{ ...file, path: move.to.path, volumeId: move.to.volumeId, inode: Number.parseInt(stableHash(move.to.path), 36), modifiedAt: file.modifiedAt }])
    const asset = assets[move.assetId]!
    assets[move.assetId] = {
      ...asset,
      copies: asset.copies.map((c) =>
        c.path === move.from.path && c.volumeId === move.from.volumeId ? { ...c, locationId: move.to.locationId, volumeId: move.to.volumeId, path: move.to.path, lastObservedAt: at } : c,
      ),
    }
    rebuilt.set(move.from.path, move.to.path)
    if (direction === "archive") origins[move.assetId] = move.from
    else delete origins[move.assetId]
  }
  // Rebuild prepared links that point at a moved copy (STO-FR-06).
  const relinked = Object.values(disk.files).flatMap((f) => (f.linkTarget && rebuilt.has(f.linkTarget) ? [{ ...f, linkTarget: rebuilt.get(f.linkTarget)! }] : []))
  if (relinked.length > 0) disk = writeFiles(disk, relinked)
  const catalog: Catalog = { ...state.catalog, assets }
  return { ...state, disk, catalog, slices: { ...state.slices, b: { ...state.slices.b, archiveOrigins: origins } } }
}

function finish(state: PrototypeState, id: OperationId, payload: ArchivePayload): PrototypeState {
  const op = state.operations[id]!
  const refused = op.items.filter((i) => i.status === "blocked").length
  const moved = payload.moved.length
  const project = payload.projectId ? state.catalog.projects[payload.projectId] : undefined
  let next = state
  if (project && moved > 0) {
    const current = project.archive?.sessionIds ?? []
    const sessionIds = payload.direction === "archive" ? [...new Set([...current, ...payload.moved])] : current.filter((s) => !payload.moved.includes(s))
    const archive = sessionIds.length === 0 ? null : { at: payload.direction === "archive" ? nowIso() : (project.archive?.at ?? nowIso()), sessionIds }
    next = withCatalog(next, (c) => ({ ...c, projects: { ...c.projects, [project.id]: { ...project, archive, revision: project.revision + 1 } } }))
  }
  const sessions = { count: moved, n: formatCount(moved) }
  const main = payload.direction === "archive" ? msg("op_archive_sessions_archived", sessions) : msg("op_archive_sessions_restored", sessions)
  const summary = refused > 0 ? joinRefs([main, msg("op_archive_kept", { count: refused })], " · ") : main
  return settleOperation(next, id, moved === 0 && refused > 0 ? "failed" : refused > 0 ? "partial" : "succeeded", summary, payload.href)
}

export const archiveHandler: OperationHandler = {
  kind: "archive",
  step(state, op) {
    const payload = op.payload as unknown as ArchivePayload
    const [group, ...rest] = payload.queue
    if (!group) return finish(state, op.id, payload)
    let next = state
    let refusal: MessageRef | null = null
    if (next.faults.failNextHashVerification) {
      next = { ...next, faults: { ...next.faults, failNextHashVerification: false } }
      refusal = msg("op_archive_hash_failed")
    } else refusal = verify(next, group.moves)
    if (!refusal) next = applyMoves(next, group.moves, payload.direction)
    const frames = unitCount("frames", group.moves.length)
    const moved = payload.direction === "archive" ? msg("op_archived_to", { folder: group.folder, frames }) : msg("op_restored_to", { folder: group.folder, frames })
    next = patchOperation(next, op.id, {
      items: op.items.map((item) =>
        item.id === group.sessionId ? { ...item, status: refusal ? "blocked" : "done", detail: refusal ?? moved } : item,
      ),
      progress: { ...op.progress, done: op.progress.done + 1 },
      payload: { ...payload, queue: rest, moved: refusal ? payload.moved : [...payload.moved, group.sessionId] } as unknown as Record<string, unknown>,
    })
    return rest.length === 0 ? finish(next, op.id, { ...payload, queue: rest, moved: refusal ? payload.moved : [...payload.moved, group.sessionId] }) : next
  },
}
