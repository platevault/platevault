/**
 * Plots across the session (D-W13, PIX-FR-02, PIX-FR-15): FWHM, HFR,
 * eccentricity, star count and background over the frame sequence, in the
 * bottom strip. Clicking a point makes that frame current; selected frames
 * are highlighted; while threshold selection is open, the threshold shows as
 * a line and clicking a plot's background sets its value from there. Pointer
 * only by design: the frame list is the keyboard path to the same choices.
 */
import type { AssetId, MetricKey } from "@/domain/types"
import { useSize } from "@/features/t3/frame-preview"
import { formatMetric, METRIC_LABEL } from "@/features/t3/measure"
import { cn } from "@/lib/utils"
import { PLOT_METRICS, type ReviewFrame } from "./model"

export interface Threshold {
  metric: MetricKey
  direction: "above" | "below"
  value: number | null
}

const PAD_L = 40
const PAD_R = 6
const PAD_T = 8
const PAD_B = 8

function Dot({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 8 8" className="mr-1 inline size-2 align-baseline" aria-hidden="true">
      <circle cx={4} cy={4} r={3} className={className} strokeWidth={1.2} />
    </svg>
  )
}

function MetricPlot({
  metric,
  frames,
  activeId,
  selected,
  threshold,
  onSelect,
  onThreshold,
}: {
  metric: MetricKey
  frames: ReviewFrame[]
  activeId: AssetId | null
  selected: Set<AssetId>
  threshold: Threshold | null
  onSelect: (id: AssetId) => void
  onThreshold: ((metric: MetricKey, value: number) => void) | null
}) {
  const [ref, size] = useSize<HTMLDivElement>()
  const points = frames.flatMap((f, index) => {
    const m = f.builtIn[metric]
    return m && m.value !== null ? [{ id: f.asset.id, index, value: m.value, unit: m.unit, frame: f }] : []
  })
  const W = size.width
  const H = size.height
  const values = points.map((p) => p.value)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1
  const min = lo - pad
  const max = hi + pad
  const x = (index: number) => PAD_L + ((index + 0.5) / Math.max(1, frames.length)) * (W - PAD_L - PAD_R)
  const y = (value: number) => PAD_T + (1 - (value - min) / (max - min)) * (H - PAD_T - PAD_B)
  const valueAt = (py: number) => min + (1 - (py - PAD_T) / (H - PAD_T - PAD_B)) * (max - min)
  const unit = points[0]?.unit ?? ""
  // Hit areas never reach the neighbouring frame, so a click picks the point under the pointer.
  const hit = Math.max(2.5, Math.min(7, (W - PAD_L - PAD_R) / Math.max(1, frames.length) / 2))
  const lineOn = threshold && threshold.metric === metric && threshold.value !== null
  const fmt = (v: number) => formatMetric({ value: Number(v.toFixed(metric === "eccentricity" ? 2 : metric === "star-count" || metric === "background" ? 0 : 2)), unit })
  return (
    <figure className="flex min-w-0 flex-1 flex-col">
      <figcaption className="flex min-w-0 items-baseline justify-between gap-2 px-1 text-[0.6875rem] leading-4 text-muted-foreground">
        <span className="truncate font-medium text-foreground">{METRIC_LABEL[metric]}</span>
        <span className="shrink-0 tabular-nums">{points.length === 0 ? "–" : `${points.length}/${frames.length}`}</span>
      </figcaption>
      <div ref={ref} className="relative min-h-0 flex-1">
        {points.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center rounded-sm border border-dashed px-1 text-center text-[0.6875rem] text-muted-foreground">Not measured</p>
        ) : W > 0 && H > 0 ? (
          <svg
            width={W}
            height={H}
            className={cn("absolute inset-0 rounded-sm bg-card", onThreshold && "cursor-crosshair")}
            aria-hidden="true"
            onClick={(event) => {
              if (!onThreshold || (event.target as Element).closest("[data-point]")) return
              const box = event.currentTarget.getBoundingClientRect()
              onThreshold(metric, valueAt(event.clientY - box.top))
            }}
          >
            {[hi, lo].map((tick) => (
              <g key={tick}>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
                <text x={PAD_L - 4} y={y(tick) + 3} textAnchor="end" className="fill-muted-foreground text-[9px] tabular-nums">
                  {fmt(tick)}
                </text>
              </g>
            ))}
            {lineOn ? (
              <g>
                <line x1={PAD_L} x2={W - PAD_R} y1={y(threshold.value!)} y2={y(threshold.value!)} className="stroke-warning" strokeWidth={1.25} strokeDasharray="4 3" />
                <text x={W - PAD_R - 2} y={y(threshold.value!) - 3} textAnchor="end" className="fill-warning text-[9px] tabular-nums">
                  {threshold.direction === "above" ? ">" : "<"} {fmt(threshold.value!)}
                </text>
              </g>
            ) : null}
            {points.map((p) => {
              const isActive = p.id === activeId
              const isSelected = selected.has(p.id)
              const rejected = p.frame.bucket === "rejected"
              return (
                <g key={p.id} data-point onClick={() => onSelect(p.id)} className="cursor-pointer">
                  <circle cx={x(p.index)} cy={y(p.value)} r={hit} className="fill-transparent" />
                  <circle
                    cx={x(p.index)}
                    cy={y(p.value)}
                    r={isActive ? 4.5 : isSelected ? 3.4 : 2.4}
                    className={cn(
                      isActive ? "fill-primary stroke-background" : isSelected ? "fill-link stroke-transparent" : rejected ? "fill-transparent stroke-muted-foreground" : "fill-foreground/70 stroke-transparent",
                    )}
                    strokeWidth={isActive ? 1.5 : 1.2}
                  />
                  <title>{`${p.frame.asset.fileName}: ${formatMetric(p)}${rejected ? " (Rejected)" : ""}`}</title>
                </g>
              )
            })}
          </svg>
        ) : null}
      </div>
    </figure>
  )
}

export function SessionPlots(props: {
  frames: ReviewFrame[]
  activeId: AssetId | null
  selected: Set<AssetId>
  threshold: Threshold | null
  onSelect: (id: AssetId) => void
  onThreshold: ((metric: MetricKey, value: number) => void) | null
}) {
  // The sequence is capture order, whatever the list's sort.
  const frames = [...props.frames].sort((a, b) => a.order - b.order)
  return (
    <section aria-label="Plots across the session" className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex min-h-0 flex-1 gap-2">
        {PLOT_METRICS.map((metric) => (
          <MetricPlot key={metric} metric={metric} {...props} frames={frames} />
        ))}
      </div>
      <p className="flex gap-x-4 overflow-hidden px-1 text-[0.6875rem] leading-4 whitespace-nowrap text-muted-foreground">
        <span>Frame sequence, capture order · {frames.length} shown</span>
        <span>
          <Dot className="fill-foreground/70" />
          measured
        </span>
        <span>
          <Dot className="fill-transparent stroke-muted-foreground" />
          Rejected
        </span>
        <span>
          <Dot className="fill-link" />
          selected
        </span>
        <span>
          <Dot className="fill-primary" />
          current frame
        </span>
        {props.onThreshold ? <span className="text-warning">Click a plot to set the threshold there</span> : null}
      </p>
    </section>
  )
}