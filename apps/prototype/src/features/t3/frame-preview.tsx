/**
 * Frame preview and star diagnostics (PIX-FR-03 to PIX-FR-06, D2-D3).
 * Prototype: the raster is synthetic, drawn from fixture pixel facts, and the
 * surface says so. Zoom (Fit, 1:1, 2:1), pan by drag or arrow keys, fixed
 * centre/corner comparison, previous/next frame and display stretch change
 * the preview only; measured values come from the catalog and stay identical
 * with any stretch (PIX-AC-02). Saturated stars are failed fits with no width.
 */
import { ChevronLeft, ChevronRight, CircleSlash, ImageOff, Sparkles } from "lucide-react"
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useRef, useState } from "react"
import { KeyValueList, PathText } from "@/components/app/data"
import { UnknownValue } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { PanelSection } from "@/components/app/studio"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { BUILT_IN_METHOD } from "@/domain/measurement"
import type { Asset, DiskFile, FrameHeader, FrameMeasurement, Metric, MetricKey } from "@/domain/types"
import { HEADER_KEYWORDS } from "@/domain/types"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { builtInMetrics, currentImportedMetrics, type FrameMeasureState, formatMetric, historyImportedMetrics, METRIC_LABEL } from "./measure"
import { formatMetricFixed } from "./model"
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

function MetricTable({ record, state, applies, sha256 }: { record: FrameMeasurement | undefined; state: FrameMeasureState; applies: boolean; sha256: string }) {
  const builtIn = applies ? builtInMetrics(record) : []
  const imported = currentImportedMetrics(record, sha256)
  const earlier = historyImportedMetrics(record, sha256)
  const byKey = (list: Metric[], key: MetricKey) => list.find((m) => m.key === key)
  const warning = builtIn.find((m) => m.warning)?.warning
  return (
    <div className="space-y-1.5">
      {/* B's values with their source: each value carries where it came from, built-in beside imported. */}
      <dl aria-label="Measurements of the current frame" className="grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs tabular-nums">
        {METRIC_ORDER.map((key) => {
          const own = byKey(builtIn, key)
          const other = byKey(imported, key)
          const past = other ? undefined : byKey(earlier, key)
          return (
            <div key={key} className="contents">
              <dt className="chrome pt-px text-muted-foreground">{METRIC_LABEL[key]}</dt>
              <dd className="min-w-0 space-y-0.5">
                <div>
                  {own ? formatMetricFixed(own) : <UnknownValue label={state === "pending" ? "Pending" : state === "verifying" ? "Verifying" : "Not measured"} />}
                  {own ? <span className="ml-1.5 text-2xs text-muted-foreground">built-in</span> : null}
                </div>
                {other ? (
                  <div>
                    {formatMetricFixed(other)}
                    <span className="sr-only"> {other.unit}</span>
                    <span className="ml-1.5 text-2xs text-muted-foreground">imported · content unverified</span>
                  </div>
                ) : past ? (
                  <div className="text-muted-foreground">
                    History: {formatMetricFixed(past)}
                    <span className="sr-only"> {past.unit}</span>
                    <span className="ml-1.5 text-2xs">imported for earlier content</span>
                  </div>
                ) : null}
              </dd>
            </div>
          )
        })}
      </dl>
      {imported.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <StatusBadge kind="match" value="unknown" label="Imported · content unverified" />
          <span>
            {imported[0]!.method} {imported[0]!.version} · units {[...new Set(imported.map((m) => m.unit || "none"))].join(", ")} · matched by file only; the SHA-256 noted at import detects later changes and never verifies the values.
          </span>
        </p>
      ) : earlier.length > 0 ? (
        <p className="text-xs text-muted-foreground">Imported values are history: they were imported for other content than this frame's current bytes.</p>
      ) : null}
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
    <section aria-labelledby="preview-title" className="flex flex-col">
      {/* Loupe header: the frame, where it sits in the table order, and K/J stepping. */}
      <div className="chrome flex items-center gap-1 border-b border-seam bg-panel-header px-2 py-1">
        <div className="min-w-0 flex-1">
          <h3 id="preview-title" className="truncate text-xs font-semibold" title={asset.fileName}>
            {asset.fileName}
          </h3>
          <p id={`${helpId}-position`} className="num truncate text-2xs text-muted-foreground">
            Frame {position.index + 1} of {position.total} · {zoomLabel}
            {position.total <= 1 ? " · Only frame shown" : position.index <= 0 ? " · First frame shown" : position.index >= position.total - 1 ? " · Last frame shown" : ""}
          </p>
        </div>
        <Button size="xs" variant="outline" onClick={onPrevious} disabled={position.index <= 0} focusableWhenDisabled aria-describedby={position.index <= 0 ? `${helpId}-position` : undefined} className="aria-disabled:pointer-events-none aria-disabled:opacity-50" aria-keyshortcuts="k">
          <ChevronLeft aria-hidden="true" data-icon="inline-start" />
          Previous <Kbd>K</Kbd>
        </Button>
        <Button size="xs" variant="outline" onClick={onNext} disabled={position.index >= position.total - 1} focusableWhenDisabled aria-describedby={position.index >= position.total - 1 ? `${helpId}-position` : undefined} className="aria-disabled:pointer-events-none aria-disabled:opacity-50" aria-keyshortcuts="j">
          Next <Kbd>J</Kbd>
          <ChevronRight aria-hidden="true" data-icon="inline-end" />
        </Button>
      </div>

      {unavailableReason || !field ? (
        <div className="p-2">
          <div className="rounded-md bg-mount p-1.5 shadow-[inset_0_0_0_1px_var(--mount-edge)]">
            <div className="flex aspect-[3/2] items-center justify-center rounded-sm bg-canvas p-4 text-center text-xs text-muted-foreground">
              {unavailableReason ?? "No pixel data for this file."} Header metadata and measurements below stay readable.
            </div>
          </div>
        </div>
      ) : (
        <>
          <div role="toolbar" aria-label="Preview display" className="chrome flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-seam px-2 py-1">
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

          {/* The frame as a plate on its mount (B): pixels in the dark well, the capture caption printed on the matte. */}
          <div className="p-2">
            <div className="rounded-md bg-mount p-1.5 shadow-[inset_0_0_0_1px_var(--mount-edge)]">
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
                    className={cn("relative overflow-hidden rounded-sm bg-canvas select-none", zoom !== "fit" && "cursor-grab active:cursor-grabbing")}
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
                            {tileW > 0 ? <Raster field={field} window={{ x0, y0, scale: 1, width: tileW, height: tileH }} stretch={stretch} className="block rounded-sm" label={`${name} region at 1:1`} /> : null}
                            <figcaption className="absolute top-1 left-1 rounded-sm bg-black/70 px-1 text-2xs text-white">{name}</figcaption>
                          </figure>
                        )
                      }),
                    )}
                  </div>
                )}
              </div>
              <div className="flex min-w-0 items-baseline gap-2 px-0.5 pt-1.5 text-2xs">
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {header.filter ?? "No FILTER"} · {header.exposureS} s · {formatDateTime(header.dateObs)}
                </span>
                <span className="num shrink-0 text-muted-foreground">
                  {header.widthPx} × {header.heightPx} · {STRETCH_LABEL[stretch]}
                </span>
              </div>
            </div>
            <p id={helpId} className="pt-1.5 text-2xs text-pretty text-muted-foreground">
              Prototype: a synthetic preview drawn from this frame's fixture facts, not its file pixels. {zoom === "fit" ? "Choose 1:1 or 2:1 to pan by dragging or with the arrow keys." : "Drag or use the arrow keys to pan; Shift pans further."}{" "}
              {field.cfa ? `CFA ${field.cfa} mosaic plane as recorded; not debayered.` : "Mono linear data."}
              {field.invalid ? ` ${field.invalid.count} invalid samples (NaN or ±∞) are drawn red and masked from measurement.` : ""}
            </p>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-seam px-2 pb-2">
        <Button size="sm" variant="outline" onClick={exclude.run} disabled={exclude.disabledReason !== null} focusableWhenDisabled className="aria-disabled:pointer-events-none aria-disabled:opacity-50" aria-keyshortcuts="x" aria-describedby={`${helpId}-exclude`}>
          <CircleSlash aria-hidden="true" data-icon="inline-start" />
          {exclude.label} <Kbd>X</Kbd>
        </Button>
        <span id={`${helpId}-exclude`} className="min-w-0 flex-1 text-2xs text-muted-foreground">
          {exclude.disabledReason ?? "View scope only: the file stays on disk and library quality is unchanged."}
        </span>
      </div>

      <PanelSection title="Measurements" id="frames.measurements" level={3} summary="value · source">
        <MetricTable record={record} state={state} applies={applies} sha256={asset.sha256} />
      </PanelSection>

      {field && !unavailableReason ? (
        <PanelSection title="Histogram" id="frames.histogram" level={3} summary={STRETCH_LABEL[stretch]}>
          <Histogram field={field} header={header} stretch={stretch} />
        </PanelSection>
      ) : null}

      {starsOn && field ? (
        <PanelSection title="Detected stars" level={3} summary={`${stars.length} brightest`}>
          <div className="space-y-2">
            <div className="max-h-44 overflow-y-auto rounded-sm border border-seam bg-background">
              <table className="w-full text-xs tabular-nums">
                <caption className="sr-only">Detected stars; choose one to inspect its fit</caption>
                <thead className="chrome sticky top-0 bg-panel-header text-muted-foreground">
                  <tr className="border-b border-seam">
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
                    <tr key={s.id} aria-current={s.id === starId ? "true" : undefined} className="border-b border-seam last:border-0 aria-[current=true]:bg-selected">
                      <th scope="row" className="px-2 py-0.5 text-left font-normal">
                        <button type="button" className="min-h-6 rounded-sm hover:underline" onClick={() => selectStar(s)}>
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
        </PanelSection>
      ) : null}

      <PanelSection title="Provenance and copies" id="frames.provenance" defaultOpen={false} level={3}>
        <div className="space-y-3">
          <section className="space-y-1.5">
            <h4 className="panel-title text-muted-foreground">Measurement provenance</h4>
            {[...(applies ? builtInMetrics(record) : []), ...currentImportedMetrics(record, asset.sha256)].length === 0 ? (
              <p className="text-xs text-muted-foreground">No measurement applies to this frame's current bytes.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {[...(applies ? builtInMetrics(record) : []), ...currentImportedMetrics(record, asset.sha256)].map((m) => (
                  <li key={`${m.source}-${m.key}`} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                    <span className="text-muted-foreground">
                      {METRIC_LABEL[m.key]} ({m.source})
                    </span>
                    <span className="[overflow-wrap:anywhere]">
                      {formatMetric(m)} · {m.unit || "no unit"} · {m.method} {m.version} · basis {m.basis}
                      {m.source === "imported" ? " · content unverified" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {record?.inputSha256 ? (
              <p className="text-xs text-muted-foreground">
                {builtInMetrics(record).length > 0 ? "Built-in input identity" : "Import observation"}: sha256 <span className="font-mono">{record.inputSha256.slice(0, 16)}…</span>
                {record.inputSha256 === asset.sha256 ? " (matches the current bytes)" : " (earlier content; kept as history)"}
                {record.computedAt ? `, ${builtInMetrics(record).length > 0 ? "measured" : "imported"} ${formatDateTime(record.computedAt)}` : ""}
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
            <h4 className="panel-title text-muted-foreground">Copies (read-only; the preview never writes)</h4>
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
        </div>
      </PanelSection>

      <PanelSection title="Header metadata" id="frames.header" defaultOpen={false} level={3}>
        <HeaderDetails header={header} />
      </PanelSection>
    </section>
  )
}

const STRETCH_LABEL: Record<Stretch, string> = { linear: "Linear", auto: "Auto", strong: "Strong" }
const HIST_W = 160
const HIST_BINS = 64

/**
 * Display histogram (studio inspector): counts of the preview's own pixels at
 * the current stretch, drawn on a square-root scale. It says where it comes
 * from because it is display only: values are measured on linear data.
 */
function Histogram({ field, header, stretch }: { field: StarField; header: FrameHeader; stretch: Stretch }) {
  const bins = useMemo(() => {
    const height = Math.max(1, Math.round((HIST_W * header.heightPx) / header.widthPx))
    const image = renderWindow(field, { x0: 0, y0: 0, scale: header.widthPx / HIST_W, width: HIST_W, height }, stretch)
    const counts = new Array<number>(HIST_BINS).fill(0)
    for (let i = 0; i < image.data.length; i += 4) counts[Math.floor((image.data[i]! * HIST_BINS) / 256)]! += 1
    return counts
  }, [field, header.widthPx, header.heightPx, stretch])
  const peak = Math.max(1, ...bins.map(Math.sqrt))
  const points = bins.map((count, i) => `${((i + 0.5) / HIST_BINS) * 100},${40 - (Math.sqrt(count) / peak) * 38}`).join(" ")
  return (
    <figure className="space-y-1">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="block h-16 w-full rounded-sm bg-canvas" role="img" aria-label={`Display histogram at ${STRETCH_LABEL[stretch]} stretch`}>
        {[25, 50, 75].map((x) => (
          <line key={x} x1={x} x2={x} y1={0} y2={40} className="stroke-seam" strokeWidth={0.4} vectorEffect="non-scaling-stroke" />
        ))}
        <polygon points={`0,40 ${points} 100,40`} className="fill-foreground/20 stroke-foreground/70" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="text-2xs text-muted-foreground">From this preview's pixels at {STRETCH_LABEL[stretch]} stretch · display only, not a measurement</figcaption>
    </figure>
  )
}

/** Drawn at twice the 72 px print width, so stars survive the downsample. */
const THUMB_W = 144

/**
 * One print in the frames filmstrip: the whole frame at Auto stretch, drawn
 * the first time it scrolls into view (display only, like the preview).
 */
export function FrameThumb({ asset, file }: { asset: Asset; file: DiskFile | undefined }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [seen, setSeen] = useState(false)
  const header = asset.observed
  const truth = file?.pixelTruth
  const height = Math.max(1, Math.round((THUMB_W * header.heightPx) / header.widthPx))
  useEffect(() => {
    const node = canvas.current
    if (!node || seen) return
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setSeen(true), { rootMargin: "0px 240px" })
    observer.observe(node)
    return () => observer.disconnect()
  }, [seen])
  useEffect(() => {
    if (!seen || !truth || !file) return
    const field = starField(`${asset.id}|${file.sha256}`, truth, header.widthPx, header.heightPx, header.bayerPattern)
    canvas.current?.getContext("2d")?.putImageData(renderWindow(field, { x0: 0, y0: 0, scale: header.widthPx / THUMB_W, width: THUMB_W, height }, "auto"), 0, 0)
  }, [seen, truth, file, asset.id, header, height])
  if (!truth) {
    return (
      <span className="flex size-full items-center justify-center text-muted-foreground">
        <ImageOff aria-hidden="true" className="size-3.5" />
      </span>
    )
  }
  return <canvas ref={canvas} width={THUMB_W} height={height} aria-hidden="true" className="block size-full object-cover" />
}
