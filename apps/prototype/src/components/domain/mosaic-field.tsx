/**
 * MosaicField (L2-domain, plan §3.3): a mosaic's panels and free slots on
 * the tangent plane around the mosaic centre, north up and east left, in
 * hundredths of a degree, with the sessions' pointings as dots. A copy of
 * `b-projects/mosaic-editor.tsx` FieldView, which stays until W4.
 *
 * Each panel is a checkbox (click, Enter or Space includes or excludes it)
 * and a drop target for a dragged session; each free slot is a button that
 * adds a panel there.
 */
import type { DragEvent, KeyboardEvent } from "react"
import { useMessages } from "@/app/preferences"
import type { Messages } from "@/lib/i18n"

/** The drag type a session row sets so a panel accepts it. */
export const SESSION_DRAG_TYPE = "application/x-pv-session"

/** Panels overlap by 10% of the field. */
const STEP = 0.9

export type MosaicSide = "east" | "west" | "north" | "south"

export interface MosaicFieldPanel {
  id: string
  /** The panel number shown in its corner. */
  n: number
  ra: number
  dec: number
  rotationDeg: number
  include: boolean
}

export interface MosaicSlot {
  key: string
  ra: number
  dec: number
  /** The panel number the slot sits beside, and on which side. */
  beside: number
  side: MosaicSide
}

/** A session's pointing: on an included panel, flagged (several panels or none), or not placed. */
export interface MosaicPointing {
  id: string
  ra: number
  dec: number
  state: "placed" | "flagged" | "unplaced"
}

export interface FieldSize {
  widthDeg: number
  heightDeg: number
}

const cosDec = (dec: number) => Math.max(0.1, Math.cos((dec * Math.PI) / 180))

export function mosaicSideWord(m: Messages, side: MosaicSide): string {
  const word: Record<MosaicSide, () => string> = { east: m.mosaic_side_east, west: m.mosaic_side_west, north: m.mosaic_side_north, south: m.mosaic_side_south }
  return word[side]()
}

/** Unoccupied neighbour slots east, west, north and south of each panel. */
export function mosaicFreeSlots(panels: readonly Pick<MosaicFieldPanel, "n" | "ra" | "dec">[], fov: FieldSize): MosaicSlot[] {
  const out: MosaicSlot[] = []
  const near = (ra: number, dec: number) =>
    panels.some((p) => Math.abs(((p.ra - ra + 540) % 360) - 180) * cosDec(dec) < fov.widthDeg * 0.5 && Math.abs(p.dec - dec) < fov.heightDeg * 0.5) ||
    out.some((s) => Math.abs(((s.ra - ra + 540) % 360) - 180) * cosDec(dec) < fov.widthDeg * 0.5 && Math.abs(s.dec - dec) < fov.heightDeg * 0.5)
  for (const p of panels) {
    const dRa = (fov.widthDeg * STEP) / cosDec(p.dec)
    for (const [side, ra, dec] of [
      ["east", p.ra + dRa, p.dec],
      ["west", p.ra - dRa, p.dec],
      ["north", p.ra, p.dec + fov.heightDeg * STEP],
      ["south", p.ra, p.dec - fov.heightDeg * STEP],
    ] as const) {
      const r = Number(((ra + 360) % 360).toFixed(3))
      const d = Number(dec.toFixed(3))
      if (!near(r, d)) out.push({ ra: r, dec: d, key: `${r}|${d}`, beside: p.n, side })
    }
  }
  return out
}

const POINTING_TONE: Record<MosaicPointing["state"], string> = {
  placed: "fill-success",
  flagged: "fill-warning",
  unplaced: "fill-muted-foreground",
}

export interface MosaicFieldProps {
  panels: readonly MosaicFieldPanel[]
  /** Free slots to offer; empty while the host is not adding panels. */
  slots?: readonly MosaicSlot[]
  field: FieldSize
  pointings?: readonly MosaicPointing[]
  /** The panel a session is being dragged over. */
  dropOn?: string | null
  onDropOnChange?: (panelId: string | null) => void
  onToggle: (panelId: string) => void
  onAdd?: (ra: number, dec: number) => void
  /** A session (its id, from `SESSION_DRAG_TYPE`) was dropped on an included panel. */
  onDropSession?: (sessionId: string, panelId: string) => void
}

export function MosaicField({ panels, slots = [], field, pointings = [], dropOn = null, onDropOnChange, onToggle, onAdd, onDropSession }: MosaicFieldProps) {
  const m = useMessages()
  if (panels.length === 0) return null
  const ra0 = panels.reduce((n, p) => n + p.ra, 0) / panels.length
  const dec0 = panels.reduce((n, p) => n + p.dec, 0) / panels.length
  const project = (ra: number, dec: number) => {
    let d = ra - ra0
    if (d > 180) d -= 360
    if (d < -180) d += 360
    return { x: -d * cosDec(dec0) * 100, y: -(dec - dec0) * 100 }
  }
  const w = field.widthDeg * 100
  const h = field.heightDeg * 100
  const points = [...panels, ...slots].map((p) => project(p.ra, p.dec))
  const minX = Math.min(...points.map((p) => p.x)) - w * 0.6
  const maxX = Math.max(...points.map((p) => p.x)) + w * 0.6
  const minY = Math.min(...points.map((p) => p.y)) - h * 0.6
  const maxY = Math.max(...points.map((p) => p.y)) + h * 0.6
  const unit = Math.max(maxX - minX, maxY - minY) / 100
  const key = (event: KeyboardEvent, act: () => void) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      act()
    }
  }
  const accepts = (event: DragEvent) => event.dataTransfer.types.includes(SESSION_DRAG_TYPE)
  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="h-80 w-full rounded-md bg-muted/40" role="group" aria-label={m.mosaic_field_label()} data-mosaic-field>
      {onAdd
        ? slots.map((s) => {
            const c = project(s.ra, s.dec)
            return (
              <g
                key={s.key}
                role="button"
                tabIndex={0}
                aria-label={m.mosaic_add_slot({ side: mosaicSideWord(m, s.side), n: s.beside })}
                className="cursor-pointer opacity-40 outline-none hover:opacity-90 focus-visible:opacity-100"
                onClick={() => onAdd(s.ra, s.dec)}
                onKeyDown={(e) => key(e, () => onAdd(s.ra, s.dec))}
              >
                <rect x={c.x - w / 2} y={c.y - h / 2} width={w} height={h} className="fill-transparent stroke-muted-foreground" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central" fontSize={unit * 8} className="fill-muted-foreground">
                  +
                </text>
              </g>
            )
          })
        : null}
      {panels.map((p) => {
        const c = project(p.ra, p.dec)
        const over = dropOn === p.id
        return (
          <g
            key={p.id}
            role="checkbox"
            aria-checked={p.include}
            aria-label={m.common_panel_n({ n: p.n })}
            tabIndex={0}
            transform={`rotate(${-p.rotationDeg} ${c.x} ${c.y})`}
            className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-ring"
            onClick={() => onToggle(p.id)}
            onKeyDown={(e) => key(e, () => onToggle(p.id))}
            onDragOver={(event) => {
              if (!p.include || !onDropSession || !accepts(event)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = "move"
              onDropOnChange?.(p.id)
            }}
            onDragLeave={() => onDropOnChange?.(null)}
            onDrop={(event) => {
              const sessionId = event.dataTransfer.getData(SESSION_DRAG_TYPE)
              if (p.include && sessionId && onDropSession) {
                event.preventDefault()
                onDropSession(sessionId, p.id)
              }
              onDropOnChange?.(null)
            }}
          >
            <rect
              x={c.x - w / 2}
              y={c.y - h / 2}
              width={w}
              height={h}
              strokeWidth={over ? 3 : 1.5}
              strokeDasharray={p.include ? undefined : "6 4"}
              vectorEffect="non-scaling-stroke"
              className={p.include ? (over ? "fill-info/25 stroke-info" : "fill-info/10 stroke-info") : "fill-transparent stroke-muted-foreground"}
            />
            <text x={c.x - w / 2 + unit * 2} y={c.y - h / 2 + unit * 6} fontSize={unit * 4.5} className={p.include ? "fill-foreground font-semibold" : "fill-muted-foreground"}>
              {p.n}
              {p.include ? "" : ` · ${m.mosaic_excluded()}`}
            </text>
          </g>
        )
      })}
      {pointings.map((point) => {
        const c = project(point.ra, point.dec)
        if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) return null
        return <circle key={point.id} cx={c.x} cy={c.y} r={unit * 1.2} className={`${POINTING_TONE[point.state]} pointer-events-none stroke-background`} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      })}
    </svg>
  )
}
