/**
 * Plots across the session (D-W13, PIX-FR-02, PIX-FR-15): FWHM, HFR,
 * eccentricity, star count and background over the frame sequence, in the
 * bottom strip. Clicking a point makes that frame current; selected frames
 * are highlighted; while threshold selection is open, the threshold shows as
 * a line and clicking a plot's background sets its value from there. Pointer
 * only by design: the frame list is the keyboard path to the same choices.
 */
import { useLayoutEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
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

// Tick labels end TICK_GAP before the plot area; the left pad fits the widest label plus EDGE.
const TICK_GAP = 4
const EDGE = 2
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
  const m = useMessages()
  const [ref, size] = useSize<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const [padL, setPadL] = useState(0)
  const points = frames.flatMap((f, index) => {
    const metricValue = f.builtIn[metric]
    return metricValue && metricValue.value !== null ? [{ id: f.asset.id, index, value: metricValue.value, unit: metricValue.unit, frame: f }] : []
  })
  const W = size.width
  const H = size.height
  const values = points.map((p) => p.value)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1
  const min = lo - pad
  const max = hi + pad
  const x = (index: number) => padL + ((index + 0.5) / Math.max(1, frames.length)) * (W - padL - PAD_R)
  const y = (value: number) => PAD_T + (1 - (value - min) / (max - min)) * (H - PAD_T - PAD_B)
  const valueAt = (py: number) => min + (1 - (py - PAD_T) / (H - PAD_T - PAD_B)) * (max - min)
  const unit = points[0]?.unit ?? ""
  // Hit areas never reach the neighbouring frame, so a click picks the point under the pointer.
  const hit = Math.max(2.5, Math.min(7, (W - padL - PAD_R) / Math.max(1, frames.length) / 2))
  const lineOn = threshold && threshold.metric === metric && threshold.value !== null
  const round = (v: number) => Number(v.toFixed(metric === "eccentricity" ? 2 : metric === "star-count" || metric === "background" ? 0 : 2))
  const fmt = (v: number) => formatMetric({ value: round(v), unit })
  // Ticks leave out the unit word the caption already implies ("stars", "ADU"), so they stay narrow.
  const tickLabel = (v: number) => (unit === "stars" || unit === "ADU" ? round(v).toLocaleString("en-GB") : fmt(v))
  const tickKey = points.length > 0 ? `${tickLabel(hi)}\n${tickLabel(lo)}` : ""
  // The left pad fits the widest tick label as rendered, so no tick is clipped in any locale.
  useLayoutEffect(() => {
    const labels = svgRef.current?.querySelectorAll<SVGTextElement>("text[data-tick]")
    if (!labels || labels.length === 0) return
    setPadL(Math.ceil(Math.max(...Array.from(labels, (label) => label.getComputedTextLength()))) + TICK_GAP + EDGE)
  }, [tickKey, W, H])
  return (
    <figure className="row-span-2 grid min-w-0 grid-rows-subgrid">
      {/* The name wraps rather than truncates; the shared grid row keeps every plot the same height. */}
      <figcaption className="flex min-w-0 flex-wrap items-baseline gap-x-2 px-1 text-[0.6875rem] leading-4 text-muted-foreground">
        <span className="min-w-0 font-medium [overflow-wrap:anywhere] text-foreground">{METRIC_LABEL[metric]}</span>
        <span className="ml-auto shrink-0 tabular-nums">{points.length === 0 ? "–" : `${points.length}/${frames.length}`}</span>
      </figcaption>
      <div ref={ref} className="relative min-h-0">
        {points.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center rounded-sm border border-dashed px-1 text-center text-[0.6875rem] text-muted-foreground">{m.status_not_measured()}</p>
        ) : W > 0 && H > 0 ? (
          <svg
            ref={svgRef}
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
                <line x1={padL} x2={W - PAD_R} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
                <text data-tick x={padL - TICK_GAP} y={y(tick) + 3} textAnchor="end" className="fill-muted-foreground text-[9px] tabular-nums">
                  {tickLabel(tick)}
                </text>
              </g>
            ))}
            {lineOn ? (
              <g>
                <line x1={padL} x2={W - PAD_R} y1={y(threshold.value!)} y2={y(threshold.value!)} className="stroke-warning" strokeWidth={1.25} strokeDasharray="4 3" />
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
                  <title>{rejected ? m.review_plot_point_rejected({ name: p.frame.asset.fileName, value: formatMetric(p) }) : `${p.frame.asset.fileName}: ${formatMetric(p)}`}</title>
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
  const m = useMessages()
  // The sequence is capture order, whatever the list's sort.
  const frames = [...props.frames].sort((a, b) => a.order - b.order)
  return (
    <section aria-label={m.review_plots_label()} className="flex h-full min-h-0 flex-col gap-1">
      <div className="grid min-h-0 flex-1 auto-cols-fr grid-flow-col grid-rows-[auto_minmax(0,1fr)] gap-x-2">
        {PLOT_METRICS.map((metric) => (
          <MetricPlot key={metric} metric={metric} {...props} frames={frames} />
        ))}
      </div>
      <p className="flex gap-x-4 overflow-hidden px-1 text-[0.6875rem] leading-4 whitespace-nowrap text-muted-foreground">
        <span>{m.review_capture_order({ count: frames.length })}</span>
        <span>
          <Dot className="fill-foreground/70" />
          {m.review_legend_measured()}
        </span>
        <span>
          <Dot className="fill-transparent stroke-muted-foreground" />
          {m.review_rejected()}
        </span>
        <span>
          <Dot className="fill-link" />
          {m.review_legend_selected()}
        </span>
        <span>
          <Dot className="fill-primary" />
          {m.review_current_frame()}
        </span>
      </p>
    </section>
  )
}