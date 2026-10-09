/**
 * Import measurements (D6, PIX-FR-06, PIX-FR-07, PIX-AC-04, PIX-AC-05,
 * PIX-AC-11): choose a supported export, review its column and row mapping,
 * then confirm. Matched rows attach imported values next to built-in ones,
 * stamped with the frame's bytes read at review and labelled content
 * unverified (D19). A matched frame whose bytes differ from what PlateVault
 * recorded, or cannot be read, is listed for review and attaches nothing;
 * unmatched and ambiguous rows attach to nothing until reviewed; unsupported
 * columns stay unavailable; rejection decisions are never imported. Nothing is
 * excluded and no quality changes.
 */
import { FileSpreadsheet } from "lucide-react"
import { useId, useState } from "react"
import { useMessages, usePreferences } from "@/app/preferences"
import { PathText } from "@/components/app/data"
import { ActionError, Notice } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { AssetId, Catalog, MeasurementImport } from "@/domain/types"
import { formatBytes, formatDateTime } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { useStore } from "@/store/core"
import { importMeasurements, resolveImportRow } from "./actions"
import { SelectField } from "./fields"
import { attaches, CSV_COLUMNS, EXPORT_SCALE, IMPORT_FORMAT, IMPORT_METHOD, mapRows, readSubframeSelectorCsv } from "./csv"
import { sessionLabel } from "@/domain/membership"

export function frameName(m: Messages, catalog: Catalog, id: AssetId): string {
  const asset = catalog.assets[id]
  if (!asset) return m.importdlg_unknown_frame()
  const session = asset.sessionId ? catalog.sessions[asset.sessionId] : undefined
  return `${asset.fileName}${session ? ` (${sessionLabel(m, session)})` : ""}`
}

export function ImportDialog({ viewId, viewAssetIds, open, onOpenChange }: { viewId: string; viewAssetIds: Set<AssetId>; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const { locale } = usePreferences()
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const [path, setPath] = useState<string | null>(null)
  const [step, setStep] = useState<"choose" | "review">("choose")
  const [error, setError] = useState<string | null>(null)
  const csvFiles = Object.values(disk.files)
    .filter((f) => f.kind === "csv" && disk.volumes[f.volumeId]?.mounted)
    .sort((a, b) => a.path.localeCompare(b.path))
  const rows = path ? readSubframeSelectorCsv(disk, path) : null
  const mapped = rows ? mapRows(disk, catalog, rows) : []
  const matched = mapped.filter(attaches)
  const changed = mapped.filter((r) => r.status === "content-changed" || r.status === "unreadable")
  const unresolved = mapped.filter((r) => r.status === "ambiguous" || r.status === "unmatched")
  const outside = matched.filter((r) => !viewAssetIds.has(r.assetId!)).length
  const byName = matched.filter((r) => r.status === "matched-by-name").length
  const blockedId = useId()
  const blocked =
    step === "choose"
      ? path
        ? null
        : csvFiles.length === 0
          ? m.importdlg_blocked_no_export()
          : m.importdlg_blocked_choose()
      : !rows
        ? m.importdlg_blocked_unsupported()
        : matched.length === 0
          ? m.importdlg_blocked_no_match()
          : null
  const names = (ids: AssetId[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(ids.map((id) => frameName(m, catalog, id)))

  function reset(next: boolean) {
    if (next) {
      setPath(null)
      setStep("choose")
      setError(null)
    }
    onOpenChange(next)
  }

  function confirm() {
    if (!path) return
    const result = importMeasurements(viewId, path, mapped, viewAssetIds)
    if (!result.ok) return setError(result.message)
    reset(false)
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{m.importdlg_title()}</DialogTitle>
          <DialogDescription>{step === "choose" ? m.importdlg_description_choose() : m.importdlg_description_review()}</DialogDescription>
        </DialogHeader>

        {step === "choose" ? (
          csvFiles.length === 0 ? (
            <Notice tone="info" title={m.importdlg_no_csv_title()}>
              {m.importdlg_no_csv_body({ format: IMPORT_FORMAT })}
            </Notice>
          ) : (
            <RadioGroup value={path} onValueChange={(value) => setPath(value as string)} aria-label={m.importdlg_export_file()} className="gap-0 divide-y rounded-lg border">
              {csvFiles.map((file) => (
                <div key={file.path} className="flex items-start gap-3 px-3 py-2.5">
                  <RadioGroupItem value={file.path} id={`csv-${file.path}`} className="mt-0.5" />
                  <Label htmlFor={`csv-${file.path}`} className="grid min-w-0 gap-0.5 font-normal">
                    <span className="flex items-center gap-1.5 font-medium">
                      <FileSpreadsheet aria-hidden="true" className="size-4" />
                      {file.path.slice(file.path.lastIndexOf("/") + 1)}
                    </span>
                    <PathText path={file.path} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{m.importdlg_file_meta({ size: formatBytes(file.sizeBytes), date: formatDateTime(file.modifiedAt) })}</span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )
        ) : rows === null ? (
          <Notice tone="refusal" title={m.importdlg_unsupported_title()}>
            {m.importdlg_unsupported_body({ path: path ?? "", format: IMPORT_FORMAT })}
          </Notice>
        ) : (
          <div className="space-y-4 text-sm">
            <p>
              <span className="font-medium">{IMPORT_FORMAT}</span> · {m.importdlg_summary({ count: rows.length, scale: `${EXPORT_SCALE.toFixed(2)}″/px` })}
            </p>
            <p className="text-xs text-muted-foreground">{m.importdlg_source_note({ method: IMPORT_METHOD.method, version: IMPORT_METHOD.version })}</p>
            <section className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">{m.review_columns()}</h3>
              <table className="w-full text-sm">
                <caption className="sr-only">{m.importdlg_column_mapping()}</caption>
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="py-1 pr-3 text-left font-medium">
                      {m.importdlg_col_csv()}
                    </th>
                    <th scope="col" className="py-1 pr-3 text-left font-medium">
                      {m.importdlg_col_unit()}
                    </th>
                    <th scope="col" className="py-1 text-left font-medium">
                      {m.importdlg_col_mapping()}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CSV_COLUMNS.map((c) => (
                    <tr key={c.name} className="border-b last:border-0">
                      <th scope="row" className="py-1.5 pr-3 text-left font-mono text-xs font-normal">
                        {c.name}
                      </th>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{c.unit ?? <span className="text-muted-foreground">{m.importdlg_no_unit()}</span>}</td>
                      <td className="py-1.5">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {c.status === "mapped" ? <StatusBadge kind="match" value="compatible" label={m.frame_col_imported()} /> : null}
                          {c.status === "unavailable" ? <StatusBadge kind="match" value="unknown" label={m.coverage_unavailable()} /> : null}
                          {c.status === "not-imported" ? <StatusBadge kind="item" value="skipped" label={m.importdlg_not_imported()} /> : null}
                          <span className="text-xs text-muted-foreground">{c.note}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">{m.importdlg_rows()}</h3>
              <p className="tabular-nums">
                {m.importdlg_rows_matched({ count: matched.length, byPath: matched.length - byName, byName })}
                {outside > 0 ? ` ${m.importdlg_outside_view({ count: outside })}` : ""} · {m.importdlg_attach_none({ count: changed.length + unresolved.length })}
              </p>
              {changed.length > 0 ? (
                <div className="space-y-1.5">
                  <h4 className="text-xs font-medium">{m.importdlg_changed_heading()}</h4>
                  <ul className="space-y-2">
                    {changed.map((r) => (
                      <li key={r.row.index} className="rounded-md border px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge kind="association" value="needs-review" label={r.status === "unreadable" ? m.importdlg_badge_unreadable() : m.importdlg_badge_changed()} />
                          <span className="text-xs text-muted-foreground">{m.importdlg_row_n({ n: r.row.index })}</span>
                        </div>
                        <PathText path={r.row.file} className="mt-1" />
                        <p className="mt-1 text-xs text-muted-foreground">
                          {r.status === "unreadable"
                            ? m.importdlg_unreadable_body({ frame: frameName(m, catalog, r.assetId!) })
                            : (r.basis!.recordedBy === "measurement" ? m.importdlg_changed_body_measured : m.importdlg_changed_body_indexed)({
                                frame: frameName(m, catalog, r.assetId!),
                                current: r.observedSha256!.slice(0, 12),
                                recorded: r.basis!.sha256.slice(0, 12),
                              })}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <ul className="space-y-2">
                {unresolved.map((r) => (
                  <li key={r.row.index} className="rounded-md border px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge kind="match" value={r.status === "ambiguous" ? "unknown" : "incompatible"} label={r.status === "ambiguous" ? m.importdlg_ambiguous() : m.importdlg_unmatched()} />
                      <span className="text-xs text-muted-foreground">{m.importdlg_row_n({ n: r.row.index })}</span>
                    </div>
                    <PathText path={r.row.file} className="mt-1" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.status === "ambiguous" ? m.importdlg_ambiguous_body({ count: r.candidates.length, frames: names(r.candidates) }) : m.importdlg_unmatched_body()}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
            <Notice tone="info" title={m.importdlg_does_not_title()}>
              {m.importdlg_does_not_body()}
            </Notice>
            {error ? <ActionError message={error} onRetry={confirm} /> : null}
          </div>
        )}

        <DialogFooter>
          {blocked ? (
            <p id={blockedId} className="text-xs text-muted-foreground sm:mr-auto sm:self-center">
              {blocked}
            </p>
          ) : null}
          <Button variant="outline" onClick={() => (step === "review" ? setStep("choose") : reset(false))}>
            {step === "review" ? m.history_back() : m.verb_cancel()}
          </Button>
          {step === "choose" ? (
            <Button disabled={blocked !== null} aria-describedby={blocked ? blockedId : undefined} onClick={() => setStep("review")}>
              {m.importdlg_review_mapping()}
            </Button>
          ) : (
            <Button disabled={blocked !== null} aria-describedby={blocked ? blockedId : undefined} onClick={confirm}>
              {m.importdlg_import_rows({ count: matched.length })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function rowLabel(m: Messages, status: MeasurementImport["rows"][number]["status"]): string {
  switch (status) {
    case "resolved":
      return m.importdlg_row_attached_by_you()
    case "ambiguous":
      return m.importdlg_row_ambiguous()
    case "content-changed":
      return m.importdlg_row_changed()
    case "unreadable":
      return m.importdlg_row_unreadable()
    default:
      return m.importdlg_row_unmatched()
  }
}

/** One recorded import with its row review: matched rows attached, the rest attach to nothing until the user resolves them. */
export function ImportReview({ record, catalog }: { record: MeasurementImport; catalog: Catalog }) {
  const m = useMessages()
  const [choice, setChoice] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const open = record.rows.filter((r) => r.status !== "resolved")
  return (
    <li className="space-y-2 px-4 py-3">
      <p className="text-sm">
        <span className="font-medium">{record.path.slice(record.path.lastIndexOf("/") + 1)}</span>
        <span className="text-muted-foreground">
          {" "}
          · {m.importdlg_attached_summary({ count: record.matched })}
          {record.outsideRun > 0 ? ` ${m.importdlg_outside_run({ count: record.outsideRun })}` : ""}
          {CSV_COLUMNS.filter((c) => c.status === "unavailable" || c.status === "not-imported")
            .map((c) => ` · ${c.status === "unavailable" ? m.importdlg_column_unavailable({ name: c.name }) : m.importdlg_column_not_imported({ name: c.name })}`)
            .join("")}
        </span>
      </p>
      {open.length === 0 ? <p className="text-xs text-muted-foreground">{m.importdlg_every_row_reviewed()}</p> : null}
      <ul className="space-y-2">
        {record.rows.map((row) => (
          <li key={row.index} className="rounded-md border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge kind="match" value={row.status === "resolved" ? "compatible" : row.status === "unmatched" ? "incompatible" : "unknown"} label={rowLabel(m, row.status)} />
              <span className="font-mono text-xs [overflow-wrap:anywhere]">{row.file}</span>
              <span className="text-xs text-muted-foreground">{m.importdlg_row_n({ n: row.index })}</span>
            </div>
            {row.status === "resolved" && row.assetId ? <p className="mt-1 text-xs text-muted-foreground">{m.importdlg_attached_to({ frame: frameName(m, catalog, row.assetId) })}</p> : null}
            {row.status === "unmatched" ? <p className="mt-1 text-xs text-muted-foreground">{m.importdlg_unmatched_stay()}</p> : null}
            {row.status === "content-changed" ? <p className="mt-1 text-xs text-muted-foreground">{m.importdlg_changed_stay({ frame: frameName(m, catalog, row.candidates[0]!) })}</p> : null}
            {row.status === "unreadable" ? <p className="mt-1 text-xs text-muted-foreground">{m.importdlg_unreadable_stay({ frame: frameName(m, catalog, row.candidates[0]!) })}</p> : null}
            {row.status === "ambiguous" ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <SelectField
                  className="min-w-72"
                  label={m.importdlg_attach_to()}
                  value={choice[row.index] ?? "none"}
                  onChange={(value) => setChoice((c) => ({ ...c, [row.index]: value }))}
                  options={[{ value: "none", label: m.importdlg_choose_frame() }, ...row.candidates.map((id) => ({ value: id, label: frameName(m, catalog, id) }))]}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const assetId = choice[row.index]
                    if (!assetId || assetId === "none") return setError(m.importdlg_choose_first())
                    const result = resolveImportRow(record.id, row.index, assetId)
                    setError(result.ok ? null : result.message)
                  }}
                >
                  {m.importdlg_attach_row()}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </li>
  )
}
