/**
 * MosaicField (L2-domain; F4 decision record §2, PRJ-FR-29): the read-only
 * panel map of a mosaic Project. Each panel group sits on the tangent plane
 * around the mosaic centre, north up and east left, in hundredths of a
 * degree, at its sessions' median pointing and rotation, with each session's
 * pointing as a dot: inside its panel's field, or outside it (a session moved
 * to another panel's group). A list under the map names every panel with its
 * sessions and position, so the map holds no control and needs no Tab stop;
 * a panel none of whose sessions has a pointing reads Position unknown, and
 * an unknown field of view leaves the list alone.
 *
 * The host maps a Project's panel groups, their sessions' pointings and the
 * rig's field into the model. PlateVault neither stitches nor plans panels here: groups are made, split
 * and marked as panels where the Project's groups are edited.
 */
import { useId } from "react"
import { useMessages } from "@/app/preferences"
import { UnknownValue } from "@/components/app/feedback"
import { formatCount, formatDec, formatDegrees, formatRa } from "@/lib/format"

export interface FieldSize {
  widthDeg: number
  heightDeg: number
}

/** One panel group on the map. */
export interface MosaicFieldPanel {
  /** The group's id. */
  id: string
  /** "Panel 2", or the name the capture gave it. */
  name: string
  /** The median pointing of its sessions; null when none of them has one. */
  centre: { ra: number; dec: number } | null
  /** The median ROTATANG of its sessions; null when none is known (drawn unrotated). */
  rotationDeg: number | null
  sessions: number
  /** One more fact the host words, such as progress toward the panel's goals. */
  detail?: string
}

/** A session's pointing, inside its own panel's field or outside it. */
export interface MosaicPointing {
  /** The session's id. */
  id: string
  ra: number
  dec: number
  panelId: string
  inside: boolean
}

export interface MosaicFieldModel {
  panels: MosaicFieldPanel[]
  pointings: MosaicPointing[]
  /** The field of view of the Project's first rig with a known one; null when none is known. */
  field: FieldSize | null
}

const cosDec = (dec: number) => Math.max(0.1, Math.cos((dec * Math.PI) / 180))

/** RA difference a − b in degrees, wrapped to −180…180. */
const raDelta = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180

export interface MosaicFieldProps {
  panels: readonly MosaicFieldPanel[]
  pointings?: readonly MosaicPointing[]
  /** The rig's field of view; null when unknown, which leaves the list without a map. */
  field: FieldSize | null
}

export function MosaicField({ panels, pointings = [], field }: MosaicFieldProps) {
  const m = useMessages()
  const listId = useId()
  if (panels.length === 0) return <p className="text-muted-foreground">{m.mosaic_no_panels()}</p>
  const placed = panels.flatMap((p, i) => (p.centre ? [{ ...p, centre: p.centre, n: i + 1 }] : []))
  return (
    <div className="space-y-2" data-mosaic-field="">
      {field && placed.length > 0 ? <PanelMap placed={placed} pointings={pointings} field={field} describedBy={listId} /> : null}
      {!field ? <UnknownValue label={m.ds_fov_unknown()} /> : null}
      <ol id={listId} aria-label={m.mosaic_panels_label()} className="space-y-1 text-sm">
        {panels.map((panel, i) => (
          <li key={panel.id} className="flex flex-wrap items-baseline gap-x-2" data-mosaic-panel={panel.id}>
            <span className="w-5 shrink-0 text-right font-semibold tabular-nums">{formatCount(i + 1)}</span>
            <span className="font-medium">{panel.name}</span>
            <span className="text-muted-foreground">{m.project_sessions_count({ count: panel.sessions })}</span>
            {panel.detail ? <span className="text-muted-foreground">{panel.detail}</span> : null}
            <span className="text-muted-foreground tabular-nums">
              {panel.centre ? `${formatRa(panel.centre.ra)} · ${formatDec(panel.centre.dec)}` : m.project_search_position_unknown()}
              {panel.rotationDeg !== null ? ` · ${m.mosaic_rotation({ angle: formatDegrees(panel.rotationDeg, 0) })}` : ""}
            </span>
          </li>
        ))}
      </ol>
      {pointings.some((p) => !p.inside) ? <p className="text-xs text-muted-foreground">{m.mosaic_outside_note({ count: pointings.filter((p) => !p.inside).length })}</p> : null}
    </div>
  )
}

function PanelMap({ placed, pointings, field, describedBy }: { placed: Array<MosaicFieldPanel & { centre: { ra: number; dec: number }; n: number }>; pointings: readonly MosaicPointing[]; field: FieldSize; describedBy: string }) {
  const m = useMessages()
  const ra0 = (placed[0]!.centre.ra + placed.reduce((n, p) => n + raDelta(p.centre.ra, placed[0]!.centre.ra), 0) / placed.length + 360) % 360
  const dec0 = placed.reduce((n, p) => n + p.centre.dec, 0) / placed.length
  const project = (ra: number, dec: number) => ({ x: -raDelta(ra, ra0) * cosDec(dec0) * 100, y: -(dec - dec0) * 100 })
  const w = field.widthDeg * 100
  const h = field.heightDeg * 100
  const points = placed.map((p) => project(p.centre.ra, p.centre.dec))
  const minX = Math.min(...points.map((p) => p.x)) - w * 0.6
  const maxX = Math.max(...points.map((p) => p.x)) + w * 0.6
  const minY = Math.min(...points.map((p) => p.y)) - h * 0.6
  const maxY = Math.max(...points.map((p) => p.y)) + h * 0.6
  const unit = Math.max(maxX - minX, maxY - minY) / 100
  return (
    <svg
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      className="h-80 w-full rounded-md bg-muted/40"
      role="img"
      aria-label={m.mosaic_map_label({ count: placed.length })}
      aria-describedby={describedBy}
    >
      {placed.map((p) => {
        const c = project(p.centre.ra, p.centre.dec)
        return (
          <g key={p.id} transform={`rotate(${-(p.rotationDeg ?? 0)} ${c.x} ${c.y})`} data-mosaic-rect={p.id}>
            <rect x={c.x - w / 2} y={c.y - h / 2} width={w} height={h} strokeWidth={1.5} vectorEffect="non-scaling-stroke" className="fill-info/10 stroke-info" />
            <text x={c.x - w / 2 + unit * 2} y={c.y - h / 2 + unit * 6} fontSize={unit * 4.5} className="fill-foreground font-semibold">
              {formatCount(p.n)}
            </text>
          </g>
        )
      })}
      {pointings.map((point) => {
        const c = project(point.ra, point.dec)
        if (c.x < minX || c.x > maxX || c.y < minY || c.y > maxY) return null
        return <circle key={point.id} cx={c.x} cy={c.y} r={unit * 1.2} className={`${point.inside ? "fill-success" : "fill-warning"} stroke-background`} strokeWidth={1} vectorEffect="non-scaling-stroke" data-inside={point.inside} />
      })}
    </svg>
  )
}
