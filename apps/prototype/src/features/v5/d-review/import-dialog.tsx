/**
 * Import measurements (D6, PIX-FR-06, PIX-FR-07, PIX-AC-04, PIX-AC-05,
 * PIX-AC-11), a FormDialog with two steps: Choose the export, then Preview
 * its column and row mapping and import. Matched rows attach imported values
 * next to built-in ones, stamped with the frame's bytes read at preview and
 * read as content unverified (D19). A matched frame whose bytes differ from
 * what PlateVault recorded, or cannot be read, attaches nothing; unmatched
 * and ambiguous rows attach to nothing until the user picks their frame in
 * Imported measurements. Unsupported columns stay unavailable; rejection
 * decisions are never imported; nothing is excluded and no quality changes.
 */
import { useState } from "react"
import { useMessages, usePreferences } from "@/app/preferences"
import type { Action, Column, MenuItem, StepFlow } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { SelectField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { StatusBadge } from "@/components/app/status"
import { sessionLabel } from "@/domain/membership"
import type { AssetId, Catalog, MeasurementImport, MeasurementImportRow } from "@/domain/types"
import { formatBytes, formatCount, formatDateTime, formatDecimal } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { useStore } from "@/store/core"
import { importMeasurements, resolveImportRow } from "./actions"
import { attaches, CSV_COLUMNS, type CsvColumn, EXPORT_SCALE, IMPORT_FORMAT, IMPORT_METHOD, type MappedRow, mapRows, readSubframeSelectorCsv } from "./csv"

/** A frame as an import row names it: its file name and session. */
export function frameName(m: Messages, catalog: Catalog, id: AssetId): string {
  const asset = catalog.assets[id]
  if (!asset) return m.importdlg_unknown_frame()
  const session = asset.sessionId ? catalog.sessions[asset.sessionId] : undefined
  return session ? m.importdlg_frame_in_session({ file: asset.fileName, session: sessionLabel(m, session) }) : asset.fileName
}

function columnBadge(m: Messages, column: CsvColumn) {
  if (column.status === "mapped") return <StatusBadge kind="match" value="compatible" label={m.frame_col_imported()} />
  if (column.status === "unavailable") return <StatusBadge kind="match" value="unknown" label={m.coverage_unavailable()} />
  if (column.status === "not-imported") return <StatusBadge kind="item" value="skipped" label={m.importdlg_not_imported()} />
  return <StatusBadge kind="match" value="compatible" label={m.importdlg_identity()} />
}

function matchBadge(m: Messages, status: MappedRow["status"] | MeasurementImportRow["status"]) {
  switch (status) {
    case "matched":
    case "matched-by-name":
    case "resolved":
      return <StatusBadge kind="match" value="compatible" label={status === "resolved" ? m.importdlg_row_attached_by_you() : m.importdlg_row_matched()} />
    case "content-changed":
      return <StatusBadge kind="association" value="needs-review" label={m.importdlg_badge_changed()} />
    case "unreadable":
      return <StatusBadge kind="association" value="needs-review" label={m.importdlg_badge_unreadable()} />
    case "ambiguous":
      return <StatusBadge kind="match" value="unknown" label={m.importdlg_ambiguous()} />
    default:
      return <StatusBadge kind="match" value="incompatible" label={m.importdlg_unmatched()} />
  }
}

/** The CSV columns and how each one maps. */
function ColumnMapping() {
  const m = useMessages()
  const columns: Column<CsvColumn>[] = [
    { id: "name", header: m.importdlg_col_csv(), rowHeader: true, sortValue: (c) => c.name, cell: (c) => c.name },
    { id: "unit", header: m.importdlg_col_unit(), sortValue: (c) => c.unit, cell: (c) => c.unit ?? "–" },
    { id: "mapping", header: m.importdlg_col_mapping(), sortValue: (c) => c.status, cell: (c) => columnBadge(m, c) },
    { id: "note", header: m.importdlg_col_note(), sortValue: (c) => c.note, cell: (c) => c.note },
  ]
  return <DataTable label={m.importdlg_column_mapping()} rows={CSV_COLUMNS} columns={columns} getRowId={(c) => c.name} scroll="none" />
}

export function ImportDialog({ scopeKey, href, viewAssetIds, open, onOpenChange }: { scopeKey: string; href: string; viewAssetIds: ReadonlySet<AssetId>; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const { locale } = usePreferences()
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const [path, setPath] = useState<string | null>(null)
  const [step, setStep] = useState<"choose" | "preview">("choose")
  const csvFiles = Object.values(disk.files)
    .filter((f) => f.kind === "csv" && disk.volumes[f.volumeId]?.mounted)
    .sort((a, b) => a.path.localeCompare(b.path))
  const chosen = csvFiles.find((f) => f.path === path) ?? null
  const rows = path ? readSubframeSelectorCsv(disk, path) : null
  const mapped = rows ? mapRows(disk, catalog, rows) : []
  const matched = mapped.filter(attaches)
  const outstanding = mapped.filter((r) => !attaches(r))
  const outside = matched.filter((r) => !viewAssetIds.has(r.assetId!)).length
  const byName = matched.filter((r) => r.status === "matched-by-name").length
  const names = (ids: AssetId[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(ids.map((id) => frameName(m, catalog, id)))

  const chooseGate = path ? null : { reason: csvFiles.length === 0 ? m.importdlg_blocked_no_export() : m.importdlg_blocked_choose(), blockers: [] }
  const previewGate = !rows ? { reason: m.importdlg_blocked_unsupported(), blockers: [] } : matched.length === 0 ? { reason: m.importdlg_blocked_no_match(), blockers: [] } : null
  const proceed: Action =
    step === "choose"
      ? { id: "import-preview", label: m.importdlg_review_mapping(), kind: "primary", run: () => setStep("preview") }
      : {
          id: "import-rows",
          label: m.importdlg_import_rows({ count: matched.length }),
          kind: "primary",
          run: () => (path ? importMeasurements(scopeKey, href, path, mapped, viewAssetIds) : undefined),
        }
  const flow: StepFlow = {
    steps: [
      { id: "choose", label: m.importdlg_step_choose(), state: step === "choose" ? (chooseGate ? "blocked" : "current") : "finished", gate: step === "choose" ? chooseGate : null, summary: chosen?.path.slice(chosen.path.lastIndexOf("/") + 1) },
      { id: "preview", label: m.importdlg_step_preview(), state: step === "preview" ? (previewGate ? "blocked" : "current") : "todo", gate: step === "preview" ? previewGate : null },
    ],
    current: step,
    ordered: true,
    proceed,
    next: null,
    reopen: (id) => ({ id: `reopen-${id}`, label: m.importdlg_choose_again(), run: () => setStep("choose") }),
  }

  const rowColumns: Column<MappedRow>[] = [
    { id: "row", header: m.importdlg_col_row(), align: "right", sortValue: (r) => r.row.index, cell: (r) => formatCount(r.row.index) },
    { id: "file", header: m.importdlg_col_file(), rowHeader: true, truncate: true, sortValue: (r) => r.row.file, cell: (r) => r.row.file },
    { id: "status", header: m.importdlg_col_match(), sortValue: (r) => r.status, cell: (r) => matchBadge(m, r.status) },
    {
      id: "frame",
      header: m.importdlg_col_frame(),
      sortValue: (r) => (r.assetId ? frameName(m, catalog, r.assetId) : r.candidates.length > 0 ? names(r.candidates) : null),
      cell: (r) => (r.assetId ? frameName(m, catalog, r.assetId) : r.candidates.length > 0 ? names(r.candidates) : "–"),
    },
  ]

  function reset(next: boolean) {
    if (!next) {
      setPath(null)
      setStep("choose")
    }
    onOpenChange(next)
  }

  return (
    <FormDialog title={m.importdlg_title()} size="lg" open={open} onOpenChange={reset} steps={flow}>
      {({ step: viewing }) =>
        viewing === "choose" ? (
          csvFiles.length === 0 ? (
            <KeyValueList items={[{ label: m.importdlg_supported(), value: IMPORT_FORMAT }]} />
          ) : (
            <>
              <SelectField
                label={m.importdlg_export_file()}
                value={path ?? "none"}
                options={[{ value: "none", label: m.importdlg_choose_export() }, ...csvFiles.map((f) => ({ value: f.path, label: f.path.slice(f.path.lastIndexOf("/") + 1) }))]}
                onChange={(value) => setPath(value === "none" ? null : value)}
              />
              {chosen ? (
                <KeyValueList
                  items={[
                    { label: m.importdlg_col_file(), value: chosen.path, mono: true },
                    { label: m.importdlg_file_size(), value: formatBytes(chosen.sizeBytes) },
                    { label: m.importdlg_file_modified(), value: formatDateTime(chosen.modifiedAt) },
                    { label: m.importdlg_supported(), value: IMPORT_FORMAT },
                  ]}
                />
              ) : null}
            </>
          )
        ) : !rows ? (
          <KeyValueList items={[{ label: m.importdlg_col_file(), value: path ?? "", mono: true }, { label: m.importdlg_supported(), value: IMPORT_FORMAT }]} />
        ) : (
          <>
            <KeyValueList
              items={[
                { label: m.importdlg_rows(), value: m.importdlg_summary({ count: rows.length, scale: m.importdlg_scale({ value: formatDecimal(EXPORT_SCALE, 2) }) }) },
                { label: m.importdlg_method(), value: `${IMPORT_METHOD.method} ${IMPORT_METHOD.version}` },
                { label: m.importdlg_matched(), value: m.importdlg_rows_matched({ count: matched.length, byPath: matched.length - byName, byName }) },
                ...(outside > 0 ? [{ label: m.importdlg_outside(), value: formatCount(outside) }] : []),
                { label: m.importdlg_unattached(), value: m.importdlg_attach_none({ count: outstanding.length }) },
              ]}
            />
            <ColumnMapping />
            <DataTable label={m.importdlg_rows()} rows={mapped} columns={rowColumns} getRowId={(r) => String(r.row.index)} scroll="none" />
          </>
        )
      }
    </FormDialog>
  )
}

/** The recorded imports of a review, each with its rows; a row left unattached can be attached to the frame the user picks. */
export function ImportedMeasurementsDialog({ records, href, open, onOpenChange }: { records: MeasurementImport[]; href: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const done: Action = { id: "imports-done", label: m.review_done(), kind: "primary", run: () => {} }
  return (
    <FormDialog title={m.importdlg_recorded_title()} size="lg" open={open} onOpenChange={onOpenChange} confirm={done}>
      {records.map((record) => {
        const columns: Column<MeasurementImportRow>[] = [
          { id: "row", header: m.importdlg_col_row(), align: "right", sortValue: (r) => r.index, cell: (r) => formatCount(r.index) },
          { id: "file", header: m.importdlg_col_file(), rowHeader: true, truncate: true, sortValue: (r) => r.file, cell: (r) => r.file },
          { id: "status", header: m.importdlg_col_match(), sortValue: (r) => r.status, cell: (r) => matchBadge(m, r.status) },
          { id: "frame", header: m.importdlg_col_frame(), sortValue: (r) => (r.assetId ? frameName(m, catalog, r.assetId) : null), cell: (r) => (r.assetId ? frameName(m, catalog, r.assetId) : "–") },
        ]
        const rowActions = (row: MeasurementImportRow): MenuItem[] =>
          row.status === "ambiguous" && row.candidates.length > 0
            ? [{ submenu: m.importdlg_attach_to(), items: row.candidates.map((id) => ({ id: `attach-${row.index}-${id}`, label: frameName(m, catalog, id), run: () => resolveImportRow(record.id, row.index, id, href) })) }]
            : []
        return (
          <section key={record.id} aria-label={record.path}>
            <KeyValueList
              items={[
                { label: m.importdlg_col_file(), value: record.path, mono: true },
                { label: m.importdlg_imported_at(), value: formatDateTime(record.importedAt) },
                { label: m.importdlg_matched(), value: m.importdlg_attached_summary({ count: record.matched }) },
                ...(record.outsideRun > 0 ? [{ label: m.importdlg_outside(), value: formatCount(record.outsideRun) }] : []),
              ]}
            />
            {record.rows.length > 0 ? (
              <DataTable label={m.importdlg_rows()} rows={record.rows} columns={columns} getRowId={(r) => String(r.index)} rowLabel={(r) => m.importdlg_row_n({ n: r.index })} rowActions={rowActions} scroll="none" />
            ) : null}
          </section>
        )
      })}
    </FormDialog>
  )
}
