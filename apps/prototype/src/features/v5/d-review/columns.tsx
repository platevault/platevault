/**
 * The frame table's columns (PIX-FR-16): every column the review offers,
 * each sortable by its value. The Frame column always shows; the Display
 * menu picks the rest. Column headers carry no notes: a value's method and
 * basis are in the inspector's Values tab (§6.2).
 */
import type { Column } from "@/components/app/contracts"
import { STATUS, StatusBadge } from "@/components/app/status"
import { formatMetricFixed } from "@/domain/membership"
import type { AssetId, MetricKey } from "@/domain/types"
import { formatExposure, formatTime } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { METRIC_LABEL } from "@/store/actions/measure"
import type { ReviewFrame } from "./model"
import { QualityLabel, qualityWord } from "./quality"

function measureBadge(m: Messages, measure: ReviewFrame["measure"]): { value: "valid" | "pending" | "verifying" | "unavailable"; label: string } {
  switch (measure) {
    case "measured":
      return { value: "valid", label: m.status_measured() }
    case "pending":
      return { value: "pending", label: m.status_pending() }
    case "verifying":
      return { value: "verifying", label: m.status_verifying() }
    case "history-only":
    case "not-measured":
      return { value: "unavailable", label: m.status_not_measured() }
  }
}

function metricColumn(m: Messages, key: MetricKey, header: string): Column<ReviewFrame> {
  return {
    id: key,
    header,
    align: "right",
    sortValue: (f) => f.builtIn[key]?.value ?? null,
    cell: (f) => {
      const metric = f.builtIn[key]
      return metric ? formatMetricFixed(m, metric) : "–"
    },
  }
}

/** Every column the review offers; `frame` is always shown. */
export function frameColumns(m: Messages, names: ReadonlyMap<AssetId, string>): Column<ReviewFrame>[] {
  return [
    { id: "frame", header: m.review_col_frame(), rowHeader: true, truncate: true, sortValue: (f) => names.get(f.asset.id) ?? f.asset.fileName, cell: (f) => names.get(f.asset.id) ?? f.asset.fileName },
    { id: "time", header: m.review_col_time(), sortValue: (f) => f.asset.observed.dateObs, cell: (f) => formatTime(f.asset.observed.dateObs) },
    { id: "exposure", header: m.review_col_exposure(), align: "right", sortValue: (f) => f.asset.observed.exposureS, cell: (f) => formatExposure(f.asset.observed.exposureS) },
    { id: "quality", header: m.review_col_quality(), sortValue: (f) => qualityWord(m, f, true), cell: (f) => <QualityLabel frame={f} short /> },
    metricColumn(m, "fwhm", METRIC_LABEL.fwhm),
    metricColumn(m, "hfr", METRIC_LABEL.hfr),
    metricColumn(m, "eccentricity", m.review_ecc_short()),
    metricColumn(m, "star-count", m.review_tab_stars()),
    metricColumn(m, "background", METRIC_LABEL.background),
    metricColumn(m, "snr", METRIC_LABEL.snr),
    {
      id: "fwhm-imported",
      header: m.review_col_fwhm_imported(),
      align: "right",
      sortValue: (f) => f.imported.fwhm?.value ?? null,
      cell: (f) => (f.imported.fwhm ? formatMetricFixed(m, f.imported.fwhm) : "–"),
    },
    {
      id: "measurement",
      header: m.review_col_measurement(),
      sortValue: (f) => measureBadge(m, f.measure).label,
      cell: (f) => {
        const badge = measureBadge(m, f.measure)
        return <StatusBadge kind="measurement" value={badge.value} label={badge.label} />
      },
    },
    {
      id: "availability",
      header: m.review_col_copy(),
      sortValue: (f) => STATUS.availability[f.availability].label,
      cell: (f) => <StatusBadge kind="availability" value={f.availability} />,
    },
  ]
}
