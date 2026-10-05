/**
 * T4 operation handlers (T4-owned): "prepare" (PREP-FR-09, D09) and
 * "adopt-master" (CAL-FR-07, D05). Registered by the T4 slice. Each tick
 * reads the simulated disk, so prototype controls that change files between
 * ticks (drift, denied access, collisions) are observed honestly.
 */
import { copyAvailability, preferredCopy } from "@/domain/derive"
import { createFolder, fakeSha256, fileAt, filesUnder, makeFile, removeFile, volumeForPath, writeFiles } from "@/domain/disk"
import { assetIdForPath, isUnder } from "@/domain/indexing"
import type { Asset, CorrectionField, Disk, FrameHeader, InputMode, Operation, OperationItem, Preparation, PreparationInput } from "@/domain/types"
import { formatCount, plural } from "@/lib/format"
import { nowIso, type PrototypeState } from "@/store/core"
import { type OperationHandler, patchOperation, settleOperation } from "@/store/operations"
import { FIELD_KEYWORD, HANDOFF_FILE } from "./domain"

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

export interface PrepareEntry {
  kind: "light" | "calibration" | "product"
  assetId: string | null
  resultId: string | null
  sourcePath: string
  destPath: string
  fileName: string
  /** Reviewed catalog values an isolated entry carries in its header; empty when not patched (D15). */
  patches: Array<{ field: CorrectionField; value: string }>
}

export interface PreparePayload {
  preparationId: string
  viewId: string
  mode: InputMode
  linkType: "symlink" | "hardlink" | null
  viewPath: string
  outputPath: string
  entries: Record<string, PrepareEntry>
  /** Source SHA-256 recorded during this run, per item. */
  snapshots: Record<string, string>
  /** Destination digest the re-read must match, per item. */
  expected: Record<string, string>
  /** Destination paths this preparation wrote (its journal); only these may be replaced on Retry. */
  written: Record<string, string>
  /** Calibration items prepared in this and earlier runs. */
  calibrationPrepared: string[]
}

const BATCH = 5

function block(item: OperationItem, detail: string): OperationItem {
  return { ...item, status: "blocked", phase: null, detail }
}

function sourceProblem(state: PrototypeState, entry: PrepareEntry): string | null {
  const asset = entry.assetId ? state.catalog.assets[entry.assetId] : undefined
  if (asset) {
    const copy = preferredCopy(state.disk, state.catalog, asset)
    const availability = copyAvailability(state.disk, state.catalog, copy)
    if (availability === "retired") {
      return `Source retired: ${copy.path} is in retired location ${state.catalog.locations[copy.locationId]?.displayName ?? "unknown"} and is never an input. Nothing was written for it.`
    }
    if (availability === "offline") return `Source offline: ${copy.path} is on a volume that is not mounted. Nothing was written for it.`
    if (availability === "unreadable") return `Source unreadable: read access to ${copy.path} is denied. Nothing was written for it.`
    if (availability === "absent") return `Source not found at ${copy.path} at the last scan.`
  }
  if (state.disk.deniedPaths.some((denied) => isUnder(entry.sourcePath, denied))) return `Source unreadable: read access to ${entry.sourcePath} is denied. Nothing was written for it.`
  if (!fileAt(state.disk, entry.sourcePath)) return `Source not found: nothing exists at ${entry.sourcePath}.`
  return null
}

/**
 * Prepared entries that no longer match their preparation snapshot: the
 * source bytes or availability changed, or the written entry did (PREP-FR-10,
 * PREP-AC-15). Open runs this before every launch. Reads only. A preparation
 * without a run journal (recorded before this session) is checked against
 * each frame's recorded catalog digest and the View entry for it; one with
 * nothing recorded cannot be re-verified, so it fails closed.
 */
export function changedPreparedEntries(state: PrototypeState, prep: Preparation): Array<{ path: string; reason: string }> {
  const op = prep.operationId ? state.operations[prep.operationId] : undefined
  const payload = op?.payload as unknown as PreparePayload | undefined
  if (!payload?.entries) {
    if (prep.preparedAssetIds.length === 0) {
      return [{ path: prep.viewPath, reason: "No preparation snapshot is recorded for its entries, so they cannot be re-verified. Prepare the View again." }]
    }
    const written = filesUnder(state.disk, prep.viewPath)
    const changed: Array<{ path: string; reason: string }> = []
    for (const assetId of prep.preparedAssetIds) {
      const asset = state.catalog.assets[assetId]
      if (!asset) {
        changed.push({ path: prep.viewPath, reason: `A prepared frame (${assetId}) is no longer in the catalog.` })
        continue
      }
      const sourcePath = preferredCopy(state.disk, state.catalog, asset).path
      const problem = sourceProblem(state, { kind: "light", assetId, resultId: null, sourcePath, destPath: sourcePath, fileName: asset.fileName, patches: [] })
      if (problem) {
        changed.push({ path: sourcePath, reason: problem })
        continue
      }
      if (fileAt(state.disk, sourcePath)?.sha256 !== asset.sha256) {
        changed.push({ path: sourcePath, reason: "Changed since it was prepared: its SHA-256 differs from the recorded digest." })
        continue
      }
      const intact =
        prep.mode === "direct-source" ||
        (prep.mode === "linked" && prep.linkType === "symlink"
          ? written.some((f) => f.linkTarget === sourcePath)
          : written.some((f) => f.sha256 === asset.sha256 && f.path.endsWith(`/${asset.fileName}`)))
      if (!intact) changed.push({ path: sourcePath, reason: "Its View entry is missing or no longer matches what was prepared." })
    }
    return changed
  }
  const assets = new Set(prep.preparedAssetIds)
  const results = new Set(prep.preparedResultIds)
  const calibration = new Set(payload.calibrationPrepared)
  const changed: Array<{ path: string; reason: string }> = []
  for (const [id, entry] of Object.entries(payload.entries)) {
    const prepared = entry.kind === "calibration" ? calibration.has(id) : entry.resultId ? results.has(entry.resultId) : entry.assetId !== null && assets.has(entry.assetId)
    const snapshot = payload.snapshots[id]
    if (!prepared || !snapshot) continue
    const problem = sourceProblem(state, entry)
    if (problem) {
      changed.push({ path: entry.sourcePath, reason: problem })
      continue
    }
    if (fileAt(state.disk, entry.sourcePath)?.sha256 !== snapshot) {
      changed.push({ path: entry.sourcePath, reason: "Changed since its preparation snapshot: its SHA-256 differs." })
      continue
    }
    if (payload.mode === "direct-source") continue
    const written = fileAt(state.disk, entry.destPath)
    const intact = payload.mode === "linked" && payload.linkType === "symlink" ? written?.linkTarget === entry.sourcePath : written?.sha256 === payload.expected[id]
    if (!intact) changed.push({ path: entry.destPath, reason: "This entry no longer matches what was prepared." })
  }
  return changed
}

interface StepResult {
  state: PrototypeState
  item: OperationItem
  pause: boolean
}

/** Snapshot, write and verify one entry. A pause can split it after the snapshot (J24 P7). */
function prepareEntry(state: PrototypeState, payload: PreparePayload, item: OperationItem): StepResult {
  const entry = payload.entries[item.id]
  if (!entry) return { state, item: block(item, "Not in the recorded selection."), pause: false }
  let next = state
  if (item.phase !== "snapshot recorded") {
    const problem = sourceProblem(next, entry)
    if (problem) return { state: next, item: block(item, problem), pause: false }
    const file = fileAt(next.disk, entry.sourcePath)!
    const asset: Asset | undefined = entry.assetId ? next.catalog.assets[entry.assetId] : undefined
    if (asset && file.sha256 !== asset.sha256) {
      return { state: next, item: block(item, "Source changed since it was indexed: its bytes differ from the catalog fingerprint. Rescan and review it first."), pause: false }
    }
    payload.snapshots[item.id] = file.sha256
    const snapshotted: OperationItem = { ...item, status: "running", phase: "snapshot recorded", detail: `Source SHA-256 ${file.sha256.slice(0, 12)}… recorded.` }
    const t4 = next.slices.t4
    if (t4.world.pauseAfterSnapshot) {
      next = { ...next, slices: { ...next.slices, t4: { ...t4, world: { ...t4.world, pauseAfterSnapshot: false } } } }
      return {
        state: next,
        item: { ...snapshotted, detail: `Paused after recording this source's snapshot (prototype fault). SHA-256 ${file.sha256.slice(0, 12)}…` },
        pause: true,
      }
    }
    item = snapshotted
  }
  const snapshot = payload.snapshots[item.id]
  const problem = sourceProblem(next, entry)
  if (problem || !snapshot) return { state: next, item: block(item, problem ?? "No source snapshot was recorded; Retry takes a fresh one."), pause: false }
  const source = fileAt(next.disk, entry.sourcePath)!
  // Copying hashes the bytes it reads; links must resolve to the snapshotted identity.
  if (source.sha256 !== snapshot) {
    return {
      state: next,
      item: block(item, `Source drift: ${entry.sourcePath} changed after its snapshot (SHA-256 differs). PlateVault wrote nothing from the changed source and did not touch it.`),
      pause: false,
    }
  }
  if (payload.mode === "direct-source") {
    payload.expected[item.id] = snapshot
    return { state: next, item: { ...item, status: "done", phase: "verified", detail: "Exact source path listed; identity matches its snapshot." }, pause: false }
  }
  const existing = fileAt(next.disk, entry.destPath)
  if (existing && payload.written[item.id] !== entry.destPath) {
    return { state: next, item: block(item, `Destination exists: ${entry.destPath}. Nothing was overwritten.`), pause: false }
  }
  if (next.disk.readOnlyPaths.some((p) => isUnder(entry.destPath, p))) {
    return { state: next, item: block(item, `Write permission removed at ${payload.viewPath}. Nothing was written.`), pause: false }
  }
  const volumeId = volumeForPath(next.disk, entry.destPath)
  if (!volumeId || !next.disk.volumes[volumeId]?.mounted) {
    return { state: next, item: block(item, `Destination offline: ${payload.viewPath} is on a volume that is not mounted.`), pause: false }
  }
  const at = nowIso()
  let written
  if (payload.mode === "linked" && payload.linkType === "symlink") {
    written = makeFile({ path: entry.destPath, volumeId, sizeBytes: 0, kind: source.kind, linkTarget: source.path, modifiedAt: at })
    payload.expected[item.id] = snapshot
  } else if (payload.mode === "linked") {
    written = makeFile({ path: entry.destPath, volumeId, sizeBytes: source.sizeBytes, kind: source.kind, header: source.header, pixelTruth: source.pixelTruth, inode: source.inode, sha256: source.sha256, modifiedAt: at })
    payload.expected[item.id] = snapshot
  } else {
    // Copy or Clone: an isolated entry. A patched entry differs only by its reviewed header changes, one per field.
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
    const sha256 = entry.patches.length > 0 ? fakeSha256(entry.destPath, 7) : snapshot
    written = makeFile({ path: entry.destPath, volumeId, sizeBytes: source.sizeBytes, kind: source.kind, header, pixelTruth: source.pixelTruth, sha256, modifiedAt: at })
    payload.expected[item.id] = sha256
  }
  next = { ...next, disk: writeFiles(next.disk, [written]) }
  payload.written[item.id] = entry.destPath
  const reread = fileAt(next.disk, entry.destPath)
  const verified = payload.mode === "linked" && payload.linkType === "symlink" ? fileAt(next.disk, reread?.linkTarget ?? "")?.sha256 === snapshot : reread?.sha256 === payload.expected[item.id]
  if (!verified) return { state: next, item: { ...item, status: "failed", phase: null, detail: `The entry at ${entry.destPath} did not re-read to the expected digest.` }, pause: false }
  const detail =
    entry.patches.length > 0
      ? `Patched copy verified: ${entry.patches.map((p) => `${FIELD_KEYWORD[p.field]} = ${p.value}`).join(", ")}; original unchanged.`
      : "Written and re-read against its snapshot."
  return { state: next, item: { ...item, status: "done", phase: "verified", detail }, pause: false }
}

function patchPreparation(state: PrototypeState, id: string, patch: Partial<Preparation>): PrototypeState {
  const prep = state.catalog.preparations[id]
  if (!prep) return state
  return { ...state, catalog: { ...state.catalog, preparations: { ...state.catalog.preparations, [id]: { ...prep, ...patch } } } }
}

function finalizePrepare(state: PrototypeState, op: Operation, payload: PreparePayload): PrototypeState {
  let next = state
  // Immediately before terminal success each source must still match its snapshot.
  const items = op.items.map((item): OperationItem => {
    if (item.status !== "done") return item
    const entry = payload.entries[item.id]
    const current = entry ? fileAt(next.disk, entry.sourcePath) : undefined
    if (!entry || current?.sha256 !== payload.snapshots[item.id]) {
      return block(item, `Source drift detected before completion: ${entry?.sourcePath ?? item.label} no longer matches its snapshot. Its entry is not counted as prepared.`)
    }
    return item
  })
  const prep = next.catalog.preparations[payload.preparationId]
  if (!prep) return settleOperation(next, op.id, "failed", "The preparation record is missing; nothing was settled.")
  const prepared = new Set(prep.preparedAssetIds)
  const preparedResults = new Set(prep.preparedResultIds)
  const calibrationPrepared = new Set(payload.calibrationPrepared)
  const blockedNow = new Map<string, { input: PreparationInput; path: string; reason: string }>()
  // Calibration files without an asset record use their `f:` item id as the asset id.
  for (const b of prep.blocked) blockedNow.set(b.input.kind === "result" ? `r:${b.input.resultId}` : b.input.assetId.startsWith("f:") ? b.input.assetId : `a:${b.input.assetId}`, b)
  for (const item of items) {
    const entry = payload.entries[item.id]
    if (!entry) continue
    if (item.status === "done") {
      blockedNow.delete(item.id)
      if (entry.kind === "calibration") calibrationPrepared.add(item.id)
      else if (entry.resultId) preparedResults.add(entry.resultId)
      else if (entry.assetId) prepared.add(entry.assetId)
    } else if (item.status === "blocked" || item.status === "failed" || item.status === "pending" || item.status === "running") {
      const input: PreparationInput = entry.resultId ? { kind: "result", resultId: entry.resultId } : { kind: "asset", assetId: entry.assetId ?? item.id }
      blockedNow.set(item.id, { input, path: entry.sourcePath, reason: item.detail ?? "Not prepared" })
    }
  }
  const allEntries = Object.values(payload.entries)
  const calibrationTotal = allEntries.filter((e) => e.kind === "calibration").length
  const preparedCount = prepared.size + preparedResults.size
  const blockedCount = [...blockedNow.keys()].filter((key) => payload.entries[key]?.kind !== "calibration").length
  const calibrationBlocked = [...blockedNow.keys()].filter((key) => payload.entries[key]?.kind === "calibration").length
  const complete = preparedCount === prep.entryCount && blockedNow.size === 0 && calibrationPrepared.size === calibrationTotal
  // The handoff list names exact paths; output/ is an explicit folder for discovery and cleanup.
  const volumeId = volumeForPath(next.disk, payload.viewPath)
  if (volumeId && next.disk.volumes[volumeId]?.mounted) {
    let disk: Disk = createFolder(next.disk, { volumeId, path: payload.viewPath })
    const outVolume = volumeForPath(disk, payload.outputPath)
    if (outVolume) disk = createFolder(disk, { volumeId: outVolume, path: payload.outputPath })
    disk = writeFiles(disk, [makeFile({ path: `${payload.viewPath}/${HANDOFF_FILE}`, volumeId, sizeBytes: 64 * (preparedCount + calibrationPrepared.size) + 120, kind: "text", modifiedAt: nowIso() })])
    next = { ...next, disk }
  }
  const calibrationNote = calibrationTotal > 0 ? ` Calibration: ${formatCount(calibrationPrepared.size)} of ${formatCount(calibrationTotal)} files prepared${calibrationBlocked ? `, ${formatCount(calibrationBlocked)} blocked` : ""}.` : ""
  const summary = complete
    ? `Prepared: ${formatCount(preparedCount)} of ${formatCount(prep.entryCount)} entries match the confirmed membership and their source snapshots.${calibrationNote}`
    : preparedCount === 0 && calibrationPrepared.size === 0
      ? `Failed: no entry could be prepared; ${plural(blockedNow.size, "item")} blocked. Sources are untouched.`
      : `Partial: ${formatCount(preparedCount)} prepared, ${formatCount(blockedCount)} blocked.${calibrationNote} Open is not offered until every entry is prepared; sources are untouched.`
  const stateValue: Preparation["state"] = complete ? "prepared" : preparedCount === 0 && calibrationPrepared.size === 0 ? "failed" : "partial"
  next = patchOperation(next, op.id, {
    items,
    payload: { ...payload, calibrationPrepared: [...calibrationPrepared] } as unknown as Record<string, unknown>,
    progress: { ...op.progress, done: op.progress.total },
  })
  next = patchPreparation(next, payload.preparationId, {
    state: stateValue,
    preparedAssetIds: [...prepared],
    preparedResultIds: [...preparedResults],
    blocked: [...blockedNow.values()],
    settledAt: nowIso(),
  })
  return settleOperation(next, op.id, complete ? "succeeded" : stateValue === "failed" ? "failed" : "partial", summary, `/views/${payload.viewId}/prepare`)
}

const prepareHandler: OperationHandler = {
  kind: "prepare",
  step(state, op) {
    const payload = structuredClone(op.payload) as unknown as PreparePayload
    let next = state
    const items = [...op.items]
    let processed = 0
    let paused = false
    for (let index = 0; index < items.length && processed < BATCH; index += 1) {
      const item = items[index]!
      if (item.status !== "pending" && item.status !== "running") continue
      const result = prepareEntry(next, payload, item)
      next = result.state
      items[index] = result.item
      processed += 1
      if (result.pause) {
        paused = true
        break
      }
    }
    const done = items.filter((i) => i.status !== "pending" && i.status !== "running").length
    next = patchOperation(next, op.id, {
      items,
      payload: payload as unknown as Record<string, unknown>,
      progress: { ...op.progress, done },
      ...(paused ? { status: "paused" as const } : {}),
    })
    if (paused) return patchPreparation(next, payload.preparationId, { state: "paused" })
    if (items.every((i) => i.status !== "pending" && i.status !== "running")) return finalizePrepare(next, next.operations[op.id]!, payload)
    const prep = next.catalog.preparations[payload.preparationId]
    return prep && prep.state !== "running" ? patchPreparation(next, payload.preparationId, { state: "running" }) : next
  },
}

// ---------------------------------------------------------------------------
// Adopt master (D05)
// ---------------------------------------------------------------------------

export interface AdoptPayload {
  masterId: string
  reviewedSha256: string
  sourcePath: string
  destinationPath: string
  locationId: string
  /** The in-flight copy; indexing ignores it, so an unverified copy is never registered. */
  partialPath: string
  copyWritten: boolean
  pauseBeforeRegister: boolean
}

export const ADOPT_PHASES = [
  { id: "check", label: "Check destination again" },
  { id: "copy", label: "Copy and hash the bytes read" },
  { id: "verify", label: "Re-read and verify the copy" },
  { id: "revalidate", label: "Revalidate the source" },
  { id: "register", label: "Register in Calibration" },
] as const

function setItem(op: Operation, id: string, patch: Partial<OperationItem>): OperationItem[] {
  return op.items.map((item) => (item.id === id ? { ...item, ...patch } : item))
}

function settleAdoption(state: PrototypeState, op: Operation, items: OperationItem[], status: "succeeded" | "failed", summary: string, masterId: string): PrototypeState {
  const remaining = items.map((item) => (item.status === "pending" ? { ...item, status: "skipped" as const, detail: "Not run: adoption stopped earlier." } : item))
  const next = patchOperation(state, op.id, { items: remaining, progress: { ...op.progress, done: op.progress.total } })
  return settleOperation(next, op.id, status, summary, `/calibration/${masterId}`)
}

const adoptHandler: OperationHandler = {
  kind: "adopt-master",
  step(state, op) {
    const payload = op.payload as unknown as AdoptPayload
    const phase = op.items.find((item) => item.status === "pending" || item.status === "running")
    if (!phase) return state
    let next = state
    const master = next.catalog.masters[payload.masterId]
    const unregistered = payload.copyWritten ? ` The copy at ${payload.partialPath} is unregistered and never offered for reuse.` : ""
    const done = (detail: string) => setItem(op, phase.id, { status: "done", detail })
    const advance = (items: OperationItem[], patch: Partial<AdoptPayload> = {}) =>
      patchOperation(next, op.id, { items, payload: { ...payload, ...patch } as unknown as Record<string, unknown>, progress: { ...op.progress, done: items.filter((i) => i.status === "done").length } })
    if (!master) return settleAdoption(next, op, setItem(op, phase.id, { status: "failed", detail: "The candidate record is gone." }), "failed", "Not adopted: the candidate record no longer exists.", payload.masterId)

    switch (phase.id) {
      case "check": {
        const volumeId = volumeForPath(next.disk, payload.destinationPath)
        if (!volumeId || !next.disk.volumes[volumeId]?.mounted) {
          return settleAdoption(next, op, setItem(op, "check", { status: "blocked", detail: "The destination volume is offline." }), "failed", `Not adopted: the destination for ${payload.destinationPath} is offline. Nothing was written.`, payload.masterId)
        }
        const existing = fileAt(next.disk, payload.destinationPath)
        if (existing) {
          return settleAdoption(
            next,
            op,
            setItem(op, "check", { status: "blocked", detail: `${payload.destinationPath} already exists (SHA-256 ${existing.sha256.slice(0, 12)}…).` }),
            "failed",
            `Not adopted: ${payload.destinationPath} already exists. Choose another name or folder; the existing file was not changed. No copy was written and the candidate stays at ${payload.sourcePath}.`,
            payload.masterId,
          )
        }
        if (next.disk.readOnlyPaths.some((p) => isUnder(payload.destinationPath, p))) {
          return settleAdoption(next, op, setItem(op, "check", { status: "blocked", detail: "Write permission removed." }), "failed", `Not adopted: PlateVault cannot write to ${payload.destinationPath}. Nothing was written.`, payload.masterId)
        }
        return advance(done("The destination path is free."))
      }
      case "copy": {
        const source = fileAt(next.disk, payload.sourcePath)
        if (!source) {
          return settleAdoption(next, op, setItem(op, "copy", { status: "failed", detail: "The candidate file is gone." }), "failed", `Not adopted: nothing exists at ${payload.sourcePath} any more. Nothing was registered.`, payload.masterId)
        }
        if (source.sha256 !== payload.reviewedSha256) {
          return settleAdoption(
            next,
            op,
            setItem(op, "copy", { status: "blocked", detail: `Source drift: SHA-256 ${source.sha256.slice(0, 12)}… differs from the reviewed ${payload.reviewedSha256.slice(0, 12)}….` }),
            "failed",
            `Blocked: the candidate's bytes changed after review (SHA-256 differs). Nothing was copied or registered. Review the current bytes to adopt.`,
            payload.masterId,
          )
        }
        const volumeId = volumeForPath(next.disk, payload.partialPath)!
        const copy = makeFile({ path: payload.partialPath, volumeId, sizeBytes: source.sizeBytes, kind: "other", sha256: source.sha256, modifiedAt: nowIso() })
        next = { ...next, disk: writeFiles(next.disk, [copy]) }
        return advance(done(`Copied ${plural(1, "file")}; bytes read hash to the reviewed digest.`), { copyWritten: true })
      }
      case "verify": {
        const copy = fileAt(next.disk, payload.partialPath)
        if (next.faults.failNextHashVerification || copy?.sha256 !== payload.reviewedSha256) {
          next = { ...next, faults: { ...next.faults, failNextHashVerification: false } }
          return settleAdoption(
            next,
            op,
            setItem(op, "verify", { status: "failed", detail: "The re-read digest differs from the reviewed SHA-256." }),
            "failed",
            `Verification failed: the copy did not re-read to the reviewed SHA-256. Nothing was registered; the candidate is kept.${unregistered}`,
            payload.masterId,
          )
        }
        const items = done("Re-read matches the reviewed SHA-256.")
        if (payload.pauseBeforeRegister) {
          const pausedItems = items.map((item) => (item.id === "revalidate" ? { ...item, status: "running" as const, phase: "awaiting registration", detail: "Paused after verification, before registration (prototype fault)." } : item))
          return patchOperation(advance(pausedItems, { pauseBeforeRegister: false }), op.id, { status: "paused" })
        }
        return advance(items)
      }
      case "revalidate": {
        const source = fileAt(next.disk, payload.sourcePath)
        if (source?.sha256 !== payload.reviewedSha256) {
          return settleAdoption(
            next,
            op,
            setItem(op, "revalidate", { status: "blocked", phase: null, detail: "Source drift: the candidate no longer matches the reviewed digest." }),
            "failed",
            `Blocked: the candidate changed after its copy verified (source drift). Nothing was registered; a new review is required.${unregistered}`,
            payload.masterId,
          )
        }
        return advance(setItem(op, "revalidate", { status: "done", phase: null, detail: "Source still matches the reviewed digest." }))
      }
      case "register": {
        const partial = fileAt(next.disk, payload.partialPath)
        const source = fileAt(next.disk, payload.sourcePath)
        const volumeId = volumeForPath(next.disk, payload.destinationPath)!
        const at = nowIso()
        const final = makeFile({
          path: payload.destinationPath,
          volumeId,
          sizeBytes: partial?.sizeBytes ?? source?.sizeBytes ?? 0,
          kind: source?.kind ?? "xisf",
          header: source?.header ?? null,
          pixelTruth: source?.pixelTruth ?? null,
          sha256: payload.reviewedSha256,
          modifiedAt: at,
        })
        let disk = removeFile(next.disk, volumeId, payload.partialPath)
        disk = writeFiles(disk, [final])
        const assetId = assetIdForPath(payload.destinationPath)
        const header = source?.header
        const catalog = {
          ...next.catalog,
          masters: {
            ...next.catalog.masters,
            [master.id]: { ...master, state: "adopted" as const, path: payload.destinationPath, adoption: { destinationPath: payload.destinationPath, verifiedSha256: payload.reviewedSha256, adoptedAt: at } },
          },
          // Recorded as the Calibration location will observe it, so a rescan keeps this provenance.
          assets: header
            ? {
                ...next.catalog.assets,
                [assetId]: {
                  id: assetId,
                  fileName: payload.destinationPath.slice(payload.destinationPath.lastIndexOf("/") + 1),
                  format: final.kind === "xisf" ? ("xisf" as const) : ("fits" as const),
                  sizeBytes: final.sizeBytes,
                  sha256: payload.reviewedSha256,
                  observed: header,
                  imageType: header.imageType,
                  sessionId: null,
                  copies: [{ locationId: payload.locationId, volumeId, path: payload.destinationPath, sha256: payload.reviewedSha256, presence: "observed" as const, lastObservedAt: at }],
                  quality: { value: "unreviewed" as const, decidedAt: null, basisSha256: null },
                },
              }
            : next.catalog.assets,
        }
        next = { ...next, disk, catalog }
        const items = setItem(op, "register", { status: "done", detail: "Registered with its origin and verified SHA-256." })
        const view = master.origin.viewId ? next.catalog.views[master.origin.viewId] : undefined
        return settleAdoption(
          next,
          op,
          items,
          "succeeded",
          `Adopted: ${payload.destinationPath} is a library master with origin ${view ? view.name : "a processing output"}. The generated source stays at ${payload.sourcePath} until a reviewed cleanup.`,
          payload.masterId,
        )
      }
      default:
        return state
    }
  },
}

export const t4OperationHandlers: OperationHandler[] = [prepareHandler, adoptHandler]
