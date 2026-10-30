/**
 * The frame table's columns and the words a frame's state reads in
 * (PIX-FR-14, PIX-FR-16). Every column sorts by its value, so the table, the
 * filmstrip and the grid share one order; a frame without a value sorts
 * last and reads "–". The quality label reads Picked, Rejected or
 * Unreviewed; a decision that no longer applies to the current bytes reads
 * Unreviewed with its reason.
 */
import type { Availability, MetricId, MetricValue, ReviewFrame_Serialize, ThumbnailState_Serialize } from "@/api/ipc"
import type { Column } from "@/components/app/contracts"
import { failureMessage } from "@/components/app/run-result"
import { StatusBadge } from "@/components/app/status"
import { useMessages } from "@/app/preferences"
import { formatCount, formatDecimal, formatExposure, formatTime } from "@/lib/format"
import type { Messages } from "@/lib/i18n"

type Frame = ReviewFrame_Serialize

/** The metrics the table shows and the plots draw, in order. */
export const FRAME_METRICS: readonly MetricId[] = ["fwhm_median", "hfr_median", "eccentricity_median", "star_count", "background_median"]

export function metricLabel(m: Messages, metric: MetricId): string {
  switch (metric) {
    case "fwhm_median":
      return m.measure_metric_fwhm()
    case "hfr_median":
      return m.measure_metric_hfr()
    case "eccentricity_median":
      return m.review_ecc_short()
    case "star_count":
    case "fitted_star_count":
      return m.review_tab_stars()
    case "background_median":
    case "background_noise":
      return m.measure_metric_background()
  }
}

export function metricOf(frame: Frame, metric: MetricId): MetricValue | null {
  const value = frame.state.values.find((v) => v.metric === metric)
  return value && value.state === "measured" && value.value !== null ? value : null
}

/** A measured value with its unit: "3.21 px", "2.4″", "412 ADU". */
export function formatMetric(m: Messages, value: number, units: MetricValue["units"]): string {
  switch (units) {
    case "count":
      return formatCount(Math.round(value))
    case "px":
      return m.review_value_px({ value: formatDecimal(value, 2) })
    case "arcsec":
      return m.review_value_arcsec({ value: formatDecimal(value, 2) })
    case "dn":
    case "data_unit":
      return m.review_value_adu({ value: formatCount(Math.round(value)) })
    case "e-":
      return m.review_value_electrons({ value: formatDecimal(value, 1) })
    case "deg":
    case "dimensionless":
    case "normalized":
      return formatDecimal(value, 2)
  }
}

/** The frame's label in words; `short` drops the reason after Unreviewed. */
export function qualityWord(m: Messages, frame: Frame, short = false): string {
  if (frame.label === "picked") return m.review_picked()
  if (frame.label === "rejected") return m.review_rejected()
  if (!short && typeof frame.quality === "object") {
    return "changed_content" in frame.quality ? m.review_quality_unreviewed_changed() : m.review_quality_unreviewed_pending()
  }
  return m.status_unreviewed()
}

function qualityValue(frame: Frame): "usable" | "unusable" | "unreviewed" | "changed-content" | "verification-pending" {
  if (frame.label === "picked") return "usable"
  if (frame.label === "rejected") return "unusable"
  if (typeof frame.quality === "object") return "changed_content" in frame.quality ? "changed-content" : "verification-pending"
  return "unreviewed"
}

/** The quality badge; `short` drops the reason after Unreviewed (table cells, thumbnails). */
export function QualityLabel({ frame, short = false }: { frame: Frame; short?: boolean }) {
  const m = useMessages()
  return <StatusBadge kind="quality" value={qualityValue(frame)} label={qualityWord(m, frame, short)} />
}

/** Why a copy shows no pixels, in the status words. */
export function availabilityWord(m: Messages, availability: Availability): string {
  switch (availability) {
    case "available":
      return m.status_available()
    case "offline":
      return m.status_offline()
    case "missing":
      return m.status_not_found()
    case "unreadable":
      return m.status_unreadable()
    case "identity_conflict":
      return m.status_changed_content()
    case "retired":
      return m.status_retired()
    case "trashed":
      return m.status_trashed()
  }
}

/** A thumbnail that has no pixels, worded: the decode's failure code or the copy's availability. */
export function thumbnailReason(m: Messages, entry: ThumbnailState_Serialize, frame: Frame): string {
  if (entry.state === "unreadable") {
    return failureMessage(m, { source: "library", command: "pixThumbnails", error: { code: entry.code, identity: null, scope: null, retry: "none", currentRevision: null, successors: [], window: null, correction: null, field: null } })
  }
  return availabilityWord(m, frame.state.availability)
}

function metricColumn(m: Messages, metric: MetricId): Column<Frame> {
  return {
    id: metric,
    header: metricLabel(m, metric),
    align: "right",
    sortValue: (f) => metricOf(f, metric)?.value ?? null,
    cell: (f) => {
      const value = metricOf(f, metric)
      return value ? formatMetric(m, value.value!, value.units) : "–"
    },
  }
}

/** Every column of the frame table; the Frame column is the row header. */
export function frameColumns(m: Messages): Column<Frame>[] {
  return [
    { id: "frame", header: m.review_col_frame(), rowHeader: true, sortValue: (f) => f.display.name, cell: (f) => f.display.name },
    { id: "time", header: m.review_col_time(), sortValue: (f) => f.asset.effective.dateObs, cell: (f) => (f.asset.effective.dateObs ? formatTime(f.asset.effective.dateObs) : "–") },
    { id: "filter", header: m.session_filter(), sortValue: (f) => f.asset.effective.filter, cell: (f) => f.asset.effective.filter ?? "–", hideable: true },
    {
      id: "exposure",
      header: m.review_col_exposure(),
      align: "right",
      sortValue: (f) => f.asset.effective.exposureSeconds,
      cell: (f) => (f.asset.effective.exposureSeconds !== null ? formatExposure(f.asset.effective.exposureSeconds) : "–"),
      hideable: true,
    },
    { id: "quality", header: m.review_col_quality(), sortValue: (f) => qualityWord(m, f, true), cell: (f) => <QualityLabel frame={f} short /> },
    ...FRAME_METRICS.map((metric) => metricColumn(m, metric)),
  ]
}
