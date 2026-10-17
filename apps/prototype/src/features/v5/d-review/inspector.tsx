/**
 * The Review inspector's body (D-W13, D-W15, PIX-FR-02, PIX-FR-05,
 * PIX-FR-06): the current frame's library quality with the three marks
 * (library-wide, P-REJ2), where its copies are, the histogram of the region
 * the plate shows, and tabs for its measured values with their sources, the
 * detected stars with cutouts, and the header. The workspace's aside holds
 * it: docked beside the stage, or over it on a narrow window.
 */
import { useMemo } from "react"
import { useMessages } from "@/app/preferences"
import { ActionBar, type ActionRunner } from "@/components/app/actions"
import type { Action, Column } from "@/components/app/contracts"
import { KeyValueList, PathText } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { UnknownValue } from "@/components/app/feedback"
import { Histogram } from "@/components/domain/histogram"
import { detectedStars, linearHistogram, type StarField, type StarRecord, type ViewWindow } from "@/components/domain/raster"
import { StarCutouts } from "@/components/domain/star-cutouts"
import { ViewTabs } from "@/components/templates/parts"
import { BUILT_IN_METHOD } from "@/domain/measurement"
import { formatMetricFixed, pixelScaleFor } from "@/domain/membership"
import { type Catalog, type FrameMeasurement, HEADER_KEYWORDS, type FrameHeader, type Metric, type MetricKey } from "@/domain/types"
import { formatDateTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { builtInMetrics, currentImportedMetrics, historyImportedMetrics, METRIC_LABEL } from "@/store/actions/measure"
import type { ReviewFrame } from "./model"
import { QualityLabel } from "./quality"

export type InspectorTab = "values" | "stars" | "header"

const METRIC_ORDER: MetricKey[] = ["fwhm", "hfr", "eccentricity", "star-count", "background", "snr"]

interface MetricRow {
  key: MetricKey
  builtIn: Metric | undefined
  imported: Metric | undefined
  /** An import recorded for other bytes: history only (D19). */
  earlier: Metric | undefined
}

function Values({ frame, record }: { frame: ReviewFrame; record: FrameMeasurement | undefined }) {
  const m = useMessages()
  const applies = frame.measure === "measured"
  const builtIn = applies ? builtInMetrics(record) : []
  const imported = currentImportedMetrics(record, frame.asset.sha256)
  const earlier = historyImportedMetrics(record, frame.asset.sha256)
  const find = (list: Metric[], key: MetricKey) => list.find((metric) => metric.key === key)
  const rows: MetricRow[] = METRIC_ORDER.map((key) => ({ key, builtIn: find(builtIn, key), imported: find(imported, key), earlier: find(earlier, key) }))
  const missing = frame.measure === "pending" ? m.status_pending() : frame.measure === "verifying" ? m.status_verifying() : m.status_not_measured()
  const columns: Column<MetricRow>[] = [
    // The metric's name gives way first, so the values stay in the 19rem inspector in every language.
    { id: "metric", header: m.frame_col_metric(), rowHeader: true, truncate: true, sortValue: (row) => METRIC_LABEL[row.key], cell: (row) => METRIC_LABEL[row.key] },
    { id: "built-in", header: m.status_built_in(), align: "right", sortValue: (row) => row.builtIn?.value ?? null, cell: (row) => (row.builtIn ? formatMetricFixed(m, row.builtIn) : "–") },
    {
      id: "imported",
      header: m.frame_col_imported(),
      align: "right",
      sortValue: (row) => row.imported?.value ?? null,
      cell: (row) => (row.imported ? formatMetricFixed(m, row.imported) : row.earlier ? m.frame_value_history({ value: formatMetricFixed(m, row.earlier) }) : "–"),
    },
  ]
  const own = builtIn[0]
  const input = record?.inputSha256
  const warning = builtIn.find((metric) => metric.warning)?.warning
  // The source of each column as facts, not a tooltip (§6.2): method, basis, input and time.
  const sources = [
    { label: m.frame_builtin_source(), value: own ? `${own.method} ${own.version}` : `${BUILT_IN_METHOD.method} ${BUILT_IN_METHOD.version}` },
    { label: m.frame_note_basis(), value: own ? say(m, own.basis) : frame.measure === "history-only" ? m.frame_does_not_apply() : missing },
    ...(own && input ? [{ label: m.frame_note_input(), value: input === frame.asset.sha256 ? m.frame_input_current({ hash: input.slice(0, 12) }) : m.frame_input_earlier({ hash: input.slice(0, 12) }), mono: true }] : []),
    ...(own && record?.computedAt ? [{ label: m.status_measured(), value: formatDateTime(record.computedAt) }] : []),
    ...(imported[0] ? [{ label: m.frame_imported_source(), value: `${imported[0].method} ${imported[0].version}` }, { label: m.frame_note_match(), value: m.frame_match_file_name() }] : []),
    ...(warning ? [{ label: m.frame_note_warning(), value: say(m, warning) }] : []),
  ]
  return (
    <>
      <DataTable label={m.frame_metrics_caption()} rows={rows} columns={columns} getRowId={(row) => row.key} scroll="none" />
      <KeyValueList items={sources} />
    </>
  )
}

function StarDetail({ field, star, scaleArcsec }: { field: StarField; star: StarRecord; scaleArcsec: number | null }) {
  const m = useMessages()
  const width = (px: number | null) =>
    px === null ? <UnknownValue label={m.measure_not_reported()} /> : scaleArcsec ? m.frame_width_scaled({ arcsec: formatMetricFixed(m, { value: px * scaleArcsec, unit: "arcsec" }), px: formatMetricFixed(m, { value: px, unit: "px" }) }) : formatMetricFixed(m, { value: px, unit: "px" })
  return (
    <>
      <KeyValueList
        items={[
          { label: m.frame_star({ id: star.id }), value: star.state === "failed" ? m.status_failed_fit() : m.frame_fitted() },
          { label: m.frame_location(), value: m.frame_star_location({ x: star.x, y: star.y }) },
          { label: m.frame_psf_model(), value: star.state === "failed" ? m.frame_clipped_profile() : BUILT_IN_METHOD.method },
          { label: METRIC_LABEL.fwhm, value: width(star.fwhmPx) },
          { label: METRIC_LABEL.hfr, value: width(star.hfrPx) },
          { label: METRIC_LABEL.eccentricity, value: star.eccentricity === null ? <UnknownValue label={m.measure_not_reported()} /> : formatMetricFixed(m, { value: star.eccentricity, unit: "" }) },
          { label: m.frame_angle(), value: star.angleDeg === null ? <UnknownValue label={m.measure_not_reported()} /> : m.frame_angle_value({ deg: star.angleDeg }) },
          { label: m.frame_peak(), value: formatMetricFixed(m, { value: star.peakAdu, unit: "ADU" }) },
          { label: METRIC_LABEL.background, value: formatMetricFixed(m, { value: star.backgroundAdu, unit: "ADU" }) },
          { label: METRIC_LABEL.snr, value: formatMetricFixed(m, { value: star.snr, unit: "" }) },
          ...(star.warnings.length > 0 ? [{ label: m.frame_note_warning(), value: star.warnings.map((w) => (w === "saturated" ? m.frame_warning_saturated() : m.frame_warning_near_edge())).join(" · ") }] : []),
        ]}
      />
      <StarCutouts field={field} star={star} />
    </>
  )
}

function Stars({ field, star, onStar, scaleArcsec }: { field: StarField; star: StarRecord | null; onStar: (star: StarRecord) => void; scaleArcsec: number | null }) {
  const m = useMessages()
  const stars = useMemo(() => detectedStars(field), [field])
  const columns: Column<StarRecord>[] = [
    { id: "star", header: m.frame_col_star(), rowHeader: true, sortValue: (s) => s.id, cell: (s) => m.frame_star({ id: s.id }) },
    { id: "position", header: m.frame_location(), sortValue: (s) => s.y * 100_000 + s.x, cell: (s) => m.frame_star_location({ x: s.x, y: s.y }) },
    { id: "fwhm", header: METRIC_LABEL.fwhm, align: "right", sortValue: (s) => s.fwhmPx, cell: (s) => (s.state === "failed" ? m.status_failed_fit() : formatMetricFixed(m, { value: s.fwhmPx, unit: "px" })) },
  ]
  return (
    <>
      <DataTable label={m.review_detected_stars({ count: stars.length })} rows={stars} columns={columns} getRowId={(s) => String(s.id)} activeRowId={star ? String(star.id) : null} onRowClick={onStar} scroll="none" />
      {star ? <StarDetail field={field} star={star} scaleArcsec={scaleArcsec} /> : null}
    </>
  )
}

function Header({ header }: { header: FrameHeader }) {
  const m = useMessages()
  const keys = Object.keys(HEADER_KEYWORDS) as Array<keyof FrameHeader>
  return <KeyValueList items={keys.map((key) => ({ label: HEADER_KEYWORDS[key], value: header[key] === null ? m.status_missing() : String(header[key]), mono: true }))} />
}

export interface InspectorProps {
  frame: ReviewFrame
  catalog: Catalog
  /** The frame's pixels; null when no copy can be read. */
  field: StarField | null
  /** The region the plate shows, for the histogram. */
  window: ViewWindow | null
  /** The linear value under the plate's cursor, drawn on the histogram. */
  readout: number | null
  star: StarRecord | null
  onStar: (star: StarRecord) => void
  tab: InspectorTab
  onTab: (tab: InspectorTab) => void
  /** Usable, Unusable, Unreviewed: for the selection when it holds more than one frame. */
  marks: Action[]
  runner: ActionRunner
}

export function Inspector({ frame, catalog, field, window, readout, star, onStar, tab, onTab, marks, runner }: InspectorProps) {
  const m = useMessages()
  const record = catalog.measurements[frame.asset.id]
  const histogram = useMemo(() => (field && window ? linearHistogram(field, window) : null), [field, window])
  return (
    <>
      <ActionBar actions={marks} runner={runner} />
      <KeyValueList
        items={[
          { label: m.review_col_quality(), value: <QualityLabel frame={frame} /> },
          ...frame.asset.copies.map((copy) => ({ label: catalog.locations[copy.locationId]?.displayName ?? m.review_unknown_location(), value: <PathText path={copy.path} /> })),
        ]}
      />
      {histogram ? <Histogram data={histogram} readout={readout} /> : <UnknownValue label={m.review_no_pixels()} />}
      <ViewTabs
        views={{
          label: m.review_frame_inspector(),
          items: [
            { id: "values", label: m.review_tab_values() },
            { id: "stars", label: m.review_tab_stars() },
            { id: "header", label: m.evidence_source_header() },
          ],
          value: tab,
          onChange: (id) => onTab(id as InspectorTab),
        }}
      >
        {tab === "values" ? <Values frame={frame} record={record} /> : null}
        {tab === "stars" ? field ? <Stars field={field} star={star} onStar={onStar} scaleArcsec={pixelScaleFor(catalog, frame.session)} /> : <UnknownValue label={m.review_no_pixels()} /> : null}
        {tab === "header" ? <Header header={frame.asset.observed} /> : null}
      </ViewTabs>
    </>
  )
}

/** For the palette and announcements. */
export function inspectorTabLabel(m: Messages, tab: InspectorTab): string {
  return tab === "values" ? m.review_tab_values() : tab === "stars" ? m.review_tab_stars() : m.evidence_source_header()
}
