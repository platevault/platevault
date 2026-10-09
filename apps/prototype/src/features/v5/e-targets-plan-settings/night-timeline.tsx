/**
 * Night timeline (slice E, S11; v4's not-done item 2): twilight bands across
 * the top, a Moon band, then one row per subject or favourite with its
 * altitude curve, the minimum-altitude line and its window blocks. Rows
 * share one time axis from sunset to sunrise at the planning site, in the
 * site's zone. Each row carries a text summary for screen readers; the
 * drawing itself is decorative.
 */
import type { ReactNode } from "react"
import type { ObservingWindow } from "@/domain/types"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { siteTimeRange } from "./parts"
import type { NightGrid } from "./sky-tonight"

export interface TimelineRow {
  key: string
  label: ReactNode
  /** Plain-text name for the row's summary. */
  name: string
  altitudes: number[] | null
  windows: ObservingWindow[]
  /** Shown instead of a curve, e.g. "No catalogued coordinates". */
  note?: string
  /** Indent panel rows under their mosaic. */
  indent?: boolean
}

type Band = "day" | "civil" | "nautical" | "astronomical" | "night"

function bandOf(sunAlt: number): Band {
  if (sunAlt > 0) return "day"
  if (sunAlt > -6) return "civil"
  if (sunAlt > -12) return "nautical"
  if (sunAlt > -18) return "astronomical"
  return "night"
}

/** Brighter sky reads as more foreground tint; full night is the bare surface. */
const BAND_OPACITY: Record<Band, number> = { day: 0.16, civil: 0.11, nautical: 0.07, astronomical: 0.035, night: 0 }
const BAND_LABEL: Record<Band, string> = { day: "Day", civil: "Civil twilight", nautical: "Nautical twilight", astronomical: "Astronomical twilight", night: "Night" }

function segments<T>(values: T[], from: number, to: number): Array<{ value: T; start: number; end: number }> {
  const out: Array<{ value: T; start: number; end: number }> = []
  for (let i = from; i <= to; i += 1) {
    const value = values[i]!
    const last = out[out.length - 1]
    if (last && last.value === value) last.end = i + 1
    else out.push({ value, start: i, end: i + 1 })
  }
  return out
}

function TwilightRects({ grid, height }: { grid: NightGrid; height: number }) {
  const bands = grid.samples.map((s) => bandOf(s.sunAlt))
  return (
    <>
      {segments(bands, grid.from, grid.to).map((seg) =>
        BAND_OPACITY[seg.value] > 0 ? <rect key={seg.start} x={seg.start - grid.from} y={0} width={seg.end - seg.start} height={height} fill="var(--foreground)" fillOpacity={BAND_OPACITY[seg.value]} /> : null,
      )}
    </>
  )
}

export function NightTimeline({ grid, rows, minAltitudeDeg, nowMs, moonIlluminationPct, caption }: { grid: NightGrid; rows: TimelineRow[]; minAltitudeDeg: number; nowMs: number; moonIlluminationPct: number; caption: string }) {
  const span = grid.to - grid.from + 1
  const startMs = grid.samples[grid.from]!.ms
  const stepMs = grid.samples[1]!.ms - grid.samples[0]!.ms
  const x = (ms: number) => (ms - startMs) / stepMs
  const nowX = x(nowMs)
  const tz = grid.site.timeZone
  // Whole hours on the axis, labelled every second hour.
  const hours: Array<{ x: number; label: string }> = []
  const firstHour = Math.ceil(startMs / 3_600_000) * 3_600_000
  for (let ms = firstHour; ms <= grid.samples[grid.to]!.ms; ms += 3_600_000) hours.push({ x: x(ms), label: formatTime(new Date(ms).toISOString(), tz) })
  const moonUp = grid.samples.map((s) => s.moonAlt > 0)
  const moonSegments = segments(moonUp, grid.from, grid.to).filter((s) => s.value)
  const nowLine = nowX >= 0 && nowX <= span ? <line x1={nowX} x2={nowX} y1={0} y2={100} stroke="var(--warning)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null
  const legend = (["civil", "nautical", "astronomical", "night"] as Band[]).filter((b) => grid.samples.slice(grid.from, grid.to + 1).some((s) => bandOf(s.sunAlt) === b))

  return (
    <figure className="space-y-1.5" aria-label={caption}>
      <div className="grid grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)] text-[0.6875rem] text-muted-foreground" data-chrome>
        <span className="pr-3 leading-4">Time ({grid.site.name})</span>
        <div className="relative h-4" aria-hidden="true">
          {hours.map((h, i) =>
            i % 2 === 0 ? (
              <span key={h.x} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${(h.x / span) * 100}%` }}>
                {h.label}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-separator">
        <div className="grid grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)] border-b border-separator">
          <span className="flex h-(--row-h) items-center px-2 text-xs text-muted-foreground">Twilight</span>
          <svg aria-hidden="true" viewBox={`0 0 ${span} 100`} preserveAspectRatio="none" className="h-(--row-h) w-full">
            <TwilightRects grid={grid} height={100} />
            {hours.map((h) => (
              <line key={h.x} x1={h.x} x2={h.x} y1={0} y2={100} stroke="var(--separator)" vectorEffect="non-scaling-stroke" />
            ))}
            {nowLine}
          </svg>
        </div>
        <div className="grid grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)] border-b border-separator">
          <span className="flex h-(--row-h) items-center px-2 text-xs text-muted-foreground">Moon {moonIlluminationPct}%</span>
          <svg aria-hidden="true" viewBox={`0 0 ${span} 100`} preserveAspectRatio="none" className="h-(--row-h) w-full">
            {moonSegments.map((seg) => (
              <rect key={seg.start} x={seg.start - grid.from} y={30} width={seg.end - seg.start} height={40} rx={0} fill="var(--muted-foreground)" fillOpacity={0.15 + (moonIlluminationPct / 100) * 0.45} />
            ))}
            {nowLine}
          </svg>
        </div>
        <ul aria-label="Altitude per row">
          {rows.map((row) => {
            const summary =
              row.note ??
              (row.windows.length > 0
                ? `Windows ${row.windows.map((w) => `${siteTimeRange(w.start, w.end, grid.site)}, peak ${Math.round(w.maxAltitudeDeg)}°`).join("; ")}`
                : "No window tonight")
            const curve = row.altitudes
              ? row.altitudes
                  .slice(grid.from, grid.to + 1)
                  .map((alt, i) => `${i + 0.5},${100 - Math.max(0, Math.min(90, alt)) * (100 / 90)}`)
                  .join(" ")
              : null
            const minY = 100 - minAltitudeDeg * (100 / 90)
            return (
              <li key={row.key} className="grid grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)] border-b border-separator/60 last:border-0 even:bg-foreground/[0.022]">
                <span className={cn("flex min-w-0 items-center gap-1.5 px-2 py-1 text-sm", row.indent && "pl-5")}>
                  {row.label}
                  <span className="sr-only">: {summary}</span>
                </span>
                <svg aria-hidden="true" viewBox={`0 0 ${span} 100`} preserveAspectRatio="none" className="h-9 w-full">
                  <TwilightRects grid={grid} height={100} />
                  <line x1={0} x2={span} y1={minY} y2={minY} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                  {row.windows.map((w) => (
                    <rect
                      key={w.key}
                      x={Math.max(0, x(Date.parse(w.start)))}
                      y={6}
                      width={Math.max(0.5, x(Date.parse(w.end)) - x(Date.parse(w.start)))}
                      height={88}
                      fill="var(--primary)"
                      fillOpacity={0.3}
                      stroke="var(--primary)"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {curve ? <polyline points={curve} fill="none" stroke="var(--link)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" /> : null}
                  {nowLine}
                </svg>
              </li>
            )
          })}
        </ul>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-[0.6875rem] text-muted-foreground" data-chrome>
        {legend.map((b) => (
          <span key={b} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-[2px] border border-separator" style={{ background: `color-mix(in oklab, var(--foreground) ${BAND_OPACITY[b] * 100}%, transparent)` }} />
            {BAND_LABEL[b]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-0.5 w-3 bg-link" />
          Altitude (0–90°)
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-0 w-3 border-t border-dashed border-muted-foreground" />
          Minimum altitude {minAltitudeDeg}°
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-[2px] border border-primary bg-primary/30" />
          Window
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2.5 w-0.5 bg-warning" />
          Now
        </span>
        <span>Prototype calculation: low-precision Sun and Moon, 10-minute grid.</span>
      </figcaption>
    </figure>
  )
}
