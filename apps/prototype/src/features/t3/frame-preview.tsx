/**
 * Frame preview building blocks and star diagnostics (PIX-FR-03 to PIX-FR-06,
 * D2-D3), kept for slice D's S6 Review (`src/features/v5/d-review/preview.tsx`
 * composes them). Prototype: the raster is synthetic, drawn from fixture
 * pixel facts. Display stretch changes the preview
 * only; measured values come from the catalog and stay identical with any
 * stretch (PIX-AC-02). Saturated stars are failed fits with no width.
 */
import { useEffect, useRef, useState } from "react"
import { KeyValueList } from "@/components/app/data"
import { UnknownValue } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { NoteMarker, type NoteRow } from "@/components/app/tips"
import { BUILT_IN_METHOD } from "@/domain/measurement"
import type { FrameHeader, FrameMeasurement, Metric, MetricKey } from "@/domain/types"
import { HEADER_KEYWORDS } from "@/domain/types"
import { formatDateTime } from "@/lib/format"
import { builtInMetrics, currentImportedMetrics, type FrameMeasureState, historyImportedMetrics, METRIC_LABEL } from "./measure"
import { formatMetricFixed } from "@/domain/membership"
import { type CutoutKind, renderCutout, renderWindow, type StarField, type StarRecord, type Stretch, type ViewWindow } from "./raster"

const METRIC_ORDER: MetricKey[] = ["fwhm", "hfr", "eccentricity", "star-count", "background", "snr"]

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
  const canvas = useRef<HTMLCanvasElement>(null)
  const unavailable = star.state === "failed" && kind !== "observed"
  useEffect(() => {
    if (unavailable) return
    canvas.current?.getContext("2d")?.putImageData(renderCutout(field, star, kind), 0, 0)
  }, [field, star, kind, unavailable])
  const title = { observed: "Observed", fitted: "Fitted", residual: "Residual" }[kind]
  return (
    <figure className="space-y-1">
      {unavailable ? (
        <div className="flex size-20 items-center justify-center rounded-sm border border-dashed p-1 text-center text-xs text-muted-foreground">No fit</div>
      ) : (
        <canvas ref={canvas} width={25} height={25} className="size-20 rounded-sm border [image-rendering:pixelated]" role="img" aria-label={`${title} cutout of star ${star.id}`} />
      )}
      <figcaption className="text-xs text-muted-foreground">{title}</figcaption>
    </figure>
  )
}

export function StarDetail({ field, star, scaleArcsec }: { field: StarField; star: StarRecord; scaleArcsec: number | null }) {
  const width = (px: number | null) =>
    px === null ? <UnknownValue label="Not reported" reason="Fit failed" /> : scaleArcsec ? `${(px * scaleArcsec).toFixed(2)}″ (${px.toFixed(2)} px)` : `${px.toFixed(2)} px`
  return (
    <section aria-labelledby={`star-${star.id}-title`} className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={`star-${star.id}-title`} className="text-sm font-semibold">
          Star {star.id}
        </h4>
        <StatusBadge kind="measurement" value={star.state === "failed" ? "failed" : "valid"} label={star.state === "failed" ? "Failed fit" : "Fitted"} />
        <NoteMarker
          label="Fit note"
          rows={[
            { label: "Method", value: `${BUILT_IN_METHOD.method} ${BUILT_IN_METHOD.version}` },
            { label: "Data", value: "Linear, source pixels" },
            { label: "HFR", value: "Half-flux radius" },
          ]}
        />
      </div>
      <KeyValueList
        items={[
          { label: "Location", value: `x ${star.x}, y ${star.y} px` },
          { label: "PSF model", value: star.state === "failed" ? <UnknownValue label="No model" reason="Clipped profile" /> : BUILT_IN_METHOD.method },
          { label: "FWHM", value: width(star.fwhmPx) },
          { label: "HFR", value: width(star.hfrPx) },
          { label: "Eccentricity", value: star.eccentricity === null ? <UnknownValue label="Not reported" /> : star.eccentricity.toFixed(2) },
          { label: "Angle", value: star.angleDeg === null ? <UnknownValue label="Not reported" /> : `${star.angleDeg}°` },
          { label: "Peak", value: `${star.peakAdu.toLocaleString("en-GB")} ADU` },
          { label: "Background", value: `${star.backgroundAdu.toLocaleString("en-GB")} ADU` },
          { label: "SNR", value: star.snr.toFixed(1) },
        ]}
      />
      {star.warnings.length > 0 ? (
        <ul className="space-y-1 text-sm text-warning">
          {star.warnings.map((w) => (
            <li key={w}>{w}</li>
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
  const builtIn = applies ? builtInMetrics(record) : []
  const imported = currentImportedMetrics(record, sha256)
  const earlier = historyImportedMetrics(record, sha256)
  const byKey = (list: Metric[], key: MetricKey) => list.find((m) => m.key === key)
  const warning = builtIn.find((m) => m.warning)?.warning
  const own = builtIn[0]
  const builtInNote: NoteRow[] = own
    ? [
        { label: "Method", value: `${own.method} ${own.version}` },
        { label: "Basis", value: own.basis },
        { label: "Input", value: record?.inputSha256 ? `SHA-256 ${record.inputSha256.slice(0, 12)}… ${record.inputSha256 === sha256 ? "(current)" : "(earlier)"}` : "–" },
        ...(record?.computedAt ? [{ label: "Measured", value: formatDateTime(record.computedAt) }] : []),
      ]
    : [
        { label: "Method", value: `${BUILT_IN_METHOD.method} ${BUILT_IN_METHOD.version}` },
        { label: "State", value: applies ? "Not measured" : "Does not apply" },
      ]
  const importNote: NoteRow[] | null =
    imported.length > 0
      ? [
          { label: "Method", value: `${imported[0]!.method} ${imported[0]!.version}` },
          { label: "Units", value: [...new Set(imported.map((m) => m.unit || "none"))].join(", ") },
          { label: "Match", value: "File name, unverified" },
        ]
      : earlier.length > 0
        ? [{ label: "History", value: "Imported for earlier content" }]
        : null
  return (
    <div className="space-y-1.5">
      <table className="w-full text-sm">
        <caption className="sr-only">Measurements of the current frame, with their sources</caption>
        <thead data-chrome className="text-[0.6875rem] text-muted-foreground">
          <tr className="border-b border-separator">
            <th scope="col" className="py-1 text-left font-medium">
              Metric
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Built-in <NoteMarker n={1} label="Built-in source" rows={builtInNote} />
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Imported {importNote ? <NoteMarker n={2} label="Imported source" rows={importNote} /> : null}
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
                  {value ? formatMetricFixed(value) : <UnknownValue label={state === "pending" ? "Pending" : state === "verifying" ? "Verifying" : "Not measured"} />}
                </td>
                <td className="py-0.5 text-right">
                  {other ? (
                    <>
                      {formatMetricFixed(other)}
                      <span className="sr-only"> {other.unit}, imported, unverified</span>
                    </>
                  ) : past ? (
                    <span className="text-muted-foreground">
                      {formatMetricFixed(past)}
                      <span className="sr-only"> {past.unit}, history</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      <span aria-hidden="true">–</span>
                      <span className="sr-only">None</span>
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
  const keys = Object.keys(HEADER_KEYWORDS) as Array<keyof FrameHeader>
  return (
    <table className="w-full text-xs">
      <caption className="sr-only">Header metadata</caption>
      <tbody>
        {keys.map((key) => (
          <tr key={key} className="border-b last:border-0">
            <th scope="row" className="py-1 pr-3 text-left font-mono font-normal text-muted-foreground">
              {HEADER_KEYWORDS[key]}
            </th>
            <td className="py-1 font-mono break-all">{header[key] === null ? "Missing" : String(header[key])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
