/**
 * Histogram (L2-domain, plan §3.3; R9-PIXINSIGHT-STATS §3a-3d): the linear
 * histogram of the region a plate shows, with the median marking the sky
 * background. It takes the computed histogram, so any raster source can feed
 * it; display stretch never reaches it.
 *
 * - Caption, in PixInsight's summary terms: "Median 1,527 · MAD 246", then
 *   "Min 802 · Max 65,449 · 12 saturated · 3 invalid" when the data carries
 *   the extremes. One ① note holds the basis only: the data range, the
 *   samples of the region, and that MAD is unscaled.
 * - Bin readout (HistogramTransformation's information panel): hovering a
 *   bin draws a hairline there and the first caption line reads
 *   "1,512-1,528 ADU · 3,412 px · 4.1 %"; the last bin, which also holds every
 *   brighter sample, reads "≥ 2,940 ADU · …". The figure takes focus, and ←/→
 *   (Home/End) step the bins, so the readout is not pointer-only.
 * - `readout`: a value from elsewhere (the plate's cursor readout) drawn as a
 *   vertical line, so a pixel reads at a glance as sky, star or clipped.
 */
import { type KeyboardEvent, type PointerEvent, useState } from "react"
import { useMessages } from "@/app/preferences"
import { NoteMarker } from "@/components/app/tips"
import { formatCount, formatDecimal } from "@/lib/format"

/** A histogram of linear data, as `linearHistogram` computes it. */
export interface HistogramData {
  /** Counts per bin over linear 0..`rangeMax` ADU; the last bin also holds every brighter sample. */
  bins: readonly number[]
  rangeMax: number
  median: number
  /** Median absolute deviation, in ADU, unscaled. */
  mad: number
  /** Samples above `rangeMax`: stars and other bright signal. */
  above: number
  saturated: number
  invalid: number
  samples: number
  /** Faintest value, in ADU; the caption's second line shows Min and Max when both are known. */
  min?: number | null
  /** Brightest value, in ADU. */
  max?: number | null
  /** Source pixels of the region the samples were drawn from: "4,800 of 1,320,000". */
  total?: number
}

export interface HistogramProps {
  data: HistogramData
  /** A linear value in ADU to mark with a vertical line; null or absent draws none. */
  readout?: number | null
}

const W = 240
const H = 56

/** Bars on a log count scale, the median line, the bin readout, and the summary caption. */
export function Histogram({ data, readout = null }: HistogramProps) {
  const m = useMessages()
  const [bin, setBin] = useState<number | null>(null)
  const count = data.bins.length
  const max = Math.max(1, ...data.bins.map((c) => Math.log1p(c)))
  const bw = W / Math.max(1, count)
  const xOf = (adu: number) => (Math.min(adu, data.rangeMax) / Math.max(1, data.rangeMax)) * W
  const median = Math.round(data.median)
  const shown = bin !== null && bin < count ? bin : null

  function binText(index: number): string {
    const from = formatCount(Math.round((index * data.rangeMax) / count))
    const to = formatCount(Math.round(((index + 1) * data.rangeMax) / count))
    const n = data.bins[index] ?? 0
    const said = { from, to, count: formatCount(n), percent: formatDecimal(data.samples > 0 ? (n / data.samples) * 100 : 0, 1) }
    return index === count - 1 ? m.review_histogram_bin_last(said) : m.review_histogram_bin(said)
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width <= 0) return
    setBin(Math.max(0, Math.min(count - 1, Math.floor(((event.clientX - box.left) / box.width) * count))))
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[event.key]
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      setBin(event.key === "Home" ? 0 : count - 1)
      return
    }
    if (event.key === "Escape" && shown !== null) {
      event.stopPropagation()
      setBin(null)
      return
    }
    if (step === undefined) return
    event.preventDefault()
    event.stopPropagation()
    setBin((current) => Math.max(0, Math.min(count - 1, (current ?? Math.floor(xOf(data.median) / bw)) + step)))
  }

  const extremes = data.min != null && data.max != null ? m.review_histogram_extremes({ min: formatCount(Math.round(data.min)), max: formatCount(Math.round(data.max)) }) : null
  const second: string[] = []
  if (extremes) second.push(extremes)
  if (data.saturated > 0) second.push(m.review_histogram_saturated({ count: data.saturated }))
  if (data.invalid > 0) second.push(m.review_histogram_invalid({ count: data.invalid }))
  const samples = formatCount(data.samples)
  return (
    <figure className="space-y-1" data-histogram>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-14 w-full rounded-sm bg-plate outline-none focus-visible:ring-2 focus-visible:ring-ring"
        role="img"
        tabIndex={0}
        aria-label={m.review_histogram_label({ median })}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setBin(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setBin(null)}
      >
        {data.bins.map((n, i) => {
          const bh = (Math.log1p(n) / max) * (H - 4)
          return <rect key={i} x={i * bw} y={H - bh} width={Math.max(0.5, bw - 0.3)} height={bh} className="fill-foreground/55" />
        })}
        <line x1={xOf(data.median)} x2={xOf(data.median)} y1={0} y2={H} className="stroke-link" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {readout !== null && Number.isFinite(readout) ? (
          <line data-histogram-readout="" x1={xOf(readout)} x2={xOf(readout)} y1={0} y2={H} className="stroke-warning" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ) : null}
        {shown !== null ? (
          <line data-histogram-guide="" x1={(shown + 0.5) * bw} x2={(shown + 0.5) * bw} y1={0} y2={H} className="stroke-foreground" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      <figcaption className="text-xs text-muted-foreground tabular-nums">
        <span className="block" aria-live="polite">
          {shown !== null ? binText(shown) : m.review_histogram_median({ median: formatCount(median), mad: formatCount(Math.round(data.mad)) })}
        </span>
        <span className="block">
          {second.join(" · ")}
          {second.length > 0 ? " " : null}
          <NoteMarker
            label={m.review_histogram_note()}
            rows={[
              { label: m.review_note_data(), value: m.review_histogram_range({ max: formatCount(Math.round(data.rangeMax)) }) },
              { label: m.review_note_samples(), value: data.total !== undefined ? m.review_note_samples_of({ count: samples, total: formatCount(data.total) }) : m.review_note_samples_value({ count: samples }) },
              { label: m.review_note_mad(), value: m.review_note_mad_unscaled() },
            ]}
          />
        </span>
      </figcaption>
    </figure>
  )
}
