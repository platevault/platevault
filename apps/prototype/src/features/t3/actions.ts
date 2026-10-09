/**
 * Frame-review writes kept from v4 for slice D: imported measurements
 * (PIX-FR-06, PIX-FR-07) and the frame-review UI state in slice D. Quality
 * marks (P/X/U, Reject for this Project only) and Exclude from run are the
 * shared actions in `src/store/actions/library.ts` and `runs.ts`.
 */
import { runHref } from "@/domain/derive"
import { stableHash } from "@/domain/indexing"
import type { AssetId, Catalog, FrameMeasurement, MeasurementImport, MeasurementImportRow, RunId } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { m, msg } from "@/lib/i18n"
import { type CommitResult, commit, nowIso, recordActivity, store, updateSlice, withCatalog } from "@/store/core"
import { defaultFrameUi, type FrameUi } from "@/store/slices/d"
import { attaches, type CsvRow, importedMetrics, type MappedRow, observeFrame } from "./csv"
import { historyEntry } from "./measure"

function reviewHref(runId: RunId): string {
  const run = store.getState().catalog.runs[runId]
  return run ? runHref(run, "review") : "/projects"
}

/**
 * Add imported metrics next to built-in ones; an earlier import of the same metric is replaced, a built-in value never.
 * `sha256` is the import observation: the frame's bytes read when the mapping was confirmed (PIX-FR-06). Values are
 * attached only while those bytes equal the frame's recorded basis, so they join its current record; a frame with no
 * record starts one of the observed bytes. The digest only detects later drift: imported values stay content unverified
 * (D19) and become history once the frame differs from it.
 */
function withImported(catalog: Catalog, assetId: AssetId, row: Pick<CsvRow, "index" | "file" | "values">, path: string, sha256: string): FrameMeasurement {
  const record = catalog.measurements[assetId]
  const metrics = importedMetrics({ ...row, approved: true, psfSignalWeight: 0 }, path)
  const keys = new Set(metrics.map((m) => m.key))
  if (record && record.inputSha256 === sha256) return { ...record, metrics: [...record.metrics.filter((m) => m.source === "built-in" || !keys.has(m.key)), ...metrics] }
  const earlier = record ? historyEntry(record) : null
  return { assetId, state: "unavailable", inputSha256: sha256, metrics, computedAt: nowIso(), history: [...(earlier ? [earlier] : []), ...(record?.history ?? [])] }
}

export function importMeasurements(runId: RunId, path: string, mapped: MappedRow[], runAssetIds: Set<AssetId>): CommitResult {
  const attach = mapped.filter(attaches)
  const rows: MeasurementImportRow[] = mapped
    .filter((m) => !attaches(m))
    .map((m) => ({ index: m.row.index, file: m.row.file, status: m.status as MeasurementImportRow["status"], candidates: m.candidates, assetId: null, values: m.row.values }))
  const changed = rows.filter((r) => r.status === "content-changed" || r.status === "unreadable").length
  const record: MeasurementImport = {
    id: `imp_${stableHash(`${path}|${nowIso()}`)}`,
    runId,
    path,
    importedAt: nowIso(),
    matched: attach.length,
    outsideRun: attach.filter((m) => !runAssetIds.has(m.assetId!)).length,
    rows,
  }
  const href = reviewHref(runId)
  // Matched values and the rows left to review are one durable write.
  const result = commit(
    msg("importdlg_title"),
    (s) =>
      withCatalog(s, (c) => {
        const measurements = { ...c.measurements }
        for (const m of attach) measurements[m.assetId!] = withImported({ ...c, measurements }, m.assetId!, m.row, path, m.observedSha256!)
        return { ...c, measurements, measurementImports: { ...c.measurementImports, [record.id]: record } }
      }),
    { href },
  )
  if (!result.ok) return result
  recordActivity({
    kind: "saved",
    title: msg("store_saved_measurements_imported"),
    detail: changed > 0
      ? msg("store_measurements_detail_changed", { count: attach.length, n: formatCount(attach.length), path, rows: rows.length, changed })
      : msg("store_measurements_detail", { count: attach.length, n: formatCount(attach.length), path, rows: rows.length }),
    operationId: null,
    href,
  })
  return result
}

/** Attach an ambiguous row to the frame the user chose, only while that frame's bytes still equal its recorded basis. */
export function resolveImportRow(importId: string, rowIndex: number, assetId: AssetId): CommitResult {
  const { catalog, disk } = store.getState()
  const record = catalog.measurementImports[importId]
  const row = record?.rows.find((r) => r.index === rowIndex)
  if (!record || !row) return { ok: false, reason: "write-failed", message: m.importdlg_row_not_found() }
  const seen = observeFrame(disk, catalog, assetId, null)
  if (seen.state === "unreadable") return { ok: false, reason: "write-failed", message: m.importdlg_row_not_attached_unreadable() }
  if (seen.state === "content-changed")
    return { ok: false, reason: "write-failed", message: seen.basis?.recordedBy === "measurement" ? m.importdlg_row_not_attached_measured() : m.importdlg_row_not_attached_indexed() }
  const rows = record.rows.map((r) => (r.index === rowIndex ? { ...r, status: "resolved" as const, assetId } : r))
  return commit(
    msg("store_label_attach_imported_row"),
    (s) =>
      withCatalog(s, (c) => ({
        ...c,
        measurements: { ...c.measurements, [assetId]: withImported(c, assetId, row, record.path, seen.observedSha256!) },
        measurementImports: { ...c.measurementImports, [importId]: { ...record, rows } },
      })),
    { href: reviewHref(record.runId) },
  )
}

/** Frame-review UI state for one run (slice D); not a durable catalog write. */
export function setFrameUi(runId: RunId, patch: Partial<FrameUi>) {
  updateSlice("d", (slice) => ({ ...slice, frames: { ...slice.frames, [runId]: { ...(slice.frames[runId] ?? defaultFrameUi()), ...patch } } }))
}
