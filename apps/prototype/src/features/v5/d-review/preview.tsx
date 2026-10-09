/**
 * S6 Review preview (D-W13, PIX-FR-03, PIX-FR-05): the frame plate on its
 * mount (HARNESS-V4 Direction B), with zoom (Fit, 1:1, 2:1), pan by drag or
 * arrow keys and display stretch held by the review, so Compare can link two
 * plates to one zoom and centre. Also the linear histogram and the fixed
 * centre-and-corner regions at 1:1. Prototype: the raster is synthetic and
 * the caption says so; display stretch never reaches a measurement.
 */
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef } from "react"
import { Raster, useSize } from "@/features/t3/frame-preview"
import { detectedStars, linearHistogram, type StarField, type StarRecord, type Stretch, type ViewWindow } from "@/features/t3/raster"
import { cn } from "@/lib/utils"

export type Zoom = "fit" | "1" | "2"
export const ZOOM_LABEL: Record<Zoom, string> = { fit: "Fit", "1": "1:1", "2": "2:1" }
export const STRETCH_LABEL: Record<Stretch, string> = { linear: "Linear", auto: "Auto", strong: "Strong" }

export interface PlateView {
  zoom: Zoom
  /** Source pixel at the plate centre when zoomed; null centres the frame. */
  centre: { x: number; y: number } | null
  stretch: Stretch
}

const MOUNT_PAD = 8

export function plateWindow(field: StarField, width: number, height: number, view: PlateView): ViewWindow {
  if (view.zoom === "fit") {
    const scale = Math.max(field.width / Math.max(1, width), field.height / Math.max(1, height))
    return { x0: 0, y0: 0, scale, width: Math.max(1, Math.floor(field.width / scale)), height: Math.max(1, Math.floor(field.height / scale)) }
  }
  const scale = view.zoom === "1" ? 1 : 0.5
  const w = Math.max(1, Math.min(width, Math.floor(field.width / scale)))
  const h = Math.max(1, Math.min(height, Math.floor(field.height / scale)))
  const cx = view.centre?.x ?? field.width / 2
  const cy = view.centre?.y ?? field.height / 2
  const x0 = Math.min(field.width - w * scale, Math.max(0, cx - (w * scale) / 2))
  const y0 = Math.min(field.height - h * scale, Math.max(0, cy - (h * scale) / 2))
  return { x0, y0, scale, width: w, height: h }
}

export function clampCentre(field: StarField, x: number, y: number) {
  return { x: Math.min(field.width, Math.max(0, x)), y: Math.min(field.height, Math.max(0, y)) }
}

/**
 * One plate. `onView` receives pan changes; the parent owns the view so a
 * second plate (Compare) follows the same zoom and centre.
 */
export function Plate({
  field,
  view,
  onView,
  label,
  starsOn,
  starId,
  onStar,
  className,
  describedBy,
  onWindow,
}: {
  field: StarField
  view: PlateView
  onView: (view: PlateView) => void
  label: string
  starsOn: boolean
  starId: number | null
  onStar: (star: StarRecord) => void
  className?: string
  describedBy?: string
  /** Reports the region shown, for the histogram. */
  onWindow?: (window: ViewWindow) => void
}) {
  const [mountRef, size] = useSize<HTMLDivElement>()
  const win = plateWindow(field, size.width - MOUNT_PAD * 2, size.height - MOUNT_PAD * 2, view)
  const { x0, y0, scale, width, height } = win
  useEffect(() => {
    if (width > 1 && height > 1) onWindow?.({ x0, y0, scale, width, height })
  }, [x0, y0, scale, width, height, onWindow])
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null)
  const stars = useMemo(() => (starsOn ? detectedStars(field) : []), [field, starsOn])
  const centre = { x: win.x0 + (win.width * win.scale) / 2, y: win.y0 + (win.height * win.scale) / 2 }

  function pan(dx: number, dy: number) {
    onView({ ...view, centre: clampCentre(field, centre.x + dx, centre.y + dy) })
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (view.zoom === "fit") return
    const step = (event.shiftKey ? 240 : 60) * win.scale
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    pan(delta[0]!, delta[1]!)
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (view.zoom === "fit" || (event.target as Element).closest("[data-star]")) return
    drag.current = { x: event.clientX, y: event.clientY, cx: centre.x, cy: centre.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start) return
    onView({ ...view, centre: clampCentre(field, start.cx - (event.clientX - start.x) * win.scale, start.cy - (event.clientY - start.y) * win.scale) })
  }
  const visibleStars = stars.filter((s) => (s.x - win.x0) / win.scale >= 0 && (s.x - win.x0) / win.scale <= win.width && (s.y - win.y0) / win.scale >= 0 && (s.y - win.y0) / win.scale <= win.height)
  return (
    <div ref={mountRef} className={cn("relative min-h-0 min-w-0 flex-1 rounded-[3px] bg-mount shadow-[inset_0_0_0_1px_var(--border),0_1px_2px_oklch(0_0_0/0.22)]", className)}>
      {size.width > MOUNT_PAD * 2 && size.height > MOUNT_PAD * 2 ? (
        <div
          role="group"
          data-plate
          aria-label={`${label}, ${ZOOM_LABEL[view.zoom]}, ${STRETCH_LABEL[view.stretch]} stretch`}
          aria-describedby={describedBy}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            drag.current = null
          }}
          className={cn(
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[2px] bg-plate shadow-[0_0_0_1px_oklch(0_0_0/0.35)] select-none",
            view.zoom !== "fit" && "cursor-grab active:cursor-grabbing",
          )}
          style={{ width: win.width, height: win.height }}
        >
          <Raster field={field} window={win} stretch={view.stretch} className="block" />
          {starsOn ? (
            <svg className="absolute inset-0" width={win.width} height={win.height} aria-hidden="true">
              {visibleStars.map((s) => {
                const x = (s.x - win.x0) / win.scale
                const y = (s.y - win.y0) / win.scale
                const r = Math.max(5, ((s.fwhmPx ?? 6) * 2.2) / win.scale)
                return (
                  <g key={s.id} data-star onClick={() => onStar(s)} className="cursor-pointer">
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
      ) : null}
    </div>
  )
}

/** Histogram of the displayed region's linear data; the median marks the sky background. */
export function HistogramView({ field, window }: { field: StarField; window: ViewWindow }) {
  const { x0, y0, scale, width, height } = window
  const h = useMemo(() => linearHistogram(field, { x0, y0, scale, width, height }), [field, x0, y0, scale, width, height])
  const max = Math.max(1, ...h.bins.map((c) => Math.log1p(c)))
  const W = 240
  const H = 56
  const bw = W / h.bins.length
  const medianX = (h.median / h.rangeMax) * W
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-full rounded-sm bg-plate" role="img" aria-label={`Histogram of linear data, median ${Math.round(h.median)} ADU`}>
        {h.bins.map((count, i) => {
          const bh = (Math.log1p(count) / max) * (H - 4)
          return <rect key={i} x={i * bw} y={H - bh} width={Math.max(0.5, bw - 0.3)} height={bh} className="fill-foreground/55" />
        })}
        <line x1={medianX} x2={medianX} y1={0} y2={H} className="stroke-link" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="text-[0.6875rem] leading-4 text-muted-foreground tabular-nums">
        Linear ADU 0–{Math.round(h.rangeMax).toLocaleString("en-GB")} · median {Math.round(h.median).toLocaleString("en-GB")} · MAD {Math.round(h.mad)} · {h.above.toLocaleString("en-GB")} brighter
        {h.saturated > 0 ? ` · ${h.saturated} saturated` : ""}
        {h.invalid > 0 ? ` · ${h.invalid} invalid` : ""} · log counts, {h.samples.toLocaleString("en-GB")} samples of the region shown
      </figcaption>
    </figure>
  )
}

const REGION_ROWS = ["top", "middle", "bottom"] as const
const REGION_COLS = ["left", "centre", "right"] as const

/** The centre and the four corners (and edges) at 1:1, the same place in every frame (PIX-FR-03). */
export function RegionGrid({ field, stretch, tile = 84 }: { field: StarField; stretch: Stretch; tile?: number }) {
  return (
    <div className="grid grid-cols-3 gap-1" role="group" aria-label="Centre, edges and corners at 1:1">
      {REGION_ROWS.flatMap((row, j) =>
        REGION_COLS.map((col, i) => {
          const x0 = [0, (field.width - tile) / 2, field.width - tile][i]!
          const y0 = [0, (field.height - tile) / 2, field.height - tile][j]!
          const name = row === "middle" && col === "centre" ? "Centre" : `${row === "middle" ? "Middle" : row === "top" ? "Top" : "Bottom"} ${col}`
          return (
            <figure key={`${row}-${col}`} className="relative">
              <Raster field={field} window={{ x0, y0, scale: 1, width: tile, height: tile }} stretch={stretch} className="block aspect-square w-full rounded-[2px] bg-plate" label={`${name} region at 1:1`} />
              <figcaption className="absolute top-0.5 left-0.5 rounded-sm bg-black/70 px-1 text-[0.625rem] text-white">{name}</figcaption>
            </figure>
          )
        }),
      )}
    </div>
  )
}
