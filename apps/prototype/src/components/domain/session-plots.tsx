/**
 * SessionPlots (L2-domain): small multiples of measured values over the
 * frame sequence (D-W13, PIX-FR-02, PIX-FR-15): FWHM, HFR, eccentricity,
 * star count, background, in capture order whatever the list's sort.
 * Clicking a point makes that frame current; the current and selected frames
 * stand out and rejected ones are hollow. Hovering a point reads its frame and
 * value in the plot's caption, so no tooltip hides data. A threshold, when
 * the host passes one, shows as a dashed line on its plot. Pointer only by
 * design: the frame list is the keyboard path to the same choices, so the
 * figures are hidden from assistive technology except their captions.
 */
import { useLayoutEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { formatCount } from "@/lib/format"
import { useSize } from "@/lib/use-size"
import { cn } from "@/lib/utils"

/** One frame's value on a plot; `index` is its place in the capture sequence. */
export interface PlotPoint {
  id: string
  index: number
  value: number
  /** Names the frame in the hover readout: "Light_0012.fits". */
  name: string
  rejected: boolean
}

export interface PlotSeries {
  id: string
  /** The metric: "FWHM". */
  label: string
  points: readonly PlotPoint[]
  /** A value with its unit: "3.21 px". */
  format: (value: number) => string
  /** A tick label, which may leave out the unit the caption implies. */
  tick: (value: number) => string
}

export interface PlotThreshold {
  seriesId: string
  direction: "above" | "below"
  value: number
}

export interface SessionPlotsProps {
  series: readonly PlotSeries[]
  /** Frames in the sequence, measured or not. */
  count: number
  activeId: string | null
  selected: ReadonlySet<string>
  threshold?: PlotThreshold | null
  onSelect: (id: string) => void
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

function MetricPlot({ series, count, activeId, selected, threshold, onSelect }: Omit<SessionPlotsProps, "series" | "threshold"> & { series: PlotSeries; threshold: PlotThreshold | null }) {
  const m = useMessages()
  const [ref, size] = useSize<HTMLDivElement>()
  const svgRef = useRef<SVGSVGElement>(null)
  const [padL, setPadL] = useState(0)
  const [hover, setHover] = useState<PlotPoint | null>(null)
  const { points } = series
  const W = size.width
  const H = size.height
  const values = points.map((p) => p.value)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1
  const min = lo - pad
  const max = hi + pad
  const x = (index: number) => padL + ((index + 0.5) / Math.max(1, count)) * (W - padL - PAD_R)
  const y = (value: number) => PAD_T + (1 - (value - min) / (max - min)) * (H - PAD_T - PAD_B)
  // Hit areas never reach the neighbouring frame, so a click picks the point under the pointer.
  const hit = Math.max(2.5, Math.min(7, (W - padL - PAD_R) / Math.max(1, count) / 2))
  const line = threshold && threshold.seriesId === series.id ? threshold : null
  const tickKey = points.length > 0 ? `${series.tick(hi)}\n${series.tick(lo)}` : ""
  // The left pad fits the widest tick label as rendered, so no tick is clipped in any locale.
  useLayoutEffect(() => {
    const labels = svgRef.current?.querySelectorAll<SVGTextElement>("text[data-tick]")
    if (!labels || labels.length === 0) return
    setPadL(Math.ceil(Math.max(...Array.from(labels, (label) => label.getComputedTextLength()))) + TICK_GAP + EDGE)
  }, [tickKey, W, H])
  return (
    <figure className="row-span-2 grid min-w-0 grid-rows-subgrid" data-plot={series.id}>
      {/* The name wraps rather than truncates; the shared grid row keeps every plot the same height. */}
      <figcaption className="flex min-w-0 flex-wrap items-baseline gap-x-2 px-1 text-xs text-muted-foreground">
        <span className="min-w-0 font-medium [overflow-wrap:anywhere] text-foreground">{series.label}</span>
        <span className="ml-auto min-w-0 truncate tabular-nums" aria-live="polite">
          {hover ? m.review_plot_point({ name: hover.name, value: series.format(hover.value) }) : points.length === 0 ? "–" : m.review_plot_coverage({ count: formatCount(points.length), total: formatCount(count) })}
        </span>
      </figcaption>
      <div ref={ref} className="relative min-h-0">
        {points.length === 0 ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-sm border border-dashed px-1 text-center text-xs text-muted-foreground">{m.status_not_measured()}</span>
        ) : W > 0 && H > 0 ? (
          <svg ref={svgRef} width={W} height={H} className="absolute inset-0 rounded-sm bg-card" aria-hidden="true" onPointerLeave={() => setHover(null)}>
            {[hi, lo].map((tick) => (
              <g key={tick}>
                <line x1={padL} x2={W - PAD_R} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth={1} />
                <text data-tick x={padL - TICK_GAP} y={y(tick) + 3} textAnchor="end" className="fill-muted-foreground text-xs tabular-nums">
                  {series.tick(tick)}
                </text>
              </g>
            ))}
            {line ? (
              <g data-plot-threshold="">
                <line x1={padL} x2={W - PAD_R} y1={y(line.value)} y2={y(line.value)} className="stroke-warning" strokeWidth={1.25} strokeDasharray="4 3" />
                <text x={W - PAD_R - 2} y={y(line.value) - 3} textAnchor="end" className="fill-warning text-xs tabular-nums">
                  {line.direction === "above" ? ">" : "<"} {series.format(line.value)}
                </text>
              </g>
            ) : null}
            {points.map((p) => {
              const isActive = p.id === activeId
              const isSelected = selected.has(p.id)
              return (
                <g key={p.id} data-point={p.id} onClick={() => onSelect(p.id)} onPointerEnter={() => setHover(p)} className="cursor-pointer">
                  <circle cx={x(p.index)} cy={y(p.value)} r={hit} className="fill-transparent" />
                  <circle
                    cx={x(p.index)}
                    cy={y(p.value)}
                    r={isActive ? 4.5 : isSelected ? 3.4 : 2.4}
                    className={cn(isActive ? "fill-primary stroke-background" : isSelected ? "fill-link stroke-transparent" : p.rejected ? "fill-transparent stroke-muted-foreground" : "fill-foreground/70 stroke-transparent")}
                    strokeWidth={isActive ? 1.5 : 1.2}
                  />
                </g>
              )
            })}
          </svg>
        ) : null}
      </div>
    </figure>
  )
}

/** One plot per series side by side, and the legend under them. */
export function SessionPlots({ series, threshold = null, ...props }: SessionPlotsProps) {
  const m = useMessages()
  return (
    <section aria-label={m.review_plots_label()} className="flex h-full min-h-0 flex-col gap-1">
      <div className="grid min-h-0 flex-1 auto-cols-fr grid-flow-col grid-rows-[auto_minmax(0,1fr)] gap-x-2">
        {series.map((s) => (
          <MetricPlot key={s.id} series={s} threshold={threshold} {...props} />
        ))}
      </div>
      <p className="flex gap-x-4 overflow-hidden px-1 text-xs whitespace-nowrap text-muted-foreground">
        <span>{m.review_capture_order({ count: props.count })}</span>
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
