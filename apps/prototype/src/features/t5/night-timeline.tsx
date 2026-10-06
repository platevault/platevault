/**
 * Night timeline (Harness V3, from direction D's planner): one night at a
 * site from local noon to noon. Sky bands from the Sun's altitude, the
 * Moon's time above the horizon, the Target's altitude curve against the
 * minimum-altitude criterion, the observing windows and the current time.
 * The graphic never carries the only copy of a time: `NightSummary` states
 * the same facts in text, and the windows table lists every window.
 */
import { useMemo } from "react"
import type { ObservingWindow } from "@/domain/types"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { NightSample } from "./lib/planning"

type Band = "day" | "civil" | "nautical" | "twilight" | "dark"

/** Sky colours from the theme tokens, from the accent blue of day down to the plate black of a dark sky (both themes). */
const BAND_FILL: Record<Band, string> = {
  day: "color-mix(in oklch, var(--chart-1) 46%, var(--plate))",
  civil: "color-mix(in oklch, var(--chart-1) 28%, var(--plate))",
  nautical: "color-mix(in oklch, var(--chart-1) 16%, var(--plate))",
  twilight: "color-mix(in oklch, var(--chart-1) 8%, var(--plate))",
  dark: "var(--plate)",
}

const BAND_LABEL: Record<Band, string> = {
  day: "Day",
  civil: "Civil twilight",
  nautical: "Nautical twilight",
  twilight: "Astronomical twilight",
  dark: "Dark",
}

function bandOf(sunAltDeg: number): Band {
  if (sunAltDeg > -0.833) return "day"
  if (sunAltDeg > -6) return "civil"
  if (sunAltDeg > -12) return "nautical"
  if (sunAltDeg > -18) return "twilight"
  return "dark"
}

/** Consecutive samples that satisfy `test`, as [start, end] epoch ms. */
function runs(samples: NightSample[], test: (s: NightSample) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let start: number | null = null
  samples.forEach((s, i) => {
    if (test(s)) start ??= s.t
    else if (start !== null) {
      out.push([start, s.t])
      start = null
    }
    if (i === samples.length - 1 && start !== null) out.push([start, s.t])
  })
  return out
}

function hourIn(ms: number, timeZone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).formatToParts(new Date(ms))
  return { hour: Number(parts.find((p) => p.type === "hour")?.value), minute: Number(parts.find((p) => p.type === "minute")?.value) }
}

export interface NightTimelineProps {
  samples: NightSample[]
  windows: ObservingWindow[]
  timeZone: string
  /** Shown as a dashed line on the altitude scale. */
  minAltitudeDeg?: number
  nowMs?: number
  /** "full" draws the altitude curve, ticks and legend; "strip" is a row-sized glance. */
  variant?: "full" | "strip"
  targetName?: string
  className?: string
}

export function NightTimeline({ samples, windows, timeZone, minAltitudeDeg, nowMs, variant = "full", targetName, className }: NightTimelineProps) {
  const t0 = samples[0]?.t ?? 0
  const t1 = samples.at(-1)?.t ?? 1
  const x = (ms: number) => ((ms - t0) / (t1 - t0)) * 1000
  const y = (alt: number) => 100 - (Math.max(0, Math.min(90, alt)) / 90) * 92
  const bands = useMemo(() => {
    const out: Array<{ band: Band; start: number; end: number }> = []
    for (const s of samples) {
      const band = bandOf(s.sunAltDeg)
      const last = out.at(-1)
      if (last && last.band === band) last.end = s.t + 600_000
      else out.push({ band, start: s.t, end: s.t + 600_000 })
    }
    return out
  }, [samples])
  const curves = useMemo(
    () =>
      runs(samples, (s) => (s.targetAltDeg ?? -1) >= 0).map(([a, b]) =>
        samples
          .filter((s) => s.t >= a && s.t <= b)
          .map((s) => `${x(s.t).toFixed(1)},${y(s.targetAltDeg ?? 0).toFixed(1)}`)
          .join(" "),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [samples],
  )
  const moonUp = useMemo(() => runs(samples, (s) => s.moonAltDeg > 0), [samples])
  const ticks = useMemo(
    () =>
      samples.filter((s) => {
        const { hour, minute } = hourIn(s.t, timeZone)
        return minute < 10 && hour % 3 === 0
      }),
    [samples, timeZone],
  )
  const shown = windows.filter((w) => Date.parse(w.end) > t0 && Date.parse(w.start) < t1)
  const strip = variant === "strip"

  return (
    <div className={cn("min-w-0", className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        className={cn("block w-full overflow-hidden rounded-sm border", strip ? "h-3" : "h-24")}
      >
        {bands.map((b) => (
          <rect key={b.start} x={x(b.start)} y={0} width={Math.max(0, x(Math.min(b.end, t1)) - x(b.start))} height={100} fill={BAND_FILL[b.band]} />
        ))}
        {shown.map((w) => (
          <rect
            key={w.key}
            x={x(Math.max(Date.parse(w.start), t0))}
            y={strip ? 55 : 0}
            width={Math.max(2, x(Math.min(Date.parse(w.end), t1)) - x(Math.max(Date.parse(w.start), t0)))}
            height={strip ? 45 : 100}
            fill={strip ? "var(--primary)" : "color-mix(in oklch, var(--primary) 22%, transparent)"}
            stroke={strip ? "none" : "var(--primary)"}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {strip ? null : (
          <>
            {moonUp.map(([a, b]) => (
              <rect key={a} x={x(a)} y={0} width={x(b) - x(a)} height={5} fill="color-mix(in oklch, var(--plate-ink) 62%, transparent)" />
            ))}
            {minAltitudeDeg !== undefined ? (
              <line x1={0} x2={1000} y1={y(minAltitudeDeg)} y2={y(minAltitudeDeg)} stroke="color-mix(in oklch, var(--plate-ink) 55%, transparent)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
            ) : null}
            {curves.map((points) => (
              <polyline key={points.slice(0, 12)} points={points} fill="none" stroke="var(--plate-ink)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            ))}
          </>
        )}
        {nowMs !== undefined && nowMs > t0 && nowMs < t1 ? (
          <line x1={x(nowMs)} x2={x(nowMs)} y1={0} y2={100} stroke="var(--warning)" strokeWidth={strip ? 1.5 : 2} vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>
      {strip ? null : (
        <>
          <div aria-hidden="true" className="relative h-4 text-[11px] leading-4 text-muted-foreground tabular-nums" data-chrome>
            {ticks.map((s) => (
              <span key={s.t} className="absolute -translate-x-1/2" style={{ left: `${x(s.t) / 10}%` }}>
                {formatTime(new Date(s.t).toISOString(), timeZone)}
              </span>
            ))}
          </div>
          <ul aria-hidden="true" className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" data-chrome>
            {(["day", "nautical", "dark"] as const).map((band) => (
              <li key={band} className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-[2px] border" style={{ background: BAND_FILL[band] }} />
                {band === "nautical" ? "Twilight" : BAND_LABEL[band]}
              </li>
            ))}
            <li className="inline-flex items-center gap-1">
              <span className="h-0.5 w-3 bg-foreground" />
              {targetName ?? "Target"} altitude
            </li>
            {minAltitudeDeg !== undefined ? (
              <li className="inline-flex items-center gap-1">
                <span className="w-3 border-t border-dashed border-foreground/60" />
                Minimum {minAltitudeDeg}°
              </li>
            ) : null}
            <li className="inline-flex items-center gap-1">
              <span className="h-1 w-3 bg-foreground/60" />
              Moon up
            </li>
            <li className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded-[2px] border border-primary bg-primary/25" />
              Window
            </li>
            {nowMs !== undefined && nowMs > t0 && nowMs < t1 ? (
              <li className="inline-flex items-center gap-1">
                <span className="h-2.5 w-0.5 bg-warning" />
                Now
              </li>
            ) : null}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * The night in words: darkness, the Target's best altitude, the Moon and
 * the windows. This is the accessible copy of everything the timeline draws.
 */
export function nightSummary(samples: NightSample[], windows: ObservingWindow[], timeZone: string, sunLimitDeg: number, targetName: string): string {
  const dark = runs(samples, (s) => s.sunAltDeg <= sunLimitDeg)[0]
  const time = (ms: number) => formatTime(new Date(ms).toISOString(), timeZone)
  const parts: string[] = []
  if (!dark) parts.push(`Never ${sunLimitDeg === -18 ? "astronomically" : "nautically"} dark`)
  else {
    parts.push(`${sunLimitDeg === -18 ? "Astronomically" : "Nautically"} dark ${time(dark[0])}–${time(dark[1])}`)
    const during = samples.filter((s) => s.t >= dark[0] && s.t <= dark[1] && s.targetAltDeg !== null)
    const peak = during.reduce<NightSample | null>((best, s) => (!best || (s.targetAltDeg ?? -90) > (best.targetAltDeg ?? -90) ? s : best), null)
    if (peak && peak.targetAltDeg !== null) parts.push(`${targetName} highest at ${Math.round(peak.targetAltDeg)}° (${time(peak.t)})`)
    const moon = runs(
      samples.filter((s) => s.t >= dark[0] && s.t <= dark[1]),
      (s) => s.moonAltDeg > 0,
    )
    parts.push(moon.length === 0 ? "Moon down all dark hours" : `Moon up ${moon.map(([a, b]) => `${time(a)}–${time(b)}`).join(", ")}`)
  }
  const t0 = samples[0]?.t ?? 0
  const t1 = samples.at(-1)?.t ?? 0
  const tonight = windows.filter((w) => Date.parse(w.end) > t0 && Date.parse(w.start) < t1)
  parts.push(tonight.length === 0 ? "no window meets the criteria" : `${tonight.length === 1 ? "window" : "windows"} ${tonight.map((w) => `${formatTime(w.start, timeZone)}–${formatTime(w.end, timeZone)}`).join(", ")}`)
  return `${parts.join(" · ")}.`
}
