/**
 * Night planner (HARNESS V1, from Direction D): a timeline of the chosen
 * night (sky bands from the Sun's altitude, the Moon strip, the Target's
 * altitude curve against the minimum altitude, its observing windows and
 * now) above a strip of the next nights on one time axis. Picking a night
 * redraws the timeline. Every time on the graphics is also written out in
 * the summary and in the windows table: the drawing never carries the only
 * copy of a value, and bands carry names, not colour alone.
 */
import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import type { ObservingSite, ObservingWindow, PlanCriteria, Target } from "@/domain/types"
import { formatDuration, formatNight, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { computeWindows, nightAt, type NightProfile, nightProfile, type NightSample, PLAN_NIGHTS, zoneAbbreviation } from "./lib/planning"

const HOUR = 3_600_000
const DAY = 24 * HOUR

type Band = "day" | "civil" | "nautical" | "astronomical" | "night"

const BAND_FILL: Record<Band, string> = {
  day: "var(--band-day)",
  civil: "var(--band-civil)",
  nautical: "var(--band-nautical)",
  astronomical: "color-mix(in oklab, var(--band-nautical) 40%, var(--band-astro))",
  night: "var(--band-astro)",
}

const BAND_LABEL: Record<Band, string> = {
  day: "Day",
  civil: "Civil twilight",
  nautical: "Nautical twilight",
  astronomical: "Astronomical twilight",
  night: "Night",
}

function bandOf(sunAlt: number): Band {
  if (sunAlt > -0.833) return "day"
  if (sunAlt > -6) return "civil"
  if (sunAlt > -12) return "nautical"
  if (sunAlt > -18) return "astronomical"
  return "night"
}

function runs(samples: NightSample[], test: (s: NightSample) => boolean): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  for (const s of samples) {
    const last = out.at(-1)
    if (!test(s)) continue
    if (last && last.end === s.ms - 600_000) last.end = s.ms
    else out.push({ start: s.ms, end: s.ms })
  }
  return out
}

const hourFormats = new Map<string, Intl.DateTimeFormat>()
function localHourMinute(ms: number, timeZone: string): [number, number] {
  let format = hourFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    hourFormats.set(timeZone, format)
  }
  const parts = format.formatToParts(new Date(ms))
  return [Number(parts.find((p) => p.type === "hour")?.value), Number(parts.find((p) => p.type === "minute")?.value)]
}

const clock = (ms: number, site: ObservingSite) => formatTime(new Date(ms).toISOString(), site.timeZone)
const span = (r: { start: number; end: number }, site: ObservingSite) => `${clock(r.start, site)}–${clock(r.end, site)}`

/** Sunset minus an hour to sunrise plus an hour; the whole day when the Sun never sets or never rises. */
function visibleSpan(profile: NightProfile): { from: number; to: number } {
  const below = profile.samples.filter((s) => s.sunAlt < -0.833)
  if (below.length === 0 || below.length === profile.samples.length) return { from: profile.startMs, to: profile.endMs }
  return { from: Math.max(profile.startMs, below[0]!.ms - HOUR), to: Math.min(profile.endMs, below.at(-1)!.ms + HOUR) }
}

function NightTimeline({ profile, windows, site, target, minAltitudeDeg, nowMs }: { profile: NightProfile; windows: ObservingWindow[]; site: ObservingSite; target: Target; minAltitudeDeg: number; nowMs: number }) {
  const { from, to } = visibleSpan(profile)
  const x = (ms: number) => ((ms - from) / (to - from)) * 1000
  // Altitude 0–90° maps to the bottom 90 % of the chart; the top strip holds the Moon.
  const y = (alt: number) => 100 - Math.max(0, Math.min(90, alt))
  const shown = profile.samples.filter((s) => s.ms >= from && s.ms <= to)
  const bands = shown.reduce<Array<{ band: Band; start: number; end: number }>>((acc, s) => {
    const band = bandOf(s.sunAlt)
    const last = acc.at(-1)
    if (last && last.band === band) last.end = s.ms + 600_000
    else acc.push({ band, start: s.ms, end: s.ms + 600_000 })
    return acc
  }, [])
  const moonUp = runs(shown, (s) => s.moonAlt > 0)
  const night = runs(shown, (s) => s.sunAlt <= -18)
  const above = runs(shown, (s) => (s.targetAlt ?? -90) >= minAltitudeDeg)
  const curve = shown.filter((s) => s.targetAlt !== null).map((s) => `${x(s.ms).toFixed(1)},${y(s.targetAlt!).toFixed(1)}`).join(" ")
  const ticks = shown.filter((s) => {
    const [h, m] = localHourMinute(s.ms, site.timeZone)
    return m === 0 && h % 2 === 0
  })
  const inNight = windows.filter((w) => Date.parse(w.end) > from && Date.parse(w.start) < to)
  const zone = zoneAbbreviation(new Date(from).toISOString(), site.timeZone)
  const summary = [
    night.length > 0 ? `Night (Sun below −18°) ${night.map((r) => span(r, site)).join(", ")}` : "No full darkness this night",
    above.length > 0 ? `${target.name} above ${minAltitudeDeg}° ${above.map((r) => span(r, site)).join(", ")}` : `${target.name} stays below ${minAltitudeDeg}°`,
    moonUp.length > 0 ? `Moon up ${moonUp.map((r) => span(r, site)).join(", ")}` : "Moon down all night",
    inNight.length > 0 ? `${inNight.length === 1 ? "Window" : "Windows"} ${inNight.map((w) => span({ start: Date.parse(w.start), end: Date.parse(w.end) }, site)).join(", ")}` : "No window meets the criteria",
  ]
  const legend: Array<{ label: string; swatch: string; line?: boolean }> = [
    ...([...new Set(bands.map((b) => b.band))] as Band[]).map((band) => ({ label: BAND_LABEL[band], swatch: BAND_FILL[band] })),
    { label: "Moon up", swatch: "var(--band-moon)" },
    { label: `${target.name} altitude`, swatch: "var(--curve)", line: true },
    { label: "Window", swatch: "var(--window-mark)" },
  ]

  return (
    <figure className="space-y-1.5" data-chrome="">
      <svg role="img" aria-label={`Night of ${formatNight(nightAt(profile.startMs + HOUR, site), true)} at ${site.name}: ${summary.join("; ")}.`} viewBox="0 0 1000 100" preserveAspectRatio="none" className="block h-28 w-full overflow-hidden rounded-[5px] border">
        {bands.map((b) => (
          <rect key={b.start} x={x(b.start)} y={0} width={Math.max(0, x(Math.min(b.end, to)) - x(b.start))} height={100} fill={BAND_FILL[b.band]} />
        ))}
        {moonUp.map((m) => (
          <rect key={`m${m.start}`} x={x(m.start)} y={0} width={Math.max(2, x(m.end) - x(m.start))} height={7} fill="var(--band-moon)" />
        ))}
        <line x1={0} x2={1000} y1={y(minAltitudeDeg)} y2={y(minAltitudeDeg)} stroke="var(--window-mark)" strokeOpacity={0.55} strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {inNight.map((w) => (
          <rect key={w.key} x={x(Math.max(from, Date.parse(w.start)))} y={9} width={Math.max(2, x(Math.min(to, Date.parse(w.end))) - x(Math.max(from, Date.parse(w.start))))} height={89} fill="var(--window-mark)" fillOpacity={0.14} stroke="var(--window-mark)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
        {curve ? (
          <>
            <polyline points={curve} fill="none" stroke="var(--background)" strokeWidth={4.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <polyline points={curve} fill="none" stroke="var(--curve)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
        {nowMs > from && nowMs < to ? <line x1={x(nowMs)} x2={x(nowMs)} y1={0} y2={100} stroke="var(--primary)" strokeWidth={2} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <div aria-hidden="true" className="relative h-3.5 text-[0.6875rem] text-muted-foreground">
        {ticks.map((t) => (
          <span key={t.ms} className="num absolute -translate-x-1/2" style={{ left: `${x(t.ms) / 10}%` }}>
            {clock(t.ms, site).replace(/:00$/, "")}
          </span>
        ))}
        <span className="absolute right-0">{zone}</span>
      </div>
      <figcaption className="space-y-1 text-xs">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground" aria-label="Legend">
          {legend.map((item) => (
            <li key={item.label} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("inline-block shrink-0 border border-input", item.line ? "h-1 w-3.5 rounded-full" : "size-3 rounded-[2px]")} style={{ background: item.swatch }} />
              {item.label}
            </li>
          ))}
        </ul>
        <p className="num text-foreground">{summary.join(" · ")}</p>
      </figcaption>
    </figure>
  )
}

/**
 * The next nights on one axis (16:00 to 08:00 local solar time): full
 * darkness as the dark bar, windows as white bars, now on tonight's row.
 */
export function NightPlanner({ target, site, criteria, windows, nowMs }: { target: Target; site: ObservingSite; criteria: PlanCriteria; windows: ObservingWindow[]; nowMs: number }) {
  const firstNight = nightAt(nowMs, site)
  const nights = useMemo(
    () => Array.from({ length: PLAN_NIGHTS }, (_, n) => new Date(Date.parse(`${firstNight}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10)),
    [firstNight],
  )
  const profiles = useMemo(() => nights.map((night) => nightProfile(target, site, night)), [nights, target, site])
  const [chosen, setChosen] = useState<string | null>(null)
  const selected = chosen && nights.includes(chosen) ? chosen : firstNight
  const profile = profiles[nights.indexOf(selected)] ?? profiles[0]!
  const sunLimit = criteria.darkness === "astronomical" ? -18 : -12
  const windowsByNight = new Map<string, ObservingWindow[]>()
  for (const w of windows) {
    const night = nightAt(Date.parse(w.start), site)
    windowsByNight.set(night, [...(windowsByNight.get(night) ?? []), w])
  }
  // Strip axis: 4 h to 20 h after local solar noon.
  const fromOffset = 4 * HOUR
  const width = 16 * HOUR
  const pct = (ms: number, start: number) => `${(Math.max(0, Math.min(width, ms - start - fromOffset)) / width) * 100}%`
  // Axis ticks at even local hours in the site's zone, placed on the first night's grid.
  const first = profiles[0]!
  const axis = first.samples
    .filter((s) => s.ms >= first.startMs + fromOffset && s.ms <= first.startMs + fromOffset + width)
    .filter((s) => {
      const [h, m] = localHourMinute(s.ms, site.timeZone)
      return m === 0 && h % 2 === 0
    })
    .map((s) => ({ ms: s.ms, left: pct(s.ms, first.startMs), label: clock(s.ms, site).replace(/:00$/, "") }))

  return (
    <div className="space-y-3">
      <NightTimeline profile={profile} windows={windowsByNight.get(selected) ?? []} site={site} target={target} minAltitudeDeg={criteria.minAltitudeDeg} nowMs={nowMs} />
      <div className="space-y-1">
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_7rem] items-end gap-2 text-[0.6875rem] text-muted-foreground" aria-hidden="true">
          <span>Night</span>
          <span className="relative h-3.5">
            {axis.map((a) => (
              <span key={a.ms} className="num absolute -translate-x-1/2" style={{ left: a.left }}>
                {a.label}
              </span>
            ))}
          </span>
          <span className="text-right">Windows</span>
        </div>
        <ul aria-label={`Next ${PLAN_NIGHTS} nights; choose one to show it in the timeline`} className="overflow-hidden rounded-md border">
          {nights.map((night, index) => {
            const p = profiles[index]!
            const dark = runs(p.samples, (s) => s.sunAlt <= sunLimit)
            const own = windowsByNight.get(night) ?? []
            const total = own.reduce((sum, w) => sum + (Date.parse(w.end) - Date.parse(w.start)) / 1000, 0)
            const label = `${formatNight(night, true)}: ${own.length === 0 ? "no window" : `${own.map((w) => `${formatTime(w.start, site.timeZone)}–${formatTime(w.end, site.timeZone)}`).join(", ")}, ${formatDuration(total)}`}`
            return (
              <li key={night} className="border-b last:border-b-0 even:bg-row-alt">
                <button
                  type="button"
                  aria-pressed={night === selected}
                  aria-label={label}
                  onClick={() => setChosen(night)}
                  className="grid h-(--row-h) w-full grid-cols-[7.5rem_minmax(0,1fr)_7rem] items-center gap-2 px-2 text-left text-xs hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] aria-pressed:bg-primary/20 aria-pressed:shadow-[inset_2px_0_0_var(--primary)]"
                >
                  <span className="truncate">{formatNight(night, true)}</span>
                  <span className="relative h-3 overflow-hidden rounded-[3px] bg-band-nautical" aria-hidden="true">
                    {dark.map((d) => (
                      <span key={d.start} className="absolute inset-y-0 bg-band-astro" style={{ left: pct(d.start, p.startMs), right: `calc(100% - ${pct(d.end, p.startMs)})` }} />
                    ))}
                    {own.map((w) => (
                      <span key={w.key} className="absolute inset-y-[3px] rounded-[2px] bg-window-mark" style={{ left: pct(Date.parse(w.start), p.startMs), right: `calc(100% - ${pct(Date.parse(w.end), p.startMs)})` }} />
                    ))}
                    {index === 0 && nowMs > p.startMs + fromOffset && nowMs < p.startMs + fromOffset + width ? (
                      <span className="absolute inset-y-0 w-0.5 bg-primary" style={{ left: pct(nowMs, p.startMs) }} />
                    ) : null}
                  </span>
                  <span className="num truncate text-right text-muted-foreground">{own.length === 0 ? "None" : formatDuration(total)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="text-[0.6875rem] text-muted-foreground">Times in {site.timeZone} ({zoneAbbreviation(new Date(first.startMs).toISOString(), site.timeZone)}), as in the windows table below.</p>
      </div>
    </div>
  )
}

/**
 * Tonight across planned Targets (the Plan area's landing, Direction D's
 * tonight-first view): one row per Target on tonight's axis, its windows as
 * white bars over full darkness, each row linking to that Target's Plan.
 */
export function TonightStrip({ rows, site, nowMs }: { rows: Array<{ target: Target; criteria: PlanCriteria }>; site: ObservingSite; nowMs: number }) {
  const night = nightAt(nowMs, site)
  const profile = useMemo(() => nightProfile(rows[0]?.target ?? ({ ra: null, dec: null } as Target), site, night), [rows, site, night])
  const { from, to } = visibleSpan(profile)
  const left = (ms: number) => `${(Math.max(0, Math.min(to - from, ms - from)) / (to - from)) * 100}%`
  const dark = runs(profile.samples, (s) => s.sunAlt <= -18)
  const ticks = profile.samples.filter((s) => {
    const [h, m] = localHourMinute(s.ms, site.timeZone)
    return s.ms >= from && s.ms <= to && m === 0 && h % 2 === 0
  })
  return (
    <div className="space-y-1" data-chrome="">
      <div className="grid grid-cols-[9rem_minmax(0,1fr)_8rem] items-end gap-2 text-[0.6875rem] text-muted-foreground" aria-hidden="true">
        <span>{formatNight(night, true)}</span>
        <span className="relative h-3.5">
          {ticks.map((t) => (
            <span key={t.ms} className="num absolute -translate-x-1/2" style={{ left: left(t.ms) }}>
              {clock(t.ms, site).replace(/:00$/, "")}
            </span>
          ))}
        </span>
        <span className="text-right">Tonight</span>
      </div>
      <ul aria-label={`Tonight at ${site.name}, planned Targets`} className="overflow-hidden rounded-md border">
        {rows.map(({ target, criteria }) => {
          // Tonight only; computeWindows already drops windows that have ended.
          const own = computeWindows(target, site, criteria, nowMs, 1).filter((w) => nightAt(Date.parse(w.start), site) === night)
          const text = own.length === 0 ? "No window" : own.map((w) => `${formatTime(w.start, site.timeZone)}–${formatTime(w.end, site.timeZone)}`).join(", ")
          return (
            <li key={target.id} className="grid h-(--row-h) grid-cols-[9rem_minmax(0,1fr)_8rem] items-center gap-2 border-b px-2 text-xs last:border-b-0 even:bg-row-alt">
              <Link to="/targets/$targetId/plan" params={{ targetId: target.id }} className="truncate font-medium underline-offset-2 hover:underline" aria-label={`Plan ${target.name}: ${text}`}>
                {target.name}
              </Link>
              <span aria-hidden="true" className="relative h-3 overflow-hidden rounded-[3px] bg-band-nautical">
                {dark.map((d) => (
                  <span key={d.start} className="absolute inset-y-0 bg-band-astro" style={{ left: left(d.start), right: `calc(100% - ${left(d.end)})` }} />
                ))}
                {own.map((w) => (
                  <span key={w.key} className="absolute inset-y-[3px] rounded-[2px] bg-window-mark" style={{ left: left(Date.parse(w.start)), right: `calc(100% - ${left(Date.parse(w.end))})` }} />
                ))}
                {nowMs > from && nowMs < to ? <span className="absolute inset-y-0 w-0.5 bg-primary" style={{ left: left(nowMs) }} /> : null}
              </span>
              <span className="num truncate text-right text-muted-foreground">{text}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
