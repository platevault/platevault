/**
 * S13 Import as an operation (slice A, D-W11, D-W24). The "import" handler
 * copies each planned file to its templated destination, verifies the copy's
 * SHA-256 against the source, then reads the copies into the library so the
 * imported lights appear in Sessions. Move hands the verified sources to the
 * foundation OS Trash engine ("import-move" episode) once every copy has
 * verified; a source whose copy failed is never trashed. Also: saving an
 * Import source and "Add existing library folder" (index in place).
 */
import { fileAt, makeFile, writeFiles } from "@/domain/disk"
import { readFiles } from "@/domain/indexing"
import type { ImageType, ImportSource, ImportSourceId, LocationId, OperationId, OperationItem, SessionId, VolumeId } from "@/domain/types"
import { registerLocation, type LocationDraft } from "@/features/t1/lib/locations"
import { formatBytes, plural } from "@/lib/format"
import { moveToOsTrash } from "@/store/actions/trash"
import { type CommitResult, commit, nowIso, type PrototypeState, recordActivity, store, updateSlice, withCatalog } from "@/store/core"
import { type OperationHandler, patchOperation, settleOperation, startIndexing, startOperation } from "@/store/operations"
import type { ImportDraft } from "@/store/slices/a"
import { type ImportPlan, TYPE_LABEL } from "./import-model"

interface QueueItem {
  src: string
  dest: string
  destVolumeId: VolumeId
  locationId: LocationId
  type: ImageType
  typed: boolean
  /** Operation item id: one per destination folder and type. */
  group: string
}

export interface ImportPayload {
  sourceId: ImportSourceId | null
  sourceLabel: string
  sourcePath: string
  mode: "copy" | "move"
  queue: QueueItem[]
  copied: Array<QueueItem & { sha256: string; sizeBytes: number }>
  failed: Array<QueueItem & { reason: string }>
  phase: "copy" | "index" | "trash"
  skipped: { duplicate: number; imported: number; held: number; notImage: number; nameTaken: number }
  /** Sessions the imported frames belong to, for Sessions' "Imported" highlight. */
  sessionIds: SessionId[]
  trashRequested: boolean
  trashOperationId: OperationId | null
}

/** Files copied and verified per tick. */
const FILES_PER_TICK = 3

function groupItems(payload: ImportPayload, items: OperationItem[]): OperationItem[] {
  return items.map((item) => {
    const total = [...payload.queue, ...payload.copied, ...payload.failed].filter((q) => q.group === item.id).length
    const done = payload.copied.filter((q) => q.group === item.id).length
    const failed = payload.failed.filter((q) => q.group === item.id)
    const left = payload.queue.filter((q) => q.group === item.id).length
    const status: OperationItem["status"] = left > 0 ? (done + failed.length > 0 ? "running" : "pending") : failed.length > 0 ? (done > 0 ? "uncertain" : "failed") : "done"
    const detail = failed.length > 0 ? `${done} of ${total} copied and verified; ${failed.length} failed: ${failed[0]!.reason}` : `${done} of ${total} copied and verified (SHA-256)`
    return { ...item, status, phase: left > 0 ? "copying" : "destination-verified", detail }
  })
}

function copyBatch(state: PrototypeState, opId: OperationId, payload: ImportPayload): PrototypeState {
  let disk = state.disk
  const queue = [...payload.queue]
  const copied = [...payload.copied]
  const failed = [...payload.failed]
  const now = nowIso()
  for (const item of queue.splice(0, FILES_PER_TICK)) {
    const source = fileAt(disk, item.src)
    const volume = disk.volumes[item.destVolumeId]
    if (!source) {
      failed.push({ ...item, reason: "the source file is gone (card removed or file moved); nothing was copied" })
      continue
    }
    if (!volume?.mounted || !volume.writable) {
      failed.push({ ...item, reason: `${volume?.name ?? "the destination"} is not writable; the source is kept` })
      continue
    }
    const written = makeFile({ path: item.dest, volumeId: item.destVolumeId, sizeBytes: source.sizeBytes, kind: source.kind, header: source.header, pixelTruth: source.pixelTruth, sha256: source.sha256, modifiedAt: now })
    disk = writeFiles(disk, [written])
    // Verify: re-read the copy and compare its digest with the source's.
    const check = fileAt(disk, item.dest)
    if (check?.sha256 !== source.sha256) {
      failed.push({ ...item, reason: "the copy's SHA-256 did not match; the source is kept" })
      continue
    }
    copied.push({ ...item, sha256: source.sha256, sizeBytes: source.sizeBytes })
  }
  const next: ImportPayload = { ...payload, queue, copied, failed, phase: queue.length === 0 ? "index" : "copy" }
  const op = state.operations[opId]!
  return patchOperation({ ...state, disk }, opId, {
    payload: next as unknown as Record<string, unknown>,
    progress: { ...op.progress, done: copied.length + failed.length },
    items: groupItems(next, op.items),
  })
}

/** Read the verified copies into the library, as indexing would, and record them on the saved source. */
function indexCopies(state: PrototypeState, opId: OperationId, payload: ImportPayload): PrototypeState {
  const now = nowIso()
  let catalog = state.catalog
  const byLocation = new Map<LocationId, typeof payload.copied>()
  for (const item of payload.copied) byLocation.set(item.locationId, [...(byLocation.get(item.locationId) ?? []), item])
  for (const [locationId, items] of byLocation) {
    const location = catalog.locations[locationId]
    if (!location) continue
    // A typed Unclassified file is read as the type the user gave it; its observed header stays as captured.
    const files = items.flatMap((item) => {
      const file = fileAt(state.disk, item.dest)
      return file?.header ? [{ ...file, header: { ...file.header, imageType: item.type } }] : []
    })
    catalog = readFiles(catalog, location, files, now)
  }
  const destPaths = new Map(payload.copied.map((q) => [q.dest, q]))
  const assets = { ...catalog.assets }
  const sessions = { ...catalog.sessions }
  const sessionIds = new Set<SessionId>()
  for (const asset of Object.values(assets)) {
    const item = asset.copies.map((c) => destPaths.get(c.path)).find((q) => q !== undefined)
    if (!item) continue
    if (item.typed) assets[asset.id] = { ...asset, observed: { ...asset.observed, imageType: "unknown" } }
    if (asset.sessionId) sessionIds.add(asset.sessionId)
  }
  // The import read every frame it wrote: its new sessions are complete, not provisional.
  for (const id of sessionIds) {
    const session = sessions[id]
    if (session?.scope === "provisional") sessions[id] = { ...session, scope: "complete" }
  }
  const importSources = { ...catalog.importSources }
  if (payload.sourceId && importSources[payload.sourceId]) {
    const source = importSources[payload.sourceId]!
    importSources[payload.sourceId] = { ...source, lastImportedAt: now, importedSha256: [...new Set([...source.importedSha256, ...payload.copied.map((c) => c.sha256)])] }
  }
  const next: ImportPayload = { ...payload, sessionIds: [...sessionIds], phase: "trash" }
  return patchOperation({ ...state, catalog: { ...catalog, assets, sessions, importSources } }, opId, { payload: next as unknown as Record<string, unknown> })
}

function summary(payload: ImportPayload): string {
  const bytes = payload.copied.reduce((n, c) => n + c.sizeBytes, 0)
  const lights = payload.copied.filter((c) => c.type === "light").length
  const calibration = payload.copied.length - lights
  const parts = [
    `${plural(payload.copied.length, "frame")} (${formatBytes(bytes)}) copied and verified by SHA-256: ${plural(lights, "light")}, ${calibration} calibration`,
    `${plural(payload.sessionIds.length, "session")} in the library`,
  ]
  const s = payload.skipped
  if (s.duplicate > 0) parts.push(`${plural(s.duplicate, "duplicate")} skipped`)
  if (s.imported > 0) parts.push(`${s.imported} already imported from this source skipped`)
  if (s.held > 0) parts.push(`${s.held} held on the source`)
  if (payload.failed.length > 0) parts.push(`${payload.failed.length} failed and kept on the source`)
  const text = `${parts.join("; ")}.`
  if (payload.mode === "move" && payload.copied.length > 0) return `${text} The ${plural(payload.copied.length, "verified source")} go to the OS Trash in “Move import sources to the OS Trash”.`
  return payload.mode === "move" ? `${text} No source went to the OS Trash.` : `${text} Sources are unchanged.`
}

function finish(state: PrototypeState, opId: OperationId, payload: ImportPayload): PrototypeState {
  const status = payload.failed.length === 0 ? "succeeded" : payload.copied.length > 0 ? "partial" : "failed"
  return settleOperation(state, opId, status, summary(payload), `/sessions?import=${opId}`)
}

/** Ops whose OS Trash hand-off is scheduled in this page session (a reload schedules it again). */
const trashScheduled = new Set<OperationId>()

/**
 * Move: the verified sources go to the OS Trash through the foundation engine.
 * It starts its own operation, which cannot happen inside this tick's state
 * update, so it is scheduled right after it.
 */
function requestTrash(opId: OperationId, payload: ImportPayload) {
  if (trashScheduled.has(opId)) return
  trashScheduled.add(opId)
  window.setTimeout(() => {
    const trashOperationId = moveToOsTrash({
      kind: "import-move",
      title: "Move import sources to the OS Trash",
      projectId: null,
      runIds: [],
      items: payload.copied.map((c) => ({ path: c.src })),
      href: `/sessions?import=${opId}`,
    })
    store.setState((s) => {
      const op = s.operations[opId]
      if (!op) return s
      const next = { ...(op.payload as unknown as ImportPayload), trashOperationId }
      return finish(patchOperation(s, opId, { payload: next as unknown as Record<string, unknown> }), opId, next)
    })
  }, 0)
}

export const importHandler: OperationHandler = {
  kind: "import",
  step(state, op) {
    const payload = op.payload as unknown as ImportPayload
    if (payload.phase === "copy") return copyBatch(state, op.id, payload)
    if (payload.phase === "index") return indexCopies(state, op.id, payload)
    if (payload.mode === "move" && payload.copied.length > 0) {
      requestTrash(op.id, payload)
      return payload.trashRequested ? state : patchOperation(state, op.id, { payload: { ...payload, trashRequested: true } as unknown as Record<string, unknown> })
    }
    return finish(state, op.id, payload)
  },
}

/** Start the previewed import. The plan must be free of blockers. */
export function startImport(plan: ImportPlan, draft: ImportDraft): OperationId {
  const queue: QueueItem[] = plan.items.map((item) => ({
    src: item.file.path,
    dest: item.destPath,
    destVolumeId: item.location.volumeId,
    locationId: item.location.id,
    type: item.type,
    typed: item.typed,
    group: `${item.location.id}|${item.destFolder}|${item.type}`,
  }))
  const payload: ImportPayload = {
    sourceId: plan.saved?.id ?? null,
    sourceLabel: plan.sourceLabel,
    sourcePath: plan.sourcePath,
    mode: draft.mode,
    queue,
    copied: [],
    failed: [],
    phase: "copy",
    skipped: {
      duplicate: plan.skipped.duplicate.length,
      imported: plan.skipped.imported.length,
      held: plan.held.settling.length + plan.held.unclassified.reduce((n, h) => n + h.files.length, 0),
      notImage: plan.skipped.notImage.length,
      nameTaken: plan.skipped.nameTaken.length,
    },
    sessionIds: [],
    trashRequested: false,
    trashOperationId: null,
  }
  const items: OperationItem[] = plan.groups.map((g) => ({
    id: g.key,
    label: `${TYPE_LABEL[g.type]} → ${g.location.displayName}`,
    path: g.items[0]!.destFolder,
    status: "pending",
    phase: null,
    detail: `${plural(g.items.length, "frame")} to copy`,
  }))
  const id = startOperation({
    kind: "import",
    title: `${draft.mode === "move" ? "Move" : "Import"} from ${plan.sourceLabel}`,
    scope: { locationIds: [...new Set(plan.items.map((i) => i.location.id))] },
    total: queue.length,
    unit: "frames",
    items,
    payload: payload as unknown as Record<string, unknown>,
    canPause: true,
    canCancel: true,
  })
  updateSlice("a", (a) => ({ ...a, lastImport: { kind: "import", operationId: id }, importDraft: { ...a.importDraft, typed: {} } }))
  return id
}

/** Save the chosen folder as an Import source, so Import new can skip what it already imported. */
export function saveImportSource(name: string, path: string): CommitResult {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: "refused", message: "Name: enter a name, for example ASIAIR SD card.", reasons: ["enter a name"] }
  const id: ImportSourceId = `src_${path.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`
  const source: ImportSource = { id, name: trimmed, path, lastImportedAt: null, importedSha256: [] }
  const result = commit(`Save Import source ${trimmed}`, (s) => withCatalog(s, (c) => ({ ...c, importSources: { ...c.importSources, [id]: source } })), { href: "/import" })
  if (result.ok) {
    recordActivity({ kind: "saved", title: `Import source saved: ${trimmed}`, detail: `${path}. Import new skips files imported from it.`, operationId: null, href: "/import" })
    updateSlice("a", (a) => ({ ...a, importDraft: { ...a.importDraft, source: { kind: "saved", id }, newOnly: true } }))
  }
  return result
}

/** Add existing library folder: register it and index it in place; nothing in it moves (D-W11). */
export function addLibraryFolder(draft: LocationDraft): { result: CommitResult; operationId: OperationId | null } {
  const { result, id } = registerLocation(draft, "/import")
  if (!result.ok || !id) return { result, operationId: null }
  const operationId = startIndexing([id])
  updateSlice("a", (a) => ({ ...a, lastImport: { kind: "index", operationId } }))
  return { result, operationId }
}
