/**
 * Night visuals (L2-domain, plan §3.3): the Moon line, the darkness line and
 * the altitude sparkline of one night at one site. Copies of the Targets
 * originals (`e-targets-plan-settings/parts.tsx`), which stay until W4. They
 * take plain data, so Home, Targets and a Target page can show the same
 * night: the times read in the site's time zone, and every value names its
 * basis through the zone abbreviation.
 */
import { Moon } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { type MoonTonight, type Tonight, zoneAbbreviation } from "@/domain/planning"
import { formatTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** "21:40 CEST" in the site's zone. */
export function siteTime(iso: string, timeZone: string): string {
  return `${formatTime(iso, timeZone)} ${zoneAbbreviation(iso, timeZone)}`
}

/** "21:40–04:10 CEST" in the site's zone. */
export function siteTimeRange(start: string, end: string, timeZone: string): string {
  return `${formatTime(start, timeZone)}–${formatTime(end, timeZone)} ${zoneAbbreviation(end, timeZone)}`
}

/** An altitude in whole degrees with a true minus sign. */
function degrees(value: number): string {
  return String(Math.round(value)).replace("-", "−")
}

/** The Moon, once, for a toolbar: illumination, phase, rise and set on the night (PLAN-TGT-FR-07). */
export function MoonLine({ moon, timeZone, className }: { moon: MoonTonight; timeZone: string; className?: string }) {
  const m = useMessages()
  const parts = [
    `${moon.illuminationPct}%`,
    say(m, moon.phase),
    moon.rise ? m.tonight_moon_rises({ time: siteTime(moon.rise, timeZone) }) : m.tonight_moon_no_rise(),
    moon.set ? m.tonight_moon_sets({ time: siteTime(moon.set, timeZone) }) : m.tonight_moon_no_set(),
  ]
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[0.75rem] text-muted-foreground tabular-nums", className)} data-moon>
      <Moon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">
        <span className="text-foreground">{m.tonight_moon()}</span> {parts.join(" · ")}
      </span>
    </span>
  )
}

/** "Dark 20:10–05:40 CEST": the night's darkness window at the site, or that it never gets dark. */
export function DarkLine({ darkness, timeZone, className }: { darkness: Tonight["darkness"]; timeZone: string; className?: string }) {
  const m = useMessages()
  return (
    <span className={cn("text-[0.75rem] text-muted-foreground tabular-nums", className)} data-dark>
      <span className="text-foreground">{m.plan_dark()}</span> {darkness ? siteTimeRange(darkness.start, darkness.end, timeZone) : m.plan_dark_none()}
    </span>
  )
}

/** The night's sample grid the sparkline draws: 10-minute samples, and the index range from sunset to sunrise. */
export interface SparkNight {
  samples: readonly { ms: number }[]
  from: number
  to: number
}

/** One position on the night: its altitude at every sample, its peak in darkness and its best window. */
export interface SparkSky {
  altitudes: readonly number[]
  /** Peak altitude in darkness and when; null without darkness. */
  peakDeg: number | null
  peakAt: string | null
  best: { start: string; end: string } | null
}

/** "Max 81° at 22:40 · window 20:10–02:30 CEST": the sparkline's tooltip and accessible name, one string. */
export function altitudeFacts(m: Messages, sky: SparkSky, timeZone: string): string {
  if (sky.peakDeg === null || sky.peakAt === null) return m.tonight_no_darkness()
  const altitude = degrees(sky.peakDeg)
  if (!sky.best) return m.tonight_spark_no_window({ altitude, time: siteTime(sky.peakAt, timeZone) })
  return m.tonight_spark_window({ altitude, time: formatTime(sky.peakAt, timeZone), window: siteTimeRange(sky.best.start, sky.best.end, timeZone) })
}

export interface AltitudeSparkProps {
  night: SparkNight
  sky: SparkSky
  /** The darkness window, shaded. */
  darkness: Tonight["darkness"]
  /** The altitude limit of the planning criteria, dashed. */
  minAltitudeDeg: number
  timeZone: string
}

/**
 * The altitude cell (P-PLAN2): a sparkline of the position's altitude from
 * sunset to sunrise, its dark window shaded, its best window marked and the
 * altitude limit dashed, beside the peak in darkness. The tooltip and the
 * accessible name state the same facts.
 */
export function AltitudeSpark({ night, sky, darkness, minAltitudeDeg, timeZone }: AltitudeSparkProps) {
  const m = useMessages()
  const facts = altitudeFacts(m, sky, timeZone)
  const span = night.to - night.from + 1
  const startMs = night.samples[night.from]?.ms ?? 0
  const stepMs = (night.samples[1]?.ms ?? 1) - (night.samples[0]?.ms ?? 0) || 1
  const x = (iso: string) => Math.max(0, Math.min(span, (Date.parse(iso) - startMs) / stepMs))
  const y = (alt: number) => 100 - (Math.max(0, Math.min(90, alt)) / 90) * 100
  const curve = sky.altitudes
    .slice(night.from, night.to + 1)
    .map((alt, i) => `${i + 0.5},${y(alt)}`)
    .join(" ")
  const limitY = y(minAltitudeDeg)
  return (
    <Tooltip>
      <TooltipTrigger render={<span role="img" aria-label={facts} data-altitude-spark className="inline-flex items-center gap-1 align-middle" />}>
        <svg aria-hidden="true" viewBox={`0 0 ${span} 100`} preserveAspectRatio="none" className="h-5 w-[4.5rem] shrink-0 rounded-[2px] bg-foreground/[0.04]">
          {darkness ? <rect x={x(darkness.start)} y={0} width={x(darkness.end) - x(darkness.start)} height={100} fill="var(--foreground)" fillOpacity={0.1} /> : null}
          <line x1={0} x2={span} y1={limitY} y2={limitY} stroke="var(--muted-foreground)" strokeOpacity={0.6} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          {sky.best ? (
            <>
              <rect x={x(sky.best.start)} y={0} width={Math.max(0.5, x(sky.best.end) - x(sky.best.start))} height={100} fill="var(--primary)" fillOpacity={0.22} />
              <rect x={x(sky.best.start)} y={84} width={Math.max(0.5, x(sky.best.end) - x(sky.best.start))} height={16} fill="var(--primary)" />
            </>
          ) : null}
          <polyline points={curve} fill="none" stroke="var(--link)" strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span aria-hidden="true" className="w-7 text-right text-xs tabular-nums">
          {sky.peakDeg === null ? "–" : `${degrees(sky.peakDeg)}°`}
        </span>
      </TooltipTrigger>
      <TooltipContent>{facts}</TooltipContent>
    </Tooltip>
  )
}
