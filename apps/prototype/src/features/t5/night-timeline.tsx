/**
 * D's night timeline in studio dress (HARNESS-V2.md §Plan): local noon to
 * noon, sky bands from the Sun's altitude, a thin strip while the Moon is
 * up, the Target's altitude curve and its observing windows as outlined
 * bars. The graphic summarises; every time it shows is also written out in
 * text by its caller or its own label.
 */
import { useMemo } from "react"
import type { ObservingWindow } from "@/domain/types"
import { cn } from "@/lib/utils"
import type { NightProfile, NightSample } from "./lib/planning"

type Band = "day" | "civil" | "nautical" | "astro" | "dark"

const BAND_FILL: Record<Band, string> = {
  day: "var(--band-day)",
  civil: "var(--band-civil)",
  nautical: "var(--band-nautical)",
  astro: "var(--band-astro)",
  dark: "var(--band-dark)",
}

export const BAND_LABEL: Record<Band, string> = {
  day: "Day",
  civil: "Civil twilight",
  nautical: "Nautical twilight",
  astro: "Astronomical twilight",
  dark: "Astronomical dark",
}

function bandFor(sunAlt: number): Band {
  if (sunAlt > 0) return "day"
  if (sunAlt > -6) return "civil"
  if (sunAlt > -12) return "nautical"
  if (sunAlt > -18) return "astro"
  return "dark"
}

function runs(samples: NightSample[], test: (s: NightSample) => boolean): Array<{ startMs: number; endMs: number }> {
  const out: Array<{ startMs: number; endMs: number }> = []
  let open: { startMs: number; endMs: number } | null = null
  for (const s of samples) {
    if (test(s)) {
      if (open) open.endMs = s.ms
      else open = { startMs: s.ms, endMs: s.ms }
    } else if (open) {
      out.push(open)
      open = null
    }
  }
  if (open) out.push(open)
  return out
}

/** The night's astronomical dark (Sun at or below −18°), or null when it never gets fully dark. */
export function darkInterval(profile: NightProfile): { startMs: number; endMs: number } | null {
  return runs(profile.samples, (s) => s.sunAlt <= -18)[0] ?? null
}

export function clockTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms))
}

export function NightTimeline({
  profile,
  windows = [],
  highlightKey,
  timeZone,
  label,
  height = 56,
  ticks = true,
  className,
}: {
  profile: NightProfile
  windows?: ObservingWindow[]
  /** The window drawn in the accent (the selected one); the others draw as neutral outlines. */
  highlightKey?: string | null
  timeZone: string
  label: string
  height?: number
  ticks?: boolean
  className?: string
}) {
  const span = profile.endMs - profile.startMs
  const x = (ms: number) => ((ms - profile.startMs) / span) * 1000
  const bands = useMemo(() => {
    const out: Array<{ band: Band; startMs: number; endMs: number }> = []
    for (const s of profile.samples) {
      const band = bandFor(s.sunAlt)
      const last = out[out.length - 1]
      if (last && last.band === band) last.endMs = s.ms
      else out.push({ band, startMs: s.ms, endMs: s.ms })
    }
    return out
  }, [profile])
  const moonUp = useMemo(() => runs(profile.samples, (s) => s.moonAlt > 0), [profile])
  const curve = useMemo(
    () =>
      profile.samples
        .filter((s) => s.targetAlt !== null)
        .map((s) => `${(((s.ms - profile.startMs) / span) * 1000).toFixed(1)},${(100 - Math.max(0, s.targetAlt ?? 0) * (100 / 90)).toFixed(1)}`)
        .join(" "),
    [profile, span],
  )
  // Every two hours on the hour, labelled in the site's time zone.
  const tickTimes: number[] = []
  for (let t = Math.ceil(profile.startMs / 7_200_000) * 7_200_000; t < profile.endMs; t += 7_200_000) tickTimes.push(t)

  return (
    <figure className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <svg role="img" aria-label={label} viewBox="0 0 1000 100" preserveAspectRatio="none" className="block w-full overflow-hidden rounded-sm shadow-[inset_0_0_0_1px_var(--seam)]" style={{ height }}>
        {bands.map((b) => (
          <rect key={b.startMs} x={x(b.startMs)} y={0} width={Math.max(0, x(b.endMs) - x(b.startMs) + 6)} height={100} fill={BAND_FILL[b.band]} />
        ))}
        {moonUp.map((m) => (
          <rect key={`m${m.startMs}`} x={x(m.startMs)} y={0} width={Math.max(0, x(m.endMs) - x(m.startMs))} height={12} fill="var(--band-moon)" />
        ))}
        {ticks
          ? tickTimes.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={100} stroke="var(--seam)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)
          : null}
        {windows.map((w) => {
          const on = w.key === highlightKey
          return (
            <rect
              key={w.key}
              x={x(Date.parse(w.start))}
              y={on ? 2 : 4}
              width={Math.max(2, x(Date.parse(w.end)) - x(Date.parse(w.start)))}
              height={on ? 96 : 92}
              fill={on ? "color-mix(in oklch, var(--primary) 18%, transparent)" : "color-mix(in oklch, var(--foreground) 8%, transparent)"}
              stroke={on ? "var(--primary)" : "var(--muted-foreground)"}
              strokeWidth={on ? 2 : 1}
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
        {curve ? <polyline points={curve} fill="none" stroke="var(--curve)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" /> : null}
      </svg>
      {ticks ? (
        <div aria-hidden="true" className="chrome relative h-3.5 text-2xs text-muted-foreground">
          {tickTimes.map((t) => (
            <span key={t} className="num absolute -translate-x-1/2" style={{ left: `${x(t) / 10}%` }}>
              {clockTime(t, timeZone).slice(0, 2)}
            </span>
          ))}
        </div>
      ) : null}
    </figure>
  )
}

/** Legend for the timeline: each band, the Moon strip, the altitude curve and a window, each a swatch beside its word. */
export function NightLegend({ targetName }: { targetName: string }) {
  const items: Array<{ swatch: string; label: string; line?: boolean; outline?: boolean }> = [
    { swatch: BAND_FILL.dark, label: BAND_LABEL.dark },
    { swatch: BAND_FILL.astro, label: "Astro. twilight" },
    { swatch: BAND_FILL.nautical, label: "Nautical" },
    { swatch: BAND_FILL.civil, label: "Civil" },
    { swatch: "var(--band-moon)", label: "Moon up" },
    { swatch: "var(--curve)", label: `${targetName} altitude`, line: true },
    { swatch: "var(--primary)", label: "Window", outline: true },
  ]
  return (
    <ul className="chrome flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className={cn("inline-block shrink-0", item.line ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-[2px] shadow-[inset_0_0_0_1px_var(--seam)]")}
            style={item.outline ? { boxShadow: `inset 0 0 0 1.5px ${item.swatch}` } : { background: item.swatch }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  )
}
