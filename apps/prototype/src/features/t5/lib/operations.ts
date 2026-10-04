/**
 * T5 operation handlers and their start actions: "cleanup" (View cleanup to
 * the OS Trash), "archive" and "filing" (verified transfers). Registered by
 * the T5 slice. Each item is re-checked at execution; nothing is ever deleted
 * permanently, and a blocked item keeps its file.
 */
import { fileKey, removeFile } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import type { AssetId, Operation, OperationItem, Preparation, ResultId, ViewId, VolumeId } from "@/domain/types"
import { nowIso, type PrototypeState, store } from "@/store/core"
import { type OperationHandler, ensureTicker, patchOperation, settleOperation, startOperation } from "@/store/operations"
import { type ReviewedEntry, reviewDrift } from "./cleanup"
import { baseName, type PreparedEntry, preparedEntries, retainedOriginal, viewPreparations } from "./files"
import { buildPayload, retryRecords, stepTransfer, type TransferDraft, type TransferKind, type TransferPlan, transferTitle } from "./transfer"

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** One selected entry exactly as Review cleanup recorded it; execution re-verifies every field (STO-FR-04, D19). */
export interface CleanupItemRecord {
  key: string
  path: string
  volumeId: VolumeId
  sha256: string
  inode: number
  linkTarget: string | null
  group: string
  role: string
  /** Prepared entries and duplicates are re-proved immediately before removal. */
  needsProof: boolean
  isLink: boolean
  assetId: AssetId | null
  resultId: ResultId | null
  preparationId: string | null
  sizeBytes: number
  /** The retained original or kept copy the removal relies on, and its SHA-256 at review. */
  keptPath: string | null
  keptSha256: string | null
}

export interface CleanupPayload {
  viewId: ViewId
  viewPath: string
  records: CleanupItemRecord[]
  /** Paths sent to the OS Trash. */
  removed: string[]
  /** Paths refused, with the reason. */
  refused: Array<{ path: string; reason: string }>
  /** Selected items the user chose to keep after a refusal (Keep files). */
  kept: string[]
  trashedAt: string | null
}

const CLEANUP_BATCH = 24

/**
 * The View records what cleanup removed (STO-FR-05): each preparation drops the
 * entries that went to the OS Trash, so its entry count, footprint and prepared
 * inputs stay true while the View folder is offline and for later handoffs.
 */
function recordRemovedEntries(state: PrototypeState, records: CleanupItemRecord[], removed: Set<string>): PrototypeState {
  const byPreparation = new Map<string, CleanupItemRecord[]>()
  for (const record of records) {
    if (!record.preparationId || !removed.has(record.path)) continue
    byPreparation.set(record.preparationId, [...(byPreparation.get(record.preparationId) ?? []), record])
  }
  if (byPreparation.size === 0) return state
  const preparations = { ...state.catalog.preparations }
  for (const [id, gone] of byPreparation) {
    const preparation = preparations[id]
    if (!preparation) continue
    const assets = new Set(gone.map((r) => r.assetId).filter((a): a is AssetId => a !== null))
    const results = new Set(gone.map((r) => r.resultId).filter((r): r is ResultId => r !== null))
    const next: Preparation = {
      ...preparation,
      entryCount: Math.max(0, preparation.entryCount - gone.length),
      footprintBytes: Math.max(0, preparation.footprintBytes - gone.reduce((sum, r) => sum + (r.isLink ? 0 : r.sizeBytes), 0)),
      preparedAssetIds: preparation.preparedAssetIds.filter((a) => !assets.has(a)),
      preparedResultIds: preparation.preparedResultIds.filter((r) => !results.has(r)),
    }
    preparations[id] = next
  }
  return { ...state, catalog: { ...state.catalog, preparations } }
}

function cleanupStep(state: PrototypeState, op: Operation): PrototypeState {
  const payload = op.payload as unknown as CleanupPayload
  let next = state
  const items = op.items.map((i) => ({ ...i }))
  // Prepared entries of every preparation of this View, built once per step.
  let entriesByPath: Map<string, { entry: PreparedEntry; viewPath: string }> | null = null
  const entryAt = (path: string) => {
    if (!entriesByPath) {
      entriesByPath = new Map()
      for (const preparation of viewPreparations(next.catalog, payload.viewId)) {
        for (const entry of preparedEntries(next.disk, next.catalog, preparation)) entriesByPath.set(entry.file.path, { entry, viewPath: preparation.viewPath })
      }
    }
    return entriesByPath.get(path)
  }
  const removed = [...payload.removed]
  const refused = [...payload.refused]
  const now = nowIso()
  let budget = CLEANUP_BATCH
  for (const item of items) {
    if (budget === 0) break
    if (item.status !== "pending") continue
    budget -= 1
    const record = payload.records.find((r) => r.key === item.id)!
    const refuse = (reason: string) => {
      item.status = "blocked"
      item.detail = reason
      refused.push({ path: record.path, reason })
    }
    const volume = next.disk.volumes[record.volumeId]
    const file = next.disk.files[fileKey(record.volumeId, record.path)]
    // Immediately before the move: the entry, its link target and its kept copy still match the review (D19).
    const drift = volume?.mounted ? reviewDrift(next.disk, record) : null
    if (!volume?.mounted) refuse(`${volume?.name ?? "The volume"} is offline. Nothing was moved.`)
    else if (drift || !file) refuse(`${drift ?? "Changed since review."} Nothing was moved.`)
    else if (volume.trash === "unsupported") refuse(`Refused: OS Trash is unsupported on ${volume.name}. PlateVault never deletes permanently.`)
    else if (next.disk.readOnlyPaths.some((p) => isUnder(record.path, p))) refuse("Refused: write permission removed. Nothing was moved.")
    else {
      let proofFailure: string | null = null
      if (record.needsProof && !record.isLink) {
        const found = entryAt(record.path)
        const proof = found ? retainedOriginal(next.disk, next.catalog, found.entry, found.viewPath) : null
        if (!proof) proofFailure = "Insufficient retained-original proof: this entry no longer matches a prepared input."
        else if (proof.state !== "verified" && proof.state !== "not-needed") proofFailure = proof.text
      }
      if (record.group === "duplicates" && !record.keptPath) proofFailure = "No verified copy outside this View was named at review; this may be the last copy."
      if (proofFailure) refuse(proofFailure)
      else {
        next = {
          ...next,
          disk: { ...removeFile(next.disk, record.volumeId, record.path), trash: [...next.disk.trash, { file, originalPath: record.path, trashedAt: now }] },
        }
        item.status = "done"
        item.detail = record.isLink ? "Link sent to the OS Trash; its target was not followed." : "Sent to the OS Trash."
        removed.push(record.path)
      }
    }
  }
  const finished = items.filter((i) => i.status !== "pending").length
  next = patchOperation(next, op.id, {
    items,
    progress: { done: finished, total: items.length, unit: "files" },
    payload: { ...payload, removed, refused, trashedAt: payload.trashedAt ?? now } as unknown as Record<string, unknown>,
  })
  if (finished < items.length) return next
  next = recordRemovedEntries(next, payload.records, new Set(removed))
  const href = `/views/${payload.viewId}/cleanup`
  if (refused.length === 0) return settleOperation(next, op.id, "succeeded", `Sent ${removed.length} ${removed.length === 1 ? "file" : "files"} to the OS Trash.`, href)
  if (removed.length === 0) {
    return settleOperation(next, op.id, "failed", `Refused: none of the ${refused.length} selected files was moved. Nothing was deleted.`, href)
  }
  return settleOperation(next, op.id, "partial", `Partial: ${removed.length} sent to the OS Trash, ${refused.length} refused and kept in place.`, href)
}

/** Start cleanup of exactly the reviewed entries, carrying what Review cleanup recorded for each. */
export function startCleanup(viewId: ViewId, viewName: string, viewPath: string, entries: ReviewedEntry[]): string {
  const records: CleanupItemRecord[] = entries.map((e) => ({
    key: e.key,
    path: e.path,
    volumeId: e.volumeId,
    sha256: e.sha256,
    inode: e.inode,
    linkTarget: e.linkTarget,
    group: e.group,
    role: e.role,
    needsProof: e.group === "prepared" || e.group === "replaced",
    isLink: e.linkKind === "symlink",
    assetId: e.assetId,
    resultId: e.resultId,
    preparationId: e.preparationId,
    sizeBytes: e.sizeBytes,
    keptPath: e.proof?.keptPath ?? null,
    keptSha256: e.keptSha256,
  }))
  const items: OperationItem[] = entries.map((e) => ({ id: e.key, label: baseName(e.path), path: e.path, status: "pending", phase: null, detail: null }))
  const payload: CleanupPayload = { viewId, viewPath, records, removed: [], refused: [], kept: [], trashedAt: null }
  return startOperation({
    kind: "cleanup",
    title: `Clean up ${viewName}`,
    scope: { viewIds: [viewId] },
    total: items.length,
    unit: "files",
    items,
    payload: payload as unknown as Record<string, unknown>,
    canPause: false,
    canCancel: true,
  })
}

/** Keep files: the refused items stay where they are, and the View records that choice. */
export function keepRefusedFiles(opId: string) {
  store.setState((s) => {
    const op = s.operations[opId]
    if (!op) return s
    const payload = op.payload as unknown as CleanupPayload
    return patchOperation(s, opId, { payload: { ...payload, kept: payload.refused.map((r) => r.path) } as unknown as Record<string, unknown> })
  })
}

// ---------------------------------------------------------------------------
// Archive and filing
// ---------------------------------------------------------------------------

export function startTransfer(kind: TransferKind, plan: TransferPlan, draft: TransferDraft): string {
  const payload = buildPayload(plan, draft)
  return startOperation({
    kind,
    title: transferTitle(kind, plan),
    scope: { viewIds: plan.affectedViews.map((v) => v.id), sessionIds: plan.sessions.map((s) => s.id), locationIds: plan.location ? [plan.location.id] : [] },
    total: payload.records.length,
    unit: "files",
    items: payload.records.map((r) => ({ id: r.id, label: r.fileName, path: r.sourcePath, status: "pending", phase: "Pending", detail: null })),
    payload: payload as unknown as Record<string, unknown>,
    canPause: true,
    canCancel: true,
  })
}

export function retryTransferItems(opId: string, ids: string[]) {
  store.setState((s) => retryRecords(s, opId, ids))
  ensureTicker()
}

export const t5OperationHandlers: OperationHandler[] = [
  { kind: "cleanup", step: cleanupStep },
  { kind: "archive", step: stepTransfer },
  { kind: "filing", step: stepTransfer },
]
