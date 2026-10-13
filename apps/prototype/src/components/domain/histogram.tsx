/**
 * Histogram (L2-domain, plan §3.3): the linear histogram of the region a
 * plate shows, with the median marking the sky background. A copy of
 * `d-review/preview.tsx` HistogramView, which stays until W4; it takes the
 * computed histogram instead of the frame, so any raster source can feed it.
 * Display stretch never reaches it.
 */
import { useMessages } from "@/app/preferences"
import { NoteMarker } from "@/components/app/tips"
import { formatCount } from "@/lib/format"

/** A histogram of linear data, as `linearHistogram` computes it. */
export interface HistogramData {
  /** Counts per bin over linear 0..`rangeMax` ADU; the last bin also holds every brighter sample. */
  bins: readonly number[]
  rangeMax: number
  median: number
  /** Median absolute deviation, in ADU. */
  mad: number
  /** Samples above `rangeMax`: stars and other bright signal. */
  above: number
  saturated: number
  invalid: number
  samples: number
}

const W = 240
const H = 56

/** Bars on a log count scale, the median line, and a caption with the median, the MAD and the counts that need attention. */
export function Histogram({ data }: { data: HistogramData }) {
  const m = useMessages()
  const max = Math.max(1, ...data.bins.map((c) => Math.log1p(c)))
  const bw = W / Math.max(1, data.bins.length)
  const medianX = (data.median / Math.max(1, data.rangeMax)) * W
  const median = Math.round(data.median)
  return (
    <figure className="space-y-1" data-histogram>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-14 w-full rounded-sm bg-plate" role="img" aria-label={m.review_histogram_label({ median })}>
        {data.bins.map((count, i) => {
          const bh = (Math.log1p(count) / max) * (H - 4)
          return <rect key={i} x={i * bw} y={H - bh} width={Math.max(0.5, bw - 0.3)} height={bh} className="fill-foreground/55" />
        })}
        <line x1={medianX} x2={medianX} y1={0} y2={H} className="stroke-link" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="text-[0.6875rem] leading-4 text-muted-foreground tabular-nums">
        {m.review_histogram_median({ median: formatCount(median), mad: Math.round(data.mad) })}
        {data.saturated > 0 ? ` · ${m.review_histogram_saturated({ count: data.saturated })}` : ""}
        {data.invalid > 0 ? ` · ${m.review_histogram_invalid({ count: data.invalid })}` : ""}{" "}
        <NoteMarker
          label={m.review_histogram_note()}
          rows={[
            { label: m.review_note_data(), value: m.review_histogram_range({ max: formatCount(Math.round(data.rangeMax)) }) },
            { label: m.review_note_counts(), value: m.review_note_log() },
            { label: m.review_note_samples(), value: m.review_note_samples_value({ count: formatCount(data.samples) }) },
            { label: m.review_note_brighter(), value: formatCount(data.above) },
          ]}
        />
      </figcaption>
    </figure>
  )
}
