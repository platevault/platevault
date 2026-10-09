/**
 * Shared pieces of slice E's Targets and Plan screens: tonight's sky context,
 * the Moon and site line, the 7-band Filters strip, Fit per rig, compact
 * Captured per channel and the Project badge.
 */
import { Link } from "@tanstack/react-router"
import { MapPin, Moon } from "lucide-react"
import { useMemo } from "react"
import { UnknownValue } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { formatHours, planningSite } from "@/domain/derive"
import { defaultCriteria, tonightAt, zoneAbbreviation } from "@/domain/planning"
import type { BandCell, Fit } from "@/domain/derive"
import type { ObservingSite, Project } from "@/domain/types"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { nowIso, useStore } from "@/store/core"
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

/** The Moon, once, for a toolbar: illumination, phase, rise and set (PLAN-TGT-FR-07). */
export function MoonLine({ ctx, className }: { ctx: SkyContext; className?: string }) {
  const { moon } = ctx.tonight
  const parts = [`${moon.illuminationPct}%`, moon.phase, moon.rise ? `rises ${siteTime(moon.rise, ctx.site)}` : "no moonrise tonight", moon.set ? `sets ${siteTime(moon.set, ctx.site)}` : "no moonset tonight"]
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-[0.75rem] text-muted-foreground tabular-nums", className)} data-moon>
      <Moon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">
        <span className="text-foreground">Moon</span> {parts.join(" · ")}
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

/** "Add an observing site in Settings" (PLAN-TGT-AC-15), returning here afterwards. */
export function AddSiteButton({ returnTo }: { returnTo: string }) {
  return (
    <Button size="sm" variant="outline" render={<Link to="/settings/sites" search={{ return: returnTo }} />}>
      Add an observing site in Settings
    </Button>
  )
}

const BAND_ORDER: BandCell["band"][] = ["L", "R", "G", "B", "Ha", "SII", "OIII"]

/**
 * The Filters strip (PLAN-TGT-FR-06): the bands in strip order, each viable
 * (filled) or limited by the Moon (outlined, struck). A band the selection
 * cannot capture is left out, never drawn as limited.
 */
export function BandStrip({ cells, recommendation }: { cells: BandCell[]; recommendation: string }) {
  const sorted = [...cells].sort((a, b) => BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band))
  const label = `${recommendation}: ${sorted.map((c) => `${c.band} ${c.state}`).join(", ") || "no bands"}`
  return (
    <span className="inline-flex items-center gap-px" title={label} aria-label={label} role="img">
      {sorted.map((c) => (
        <span
          key={c.band}
          aria-hidden="true"
          className={cn(
            "inline-flex h-4 min-w-5 items-center justify-center rounded-[3px] px-0.5 text-[0.625rem] leading-none font-medium",
            c.state === "viable" ? "bg-foreground/[0.14] text-foreground" : "border border-foreground/20 text-muted-foreground line-through decoration-foreground/40",
          )}
        >
          {c.band}
        </span>
      ))}
      {sorted.length === 0 ? <span className="text-xs text-muted-foreground">No bands</span> : null}
    </span>
  )
}

function fitText(fit: Fit): string {
  return fit.kind === "fits" && fit.coverage !== null ? `fits (${Math.round(fit.coverage * 100)}%)` : fit.label
}

/** Fit per rig (D-W62): one value, or one per rig labelled with the rig name; "–" names its reason. */
export function FitCell({ fits }: { fits: RigFit[] }) {
  if (fits.length === 1) {
    const { fit } = fits[0]!
    return fit.kind === "unknown" ? <UnknownValue label="–" reason={fit.reason ?? "Fit unknown"} /> : <span>{fitText(fit)}</span>
  }
  return (
    <span className="flex flex-col gap-0 text-xs leading-4">
      {fits.map((f) => (
        <span key={f.rigId} className="whitespace-nowrap">
          <span className="text-muted-foreground">{f.rigName.split(" / ")[0]}: </span>
          {f.fit.kind === "unknown" ? <UnknownValue label="–" reason={f.fit.reason ?? "Fit unknown"} /> : fitText(f.fit)}
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

/** A Project badge (D-W60): the Project's name, linking to it. */
export function ProjectBadge({ project }: { project: Project }) {
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="inline-flex h-4 max-w-40 items-center truncate rounded-[3px] border border-separator px-1 text-[0.625rem] leading-none text-muted-foreground hover:text-foreground"
      title={`Subject of the open Project ${project.name}`}
    >
      {project.name}
    </Link>
  )
}
