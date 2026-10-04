/**
 * Frame preview and star diagnostics (PIX-FR-03 to PIX-FR-06, D2-D3).
 * Prototype: the raster is synthetic, drawn from fixture pixel facts, and the
 * surface says so. Zoom (Fit, 1:1, 2:1), pan by drag or arrow keys, fixed
 * centre/corner comparison, previous/next frame and display stretch change
 * the preview only; measured values come from the catalog and stay identical
 * with any stretch (PIX-AC-02). Saturated stars are failed fits with no width.
 */
import { ChevronLeft, ChevronRight, CircleSlash, Sparkles } from "lucide-react"
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react"
import { KeyValueList, PathText } from "@/components/app/data"
import { UnknownValue } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Kbd } from "@/components/ui/kbd"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { BUILT_IN_METHOD } from "@/domain/measurement"
import type { Asset, DiskFile, FrameHeader, FrameMeasurement, Metric, MetricKey } from "@/domain/types"
import { HEADER_KEYWORDS } from "@/domain/types"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { builtInMetrics, type FrameMeasureState, formatMetric, importedMetricsOf, METRIC_LABEL } from "./measure"
import { type CutoutKind, detectedStars, renderCutout, renderWindow, type StarField, type StarRecord, starField, type Stretch, type ViewWindow } from "./raster"

type Zoom = "fit" | "1" | "2"

const METRIC_ORDER: MetricKey[] = ["fwhm", "hfr", "eccentricity", "star-count", "background", "snr"]

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function Raster({ field, window, stretch, className, label }: { field: StarField; window: ViewWindow; stretch: Stretch; className?: string; label?: string }) {
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

function Cutout({ field, star, kind }: { field: StarField; star: StarRecord; kind: CutoutKind }) {
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

function StarDetail({ field, star, scaleArcsec }: { field: StarField; star: StarRecord; scaleArcsec: number | null }) {
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

function MetricTable({ record, state, applies }: { record: FrameMeasurement | undefined; state: FrameMeasureState; applies: boolean }) {
  const builtIn = applies ? builtInMetrics(record) : []
  const imported = importedMetricsOf(record)
  const byKey = (list: Metric[], key: MetricKey) => list.find((m) => m.key === key)
  const warning = builtIn.find((m) => m.warning)?.warning
  return (
    <div className="space-y-1.5">
      <table className="w-full text-sm">
        <caption className="sr-only">Measurements of the current frame</caption>
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="py-1 text-left font-medium">
              Metric
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Built-in
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Imported
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {METRIC_ORDER.map((key) => {
            const own = byKey(builtIn, key)
            const other = byKey(imported, key)
            return (
              <tr key={key} className="border-b last:border-0">
                <th scope="row" className="py-1 text-left font-normal text-muted-foreground">
                  {METRIC_LABEL[key]}
                </th>
                <td className="py-1 text-right">
                  {own ? formatMetric(own) : <UnknownValue label={state === "pending" ? "Pending" : state === "verifying" ? "Verifying" : "Not measured"} />}
                </td>
                <td className="py-1 text-right">{other ? formatMetric(other) : <span className="text-muted-foreground">None</span>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {warning ? <p className="text-xs text-warning">{warning}</p> : null}
      <p className="text-xs text-muted-foreground">Display stretch changes this preview only. Values are measured on linear data and never decide quality.</p>
    </div>
  )
}

function HeaderDetails({ header }: { header: FrameHeader }) {
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

export interface FramePreviewProps {
  asset: Asset
  file: DiskFile | undefined
  record: FrameMeasurement | undefined
  state: FrameMeasureState
  applies: boolean
  scaleArcsec: number | null
  position: { index: number; total: number }
  copies: Array<{ location: string; path: string }>
  onPrevious: () => void
  onNext: () => void
  exclude: { label: string; disabledReason: string | null; run: () => void }
  unavailableReason: string | null
}

export function FramePreview({ asset, file, record, state, applies, scaleArcsec, position, copies, onPrevious, onNext, exclude, unavailableReason }: FramePreviewProps) {
  const [zoom, setZoom] = useState<Zoom>("fit")
  const [stretch, setStretch] = useState<Stretch>("auto")
  const [mode, setMode] = useState<"whole" | "corners">("whole")
  const [starsOn, setStarsOn] = useState(false)
  const [starId, setStarId] = useState<number | null>(null)
  const [centre, setCentre] = useState<{ x: number; y: number } | null>(null)
  const [frameRef, width] = useWidth<HTMLDivElement>()
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const helpId = useId()
  const truth = file?.pixelTruth

  // A new frame keeps zoom, stretch and the panned region, so frames compare at the same place; the star choice is per frame.
  useEffect(() => {
    setStarId(null)
  }, [asset.id])

  const header = asset.observed
  const field = truth ? starField(`${asset.id}|${file!.sha256}`, truth, header.widthPx, header.heightPx, header.bayerPattern) : null
  const stars = field ? detectedStars(field) : []
  const star = stars.find((s) => s.id === starId) ?? null
  const height = Math.round((width * header.heightPx) / header.widthPx)
  const scale = zoom === "fit" ? header.widthPx / Math.max(1, width) : zoom === "1" ? 1 : 0.5
  const cx = zoom === "fit" ? header.widthPx / 2 : (centre?.x ?? header.widthPx / 2)
  const cy = zoom === "fit" ? header.heightPx / 2 : (centre?.y ?? header.heightPx / 2)
  const window: ViewWindow = { x0: cx - (width * scale) / 2, y0: cy - (height * scale) / 2, scale, width, height }

  function pan(dx: number, dy: number) {
    setCentre({
      x: Math.min(header.widthPx, Math.max(0, cx + dx)),
      y: Math.min(header.heightPx, Math.max(0, cy + dy)),
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (zoom === "fit") return
    const step = (event.shiftKey ? 240 : 60) * scale
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
    if (!delta) return
    event.preventDefault()
    pan(delta[0]!, delta[1]!)
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (zoom === "fit" || (event.target as Element).closest("[data-star]")) return
    drag.current = { x: event.clientX, y: event.clientY, cx, cy }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start) return
    setCentre({
      x: Math.min(header.widthPx, Math.max(0, start.cx - (event.clientX - start.x) * scale)),
      y: Math.min(header.heightPx, Math.max(0, start.cy - (event.clientY - start.y) * scale)),
    })
  }

  function selectStar(record: StarRecord) {
    setStarId(record.id)
    setStarsOn(true)
    if (mode === "corners") setMode("whole")
    if (zoom === "fit") setZoom("1")
    setCentre({ x: record.x, y: record.y })
  }

  const zoomLabel = { fit: "Fit", "1": "1:1", "2": "2:1" }[zoom]
  const visibleStars = stars.filter((s) => (s.x - window.x0) / scale >= 0 && (s.x - window.x0) / scale <= width && (s.y - window.y0) / scale >= 0 && (s.y - window.y0) / scale <= height)

  return (
    <section aria-labelledby="preview-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 id="preview-title" className="truncate text-sm font-semibold" title={asset.fileName}>
            {asset.fileName}
          </h3>
          <p className="text-xs text-muted-foreground tabular-nums">
            Frame {position.index + 1} of {position.total} · {zoomLabel}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={onPrevious} disabled={position.index <= 0} aria-keyshortcuts="k">
            <ChevronLeft aria-hidden="true" data-icon="inline-start" />
            Previous <Kbd>K</Kbd>
          </Button>
          <Button size="sm" variant="outline" onClick={onNext} disabled={position.index >= position.total - 1} aria-keyshortcuts="j">
            Next <Kbd>J</Kbd>
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        </div>
      </div>

      {unavailableReason || !field ? (
        <div className="flex aspect-[3/2] items-center justify-center rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {unavailableReason ?? "No pixel data for this file."} Header metadata and measurements below stay readable.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup value={[zoom]} onValueChange={(v) => v[0] && setZoom(v[0] as Zoom)} variant="outline" size="sm" aria-label="Zoom">
              <ToggleGroupItem value="fit">Fit</ToggleGroupItem>
              <ToggleGroupItem value="1">1:1</ToggleGroupItem>
              <ToggleGroupItem value="2">2:1</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup value={[stretch]} onValueChange={(v) => v[0] && setStretch(v[0] as Stretch)} variant="outline" size="sm" aria-label="Display stretch">
              <ToggleGroupItem value="linear">Linear</ToggleGroupItem>
              <ToggleGroupItem value="auto">Auto</ToggleGroupItem>
              <ToggleGroupItem value="strong">Strong</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup value={[mode]} onValueChange={(v) => v[0] && setMode(v[0] as "whole" | "corners")} variant="outline" size="sm" aria-label="Region">
              <ToggleGroupItem value="whole">Whole frame</ToggleGroupItem>
              <ToggleGroupItem value="corners">Centre and corners</ToggleGroupItem>
            </ToggleGroup>
            <Toggle variant="outline" size="sm" pressed={starsOn} onPressedChange={setStarsOn}>
              <Sparkles aria-hidden="true" data-icon="inline-start" />
              Stars
            </Toggle>
          </div>

          <div ref={frameRef} className="w-full">
            {mode === "whole" ? (
              <div
                role="group"
                aria-label={`Preview of ${asset.fileName}, ${zoomLabel}, ${stretch} stretch`}
                aria-describedby={helpId}
                tabIndex={0}
                onKeyDown={onKeyDown}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => {
                  drag.current = null
                }}
                className={cn("relative overflow-hidden rounded-lg border bg-black select-none", zoom !== "fit" && "cursor-grab active:cursor-grabbing")}
                style={{ height }}
              >
                {width > 0 ? <Raster field={field} window={window} stretch={stretch} className="block" /> : null}
                {starsOn ? (
                  <svg className="absolute inset-0" width={width} height={height} aria-hidden="true">
                    {visibleStars.map((s) => {
                      const x = (s.x - window.x0) / scale
                      const y = (s.y - window.y0) / scale
                      const r = Math.max(5, ((s.fwhmPx ?? 6) * 2.2) / scale)
                      return (
                        <g key={s.id} data-star onClick={() => selectStar(s)} className="cursor-pointer">
                          <circle cx={x} cy={y} r={Math.max(r, 10)} className="fill-transparent" />
                          <circle
                            cx={x}
                            cy={y}
                            r={r}
                            className={cn("fill-transparent", s.id === starId ? "stroke-primary" : s.state === "failed" ? "stroke-warning" : "stroke-success")}
                            strokeWidth={s.id === starId ? 2.5 : 1.5}
                            strokeDasharray={s.state === "failed" ? "3 2" : undefined}
                          />
                        </g>
                      )
                    })}
                  </svg>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {(["top", "middle", "bottom"] as const).flatMap((row, j) =>
                  (["left", "centre", "right"] as const).map((col, i) => {
                    const tileW = Math.floor((width - 8) / 3)
                    const tileH = Math.round(tileW * 0.66)
                    const x0 = [0, (header.widthPx - tileW) / 2, header.widthPx - tileW][i]!
                    const y0 = [0, (header.heightPx - tileH) / 2, header.heightPx - tileH][j]!
                    const name = row === "middle" && col === "centre" ? "Centre" : `${row === "middle" ? "Middle" : row === "top" ? "Top" : "Bottom"} ${col === "centre" ? "centre" : col}`
                    return (
                      <figure key={`${row}-${col}`} className="relative">
                        {tileW > 0 ? (
                          <Raster field={field} window={{ x0, y0, scale: 1, width: tileW, height: tileH }} stretch={stretch} className="block rounded-sm border" label={`${name} region at 1:1`} />
                        ) : null}
                        <figcaption className="absolute top-1 left-1 rounded-sm bg-black/70 px-1 text-[10px] text-white">{name}</figcaption>
                      </figure>
                    )
                  }),
                )}
              </div>
            )}
          </div>
          <p id={helpId} className="text-xs text-muted-foreground">
            Prototype: a synthetic preview drawn from this frame's fixture facts, not its file pixels. {zoom === "fit" ? "Choose 1:1 or 2:1 to pan by dragging or with the arrow keys." : "Drag or use the arrow keys to pan; Shift pans further."}{" "}
            {field.cfa ? `CFA ${field.cfa} mosaic plane as recorded; not debayered.` : "Mono linear data."}
            {field.invalid ? ` ${field.invalid.count} invalid samples (NaN or ±∞) are drawn red and masked from measurement.` : ""}
          </p>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={exclude.run} disabled={exclude.disabledReason !== null} aria-keyshortcuts="x" aria-describedby={`${helpId}-exclude`}>
          <CircleSlash aria-hidden="true" data-icon="inline-start" />
          {exclude.label} <Kbd>X</Kbd>
        </Button>
        <span id={`${helpId}-exclude`} className="text-xs text-muted-foreground">
          {exclude.disabledReason ?? "View scope only: the file stays on disk and library quality is unchanged."}
        </span>
      </div>

      <MetricTable record={record} state={state} applies={applies} />

      {starsOn && field ? (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Detected stars ({stars.length} brightest)</h4>
          <div className="max-h-44 overflow-y-auto rounded-lg border">
            <table className="w-full text-xs tabular-nums">
              <caption className="sr-only">Detected stars; choose one to inspect its fit</caption>
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    Star
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    Position
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    State
                  </th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">
                    FWHM
                  </th>
                </tr>
              </thead>
              <tbody>
                {stars.map((s) => (
                  <tr key={s.id} aria-current={s.id === starId ? "true" : undefined} className="border-b last:border-0 aria-[current=true]:bg-accent">
                    <th scope="row" className="px-2 py-0.5 text-left font-normal">
                      <button type="button" className="rounded-sm hover:underline" onClick={() => selectStar(s)}>
                        Star {s.id}
                      </button>
                    </th>
                    <td className="px-2 py-0.5">
                      {s.x}, {s.y}
                    </td>
                    <td className="px-2 py-0.5">{s.state === "failed" ? "Failed fit" : "Fitted"}</td>
                    <td className="px-2 py-0.5 text-right">{s.fwhmPx === null ? "Not reported" : scaleArcsec ? `${(s.fwhmPx * scaleArcsec).toFixed(2)}″` : `${s.fwhmPx} px`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {star ? <StarDetail field={field} star={star} scaleArcsec={scaleArcsec} /> : <p className="text-xs text-muted-foreground">Choose a star in the list or on the preview.</p>}
        </div>
      ) : null}

      <Collapsible className="rounded-lg border">
        <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="w-full justify-start" />}>Frame details: header, sources and copies</CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 border-t p-3">
          <section className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">Measurement provenance</h4>
            {[...(applies ? builtInMetrics(record) : []), ...importedMetricsOf(record)].length === 0 ? (
              <p className="text-sm text-muted-foreground">No measurement applies to this frame's current bytes.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {[...(applies ? builtInMetrics(record) : []), ...importedMetricsOf(record)].map((m) => (
                  <li key={`${m.source}-${m.key}`} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                    <span className="text-muted-foreground">
                      {METRIC_LABEL[m.key]} ({m.source})
                    </span>
                    <span className="[overflow-wrap:anywhere]">
                      {formatMetric(m)} · {m.unit || "no unit"} · {m.method} {m.version} · basis {m.basis}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {record?.inputSha256 ? (
              <p className="text-xs text-muted-foreground">
                Built-in input identity: sha256 <span className="font-mono">{record.inputSha256.slice(0, 16)}…</span>
                {applies ? " (matches the current bytes)" : " (earlier content; kept as history)"}
                {record.computedAt ? `, measured ${formatDateTime(record.computedAt)}` : ""}
              </p>
            ) : null}
            {record && record.history.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                History: {record.history.length} earlier {record.history.length === 1 ? "measurement" : "measurements"} for other content (
                {record.history.map((h) => `${h.inputSha256.slice(0, 8)}…`).join(", ")}).
              </p>
            ) : null}
          </section>
          <section className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">Copies (read-only; the preview never writes)</h4>
            <ul className="space-y-1">
              {copies.map((c) => (
                <li key={c.path} className="text-xs">
                  <span className="text-muted-foreground">{c.location}: </span>
                  <PathText path={c.path} className="inline" />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Current bytes: sha256 <span className="font-mono">{(file?.sha256 ?? asset.sha256).slice(0, 16)}…</span>
            </p>
          </section>
          <section className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">Header metadata</h4>
            <HeaderDetails header={header} />
          </section>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}
