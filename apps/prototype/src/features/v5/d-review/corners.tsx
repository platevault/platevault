/**
 * Corner inspector (work order R1 D): one frame as nine 1:1 tiles, the four
 * corners, the four edge centres and the centre, so tilt, coma and field
 * curvature show side by side. Each tile can overlay its stars' FWHM
 * (circles) and eccentricity (whiskers along the long axis), with the
 * medians of its zone (a quarter of the short side, anchored like the tile,
 * so a small tile still has enough stars); a tile softer than the centre by
 * `SOFT_RATIO` reads as a warning. Display stretch applies to the tiles; the
 * values come from the linear star fits (`regionStats`). Review swaps it in
 * for each plate, so it also works in fullscreen and in Compare.
 */
import { useMemo } from "react"
import { Raster, useSize } from "@/features/t3/frame-preview"
import { type RegionRect, type RegionStats, regionStats, type StarField, type Stretch } from "@/features/t3/raster"
import { cn } from "@/lib/utils"

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

interface Tile {
  id: string
  name: string
  rect: RegionRect
  stats: RegionStats
}

function tileName(row: (typeof ROWS)[number], col: (typeof COLS)[number]): string {
  if (row === "middle") return col === "centre" ? "Centre" : col === "left" ? "Left" : "Right"
  const edge = row === "top" ? "Top" : "Bottom"
  return col === "centre" ? edge : `${edge} ${col}`
}

/** The nine tiles of `size` source pixels, row by row from the top left, each measured over its zone. */
function cornerTiles(field: StarField, size: number): Tile[] {
  const zone = Math.max(size, Math.floor(Math.min(field.width, field.height) / 4))
  const at = (span: number, extent: number) => [0, Math.floor((extent - span) / 2), extent - span]
  return ROWS.flatMap((row, j) =>
    COLS.map((col, i) => {
      const rect = { x0: at(size, field.width)[i]!, y0: at(size, field.height)[j]!, width: size, height: size }
      const area = { x0: at(zone, field.width)[i]!, y0: at(zone, field.height)[j]!, width: zone, height: zone }
      return { id: `${row}-${col}`, name: tileName(row, col), rect, stats: regionStats(field, area, 400) }
    }),
  )
}

const fwhmText = (v: number | null) => (v === null ? "–" : `${v.toFixed(2)} px`)
const eccText = (v: number | null) => (v === null ? "–" : v.toFixed(2))

export function CornerGrid({ field, stretch, overlay, label, className }: { field: StarField; stretch: Stretch; overlay: CornerOverlay; label: string; className?: string }) {
  const [ref, size] = useSize<HTMLDivElement>()
  const fit = Math.floor((Math.min(size.width, size.height) - PAD * 2 - GAP * 2) / 3)
  const tile = Math.min(MAX_TILE, fit, Math.floor(Math.min(field.width, field.height) / 3))
  const tiles = useMemo(() => (tile >= MIN_TILE ? cornerTiles(field, tile) : []), [field, tile])
  const centre = tiles[4]?.stats.fwhmPx ?? null
  return (
    <div ref={ref} className={cn("relative min-h-0 min-w-0 flex-1 rounded-[3px] bg-mount shadow-[inset_0_0_0_1px_var(--border),0_1px_2px_oklch(0_0_0/0.22)]", className)}>
      {tiles.length > 0 ? (
        <div role="group" aria-label={`${label}, corners at 1:1`} data-corners className="absolute top-1/2 left-1/2 grid -translate-x-1/2 -translate-y-1/2 grid-cols-3" style={{ gap: GAP }}>
          {tiles.map((t) => (
            <CornerTile key={t.id} field={field} stretch={stretch} tile={t} size={tile} overlay={overlay} centre={t.id === "middle-centre" ? null : centre} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function CornerTile({ field, stretch, tile, size, overlay, centre }: { field: StarField; stretch: Stretch; tile: Tile; size: number; overlay: CornerOverlay; centre: number | null }) {
  const { rect, stats, name } = tile
  const ratio = centre !== null && stats.fwhmPx !== null ? stats.fwhmPx / centre : null
  const soft = ratio !== null && ratio >= SOFT_RATIO
  const fitted = stats.stars.filter((s) => s.state === "fitted" && s.x >= rect.x0 && s.x < rect.x0 + size && s.y >= rect.y0 && s.y < rect.y0 + size)
  const shown = overlay.fwhm || overlay.eccentricity
  return (
    <figure
      className="relative"
      style={{ width: size, height: size }}
      data-corner={tile.id}
      title={`${name}: FWHM ${fwhmText(stats.fwhmPx)}${ratio !== null ? ` (×${ratio.toFixed(2)} centre)` : ""}, eccentricity ${eccText(stats.eccentricity)}, ${stats.fitted} stars`}
    >
      <Raster
        field={field}
        window={{ ...rect, scale: 1 }}
        stretch={stretch}
        className="block rounded-[2px] bg-plate"
        label={`${name} at 1:1, FWHM ${fwhmText(stats.fwhmPx)}, eccentricity ${eccText(stats.eccentricity)}`}
      />
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
      <figcaption className="pointer-events-none absolute inset-0.5 flex flex-col justify-between text-[0.625rem] leading-4 whitespace-nowrap tabular-nums">
        <span className="self-start rounded-sm bg-background/80 px-1 text-foreground">{name}</span>
        {shown ? (
          <span className="flex flex-col items-start gap-px">
            {overlay.fwhm ? (
              <span className={cn("rounded-sm bg-background/80 px-1", soft ? "font-semibold text-warning" : "text-foreground")}>
                {soft && ratio !== null ? `${stats.fwhmPx!.toFixed(2)} ×${ratio.toFixed(2)}` : fwhmText(stats.fwhmPx)}
              </span>
            ) : null}
            {overlay.eccentricity ? <span className="rounded-sm bg-background/80 px-1 text-foreground">e {eccText(stats.eccentricity)}</span> : null}
          </span>
        ) : null}
      </figcaption>
    </figure>
  )
}
