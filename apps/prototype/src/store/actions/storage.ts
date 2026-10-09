/**
 * Storage operations (foundation-owned). Scan for duplicates runs as a
 * `duplicate-scan` operation over the library's frames and records the
 * byte-identical live copies it found in its payload (`lastDuplicateScan`).
 * Storage lists nothing until a scan ran; moving a duplicate copy to the
 * Trash stays a Wrap up offer (D-W74).
 */
import { duplicateCopies } from "@/domain/storage"
import type { OperationId } from "@/domain/types"
import { formatBytes, plural } from "@/lib/format"
import { type CommitResult, store } from "@/store/core"
import { type OperationHandler, patchOperation, settleOperation, startOperation } from "@/store/operations"
import { refuse } from "./shared"

/** Frames the scan reads per tick. */
const FRAMES_PER_TICK = 120

/** Scan for duplicates; refused while a scan runs. */
export function startDuplicateScan(): { result: CommitResult; operationId: OperationId | null } {
  const { operations, catalog } = store.getState()
  if (Object.values(operations).some((op) => op.kind === "duplicate-scan" && (op.status === "running" || op.status === "paused"))) {
    return { result: refuse("Scan for duplicates refused", ["a scan is running"], "/storage"), operationId: null }
  }
  const total = Object.values(catalog.assets).filter((a) => !a.trashed).length
  const operationId = startOperation({ kind: "duplicate-scan", title: "Scan for duplicates", scope: {}, total, unit: "frames", canCancel: true })
  return { result: { ok: true }, operationId }
}

const duplicateScanStep: OperationHandler = {
  kind: "duplicate-scan",
  step: (state, op) => {
    const done = Math.min(op.progress.total, op.progress.done + FRAMES_PER_TICK)
    if (done < op.progress.total) return patchOperation(state, op.id, { progress: { ...op.progress, done } })
    const groups = duplicateCopies(state.catalog)
    const extra = groups.reduce((n, g) => n + g.extraBytes, 0)
    const next = patchOperation(state, op.id, { progress: { ...op.progress, done }, payload: { groups } })
    return settleOperation(next, op.id, "succeeded", groups.length === 0 ? "No duplicates." : `${plural(groups.length, "frame")} with extra copies · ${formatBytes(extra)}`, "/storage")
  },
}

export const STORAGE_HANDLERS: OperationHandler[] = [duplicateScanStep]
