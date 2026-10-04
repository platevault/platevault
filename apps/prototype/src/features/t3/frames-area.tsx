/**
 * Review frames (`/views/$viewId/frames`, product flow D1-D6): built-in
 * measurement with cached values first, the row/plot/preview linkage, pixel
 * inspection, Exclude from View, the three scoped library and Project
 * decisions, and imported measurements with their provenance. Measurements
 * never exclude, reject or mark frames Usable (PIX-FR-08).
 */
import { Link } from "@tanstack/react-router"
import { ImageOff, Upload } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { getPreferences } from "@/app/preferences"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { type Column, DataTable, SelectionBar, TableToolbar } from "@/components/app/data-table"
import { EmptyState, Notice, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { assetAvailability, measurementApplies, qualityApplicability, targetCoverage } from "@/domain/derive"
import type { Asset, AssetId, Catalog, Disk, Metric, MetricKey, Operation, Session } from "@/domain/types"
import { formatDuration, formatNight, plural } from "@/lib/format"
import { useStore } from "@/store/core"
import { cancelOperation, isSettled, resumeOperation } from "@/store/operations"
import { defaultFrameUi, type MeasurementImport } from "@/store/slices/t3"
import { rejectForProject, resolveImportRow, setFrameUi, setLibraryQuality } from "./actions"
import { SelectField } from "./fields"
import { FramePreview } from "./frame-preview"
import { frameName, ImportDialog } from "./import-dialog"
import { builtInMetrics, currentImportedMetrics, type FrameMeasureState, frameMeasureState, formatMetric, latestMeasureOp, type MeasurePayload, METRIC_LABEL, startMeasurement, unfinishedCount } from "./measure"
import { MeasurementPlot } from "./measurement-plot"
import { currentFile, excludeFrames, type MemberState, memberState, pixelScaleFor, restoreFrames, sessionLabel } from "./model"
import { registerFrameCommands } from "./shell"
import { useDraftEditor, useWorkspace } from "./workspace"

interface FrameRow {
  asset: Asset
  session: Session | undefined
  index: number
  member: MemberState
  state: FrameMeasureState
  applies: boolean
  builtIn: Partial<Record<MetricKey, Metric>>
  imported: Partial<Record<MetricKey, Metric>>
  rejected: boolean
}

const STATE_BADGE: Record<FrameMeasureState, { value: "valid" | "pending" | "verifying" | "unavailable"; label: string }> = {
  measured: { value: "valid", label: "Measured" },
  pending: { value: "pending", label: "Pending" },
  verifying: { value: "verifying", label: "Verifying" },
  "history-only": { value: "unavailable", label: "Not measured" },
  "not-measured": { value: "unavailable", label: "Not measured" },
}

function byKey(metrics: Metric[]): Partial<Record<MetricKey, Metric>> {
  return Object.fromEntries(metrics.map((m) => [m.key, m]))
}

function buildRows(catalog: Catalog, ids: AssetId[], content: { included: AssetId[]; excluded: AssetId[]; unresolved: AssetId[] }, op: Operation | undefined, projectRejections: Record<string, unknown>): FrameRow[] {
  const assets = ids.map((id) => catalog.assets[id]).filter((a): a is Asset => a !== undefined)
  assets.sort((a, b) => {
    const sa = a.sessionId ? (catalog.sessions[a.sessionId]?.startedAt ?? "") : ""
    const sb = b.sessionId ? (catalog.sessions[b.sessionId]?.startedAt ?? "") : ""
    return sa.localeCompare(sb) || a.observed.dateObs.localeCompare(b.observed.dateObs)
  })
  return assets.map((asset, index) => {
    const record = catalog.measurements[asset.id]
    const state = frameMeasureState(catalog, asset.id, op)
    const applies = record ? measurementApplies(asset, record) : false
    return {
      asset,
      session: asset.sessionId ? catalog.sessions[asset.sessionId] : undefined,
      index,
      member: memberState(content as never, asset.id) ?? "included",
      state,
      applies,
      builtIn: applies ? byKey(builtInMetrics(record)) : {},
      imported: byKey(currentImportedMetrics(record, applies)),
      rejected: asset.id in projectRejections,
    }
  })
}

/** Library-usable integration per channel for a Target, as if `assetIds` had `value`. */
function usableAfter(disk: Disk, catalog: Catalog, targetId: string | null, assetIds: AssetId[], value: "usable" | "unusable") {
  if (!targetId) return null
  const assets = { ...catalog.assets }
  for (const id of assetIds) {
    const asset = assets[id]
    if (asset) assets[id] = { ...asset, quality: { value, decidedAt: null, basisSha256: asset.sha256, verificationPending: false } }
  }
  const before = targetCoverage(disk, catalog, targetId).channels
  const after = targetCoverage(disk, { ...catalog, assets }, targetId).channels
  return after.map((c) => {
    const prior = before.find((b) => b.channel === c.channel)?.breakdown
    return { channel: c.channel, usable: c.breakdown.usable.seconds, unreviewed: c.breakdown.unreviewed.seconds, usableBefore: prior?.usable.seconds ?? 0, unreviewedBefore: prior?.unreviewed.seconds ?? 0 }
  })
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.getAttribute("role") === "combobox")
}

function MeasureBar({ op, notMeasured, onMeasure, disabledReason }: { op: Operation | undefined; notMeasured: number; onMeasure: () => void; disabledReason: string | null }) {
  const unsettled = op && !isSettled(op.status)
  if (unsettled) {
    const pct = op.progress.total > 0 ? (op.progress.done / op.progress.total) * 100 : 0
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-3 py-2">
        <Progress value={pct} aria-label="Measurement progress" getAriaValueText={() => `${op.progress.done} of ${op.progress.total} frames`} className="min-w-48 flex-1 gap-1">
          <span className="text-sm tabular-nums" aria-hidden="true">
            {op.status === "running" ? ((op.payload as unknown as MeasurePayload).verify.length > 0 ? "Verifying cached values" : "Measuring frames") : op.status === "interrupted" ? "Measurement interrupted by a restart" : "Measurement paused"}: {op.progress.done} of {op.progress.total} frames · current frame first
          </span>
        </Progress>
        <div className="flex gap-2">
          {op.status === "interrupted" || op.status === "paused" ? (
            <Button size="sm" variant="outline" onClick={() => resumeOperation(op.id)}>
              Retry
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => cancelOperation(op.id)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }
  const unfinished = unfinishedCount(op)
  if (!op && notMeasured === 0) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
      <p className="text-pretty">
        {op ? (
          <>
            <StatusBadge kind="operation" value={op.status} className="mr-2" />
            {op.status === "canceled" ? `Measurement canceled: ${op.progress.done} of ${op.progress.total} frames reached; ${unfinished} not measured. ` : `${op.summary ?? ""} `}
          </>
        ) : null}
        {notMeasured > 0 ? `${plural(notMeasured, "frame")} read Not measured.` : "Every readable frame has a valid value."}
      </p>
      {notMeasured > 0 ? (
        <Button size="sm" variant="outline" onClick={onMeasure} disabled={disabledReason !== null} title={disabledReason ?? undefined}>
          Measure remaining frames
        </Button>
      ) : null}
    </div>
  )
}

function ImportReview({ record, catalog }: { record: MeasurementImport; catalog: Catalog }) {
  const [choice, setChoice] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const open = record.rows.filter((r) => r.status !== "resolved")
  return (
    <li className="space-y-2 px-4 py-3">
      <p className="text-sm">
        <span className="font-medium">{record.path.slice(record.path.lastIndexOf("/") + 1)}</span>
        <span className="text-muted-foreground">
          {" "}
          · {plural(record.matched, "row")} attached as imported values{record.outsideView > 0 ? ` (${record.outsideView} to frames outside this View)` : ""} · PSFSignalWeight unavailable · Approved not
          imported
        </span>
      </p>
      {open.length === 0 ? <p className="text-xs text-muted-foreground">Every row is reviewed.</p> : null}
      <ul className="space-y-2">
        {record.rows.map((row) => (
          <li key={row.index} className="rounded-md border px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge
                kind="match"
                value={row.status === "resolved" ? "compatible" : row.status === "ambiguous" ? "unknown" : "incompatible"}
                label={row.status === "resolved" ? "Attached by you" : row.status === "ambiguous" ? "Ambiguous: attached to no frame" : "Unmatched: attached to no frame"}
              />
              <span className="font-mono text-xs [overflow-wrap:anywhere]">{row.file}</span>
              <span className="text-xs text-muted-foreground">row {row.index}</span>
            </div>
            {row.status === "resolved" && row.assetId ? <p className="mt-1 text-xs text-muted-foreground">Attached to {frameName(catalog, row.assetId)}.</p> : null}
            {row.status === "unmatched" ? <p className="mt-1 text-xs text-muted-foreground">No indexed frame has this path or file name. Its values stay unattached.</p> : null}
            {row.status === "ambiguous" ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <SelectField
                  className="min-w-72"
                  label="Attach to"
                  value={choice[row.index] ?? "none"}
                  onChange={(value) => setChoice((c) => ({ ...c, [row.index]: value }))}
                  options={[{ value: "none", label: "Choose the frame this row measured" }, ...row.candidates.map((id) => ({ value: id, label: frameName(catalog, id) }))]}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const assetId = choice[row.index]
                    if (!assetId || assetId === "none") return setError("Choose the frame this row measured before attaching it.")
                    const result = resolveImportRow(record.id, row.index, assetId)
                    setError(result.ok ? null : result.message)
                  }}
                >
                  Attach row
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

export function FramesArea() {
  const { view, content, readOnlyReason } = useWorkspace()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const ui = useStore((s) => s.slices.t3.frames[view.id]) ?? defaultFrameUi()
  const op = useStore((s) => latestMeasureOp(s, view.id))
  const imports = useStore((s) => Object.values(s.slices.t3.imports).filter((i) => i.viewId === view.id))
  const { edit, errorNode } = useDraftEditor(view.id)
  const [importOpen, setImportOpen] = useState(false)
  const [confirm, setConfirm] = useState<"usable" | "unusable" | "reject" | null>(null)
  const [announcement, setAnnouncement] = useState("")
  // Bulk-action selection is component state, never persisted: a selection that survives a restart turns a bulk action into a surprise.
  const [checkedIds, setCheckedIds] = useState<AssetId[]>([])
  const project = view.projectId ? catalog.projects[view.projectId] : undefined
  const editable = readOnlyReason === null

  const memberIds = [...content.included, ...content.excluded, ...content.unresolved]
  const rows = buildRows(catalog, memberIds, content, op, project?.rejections ?? {})
  const measurable = rows.filter((r) => r.member !== "unresolved" && assetAvailability(disk, catalog, r.asset) === "available").map((r) => r.asset.id)
  const notMeasured = rows.filter((r) => r.member !== "unresolved" && (r.state === "not-measured" || r.state === "history-only") && measurable.includes(r.asset.id)).length

  // Opening Review frames starts built-in measurement once (D1); browsing or filtering never does (PIX-AC-06).
  const started = useRef(false)
  useEffect(() => {
    if (started.current || view.completedAt) return
    started.current = true
    startMeasurement(view.id, measurable)
    // Only on opening the area.
  }, [view.id])

  const query = ui.search.toLowerCase()
  const shown = rows.filter((r) => (ui.showExcluded || r.member !== "excluded") && (!ui.sessionId || r.asset.sessionId === ui.sessionId) && (!query || r.asset.fileName.toLowerCase().includes(query)))
  const active = shown.find((r) => r.asset.id === ui.activeAssetId) ?? rows.find((r) => r.asset.id === ui.activeAssetId) ?? shown[0] ?? null
  const position = active ? shown.indexOf(active) : -1
  const checked = checkedIds.filter((id) => memberIds.includes(id))
  const checkedIncluded = checked.filter((id) => content.included.includes(id))
  const checkedExcluded = checked.filter((id) => content.excluded.includes(id))
  const hiddenChecked = checked.filter((id) => !shown.some((r) => r.asset.id === id)).length
  const excludedCount = content.excluded.length
  const anyImported = rows.some((r) => r.imported.fwhm)
  const sessions = [...new Set(rows.map((r) => r.asset.sessionId).filter((id): id is string => id !== null))].map((id) => catalog.sessions[id]).filter((s): s is Session => s !== undefined)

  function select(id: AssetId) {
    setFrameUi(view.id, { activeAssetId: id })
    document.getElementById(`frame-${id}`)?.scrollIntoView({ block: "nearest" })
  }

  function step(delta: number) {
    const next = shown[Math.min(shown.length - 1, Math.max(0, position + delta))]
    if (!next) return
    select(next.asset.id)
    setAnnouncement(`${next.asset.fileName}, ${next.session ? sessionLabel(next.session) : "no session"}: frame ${shown.indexOf(next) + 1} of ${shown.length}.`)
  }

  function toggleExclusion(row: FrameRow) {
    const excluding = row.member !== "excluded"
    const index = shown.indexOf(row)
    const successor = shown[index + 1] ?? shown[index - 1]
    const hadFocus = document.getElementById(`frame-${row.asset.id}`)?.closest("tr")?.contains(document.activeElement) ?? false
    const result = edit(excluding ? `Exclude ${row.asset.fileName} from View` : `Restore ${row.asset.fileName} to View`, (current, state) =>
      excluding ? excludeFrames(current, [row.asset.id]) : restoreFrames(state.disk, state.catalog, current, [row.asset.id]),
    )
    if (!result.ok) return
    const where = row.session ? ` (${sessionLabel(row.session)})` : ""
    setAnnouncement(`${excluding ? "Excluded" : "Restored"} ${row.asset.fileName}${where} ${excluding ? "from" : "to"} this View. Library quality unchanged.`)
    // The row leaves the table when excluded frames are hidden: keep focus in the table (WCAG 2.4.3).
    if (excluding && !ui.showExcluded && hadFocus && successor) requestAnimationFrame(() => document.getElementById(`frame-${successor.asset.id}`)?.focus())
  }

  const excludeLabel = active?.member === "excluded" ? "Restore to View" : "Exclude from View"
  const latest = { step, toggle: () => active && editable && toggleExclusion(active) }
  const handlers = useRef(latest)
  handlers.current = latest

  // Announce measurement start and finish once through the polite region (WCAG 4.1.3); progress itself stays silent.
  const opStatus = op?.status
  const announcedRun = useRef<string | null>(null)
  useEffect(() => {
    if (!op) return
    if (!isSettled(op.status) && announcedRun.current !== op.id) {
      announcedRun.current = op.id
      setAnnouncement(`Measurement started: ${plural(op.progress.total, "frame")}.`)
    } else if (isSettled(op.status) && announcedRun.current === op.id) {
      announcedRun.current = null
      setAnnouncement(`Measurement ${op.status === "canceled" ? "canceled" : "finished"}. ${op.summary ?? ""}`)
    }
  }, [op?.id, opStatus])

  // J/K/X: Review frames only, never while typing, off with single-key shortcuts (HLD §11, WCAG 2.1.4).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target) || !getPreferences().singleKeyShortcuts) return
      if (document.querySelector("[role=dialog], [role=alertdialog]")) return
      const key = event.key.toLowerCase()
      if (key === "j") handlers.current.step(1)
      else if (key === "k") handlers.current.step(-1)
      else if (key === "x") handlers.current.toggle()
      else return
      event.preventDefault()
    }
    window.addEventListener("keydown", onKeyDown)
    registerFrameCommands({ next: () => handlers.current.step(1), previous: () => handlers.current.step(-1), exclude: () => handlers.current.toggle(), excludeLabel: "Exclude or restore the current frame" })
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      registerFrameCommands(null)
    }
  }, [])

  const metricOptions = (["fwhm", "hfr", "eccentricity", "star-count", "background"] as MetricKey[]).map((key) => ({ value: key, label: METRIC_LABEL[key] }))
  const plotPoints = shown.map((r) => {
    const metric = r.builtIn[ui.metric]
    return { id: r.asset.id, label: r.asset.fileName, value: metric?.value ?? null, unit: metric?.unit ?? "", excluded: r.member === "excluded" }
  })

  const metricCell = (key: MetricKey) => (r: FrameRow) => {
    const m = r.builtIn[key]
    return m ? (
      formatMetric(m)
    ) : (
      <span className="text-muted-foreground">
        –<span className="sr-only">{STATE_BADGE[r.state].label}</span>
      </span>
    )
  }

  const columns: Column<FrameRow>[] = [
    {
      id: "frame",
      header: "Frame",
      rowHeader: true,
      sortValue: (r) => r.index,
      cell: (r) => {
        // Middle truncation: the frame number at the end stays visible, so rows stay distinguishable.
        const name = r.asset.fileName.replace(/\.(fits|xisf)$/i, "")
        const cut = name.lastIndexOf("_") + 1
        return (
          <button type="button" id={`frame-${r.asset.id}`} className="flex max-w-48 min-w-0 rounded-sm text-left font-medium hover:underline" title={r.asset.fileName} onClick={() => select(r.asset.id)}>
            <span className="truncate">{name.slice(0, cut)}</span>
            <span data-frame-tail className="shrink-0">
              {name.slice(cut)}
            </span>
          </button>
        )
      },
    },
    { id: "session", header: "Session", sortValue: (r) => r.session?.startedAt ?? null, cell: (r) => (r.session ? sessionLabel(r.session) : <UnknownValue label="No session" />) },
    {
      id: "member",
      header: "In View",
      sortValue: (r) => r.member,
      cell: (r) =>
        r.member === "included" ? (
          <span>Included</span>
        ) : r.member === "excluded" ? (
          <StatusBadge kind="quality" value="excluded" />
        ) : (
          <StatusBadge kind="availability" value={assetAvailability(disk, catalog, r.asset) === "available" ? "available" : assetAvailability(disk, catalog, r.asset)} label="Unresolved" />
        ),
    },
    {
      id: "quality",
      header: "Library quality",
      sortValue: (r) => r.asset.quality.value,
      cell: (r) => {
        const applicability = qualityApplicability(r.asset)
        return (
          <span className="inline-flex gap-1">
            <StatusBadge kind="quality" value={applicability === "applicable" ? r.asset.quality.value : applicability} />
            {r.rejected ? <StatusBadge kind="quality" value="project-rejected" /> : null}
          </span>
        )
      },
    },
    { id: "state", header: "Measurement", sortValue: (r) => r.state, cell: (r) => <StatusBadge kind="measurement" value={STATE_BADGE[r.state].value} label={STATE_BADGE[r.state].label} /> },
    { id: "fwhm", header: "FWHM", align: "right", sortValue: (r) => r.builtIn.fwhm?.value ?? null, cell: metricCell("fwhm") },
    ...(anyImported
      ? [{ id: "fwhm-imported", header: "FWHM imported", align: "right" as const, sortValue: (r: FrameRow) => r.imported.fwhm?.value ?? null, cell: (r: FrameRow) => (r.imported.fwhm ? formatMetric(r.imported.fwhm) : <span className="text-muted-foreground">None</span>) }]
      : []),
    { id: "hfr", header: "HFR", align: "right", sortValue: (r) => r.builtIn.hfr?.value ?? null, cell: metricCell("hfr") },
    { id: "ecc", header: "Ecc.", align: "right", sortValue: (r) => r.builtIn.eccentricity?.value ?? null, cell: metricCell("eccentricity") },
    { id: "stars", header: "Stars", align: "right", sortValue: (r) => r.builtIn["star-count"]?.value ?? null, cell: metricCell("star-count") },
    {
      id: "warnings",
      header: "Warnings",
      cell: (r) => {
        const warning = r.builtIn.fwhm?.warning ?? ""
        const parts = [warning.includes("saturated") ? "Saturated stars" : null, warning.includes("invalid") ? "Invalid samples" : null].filter(Boolean)
        return parts.length > 0 ? <span className="text-warning" title={warning}>{parts.join(", ")}</span> : <span className="text-muted-foreground">None</span>
      },
    },
  ]

  if (memberIds.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader level={2} title="Review frames" />
        <PageBody>
          <EmptyState
            icon={ImageOff}
            titleAs="h3"
            title="No frames to review yet"
            description="Frames appear here once the View includes sessions."
            action={
              <Button size="sm" render={<Link to="/views/$viewId/sessions" params={{ viewId: view.id }} />}>
                Choose sessions
              </Button>
            }
          />
        </PageBody>
      </div>
    )
  }

  const activeFile = active ? currentFile(disk, catalog, active.asset) : undefined
  const activeAvailability = active ? assetAvailability(disk, catalog, active.asset) : "available"
  const targetId = view.targetId ?? project?.targetIds[0] ?? null
  const targetName = targetId ? (catalog.targets[targetId]?.name ?? "the Target") : null
  const usableAfterMark = confirm === "usable" ? usableAfter(disk, catalog, targetId, checkedIncluded, "usable") : null
  const unusableAfterMark = confirm === "unusable" ? usableAfter(disk, catalog, targetId, checked, "unusable") : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        level={2}
        title="Review frames"
        description="Measurements never exclude, reject or mark frames Usable. Excluding a frame changes this View only."
        actions={
          <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
            <Upload aria-hidden="true" data-icon="inline-start" />
            Import measurements
          </Button>
        }
      />
      <PageBody className="space-y-4">
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        {readOnlyReason ? <p className="text-sm text-muted-foreground">{readOnlyReason}</p> : null}
        <MeasureBar op={op} notMeasured={notMeasured} disabledReason={view.completedAt ? "Complete Views are not measured; Reopen first." : null} onMeasure={() => startMeasurement(view.id, measurable)} />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <SelectField className="w-44" label="Plot metric" value={ui.metric} options={metricOptions} onChange={(value) => setFrameUi(view.id, { metric: value as MetricKey })} />
          <p className="text-xs text-muted-foreground">Click a point to make it the current frame; the table and preview follow.</p>
        </div>
        <MeasurementPlot points={plotPoints} metric={ui.metric} activeId={active?.asset.id ?? null} onSelect={select} />

        {imports.length > 0 ? (
          <Section title="Imported measurements" level={3} description="Imported values sit next to built-in values with their source, method and units. Rows that match no single frame attach to nothing.">
            <ul className="divide-y rounded-lg border">
              {imports.map((record) => (
                <ImportReview key={record.id} record={record} catalog={catalog} />
              ))}
            </ul>
          </Section>
        ) : null}

        <SelectionBar
          count={checked.length}
          hiddenByFilters={hiddenChecked}
          noun="frame"
          onShowSelected={() => setFrameUi(view.id, { showExcluded: true, sessionId: null, search: "" })}
          onClear={() => setCheckedIds([])}
          actions={
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={!editable || checkedIncluded.length === 0}
                onClick={() => {
                  const result = edit(`Exclude ${plural(checkedIncluded.length, "frame")} from View`, (current) => excludeFrames(current, checkedIncluded))
                  if (result.ok) setAnnouncement(`Excluded ${plural(checkedIncluded.length, "frame")} from this View. Files and library quality unchanged.`)
                }}
              >
                Exclude from View{checkedIncluded.length > 0 ? ` (${checkedIncluded.length})` : ""}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!editable || checkedExcluded.length === 0}
                onClick={() => {
                  const result = edit(`Restore ${plural(checkedExcluded.length, "frame")} to View`, (current, state) => restoreFrames(state.disk, state.catalog, current, checkedExcluded))
                  if (result.ok) setAnnouncement(`Restored ${plural(checkedExcluded.length, "frame")} to this View.`)
                }}
              >
                Restore to View{checkedExcluded.length > 0 ? ` (${checkedExcluded.length})` : ""}
              </Button>
              <Button size="sm" variant="outline" disabled={!editable || checkedIncluded.length === 0} onClick={() => setConfirm("usable")}>
                Mark included frames usable
              </Button>
              <Button size="sm" variant="outline" disabled={!editable || checked.length === 0} onClick={() => setConfirm("unusable")}>
                Mark unusable in library
              </Button>
              {project ? (
                <Button size="sm" variant="outline" disabled={!editable || checked.length === 0} onClick={() => setConfirm("reject")}>
                  Reject for Project
                </Button>
              ) : null}
            </>
          }
        />
        {errorNode}
        <TableToolbar
          search={{ label: "Filter frames by file name", placeholder: "File name contains…", value: ui.search, onChange: (search) => setFrameUi(view.id, { search }) }}
          filters={
            <>
              <SelectField
                className="w-44"
                label="Session"
                value={ui.sessionId ?? "all"}
                onChange={(value) => setFrameUi(view.id, { sessionId: value === "all" ? null : value })}
                options={[{ value: "all", label: "All sessions" }, ...sessions.map((s) => ({ value: s.id, label: sessionLabel(s) }))]}
              />
              <div className="ml-1 flex items-center gap-2 self-end pb-1.5">
                <Switch id={`${view.id}-show-excluded`} checked={ui.showExcluded} onCheckedChange={(on) => setFrameUi(view.id, { showExcluded: on })} />
                <Label htmlFor={`${view.id}-show-excluded`}>Show excluded ({excludedCount})</Label>
              </div>
            </>
          }
        />
        <p className="text-xs text-muted-foreground tabular-nums">
          {plural(shown.length, "frame")} shown of {memberIds.length} · {sessions.map((s) => `${formatNight(s.night)} ${s.channel}: ${rows.filter((r) => r.asset.sessionId === s.id && r.member === "included").length} of ${s.assetIds.length} in the View`).join(" · ")}
        </p>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_min(22rem,40%)] xl:grid-cols-[minmax(0,1fr)_min(26rem,40%)]">
          <DataTable
            label="Frames in this View"
            rows={shown}
            columns={columns}
            getRowId={(r) => r.asset.id}
            initialSort={{ columnId: "frame", direction: "asc" }}
            activeRowId={active?.asset.id ?? null}
            className="max-h-[40rem] self-start"
            selection={{ selected: checked, onChange: setCheckedIds, rowLabel: (r) => `${r.asset.fileName}, ${r.session ? sessionLabel(r.session) : "no session"}` }}
            empty={
              <EmptyState
                icon={ImageOff}
                title="No frames match"
                description={excludedCount > 0 && !ui.showExcluded ? "Excluded frames are hidden; show them or clear the filters." : "Clear the filters to see every frame in this View."}
                action={
                  <Button size="sm" variant="outline" onClick={() => setFrameUi(view.id, { search: "", sessionId: null, showExcluded: true })}>
                    Clear filters
                  </Button>
                }
                className="border-0"
              />
            }
          />
          {active ? (
            <FramePreview
              asset={active.asset}
              file={activeFile}
              record={catalog.measurements[active.asset.id]}
              state={active.state}
              applies={active.applies}
              scaleArcsec={pixelScaleFor(catalog, active.session)}
              position={{ index: Math.max(0, position), total: shown.length }}
              copies={active.asset.copies.map((c) => ({ location: catalog.locations[c.locationId]?.displayName ?? "Unknown location", path: c.path }))}
              onPrevious={() => step(-1)}
              onNext={() => step(1)}
              exclude={{ label: excludeLabel, disabledReason: readOnlyReason, run: () => toggleExclusion(active) }}
              unavailableReason={
                activeAvailability === "available"
                  ? null
                  : `Preview unavailable: the frame is ${activeAvailability === "offline" ? "offline" : activeAvailability === "unreadable" ? "unreadable (access denied)" : "not found at its last complete scan"}.`
              }
            />
          ) : null}
        </div>
        {notMeasured > 0 && op?.status === "canceled" ? (
          <Notice tone="info" title="Cancel kept your selection and exclusions">
            Frames that were not reached read Not measured. Leave Frames and open Review frames again, or choose Measure remaining frames.
          </Notice>
        ) : null}
      </PageBody>

      <ImportDialog viewId={view.id} viewAssetIds={new Set(memberIds)} open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={confirm === "usable"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Mark ${plural(checkedIncluded.length, "frame")} Usable in the library?`}
        description="Library scope: every View and the Target's usable totals see this decision."
        changes={[
          `Mark ${plural(checkedIncluded.length, "included frame")} Usable (library scope)`,
          ...(usableAfterMark && targetName ? [`${targetName} library-usable integration becomes ${usableAfterMark.map((c) => `${c.channel} ${formatDuration(c.usable)}`).join(", ")}`] : []),
        ]}
        unchanged={[
          `This View's membership: ${content.included.length} included, ${content.excluded.length} excluded`,
          ...(checkedExcluded.length > 0 ? [`${plural(checkedExcluded.length, "selected frame")} excluded from this View keep their quality`] : []),
          "Source files and headers",
          "Other Views' membership",
        ]}
        confirmLabel={`Mark ${plural(checkedIncluded.length, "frame")} Usable`}
        onConfirm={() => setLibraryQuality(checkedIncluded, "usable", `/views/${view.id}/frames`)}
      />
      <ConfirmDialog
        open={confirm === "unusable"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Mark ${plural(checked.length, "frame")} Unusable in the library?`}
        description="Library scope: the frames stop counting as usable or Unreviewed captures for every View and Target."
        changes={[
          `Mark ${plural(checked.length, "frame")} Unusable (library scope)`,
          ...(unusableAfterMark && targetName
            ? unusableAfterMark
                .filter((c) => c.usable !== c.usableBefore || c.unreviewed !== c.unreviewedBefore)
                .map((c) => `${targetName} ${c.channel}: usable ${formatDuration(c.usable)}, Unreviewed ${formatDuration(c.unreviewed)} (was ${formatDuration(c.unreviewedBefore)})`)
            : []),
        ]}
        unchanged={["This View's membership: frames stay included or excluded as they are", "Project rejection records", "Source files and headers"]}
        confirmLabel={`Mark ${plural(checked.length, "frame")} Unusable`}
        tone="destructive"
        onConfirm={() => setLibraryQuality(checked, "unusable", `/views/${view.id}/frames`)}
      />
      {project ? (
        <ConfirmDialog
          open={confirm === "reject"}
          onOpenChange={(open) => !open && setConfirm(null)}
          title={`Reject ${plural(checked.length, "frame")} for Project ${project.name}?`}
          description={`Project scope: a rejection record in ${project.name} only.`}
          changes={[`Record ${plural(checked.length, "frame")} as rejected for Project ${project.name}`]}
          unchanged={["Library quality of these frames", `${targetName ?? "Target"} library-usable totals`, `This View's membership: ${content.included.length} included`]}
          confirmLabel={`Reject ${plural(checked.length, "frame")} for Project`}
          onConfirm={() => rejectForProject(project.id, checked, `/views/${view.id}/frames`)}
        />
      ) : null}
    </div>
  )
}
