/**
 * Plate (L2-domain, plan §3.3): one frame on its mount (HARNESS-V4
 * Direction B), at Fit, 1:1 or 2:1, with pan by drag or arrow keys and an
 * optional star overlay. It takes the raster as data (`PlateImage`), so the
 * plate knows nothing about how pixels are made, and the host owns the view,
 * so two plates (Compare) can follow one zoom and centre.
 *
 * Zoom on the plate itself (user item 49): the mouse wheel steps the zoom
 * at the pointer, a click at Fit zooms to 1:1 at the clicked point, and
 * + and − step it from the keyboard. The controls for zoom and stretch come
 * from the host (a DisplayMenu or a toggle group), never from the plate.
 *
 * Cursor readout (R9-PIXINSIGHT-STATS §3c): `onReadout` reports the source
 * pixel under the pointer while it hovers, and null when it leaves; the host
 * reads the linear value there and shows it in its caption.
 */
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef } from "react"
import { useMessages } from "@/app/preferences"
import { m } from "@/lib/i18n"
import { useSize } from "@/lib/use-size"
import { cn } from "@/lib/utils"

export type Zoom = "fit" | "1" | "2"
/** Display transfer only; a measurement never sees it. */
export type Stretch = "linear" | "auto" | "strong"

/** The zoom levels in order, out to in. */
export const ZOOMS: readonly Zoom[] = ["fit", "1", "2"]
export const STRETCHES: readonly Stretch[] = ["linear", "auto", "strong"]

/** Getters, so every read is in the chosen language. The ratios read the same in every language. */
export const ZOOM_LABEL: Record<Zoom, string> = {
  get fit() {
    return m.review_zoom_fit()
  },
  "1": "1:1",
  "2": "2:1",
}
export const STRETCH_LABEL: Record<Stretch, string> = {
  get linear() {
    return m.review_stretch_linear()
  },
  get auto() {
    return m.review_stretch_auto()
  },
  get strong() {
    return m.review_stretch_strong()
  },
}

export interface PlateView {
  zoom: Zoom
  /** Source pixel at the plate centre when zoomed; null centres the frame. */
  centre: { x: number; y: number } | null
  stretch: Stretch
}

/** The source region a plate shows and how it maps to canvas pixels. */
export interface ViewWindow {
  /** Source pixel at the canvas origin. */
  x0: number
  y0: number
  /** Source pixels per canvas pixel: > 1 when the whole frame is fitted, 1 at 1:1, 0.5 at 2:1. */
  scale: number
  width: number
  height: number
}

/**
 * The pixels of one frame. `render` draws a window of it at a stretch; the
 * plate calls it when the window or the stretch changes, so keep the object
 * stable (memoise it on the frame).
 */
export interface PlateImage {
  width: number
  height: number
  render: (window: ViewWindow, stretch: Stretch) => ImageData
}

/** A detected star, drawn as a ring sized by its FWHM; a failed fit is dashed. */
export interface PlateStar {
  id: number
  x: number
  y: number
  fwhmPx: number | null
  state: "fitted" | "failed"
}

const MOUNT_PAD = 8
/** Wheel travel (px) per zoom step, so a trackpad's many small events step once. */
const WHEEL_STEP = 60
/** Pointer travel (px) below which a press counts as a click, not a drag. */
const CLICK_SLOP = 4

export function plateWindow(image: Pick<PlateImage, "width" | "height">, width: number, height: number, view: PlateView): ViewWindow {
  if (view.zoom === "fit") {
    const scale = Math.max(image.width / Math.max(1, width), image.height / Math.max(1, height))
    return { x0: 0, y0: 0, scale, width: Math.max(1, Math.floor(image.width / scale)), height: Math.max(1, Math.floor(image.height / scale)) }
  }
  const scale = view.zoom === "1" ? 1 : 0.5
  const w = Math.max(1, Math.min(width, Math.floor(image.width / scale)))
  const h = Math.max(1, Math.min(height, Math.floor(image.height / scale)))
  const cx = view.centre?.x ?? image.width / 2
  const cy = view.centre?.y ?? image.height / 2
  const x0 = Math.min(image.width - w * scale, Math.max(0, cx - (w * scale) / 2))
  const y0 = Math.min(image.height - h * scale, Math.max(0, cy - (h * scale) / 2))
  return { x0, y0, scale, width: w, height: h }
}

export function clampCentre(image: Pick<PlateImage, "width" | "height">, x: number, y: number) {
  return { x: Math.min(image.width, Math.max(0, x)), y: Math.min(image.height, Math.max(0, y)) }
}

/** The next zoom level in (`1`) or out (`-1`), staying at the ends. */
export function zoomStep(zoom: Zoom, direction: 1 | -1): Zoom {
  const index = ZOOMS.indexOf(zoom) + direction
  return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, index))]!
}

function Raster({ image, window, stretch }: { image: PlateImage; window: ViewWindow; stretch: Stretch }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { x0, y0, scale, width, height } = window
  // Primitive deps: the parent rebuilds the window object every render; the pixels only change with these.
  useEffect(() => {
    const context = canvas.current?.getContext("2d")
    if (!context || width <= 0 || height <= 0) return
    context.putImageData(image.render({ x0, y0, scale, width, height }, stretch), 0, 0)
  }, [image, x0, y0, scale, width, height, stretch])
  return <canvas ref={canvas} width={Math.max(1, width)} height={Math.max(1, height)} className="block" />
}

export interface PlateProps<S extends PlateStar> {
  image: PlateImage
  view: PlateView
  /** Pan and zoom changes; the host owns the view. */
  onView: (view: PlateView) => void
  /** Names the frame: "Light_0001.fits". */
  label: string
  /** The star overlay; omit to hide it. */
  stars?: readonly S[]
  starId?: number | null
  onStar?: (star: S) => void
  className?: string
  describedBy?: string
  /** Reports the region shown, for the histogram. */
  onWindow?: (window: ViewWindow) => void
  /** The whole source pixel under the pointer while it hovers the plate; null when it leaves. */
  onReadout?: (point: { x: number; y: number } | null) => void
}

/** One plate. The ring of the chosen star is drawn in the primary colour. */
export function Plate<S extends PlateStar>({ image, view, onView, label, stars, starId = null, onStar, className, describedBy, onWindow, onReadout }: PlateProps<S>) {
  const msgs = useMessages()
  const [mountRef, size] = useSize<HTMLDivElement>()
  const plateRef = useRef<HTMLDivElement>(null)
  const win = plateWindow(image, size.width - MOUNT_PAD * 2, size.height - MOUNT_PAD * 2, view)
  const { x0, y0, scale, width, height } = win
  useEffect(() => {
    if (width > 1 && height > 1) onWindow?.({ x0, y0, scale, width, height })
  }, [x0, y0, scale, width, height, onWindow])
  const press = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null)
  const centre = { x: win.x0 + (win.width * win.scale) / 2, y: win.y0 + (win.height * win.scale) / 2 }

  /** The source pixel under a client point. */
  function sourceAt(clientX: number, clientY: number) {
    const rect = plateRef.current?.getBoundingClientRect()
    if (!rect) return centre
    return clampCentre(image, win.x0 + (clientX - rect.left) * win.scale, win.y0 + (clientY - rect.top) * win.scale)
  }
  function zoomTo(zoom: Zoom, at: { x: number; y: number }) {
    if (zoom === view.zoom) return
    onView({ ...view, zoom, centre: zoom === "fit" ? null : at })
  }

  // The wheel listener must be non-passive to keep the page from scrolling; React's onWheel is passive.
  const wheel = useRef<(event: WheelEvent) => void>(() => {})
  const travel = useRef(0)
  wheel.current = (event: WheelEvent) => {
    event.preventDefault()
    travel.current += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
    if (Math.abs(travel.current) < WHEEL_STEP) return
    const direction = travel.current < 0 ? 1 : -1
    travel.current = 0
    zoomTo(zoomStep(view.zoom, direction), sourceAt(event.clientX, event.clientY))
  }
  useEffect(() => {
    const element = mountRef.current
    if (!element) return
    const listener = (event: WheelEvent) => wheel.current(event)
    element.addEventListener("wheel", listener, { passive: false })
    return () => element.removeEventListener("wheel", listener)
  }, [mountRef])

  function pan(dx: number, dy: number) {
    onView({ ...view, centre: clampCentre(image, centre.x + dx, centre.y + dy) })
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault()
      event.stopPropagation()
      zoomTo(zoomStep(view.zoom, event.key === "-" ? -1 : 1), centre)
      return
    }
    if (view.zoom === "fit") return
    const step = (event.shiftKey ? 240 : 60) * win.scale
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    pan(delta[0]!, delta[1]!)
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest("[data-star]")) return
    press.current = { x: event.clientX, y: event.clientY, cx: centre.x, cy: centre.y, moved: false }
    if (view.zoom !== "fit") event.currentTarget.setPointerCapture(event.pointerId)
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (onReadout) {
      const at = sourceAt(event.clientX, event.clientY)
      onReadout({ x: Math.min(image.width - 1, Math.floor(at.x)), y: Math.min(image.height - 1, Math.floor(at.y)) })
    }
    const start = press.current
    if (!start) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) start.moved = true
    if (view.zoom === "fit" || !start.moved) return
    onView({ ...view, centre: clampCentre(image, start.cx - (event.clientX - start.x) * win.scale, start.cy - (event.clientY - start.y) * win.scale) })
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = press.current
    press.current = null
    if (start && !start.moved && view.zoom === "fit") zoomTo("1", sourceAt(event.clientX, event.clientY))
  }

  const shown = useMemo(
    () => (stars ?? []).filter((s) => (s.x - x0) / scale >= 0 && (s.x - x0) / scale <= width && (s.y - y0) / scale >= 0 && (s.y - y0) / scale <= height),
    [stars, x0, y0, scale, width, height],
  )
  return (
    <div ref={mountRef} className={cn("relative min-h-0 min-w-0 flex-1 rounded-[3px] bg-mount shadow-[inset_0_0_0_1px_var(--border),0_1px_2px_oklch(0_0_0/0.22)]", className)} data-plate-mount>
      {size.width > MOUNT_PAD * 2 && size.height > MOUNT_PAD * 2 ? (
        <div
          ref={plateRef}
          role="group"
          data-plate
          aria-label={msgs.review_plate_label({ label, zoom: ZOOM_LABEL[view.zoom], stretch: STRETCH_LABEL[view.stretch] })}
          aria-describedby={describedBy}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            press.current = null
          }}
          onPointerLeave={() => onReadout?.(null)}
          className={cn(
            "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[2px] bg-plate shadow-[0_0_0_1px_oklch(0_0_0/0.35)] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
            view.zoom === "fit" ? "cursor-zoom-in" : "cursor-grab active:cursor-grabbing",
          )}
          style={{ width: win.width, height: win.height }}
        >
          <Raster image={image} window={win} stretch={view.stretch} />
          {stars ? (
            <svg className="absolute inset-0" width={win.width} height={win.height} aria-hidden="true">
              {shown.map((s) => {
                const x = (s.x - x0) / scale
                const y = (s.y - y0) / scale
                const r = Math.max(5, ((s.fwhmPx ?? 6) * 2.2) / scale)
                return (
                  <g key={s.id} data-star onClick={() => onStar?.(s)} className={onStar ? "cursor-pointer" : undefined}>
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
