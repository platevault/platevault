/**
 * Slice C operation handler: "prepare" (PREP-FR-09, D09), registered by
 * `src/store/slices/c.ts`. Each tick reads the simulated disk, so a source
 * that changes or goes offline between ticks is observed honestly. Clean up
 * runs through the foundation's OS Trash engine (`moveToOsTrash`, kind
 * "run-cleanup").
 */
import { createFolder, fakeSha256, fileAt, makeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { deniedAncestor, isUnder } from "@/domain/indexing"
import type { Disk, FrameHeader, InputMode, Operation, OperationItem, Preparation, PreparationInput } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { joinRefs, type MessageRef, msg, verbatim } from "@/lib/i18n"
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

function block(item: OperationItem, detail: MessageRef): OperationItem {
  return { ...item, status: "blocked", phase: null, detail }
}

function sourceProblem(state: PrototypeState, entry: PrepareEntry): MessageRef | null {
  if (entry.unavailable) return msg("op_prep_unavailable", { reason: entry.unavailable })
  if (deniedAncestor(state.disk, entry.sourcePath)) return msg("op_prep_denied", { path: entry.sourcePath })
  if (!fileAt(state.disk, entry.sourcePath)) return msg("op_prep_not_reachable", { path: entry.sourcePath })
  return null
}

function prepareEntry(state: PrototypeState, payload: PreparePayload, item: OperationItem): { state: PrototypeState; item: OperationItem } {
  const entry = payload.entries[item.id]
  if (!entry) return { state, item: block(item, msg("op_prep_not_in_selection")) }
  const problem = sourceProblem(state, entry)
  if (problem) return { state, item: block(item, problem) }
  const source = fileAt(state.disk, entry.sourcePath)!
  const asset = entry.assetId ? state.catalog.assets[entry.assetId] : undefined
  if (asset && source.sha256 !== asset.sha256) {
    return { state, item: block(item, msg("op_prep_source_changed")) }
  }
  payload.snapshots[item.id] = source.sha256
  if (payload.mode === "direct-source") {
    payload.expected[item.id] = source.sha256
    return { state, item: { ...item, status: "done", phase: "verified", detail: msg("op_prep_direct_verified") } }
  }
  if (fileAt(state.disk, entry.destPath)) return { state, item: block(item, msg("op_prep_destination_exists", { path: entry.destPath })) }
  if (state.disk.readOnlyPaths.some((p) => isUnder(entry.destPath, p))) return { state, item: block(item, msg("op_prep_write_removed", { folder: payload.folderPath })) }
  const volumeId = volumeForPath(state.disk, entry.destPath)
  if (!volumeId || !state.disk.volumes[volumeId]?.mounted) return { state, item: block(item, msg("op_prep_destination_offline", { folder: payload.folderPath })) }
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
  if (!verified) return { state: next, item: { ...item, status: "failed", phase: null, detail: msg("op_prep_reread_failed", { path: entry.destPath }) } }
  const detail = entry.patches.length > 0 ? msg("op_prep_patched_verified", { patches: entry.patches.map((p) => `${FIELD_KEYWORD[p.field]} = ${p.value}`).join(", ") }) : msg("op_prep_written_verified")
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
    if (!entry || current?.sha256 !== payload.snapshots[item.id]) return block(item, msg("op_prep_source_drift", { source: entry ? verbatim(entry.sourcePath) : item.label }))
    return item
  })
  const prep = next.catalog.preparations[payload.preparationId]
  if (!prep) return settleOperation(next, op.id, "failed", msg("op_prep_record_missing"))
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
    blocked.push({ input, path: entry.sourcePath, reason: item.detail ?? msg("run_not_prepared") })
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
  const calibrationNote = calibrationTotal > 0 ? [msg("op_prep_calibration_note", { done: calibrationDone, total: calibrationTotal })] : []
  const inputs = { count: blocked.length, n: formatCount(blocked.length) }
  const summary = complete
    ? joinRefs([msg("op_prep_prepared", { prepared, total: prep.entryCount }), ...calibrationNote], " ")
    : state_ === "failed"
      ? msg("op_prep_failed", inputs)
      : joinRefs([msg("op_prep_partial", { prepared, ...inputs }), ...calibrationNote, msg("op_prep_partial_open_waits")], " ")
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

export const cOperationHandlers: OperationHandler[] = [prepareHandler]
