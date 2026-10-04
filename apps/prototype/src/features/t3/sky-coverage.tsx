/**
 * Linked sky coverage (VSEL-FR-07, C1, C5). The table stays primary: this
 * figure draws the framing or mosaic panels and each session footprint in
 * the tangent plane (north up, east left). Clicking a footprint highlights its
 * row; the row's current state highlights the footprint. Mosaic footprints are
 * drawn side by side, never stitched. Pointer only: the session table is the
 * keyboard path to the same selection.
 */
import type { Footprint } from "@/domain/derive"
import { cn } from "@/lib/utils"
import type { Region } from "./model"

export interface SkyItem {
  id: string
  label: string
  footprint: Footprint | null
  pointing: { ra: number; dec: number } | null
  selected: boolean
}

const RAD = Math.PI / 180

function project(ra: number, dec: number, ra0: number, dec0: number): [number, number] {
  const d = dec * RAD
  const d0 = dec0 * RAD
  const dRa = (ra - ra0) * RAD
  const cosC = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(dRa)
  return [(Math.cos(d) * Math.sin(dRa)) / cosC / RAD, (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(dRa)) / cosC / RAD]
}

/** Corners of a rotated rectangle in tangent-plane degrees, matching `coverageFraction`. */
function corners(f: Footprint, ra0: number, dec0: number): Array<[number, number]> {
  const [cx, cy] = project(f.ra, f.dec, ra0, dec0)
  const cos = Math.cos(f.rotationDeg * RAD)
  const sin = Math.sin(f.rotationDeg * RAD)
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => {
    const x = (u! * f.widthDeg) / 2
    const y = (v! * f.heightDeg) / 2
    return [cx + x * cos - y * sin, cy + x * sin + y * cos]
  })
}

export function SkyCoverage({
  regions,
  items,
  activeId,
  onActivate,
  unknown,
}: {
  regions: Region[]
  items: SkyItem[]
  activeId: string | null
  onActivate: (id: string) => void
  /** Labels of sessions that cannot be drawn (Position unknown). */
  unknown: string[]
}) {
  const centre = regions[0] ?? items.find((i) => i.footprint)?.footprint ?? null
  if (!centre) {
    return <p className="text-sm text-muted-foreground">Nothing to draw: no framing and no session footprint is known.</p>
  }
  const { ra: ra0, dec: dec0 } = centre
  const shapes = items.map((item) => ({
    item,
    polygon: item.footprint ? corners(item.footprint, ra0, dec0) : null,
    point: item.pointing && !item.footprint ? project(item.pointing.ra, item.pointing.dec, ra0, dec0) : null,
  }))
  const regionPolys = regions.map((r) => ({ region: r, polygon: corners(r, ra0, dec0) }))
  const xs: number[] = []
  const ys: number[] = []
  for (const p of [...regionPolys.map((r) => r.polygon), ...shapes.map((s) => s.polygon ?? (s.point ? [s.point] : []))].flat()) {
    xs.push(p[0])
    ys.push(p[1])
  }
  const pad = 0.4
  const minX = Math.min(...xs) - pad
  const maxX = Math.max(...xs) + pad
  const minY = Math.min(...ys) - pad
  const maxY = Math.max(...ys) + pad
  const size = Math.max(maxX - minX, maxY - minY)
  const W = 320
  const scale = W / size
  // North up, east left: flip x so increasing RA runs to the left.
  const toSvg = ([x, y]: [number, number]) => [((maxX + minX) / 2 - x) * scale + W / 2, ((maxY + minY) / 2 - y) * scale + W / 2] as const
  const path = (polygon: Array<[number, number]>) => `${polygon.map((p, i) => `${i === 0 ? "M" : "L"}${toSvg(p).join(" ")}`).join(" ")} Z`
  const ordered = [...shapes].sort((a, b) => Number(a.item.id === activeId) - Number(b.item.id === activeId))
  const drawn = shapes.filter((s) => s.polygon || s.point).length

  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${W}`} className="aspect-square w-full max-w-sm rounded-md border bg-background" aria-hidden="true">
        {regionPolys.map(({ region, polygon }) => (
          <g key={region.name}>
            <path d={path(polygon)} className="fill-none stroke-foreground/70" strokeWidth={1.5} strokeDasharray="6 4" />
            <text x={toSvg(polygon[3]!)[0]} y={toSvg(polygon[3]!)[1] - 4} className="fill-muted-foreground text-[10px]">
              {region.name}
            </text>
          </g>
        ))}
        {ordered.map(({ item, polygon, point }) => {
          const active = item.id === activeId
          const tone = active ? "stroke-primary" : item.selected ? "stroke-primary/70" : "stroke-muted-foreground/60"
          if (polygon) {
            return (
              <path
                key={item.id}
                d={path(polygon)}
                onClick={() => onActivate(item.id)}
                className={cn("cursor-pointer", tone, active ? "fill-primary/15" : "fill-transparent hover:fill-foreground/5")}
                strokeWidth={active ? 3 : 1.25}
              >
                <title>{item.label}</title>
              </path>
            )
          }
          if (point) {
            const [x, y] = toSvg(point)
            return (
              <g key={item.id} onClick={() => onActivate(item.id)} className="cursor-pointer">
                <circle cx={x} cy={y} r={12} className="fill-transparent" />
                <circle cx={x} cy={y} r={active ? 5 : 3.5} className={cn(tone, "fill-background")} strokeWidth={active ? 2.5 : 1.5} />
                <title>{`${item.label}: pointing only`}</title>
              </g>
            )
          }
          return null
        })}
      </svg>
      <figcaption className="space-y-1 text-xs text-muted-foreground">
        <p>
          {drawn} of {items.length} sessions drawn; dashed: {regions.map((r) => r.name).join(", ") || "no framing"}. Dots are pointing-only sessions (no
          orientation, so no footprint). North up, east left. Prototype geometry.
        </p>
        {unknown.length > 0 ? <p>Not drawn, Position unknown: {unknown.join(", ")}.</p> : null}
      </figcaption>
    </figure>
  )
}
