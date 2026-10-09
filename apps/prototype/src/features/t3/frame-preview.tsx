/**
 * Frame preview building blocks and star diagnostics (PIX-FR-03 to PIX-FR-06,
 * D2-D3), kept for slice D's S6 Review (`src/features/v5/d-review/preview.tsx`
 * composes them). Prototype: the raster is synthetic, drawn from fixture
 * pixel facts. Display stretch changes the preview
 * only; measured values come from the catalog and stay identical with any
 * stretch (PIX-AC-02). Saturated stars are failed fits with no width.
 */
import { useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { KeyValueList } from "@/components/app/data"
import { UnknownValue } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { NoteMarker, type NoteRow } from "@/components/app/tips"
import { BUILT_IN_METHOD } from "@/domain/measurement"
import type { FrameHeader, FrameMeasurement, Metric, MetricKey } from "@/domain/types"
import { HEADER_KEYWORDS } from "@/domain/types"
import { formatDateTime } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { builtInMetrics, currentImportedMetrics, type FrameMeasureState, historyImportedMetrics, METRIC_LABEL } from "./measure"
import { formatMetricFixed } from "@/domain/membership"
import { type CutoutKind, renderCutout, renderWindow, type StarField, type StarRecord, type StarWarning, type Stretch, type ViewWindow } from "./raster"

const METRIC_ORDER: MetricKey[] = ["fwhm", "hfr", "eccentricity", "star-count", "background", "snr"]

function cutoutTitle(m: Messages, kind: CutoutKind): string {
  return kind === "observed" ? m.frame_cutout_observed() : kind === "fitted" ? m.frame_fitted() : m.frame_cutout_residual()
}

function starWarning(m: Messages, warning: StarWarning): string {
  return warning === "saturated" ? m.frame_warning_saturated() : m.frame_warning_near_edge()
}

/** Content-box size of an element, following resizes. */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.floor(entry!.contentRect.width), height: Math.floor(entry!.contentRect.height) }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

export function Raster({ field, window, stretch, className, label }: { field: StarField; window: ViewWindow; stretch: Stretch; className?: string; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { x0, y0, scale, width, height } = window
  // Primitive deps: the parent rebuilds the window object every render (measurement ticks), the pixels only change with these.
  useEffect(() => {
    const context = canvas.current?.getContext("2d")
    if (!context || width <= 0 || height <= 0) return
    context.putImageData(renderWindow(field, { x0, y0, scale, width, height }, stretch), 0, 0)
  }, [field, x0, y0, scale, width, height, stretch])
  return <canvas ref={canvas} width={Math.max(1, width)} height={Math.max(1, height)} className={className} aria-label={label} role={label ? "img" : undefined} />
}

export function Cutout({ field, star, kind }: { field: StarField; star: StarRecord; kind: CutoutKind }) {
  const m = useMessages()
  const canvas = useRef<HTMLCanvasElement>(null)
  const unavailable = star.state === "failed" && kind !== "observed"
  useEffect(() => {
    if (unavailable) return
    canvas.current?.getContext("2d")?.putImageData(renderCutout(field, star, kind), 0, 0)
  }, [field, star, kind, unavailable])
  const title = cutoutTitle(m, kind)
  return (
    <figure className="space-y-1">
      {unavailable ? (
        <div className="flex size-20 items-center justify-center rounded-sm border border-dashed p-1 text-center text-xs text-muted-foreground">{m.frame_no_fit()}</div>
      ) : (
        <canvas ref={canvas} width={25} height={25} className="size-20 rounded-sm border [image-rendering:pixelated]" role="img" aria-label={m.frame_cutout_label({ kind: title, id: star.id })} />
      )}
      <figcaption className="text-xs text-muted-foreground">{title}</figcaption>
    </figure>
  )
}

export function StarDetail({ field, star, scaleArcsec }: { field: StarField; star: StarRecord; scaleArcsec: number | null }) {
  const m = useMessages()
  const width = (px: number | null) =>
    px === null ? (
      <UnknownValue label={m.measure_not_reported()} reason={m.frame_fit_failed()} />
    ) : scaleArcsec ? (
      `${formatMetricFixed({ value: px * scaleArcsec, unit: "arcsec" })} (${formatMetricFixed({ value: px, unit: "px" })})`
    ) : (
      formatMetricFixed({ value: px, unit: "px" })
    )
  return (
    <section aria-labelledby={`star-${star.id}-title`} className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={`star-${star.id}-title`} className="text-sm font-semibold">
          {m.frame_star({ id: star.id })}
        </h4>
        <StatusBadge kind="measurement" value={star.state === "failed" ? "failed" : "valid"} label={star.state === "failed" ? m.status_failed_fit() : m.frame_fitted()} />
        <NoteMarker
          label={m.frame_fit_note()}
          rows={[
            { label: m.frame_note_method(), value: `${BUILT_IN_METHOD.method} ${BUILT_IN_METHOD.version}` },
            { label: m.review_note_data(), value: m.frame_linear_source_pixels() },
            { label: METRIC_LABEL.hfr, value: m.frame_half_flux_radius() },
          ]}
        />
      </div>
      <KeyValueList
        items={[
          { label: m.frame_location(), value: m.frame_star_location({ x: star.x, y: star.y }) },
          { label: m.frame_psf_model(), value: star.state === "failed" ? <UnknownValue label={m.frame_no_model()} reason={m.frame_clipped_profile()} /> : BUILT_IN_METHOD.method },
          { label: METRIC_LABEL.fwhm, value: width(star.fwhmPx) },
          { label: METRIC_LABEL.hfr, value: width(star.hfrPx) },
          { label: METRIC_LABEL.eccentricity, value: star.eccentricity === null ? <UnknownValue label={m.measure_not_reported()} /> : star.eccentricity.toFixed(2) },
          { label: m.frame_angle(), value: star.angleDeg === null ? <UnknownValue label={m.measure_not_reported()} /> : `${star.angleDeg}°` },
          { label: m.frame_peak(), value: formatMetricFixed({ value: star.peakAdu, unit: "ADU" }) },
          { label: METRIC_LABEL.background, value: formatMetricFixed({ value: star.backgroundAdu, unit: "ADU" }) },
          { label: METRIC_LABEL.snr, value: star.snr.toFixed(1) },
        ]}
      />
      {star.warnings.length > 0 ? (
        <ul className="space-y-1 text-sm text-warning">
          {star.warnings.map((w) => (
            <li key={w}>{starWarning(m, w)}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {(["observed", "fitted", "residual"] as const).map((kind) => (
          <Cutout key={kind} field={field} star={star} kind={kind} />
        ))}
      </div>
    </section>
  )
}

/**
 * Values with their source (Direction B): each column header carries a
 * NoteMarker whose tooltip gives the method, basis, input identity and time,
 * so no value reads without its origin and no paragraph sits under the table.
 * An absent import reads "–".
 */
export function MetricTable({ record, state, applies, sha256 }: { record: FrameMeasurement | undefined; state: FrameMeasureState; applies: boolean; sha256: string }) {
  const m = useMessages()
  const builtIn = applies ? builtInMetrics(record) : []
  const imported = currentImportedMetrics(record, sha256)
  const earlier = historyImportedMetrics(record, sha256)
  const byKey = (list: Metric[], key: MetricKey) => list.find((metric) => metric.key === key)
  const warning = builtIn.find((metric) => metric.warning)?.warning
  const own = builtIn[0]
  const inputSha = record?.inputSha256
  const builtInNote: NoteRow[] = own
    ? [
        { label: m.frame_note_method(), value: `${own.method} ${own.version}` },
        { label: m.frame_note_basis(), value: own.basis },
        { label: m.frame_note_input(), value: inputSha ? (inputSha === sha256 ? m.frame_input_current({ hash: inputSha.slice(0, 12) }) : m.frame_input_earlier({ hash: inputSha.slice(0, 12) })) : "–" },
        ...(record?.computedAt ? [{ label: m.status_measured(), value: formatDateTime(record.computedAt) }] : []),
      ]
    : [
        { label: m.frame_note_method(), value: `${BUILT_IN_METHOD.method} ${BUILT_IN_METHOD.version}` },
        { label: m.frame_note_state(), value: applies ? m.status_not_measured() : m.frame_does_not_apply() },
      ]
  const importNote: NoteRow[] | null =
    imported.length > 0
      ? [
          { label: m.frame_note_method(), value: `${imported[0]!.method} ${imported[0]!.version}` },
          { label: m.frame_note_units(), value: [...new Set(imported.map((metric) => metric.unit || m.frame_unit_none()))].join(", ") },
          { label: m.frame_note_match(), value: m.frame_match_file_name() },
        ]
      : earlier.length > 0
        ? [{ label: m.frame_note_history(), value: m.frame_imported_earlier() }]
        : null
  return (
    <div className="space-y-1.5">
      <table className="w-full text-sm">
        <caption className="sr-only">{m.frame_metrics_caption()}</caption>
        <thead data-chrome className="text-[0.6875rem] text-muted-foreground">
          <tr className="border-b border-separator">
            <th scope="col" className="py-1 text-left font-medium">
              {m.frame_col_metric()}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {m.status_built_in()} <NoteMarker n={1} label={m.frame_builtin_source()} rows={builtInNote} />
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {m.frame_col_imported()} {importNote ? <NoteMarker n={2} label={m.frame_imported_source()} rows={importNote} /> : null}
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {METRIC_ORDER.map((key) => {
            const value = byKey(builtIn, key)
            const other = byKey(imported, key)
            const past = other ? undefined : byKey(earlier, key)
            return (
              <tr key={key} className="border-b border-border/50 last:border-0">
                <th scope="row" className="py-0.5 text-left font-normal text-muted-foreground">
                  {METRIC_LABEL[key]}
                </th>
                <td className="py-0.5 text-right">
                  {value ? formatMetricFixed(value) : <UnknownValue label={state === "pending" ? m.status_pending() : state === "verifying" ? m.status_verifying() : m.status_not_measured()} />}
                </td>
                <td className="py-0.5 text-right">
                  {other ? (
                    <>
                      {formatMetricFixed(other)}
                      <span className="sr-only"> {m.frame_value_imported_sr({ unit: other.unit })}</span>
                    </>
                  ) : past ? (
                    <span className="text-muted-foreground">
                      {formatMetricFixed(past)}
                      <span className="sr-only"> {m.frame_value_history_sr({ unit: past.unit })}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      <span aria-hidden="true">–</span>
                      <span className="sr-only">{m.review_none()}</span>
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {warning ? <p className="text-xs text-warning">{warning}</p> : null}
    </div>
  )
}

export function HeaderDetails({ header }: { header: FrameHeader }) {
  const m = useMessages()
  const keys = Object.keys(HEADER_KEYWORDS) as Array<keyof FrameHeader>
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">{m.frame_header_caption()}</caption>
      <tbody>
        {keys.map((key) => (
          <tr key={key} className="border-b last:border-0">
            <th scope="row" className="py-1 pr-3 text-left font-mono font-normal text-muted-foreground">
              {HEADER_KEYWORDS[key]}
            </th>
            <td className="py-1 font-mono break-all">{header[key] === null ? m.status_missing() : String(header[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
