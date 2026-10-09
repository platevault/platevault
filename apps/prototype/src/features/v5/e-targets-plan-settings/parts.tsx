/**
 * Shared pieces of slice E's Targets, Target and Plan screens: tonight's sky
 * context, the Moon and site line, the per-filter good-tonight chips, Fit
 * per rig, compact Captured per channel and the Project badge.
 */
import { Link } from "@tanstack/react-router"
import { MapPin, Moon } from "lucide-react"
import { useMemo } from "react"
import { useMessages } from "@/app/preferences"
import { UnknownValue } from "@/components/app/feedback"
import { Pill } from "@/components/app/pill"
import type { Tone } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { formatHours, planningSite } from "@/domain/derive"
import { defaultCriteria, tonightAt, zoneAbbreviation } from "@/domain/planning"
import type { Fit } from "@/domain/derive"
import type { ObservingSite, PlanCriteria, Project } from "@/domain/types"
import { formatTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { nowIso, useStore } from "@/store/core"
import { type FilterChip, type FilterGrade, filterReason } from "./good-tonight"
import { nightGrid } from "./sky-tonight"
import type { RigFit, SkyContext } from "./targets-model"

/**
 * Tonight at the active planning site, recomputed every 10 minutes of the
 * (simulated) clock; null with no site or the "no site" prototype fault.
 */
export function useSkyContext(): SkyContext | null {
  const site = useStore((s) => planningSite(s))
  const offset = useStore((s) => s.faults.clockOffsetMs)
  const bucket = Math.floor((Date.now() + offset) / 600_000)
  return useMemo(() => {
    if (!site) return null
    const nowMs = Date.parse(nowIso())
    return { site, grid: nightGrid(site, nowMs), tonight: tonightAt(site, nowMs), criteria: defaultCriteria(site), nowMs }
    // `bucket` re-derives tonight as the clock moves on.
  }, [site, bucket])
}

/** "21:40 CEST" in the site's zone. */
export function siteTime(iso: string, site: ObservingSite): string {
  return `${formatTime(iso, site.timeZone)} ${zoneAbbreviation(iso, site.timeZone)}`
}

export function siteTimeRange(start: string, end: string, site: ObservingSite): string {
  return `${formatTime(start, site.timeZone)}–${formatTime(end, site.timeZone)} ${zoneAbbreviation(end, site.timeZone)}`
}

/** "21:00–04:40" in the site's zone, for columns whose zone the toolbar names. */
export function clockRange(start: string, end: string, site: ObservingSite): string {
  return `${formatTime(start, site.timeZone)}–${formatTime(end, site.timeZone)}`
}

/** The Moon, once, for a toolbar: illumination, phase, rise and set (PLAN-TGT-FR-07). */
export function MoonLine({ ctx, className }: { ctx: SkyContext; className?: string }) {
  const m = useMessages()
  const { moon } = ctx.tonight
  const parts = [
    `${moon.illuminationPct}%`,
    moon.phase,
    moon.rise ? m.tonight_moon_rises({ time: siteTime(moon.rise, ctx.site) }) : m.tonight_moon_no_rise(),
    moon.set ? m.tonight_moon_sets({ time: siteTime(moon.set, ctx.site) }) : m.tonight_moon_no_set(),
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

/** The active planning site and its time zone: every planning value names its basis. */
export function SiteLine({ site, className }: { site: ObservingSite; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[0.75rem] text-muted-foreground", className)}>
      <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">
        <span className="text-foreground">{site.name}</span> · {site.timeZone}
      </span>
    </span>
  )
}

/** Settings › Sites (PLAN-TGT-AC-15), returning here afterwards. */
export function AddSiteButton({ returnTo }: { returnTo: string }) {
  const m = useMessages()
  return (
    <Button size="sm" variant="outline" render={<Link to="/settings/sites" search={{ return: returnTo }} />}>
      {m.tonight_add_site()}
    </Button>
  )
}

/** The planning criteria behind every window, for a timeline's method note. */
export function criteriaText(m: Messages, c: PlanCriteria): string {
  const parts = [
    m.tonight_criteria_altitude({ altitude: c.minAltitudeDeg }),
    c.darkness === "astronomical" ? m.tonight_criteria_astronomical() : m.tonight_criteria_nautical(),
    m.tonight_criteria_duration({ minutes: c.minDurationMin }),
  ]
  if (c.maxMoonIlluminationPct !== null) parts.push(m.tonight_criteria_moon_illumination({ illumination: c.maxMoonIlluminationPct }))
  if (c.minMoonSeparationDeg !== null) parts.push(m.tonight_criteria_moon_separation({ separation: c.minMoonSeparationDeg }))
  return parts.join(", ")
}

const GRADE_TONE: Record<FilterGrade, Tone> = { good: "success", marginal: "warning", poor: "muted" }

/** Shape as well as colour: marginal is dashed, poor is struck through and unfilled. */
const GRADE_SHAPE: Record<FilterGrade, string> = {
  good: "",
  marginal: "border border-dashed border-warning/70 ring-0",
  poor: "bg-transparent line-through decoration-foreground/50",
}

/** A grade-tinted chip: a filter's band, or a legend word. */
export function GradePill({ grade, title, className, children }: { grade: FilterGrade; title?: string; className?: string; children: string }) {
  return (
    <Pill tone={GRADE_TONE[grade]} title={title} className={cn("h-4 min-w-5 justify-center gap-0 px-1 text-[0.625rem] leading-none", GRADE_SHAPE[grade], className)}>
      {children}
    </Pill>
  )
}

/** One filter's good-tonight chip; its reason is the tooltip. */
export function FilterPill({ chip, className }: { chip: FilterChip; className?: string }) {
  useMessages()
  return (
    <GradePill grade={chip.grade} title={filterReason(chip)} className={className}>
      {chip.band}
    </GradePill>
  )
}

/**
 * The per-filter good-tonight strip: one chip per filter, tinted good,
 * marginal or poor. Without a window tonight it reads "–" with `empty` as
 * the reason.
 */
export function FilterChips({ chips, empty }: { chips: FilterChip[] | null; empty: string }) {
  const m = useMessages()
  if (!chips) return <UnknownValue label="–" reason={empty} />
  if (chips.length === 0) return <span className="text-xs text-muted-foreground">{m.tonight_no_filters()}</span>
  return (
    <span role="img" aria-label={chips.map(filterReason).join("; ")} className="inline-flex items-center gap-0.5" data-filter-chips>
      {chips.map((c) => (
        <FilterPill key={c.band} chip={c} />
      ))}
    </span>
  )
}

/** Why a Fit is "–"; derive always names it, so the fallback is only the type's null. */
function fitReason(m: Messages, fit: Fit): string {
  return fit.reason ? say(m, fit.reason) : m.status_unknown()
}

/** Fit per rig (D-W62): one value, or one per rig labelled with the rig name; "–" names its reason. */
export function FitCell({ fits }: { fits: RigFit[] }) {
  const m = useMessages()
  if (fits.length === 1) {
    const { fit } = fits[0]!
    return fit.kind === "unknown" ? <UnknownValue label="–" reason={fitReason(m, fit)} /> : <span>{say(m, fit.label)}</span>
  }
  return (
    <span className="flex flex-col gap-0 text-xs leading-4">
      {fits.map((f) => (
        <span key={f.rigId} className="whitespace-nowrap">
          <span className="text-muted-foreground">{say(m, f.rig).split(" / ")[0]}: </span>
          {f.fit.kind === "unknown" ? <UnknownValue label="–" reason={fitReason(m, f.fit)} /> : say(m, f.fit.label)}
        </span>
      ))}
    </span>
  )
}

/** Compact Captured per channel: "Ha 9h15 · OIII 6h". */
export function CapturedCell({ captured }: { captured: Array<{ channel: string; seconds: number }> }) {
  if (captured.length === 0) return <span className="text-muted-foreground">–</span>
  return (
    <span className="text-xs whitespace-nowrap tabular-nums">
      {captured.map((c, i) => (
        <span key={c.channel}>
          {i > 0 ? <span className="text-muted-foreground"> · </span> : null}
          <span className="text-muted-foreground">{c.channel}</span> {formatHours(c.seconds)}
        </span>
      ))}
    </span>
  )
}

/** A Project badge (D-W60): the Project's name as a pill, linking to it. */
export function ProjectBadge({ project }: { project: Project }) {
  const m = useMessages()
  return (
    <Pill tone="muted" link={{ to: "/projects/$projectId", params: { projectId: project.id } }} title={m.target_project_badge({ name: project.name })} className="h-4 max-w-40 px-1.5 text-[0.625rem]">
      {project.name}
    </Pill>
  )
}
