/**
 * Storage operations (foundation-owned; P-STO2).
 *
 * - The duplicate scan (`duplicate-scan`) runs by itself after each index
 *   and import (`addDuplicateScan` in store/operations.ts), and again on
 *   Scan again in the Duplicates review. It reads the library's frames and
 *   records the byte-identical live copies it found in its payload
 *   (`duplicateFindings`, domain/storage.ts).
 * - Clean up moves the chosen duplicate copies to the OS Trash through the
 *   shared engine (`moveToOsTrash`); nothing is deleted permanently, and each
 *   frame keeps one copy with its record, quality and memberships.
 */
import { duplicateCopies, runningDuplicateScan } from "@/domain/storage"
import type { AssetId, OperationId } from "@/domain/types"
import { formatBytes } from "@/lib/format"
import { msg } from "@/lib/i18n"
import { type CommitResult, store } from "@/store/core"
import { addDuplicateScan, ensureTicker, type OperationHandler, patchOperation, settleOperation } from "@/store/operations"
import { refuse } from "./shared"
import { moveToOsTrash } from "./trash"

/** Where the scan and the clean-up link: the Duplicates review over Settings › Locations. */
export const DUPLICATES_HREF = "/settings/locations?duplicates=review"

/** Frames the scan reads per tick. */
const FRAMES_PER_TICK = 120

/** Scan again; refused while a scan runs. */
export function startDuplicateScan(): CommitResult {
  if (runningDuplicateScan(store.getState().operations)) return refuse(msg("store_refused", { label: msg("storage_scan") }), [msg("store_reason_scan_running")], DUPLICATES_HREF)
  store.setState((s) => addDuplicateScan(s).state)
  ensureTicker()
  return { ok: true }
}

const duplicateScanStep: OperationHandler = {
  kind: "duplicate-scan",
  // Background work: after a restart it carries on instead of waiting as interrupted work.
  survivesRestart: true,
  href: () => DUPLICATES_HREF,
  step: (state, op) => {
    const done = Math.min(op.progress.total, op.progress.done + FRAMES_PER_TICK)
    if (done < op.progress.total) return patchOperation(state, op.id, { progress: { ...op.progress, done } })
    const groups = duplicateCopies(state.catalog, state.disk)
    const extra = (g: (typeof groups)[number]) => g.paths.length - 1
    const copies = groups.reduce((n, g) => n + extra(g), 0)
    const bytes = groups.reduce((n, g) => n + (state.catalog.assets[g.assetId]?.sizeBytes ?? 0) * extra(g), 0)
    const next = patchOperation(state, op.id, { progress: { ...op.progress, done }, payload: { groups } })
    const summary = copies === 0 ? msg("op_no_duplicates") : msg("issue_duplicates", { count: copies, bytes: formatBytes(bytes) })
    return settleOperation(next, op.id, "succeeded", summary, DUPLICATES_HREF)
  },
}

/** One frame's copies to move: every copy but the one it keeps. */
export interface DuplicateCleanUp {
  assetId: AssetId
  paths: string[]
}

/** Move the chosen duplicate copies to the OS Trash; returns the operation id. */
export function cleanUpDuplicates(cleanUps: DuplicateCleanUp[]): OperationId {
  const items = cleanUps.flatMap((c) => c.paths.map((path) => ({ path, assetId: c.assetId })))
  return moveToOsTrash({ kind: "duplicate-copies", title: msg("duplicates_trash_title"), projectId: null, runIds: [], items, unit: "files", href: DUPLICATES_HREF })
}

export const STORAGE_HANDLERS: OperationHandler[] = [duplicateScanStep]
