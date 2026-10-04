/**
 * Measurement plot (PIX-FR-02, D2): one point per measured frame in review
 * order. Clicking a point makes it the current frame, which the table row and
 * the preview show at once. Pointer only by design: the frame table is the
 * keyboard path to the same choice and the data-table alternative to this
 * chart (modern-web-guidance "accessibility" §6).
 */
import type { AssetId, MetricKey } from "@/domain/types"
import { cn } from "@/lib/utils"
import { formatMetric, METRIC_LABEL } from "./measure"

export interface PlotPoint {
  id: AssetId
  label: string
  value: number | null
  unit: string
  excluded: boolean
}

export function MeasurementPlot({
  points,
  metric,
  activeId,
  onSelect,
}: {
  points: PlotPoint[]
  metric: MetricKey
  activeId: AssetId | null
  onSelect: (id: AssetId) => void
}) {
  const measured = points.filter((p): p is PlotPoint & { value: number } => p.value !== null)
  const W = 960
  const H = 140
  const padL = 44
  const padB = 18
  const padT = 8
  if (measured.length === 0) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        No {METRIC_LABEL[metric]} values yet: points appear as frames are measured.
      </div>
    )
  }
  const values = measured.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (index: number) => padL + ((index + 0.5) / points.length) * (W - padL - 8)
  const y = (value: number) => padT + (1 - (value - min) / span) * (H - padT - padB)
  const unit = measured[0]!.unit
  const indexOf = new Map(points.map((p, i) => [p.id, i]))
  const active = measured.find((p) => p.id === activeId)
  return (
    <figure className="space-y-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full rounded-lg border bg-card" aria-hidden="true">
        {[min, (min + max) / 2, max].map((tick) => (
          <g key={tick}>
            <line x1={padL} x2={W - 4} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={padL - 6} y={y(tick) + 3} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {formatMetric({ value: Number(tick.toFixed(2)), unit })}
            </text>
          </g>
        ))}
        {measured.map((p) => {
          const cx = x(indexOf.get(p.id)!)
          const cy = y(p.value)
          return (
            <g key={p.id} onClick={() => onSelect(p.id)} className="cursor-pointer">
              <circle cx={cx} cy={cy} r={9} className="fill-transparent" />
              <circle
                cx={cx}
                cy={cy}
                r={p.id === activeId ? 5 : 2.6}
                className={cn(
                  p.id === activeId ? "fill-primary stroke-background" : p.excluded ? "fill-transparent stroke-muted-foreground" : "fill-foreground/70 stroke-transparent",
                  "hover:stroke-primary",
                )}
                strokeWidth={p.id === activeId ? 2 : 1.2}
              />
              <title>{`${p.label}: ${formatMetric(p)}${p.excluded ? " (excluded from View)" : ""}`}</title>
            </g>
          )
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
        <span>
          {METRIC_LABEL[metric]} by frame, review order · {measured.length} of {points.length} measured
        </span>
        <span>● included</span>
        <span>○ excluded from View</span>
        <span className="text-primary">● current frame{active ? `: ${active.label} ${formatMetric(active)}` : ""}</span>
      </figcaption>
    </figure>
  )
}
