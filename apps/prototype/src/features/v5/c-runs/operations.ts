/**
 * Slice C operation handlers: "prepare" (PREP-FR-09, D09) and "cleanup"
 * (PREP-FR-14, D-W26). Registered by `src/store/slices/c.ts`. Each tick reads
 * the simulated disk, so a source that changes or goes offline between ticks
 * is observed honestly. Nothing here deletes permanently: Clean up moves
 * prepared entries to the OS Trash.
 */
import { createFolder, fakeSha256, fileAt, makeFile, removeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { deniedAncestor, isUnder } from "@/domain/indexing"
import type { Disk, FrameHeader, InputMode, Operation, OperationItem, Preparation, PreparationInput } from "@/domain/types"
import { formatBytes, plural } from "@/lib/format"
import { nowIso, type PrototypeState } from "@/store/core"
import { type OperationHandler, patchOperation, settleOperation } from "@/store/operations"
import { FIELD_KEYWORD, type LinkType, type PrepareEntry, type PrepareJournal } from "./model"

export const HANDOFF_FILE = "platevault-handoff.txt"

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

export interface PreparePayload extends PrepareJournal {
  preparationId: string
  runId: string
  mode: InputMode
  linkType: LinkType | null
  folderPath: string
  resultsPath: string
  href: string
}

const BATCH = 6

function block(item: OperationItem, detail: string): OperationItem {
  return { ...item, status: "blocked", phase: null, detail }
}

function sourceProblem(state: PrototypeState, entry: PrepareEntry): string | null {
  if (entry.unavailable) return `${entry.unavailable}. Nothing was written for it.`
  if (deniedAncestor(state.disk, entry.sourcePath)) return `Unreadable: read access to ${entry.sourcePath} is denied. Nothing was written for it.`
  if (!fileAt(state.disk, entry.sourcePath)) return `Not readable now: nothing is reachable at ${entry.sourcePath}. Nothing was written for it.`
  return null
}

function prepareEntry(state: PrototypeState, payload: PreparePayload, item: OperationItem): { state: PrototypeState; item: OperationItem } {
  const entry = payload.entries[item.id]
  if (!entry) return { state, item: block(item, "Not in the reviewed selection.") }
  const problem = sourceProblem(state, entry)
  if (problem) return { state, item: block(item, problem) }
  const source = fileAt(state.disk, entry.sourcePath)!
  const asset = entry.assetId ? state.catalog.assets[entry.assetId] : undefined
  if (asset && source.sha256 !== asset.sha256) {
    return { state, item: block(item, "Source changed since it was indexed: its bytes differ from the catalog fingerprint. Rescan and review it first.") }
  }
  payload.snapshots[item.id] = source.sha256
  if (payload.mode === "direct-source") {
    payload.expected[item.id] = source.sha256
    return { state, item: { ...item, status: "done", phase: "verified", detail: "Exact source path listed; identity matches its snapshot." } }
  }
  if (fileAt(state.disk, entry.destPath)) return { state, item: block(item, `Destination exists: ${entry.destPath}. Nothing was overwritten.`) }
  if (state.disk.readOnlyPaths.some((p) => isUnder(entry.destPath, p))) return { state, item: block(item, `Write permission removed at ${payload.folderPath}. Nothing was written.`) }
  const volumeId = volumeForPath(state.disk, entry.destPath)
  if (!volumeId || !state.disk.volumes[volumeId]?.mounted) return { state, item: block(item, `Destination offline: ${payload.folderPath} is on a volume that is not mounted.`) }
  const at = nowIso()
  let header: FrameHeader | null = source.header
  if (header && entry.patches.length > 0) {
    header = { ...header }
    for (const { field, value } of entry.patches) {
      if (field === "target") header.object = value
      else if (field === "equipment") header.telescope = value
      else if (field === "filter") header.filter = value
      else if (field === "exposure") header.exposureS = Number.parseFloat(value)
      else header.focalLengthMm = Number.parseFloat(value)
    }
  }
  const written =
    payload.mode === "linked" && payload.linkType !== "hardlink"
      ? makeFile({ path: entry.destPath, volumeId, sizeBytes: 0, kind: source.kind, linkTarget: source.path, modifiedAt: at })
      : payload.mode === "linked"
        ? makeFile({ path: entry.destPath, volumeId, sizeBytes: source.sizeBytes, kind: source.kind, header, pixelTruth: source.pixelTruth, inode: source.inode, sha256: source.sha256, modifiedAt: at })
        : makeFile({
            path: entry.destPath,
            volumeId,
            sizeBytes: source.sizeBytes,
            kind: source.kind,
            header,
            pixelTruth: source.pixelTruth,
            sha256: entry.patches.length > 0 ? fakeSha256(entry.destPath, 7) : source.sha256,
            modifiedAt: at,
          })
  payload.expected[item.id] = written.linkTarget ? source.sha256 : written.sha256
  const next = { ...state, disk: writeFiles(state.disk, [written]) }
  const reread = fileAt(next.disk, entry.destPath)
  const verified = reread?.linkTarget ? fileAt(next.disk, reread.linkTarget)?.sha256 === source.sha256 : reread?.sha256 === payload.expected[item.id]
  if (!verified) return { state: next, item: { ...item, status: "failed", phase: null, detail: `The entry at ${entry.destPath} did not re-read to the expected digest.` } }
  const detail = entry.patches.length > 0 ? `Patched copy verified: ${entry.patches.map((p) => `${FIELD_KEYWORD[p.field]} = ${p.value}`).join(", ")}; original unchanged.` : "Written and re-read against its snapshot."
  return { state: next, item: { ...item, status: "done", phase: "verified", detail } }
}

function patchPreparation(state: PrototypeState, id: string, patch: Partial<Preparation>): PrototypeState {
  const prep = state.catalog.preparations[id]
  if (!prep) return state
  return { ...state, catalog: { ...state.catalog, preparations: { ...state.catalog.preparations, [id]: { ...prep, ...patch } } } }
}

function finalizePrepare(state: PrototypeState, op: Operation, payload: PreparePayload): PrototypeState {
  let next = state
  // Immediately before terminal success each source must still match its snapshot (PREP-FR-09).
  const items = op.items.map((item): OperationItem => {
    if (item.status !== "done") return item
    const entry = payload.entries[item.id]
    const current = entry ? fileAt(next.disk, entry.sourcePath) : undefined
    if (!entry || current?.sha256 !== payload.snapshots[item.id]) return block(item, `Source drift before completion: ${entry?.sourcePath ?? item.label} no longer matches its snapshot. Not counted as prepared.`)
    return item
  })
  const prep = next.catalog.preparations[payload.preparationId]
  if (!prep) return settleOperation(next, op.id, "failed", "The preparation record is missing; nothing was settled.")
  const preparedAssetIds: string[] = []
  const preparedResultIds: string[] = []
  const blocked: Preparation["blocked"] = []
  let calibrationDone = 0
  let calibrationTotal = 0
  for (const item of items) {
    const entry = payload.entries[item.id]
    if (!entry) continue
    if (entry.kind === "calibration") calibrationTotal += 1
    if (item.status === "done") {
      if (entry.kind === "calibration") calibrationDone += 1
      else if (entry.resultId) preparedResultIds.push(entry.resultId)
      else if (entry.assetId) preparedAssetIds.push(entry.assetId)
      continue
    }
    const input: PreparationInput = entry.resultId ? { kind: "result", resultId: entry.resultId } : { kind: "asset", assetId: entry.assetId ?? item.id }
    blocked.push({ input, path: entry.sourcePath, reason: item.detail ?? "Not prepared" })
  }
  const prepared = preparedAssetIds.length + preparedResultIds.length
  const complete = blocked.length === 0
  const state_: Preparation["state"] = complete ? "prepared" : prepared === 0 && calibrationDone === 0 ? "failed" : "partial"
  // The handoff list names exact paths; the Results folder exists before the application writes to it.
  const volumeId = volumeForPath(next.disk, payload.folderPath)
  if (volumeId && next.disk.volumes[volumeId]?.mounted) {
    let disk: Disk = createFolder(next.disk, { volumeId, path: payload.folderPath })
    const resultsVolume = volumeForPath(disk, payload.resultsPath)
    if (resultsVolume) disk = createFolder(disk, { volumeId: resultsVolume, path: payload.resultsPath })
    disk = writeFiles(disk, [makeFile({ path: `${payload.folderPath}/${HANDOFF_FILE}`, volumeId, sizeBytes: 64 * (prepared + calibrationDone) + 120, kind: "text", modifiedAt: nowIso() })])
    next = { ...next, disk }
  }
  const calibrationNote = calibrationTotal > 0 ? ` Calibration: ${calibrationDone} of ${calibrationTotal} files.` : ""
  const summary = complete
    ? `Prepared: ${prepared} of ${prep.entryCount} entries match the reviewed membership and their source snapshots.${calibrationNote}`
    : state_ === "failed"
      ? `Failed: no entry could be prepared; ${plural(blocked.length, "input")} blocked. Sources are untouched.`
      : `Partial: ${prepared} prepared, ${plural(blocked.length, "input")} blocked.${calibrationNote} Open waits until every entry is prepared; sources are untouched.`
  next = patchOperation(next, op.id, { items, payload: payload as unknown as Record<string, unknown>, progress: { ...op.progress, done: op.progress.total } })
  next = patchPreparation(next, payload.preparationId, {
    state: state_,
    preparedAssetIds,
    preparedResultIds,
    blocked,
    entryCount: prep.entryCount,
    footprintBytes: items.reduce((n, item) => {
      const e = payload.entries[item.id]
      return n + (item.status === "done" && e && payload.mode !== "linked" && payload.mode !== "direct-source" ? (payload.mode === "clone" ? Math.round(e.sizeBytes * 0.001) : e.sizeBytes) : 0)
    }, 0),
    settledAt: nowIso(),
  })
  return settleOperation(next, op.id, complete ? "succeeded" : state_ === "failed" ? "failed" : "partial", summary, payload.href)
}

const prepareHandler: OperationHandler = {
  kind: "prepare",
  step(state, op) {
    const payload = structuredClone(op.payload) as unknown as PreparePayload
    let next = state
    const items = [...op.items]
    let processed = 0
    for (let index = 0; index < items.length && processed < BATCH; index += 1) {
      const item = items[index]!
      if (item.status !== "pending" && item.status !== "running") continue
      const result = prepareEntry(next, payload, item)
      next = result.state
      items[index] = result.item
      processed += 1
    }
    const done = items.filter((i) => i.status !== "pending" && i.status !== "running").length
    next = patchOperation(next, op.id, { items, payload: payload as unknown as Record<string, unknown>, progress: { ...op.progress, done } })
    if (done === items.length) return finalizePrepare(next, next.operations[op.id]!, payload)
    return next
  },
}

// ---------------------------------------------------------------------------
// Clean up: prepared entries to the OS Trash
// ---------------------------------------------------------------------------

export interface CleanupPayload {
  runId: string
  folders: string[]
  queue: Array<{ path: string }>
  done: Array<{ path: string; sizeBytes: number; outcome: "trashed" | "refused"; reason: string | null }>
  href: string
}

function cleanupRefusal(disk: Disk, path: string): string | null {
  if (disk.readOnlyPaths.some((p) => isUnder(path, p))) return "Write permission removed; kept in place"
  const file = fileAt(disk, path)
  if (!file) return "Not found at its recorded path"
  const volume = disk.volumes[file.volumeId]
  if (!volume?.mounted) return `${volume?.name ?? "Its volume"} is offline`
  if (volume.trash === "unsupported") return `${volume.name} has no OS Trash; kept, nothing deleted`
  return null
}

const CLEANUP_PER_TICK = 10

const cleanupHandler: OperationHandler = {
  kind: "cleanup",
  step(state, op) {
    const payload = structuredClone(op.payload) as unknown as CleanupPayload
    let disk = state.disk
    const at = nowIso()
    const items = [...op.items]
    for (const { path } of payload.queue.splice(0, CLEANUP_PER_TICK)) {
      const reason = cleanupRefusal(disk, path)
      const file = fileAt(disk, path)
      const sizeBytes = file?.linkTarget ? 0 : (file?.sizeBytes ?? 0)
      const index = items.findIndex((i) => i.path === path)
      if (reason) {
        payload.done.push({ path, sizeBytes, outcome: "refused", reason })
        if (index >= 0) items[index] = { ...items[index]!, status: "blocked", detail: reason }
        continue
      }
      disk = { ...removeFile(disk, file!.volumeId, path), trash: [...disk.trash, { file: file!, originalPath: path, trashedAt: at }] }
      payload.done.push({ path, sizeBytes, outcome: "trashed", reason: null })
      if (index >= 0) items[index] = { ...items[index]!, status: "done", detail: "Moved to the OS Trash" }
    }
    let next: PrototypeState = patchOperation({ ...state, disk }, op.id, { items, payload: payload as unknown as Record<string, unknown>, progress: { ...op.progress, done: payload.done.length } })
    if (payload.queue.length > 0) return next
    // An emptied prepared folder leaves the disk too; a folder holding a refused entry stays.
    const keep = new Set(payload.done.filter((d) => d.outcome === "refused").map((d) => d.path))
    next = { ...next, disk: { ...next.disk, folders: next.disk.folders.filter((f) => !payload.folders.some((folder) => isUnder(f.path, folder)) || [...keep].some((p) => isUnder(p, f.path))) } }
    const trashed = payload.done.filter((d) => d.outcome === "trashed")
    const refused = payload.done.length - trashed.length
    const bytes = trashed.reduce((n, d) => n + d.sizeBytes, 0)
    const summary = `${plural(trashed.length, "prepared entry", "prepared entries")} moved to the OS Trash (${formatBytes(bytes)}); ${plural(refused, "entry", "entries")} kept with a reason. Originals, library frames and Results are untouched.`
    return settleOperation(next, op.id, refused > 0 && trashed.length === 0 ? "failed" : refused > 0 ? "partial" : "succeeded", summary, payload.href)
  },
}

export const cOperationHandlers: OperationHandler[] = [prepareHandler, cleanupHandler]
