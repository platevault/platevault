/**
 * Frame preview building blocks and star diagnostics (PIX-FR-03 to PIX-FR-06,
 * D2-D3), kept for slice D's S6 Review (`src/features/v5/d-review/preview.tsx`
 * composes them). Prototype: the raster is synthetic, drawn from fixture
 * pixel facts, and the surface says so. Display stretch changes the preview
 * only; measured values come from the catalog and stay identical with any
 * stretch (PIX-AC-02). Saturated stars are failed fits with no width.
 */
import { useEffect, useId, useRef, useState } from "react"
import { KeyValueList } from "@/components/app/data"
import { UnknownValue } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
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
  const width = (px: number | null, label: string) =>
    px === null ? <UnknownValue label="Not reported" reason={`${label} needs a fitted profile; this fit failed.`} /> : scaleArcsec ? `${(px * scaleArcsec).toFixed(2)}″ (${px.toFixed(2)} px)` : `${px.toFixed(2)} px`
  return (
    <section aria-labelledby={`star-${star.id}-title`} className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 id={`star-${star.id}-title`} className="text-sm font-semibold">
          Star {star.id}
        </h4>
        <StatusBadge kind="measurement" value={star.state === "failed" ? "failed" : "valid"} label={star.state === "failed" ? "Failed fit" : "Fitted"} />
      </div>
      <KeyValueList
        items={[
          { label: "Location", value: `x ${star.x}, y ${star.y} px`, source: "Source pixels" },
          { label: "PSF model", value: star.state === "failed" ? <UnknownValue label="No model" reason="The profile is clipped, so no PSF was fitted." /> : BUILT_IN_METHOD.method },
          { label: "FWHM", value: width(star.fwhmPx, "FWHM") },
          { label: "HFR", value: width(star.hfrPx, "HFR"), source: "Half-flux radius, not FWHM" },
          { label: "Eccentricity", value: star.eccentricity === null ? <UnknownValue label="Not reported" /> : star.eccentricity.toFixed(2) },
          { label: "Angle", value: star.angleDeg === null ? <UnknownValue label="Not reported" /> : `${star.angleDeg}°` },
          { label: "Peak", value: `${star.peakAdu.toLocaleString("en-GB")} ADU`, source: "Linear data" },
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
 * Values with their source (Direction B): each column names where its values
 * come from with a numbered footnote, and the notes under the table give the
 * method, basis and input identity, so no value reads without its origin.
 */
export function MetricTable({ record, state, applies, sha256 }: { record: FrameMeasurement | undefined; state: FrameMeasureState; applies: boolean; sha256: string }) {
  const builtIn = applies ? builtInMetrics(record) : []
  const imported = currentImportedMetrics(record, sha256)
  const earlier = historyImportedMetrics(record, sha256)
  const byKey = (list: Metric[], key: MetricKey) => list.find((m) => m.key === key)
  const warning = builtIn.find((m) => m.warning)?.warning
  const noteId = useId()
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
              Built-in
              {/* Plain markers: a `#` link would change the hash route; the notes sit directly below. */}
              <sup className="ml-0.5 text-link" aria-describedby={`${noteId}-1`}>
                1
              </sup>
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Imported
              <sup className="ml-0.5 text-link" aria-describedby={`${noteId}-2`}>
                2
              </sup>
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {METRIC_ORDER.map((key) => {
            const own = byKey(builtIn, key)
            const other = byKey(imported, key)
            const past = other ? undefined : byKey(earlier, key)
            return (
              <tr key={key} className="border-b border-border/50 last:border-0">
                <th scope="row" className="py-0.5 text-left font-normal text-muted-foreground">
                  {METRIC_LABEL[key]}
                </th>
                <td className="py-0.5 text-right">
                  {own ? formatMetricFixed(own) : <UnknownValue label={state === "pending" ? "Pending" : state === "verifying" ? "Verifying" : "Not measured"} />}
                </td>
                <td className="py-0.5 text-right">
                  {other ? (
                    <>
                      {formatMetricFixed(other)}
                      <span className="sr-only"> {other.unit}, imported, content unverified</span>
                    </>
                  ) : past ? (
                    <span className="text-muted-foreground">
                      History: {formatMetricFixed(past)}
                      <span className="sr-only"> {past.unit}, imported for earlier content</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <ol aria-label="Sources" className="space-y-1 border-t border-separator pt-1.5 text-[0.6875rem] leading-4 text-muted-foreground">
        <li id={`${noteId}-1`} className="flex gap-1.5">
          <span className="w-2 shrink-0 text-right text-link tabular-nums">1</span>
          <span>
            {builtIn.length > 0
              ? `${builtIn[0]!.method} ${builtIn[0]!.version} · ${builtIn[0]!.basis} · input SHA-256 ${record?.inputSha256 ? `${record.inputSha256.slice(0, 12)}…${record.inputSha256 === sha256 ? " (current bytes)" : " (earlier content)"}` : "not recorded"}${record?.computedAt ? ` · measured ${formatDateTime(record.computedAt)}` : ""}`
              : `${BUILT_IN_METHOD.method} ${BUILT_IN_METHOD.version} · ${applies ? "no measurement for these bytes yet" : "does not apply to this frame"}`}
          </span>
        </li>
        <li id={`${noteId}-2`} className="flex gap-1.5">
          <span className="w-2 shrink-0 text-right text-link tabular-nums">2</span>
          {imported.length > 0 ? (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <StatusBadge kind="match" value="unknown" label="Imported · content unverified" />
              <span>
                {imported[0]!.method} {imported[0]!.version} · units {[...new Set(imported.map((m) => m.unit || "none"))].join(", ")} · matched by file only; the SHA-256 noted at import detects later changes and never verifies the values.
              </span>
            </span>
          ) : earlier.length > 0 ? (
            <span>Imported values are history: they were imported for other content than this frame's current bytes.</span>
          ) : (
            <span>No imported measurement. Import measurements reads a CSV export.</span>
          )}
        </li>
      </ol>
      {warning ? <p className="text-xs text-warning">{warning}</p> : null}
      <p className="text-[0.6875rem] text-muted-foreground">Display stretch changes this preview only. Values are measured on linear data and never decide quality.</p>
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
