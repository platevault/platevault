/**
 * Archive transfers (STO-FR-13, P-ARC1, D-W111): one reviewed transfer per
 * approval, from Wrap up or from Sessions › Archive…. The plan it moves
 * comes from `domain/archive.ts`; the "archive" operation's handler that
 * runs it is `archiveHandler` (Close project composes it with
 * `closingOnSuccess`, store/actions/projects.ts). Each session moves whole
 * or stays: every frame is verified (volume, bytes against the reviewed
 * digest, a free destination) before any frame of that session moves.
 * Links pointing at a moved copy are rebuilt to its new path, so no View
 * dangles (STO-FR-06); a Closed Project's kept View is repointed that way
 * and the repoint is recorded in Activity, while the Project stays locked.
 * There is no Restore. `offerFileRows` lists a Trash offer's exact files as
 * the confirm dialog's file rows, for Sessions' Unusable purge.
 */
import type { FileRow } from "@/components/app/contracts"
import type { ArchiveMove, ArchiveRow, TrashOffer } from "@/domain/archive"
import { projectHref, sessionTargetId } from "@/domain/derive"
import { fileKey, removeFile, writeFiles } from "@/domain/disk"
import { stableHash } from "@/domain/indexing"
import { unitCount } from "@/domain/labels"
import { viewLinks } from "@/domain/storage"
import type { ActivityEvent, Catalog, Disk, OperationId, ProjectId, Session, SessionId } from "@/domain/types"
import { joinRefs, type MessageRef, type Messages, msg, nightRef, verbatim } from "@/lib/i18n"
import { nowIso, type PrototypeState, store, withCatalog } from "@/store/core"
import { type OperationHandler, patchOperation, settleOperation, startOperation } from "@/store/operations"
import { trashFileRows } from "./trash"

/**
 * A Trash offer as ConfirmDialog file rows (astro-plan-6bh3p): every file
 * its approval hands to the OS Trash, each copy of a frame on its own row;
 * each refusal stays, with its terse reason and, when it has one, the link
 * that resolves it (P-TRASH2).
 */
export function offerFileRows(m: Messages, world: Pick<PrototypeState, "catalog" | "disk">, offer: TrashOffer): { moved: FileRow[]; kept: FileRow[] } {
  return {
    moved: trashFileRows(m, world, offer.items),
    kept: trashFileRows(
      m,
      world,
      offer.refusals.flatMap((refusal) => (refusal.path === null ? [] : [{ path: refusal.path, refused: refusal }])),
    ),
  }
}

/** What the "archive" operation carries; its handler reads the same shape. */
export interface ArchivePayload {
  /** Null for Archive… from Sessions (STO-FR-13). */
  projectId: ProjectId | null
  queue: Array<{ sessionId: SessionId; moves: ArchiveMove[]; folder: string }>
  moved: SessionId[]
  /** Links repointed in Closed Projects' kept Views, by Project (D-W111). */
  repointed: Record<ProjectId, number>
  href: string
}

/** "NGC 7000 · 18 Sep · Ha": the session's target (or object), night and channel. */
function sessionRef(catalog: Catalog, session: Session): MessageRef {
  const targetId = sessionTargetId(session)
  const target = (targetId ? catalog.targets[targetId]?.name : null) ?? session.objectLabel
  return joinRefs([typeof target === "string" ? verbatim(target) : msg("session_no_target"), nightRef(session.night), typeof session.channel === "string" ? verbatim(session.channel) : msg("palette_session_no_filter")], " · ")
}

/** Start an approved Archive of the reviewed rows; returns the operation id. Without a Project it archives sessions from Sessions. */
export function startArchiveTransfer(projectId: ProjectId | null, rows: ArchiveRow[]): OperationId {
  const state = store.getState()
  const project = projectId ? state.catalog.projects[projectId] : undefined
  const name = project ? project.name : projectId ? msg("project_noun") : msg("session_count", { count: rows.length })
  const payload: ArchivePayload = {
    projectId,
    queue: rows.map((r) => ({ sessionId: r.session.id, moves: r.moves, folder: r.folder })),
    moved: [],
    repointed: {},
    href: projectId ? projectHref(projectId, { stage: "wrap-up" }) : "/sessions",
  }
  return startOperation({
    kind: "archive",
    title: msg("op_archive_title", { name }),
    scope: { projectId: projectId ?? undefined, sessionIds: rows.map((r) => r.session.id) },
    total: rows.length,
    unit: "sessions",
    items: rows.map((r) => ({
      id: r.session.id,
      label: sessionRef(state.catalog, r.session),
      path: r.folder,
      status: "pending",
      phase: null,
      detail: joinRefs([unitCount("frames", r.moves.length), { bytes: r.sizeBytes }], " · "),
    })),
    payload: payload as unknown as Record<string, unknown>,
    canCancel: false,
  })
}

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

/** Move the frames and rebuild every link to a moved copy; returns the links repointed in Closed Projects' kept Views. */
function applyMoves(state: PrototypeState, moves: ArchiveMove[]): { state: PrototypeState; repointed: Record<ProjectId, number> } {
  const links = viewLinks(state.catalog, state.disk)
  let disk: Disk = state.disk
  const assets = { ...state.catalog.assets }
  const at = nowIso()
  const rebuilt = new Map<string, string>()
  const repointed: Record<ProjectId, number> = {}
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
    for (const link of links.get(move.from.path) ?? []) if (!link.holds) repointed[link.project.id] = (repointed[link.project.id] ?? 0) + 1
  }
  // Rebuild links that point at a moved copy (STO-FR-06): a kept View keeps working.
  const relinked = Object.values(disk.files).flatMap((f) => (f.linkTarget && rebuilt.has(f.linkTarget) ? [{ ...f, linkTarget: rebuilt.get(f.linkTarget)! }] : []))
  if (relinked.length > 0) disk = writeFiles(disk, relinked)
  return { state: { ...state, disk, catalog: { ...state.catalog, assets } }, repointed }
}

function finish(state: PrototypeState, id: OperationId, payload: ArchivePayload): PrototypeState {
  const op = state.operations[id]!
  const refused = op.items.filter((i) => i.status === "blocked").length
  const moved = payload.moved.length
  const project = payload.projectId ? state.catalog.projects[payload.projectId] : undefined
  let next = state
  if (project && moved > 0) {
    const sessionIds = [...new Set([...(project.archive?.sessionIds ?? []), ...payload.moved])]
    next = withCatalog(next, (c) => ({ ...c, projects: { ...c.projects, [project.id]: { ...project, archive: { at: nowIso(), sessionIds }, revision: project.revision + 1 } } }))
  }
  // The kept Views it repointed are recorded; the Closed Projects themselves stay as they were (D-W111).
  const at = nowIso()
  const repoints: ActivityEvent[] = Object.entries(payload.repointed).flatMap(([projectId, count]) => {
    const closed = next.catalog.projects[projectId]
    return closed ? [{ id: `act_${id}_${projectId}`, at, kind: "saved" as const, title: msg("archive_repointed_title", { name: closed.name }), detail: msg("archive_repointed_detail", { count, n: { count } }), operationId: id, href: projectHref(projectId, { stage: "view" }) }] : []
  })
  if (repoints.length > 0) next = { ...next, activity: [...repoints, ...next.activity].slice(0, 200) }
  const main = msg("op_archive_sessions_archived", { count: moved, n: { count: moved } })
  const summary = refused > 0 ? joinRefs([main, msg("op_archive_kept", { count: refused })], " · ") : main
  return settleOperation(next, id, moved === 0 && refused > 0 ? "failed" : refused > 0 ? "partial" : "succeeded", summary, payload.href)
}

/** The "archive" operation: one session per tick, verified, then moved whole (STO-FR-13). */
export const archiveHandler: OperationHandler = {
  kind: "archive",
  step(state, op) {
    const payload = op.payload as unknown as ArchivePayload
    const [group, ...rest] = payload.queue
    if (!group) return finish(state, op.id, payload)
    let next = state
    let refusal: MessageRef | null = null
    let repointed = payload.repointed
    if (next.faults.failNextHashVerification) {
      next = { ...next, faults: { ...next.faults, failNextHashVerification: false } }
      refusal = msg("op_archive_hash_failed")
    } else refusal = verify(next, group.moves)
    if (!refusal) {
      const applied = applyMoves(next, group.moves)
      next = applied.state
      repointed = { ...repointed }
      for (const [projectId, count] of Object.entries(applied.repointed)) repointed[projectId] = (repointed[projectId] ?? 0) + count
    }
    const moved = msg("op_archived_to", { folder: group.folder, frames: unitCount("frames", group.moves.length) })
    const nextPayload: ArchivePayload = { ...payload, queue: rest, moved: refusal ? payload.moved : [...payload.moved, group.sessionId], repointed }
    next = patchOperation(next, op.id, {
      items: op.items.map((item) => (item.id === group.sessionId ? { ...item, status: refusal ? "blocked" : "done", detail: refusal ?? moved } : item)),
      progress: { ...op.progress, done: op.progress.done + 1 },
      payload: nextPayload as unknown as Record<string, unknown>,
    })
    return rest.length === 0 ? finish(next, op.id, nextPayload) : next
  },
}
