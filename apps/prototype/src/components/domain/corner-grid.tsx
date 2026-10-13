/**
 * CornerGrid (L2-domain, plan §3.3): one frame as nine 1:1 tiles, the four
 * corners, the four edge centres and the centre, so tilt, coma and field
 * curvature show side by side. Each tile can overlay its stars' FWHM
 * (circles) and eccentricity (whiskers along the long axis), with the
 * medians of its zone (a quarter of the short side, anchored like the tile,
 * so a small tile still has enough stars); a tile softer than the centre by
 * `SOFT_RATIO` reads as a warning, with its ratio. Display stretch applies to
 * the tiles; the values come from the linear star fits (`regionStats`). The
 * host swaps it in for a plate, so it also works in fullscreen and Compare.
 */
import { useEffect, useMemo, useRef } from "react"
import { useMessages } from "@/app/preferences"
import { formatMetricFixed } from "@/domain/membership"
import { formatDecimal } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { useSize } from "@/lib/use-size"
import { cn } from "@/lib/utils"
import { type RegionRect, type RegionStats, regionStats, renderWindow, type StarField, type Stretch } from "./raster"

/** Which star overlays the tiles draw. */
export interface CornerOverlay {
  fwhm: boolean
  eccentricity: boolean
}

const ROWS = ["top", "middle", "bottom"] as const
const COLS = ["left", "centre", "right"] as const
const GAP = 4
const PAD = 8
const MIN_TILE = 48
const MAX_TILE = 320
/** A tile this much softer than the centre is flagged. */
const SOFT_RATIO = 1.2

type TileId = `${(typeof ROWS)[number]}-${(typeof COLS)[number]}`

interface Tile {
  id: TileId
  rect: RegionRect
  stats: RegionStats
}

function tileName(m: Messages, id: TileId): string {
  switch (id) {
    case "top-left":
      return m.review_tile_top_left()
    case "top-centre":
      return m.review_tile_top()
    case "top-right":
      return m.review_tile_top_right()
    case "middle-left":
      return m.review_tile_left()
    case "middle-centre":
      return m.review_tile_centre()
    case "middle-right":
      return m.review_tile_right()
    case "bottom-left":
      return m.review_tile_bottom_left()
    case "bottom-centre":
      return m.review_tile_bottom()
    case "bottom-right":
      return m.review_tile_bottom_right()
  }
}

/** The nine tiles of `size` source pixels, row by row from the top left, each measured over its zone. */
function cornerTiles(field: StarField, size: number): Tile[] {
  const zone = Math.max(size, Math.floor(Math.min(field.width, field.height) / 4))
  const at = (span: number, extent: number) => [0, Math.floor((extent - span) / 2), extent - span]
  return ROWS.flatMap((row, j) =>
    COLS.map((col, i) => {
      const rect = { x0: at(size, field.width)[i]!, y0: at(size, field.height)[j]!, width: size, height: size }
      const area = { x0: at(zone, field.width)[i]!, y0: at(zone, field.height)[j]!, width: zone, height: zone }
      return { id: `${row}-${col}` as const, rect, stats: regionStats(field, area, 400) }
    }),
  )
}

const fwhmText = (m: Messages, v: number | null) => (v === null ? "–" : formatMetricFixed(m, { value: v, unit: "px" }))
const eccText = (v: number | null) => (v === null ? "–" : formatDecimal(v, 2))

export interface CornerGridProps {
  field: StarField
  stretch: Stretch
  overlay: CornerOverlay
  /** Names the frame: "Light_0001.fits". */
  label: string
}

/** The nine tiles, centred in the space the host gives; nothing shows until a tile fits at its minimum size. */
export function CornerGrid({ field, stretch, overlay, label }: CornerGridProps) {
  const m = useMessages()
  const [ref, size] = useSize<HTMLDivElement>()
  const fit = Math.floor((Math.min(size.width, size.height) - PAD * 2 - GAP * 2) / 3)
  const tile = Math.min(MAX_TILE, fit, Math.floor(Math.min(field.width, field.height) / 3))
  const tiles = useMemo(() => (tile >= MIN_TILE ? cornerTiles(field, tile) : []), [field, tile])
  const centre = tiles[4]?.stats.fwhmPx ?? null
  return (
    <div ref={ref} className="relative min-h-0 min-w-0 flex-1 rounded-[3px] bg-mount shadow-[inset_0_0_0_1px_var(--border),0_1px_2px_oklch(0_0_0/0.22)]" data-plate-mount>
      {tiles.length > 0 ? (
        // Centred by auto margins over the whole box: a left-50% offset would cap the grid at half the width and squeeze its columns under the tiles in Compare.
        <div role="group" aria-label={m.review_corners_group({ label })} data-corners className="absolute inset-0 m-auto grid size-fit grid-cols-3 gap-1">
          {tiles.map((t) => (
            <CornerTile key={t.id} field={field} stretch={stretch} tile={t} size={tile} overlay={overlay} centre={t.id === "middle-centre" ? null : centre} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function TileRaster({ field, rect, stretch, label }: { field: StarField; rect: RegionRect; stretch: Stretch; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { x0, y0, width, height } = rect
  useEffect(() => {
    const context = canvas.current?.getContext("2d")
    if (!context || width <= 0 || height <= 0) return
    context.putImageData(renderWindow(field, { x0, y0, scale: 1, width, height }, stretch), 0, 0)
  }, [field, x0, y0, width, height, stretch])
  return <canvas ref={canvas} width={Math.max(1, width)} height={Math.max(1, height)} className="block rounded-[2px] bg-plate" role="img" aria-label={label} />
}

function CornerTile({ field, stretch, tile, size, overlay, centre }: { field: StarField; stretch: Stretch; tile: Tile; size: number; overlay: CornerOverlay; centre: number | null }) {
  const m = useMessages()
  const { rect, stats } = tile
  const name = tileName(m, tile.id)
  const fwhm = fwhmText(m, stats.fwhmPx)
  const ecc = eccText(stats.eccentricity)
  const ratio = centre !== null && stats.fwhmPx !== null ? stats.fwhmPx / centre : null
  const soft = ratio !== null && ratio >= SOFT_RATIO
  const fitted = stats.stars.filter((s) => s.state === "fitted" && s.x >= rect.x0 && s.x < rect.x0 + size && s.y >= rect.y0 && s.y < rect.y0 + size)
  const shown = overlay.fwhm || overlay.eccentricity
  return (
    <figure className="relative" style={{ width: size, height: size }} data-corner={tile.id}>
      <TileRaster field={field} rect={rect} stretch={stretch} label={ratio !== null ? m.review_tile_label_ratio({ name, fwhm, ecc, ratio: formatRatio(ratio) }) : m.review_tile_label({ name, fwhm, ecc })} />
      {shown ? (
        <svg className="pointer-events-none absolute inset-0" width={size} height={size} aria-hidden="true">
          {fitted.map((s) => {
            const x = s.x - rect.x0
            const y = s.y - rect.y0
            const half = (3 + (s.eccentricity ?? 0) * 26) / 2
            const a = ((s.angleDeg ?? 0) * Math.PI) / 180
            return (
              <g key={s.id}>
                {overlay.fwhm ? <circle cx={x} cy={y} r={s.fwhmPx ?? 0} className="fill-transparent stroke-info" strokeWidth={1} /> : null}
                {overlay.eccentricity ? (
                  <line x1={x - Math.cos(a) * half} y1={y - Math.sin(a) * half} x2={x + Math.cos(a) * half} y2={y + Math.sin(a) * half} className="stroke-warning" strokeWidth={1.5} strokeLinecap="round" />
                ) : null}
              </g>
            )
          })}
        </svg>
      ) : null}
      <figcaption aria-hidden="true" className="pointer-events-none absolute inset-0.5 flex flex-col justify-between text-xs whitespace-nowrap tabular-nums">
        <span className="max-w-full self-start truncate rounded-sm bg-background/80 px-1 text-foreground">{name}</span>
        {shown ? (
          <span className="flex flex-col items-start gap-px">
            {overlay.fwhm ? <span className={cn("rounded-sm bg-background/80 px-1", soft ? "font-semibold text-warning" : "text-foreground")}>{soft && ratio !== null ? m.review_tile_soft({ fwhm, ratio: formatRatio(ratio) }) : fwhm}</span> : null}
            {overlay.eccentricity ? <span className="rounded-sm bg-background/80 px-1 text-foreground">{m.review_tile_ecc({ value: ecc })}</span> : null}
          </span>
        ) : null}
      </figcaption>
    </figure>
  )
}

function formatRatio(ratio: number): string {
  return formatDecimal(ratio, 2)
}
