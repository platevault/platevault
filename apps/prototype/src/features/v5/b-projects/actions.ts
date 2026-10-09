/**
 * Slice B writes that the foundation does not provide: the "archive"
 * operation, Archive at Wrap up and Restore of archived sessions after
 * Reopen (STO-FR-13, D-W69, P-ARC1), one reviewed transfer per approval.
 * Each session moves whole or stays: every frame is verified (volume, bytes
 * against the reviewed digest, a free destination) before any frame of that
 * session moves. Prepared links pointing at a moved copy are rebuilt to its
 * new path, so no run reference dangles (STO-FR-06). The slice registry
 * imports this module for its handler; subject and mosaic writes live in
 * `subject-actions.ts`.
 */
import { fileKey, removeFile, writeFiles } from "@/domain/disk"
import { stableHash } from "@/domain/indexing"
import type { Catalog, Disk, OperationId, ProjectId, SessionId } from "@/domain/types"
import { formatBytes, plural } from "@/lib/format"
import { nowIso, type PrototypeState, store, withCatalog } from "@/store/core"
import { type OperationHandler, patchOperation, settleOperation, startOperation } from "@/store/operations"
import { type ArchiveMove, type ArchiveRow, sessionLabel } from "./model"

// ---------------------------------------------------------------------------
// Archive and Restore transfers
// ---------------------------------------------------------------------------

export type TransferDirection = "archive" | "restore"

interface ArchivePayload {
  projectId: ProjectId
  direction: TransferDirection
  queue: Array<{ sessionId: SessionId; moves: ArchiveMove[]; folder: string }>
  moved: SessionId[]
  href: string
}

/** Start an approved Archive or Restore of the reviewed rows; returns the operation id. */
export function startArchiveTransfer(projectId: ProjectId, rows: ArchiveRow[], direction: TransferDirection): OperationId {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  const name = project?.name ?? "Project"
  const payload: ArchivePayload = {
    projectId,
    direction,
    queue: rows.map((r) => ({ sessionId: r.session.id, moves: r.moves, folder: r.folder })),
    moved: [],
    href: `/projects/${projectId}`,
  }
  return startOperation({
    kind: "archive",
    title: direction === "archive" ? `Archive ${name}` : `Restore archived sessions of ${name}`,
    scope: { projectId, sessionIds: rows.map((r) => r.session.id) },
    total: rows.length,
    unit: "sessions",
    items: rows.map((r) => ({
      id: r.session.id,
      label: sessionLabel(state.catalog, r.session),
      path: r.folder,
      status: "pending",
      phase: null,
      detail: `${plural(r.moves.length, "frame")} · ${formatBytes(r.sizeBytes)}`,
    })),
    payload: payload as unknown as Record<string, unknown>,
    canCancel: false,
  })
}

/** Re-verify a session's moves immediately before they run (D19); the first failure keeps the whole session. */
function verify(state: PrototypeState, moves: ArchiveMove[]): string | null {
  for (const move of moves) {
    const source = state.disk.volumes[move.from.volumeId]
    if (!source?.mounted) return `${source?.name ?? "Its volume"} went offline`
    const file = state.disk.files[fileKey(move.from.volumeId, move.from.path)]
    if (!file) return `Not found at ${move.from.path}`
    const asset = state.catalog.assets[move.assetId]
    if (!asset || file.sha256 !== asset.sha256) return `${move.from.path} changed since the review (SHA-256 differs)`
    const destination = state.disk.volumes[move.to.volumeId]
    if (!destination?.mounted) return `${destination?.name ?? "The destination volume"} is not mounted`
    if (!destination.writable) return `${destination.name} is not writable`
    if (state.disk.files[fileKey(move.to.volumeId, move.to.path)]) return `Another file already exists at ${move.to.path}`
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
  const project = state.catalog.projects[payload.projectId]
  let next = state
  if (project && moved > 0) {
    const current = project.archive?.sessionIds ?? []
    const sessionIds = payload.direction === "archive" ? [...new Set([...current, ...payload.moved])] : current.filter((s) => !payload.moved.includes(s))
    const archive = sessionIds.length === 0 ? null : { at: payload.direction === "archive" ? nowIso() : (project.archive?.at ?? nowIso()), sessionIds }
    next = withCatalog(next, (c) => ({ ...c, projects: { ...c.projects, [project.id]: { ...project, archive, revision: project.revision + 1 } } }))
  }
  const verb = payload.direction === "archive" ? "archived" : "restored"
  const summary = `${plural(moved, "session")} ${verb}${refused > 0 ? ` · ${refused} kept` : ""}`
  return settleOperation(next, id, moved === 0 && refused > 0 ? "failed" : refused > 0 ? "partial" : "succeeded", summary, payload.href)
}

export const archiveHandler: OperationHandler = {
  kind: "archive",
  step(state, op) {
    const payload = op.payload as unknown as ArchivePayload
    const [group, ...rest] = payload.queue
    if (!group) return finish(state, op.id, payload)
    let next = state
    let refusal: string | null = null
    if (next.faults.failNextHashVerification) {
      next = { ...next, faults: { ...next.faults, failNextHashVerification: false } }
      refusal = "SHA-256 verification failed (simulated): nothing of this session moved"
    } else refusal = verify(next, group.moves)
    if (!refusal) next = applyMoves(next, group.moves, payload.direction)
    const verb = payload.direction === "archive" ? "Archived to" : "Restored to"
    next = patchOperation(next, op.id, {
      items: op.items.map((item) =>
        item.id === group.sessionId ? { ...item, status: refusal ? "blocked" : "done", detail: refusal ?? `${verb} ${group.folder} · ${plural(group.moves.length, "frame")}` } : item,
      ),
      progress: { ...op.progress, done: op.progress.done + 1 },
      payload: { ...payload, queue: rest, moved: refusal ? payload.moved : [...payload.moved, group.sessionId] } as unknown as Record<string, unknown>,
    })
    return rest.length === 0 ? finish(next, op.id, { ...payload, queue: rest, moved: refusal ? payload.moved : [...payload.moved, group.sessionId] }) : next
  },
}
