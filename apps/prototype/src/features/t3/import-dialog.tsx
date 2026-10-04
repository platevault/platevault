/**
 * Import measurements (D6, PIX-FR-07, PIX-AC-04, PIX-AC-05): choose a
 * supported export, review its column and row mapping, then confirm. Matched
 * rows attach imported values next to built-in ones; unmatched and ambiguous
 * rows attach to nothing until reviewed; unsupported columns stay
 * unavailable; rejection decisions are never imported. Nothing is excluded
 * and no quality changes.
 */
import { FileSpreadsheet } from "lucide-react"
import { useId, useState } from "react"
import { PathText } from "@/components/app/data"
import { ActionError, Notice } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { AssetId, Catalog } from "@/domain/types"
import { formatBytes, formatDateTime, plural } from "@/lib/format"
import { useStore } from "@/store/core"
import { importMeasurements } from "./actions"
import { CSV_COLUMNS, mapRows, readSubframeSelectorCsv } from "./csv"
import { sessionLabel } from "./model"

export function frameName(catalog: Catalog, id: AssetId): string {
  const asset = catalog.assets[id]
  if (!asset) return "Unknown frame"
  const session = asset.sessionId ? catalog.sessions[asset.sessionId] : undefined
  return `${asset.fileName}${session ? ` (${sessionLabel(session)})` : ""}`
}

export function ImportDialog({ viewId, viewAssetIds, open, onOpenChange }: { viewId: string; viewAssetIds: Set<AssetId>; open: boolean; onOpenChange: (open: boolean) => void }) {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const [path, setPath] = useState<string | null>(null)
  const [step, setStep] = useState<"choose" | "review">("choose")
  const [error, setError] = useState<string | null>(null)
  const csvFiles = Object.values(disk.files)
    .filter((f) => f.kind === "csv" && disk.volumes[f.volumeId]?.mounted)
    .sort((a, b) => a.path.localeCompare(b.path))
  const rows = path ? readSubframeSelectorCsv(disk, path) : null
  const mapped = rows ? mapRows(catalog, rows) : []
  const matched = mapped.filter((m) => m.status === "matched" || m.status === "matched-by-name")
  const unresolved = mapped.filter((m) => m.status === "ambiguous" || m.status === "unmatched")
  const outside = matched.filter((m) => !viewAssetIds.has(m.assetId!)).length
  const byName = matched.filter((m) => m.status === "matched-by-name").length
  const blockedId = useId()
  const blocked =
    step === "choose"
      ? path
        ? null
        : csvFiles.length === 0
          ? "No export on a mounted volume to review."
          : "Choose an export file to review its mapping."
      : !rows
        ? "This file cannot be imported."
        : matched.length === 0
          ? "No row matches an indexed frame."
          : null

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
    if (!result.ok) return setError(result.message.replace("Import measurements was not saved", "Measurements not imported"))
    reset(false)
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import measurements</DialogTitle>
          <DialogDescription>
            {step === "choose"
              ? "Choose a supported export. Prototype: simulated file chooser listing CSV files on mounted volumes."
              : "Review how the export maps to frames and metrics before anything is attached."}
          </DialogDescription>
        </DialogHeader>

        {step === "choose" ? (
          csvFiles.length === 0 ? (
            <Notice tone="info" title="No CSV export on a mounted volume">
              Supported: PixInsight SubframeSelector CSV. Mount the volume that holds the export, or copy it to a mounted location.
            </Notice>
          ) : (
            <RadioGroup value={path} onValueChange={(value) => setPath(value as string)} aria-label="Export file" className="gap-0 divide-y rounded-lg border">
              {csvFiles.map((file) => (
                <div key={file.path} className="flex items-start gap-3 px-3 py-2.5">
                  <RadioGroupItem value={file.path} id={`csv-${file.path}`} className="mt-0.5" />
                  <Label htmlFor={`csv-${file.path}`} className="grid min-w-0 gap-0.5 font-normal">
                    <span className="flex items-center gap-1.5 font-medium">
                      <FileSpreadsheet aria-hidden="true" className="size-4" />
                      {file.path.slice(file.path.lastIndexOf("/") + 1)}
                    </span>
                    <PathText path={file.path} className="text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {formatBytes(file.sizeBytes)} · modified {formatDateTime(file.modifiedAt)}
                    </span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          )
        ) : rows === null ? (
          <Notice tone="refusal" title="This file is not a supported export">
            {path} has no SubframeSelector File and FWHM columns, so nothing can be mapped. Choose a PixInsight SubframeSelector CSV.
          </Notice>
        ) : (
          <div className="space-y-4 text-sm">
            <p>
              <span className="font-medium">PixInsight SubframeSelector CSV</span> · {plural(rows.length, "row")} · subframe scale 3.10″/px as recorded in the export
            </p>
            <section className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">Columns</h3>
              <table className="w-full text-sm">
                <caption className="sr-only">Column mapping</caption>
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="py-1 pr-3 text-left font-medium">
                      CSV column
                    </th>
                    <th scope="col" className="py-1 pr-3 text-left font-medium">
                      Unit
                    </th>
                    <th scope="col" className="py-1 text-left font-medium">
                      Mapping
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CSV_COLUMNS.map((c) => (
                    <tr key={c.name} className="border-b last:border-0">
                      <th scope="row" className="py-1.5 pr-3 text-left font-mono text-xs font-normal">
                        {c.name}
                      </th>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{c.unit ?? <span className="text-muted-foreground">No unit</span>}</td>
                      <td className="py-1.5">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {c.status === "mapped" ? <StatusBadge kind="match" value="compatible" label="Imported" /> : null}
                          {c.status === "unavailable" ? <StatusBadge kind="match" value="unknown" label="Unavailable" /> : null}
                          {c.status === "not-imported" ? <StatusBadge kind="item" value="skipped" label="Not imported" /> : null}
                          <span className="text-xs text-muted-foreground">{c.note}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">Rows</h3>
              <p className="tabular-nums">
                {plural(matched.length, "row")} matched to indexed frames ({matched.length - byName} by path, {byName} by unique file name)
                {outside > 0 ? ` (${outside} outside this View; their values still attach to the frame)` : ""} · {unresolved.length} attach to no frame until reviewed
              </p>
              <ul className="space-y-2">
                {unresolved.map((m) => (
                  <li key={m.row.index} className="rounded-md border px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge kind="match" value={m.status === "ambiguous" ? "unknown" : "incompatible"} label={m.status === "ambiguous" ? "Ambiguous" : "Unmatched"} />
                      <span className="text-xs text-muted-foreground">Row {m.row.index}</span>
                    </div>
                    <PathText path={m.row.file} className="mt-1" />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {m.status === "ambiguous"
                        ? `Its file name matches ${m.candidates.length} indexed frames: ${m.candidates.map((id) => frameName(catalog, id)).join(" and ")}. It attaches to none until you choose one in Review frames.`
                        : "No indexed frame has this path or file name. It attaches to nothing."}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
            <Notice tone="info" title="What the import does not do">
              It replaces no built-in value, excludes or restores no frame, and changes no quality decision. The Approved column is never imported.
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
            {step === "review" ? "Back" : "Cancel"}
          </Button>
          {step === "choose" ? (
            <Button disabled={blocked !== null} aria-describedby={blocked ? blockedId : undefined} onClick={() => setStep("review")}>
              Review mapping
            </Button>
          ) : (
            <Button disabled={blocked !== null} aria-describedby={blocked ? blockedId : undefined} onClick={confirm}>
              Import {plural(matched.length, "matched row")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
